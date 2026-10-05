import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Supabase rejects an entire upsert when one column is unknown. Without a
 * fallback, deploying a feature before its ALTER TABLE would silently stop every
 * member from syncing anything — the same failure mode as the data-loss bug,
 * arriving by a different route.
 *
 * The app detects that specific error once, drops only the new columns, and
 * retries. Core data keeps saving either way.
 */
describe('an unmigrated column cannot break saving', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ rejectColumns: ['streak_passes'] });
        await signIn(app.page, { id: 'u8', persisted: { totalXp: 123, streakPasses: 1 } });
        await app.page.evaluate(() => localStorage.setItem('bp_dirty_u8', '1'));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('retries without the new columns and still persists the real data', async () => {
        await app.page.evaluate(() => { window.__writes = []; _flushSaveNow(); });
        await app.page.waitForTimeout(700);

        const r = await app.page.evaluate(() => ({
            attemptKeys: window.__writes.map(w => Object.keys(w)),
            dirtyCleared: !localStorage.getItem('bp_dirty_u8'),
            flagged: _schemaMissingNewCols,
        }));

        // The rejected first attempt is never recorded (the stub only records
        // accepted writes), so exactly one write lands: the trimmed retry.
        expect(r.attemptKeys).toHaveLength(1);
        const keys = r.attemptKeys[0];
        expect(keys).not.toContain('streak_passes');
        expect(keys).toContain('total_xp');
        expect(keys).toContain('session_log');
        expect(r.dirtyCleared).toBe(true);
        expect(r.flagged).toBe(true);
    }, 30_000);

    test('later saves skip straight to the trimmed payload', async () => {
        await app.page.evaluate(() => { window.__writes = []; _flushSaveNow(); });
        await app.page.waitForTimeout(600);
        const count = await app.page.evaluate(() => window.__writes.length);
        expect(count).toBe(1);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

/**
 * The fallback is two-tier, and the reason is a member's ledger.
 *
 * _NEWER_COLUMNS holds eight columns including progression_ledger, and one
 * unknown-column rejection used to strip all eight for the rest of the
 * runtime. Appending the newest migration to that list would mean a member
 * whose table has the 2B.1 columns but not day_plans stops syncing their
 * ledger as the price of two columns nothing reads yet.
 *
 * So the newest migration is stripped on its own first, and only a second
 * unknown-column error widens to everything. These tests pin which tier
 * answered, which is visible only in the ATTEMPT count: a rejected payload
 * never reaches window.__writes.
 */

const LEDGER = [{ weekKey: '2026_w1', targetSessions: 4, qualifyingSessions: 4, verdict: 'qualified' }];

/** Sign in a member with enough real state that a stripped write is obvious. */
async function signInLoaded(page, id) {
    await signIn(page, {
        id,
        persisted: {
            totalXp: 640,
            sessionLog: [{ date: '2026-10-01', type: 'length', xp: 20 }],
            measurements: [{ date: '2026-10-01', bpel: 6.1 }],
            progressionLedger: LEDGER,
            streakPasses: 2,
            primaryGoal: 'size',
            pelvicProfile: 'standard',
            programmeStartDate: '2026-01-01',
        },
    });
}

/** Clear both recorders, force a write, and report what happened. */
async function flushAndRead(page) {
    await page.evaluate(() => { window.__writes = []; window.__attempts = []; _flushSaveNow(); });
    await page.waitForTimeout(700);
    return page.evaluate(() => ({
        attempts: window.__attempts.length,
        attemptKeys: window.__attempts.map(a => Object.keys(a)),
        writes: window.__writes.length,
        write: window.__writes[0] || null,
        latestFlag: _schemaMissingLatestCols,
        newerFlag: _schemaMissingNewCols,
    }));
}

describe('a table missing only the programme column', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ rejectColumns: ['programme'] });
        await signInLoaded(app.page, 'pg1');
        r = await flushAndRead(app.page);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the narrow tier answers: two attempts, one accepted write', () => {
        expect(r.attempts).toBe(2);
        expect(r.writes).toBe(1);
    });

    test('both newest columns are dropped together, not just the rejected one', () => {
        expect('programme' in r.write).toBe(false);
        expect('day_plans' in r.write).toBe(false);
    });

    test('the ledger is not collateral damage', () => {
        expect(r.write.progression_ledger).toEqual(LEDGER);
        expect(r.newerFlag).toBe(false);
        expect(r.latestFlag).toBe(true);
    });
});

