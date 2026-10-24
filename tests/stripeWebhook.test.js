import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __test as hook } from '../functions/api/stripe-webhook.js';

/**
 * THE STRIPE WEBHOOK HANDS OUT PAID ACCESS.
 *
 * Anyone on the internet can POST to it. The signature check is the only
 * thing between a real purchase and a stranger with curl, so it gets tested
 * against a real HMAC rather than a stubbed one: every signature below is
 * computed here with Web Crypto, the same primitive the handler uses, so a
 * passing test means the handler would accept what Stripe actually sends.
 *
 * The ledger behaviour (multiple purchases, refunds, revocation) needs a
 * database and lives in tests/live/purchaseLedger.test.js, which runs
 * against staging under the production-write gate. This file is the pure
 * half: signatures, product identity, and the helpers that must not leak.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const SECRET = 'whsec_test_blueprint_0123456789abcdef';
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0')).join('');

/** Sign a body the way Stripe does, so the tests exercise the real path. */
async function sign(body, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${body}`));
    return { header: `t=${ts},v1=${hex(mac)}`, ts, sig: hex(mac) };
}

const ENV = {
    STRIPE_PRICE_CENTS: '9900',
    STRIPE_CURRENCY: 'usd',
};

const paidSession = (over = {}) => ({
    id: 'cs_test_1',
    mode: 'payment',
    payment_status: 'paid',
    amount_subtotal: 9900,
    amount_total: 9900,
    currency: 'usd',
    payment_intent: 'pi_test_1',
    customer_details: { email: 'buyer@example.com' },
    ...over,
});

describe('signature verification, against a real HMAC', () => {
    test('A CORRECTLY SIGNED BODY IS ACCEPTED', async () => {
        const body = JSON.stringify({ id: 'evt_1' });
        const { header } = await sign(body);
        expect(await hook.verifySignature(body, header, SECRET)).toEqual({ ok: true });
    });

    test('THE WRONG SECRET IS REJECTED', async () => {
        const body = JSON.stringify({ id: 'evt_1' });
        const { header } = await sign(body, { secret: 'whsec_someone_elses_secret_xxxx' });
        const r = await hook.verifySignature(body, header, SECRET);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/no signature matched/);
    });

    test('A TAMPERED BODY IS REJECTED', async () => {
        /* The attack this exists for: take a real signed purchase, change
           the email to your own, replay it. */
        const original = JSON.stringify({ id: 'evt_1', email: 'buyer@example.com' });
        const { header } = await sign(original);
        const tampered = JSON.stringify({ id: 'evt_1', email: 'attacker@example.com' });
        const r = await hook.verifySignature(tampered, header, SECRET);
        expect(r.ok).toBe(false);
    });

    test('A STALE TIMESTAMP IS REJECTED, WHICH IS WHAT STOPS A LATER REPLAY', async () => {
        const body = JSON.stringify({ id: 'evt_1' });
        const old = Math.floor(Date.now() / 1000) - 3600;
        const { header } = await sign(body, { ts: old });
        const r = await hook.verifySignature(body, header, SECRET);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/outside tolerance/);
    });

    test('a future timestamp beyond tolerance is rejected too', async () => {
        const body = JSON.stringify({ id: 'evt_1' });
        const { header } = await sign(body, { ts: Math.floor(Date.now() / 1000) + 3600 });
        expect((await hook.verifySignature(body, header, SECRET)).ok).toBe(false);
    });

    test('a signature within tolerance is accepted', async () => {
        const body = JSON.stringify({ id: 'evt_1' });
        const { header } = await sign(body, { ts: Math.floor(Date.now() / 1000) - 60 });
        expect((await hook.verifySignature(body, header, SECRET)).ok).toBe(true);
    });

    test('ROTATION: several v1 signatures, one matching, is accepted', async () => {
        /* During a secret rotation Stripe signs with both. Checking only the
           first would drop events for the length of the rotation. */
        const body = JSON.stringify({ id: 'evt_1' });
        const ts = Math.floor(Date.now() / 1000);
        const good = await sign(body, { ts });
        const bad = await sign(body, { secret: 'whsec_old_rotated_out_secret_x', ts });
        const header = `t=${ts},v1=${bad.sig},v1=${good.sig}`;
        expect((await hook.verifySignature(body, header, SECRET)).ok).toBe(true);
    });

    test('a missing or malformed header is rejected, never waved through', async () => {
        const body = '{}';
        for (const header of [null, undefined, '', 'garbage', 't=123', 'v1=abc',
            't=notanumber,v1=abc']) {
            const r = await hook.verifySignature(body, header, SECRET);
            expect(r.ok, `accepted header: ${String(header)}`).toBe(false);
        }
    });

    test('the comparison is length-safe and rejects a prefix', () => {
        expect(hook.constantTimeEqual('abcdef', 'abcdef')).toBe(true);
        expect(hook.constantTimeEqual('abcdef', 'abcde')).toBe(false);
        expect(hook.constantTimeEqual('abcdef', 'abcdeg')).toBe(false);
        expect(hook.constantTimeEqual('', '')).toBe(true);
        expect(hook.constantTimeEqual(null, 'abc')).toBe(false);
        expect(hook.constantTimeEqual('abc', undefined)).toBe(false);
    });
});

describe('product identity: no verified product, no access', () => {
    test('A PAID SESSION AT THE RIGHT PRICE IS A PURCHASE', () => {
        expect(hook.notAPurchase(paidSession(), ENV)).toBeNull();
    });

    test('A SUBSCRIPTION IS NOT THIS PRODUCT', () => {
        expect(hook.notAPurchase(paidSession({ mode: 'subscription' }), ENV))
            .toMatch(/mode was subscription/);
    });

    test('AN UNPAID OR PENDING SESSION IS NOT A PURCHASE', () => {
        for (const status of ['unpaid', 'no_payment_required', undefined]) {
            expect(hook.notAPurchase(paidSession({ payment_status: status }), ENV))
                .toMatch(/payment_status/);
        }
    });

    test('THE WRONG AMOUNT IS REFUSED, WHICH IS WHAT STOPS A $1 UNLOCK', () => {
        expect(hook.notAPurchase(paidSession({ amount_subtotal: 100, amount_total: 100 }), ENV))
            .toMatch(/amount was 100/);
        expect(hook.notAPurchase(paidSession({ amount_subtotal: 9800, amount_total: 9800 }), ENV))
            .toMatch(/amount was 9800/);
    });

    test('TAX ON TOP DOES NOT BREAK IT: subtotal is compared, not total', () => {
        /* With Stripe Tax enabled amount_total exceeds the price. Comparing
           the total would refuse every taxed purchase. */
        expect(hook.notAPurchase(
            paidSession({ amount_subtotal: 9900, amount_total: 10692 }), ENV)).toBeNull();
    });

    test('and the total is used when no subtotal is present', () => {
        const s = paidSession({ amount_total: 9900 });
        delete s.amount_subtotal;
        expect(hook.notAPurchase(s, ENV)).toBeNull();
    });

    test('the wrong currency is refused', () => {
        expect(hook.notAPurchase(paidSession({ currency: 'eur' }), ENV))
            .toMatch(/currency was eur/);
    });

    test('MISSING PRICE CONFIG IS A REFUSAL, NOT A FREE PASS', () => {
        /* The lesson the Ko-fi handler already learned: a check that only
           runs when its config happens to be set is a lock that unlocks
           itself when you lose the key. */
        for (const env of [{}, { STRIPE_PRICE_CENTS: '' },
            { STRIPE_PRICE_CENTS: 'abc' }, { STRIPE_PRICE_CENTS: '0' },
            { STRIPE_PRICE_CENTS: '-9900' }]) {
            expect(hook.notAPurchase(paidSession(), env), JSON.stringify(env))
                .toMatch(/STRIPE_PRICE_CENTS is not configured/);
        }
    });

    test('a non-object session is refused rather than throwing', () => {
        for (const s of [null, undefined, 'string', 42]) {
            expect(hook.notAPurchase(s, ENV)).toBeTruthy();
        }
    });
});

describe('the email that becomes the entitlement key', () => {
    test('customer_details wins, with customer_email as the fallback', () => {
        expect(hook.sessionEmail(paidSession())).toBe('buyer@example.com');
        const s = paidSession({ customer_details: null, customer_email: 'alt@example.com' });
        expect(hook.sessionEmail(s)).toBe('alt@example.com');
        const none = paidSession({ customer_details: null });
        delete none.customer_email;
        expect(hook.sessionEmail(none)).toBeNull();
    });

    test('junk is refused before it can be written to members', () => {
        for (const bad of [null, undefined, '', 'a@b', 'no-at-sign', '@example.com',
            'spaces in@example.com', 'x'.repeat(300) + '@example.com', 42]) {
            expect(hook.isPlausibleEmail(bad), `accepted: ${String(bad)}`).toBe(false);
        }
        for (const good of ['buyer@example.com', 'a.b+tag@sub.example.co.uk']) {
            expect(hook.isPlausibleEmail(good), `rejected: ${good}`).toBe(true);
        }
    });
});

describe('nothing private reaches a log', () => {
    test('AN EMAIL IS NEVER LOGGED IN FULL', () => {
        const r = hook.redactEmail('christopher.taylor@gmail.com');
        expect(r).toBe('ch***@gmail.com');
        expect(r).not.toContain('christopher');
        expect(hook.redactEmail(null)).toBe('<none>');
        expect(hook.redactEmail('nonsense')).toBe('<none>');
    });

    test('the handler logs no raw body, event or email', () => {
        const src = read('functions/api/stripe-webhook.js');
        const logs = [...src.matchAll(/console\.(log|error|warn)\(([^;]*)\);/g)]
            .map(m => m[2]);
        expect(logs.length).toBeGreaterThan(5);
        /* The word "email" inside a message literal is not a leak. Only an
           email-bearing EXPRESSION is, so string literals come out first. */
        const code = (line) => line
            .replace(/'(?:[^'\\]|\\.)*'/g, "''")
            .replace(/"(?:[^"\\]|\\.)*"/g, '""')
            .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, '``');
        for (const line of logs) {
            const expr = code(line);
            expect(expr, `log may leak a body: ${line}`).not.toMatch(/\brawBody\b/);
            expect(expr, `log may leak the event: ${line}`)
                .not.toMatch(/JSON\.stringify\(\s*event/);
            if (/\bemail\b/.test(expr)) {
                expect(expr, `log uses a bare email: ${line}`).toMatch(/redactEmail\(/);
            }
        }
    });

    test('NO HEALTH DATA IS SENT TO STRIPE', () => {
        /* The hard privacy line for this product. Checked as text because
           the failure mode is somebody adding a field for analytics. */
        const src = read('functions/api/create-checkout-session.js');
        for (const term of ['progress_checkins', 'photo', 'assessment', 'measurement',
            'erection', 'sessionLog', 'persisted']) {
            expect(src, `checkout session may send ${term} to Stripe`)
                .not.toMatch(new RegExp(`metadata\\[[^\\]]*${term}`, 'i'));
        }
        /* The only metadata is a product tag. */
        const meta = [...src.matchAll(/metadata\[([^\]]+)\]/g)].map(m => m[1]);
        expect(meta).toEqual(['product']);
    });
});

describe('the handler is configured to fail closed', () => {
    const src = () => read('functions/api/stripe-webhook.js');

    test('MISSING SECRETS REFUSE THE REQUEST', () => {
        expect(src()).toMatch(/if \(!env\.STRIPE_WEBHOOK_SECRET\)/);
        expect(src()).toMatch(/if \(!env\.SUPABASE_URL \|\| !env\.SUPABASE_SERVICE_ROLE_KEY\)/);
        expect(src()).toMatch(/Service unavailable/);
    });

    test('THE BODY IS READ ONCE AND VERIFIED BEFORE IT IS PARSED', () => {
        /* Measured inside onRequestPost. Searching the whole file would
           find the verifySignature DEFINITION, which sits above the handler,
           and the ordering assertion would pass for the wrong reason. */
        const whole = src();
        const handler = whole.slice(whole.indexOf('export async function onRequestPost'));
        const readAt = handler.indexOf('await request.text()');
        const verifyAt = handler.indexOf('await verifySignature(');
        const parseAt = handler.indexOf('JSON.parse(rawBody)');
        expect(readAt, 'the handler never reads the raw body').toBeGreaterThan(-1);
        expect(verifyAt, 'the handler never verifies a signature').toBeGreaterThan(-1);
        expect(parseAt, 'the handler never parses the raw body').toBeGreaterThan(-1);
        expect(verifyAt, 'the signature is checked before the body is read')
            .toBeGreaterThan(readAt);
        expect(parseAt, 'the body is parsed before the signature is checked')
            .toBeGreaterThan(verifyAt);
    });

    test('LIVEMODE IS CHECKED, SO A TEST EVENT CANNOT GRANT LIVE ACCESS', () => {
        expect(src()).toMatch(/event\.livemode/);
        expect(src()).toMatch(/STRIPE_LIVEMODE/);
        expect(src()).toMatch(/livemode mismatch/);
    });

    test('A DUPLICATE EVENT IS ANSWERED 200 AND DOES NOTHING', () => {
        /* A non-2xx makes Stripe retry an event that was already handled. */
        expect(src()).toMatch(/firstSight/);
        expect(src()).toMatch(/duplicate event/);
    });

    test('a failed replay gate returns 500 so Stripe retries', () => {
        /* The safe direction: a repeat delivery against a working gate beats
           a purchase silently dropped. */
        expect(src()).toMatch(/replay gate failed/);
        expect(src()).toMatch(/Internal error/);
    });

    test('USER_ID IS NEVER SENT ON THE MEMBERS UPSERT', () => {
        /* The rule the Ko-fi handler documents: merge-duplicates would
           overwrite an identity a claim had already attached, and a repeat
           purchase would move a live entitlement to another account. */
        const s = src();
        /* Slice to the function's own closing brace. Slicing to the next
           function name swallowed attachUid's doc comment, which mentions
           user_id, and the test failed on a comment rather than on code. */
        const from = s.indexOf('async function upsertMember');
        const fn = s.slice(from, s.indexOf('\n}', from) + 2);
        expect(fn).toMatch(/resolution=merge-duplicates/);
        expect(fn, 'the upsert body mentions user_id').not.toMatch(/user_id/);
    });

    test('THE ATTACH CANNOT STEAL AN OWNED OR REVOKED ENTITLEMENT', () => {
        const s = src();
        const fn = s.slice(s.indexOf('async function attachUid'),
            s.indexOf('async function findSoleAuthUser'));
        expect(fn).toMatch(/user_id=is\.null/);
        expect(fn).toMatch(/revoked_at=is\.null/);
    });

    test('auto-attach by address requires exactly one CONFIRMED user', () => {
        const s = src();
        const fn = s.slice(s.indexOf('async function findSoleAuthUser'),
            s.indexOf('async function resolvePurchase'));
        expect(fn).toMatch(/email_confirmed_at \|\| u\.confirmed_at/);
        expect(fn).toMatch(/exact\.length === 1/);
    });

    test('A PARTIAL REFUND DOES NOT REVOKE ACCESS', () => {
        /* A goodwill refund of part of the price must not cut someone off,
           and guessing a threshold in a webhook is how that goes wrong. */
        expect(src()).toMatch(/amount_refunded === obj\.amount/);
        expect(src()).toMatch(/PARTIAL refund, access left in place/);
    });

    test('REVOCATION GOES THROUGH revoke_if_unpaid, NEVER A DIRECT UPDATE', () => {
        /* The multiple-purchase rule lives in one place. A handler that
           cleared user_id itself would revoke a man who bought twice and
           refunded once. */
        const s = src();
        expect(s).toMatch(/revoke_if_unpaid/);
        expect(s, 'the handler clears user_id directly somewhere')
            .not.toMatch(/user_id:\s*null/);
    });

    test('a won dispute restores through restore_if_paid and re-claims', () => {
        expect(src()).toMatch(/restore_if_paid/);
        expect(src()).toMatch(/dispute won/);
    });

    test('an unhandled event type is accepted and ignored', () => {
        expect(src()).toMatch(/default:/);
        expect(src()).toMatch(/not handled/);
    });

    test('GET does nothing', () => {
        expect(src()).toMatch(/export async function onRequestGet/);
        const fn = src().slice(src().indexOf('export async function onRequestGet'));
        expect(fn).not.toMatch(/fetch\(/);
    });
});

describe('the session endpoint keeps the secret key and identity server-side', () => {
    const src = () => read('functions/api/create-checkout-session.js');

    test('THE UID COMES FROM A VERIFIED TOKEN, NEVER FROM THE REQUEST BODY', () => {
        /* client_reference_id decides which account an entitlement attaches
           to. A caller who could name it could attach somebody else's
           purchase to their own account. */
        const s = src();
        expect(s).toMatch(/auth\/v1\/user/);
        expect(s).toMatch(/MUST NEVER SUPPLY THE UID/);
        expect(s, 'the endpoint reads a uid out of the request body')
            .not.toMatch(/request\.json\(\)|body\.uid|body\.user_id/);
    });

    test('the secret key is read from env and never returned to the browser', () => {
        const s = src();
        expect(s).toMatch(/env\.STRIPE_SECRET_KEY/);
        /* Only the client secret for the embedded form goes back. */
        expect(s).toMatch(/clientSecret: data\.client_secret/);
        expect(s, 'the secret key could reach a response')
            .not.toMatch(/json\([^)]*STRIPE_SECRET_KEY/);
    });

    test('an upstream error body is not echoed to the browser', () => {
        expect(src()).toMatch(/Checkout is unavailable right now/);
        expect(src(), 'the upstream body is returned to the caller')
            .not.toMatch(/return json\(data/);
    });

    test('the Stripe API version is pinned', () => {
        /* So a Stripe-side default change cannot alter the payload shape the
           webhook parses. */
        expect(src()).toMatch(/'Stripe-Version':\s*'[\d-]+\.\w+'/);
    });
});

describe('secrets stay out of the repository and off the website', () => {
    test('NO STRIPE KEY IS COMMITTED ANYWHERE', () => {
        for (const f of ['functions/api/stripe-webhook.js',
            'functions/api/create-checkout-session.js', 'wrangler.jsonc',
            'index.html', 'app/index.html']) {
            const s = read(f);
            expect(s, `${f} contains a live secret key`).not.toMatch(/sk_live_[A-Za-z0-9]/);
            expect(s, `${f} contains a test secret key`).not.toMatch(/sk_test_[A-Za-z0-9]{10}/);
            expect(s, `${f} contains a webhook signing secret`)
                .not.toMatch(/whsec_[A-Za-z0-9]{16}/);
        }
    });

    test('wrangler.jsonc declares no Stripe vars, since it is committed', () => {
        const w = read('wrangler.jsonc');
        expect(w).not.toMatch(/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/);
    });

    test('the handlers are not served as website assets', () => {
        const ignore = read('.assetsignore').split('\n').map(l => l.trim());
        expect(ignore).toContain('functions');
    });
});
