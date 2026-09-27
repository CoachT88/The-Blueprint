import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { authoriseCron, secretsMatch, CRON_SECRET_HEADER } from '../supabase/functions/_shared/cronAuth.js';

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
    const sql = readFileSync(path.join(ROOT, 'supabase/notifications.sql'), 'utf8');
    /* Only the statements that will actually run. Everything commented out is
       documentation or a fallback, and must not be mistaken for the live
       configuration by a test. */
    const live = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

    test('adds the column the sender writes to', () => {
        expect(sql).toMatch(/add column if not exists last_notified_date/i);
    });

    test('schedules the run hourly', () => {
        expect(live).toMatch(/cron\.schedule/);
        expect(live).toMatch(/'0 \* \* \* \*'/);
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
        expect(sql).toMatch(/<PROJECT-REF>/);
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