describe('a table missing only the day_plans column', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ rejectColumns: ['day_plans'] });
        await signInLoaded(app.page, 'dp1');
        r = await flushAndRead(app.page);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the narrow tier answers: two attempts, one accepted write', () => {
        expect(r.attempts).toBe(2);
        expect(r.writes).toBe(1);
    });

    test('both newest columns are dropped together, not just the rejected one', () => {
        expect('programme' in r.write).toBe(false);
        expect('day_plans' in r.write).toBe(false);
    });

    test('the ledger is not collateral damage', () => {
        expect(r.write.progression_ledger).toEqual(LEDGER);
        expect(r.newerFlag).toBe(false);
        expect(r.latestFlag).toBe(true);
    });
});

describe('a table missing both newest columns at once', () => {
    /* The production-realistic case. Neither column has ever existed on a
       table that has not had supabase/day-plans-schema.sql run, so this is
       what deploy day actually looks like, not the single-column cases above. */
    let app, r, second;
    beforeAll(async () => {
        app = await openApp({ rejectColumns: ['programme', 'day_plans'] });
        await signInLoaded(app.page, 'both1');
        r = await flushAndRead(app.page);
        second = await flushAndRead(app.page);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the narrow tier answers: two attempts, one accepted write', () => {
        expect(r.attempts).toBe(2);
        expect(r.writes).toBe(1);
        expect('programme' in r.write).toBe(false);
        expect('day_plans' in r.write).toBe(false);
        expect(r.latestFlag).toBe(true);
        expect(r.newerFlag).toBe(false);
    });

    test('the narrow fallback preserves everything the broad one would strip', () => {
        expect(r.write.total_xp).toBe(640);
        expect(r.write.session_log).toHaveLength(1);
        expect(r.write.measurements).toHaveLength(1);
        expect(r.write.progression_ledger).toEqual(LEDGER);
        expect(r.write.streak_passes).toBe(2);
        expect(r.write.primary_goal).toBe('size');
        expect(r.write.pelvic_profile).toBe('standard');
        expect(r.write.programme_start_date).toBe('2026-01-01');
    });

    test('later writes in the same runtime do not re-attempt the two columns', () => {
        expect(second.attempts).toBe(1);
        expect(second.writes).toBe(1);
        expect('programme' in second.write).toBe(false);
        expect('day_plans' in second.write).toBe(false);
        expect(second.latestFlag).toBe(true);
        expect(second.newerFlag).toBe(false);
        expect(app.errors).toEqual([]);
    });
});

describe('a table missing an older migration too', () => {
    /* progression_ledger arrived at 2B.1, so a table rejecting it is missing
       more than the newest migration. The narrow strip cannot help and the
       broad tier has to answer, which is the old all-or-nothing behaviour
       kept intact for exactly this case. */
    let app, r;
    beforeAll(async () => {
        app = await openApp({ rejectColumns: ['progression_ledger'] });
        await signInLoaded(app.page, 'old1');
        r = await flushAndRead(app.page);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('it escalates: three attempts, one accepted write', () => {
        expect(r.attempts).toBe(3);
        expect(r.writes).toBe(1);
        expect(r.latestFlag).toBe(true);
        expect(r.newerFlag).toBe(true);
    });

    test('the attempts narrow in the right order', () => {
        expect(r.attemptKeys[0]).toContain('programme');
        expect(r.attemptKeys[0]).toContain('progression_ledger');
        expect(r.attemptKeys[1]).not.toContain('programme');
        expect(r.attemptKeys[1]).toContain('progression_ledger');
        expect(r.attemptKeys[2]).not.toContain('progression_ledger');
    });

    test('the original base fields still reach the row', () => {
        expect(r.write.total_xp).toBe(640);
        expect(r.write.session_log).toHaveLength(1);
        expect(r.write.measurements).toHaveLength(1);
        expect(Array.isArray(r.write.schedule)).toBe(true);
        expect(app.errors).toEqual([]);
    });
});

describe('a table that has had every migration run', () => {
    /* The SQL-first path, and the one every member is on once the migration
       has been applied. A fallback that fires here would be a bug. */
    let app, r;
    beforeAll(async () => {
        app = await openApp();
        await signInLoaded(app.page, 'ok1');
        r = await flushAndRead(app.page);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('one attempt, one write, no fallback', () => {
        expect(r.attempts).toBe(1);
        expect(r.writes).toBe(1);
        expect(r.latestFlag).toBe(false);
        expect(r.newerFlag).toBe(false);
    });

    test('the newest columns are actually in the payload', () => {
        expect('programme' in r.write).toBe(true);
        expect('day_plans' in r.write).toBe(true);
        expect(r.write.programme).toBe(null);
        expect(r.write.day_plans).toEqual([]);
        expect(app.errors).toEqual([]);
    });
});
