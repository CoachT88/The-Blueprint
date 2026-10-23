import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE LIVE SUITE CANNOT RUN HERE, SO THIS GUARDS ITS WIRING INSTEAD.
 *
 * tests/live talks to the real database and needs credentials, so it is
 * opt-in and absent from every default run. That makes it the easiest suite
 * in the repository to delete, neuter, or quietly stop running, and nothing
 * would go red.
 *
 * This file runs in the ordinary unit suite on every push. It does not test
 * access control. It tests that the thing which does test access control
 * still exists, is still reachable by a documented command, still fails
 * rather than skips when it cannot run, and still refuses to point a delete
 * at an object it did not create.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const SUITE = 'tests/live/crossAccount.test.js';
const CLAIM = 'tests/live/claimMembership.test.js';
const CLIENT = 'tests/live/client.js';

describe('the live access-control suite exists', () => {
    test('THE SUITES AND THEIR CLIENT ARE ALL PRESENT', () => {
        for (const f of [SUITE, CLAIM, CLIENT, 'tests/live/README.md']) {
            expect(existsSync(path.join(ROOT, f)), `${f} is missing`).toBe(true);
        }
    });

    test('and it covers both sensitive stores plus the purchaser table', () => {
        const src = read(SUITE);
        /* The three things a member would mind most, named explicitly so
           deleting a describe block fails here. */
        expect(src, 'no coverage of training records').toContain("'user_data");
        expect(src, 'no coverage of progress photos').toContain('progress-photos');
        expect(src, 'no coverage of the purchaser table').toContain("'members?select=email'");
        expect(src, 'no coverage of claim_membership').toContain('claim_membership');
    });

    test('it drives two distinct accounts and asserts they are distinct', () => {
        const src = read(SUITE);
        expect(src).toMatch(/BP_TEST_A_EMAIL/);
        expect(src).toMatch(/BP_TEST_B_EMAIL/);
        /* Two sessions that turned out to be the same account would pass
           every isolation test for the wrong reason. */
        expect(src).toMatch(/expect\(A\.uid[\s\S]{0,120}not\.toBe\(B\.uid\)/);
    });

    test('EVERY NEGATIVE READ IS PAIRED WITH A POSITIVE ONE', () => {
        /* RLS answers a filtered read with 200 and an empty array, so an
           empty result proves nothing on its own. The suite must prove the
           row and the object exist, from the owner's session, in the same
           run. */
        const src = read(SUITE);
        expect(src, 'nothing proves B has a row to filter')
            .toMatch(/so there is a row to filter/);
        expect(src, 'nothing proves B has an object to protect')
            .toMatch(/so there is an object to protect/);
        expect(src, 'a refused delete is not checked against the object surviving')
            .toMatch(/and the photo is still there/);
    });

    test('A MISSING CREDENTIAL FAILS AND DOES NOT SKIP', () => {
        /* The whole point. A skipped security test reports green. */
        const src = read(SUITE);
        expect(src, 'the no-credentials path does not fail')
            .toMatch(/expect\.fail\(/);
        expect(src, 'the no-credentials failure does not say it is not a pass')
            .toMatch(/THIS IS NOT A PASS/);
    });

    test('a destructive step asserts the probe prefix before it runs', () => {
        const src = read(SUITE);
        const client = read(CLIENT);
        expect(client).toMatch(/PROBE_PREFIX\s*=\s*'__rls-probe-'/);
        /* Both the delete probe and the cleanup check the prefix. The bucket
           holds member progress photographs, which do not come back. */
        const guards = src.match(/startsWith\(PROBE_PREFIX\)/g) || [];
        expect(guards.length,
            'fewer prefix guards than expected before destructive calls')
            .toBeGreaterThanOrEqual(3);
    });

    test('it targets the project the app actually ships', () => {
        /* Reading the constants from app/index.html is what makes the suite
           provably point at production rather than at whatever an
           environment variable happened to hold. */
        const client = read(CLIENT);
        expect(client).toMatch(/app\/index\.html/);
        expect(client).toMatch(/const SUPABASE_URL/);
        expect(client).toMatch(/const SUPABASE_ANON/);
        /* And it checks the key is the anon key, so a service key swapped in
           cannot make every isolation test pass by having full access. */
        expect(read(SUITE)).toMatch(/payload\.role[\s\S]{0,80}toBe\('anon'\)/);
    });
});

describe('the claim_membership suite covers what it has to', () => {
    test('ALL SIX REVIEWED SCENARIOS ARE PRESENT', () => {
        /* Named one by one, so deleting a case fails here rather than
           quietly shrinking the coverage of the call that grants paid
           access. */
        const src = read(CLAIM);
        const required = [
            'an existing purchaser keeps their access',
            'a first-time claim attaches a confirmed purchaser',
            'an unconfirmed account cannot activate',
            'a nonbuyer is refused and no row is invented',
            'an entitlement already owned cannot be taken by another account',
            'concurrent activation attaches exactly once',
        ];
        for (const r of required) {
            expect(src, `no test for: ${r}`).toContain(r);
        }
    });

    test('the concurrency case actually runs calls in parallel', () => {
        /* Sequential calls would pass without proving anything about the
           `user_id is null` predicate under contention. */
        const src = read(CLAIM);
        expect(src).toMatch(/Promise\.all\(/);
        expect(src).toMatch(/Array\.from\(\{ length: \d+ \}/);
    });

    test('the unconfirmed case reports which layer refused, rather than assuming', () => {
        /* The two project configurations reject that caller at different
           layers, and a test that assumed one would be wrong half the time
           and silent about it. */
        const src = read(CLAIM);
        expect(src).toMatch(/posture:/);
        expect(src).toMatch(/signInRefused/);
    });

    test('A MISSING SERVICE KEY FAILS AND DOES NOT SKIP', () => {
        const src = read(CLAIM);
        expect(src).toMatch(/expect\.fail\(/);
        expect(src).toMatch(/THIS IS NOT A PASS/);
    });

    test('IT CANNOT TOUCH A REAL PURCHASE RECORD', () => {
        /* public.members holds real purchase rows. Every write, read and
           delete in the client refuses an address outside the probe space,
           and the suite checks the total row count across the run. */
        const client = read(CLIENT);
        expect(client).toMatch(/PROBE_EMAIL\s*=\s*'bp-claim-probe-'/);
        for (const fn of ['createUser', 'setUserEmail', 'seedMember',
            'readMembers', 'deleteMembers']) {
            const body = client.slice(client.indexOf(`function ${fn}`),
                client.indexOf(`function ${fn}`) + 600);
            expect(body, `${fn} does not refuse a non-probe address`)
                .toMatch(/isProbeEmail\(/);
        }
        const src = read(CLAIM);
        expect(src, 'the run does not check the members row count came back')
            .toMatch(/members row count changed across the run/);
    });

    test('the service key is never echoed into a result', () => {
        /* A failing assertion gets pasted into reports. */
        const client = read(CLIENT);
        expect(client).toMatch(/never echoed into the result/);
    });

    test('and the migration it reviews is in version control', () => {
        const f = 'supabase/migrations/20261023180000_claim_membership_require_confirmed_email.sql';
        expect(existsSync(path.join(ROOT, f)), `${f} is missing`).toBe(true);
        const sql = read(f);
        expect(sql, 'the migration is not idempotent')
            .toMatch(/create or replace function public\.claim_membership\(\)/);
        expect(sql, 'the confirmation safeguard is absent')
            .toMatch(/email_confirmed_at is not null/);
        expect(sql, 'the search path pin was dropped')
            .toMatch(/set search_path to 'public', 'pg_temp'/);
        expect(sql, 'the concurrency predicate was dropped')
            .toMatch(/and user_id is null/);
        /* The operational dependency is the whole reason this safeguard can
           be worth nothing, so it must stay written down next to it. */
        expect(sql, 'the Confirm email dependency is not documented')
            .toMatch(/Confirm email/);
    });
});

describe('the live suite is reachable, and never runs by accident', () => {
    test('npm run test:live exists and sets LIVE=1', () => {
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.scripts['test:live'], 'no test:live script').toBe('LIVE=1 vitest run');
    });

    test('LIVE=1 routes vitest at tests/live', () => {
        const cfg = read('vitest.config.js');
        expect(cfg).toMatch(/LIVE === '1'/);
        expect(cfg).toMatch(/tests\/live\/\*\*\/\*\.test\.js/);
    });

    test('AND tests/live IS IN NEITHER DEFAULT RUN', () => {
        /* It can fail because of production state, so it must not be able to
           turn a pull request red for a reason the pull request did not
           cause. Both default include lists are checked literally. */
        const cfg = read('vitest.config.js');
        const unit = cfg.match(/:\s*\['tests\/\*\.test\.js'\]/);
        expect(unit, 'the unit include list changed shape; re-check this guard')
            .not.toBeNull();
        expect(cfg).toMatch(/isE2E \? \['tests\/e2e\/\*\*\/\*\.test\.js'\]/);

        const pkg = JSON.parse(read('package.json'));
        expect(pkg.scripts['test:all'], 'test:all pulls in the live suite')
            .not.toMatch(/test:live|LIVE=1/);
    });

    test('and CI does not run it', () => {
        const wf = read('.github/workflows/test.yml');
        expect(wf, 'CI runs the live suite, which needs production credentials')
            .not.toMatch(/test:live|LIVE=1/);
    });

    test('the live suite is not served to the public internet', () => {
        /* tests/ is excluded wholesale, which covers tests/live. Asserted
           because this suite names a bucket, a table list and an RPC. */
        const ignore = read('.assetsignore');
        expect(ignore.split('\n').map(l => l.trim())).toContain('tests');
    });
});
