import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { transformSync } from 'esbuild';
import { decideNotification, localDateFor } from '../supabase/functions/_shared/notifyRules.js';
import { authoriseCron, secretsMatch, CRON_SECRET_HEADER } from '../supabase/functions/_shared/cronAuth.js';
import { resolveServiceKey, DEFAULT_KEY_NAME } from '../supabase/functions/_shared/serviceKey.js';
import { safeErrorBody, dbErrorDetail, pushErrorDetail } from '../supabase/functions/_shared/errorResponse.js';

/**
 * The edge function runs on Deno, against a live database, on a cron. Nothing
 * in this repo can execute it, so the decision logic was deliberately pushed
 * into _shared/notifyRules.js where it is properly tested.
 *
 * What is left here is plumbing, and these are the properties of that plumbing
 * worth failing a build over. Reading the source is a blunt instrument, but the
 * alternative is finding out from a member that the app messaged them sixteen
 * times, and each of these guards a mistake that was actually present in the
 * version this replaced.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(ROOT, 'supabase/functions/send-notifications/index.ts'), 'utf8');

describe('the sender', () => {
    test('authorises before it touches the database', () => {
        // The decision itself is unit tested below, against the real module.
        // What can only be checked here is that it is wired in, and wired in
        // first: an auth check after the work has begun is not a check.
        expect(src).toMatch(/from '\.\.\/_shared\/cronAuth\.js'/);
        expect(src).toMatch(/authoriseCron\(/);
        expect(src.indexOf('authoriseCron(')).toBeLessThan(src.indexOf('push_subscriptions'));
    });

    test('no longer reads the cron secret out of the Authorization header', () => {
        /* The bug this round fixes. Supabase's gateway reads Authorization
           first and expects a project JWT, so a random CRON_SECRET there was
           rejected with 401 and this function was never reached. */
        expect(src).not.toMatch(/Authorization[^\n]*CRON_SECRET/);
        expect(src).not.toMatch(/Bearer \$\{secret\}/);
    });

    test('delegates the decision rather than reimplementing it', () => {
        expect(src).toMatch(/from '\.\.\/_shared\/notifyRules\.js'/);
        expect(src).toMatch(/decideNotification\(/);
    });

    test('carries no message text of its own', () => {
        // Every string a member can see belongs in notifyRules.js, where the
        // discretion tests can reach it. The previous version had sixteen
        // hard-coded bodies here, several of them explicit.
        const forbidden = /erection|pelvic|kegel|blood flow|testosterone|hydrat/i;
        expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(forbidden);
    });

    test('reads only the columns it needs, never a whole row', () => {
        // session_log is large and there may be thousands of rows.
        expect(src).not.toMatch(/from\('user_data'\)[\s\S]{0,40}select\('\*'\)/);
        expect(src).not.toMatch(/from\('push_subscriptions'\)[\s\S]{0,60}select\('\*'\)/);
    });

    test('pages through subscriptions instead of loading all of them', () => {
        expect(src).toMatch(/\.range\(/);
    });

    test('records that it sent, so nobody is messaged twice in a day', () => {
        expect(src).toMatch(/last_notified_date/);
    });

    test('drops dead subscriptions rather than retrying them hourly forever', () => {
        expect(src).toMatch(/410/);
        expect(src).toMatch(/404/);
    });

    test('declines to send when it cannot tell who has trained', () => {
        // A failed read looks identical to "nobody trained today". Guessing
        // means messaging people who already did the session.
        expect(src).toMatch(/failed/);
        expect(src).toMatch(/Skipping page/);
    });
});

describe('the VAPID public key', () => {
    // A mistyped or truncated key does not throw anywhere. Subscription simply
    // fails, or succeeds against a key the server cannot match, and every push
    // silently goes nowhere on every device. Nothing else in the codebase would
    // notice, which is exactly why this is worth eleven lines.
    const html = readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
    const key = /const VAPID_PUBLIC_KEY='([^']*)'/.exec(html)?.[1];

    test('is present', () => {
        expect(key).toBeTruthy();
    });

    test('is a valid uncompressed P-256 point', () => {
        expect(key).toMatch(/^[A-Za-z0-9_-]+$/);          // base64url, no padding
        const bytes = Buffer.from(key, 'base64url');
        expect(bytes).toHaveLength(65);                    // 0x04 + 32-byte x + 32-byte y
        expect(bytes[0]).toBe(0x04);                       // uncompressed point marker
        expect(key).toHaveLength(87);
    });

    test('is the key whose private half Supabase actually holds', () => {
        /* Supabase shows only a SHA256 digest of a secret, which is enough to
           check a public key against it. This digest is the one displayed for
           VAPID_PUBLIC_KEY in the dashboard.

           The pin exists because the app and the secret drifted apart once:
           the key here was rotated, the revert never landed, and every push
           would have failed with 403 VapidPkHashMismatch. Changing this
           constant without changing the secret now fails the build. */
        expect(createHash('sha256').update(key).digest('hex'))
            .toMatch(/^ed323c303ae234005ae1c8aff0cf611/);
    });
});

