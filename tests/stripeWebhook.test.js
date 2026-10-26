import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __test as hook, onRequestPost } from '../functions/api/stripe-webhook.js';
import { onRequestPost as createSession } from '../functions/api/create-checkout-session.js';

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

    test('AN EVENT IS MARKED DONE ONLY AFTER THE WORK FINISHES', () => {
        /* The bug this guards. The first version inserted the event id and
           treated that as handled, so a later failure left the event marked
           seen: Stripe retried, the handler read a duplicate, answered 200,
           and the purchase was dropped with the money taken. */
        const whole = src();
        expect(whole).toMatch(/async function claimEvent/);
        expect(whole).toMatch(/async function completeEvent/);
        expect(whole).toMatch(/async function failEvent/);
        expect(whole, 'the old insert-means-handled gate is back')
            .not.toMatch(/firstSight/);

        /* completeEvent must be reachable only through finish(), so there is
           one place an event becomes done. */
        const handler = whole.slice(whole.indexOf('export async function onRequestPost'));
        const calls = [...handler.matchAll(/completeEvent\(/g)].length;
        expect(calls, 'completeEvent is called from more than one place').toBe(1);
        expect(handler).toMatch(/const finish = async \(reason\) => \{/);
    });

    test('A COMPLETED EVENT IS SKIPPED, AN UNFINISHED ONE IS RETRIED', () => {
        const whole = src();
        expect(whole).toMatch(/if \(claim === 'done'\)/);
        expect(whole).toMatch(/if \(claim === 'retry'\)/);
        expect(whole).toMatch(/already completed/);
        /* The retry path is logged at error level, because it means an
           earlier attempt took the money and did not finish. */
        expect(whole).toMatch(/console\.error\(`Stripe: RETRYING/);
    });

    test('A FAILURE LEAVES THE EVENT RETRYABLE AND RETURNS 500', () => {
        const whole = src();
        const tail = whole.slice(whole.lastIndexOf('} catch (e) {'));
        expect(tail).toMatch(/failEvent\(env, event\.id/);
        expect(tail).toMatch(/Internal error/);
        /* failEvent must not flip the row to done. */
        const fn = whole.slice(whole.indexOf('async function failEvent'),
            whole.indexOf('/* ── Supabase'));
        expect(fn, 'failEvent marks the event done').not.toMatch(/status: 'done'/);
    });

    test('and the idempotency the retry relies on is written down', () => {
        /* A retry proceeding is only safe because every write is idempotent.
           If that audit is deleted, the next person has no way to know the
           retry is safe, so the comment is load bearing. */
        const whole = src();
        expect(whole).toMatch(/every write this handler\s*\n \* makes is idempotent/);
        for (const op of ['purchases insert', 'members upsert', 'attachUid PATCH',
            'revoke_if_unpaid', 'restore_if_paid']) {
            expect(whole, `the idempotency audit does not cover ${op}`).toContain(op);
        }
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
        expect(src()).toMatch(/obj\.amount_refunded !== obj\.amount/);
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

    /* THE API VERSION IS CONFIGURABLE, NEVER A HARDCODED PIN.
     *
     * It was pinned to a literal version. If the account cannot serve that
     * version, every call fails and checkout is dead, so the pin is now
     * optional: the header is sent only when STRIPE_API_VERSION is set, and
     * otherwise the account's own default applies. The fields these handlers
     * read have been stable across versions for years, which is why omitting
     * it is safe.
     *
     * Asserted on the headers Stripe actually receives, not on the source
     * text. A regex over the file passed happily while a second, hardcoded
     * header sat in another call site, which is the whole failure mode here.
     */
    const headersOf = (calls, match) => {
        const call = calls.find(c => c.url.includes(match));
        expect(call, `no request to ${match}`).toBeTruthy();
        return new Headers(call.headers || {});
    };

    const runSession = async (env) => {
        const calls = [];
        const real = globalThis.fetch;
        globalThis.fetch = async (url, opts = {}) => {
            calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers });
            const ok = (j) => new Response(JSON.stringify(j),
                { status: 200, headers: { 'content-type': 'application/json' } });
            if (String(url).includes('/v1/prices/')) {
                return ok({ unit_amount: 9900, currency: 'usd', active: true, type: 'one_time' });
            }
            return ok({ client_secret: 'cs_secret_value' });
        };
        try {
            await createSession({
                request: new Request('https://theblueprint.site/api/create-checkout-session',
                    { method: 'POST' }),
                env,
            });
            return calls;
        } finally { globalThis.fetch = real; }
    };

    const SESSION_ENV = {
        STRIPE_SECRET_KEY: 'sk_test_value',
        STRIPE_PRICE_ID: 'price_configured',
        STRIPE_PRICE_CENTS: '9900',
        STRIPE_CURRENCY: 'usd',
    };

    test('NO VERSION IS SENT WHEN NONE IS CONFIGURED', async () => {
        const calls = await runSession(SESSION_ENV);
        for (const match of ['/v1/prices/', '/v1/checkout/sessions']) {
            expect(headersOf(calls, match).get('Stripe-Version'),
                `${match} pinned a version the account may not serve`).toBeNull();
        }
    });

    test('and the configured version is the one sent, verbatim', async () => {
        const calls = await runSession({ ...SESSION_ENV, STRIPE_API_VERSION: '2099-01-01.test' });
        for (const match of ['/v1/prices/', '/v1/checkout/sessions']) {
            expect(headersOf(calls, match).get('Stripe-Version')).toBe('2099-01-01.test');
        }
    });

    const runWebhook = async (env) => {
        const calls = [];
        const real = globalThis.fetch;
        globalThis.fetch = async (url, opts = {}) => {
            const u = String(url);
            calls.push({ url: u, method: opts.method || 'GET', headers: opts.headers });
            const ok = (status, j) => new Response(status === 204 ? null : JSON.stringify(j),
                { status, headers: { 'content-type': 'application/json' } });
            if (u.includes('/line_items')) {
                return ok(200, { data: [{ price: { id: 'price_configured' }, quantity: 1 }] });
            }
            if (u.includes('/rest/v1/payment_events')) {
                return (opts.method || 'GET') === 'POST' ? ok(201, [{ id: 'e' }]) : ok(204);
            }
            if (u.includes('/rest/v1/')) return ok(201, []);
            return ok(200, {});
        };
        const body = JSON.stringify({
            id: 'evt_ver_' + Math.random().toString(36).slice(2),
            type: 'checkout.session.completed', livemode: false,
            data: { object: paidSession({ id: 'cs_ver' }) },
        });
        const { header } = await sign(body);
        try {
            await onRequestPost({
                request: new Request('https://theblueprint.site/api/stripe-webhook', {
                    method: 'POST', headers: { 'Stripe-Signature': header }, body,
                }),
                env,
            });
            return calls;
        } finally { globalThis.fetch = real; }
    };

    const WEBHOOK_ENV = {
        ...SESSION_ENV,
        STRIPE_WEBHOOK_SECRET: SECRET,
        STRIPE_LIVEMODE: 'false',
        SUPABASE_URL: 'https://stub.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-stub',
    };

    test('and the webhook reads it the same way', async () => {
        const unset = await runWebhook(WEBHOOK_ENV);
        expect(headersOf(unset, '/line_items').get('Stripe-Version'),
            'the webhook pinned a version the account may not serve').toBeNull();

        const set = await runWebhook({ ...WEBHOOK_ENV, STRIPE_API_VERSION: '2099-01-01.test' });
        expect(headersOf(set, '/line_items').get('Stripe-Version')).toBe('2099-01-01.test');
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

/**
 * THE HANDLER ITSELF, DRIVEN.
 *
 * Everything above this point tests the helpers as pure functions. A
 * mutation run proved that is not enough: deleting the signature check from
 * the handler, swapping the constant-time comparison for ===, and deleting
 * the livemode check all left the suite green, because the helpers were
 * still correct and still called. Only their RESULT had stopped mattering.
 *
 * So these tests call onRequestPost with a real signed request and a stubbed
 * fetch, and assert on what reached Supabase. A rejected request must make
 * NO Supabase call at all, which is the property that cannot be faked by a
 * helper that still exists.
 */
describe('onRequestPost, end to end against a stubbed Supabase', () => {
    const ENV_FULL = {
        STRIPE_WEBHOOK_SECRET: SECRET,
        STRIPE_SECRET_KEY: 'sk_test_value',
        STRIPE_PRICE_ID: 'price_test_value',
        SUPABASE_URL: 'https://stub.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-stub',
        STRIPE_PRICE_CENTS: '9900',
        STRIPE_CURRENCY: 'usd',
        STRIPE_LIVEMODE: 'false',
    };

    /** Records every outbound call and answers the ones the handler makes. */
    /**
     * @param eventState  what the payment_events row already holds:
     *                    'absent' (first delivery), 'done' (finished before),
     *                    or 'processing' (an earlier attempt did not finish)
     * @param failOn      a substring; the first request whose URL matches it
     *                    fails once, to model a partial failure
     */
    function stubFetch({ eventState = 'absent', purchaseEmail = 'buyer@example.com',
        revokeVerdict = 'revoked', failOn = null,
        /* What the ledger already holds for this reference. null means the
           transaction has never been seen; an object models an event that
           arrived out of order. */
        existingPurchase = null,
        /* What Stripe says the session bought. The default is the configured
           Price, quantity one. */
        lineItems = [{ price: { id: 'price_test_value' }, quantity: 1 }],
        /* What resolvePurchase finds. null models a refund whose completion
           has not arrived. */
        resolveFinds = true } = {}) {
        const calls = [];
        const real = globalThis.fetch;
        let failed = false;
        globalThis.fetch = async (url, opts = {}) => {
            const u = String(url);
            const method = opts.method || 'GET';
            calls.push({ url: u, method, body: opts.body });
            /* 204 and 304 must carry a null body or the Response constructor
               throws, which looked like a handler bug the first time. */
            const ok = (status, json) => new Response(
                (status === 204 || status === 304) ? null
                    : (json === undefined ? '' : JSON.stringify(json)),
                { status, headers: { 'content-type': 'application/json' } });

            if (failOn && !failed && u.includes(failOn) && method === 'POST') {
                failed = true;
                return ok(500, { message: 'simulated database failure' });
            }

            if (u.includes('/rest/v1/payment_events')) {
                if (method === 'POST') {
                    return eventState === 'absent'
                        ? ok(201, [{ id: 'evt' }])
                        : ok(409, { code: '23505' });
                }
                if (method === 'GET') {
                    return ok(200, [{ status: eventState === 'done' ? 'done' : 'processing',
                        attempts: 1 }]);
                }
                return ok(204);
            }
            if (u.includes('/rest/v1/purchases') && method === 'PATCH') {
                /* resolvePurchase returns the address it marked, or nothing
                   when the completion has not arrived yet. */
                if (u.includes('provider_ref=eq.')) {
                    return ok(200, resolveFinds ? [{ email: purchaseEmail }] : []);
                }
                return ok(204);                       // the email backfill
            }
            if (u.includes('/rest/v1/purchases') && method === 'GET') {
                return ok(200, existingPurchase ? [existingPurchase] : []);
            }
            if (u.includes('/rest/v1/purchases')) {
                return existingPurchase ? ok(409, { code: '23505' }) : ok(201, []);
            }
            if (u.includes('/rest/v1/members')) return ok(201, []);
            /* Stripe's own API: the line-item read that proves which Price
               was bought. */
            if (u.includes('api.stripe.com') && u.includes('/line_items')) {
                return ok(200, { data: lineItems });
            }
            if (u.includes('/rest/v1/rpc/revoke_if_unpaid')) return ok(200, revokeVerdict);
            if (u.includes('/rest/v1/rpc/')) return ok(200, true);
            if (u.includes('/auth/v1/admin/users')) return ok(200, []);
            return ok(200, {});
        };
        return { calls, restore: () => { globalThis.fetch = real; } };
    }

    const post = async (rawBody, header, env = ENV_FULL) => onRequestPost({
        request: new Request('https://theblueprint.site/api/stripe-webhook', {
            method: 'POST',
            headers: header ? { 'Stripe-Signature': header } : {},
            body: rawBody,
        }),
        env,
    });

    const event = (type, object, over = {}) => JSON.stringify({
        id: 'evt_test_' + Math.random().toString(36).slice(2),
        type, livemode: false, data: { object }, ...over,
    });

    const supabaseCalls = (calls) => calls.filter(c => c.url.includes('stub.supabase.co'));

    test('A VALID SIGNED PURCHASE RECORDS A PURCHASE AND AN ENTITLEMENT', async () => {
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            const res = await post(body, header);
            expect(res.status).toBe(200);
            const urls = f.calls.map(c => `${c.method} ${c.url}`);
            expect(urls.some(u => u.includes('payment_events'))).toBe(true);
            expect(urls.some(u => u.includes('POST') && u.includes('/purchases'))).toBe(true);
            expect(urls.some(u => u.includes('POST') && u.includes('/members'))).toBe(true);
        } finally { f.restore(); }
    });

    test('AN INVALID SIGNATURE MAKES NO SUPABASE CALL WHATSOEVER', async () => {
        /* The mutation this exists for: deleting the handler's use of the
           verdict while leaving verifySignature in place. */
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body, { secret: 'whsec_not_the_real_secret_x' });
        const f = stubFetch();
        try {
            const res = await post(body, header);
            expect(res.status).toBe(401);
            expect(supabaseCalls(f.calls), 'a rejected request still touched Supabase')
                .toEqual([]);
        } finally { f.restore(); }
    });

    test('A TAMPERED BODY MAKES NO SUPABASE CALL', async () => {
        const original = event('checkout.session.completed', paidSession());
        const { header } = await sign(original);
        const tampered = event('checkout.session.completed',
            paidSession({ customer_details: { email: 'attacker@example.com' } }));
        const f = stubFetch();
        try {
            expect((await post(tampered, header)).status).toBe(401);
            expect(supabaseCalls(f.calls)).toEqual([]);
        } finally { f.restore(); }
    });

    test('A STALE SIGNATURE MAKES NO SUPABASE CALL', async () => {
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body, { ts: Math.floor(Date.now() / 1000) - 3600 });
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(401);
            expect(supabaseCalls(f.calls)).toEqual([]);
        } finally { f.restore(); }
    });

    test('A MISSING SIGNATURE HEADER MAKES NO SUPABASE CALL', async () => {
        const body = event('checkout.session.completed', paidSession());
        const f = stubFetch();
        try {
            expect((await post(body, null)).status).toBe(401);
            expect(supabaseCalls(f.calls)).toEqual([]);
        } finally { f.restore(); }
    });

    test('A TEST EVENT AGAINST LIVE CONFIG IS REFUSED AND WRITES NOTHING', async () => {
        /* The mutation this exists for: deleting the livemode comparison.
           The event is correctly signed, so only the livemode check stands
           between a test purchase and a live entitlement. */
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            const res = await post(body, header, { ...ENV_FULL, STRIPE_LIVEMODE: 'true' });
            expect(res.status).toBe(401);
            expect(supabaseCalls(f.calls), 'a test event reached a live database')
                .toEqual([]);
        } finally { f.restore(); }
    });

    test('and a live event against test config is refused the same way', async () => {
        const body = event('checkout.session.completed', paidSession(), { livemode: true });
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(401);
            expect(supabaseCalls(f.calls)).toEqual([]);
        } finally { f.restore(); }
    });

    test('MISSING CONFIG REFUSES AND WRITES NOTHING', async () => {
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        for (const env of [
            { ...ENV_FULL, STRIPE_WEBHOOK_SECRET: undefined },
            { ...ENV_FULL, SUPABASE_URL: undefined },
            { ...ENV_FULL, SUPABASE_SERVICE_ROLE_KEY: undefined },
        ]) {
            const f = stubFetch();
            try {
                expect((await post(body, header, env)).status).toBe(503);
                expect(supabaseCalls(f.calls)).toEqual([]);
            } finally { f.restore(); }
        }
    });

    test('A DUPLICATE EVENT IS 200 AND GRANTS NOTHING A SECOND TIME', async () => {
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch({ eventState: 'done' });
        try {
            const res = await post(body, header);
            expect(res.status).toBe(200);
            const urls = f.calls.map(c => `${c.method} ${c.url}`);
            expect(urls.some(u => u.includes('/members')),
                'a replayed event wrote an entitlement').toBe(false);
            expect(urls.some(u => u.includes('POST') && u.includes('/purchases')),
                'a replayed event wrote a purchase').toBe(false);
        } finally { f.restore(); }
    });

    test('THE WRONG AMOUNT IS 200 AND GRANTS NOTHING', async () => {
        const body = event('checkout.session.completed',
            paidSession({ amount_subtotal: 100, amount_total: 100 }));
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            const res = await post(body, header);
            expect(res.status).toBe(200);
            expect(f.calls.some(c => c.url.includes('/members')),
                'a $1 payment granted access').toBe(false);
        } finally { f.restore(); }
    });

    test('a session with no usable email grants nothing', async () => {
        const s = paidSession({ customer_details: null });
        delete s.customer_email;
        const body = event('checkout.session.completed', s);
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(200);
            expect(f.calls.some(c => c.url.includes('/members'))).toBe(false);
        } finally { f.restore(); }
    });

    test('A PARTIAL REFUND DOES NOT CALL revoke_if_unpaid', async () => {
        const body = event('charge.refunded', {
            id: 'ch_1', payment_intent: 'pi_test_1', amount: 9900, amount_refunded: 2000,
        });
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(200);
            expect(f.calls.some(c => c.url.includes('revoke_if_unpaid')),
                'a partial refund revoked access').toBe(false);
        } finally { f.restore(); }
    });

    test('A FULL REFUND MARKS THE LEDGER AND CALLS revoke_if_unpaid', async () => {
        const body = event('charge.refunded', {
            id: 'ch_1', payment_intent: 'pi_test_1', amount: 9900, amount_refunded: 9900,
        });
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(200);
            const urls = f.calls.map(c => `${c.method} ${c.url}`);
            expect(urls.some(u => u.startsWith('PATCH') && u.includes('/purchases'))).toBe(true);
            expect(urls.some(u => u.includes('revoke_if_unpaid'))).toBe(true);
        } finally { f.restore(); }
    });

    test('A WON DISPUTE RESTORES THROUGH restore_if_paid', async () => {
        const body = event('charge.dispute.closed', {
            id: 'dp_1', payment_intent: 'pi_test_1', status: 'won',
        });
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(200);
            expect(f.calls.some(c => c.url.includes('restore_if_paid'))).toBe(true);
        } finally { f.restore(); }
    });

    test('a lost dispute restores nothing', async () => {
        const body = event('charge.dispute.closed', {
            id: 'dp_1', payment_intent: 'pi_test_1', status: 'lost',
        });
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(200);
            expect(f.calls.some(c => c.url.includes('restore_if_paid'))).toBe(false);
        } finally { f.restore(); }
    });

    test('an expired session writes nothing', async () => {
        const body = event('checkout.session.expired', { id: 'cs_1' });
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            expect((await post(body, header)).status).toBe(200);
            const urls = f.calls.map(c => c.url);
            expect(urls.some(u => u.includes('/members'))).toBe(false);
            expect(urls.some(u => u.includes('/purchases'))).toBe(false);
        } finally { f.restore(); }
    });

    test('PARTIAL FAILURE THEN RETRY: ACCESS IS GRANTED, NOT LOST', async () => {
        /* THE BUG THIS EXISTS FOR.
           The purchase records, the entitlement write fails, the handler
           returns 500. In the first version the event was already marked
           seen, so Stripe's retry read a duplicate, answered 200, and the
           customer was left paid-up with no access and nothing logged.
           Here: attempt one fails and marks nothing done, attempt two
           finishes the job. */
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);

        // Attempt one. The members upsert fails.
        const first = stubFetch({ failOn: '/rest/v1/members' });
        let firstCalls;
        try {
            const res = await post(body, header);
            expect(res.status, 'a failed entitlement write did not return 500').toBe(500);
            firstCalls = first.calls;
        } finally { first.restore(); }

        const bodies = firstCalls.filter(c => c.url.includes('payment_events'))
            .map(c => String(c.body || ''));
        expect(firstCalls.some(c => c.url.includes('/purchases') && c.method === 'POST'),
            'the purchase was not recorded before the failure').toBe(true);
        expect(bodies.some(b => b.includes('"status":"done"')),
            'THE EVENT WAS MARKED DONE DESPITE FAILING, which drops the purchase')
            .toBe(false);
        expect(firstCalls.some(c => c.url.includes('payment_events') && c.method === 'PATCH'
            && String(c.body || '').includes('last_error')),
            'the failure was not recorded for diagnosis').toBe(true);

        // Attempt two. Stripe retries; the row is still 'processing'.
        const second = stubFetch({ eventState: 'processing' });
        try {
            const res = await post(body, header);
            expect(res.status, 'the retry did not succeed').toBe(200);
            const urls = second.calls.map(c => `${c.method} ${c.url}`);
            expect(urls.some(u => u.includes('POST') && u.includes('/members')),
                'THE RETRY DID NOT GRANT ACCESS').toBe(true);
            expect(second.calls.some(c => c.url.includes('payment_events')
                && String(c.body || '').includes('"status":"done"')),
                'the retry did not mark the event done').toBe(true);
        } finally { second.restore(); }
    });

    test('PARTIAL FAILURE ON THE REFUND PATH ALSO RECOVERS', async () => {
        /* Same shape, the other direction: the ledger is marked refunded and
           the revocation call fails. A retry must finish revoking rather
           than leaving a refunded purchase with live access. */
        const refund = { id: 'ch_1', payment_intent: 'pi_test_1', amount: 9900, amount_refunded: 9900 };
        const body = event('charge.refunded', refund);
        const { header } = await sign(body);

        const first = stubFetch({ failOn: '/rest/v1/rpc/' });
        try {
            expect((await post(body, header)).status).toBe(500);
            expect(first.calls.some(c => c.url.includes('payment_events')
                && String(c.body || '').includes('"status":"done"')),
                'the refund event was marked done despite failing').toBe(false);
        } finally { first.restore(); }

        const second = stubFetch({ eventState: 'processing' });
        try {
            expect((await post(body, header)).status).toBe(200);
            expect(second.calls.some(c => c.url.includes('revoke_if_unpaid')),
                'the retry did not revoke').toBe(true);
        } finally { second.restore(); }
    });

    test('A LEGACY ENTITLEMENT IS NEVER REVOKED BY A REFUND', async () => {
        /* Rule 2 of revoke_if_unpaid. Ko-fi payment history was never
           captured, so the ledger cannot speak for a pre-ledger member and
           does not get to end their access. The outcome is logged at error
           level so a human looks at it. */
        const body = event('charge.refunded', {
            id: 'ch_1', payment_intent: 'pi_test_1', amount: 9900, amount_refunded: 9900,
        });
        const { header } = await sign(body);
        const f = stubFetch({ revokeVerdict: 'kept_legacy' });
        try {
            const res = await post(body, header);
            expect(res.status, 'a legacy outcome was treated as a failure').toBe(200);
            expect(f.calls.some(c => c.url.includes('payment_events')
                && String(c.body || '').includes('"status":"done"'))).toBe(true);
        } finally { f.restore(); }
    });

    test('another standing purchase keeps access on a refund', async () => {
        const body = event('charge.refunded', {
            id: 'ch_1', payment_intent: 'pi_test_1', amount: 9900, amount_refunded: 9900,
        });
        const { header } = await sign(body);
        const f = stubFetch({ revokeVerdict: 'kept_paid' });
        try {
            expect((await post(body, header)).status).toBe(200);
        } finally { f.restore(); }
    });

    test('AN UNKNOWN REVOCATION VERDICT RETRIES RATHER THAN SHRUGS', async () => {
        /* If revoke_if_unpaid changes and the handler does not, the event
           goes back in the retry path instead of being marked done on a
           verdict nobody understood. */
        const body = event('charge.refunded', {
            id: 'ch_1', payment_intent: 'pi_test_1', amount: 9900, amount_refunded: 9900,
        });
        const { header } = await sign(body);
        const f = stubFetch({ revokeVerdict: 'something_new' });
        try {
            expect((await post(body, header)).status).toBe(500);
            expect(f.calls.some(c => c.url.includes('payment_events')
                && String(c.body || '').includes('"status":"done"'))).toBe(false);
        } finally { f.restore(); }
    });

    test('REPURCHASE AFTER REFUND RESTORES ACCESS', async () => {
        /* The bug: revoke_if_unpaid leaves revoked_at set, and both
           attachUid and claim_membership refuse a revoked row. So without
           clearing it, a man who was refunded and bought again would pay and
           stay locked out of the thing he just bought twice.
           restore_if_paid is used rather than clearing it here, because it
           counts paid rows in the ledger first: the decision rests on
           verified payment state, not on this event's arrival. */
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            const res = await post(body, header);
            expect(res.status).toBe(200);
            const urls = f.calls.map(c => c.url);
            expect(urls.some(u => u.includes('restore_if_paid')),
                'a new purchase did not clear a previous revocation').toBe(true);
            /* ORDER MATTERS, in four steps, and each boundary is load
               bearing:
                 1. the purchase is recorded, so restore_if_paid has a paid
                    row to count
                 2. the member row is upserted, so there is a row to unmark
                 3. restore_if_paid clears revoked_at
                 4. the attach runs, which filters revoked_at=is.null and
                    would reject the row if it ran before step 3
               My first version of this assertion had 3 before 2 and failed,
               which is the assertion being wrong rather than the code. */
            const idx = (pred) => f.calls.findIndex(pred);
            const purchase = idx(c => c.method === 'POST' && c.url.includes('/purchases'));
            const upsert = idx(c => c.method === 'POST' && c.url.includes('/rest/v1/members'));
            const restore = idx(c => c.url.includes('restore_if_paid'));
            const attach = idx(c => c.method === 'PATCH' && c.url.includes('/rest/v1/members'));

            expect(purchase, 'no purchase recorded').toBeGreaterThan(-1);
            expect(upsert, 'no member upsert').toBeGreaterThan(-1);
            expect(restore, 'no restore_if_paid').toBeGreaterThan(-1);

            expect(purchase).toBeLessThan(restore);
            expect(upsert).toBeLessThan(restore);
            if (attach > -1) {
                expect(restore, 'the attach ran before the revocation was cleared')
                    .toBeLessThan(attach);
            }
        } finally { f.restore(); }
    });

    test('THE MEMBER UPSERT CANNOT CLEAR pre_ledger OR revoked_at', async () => {
        /* The upsert is resolution=merge-duplicates, which updates exactly
           the columns in the payload. Sending only the address is what keeps
           a legacy member's protection and a revoked member's mark intact.
           Adding a field here for convenience would quietly strip both. */
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch();
        try {
            await post(body, header);
            const upsert = f.calls.find(c => c.method === 'POST'
                && c.url.includes('/rest/v1/members'));
            expect(upsert, 'no member upsert happened').toBeTruthy();
            const payload = JSON.parse(upsert.body);
            expect(Array.isArray(payload)).toBe(true);
            expect(Object.keys(payload[0]), 'the upsert sends more than the address')
                .toEqual(['email']);
        } finally { f.restore(); }
    });

    test('OUT OF ORDER: AN UNMATCHED REFUND IS RECORDED, NOT WAVED THROUGH', async () => {
        /* Stripe does not guarantee ordering. The previous version answered
           200 and forgot, so the completion that followed granted access to
           somebody whose money had already gone back. */
        const body = event('charge.refunded', {
            id: 'ch_1', payment_intent: 'pi_oops', amount: 9900, amount_refunded: 9900,
            billing_details: { email: 'buyer@example.com' }, currency: 'usd',
        });
        const { header } = await sign(body);
        const f = stubFetch({ resolveFinds: false });
        try {
            const res = await post(body, header);
            expect(res.status).toBe(200);
            const insert = f.calls.find(c => c.method === 'POST'
                && c.url.includes('/rest/v1/purchases'));
            expect(insert, 'the unmatched refund was not recorded').toBeTruthy();
            const row = JSON.parse(insert.body)[0];
            expect(row.provider_ref).toBe('pi_oops');
            expect(row.status).toBe('refunded');
            expect(row.resolved_at, 'the refund has no resolution time').toBeTruthy();
            expect(f.calls.some(c => c.url.includes('revoke_if_unpaid')),
                'it tried to revoke an entitlement it has not identified').toBe(false);
        } finally { f.restore(); }
    });

    test('OUT OF ORDER: A STALE COMPLETION AFTER A REFUND GRANTS NOTHING', async () => {
        /* The other half. The ledger already records this reference as
           refunded, so the completion must be refused however valid its
           signature and amount are. */
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch({
            existingPurchase: { id: 7, status: 'refunded', email: null },
        });
        try {
            const res = await post(body, header);
            expect(res.status, 'a refused completion should still be acknowledged').toBe(200);
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/rest/v1/members')),
                'A STALE COMPLETION GRANTED ACCESS AFTER A REFUND').toBe(false);
            expect(f.calls.some(c => c.url.includes('restore_if_paid')),
                'it cleared a revocation on a refunded transaction').toBe(false);
            /* The address is backfilled onto the refunded row, so
               revoke_if_unpaid can count this transaction for that address
               from now on. */
            expect(f.calls.some(c => c.method === 'PATCH'
                && c.url.includes('/rest/v1/purchases?id=eq.7')),
                'the refunded row was left without an address').toBe(true);
        } finally { f.restore(); }
    });

    test('a disputed transaction refuses a stale completion the same way', async () => {
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch({
            existingPurchase: { id: 9, status: 'disputed', email: 'buyer@example.com' },
        });
        try {
            expect((await post(body, header)).status).toBe(200);
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/rest/v1/members')))
                .toBe(false);
        } finally { f.restore(); }
    });

    test('an ordinary replay of a paid completion still grants, idempotently', async () => {
        /* The conflict path must not become a refusal for the common case of
           Stripe delivering the same completion twice. */
        const body = event('checkout.session.completed', paidSession());
        const { header } = await sign(body);
        const f = stubFetch({
            eventState: 'processing',
            existingPurchase: { id: 3, status: 'paid', email: 'buyer@example.com' },
        });
        try {
            expect((await post(body, header)).status).toBe(200);
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/rest/v1/members')),
                'a retried paid completion stopped granting access').toBe(true);
        } finally { f.restore(); }
    });

    test('verifySignature uses the constant-time comparison, not ===', () => {
        /* A mutation swapped it for === and every behavioural test still
           passed, because === is functionally correct and only the timing
           property differs. Timing cannot be asserted reliably in a unit
           test, so the use site is asserted instead. */
        const s = read('functions/api/stripe-webhook.js');
        const fn = s.slice(s.indexOf('async function verifySignature'),
            s.indexOf('/* ── Supabase'));
        expect(fn, 'verifySignature no longer uses constantTimeEqual')
            .toMatch(/constantTimeEqual\(candidate, expected\)/);
        expect(fn, 'verifySignature compares signatures with ===')
            .not.toMatch(/candidate === expected|expected === candidate/);
    });
});

/**
 * KO-FI DURING THE TRANSITION.
 *
 * Ko-fi stays live while Stripe is tested, so a buyer can arrive after the
 * ledger migration. Until this was fixed they got an entitlement with no
 * ledger row and, because pre_ledger defaults false for new rows, no legacy
 * protection either. A later Stripe refund would then count zero paid
 * purchases and end access they had paid for.
 */
describe('the Ko-fi handler keeps new buyers protected', () => {
    const src = () => read('functions/api/kofi-webhook.js');

    test('IT WRITES A REAL TRANSACTION TO THE LEDGER', () => {
        const s = src();
        expect(s).toMatch(/async function recordKofiPurchase/);
        expect(s).toMatch(/rest\/v1\/purchases/);
        expect(s).toMatch(/provider: 'kofi'/);
        /* The reference is Ko-fi's own, from the payload. */
        expect(s).toMatch(/body\.kofi_transaction_id/);
        expect(s).toMatch(/body\.message_id/);
    });

    test('AND IT INVENTS NOTHING WHEN THE PAYLOAD IS THIN', () => {
        const s = src();
        const fn = s.slice(s.indexOf('async function recordKofiPurchase'),
            s.indexOf('async function markOutsideLedger'));
        /* No reference means no row, rather than a made-up one that would
           collide across purchases. */
        expect(fn).toMatch(/if \(!ref\) return false;/);
        /* An unparseable amount is left null rather than guessed. */
        expect(fn).toMatch(/Number\.isFinite\(parsed\) \? Math\.round\(parsed \* 100\) : null/);
        expect(fn, 'a date is fabricated for the ledger row').not.toMatch(/created_at/);
    });

    test('THE FALLBACK PROTECTS RATHER THAN REVOKES', () => {
        const s = src();
        const fn = s.slice(s.indexOf('async function markOutsideLedger'),
            s.indexOf('/* Compared in constant time'));
        expect(fn).toMatch(/pre_ledger: true/);
        expect(fn).toMatch(/pre_ledger=eq\.false/);
        /* It must not write anything else, least of all to the entitlement
           itself. */
        const payload = fn.match(/JSON\.stringify\(\{([^}]*)\}\)/);
        expect(payload).not.toBeNull();
        expect(payload[1].trim()).toBe('pre_ledger: true');
    });

    test('NEITHER FAILURE CAN MAKE KO-FI RETRY A RECORDED PURCHASE', () => {
        /* The entitlement is already written by the time these run. A throw
           here would return 500 and Ko-fi would redeliver a purchase that
           has in fact been granted. */
        const s = src();
        const block = s.slice(s.indexOf('const recorded = await recordKofiPurchase'));
        const tail = block.slice(0, block.indexOf('\n  }'));
        expect(tail).toMatch(/catch \(e\)/);
        expect(tail).toMatch(/catch \(e2\)/);
        expect(tail, 'a ledger failure rethrows and fails the webhook')
            .not.toMatch(/throw/);
    });

    test('THE KO-FI MEMBER UPSERT STILL SENDS ONLY THE ADDRESS', () => {
        /* resolution=merge-duplicates updates exactly the payload columns.
           Adding a field here would strip pre_ledger from an existing
           member, which is the accidental clearing to guard against. */
        const s = src();
        const fn = s.slice(s.indexOf('async function upsertMember'));
        /* Comments stripped first. The STEP 1 comment explains why user_id
           is deliberately absent, so asserting on the raw text fails on the
           explanation rather than on the code. Third time this pattern has
           caught me in this session. */
        const body = fn.slice(0, fn.indexOf('STEP 2'))
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(body).toMatch(/resolution=merge-duplicates/);
        expect(body).toMatch(/JSON\.stringify\(\[\{ email \}\]\)/);
        expect(body, 'the Ko-fi upsert sends pre_ledger and would clear it')
            .not.toMatch(/pre_ledger/);
        expect(body, 'the Ko-fi upsert sends user_id').not.toMatch(/user_id/);
    });

    test('and the ledger write happens after the entitlement, not instead of it', () => {
        const s = src();
        const upsertAt = s.indexOf('await upsertMember(email, env.SUPABASE_URL');
        const ledgerAt = s.indexOf('const recorded = await recordKofiPurchase');
        expect(upsertAt).toBeGreaterThan(-1);
        expect(ledgerAt).toBeGreaterThan(upsertAt);
    });
});

/**
 * A PRICE CHANGE MUST NOT WIDEN WHAT COUNTS AS A PAID PURCHASE.
 *
 * Pricing is managed from the Stripe dashboard. Changing a Price there
 * changes neither STRIPE_PRICE_CENTS, nor STRIPE_PRICE_ID, nor the figure on
 * the website. Those are four independent values and every disagreement
 * between them must refuse access rather than grant it.
 */
describe('price changes cannot bypass the paid-purchase check', () => {
    const ENV = {
        STRIPE_WEBHOOK_SECRET: SECRET,
        STRIPE_SECRET_KEY: 'sk_test_value',
        STRIPE_PRICE_ID: 'price_configured',
        STRIPE_PRICE_CENTS: '9900',
        STRIPE_CURRENCY: 'usd',
        STRIPE_LIVEMODE: 'false',
        SUPABASE_URL: 'https://stub.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-stub',
    };

    const stub = ({ items, failLineItems = false }) => {
        const calls = [];
        const real = globalThis.fetch;
        globalThis.fetch = async (url, opts = {}) => {
            const u = String(url);
            calls.push({ url: u, method: opts.method || 'GET' });
            const ok = (status, json) => new Response(
                status === 204 ? null : JSON.stringify(json),
                { status, headers: { 'content-type': 'application/json' } });
            if (u.includes('api.stripe.com') && u.includes('/line_items')) {
                return failLineItems ? ok(500, {}) : ok(200, { data: items });
            }
            if (u.includes('/rest/v1/payment_events')) {
                if ((opts.method || 'GET') === 'POST') return ok(201, [{ id: 'e' }]);
                return ok(204);
            }
            if (u.includes('/rest/v1/')) return ok(201, []);
            return ok(200, {});
        };
        return { calls, restore: () => { globalThis.fetch = real; } };
    };

    const send = async (env = ENV) => {
        const body = JSON.stringify({
            id: 'evt_price_' + Math.random().toString(36).slice(2),
            type: 'checkout.session.completed', livemode: false,
            data: { object: paidSession({ id: 'cs_price' }) },
        });
        const { header } = await sign(body);
        return {
            body,
            res: await onRequestPost({
                request: new Request('https://theblueprint.site/api/stripe-webhook', {
                    method: 'POST', headers: { 'Stripe-Signature': header }, body,
                }),
                env,
            }),
        };
    };

    test('THE CONFIGURED PRICE GRANTS ACCESS', async () => {
        const f = stub({ items: [{ price: { id: 'price_configured' }, quantity: 1 }] });
        try {
            const { res } = await send();
            expect(res.status).toBe(200);
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/members')))
                .toBe(true);
        } finally { f.restore(); }
    });

    test('A DIFFERENT PRICE AT THE SAME AMOUNT GRANTS NOTHING', async () => {
        /* The hole the amount check alone left: any payment to this account
           at 9900 would have unlocked the app, including a dashboard Payment
           Link for something else entirely. */
        const f = stub({ items: [{ price: { id: 'price_something_else' }, quantity: 1 }] });
        try {
            const { res } = await send();
            expect(res.status).toBe(200);
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/members')),
                'a payment for a different product unlocked the app').toBe(false);
        } finally { f.restore(); }
    });

    test('A DASHBOARD PRICE CHANGE WITHOUT A SECRET UPDATE GRANTS NOTHING', async () => {
        /* The new Price has a new id, so the id check refuses first. */
        const f = stub({ items: [{ price: { id: 'price_new_after_change' }, quantity: 1 }] });
        try {
            await send();
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/members')))
                .toBe(false);
        } finally { f.restore(); }
    });

    test('and the amount check still refuses if only the id was updated', async () => {
        /* Secrets updated halfway: STRIPE_PRICE_ID points at the new Price
           but STRIPE_PRICE_CENTS still holds the old amount. The session
           charged the new amount, so the amount check refuses. */
        const f = stub({ items: [{ price: { id: 'price_configured' }, quantity: 1 }] });
        try {
            await send({ ...ENV, STRIPE_PRICE_CENTS: '12900' });
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/members')),
                'a half-updated configuration granted access').toBe(false);
        } finally { f.restore(); }
    });

    test('MISSING STRIPE_PRICE_ID GRANTS NOTHING', async () => {
        const f = stub({ items: [{ price: { id: 'price_configured' }, quantity: 1 }] });
        try {
            await send({ ...ENV, STRIPE_PRICE_ID: undefined });
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/members')))
                .toBe(false);
        } finally { f.restore(); }
    });

    test('a quantity above one grants nothing', async () => {
        const f = stub({ items: [{ price: { id: 'price_configured' }, quantity: 3 }] });
        try {
            await send();
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/members')))
                .toBe(false);
        } finally { f.restore(); }
    });

    test('extra line items grant nothing', async () => {
        const f = stub({ items: [
            { price: { id: 'price_configured' }, quantity: 1 },
            { price: { id: 'price_bundled_extra' }, quantity: 1 },
        ] });
        try {
            await send();
            expect(f.calls.some(c => c.method === 'POST' && c.url.includes('/members')))
                .toBe(false);
        } finally { f.restore(); }
    });

    test('A TRANSIENT STRIPE ERROR RETRIES RATHER THAN REFUSING', async () => {
        /* A failed line-item read must not permanently deny a real purchase,
           so it throws and the event stays retryable. */
        const f = stub({ items: [], failLineItems: true });
        try {
            const { res } = await send();
            expect(res.status).toBe(500);
            expect(f.calls.some(c => c.url.includes('payment_events')
                && c.method === 'PATCH'), 'the failure was not recorded').toBe(true);
        } finally { f.restore(); }
    });

    test('THE SESSION ENDPOINT REFUSES A MISMATCHED PRICE, DRIVEN', async () => {
        /* Behavioural, because the textual version of this passed with the
           refusal branch replaced by `if (false)`. The property that matters:
           when the Price disagrees, NO session is created, so a customer is
           never charged an amount the webhook will go on to refuse. */
        const SESSION_ENV = {
            STRIPE_SECRET_KEY: 'sk_test_value',
            STRIPE_PRICE_ID: 'price_configured',
            STRIPE_PRICE_CENTS: '9900',
            STRIPE_CURRENCY: 'usd',
        };
        const run = async (priceBody, env = SESSION_ENV) => {
            const calls = [];
            const real = globalThis.fetch;
            globalThis.fetch = async (url, opts = {}) => {
                const u = String(url);
                calls.push({ url: u, method: opts.method || 'GET' });
                const ok = (st, j) => new Response(JSON.stringify(j),
                    { status: st, headers: { 'content-type': 'application/json' } });
                if (u.includes('/v1/prices/')) return ok(200, priceBody);
                if (u.includes('/v1/checkout/sessions')) {
                    return ok(200, { client_secret: 'cs_secret_value' });
                }
                return ok(200, {});
            };
            try {
                const res = await createSession({
                    request: new Request('https://theblueprint.site/api/create-checkout-session',
                        { method: 'POST' }),
                    env,
                });
                return { res, calls };
            } finally { globalThis.fetch = real; }
        };
        const created = (calls) =>
            calls.some(c => c.url.includes('/v1/checkout/sessions') && c.method === 'POST');

        const good = await run({ unit_amount: 9900, currency: 'usd', active: true, type: 'one_time' });
        expect(good.res.status).toBe(200);
        expect(created(good.calls), 'a correct configuration did not open checkout').toBe(true);

        for (const [why, price] of [
            ['the amount changed', { unit_amount: 12900, currency: 'usd', active: true, type: 'one_time' }],
            ['the currency changed', { unit_amount: 9900, currency: 'eur', active: true, type: 'one_time' }],
            ['the Price was archived', { unit_amount: 9900, currency: 'usd', active: false, type: 'one_time' }],
            ['it became recurring', { unit_amount: 9900, currency: 'usd', active: true, type: 'recurring' }],
        ]) {
            const bad = await run(price);
            expect(bad.res.status, why).toBe(503);
            expect(created(bad.calls), `a session was created when ${why}`).toBe(false);
        }

        const unset = await run({ unit_amount: 9900, currency: 'usd', active: true, type: 'one_time' },
            { ...SESSION_ENV, STRIPE_PRICE_CENTS: undefined });
        expect(unset.res.status).toBe(503);
        expect(created(unset.calls)).toBe(false);
    });

    test('THE SESSION ENDPOINT REFUSES BEFORE A CUSTOMER PAYS', async () => {
        /* Catching the mismatch at session creation means the customer never
           gets charged an amount the webhook will refuse. */
        const src = read('functions/api/create-checkout-session.js');
        expect(src).toMatch(/async function priceMatchesConfig/);
        expect(src).toMatch(/v1\/prices\//);
        expect(src).toMatch(/REFUSING TO OPEN CHECKOUT/);
        /* It runs before the session is created. */
        const i = src.indexOf('priceMatchesConfig(env)');
        const j = src.indexOf('v1/checkout/sessions');
        expect(i).toBeGreaterThan(-1);
        expect(i).toBeLessThan(j);
        /* And it checks every way a Price can disagree. */
        for (const why of ['unit_amount !== expected', "price.active === false",
            "price.type !== 'one_time'", 'STRIPE_PRICE_CENTS is not configured']) {
            expect(src, `the pre-flight does not check: ${why}`).toContain(why);
        }
    });
});
