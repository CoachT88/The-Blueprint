import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';
import { getCurrentWeekKey as moduleWeekKey } from '../../src/weekUtils.js';

/**
 * There are two implementations of the ISO week key, and the progression
 * engine straddles both.
 *
 *   app/index.html  getCurrentWeekKey()        reads the clock, no argument
 *   src/weekUtils.js getCurrentWeekKey(date)   takes a date, and is the one
 *                                              with the year-boundary tests
 *
 * The in-page one WRITES the ledger: syncProgression() stamps each row with
 * it. The module one READS the ledger: deloadState() computes the live week
 * with it and skips that row, and maybeEarnRecoveryPass() compares against it
 * to tell whether this week already paid out.
 *
 * So the two must agree, and nothing else asserts that they do. If they ever
 * drifted, the live week would stop being recognised as live and the deload
 * would go back to depending on how far into the week the member was, which
 * is the exact bug the discharge rule exists to prevent. It would be silent.
 *
 * The right fix is one implementation. Until the page can import the module
 * at the top level, this is the invariant that stands in for it.
 */
describe('the two week-key implementations agree', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'wk' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('right now, in the real page', async () => {
        const inPage = await app.page.evaluate(() => window.getCurrentWeekKey());
        expect(inPage).toBe(moduleWeekKey(new Date()));
        expect(inPage).toMatch(/^\d{4}_w\d{1,2}$/);
    }, 30_000);

    test('and the page exposes the module version under a different name', async () => {
        // window.BP.weekKey is the module one. Called with today it must give
        // the same answer as the page's own, or the Pass earning comparison
        // in maybeEarnRecoveryPass is comparing two different calendars.
        const r = await app.page.evaluate(() => ({
            page: window.getCurrentWeekKey(),
            module: window.BP.weekKey(new Date()),
        }));
        expect(r.module).toBe(r.page);
    }, 30_000);

    test('the row syncProgression writes is the row deloadState calls live', async () => {
        // The load-bearing consequence, asserted end to end rather than by
        // comparing two strings: write a ledger through the real production
        // path, then check the engine excludes that row from banking.
        const r = await app.page.evaluate(() => {
            persisted.primaryGoal = 'all';
            persisted.schedule = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
            persisted.progressionLedger = [];
            persisted.sessionLog = [];
            // Four finished qualifying weeks, so the live week is a deload.
            const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
            for (let w = 4; w >= 1; w--) {
                const monday = mondayOf(new Date(Date.now() - w * 7 * 86400000));
                for (let i = 0; i < 7; i++) {
                    const d = new Date(monday); d.setDate(d.getDate() + i);
                    persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
                }
                persisted.progressionLedger = window.BP.reconcileLedger(persisted.progressionLedger, {
                    weekKey: window.BP.weekKey(monday), schedule: persisted.schedule,
                    sessionLog: persisted.sessionLog, now: monday,
                });
            }
            syncProgression('test');             // the real write path
            const rows = persisted.progressionLedger;
            const live = rows[rows.length - 1];
            const state = window.BP.deloadState(rows, persisted.sessionLog, { now: new Date() });
            return {
                liveRowKey: live.weekKey,
                pageKey: window.getCurrentWeekKey(),
                accumulated: state.accumulated,
                deload: isDeloadWeek(),
                qualifiedRows: rows.filter(w => w.verdict === 'qualified').length,
            };
        });
        expect(r.liveRowKey).toBe(r.pageKey);
        expect(r.qualifiedRows).toBe(4);
        expect(r.accumulated).toBe(4);
        expect(r.deload).toBe(true);
        /* Why this discriminates. If the two keys disagreed, deloadState
           would not recognise the live row as live, would fold it like a
           finished week, would hit the trigger on it and DISCHARGE there.
           accumulated would read 0 and the member would silently lose the
           deload week they had earned. */
    }, 30_000);

    test('the page threw nothing', () => {
        expect(app.errors).toEqual([]);
    });
});