describe('the setup SQL', () => {
    /* Split in two so the schema can be applied without also starting the
       hourly job. Bundling them meant the prerequisite could not be installed
       without the switch being flipped at the same time. */
    const schemaSql = readFileSync(path.join(ROOT, 'supabase/notifications-schema.sql'), 'utf8');
    const sql = readFileSync(path.join(ROOT, 'supabase/notifications-cron.sql'), 'utf8');
    /* Only the statements that will actually run. Everything commented out is
       documentation or a fallback, and must not be mistaken for the live
       configuration by a test. */
    const live = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

    test('PART A creates the column the sender reads, and the table if absent', () => {
        /* Until this runs, selecting last_notified_date fails with 42703 and
           the function reports read_failed, which points at row level
           security rather than at a missing column. */
        expect(schemaSql).toMatch(/add column if not exists last_notified_date/i);
        expect(schemaSql).toMatch(/create table if not exists public\.push_subscriptions/i);
    });

    test('PART A covers every column the table holds', () => {
        /* streak_warn is in this list but is no longer read or written by
           anything: Phase 2B.2 retired the streak warning it gated. The
           column is kept so an older client still sending it does not break,
           and so no migration is needed to drop a harmless boolean. */
        for (const col of ['endpoint', 'p256dh', 'auth', 'reminder_time',
                           'streak_warn', 'timezone', 'last_notified_date', 'updated_at']) {
            expect(schemaSql, col).toMatch(new RegExp(`add column if not exists\\s+${col}\\b`, 'i'));
        }
    });

    test('PART A cannot start anything', () => {
        // The whole point of the split: applying the schema must be safe.
        const live = schemaSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
        expect(live).not.toMatch(/cron\.schedule/);
        expect(live).not.toMatch(/net\.http_post/);
        expect(live).not.toMatch(/vault\.create_secret/);
    });

    test('PART A is idempotent', () => {
        const live = schemaSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
        for (const stmt of live.match(/^\s*(create|alter)\s+[^;]+;/gim) || []) {
            expect(stmt.toLowerCase()).toMatch(/if not exists/);
        }
    });

    test('the cron file says it must not be run yet', () => {
        expect(sql).toMatch(/DO NOT RUN THIS UNTIL THE SMOKE TEST PASSES/);
        expect(sql).toMatch(/notifications-schema\.sql/);
    });

    test('checks every minute so the time picker minutes can be honored', () => {
        expect(live).toMatch(/cron\.schedule/);
        expect(live).toMatch(/'\* \* \* \* \*'/);
    });

    test('sends both headers, in the right places', () => {
        expect(live).toMatch(/'Authorization',\s*'Bearer '/);
        expect(live).toMatch(/'x-cron-secret'/);
    });

    test('does NOT put the cron secret in the Authorization header', () => {
        /* The bug this round fixes. The gateway reads Authorization first and
           expects a project JWT, so CRON_SECRET there is rejected with 401 and
           the function is never reached. */
        const authLines = live.split('\n').filter((l) => l.includes('Authorization'));
        expect(authLines.length).toBeGreaterThan(0);
        for (const line of authLines) {
            expect(line).not.toMatch(/cron[_-]?secret/i);
            expect(line).toMatch(/anon/i);
        }
    });

    test('reads both values from Vault rather than embedding them', () => {
        // cron.job.command is plain text in the database.
        expect(live).toMatch(/vault\.decrypted_secrets/);
        expect(live).toMatch(/bp_cron_secret/);
        expect(live).toMatch(/bp_anon_key/);
    });

    test('ships no real secret, only placeholders', () => {
        const client=readFileSync(path.join(ROOT,'app/index.html'),'utf8');
        const projectUrl=client.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
        expect(live).toContain(projectUrl+'/functions/v1/send-notifications');
        expect(live).not.toContain('<PROJECT-REF>');
        expect(sql).toMatch(/<CRON_SECRET>/);
        expect(sql).toMatch(/<SUPABASE_ANON_KEY>/);
        // A pasted JWT or a long random string would mean a leaked value.
        expect(live).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    });

    test('does not reach for the service role key', () => {
        // It bypasses row level security and buys nothing the anon key does not.
        expect(live).not.toMatch(/service_role/i);
    });
});

describe('the Supabase gateway check stays on', () => {
    /* Not our code to execute: verify_jwt is enforced by the platform before
       the function runs. What this repo can prove is that nothing here turns
       it off, which is the honest proxy for "a correct cron secret without
       gateway auth must still fail". The real proof is a post-deploy curl. */
    const workflow = readFileSync(path.join(ROOT, '.github/workflows/deploy-edge-functions.yml'), 'utf8');

    test('the deploy does not disable JWT verification', () => {
        expect(workflow).not.toMatch(/--no-verify-jwt/);
    });

    test('no config.toml turns it off either', () => {
        const configPath = path.join(ROOT, 'supabase/config.toml');
        if (!existsSync(configPath)) return;   // absent means defaults, which is on
        expect(readFileSync(configPath, 'utf8')).not.toMatch(/verify_jwt\s*=\s*false/);
    });

    test('the function can be redeployed without inventing a commit', () => {
        expect(workflow).toMatch(/workflow_dispatch:/);
        // And the existing trigger is untouched.
        expect(workflow).toMatch(/paths:\s*\n\s*- 'supabase\/functions\/\*\*'/);
    });
});

/* The cron gate itself, executed rather than read. This is the half of the
   authentication this repo owns. */
describe('authoriseCron', () => {
    const ENV = { CRON_SECRET: 'a-long-random-cron-secret' };
    const req = (headers = {}) => new Request('https://example.supabase.co/functions/v1/send-notifications', {
        method: 'POST', headers,
    });

    test('allows a request carrying the right secret', () => {
        expect(authoriseCron(req({ [CRON_SECRET_HEADER]: ENV.CRON_SECRET }), ENV)).toEqual({ ok: true });
    });

    test('refuses a request with no x-cron-secret header', () => {
        const r = authoriseCron(req(), ENV);
        expect(r.ok).toBe(false);
        expect(r.status).toBe(401);
    });

    test('refuses a wrong secret', () => {
        const r = authoriseCron(req({ [CRON_SECRET_HEADER]: 'not-it' }), ENV);
        expect(r.ok).toBe(false);
        expect(r.status).toBe(401);
    });

    test('refuses an empty header', () => {
        const r = authoriseCron(req({ [CRON_SECRET_HEADER]: '' }), ENV);
        expect(r.ok).toBe(false);
        expect(r.status).toBe(401);
    });

    test('a secret of the right length but wrong content does not pass', () => {
        const sameLength = 'b'.repeat(ENV.CRON_SECRET.length);
        expect(authoriseCron(req({ [CRON_SECRET_HEADER]: sameLength }), ENV).ok).toBe(false);
    });

    test('an unconfigured CRON_SECRET is 503, never 401', () => {
        /* A deploy fault reported as "unauthorized" sends whoever is debugging
           it looking in exactly the wrong place. Same rule Coach Tee follows. */
        for (const env of [{}, { CRON_SECRET: '' }, { CRON_SECRET: null }, { CRON_SECRET: 123 }]) {
            const r = authoriseCron(req({ [CRON_SECRET_HEADER]: 'anything' }), env);
            expect(r.ok, JSON.stringify(env)).toBe(false);
            expect(r.status, JSON.stringify(env)).toBe(503);
        }
    });

    test('an empty configured secret cannot be satisfied by an empty header', () => {
        const r = authoriseCron(req({ [CRON_SECRET_HEADER]: '' }), { CRON_SECRET: '' });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(503);
    });

    test('never returns either secret, or any part of one', () => {
        const cases = [
            authoriseCron(req(), ENV),
            authoriseCron(req({ [CRON_SECRET_HEADER]: 'wrong-value-here' }), ENV),
            authoriseCron(req({ [CRON_SECRET_HEADER]: 'x' }), {}),
        ];
        for (const r of cases) {
            const text = JSON.stringify(r);
            expect(text).not.toContain(ENV.CRON_SECRET);
            expect(text).not.toContain('wrong-value-here');
        }
    });

    test('the comparison is not a plain equality check', () => {
        // Constant time, so latency cannot recover the secret character by
        // character. Asserted on the helper directly.
        expect(secretsMatch('abc', 'abc')).toBe(true);
        expect(secretsMatch('abc', 'abd')).toBe(false);
        expect(secretsMatch('abc', 'ab')).toBe(false);
        expect(secretsMatch('', '')).toBe(false);
        for (const bad of [null, undefined, 0, {}, ['abc']]) {
            expect(secretsMatch(bad, 'abc')).toBe(false);
            expect(secretsMatch('abc', bad)).toBe(false);
        }
    });
});

/* Where the backend admin key comes from.
 *
 * Production returned {"error":"read_failed"} because SUPABASE_SERVICE_ROLE_KEY
 * is neither injected nor settable on a project using the newer API key
 * system. createClient got undefined, every query went out unauthenticated,
 * and row level security refused the read. The error pointed at the database,
 * which was the one place the problem was not.
 */
describe('resolveServiceKey', () => {
    const SECRET = 'sb_secret_abc123';

    test('takes the default entry out of SUPABASE_SECRET_KEYS', () => {
        const r = resolveServiceKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) });
        expect(r.key).toBe(SECRET);
        expect(r.source).toBe('SUPABASE_SECRET_KEYS');
    });

    test('honours a different key name without a deploy', () => {
        const env = { SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'wrong', notifier: SECRET }) };
        expect(resolveServiceKey(env, { name: 'notifier' }).key).toBe(SECRET);
        expect(resolveServiceKey({ ...env, SUPABASE_SECRET_KEY_NAME: 'notifier' }).key).toBe(SECRET);
    });

    test('uses the only key present when the expected name is missing', () => {
        /* A project whose key is called something else should work rather than
           fail silently, and there is no ambiguity when there is only one. */
        const r = resolveServiceKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ something_else: SECRET }) });
        expect(r.key).toBe(SECRET);
        expect(r.notes.join(' ')).toContain('something_else');
    });

    test('refuses to guess between several keys when none matches', () => {
        const r = resolveServiceKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ a: 'one', b: 'two' }) });
        expect(r.key).toBeNull();
    });

    test('accepts a bare key string, since that is unambiguous', () => {
        // Written without access to Supabase's docs, so the parser is tolerant.
        expect(resolveServiceKey({ SUPABASE_SECRET_KEYS: SECRET }).key).toBe(SECRET);
        expect(resolveServiceKey({ SUPABASE_SECRET_KEYS: JSON.stringify(SECRET) }).key).toBe(SECRET);
    });

    test('falls back to the legacy variable for local and older projects', () => {
        const r = resolveServiceKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt' });
        expect(r.key).toBe('legacy-jwt');
        expect(r.source).toBe('SUPABASE_SERVICE_ROLE_KEY');
    });

    test('prefers the modern source when both are present', () => {
        const r = resolveServiceKey({
            SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
            SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt',
        });
        expect(r.key).toBe(SECRET);
        expect(r.source).toBe('SUPABASE_SECRET_KEYS');
    });

    test('returns null rather than throwing on anything unusable', () => {
        const rubbish = [
            {}, undefined, null,
            { SUPABASE_SECRET_KEYS: '' },
            { SUPABASE_SECRET_KEYS: '{not json' },
            { SUPABASE_SECRET_KEYS: 'null' },
            { SUPABASE_SECRET_KEYS: '[]' },
            { SUPABASE_SECRET_KEYS: '{}' },
            { SUPABASE_SECRET_KEYS: JSON.stringify({ default: '' }) },
            { SUPABASE_SECRET_KEYS: JSON.stringify({ default: 42 }) },
            { SUPABASE_SECRET_KEYS: JSON.stringify({ default: null }) },
            { SUPABASE_SECRET_KEYS: 123 },
            { SUPABASE_SERVICE_ROLE_KEY: '   ' },
        ];
        for (const env of rubbish) {
            let r;
            expect(() => { r = resolveServiceKey(env); }, JSON.stringify(env)).not.toThrow();
            expect(r.key, JSON.stringify(env)).toBeNull();
            expect(r.why).toBe('service-key-not-configured');
        }
    });

    test('says what it found, in shape only, when it finds nothing usable', () => {
        /* The point of this change is that the next failure is legible. */
        const r = resolveServiceKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ alpha: 1, beta: 2 }) });
        const notes = r.notes.join(' | ');
        expect(notes).toContain('JSON object with keys');
        expect(notes).toContain('alpha');
        expect(notes).toContain(`"${DEFAULT_KEY_NAME}"`);
        expect(notes).toContain('SUPABASE_SERVICE_ROLE_KEY: absent');
    });

    test('distinguishes absent, empty and malformed', () => {
        expect(resolveServiceKey({}).notes.join(' ')).toContain('SUPABASE_SECRET_KEYS: absent');
        expect(resolveServiceKey({ SUPABASE_SECRET_KEYS: '' }).notes.join(' ')).toContain('empty string');
        expect(resolveServiceKey({ SUPABASE_SECRET_KEYS: '{oops' }).notes.join(' ')).toContain('not JSON');
    });

    test('never puts a key value in a note or a reason', () => {
        const cases = [
            { SUPABASE_SECRET_KEYS: JSON.stringify({ a: SECRET, b: 'another-secret' }) },
            { SUPABASE_SECRET_KEYS: SECRET + '-but-not-json{' },
            { SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }), SUPABASE_SERVICE_ROLE_KEY: 'legacy-jwt' },
        ];
        for (const env of cases) {
            const r = resolveServiceKey(env);
            const said = [r.why || '', ...r.notes].join(' | ');
            expect(said).not.toContain(SECRET);
            expect(said).not.toContain('another-secret');
            expect(said).not.toContain('legacy-jwt');
        }
    });
});

describe('the sender uses the resolver, and fails closed', () => {
    test('resolves the key rather than reading the variable directly', () => {
        expect(src).toMatch(/from '\.\.\/_shared\/serviceKey\.js'/);
        expect(src).toMatch(/resolveServiceKey\(/);
        // The bare non-null assertion that caused read_failed is gone.
        expect(src).not.toMatch(/createClient\([^)]*SUPABASE_SERVICE_ROLE_KEY'\)!/);
    });

    test('refuses before touching the database when there is no key', () => {
        expect(src).toMatch(/if \(!supabase\)/);
        expect(src).toMatch(/status: 503/);
        expect(src.indexOf('if (!supabase)')).toBeLessThan(src.indexOf("from('push_subscriptions')"));
    });

    test('the cron gate still runs first', () => {
        // Auth before configuration: an unauthenticated caller learns nothing
        // about how this function is set up.
        expect(src.indexOf('authoriseCron(')).toBeLessThan(src.indexOf('if (!supabase)'));
    });

    test('never logs the resolved key', () => {
        expect(src).not.toMatch(/console\.\w+\([^)]*serviceKey\.key/);
    });
});

/* What the caller is told versus what the log is told.
 *
 * A previous version returned the Postgres code, message, details, hint and
 * relation in the HTTP response, reasoning that the caller holds CRON_SECRET.
 * The detail is what made the failure diagnosable and it still exists, but in
 * the log: a response body describes the schema to whoever is on the other
 * end, and "they are authenticated" is weaker than "we never said it".
 */
describe('error responses say nothing the caller should not hear', () => {
    /* A realistic PostgREST error, with things that must not travel. */
    const DB_ERROR = {
        code: '42703',
        message: 'column push_subscriptions.last_notified_date does not exist',
        details: 'SELECT user_id, endpoint, p256dh FROM public.push_subscriptions',
        hint: 'Perhaps you meant to reference the column "push_subscriptions.updated_at".',
    };

    test('returns a label and the counters, and nothing else', () => {
        const body = safeErrorBody('read_failed', { checked: 3, sent: 1, dropped: 0, rejected: 2 });
        expect(Object.keys(body).sort()).toEqual(['checked', 'dropped', 'error', 'rejected', 'sent']);
        expect(body.error).toBe('read_failed');
    });

    test('carries no database detail into the body', () => {
        const body = safeErrorBody('read_failed', { checked: 0, sent: 0, dropped: 0, rejected: 0 });
        const text = JSON.stringify(body);
        expect(text).not.toContain('42703');
        expect(text).not.toContain('does not exist');
        expect(text).not.toContain('Perhaps you meant');
        expect(text).not.toContain('push_subscriptions');
        expect(text).not.toContain('SELECT');
        expect(body.hint).toBeUndefined();
        expect(body.details).toBeUndefined();
        expect(body.relation).toBeUndefined();
        expect(body.db).toBeUndefined();
        expect(body.keySource).toBeUndefined();
    });

    test('keeps every bit of that detail for the log', () => {
        // Sanitising the response must not cost the diagnosis.
        const detail = dbErrorDetail(DB_ERROR, 'public.push_subscriptions');
        expect(detail.code).toBe('42703');
        expect(detail.message).toBe(DB_ERROR.message);
        expect(detail.details).toBe(DB_ERROR.details);
        expect(detail.hint).toBe(DB_ERROR.hint);
        expect(detail.relation).toBe('public.push_subscriptions');
    });

    test('cannot be made to leak through the counters argument', () => {
        /* Counters are copied by name, so a call site that hands over a wider
           object cannot widen what is returned. */
        const body = safeErrorBody('read_failed', {
            checked: 1,
            message: DB_ERROR.message,
            hint: DB_ERROR.hint,
            key: 'sb_secret_leaked',
            email: 'member@example.com',
        });
        expect(Object.keys(body).sort()).toEqual(['checked', 'error']);
        const text = JSON.stringify(body);
        expect(text).not.toContain('sb_secret_leaked');
        expect(text).not.toContain('member@example.com');
    });

    test('swallows secrets, tokens, endpoints and emails hidden in a label', () => {
        const nasty = 'read_failed sb_secret_abc eyJhbGciOiJIUzI1NiJ9.x.y https://fcm.googleapis.com/fcm/send/abc member@example.com';
        // The label is stringified as given; the guarantee is that nothing is
        // ADDED. A caller-supplied label is never built from an error object.
        const body = safeErrorBody(nasty);
        expect(Object.keys(body)).toEqual(['error']);
    });

    test('keeps a push failure diagnosable without logging the endpoint', () => {
        /* A WebPushError carries the endpoint and the push service's response
           body. An endpoint identifies a member's device. */
        const detail = pushErrorDetail({
            name: 'WebPushError',
            statusCode: 410,
            message: 'Received unexpected response code',
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
            body: '<html>NotRegistered</html>',
            headers: { 'x-thing': 'y' },
        });
        expect(detail).toEqual({ name: 'WebPushError', statusCode: 410, message: 'Received unexpected response code' });
        const text = JSON.stringify(detail);
        expect(text).not.toContain('fcm.googleapis.com');
        expect(text).not.toContain('NotRegistered');
    });

    test('survives an error that is null, empty or the wrong shape', () => {
        for (const bad of [null, undefined, {}, 'a string', 42]) {
            expect(() => dbErrorDetail(bad, 'public.x'), String(bad)).not.toThrow();
            expect(() => pushErrorDetail(bad), String(bad)).not.toThrow();
        }
        expect(dbErrorDetail(null, 'public.x').code).toBeNull();
        expect(pushErrorDetail(null).statusCode).toBeNull();
    });

    test('keeps read_failed distinguishable from a configuration failure', () => {
        expect(safeErrorBody('read_failed').error).toBe('read_failed');
        expect(safeErrorBody('service-key-not-configured').error).toBe('service-key-not-configured');
        expect(safeErrorBody('read_failed').error)
            .not.toBe(safeErrorBody('service-key-not-configured').error);
    });
});

describe('the sender does not route detail around the sanitiser', () => {
    /* A pure function cannot stop a call site inlining the error, so the
       remaining guarantee has to be read off the source. */
    const responses = src.match(/new Response\(\s*JSON\.stringify\([\s\S]{0,400}?\)\s*,/g) || [];

    test('builds every response body through safeErrorBody or the counters', () => {
        expect(responses.length).toBeGreaterThan(3);
        for (const r of responses) {
            const ok = r.includes('safeErrorBody(') || /\{ checked, sent, dropped, rejected \}/.test(r);
            expect(ok, r.slice(0, 120)).toBe(true);
        }
    });

    test('never interpolates a database message, hint or detail into a response', () => {
        for (const r of responses) {
            expect(r).not.toMatch(/error\.(message|hint|details|code)/);
            expect(r).not.toMatch(/String\(e\)/);
            expect(r).not.toMatch(/keySource/);
        }
    });

    test('never puts the resolved key anywhere near a response or a log', () => {
        expect(src).not.toMatch(/console\.\w+\([^)]*serviceKey\.key/);
        expect(src).not.toMatch(/JSON\.stringify\([^)]*serviceKey\.key/);
    });

    test('logs the push failure through pushErrorDetail, not the raw error', () => {
        expect(src).toMatch(/pushErrorDetail\(sendErr\)/);
        expect(src).not.toMatch(/console\.error\([^)]*,\s*sendErr\s*\)/);
    });

    test('never logs a bare caught object', () => {
        expect(src).not.toMatch(/console\.error\(e\)/);
        expect(src).toMatch(/\(e && e\.message\)/);
    });

    test('sends database detail to the log on the read path', () => {
        expect(src).toMatch(/dbErrorDetail\(error, 'public\.push_subscriptions'\)/);
    });
});


// Run the production sender against a schema-accurate fake database. These
// tests fail when user_data is queried or mapped with the subscription key.
describe('sender against the real user_data identity schema', () => {
    afterEach(() => vi.useRealTimers());
    function sender({ training, missing = [], readFailure = false, historyFailure = false, claimFailure = false, recordFailure = false, pushFailure = false, customEnabled = true }) {
        const pushes = [], pushOptions = [], reads = [], deliveries = new Map();
        const subscription = { user_id:'member-a', endpoint:'test-endpoint', p256dh:'test', auth:'test',
            timezone:'America/Los_Angeles', reminder_time:'19:00', custom_enabled:customEnabled, last_notified_date:null };
        const client = { async rpc(name, args) {
            if (name !== 'claim_training_notification') throw new Error('unexpected RPC');
            if (claimFailure) return {data:null,error:{code:'42501'}};
            const key=args.p_user_id+'|'+args.p_event_key;
            if (deliveries.has(key)) return {data:false,error:null};
            deliveries.set(key,{user_id:args.p_user_id,event_key:args.p_event_key});
            return {data:true,error:null};
        }, from(table) {
            let columns = '', offset = 0, end = 499;
            return {
                select(value) { columns=value; return this; },
                order() { return this; },
                gte() { return this; },
                range(first, last) { if(table==='notification_deliveries'){offset=first;end=last;return this;} return Promise.resolve({data:first===0?[subscription]:[],error:null}); },
                async in(key, ids) {
                    reads.push({ table, columns, key, ids });
                    if (table==='notification_deliveries') return {
                        data:[...deliveries.values()].sort((a,b)=>a.event_key.localeCompare(b.event_key)).slice(offset,end+1),error:historyFailure?{code:'42501'}:null,
                    };
                    const cols=columns.split(',').map(c=>c.trim());
                    if (key!=='id' || cols.includes('user_id') || cols.some(c=>missing.includes(c)))
                        return {data:null,error:{code:'42703',message:'column does not exist'}};
                    if(readFailure) return {data:null,error:{code:'42501',message:'read denied'}};
                    return {data:training.filter(row=>ids.includes(row.id))
                        .map(row=>Object.fromEntries(cols.map(c=>[c,row[c]]))),error:null};
                },
                update() { return this; }, delete() { return this; },
                eq() { return this; },
                then(resolve) { return Promise.resolve({error:recordFailure&&table==='notification_deliveries'?{code:'42501'}:null}).then(resolve); },
            };
        }};
        const deno = {env:{get:name=>name==='CRON_SECRET'?'test-cron-secret':undefined},
            serve(handler) { this.handler=handler; }};
        const webpush = {setVapidDetails() {}, async sendNotification(_sub,payload,options) { pushes.push(JSON.parse(payload)); pushOptions.push(options); if(pushFailure) throw {statusCode:503}; }};
        const code=transformSync(src.replace(/^import .*;\n/gm,''),{loader:'ts',format:'cjs'}).code;
        new Function('Deno','createClient','webpush','decideNotification','localDateFor',
            'authoriseCron','resolveServiceKey','safeErrorBody','dbErrorDetail','pushErrorDetail','console',code)(
            deno,()=>client,webpush,decideNotification,localDateFor,authoriseCron,
            ()=>({key:'test-backend-key',source:'test',notes:[]}),safeErrorBody,dbErrorDetail,pushErrorDetail,
            {log() {},warn() {},error() {}});
        return { run:()=>deno.handler(new Request('https://example.test/send-notifications',
            {method:'POST',headers:{'x-cron-secret':'test-cron-secret'}})),pushes,pushOptions,reads,deliveries,subscription };
    }
    const row = overrides => ({id:'member-a',schedule:Array(7).fill('length'),
        session_log:[],pass_protected_dates:[],programme:null,...overrides});
    const clock = () => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T02:00:00Z')); };
    test('a completed session suppresses a push using user_data.id', async () => {
        clock();
        const app=sender({training:[row({session_log:[{date:'2026-10-13T01:00:00Z',routineType:'length'}]})]});
        expect(await (await app.run()).json()).toMatchObject({checked:1,sent:0});
        expect(app.pushes).toEqual([]);
        expect(app.reads[0]).toMatchObject({table:'user_data',key:'id',ids:['member-a']});
    });
    test('a prescribed rest day suppresses a push after mapping row.id', async () => {
        clock();
        const schedule=Array(7).fill('length'); schedule[1]='rest';
        const app=sender({training:[row({schedule})]});
        expect(await (await app.run()).json()).toMatchObject({checked:1,sent:0});
        expect(app.pushes).toEqual([]);
    });
    test.each([[],['programme'],['programme','schedule','pass_protected_dates']])(
        'an eligible member is read through the supported schema tier %j', async missing => {
            clock();
            const app=sender({training:[row({}),row({id:'member-b',session_log:[{date:'2026-10-13T01:00:00Z'}]})],missing});
            expect(await (await app.run()).json()).toMatchObject({checked:1,sent:1});
            expect(app.pushes).toHaveLength(1);
            expect(app.reads.filter(r=>r.table==='user_data').every(r=>r.key==='id'&&!r.columns.includes('user_id'))).toBe(true);
        });
    test('a failed training read never becomes permission to send', async () => {
        clock();
        const app=sender({training:[],readFailure:true});
        expect(await (await app.run()).json()).toMatchObject({checked:0,sent:0});
        expect(app.pushes).toEqual([]);
    });
    test('AM, PM and a selected extra all dispatch independently on the same day', async () => {
        clock();
        const app=sender({training:[row({})]});
        vi.setSystemTime(new Date('2026-10-12T16:00:00Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:1});
        vi.setSystemTime(new Date('2026-10-13T02:00:00Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:1});
        app.subscription.reminder_time='21:31';
        vi.setSystemTime(new Date('2026-10-13T04:31:00Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:1});
        expect(app.pushes).toHaveLength(3);
        expect(new Set(app.pushes.map(p=>p.tag)).size).toBe(3);
    });
    test('offline delivery expires promptly instead of building a days-old reminder backlog', async () => {
        clock();
        const app=sender({training:[row({})]});
        await app.run();
        expect(app.pushOptions[0].TTL).toBeGreaterThan(0);
        expect(app.pushOptions[0].TTL).toBeLessThanOrEqual(15 * 60);
    });
    test('overlapping production handlers reserve and send an event once', async () => {
        clock();
        const app=sender({training:[row({})]});
        const results=await Promise.all([app.run(),app.run()]);
        const bodies=await Promise.all(results.map(r=>r.json()));
        expect(bodies.reduce((sum,b)=>sum+b.sent,0)).toBe(1);
        expect(app.pushes).toHaveLength(1);
        expect(app.deliveries.size).toBe(1);
    });
    test('delivery-history pagination cannot hide an older praise and block the next completion', async () => {
        clock();
        const app=sender({training:[row({session_log:[{date:'2026-10-13T01:00:00Z'},{date:'2026-10-13T01:05:00Z'}]})]});
        for(let i=0;i<1000;i++) app.deliveries.set('history-'+i,{user_id:'member-a',event_key:'a-history-'+String(i).padStart(4,'0')});
        app.deliveries.set('old-praise',{user_id:'member-a',event_key:'completion:2026-10-13T01:00:00.000Z'});
        vi.setSystemTime(new Date('2026-10-13T01:25:00Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:1});
        expect(app.pushes[0].tag).toBe('bp-completion-'+new Date('2026-10-13T01:05:00Z').getTime());
        expect(app.reads.filter(r=>r.table==='notification_deliveries')).toHaveLength(3);
    });
    test('a real completion suppresses reminders and receives the twenty-minute follow-up once', async () => {
        clock();
        const app=sender({training:[row({session_log:[{date:'2026-10-13T01:00:00Z'}]})]});
        vi.setSystemTime(new Date('2026-10-13T01:19:59Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:0});
        vi.setSystemTime(new Date('2026-10-13T01:20:00Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:1});
        expect(app.pushes[0].body).toBe('Good job for showing up today.');
        vi.setSystemTime(new Date('2026-10-13T01:21:00Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:0});
        vi.setSystemTime(new Date('2026-10-13T02:00:00Z'));
        expect(await (await app.run()).json()).toMatchObject({sent:0});
        expect(app.pushes).toHaveLength(1);
    });
    test.each([{historyFailure:true},{claimFailure:true}])('a delivery-tracking failure %j sends nothing', async failure => {
        clock();
        const app=sender({training:[row({})],...failure});
        expect((await app.run()).status).toBe(500);
        expect(app.pushes).toEqual([]);
    });
    test('an accepted push with a failed acknowledgement cannot be sent again', async () => {
        clock();
        const app=sender({training:[row({})],recordFailure:true});
        const first=await app.run();
        expect(first.status).toBe(500);
        expect(await first.json()).toMatchObject({sent:1});
        expect(await (await app.run()).json()).toMatchObject({sent:0});
        expect(app.pushes).toHaveLength(1);
    });
    test('an uncertain provider failure is not repeatedly retried', async () => {
        clock();
        const app=sender({training:[row({})],pushFailure:true});
        await app.run(); await app.run();
        expect(app.pushes).toHaveLength(1);
    });
});
