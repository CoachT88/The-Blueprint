import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Phase 2B.1 wiring, in the real page.
 *
 * The rules themselves have 67 unit tests and are not re-asserted here.
 * What this covers is that the app feeds them the right state and writes
 * the results back: the programme start date is set by the one thing that
 * should set it, the ledger tracks the real week, and nothing in the old
 * tier or deload logic has started moving yet.
 */

const UID = 'pw';
const SCHEDULE = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];

/** Reset to a known member state and render. */
async function reset(page, patch = {}) {
    return page.evaluate(({ patch, SCHEDULE }) => {
        persisted.primaryGoal = 'all';
        persisted.schedule = [...SCHEDULE];
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [];
        persisted.progressionLedger = [];
        persisted.programmeStartDate = null;
        persisted.allTimeSessionCount = 0;
        persisted.firstSessionDate = '';
        persisted.difficulty = 'intermediate';
        Object.assign(persisted, patch);
        renderDashboard();
        return {
            start: persisted.programmeStartDate,
            ledger: persisted.progressionLedger,
            state: currentProgression().state,
        };
    }, { patch, SCHEDULE });
}

/**
 * Complete a session through the REAL finishSession(), so the wiring under
 * test is the wiring that runs in production.
 *
 * An earlier version of this helper reimplemented the programme-start and
 * reconcile calls itself. Every mutation of the actual call sites in
 * index.html then passed, because nothing in the suite ever reached them.
 * Driving the real function is the whole point of an end-to-end test.
 */
const finish = (page, routineType, extra = {}) => page.evaluate(
    ({ routineType, extra }) => {
        session.routineType = routineType;
        _sessionStartTime = Date.now() - 60000;
        selectedEQ = extra.eq || null;
        selectedRPE = extra.rpe || null;
        document.getElementById('input-bpel').value = '';
        document.getElementById('input-mseg').value = '';
        document.getElementById('session-note-input').value = '';
        finishSession();
        return { start: persisted.programmeStartDate, ledger: persisted.progressionLedger,
                 log: persisted.sessionLog.length };
    }, { routineType, extra });

/** Seed historical sessions directly. State setup, not wiring under test. */
const seed = (page, entries) => page.evaluate((entries) => {
    for (const e of entries) {
        const d = new Date(); d.setDate(d.getDate() - e.daysAgo);
        persisted.sessionLog.push({ date: d.toISOString(), routineType: e.type, ...(e.extra || {}) });
        persisted.allTimeSessionCount += 1;
    }
    syncProgression('test');
    return { start: persisted.programmeStartDate, ledger: persisted.progressionLedger };
}, entries);

describe('programme start', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a brand new member has none', async () => {
        const r = await reset(app.page);
        expect(r.start).toBeNull();
    });

    test.each(['length', 'girth', 'stamina'])('the first completed %s session sets it', async (mission) => {
        await reset(app.page);
        const r = await finish(app.page, mission);
        expect(r.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }, 30_000);

    test('REGRESSION: completing Recovery does not set it', async () => {
        await reset(app.page);
        const r = await finish(app.page, 'recovery');
        expect(r.start).toBeNull();
    });

    test('nor does signing in, choosing a goal, or picking a difficulty', async () => {
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.programmeStartDate = null; persisted.allTimeSessionCount = 0;
            persisted.primaryGoal = 'size';              // choosing a goal
            setDifficulty('beginner');                   // writes firstSessionDate, the old trap
            goToStep(3);                                 // opening Mission Select
            renderDashboard();
            return { start: persisted.programmeStartDate, legacy: persisted.firstSessionDate };
        });
        expect(r.start).toBeNull();
        // The legacy field still moves on a tap, which is exactly why it is
        // not trusted as a start.
        expect(r.legacy).not.toBe('');
    }, 30_000);

    test('REGRESSION: an existing start is never overwritten', async () => {
        await reset(app.page, { programmeStartDate: '2024-01-15' });
        await finish(app.page, 'length');
        const after = await app.page.evaluate(() => persisted.programmeStartDate);
        expect(after).toBe('2024-01-15');
    });

    test('an established member with unreliable history stays null', async () => {
        // Null plus a lifetime count IS the established marker. No second
        // column, and no invented date.
        const r = await reset(app.page, { allTimeSessionCount: 220, sessionLog: [] });
        expect(r.start).toBeNull();
        const established = await app.page.evaluate(() =>
            persisted.programmeStartDate === null && persisted.allTimeSessionCount > 0);
        expect(established).toBe(true);
    });

    test('a legacy firstSessionDate alone does not become a start', async () => {
        // It records a difficulty tap. Without a trustworthy completeness
        // signal the honest answer is "established, start unknown".
        const r = await reset(app.page, { allTimeSessionCount: 40, firstSessionDate: '2024-03-01T10:00:00.000Z' });
        expect(r.start).toBeNull();
    });

    test('REGRESSION: retained history plus a pruned lifetime count stays unknown', async () => {
        // The dangerous case: there IS retained history, so an earliest
        // session exists, but the lifetime count proves it is only a tail.
        // Treating that tail as the programme start would reset a member of
        // two years to a few weeks ago.
        await reset(app.page, { allTimeSessionCount: 400 });
        const r = await app.page.evaluate(() => {
            for (const d of [20, 13, 6]) {
                const x = new Date(); x.setDate(x.getDate() - d);
                persisted.sessionLog.push({ date: x.toISOString(), routineType: 'length' });
            }
            syncProgression('test');
            return { start: persisted.programmeStartDate, lifetime: persisted.allTimeSessionCount,
                     retained: persisted.sessionLog.length };
        });
        expect(r.retained).toBeLessThan(r.lifetime);
        expect(r.start).toBeNull();
    });
});

describe('the ledger tracks the real week', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the current week row carries the live target', async () => {
        const r = await reset(app.page);
        const live = r.ledger[r.ledger.length - 1];
        expect(live.weekKey).toBe(await app.page.evaluate(() => getCurrentWeekKey()));
        expect(live.targetSessions).toBe(4);
        expect(Object.keys(live).sort()).toEqual(['qualifyingSessions', 'targetSessions', 'verdict', 'weekKey']);
    });

    test('it counts from the session log, not completedDays', async () => {
        // completedDays has one boolean per weekday and cannot represent
        // which mission, nor a second session. The log can.
        await reset(app.page);
        const r = await app.page.evaluate(() => {
            persisted.completedDays = [true, true, true, true, true, true, true];  // lying
            syncProgression('test');
            return persisted.progressionLedger[persisted.progressionLedger.length - 1];
        });
        expect(r.qualifyingSessions).toBe(0);
    });

    test('a manual substitution counts', async () => {
        await reset(app.page);
        const r = await finish(app.page, 'girth', {});
        expect(r.ledger[r.ledger.length - 1].qualifyingSessions).toBe(1);
    });

    test('a MODIFIED session counts', async () => {
        await reset(app.page);
        const r = await finish(app.page, 'length', {});
        expect(r.ledger[r.ledger.length - 1].qualifyingSessions).toBe(1);
    });

    test('Recovery does not count toward mechanical qualification', async () => {
        await reset(app.page);
        const r = await finish(app.page, 'recovery');
        expect(r.ledger[r.ledger.length - 1].qualifyingSessions).toBe(0);
    });

    test('REGRESSION: two sessions on one day count once', async () => {
        await reset(app.page);
        await finish(app.page, 'length');
        const r = await finish(app.page, 'girth');
        expect(r.ledger[r.ledger.length - 1].qualifyingSessions).toBe(1);
        // but lifetime volume still sees both
        expect(await app.page.evaluate(() => persisted.sessionLog.length)).toBe(2);
    });

    test('an all-rest week is neutral, not missed', async () => {
        const r = await reset(app.page, { schedule: ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'] });
        const live = r.ledger[r.ledger.length - 1];
        expect(live.targetSessions).toBe(0);
        expect(live.verdict).toBe('neutral');
        expect(await app.page.evaluate(() =>
            window.BP.weekIsMemberFacingMiss(persisted.progressionLedger.slice(-1)[0], getCurrentWeekKey()))).toBe(false);
    });

    test('the week in progress is never reported as missed', async () => {
        const r = await reset(app.page);
        const live = r.ledger[r.ledger.length - 1];
        expect(live.verdict).toBe('missed');     // correct for the gate
        expect(await app.page.evaluate(() =>
            window.BP.weekIsMemberFacingMiss(persisted.progressionLedger.slice(-1)[0], getCurrentWeekKey()))).toBe(false);
    });

    test('weeks away keep their calendar slots as unknown', async () => {
        await reset(app.page);
        const r = await seed(app.page, [{ type: 'length', daysAgo: 21 }, { type: 'length', daysAgo: 0 }]);
        const unknowns = r.ledger.filter(w => w.verdict === 'unknown');
        expect(unknowns.length).toBeGreaterThanOrEqual(2);
        // Every unknown week has no recorded target, by definition.
        for (const u of unknowns) expect(u.targetSessions).toBeNull();
        // The weeks nobody opened the app in are empty; the one holding the
        // older session is unknown too, but carries the count we do have.
        expect(unknowns.filter(u => u.qualifyingSessions === 0).length).toBeGreaterThanOrEqual(2);
    }, 30_000);

    test('the ledger is capped at the policy limit', async () => {
        await reset(app.page);
        const len = await app.page.evaluate(() => {
            for (let w = 0; w < 40; w++) {
                for (let i = 0; i < 3; i++) {
                    const d = new Date(); d.setDate(d.getDate() - (w * 7 + i));
                    persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
                }
            }
            syncProgression('test');
            return persisted.progressionLedger.length;
        });
        expect(len).toBe(await app.page.evaluate(() => window.BP.PROGRESSION_POLICY.ledgerMaxWeeks));
    }, 30_000);

    test('a member with history but an empty ledger keeps their weeks', async () => {
        // The leading-empties guard must not swallow a member whose log
        // proves they trained in weeks the ledger has no row for.
        await reset(app.page);
        const rows = await app.page.evaluate(() => {
            for (const d of [21, 20, 19, 14, 13, 12]) {
                const x = new Date(); x.setDate(x.getDate() - d);
                persisted.sessionLog.push({ date: x.toISOString(), routineType: 'length' });
            }
            syncProgression('test');
            return persisted.progressionLedger;
        });
        expect(rows.length).toBeGreaterThanOrEqual(4);
        // Six sessions are all still accounted for. Which weeks they land
        // in depends on the weekday the suite runs on, so the total is the
        // stable assertion.
        expect(rows.reduce((t, r) => t + r.qualifyingSessions, 0)).toBe(6);
    }, 30_000);

    test('a corrupt stored ledger is normalised on load, not trusted', async () => {
        const r = await app.page.evaluate(() => {
            persisted.progressionLedger = window.BP.normaliseLedger([
                { weekKey: '2025_w1', targetSessions: 4, qualifyingSessions: 3, qualified: true },  // legacy
                'junk', null, { weekKey: 'nonsense' },
            ]);
            return persisted.progressionLedger;
        });
        expect(r).toHaveLength(1);
        expect(r[0].verdict).toBe('unknown');     // legacy boolean earns nothing
    });
});

describe('the progression gate', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /**
     * Seed `n` qualifying weeks as a run of live weeks would have left
     * them, then read the state.
     *
     * The ledger is written while a week is current, and this suite cannot
     * move the app's clock, so the rows are seeded through the same
     * reconcileLedger the app calls rather than by replaying syncProgression
     * against a frozen today. The algorithm has its own unit tests; what
     * matters here is that currentProgression() reads what is stored.
     */
    const withWeeks = (page, n, extra = []) => page.evaluate(({ n, extra, SCHEDULE }) => {
        persisted.primaryGoal = 'all';
        persisted.schedule = [...SCHEDULE];
        persisted.sessionLog = [];
        persisted.progressionLedger = [];
        const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
        for (let w = n; w >= 1; w--) {
            const when = mondayOf(new Date(Date.now() - w * 7 * 86400000));
            for (let i = 0; i < 3; i++) {
                const d = new Date(when); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
            }
            persisted.progressionLedger = window.BP.reconcileLedger(persisted.progressionLedger, {
                weekKey: window.BP.weekKey(when), schedule: persisted.schedule,
                sessionLog: persisted.sessionLog, now: when,
            });
        }
        for (const e of extra) {
            const d = new Date(); d.setDate(d.getDate() - e.daysAgo);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: e.type, ...(e.rpe ? { rpe: e.rpe } : {}) });
        }
        const p = currentProgression();
        return { state: p.state, qualifying: p.eligibility.qualifyingWeeks, holds: p.activeHolds, rpeUnknown: p.rpeUnknown };
    }, { n, extra, SCHEDULE });

    test('four qualifying weeks within eight is ELIGIBLE', async () => {
        const r = await withWeeks(app.page, 4);
        expect(r.qualifying).toBeGreaterThanOrEqual(4);
        expect(r.state).toBe('eligible');
    }, 30_000);

    test('three is not', async () => {
        const r = await withWeeks(app.page, 3);
        expect(r.state).not.toBe('eligible');
    }, 30_000);

    test('old qualifying weeks age out of the window', async () => {
        const r = await app.page.evaluate(({ SCHEDULE }) => {
            persisted.primaryGoal = 'all'; persisted.schedule = [...SCHEDULE];
            persisted.sessionLog = []; persisted.progressionLedger = [];
            const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
            for (let w = 15; w >= 12; w--) {
                const when = mondayOf(new Date(Date.now() - w * 7 * 86400000));
                for (let i = 0; i < 3; i++) {
                    const d = new Date(when); d.setDate(d.getDate() + i);
                    persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
                }
                persisted.progressionLedger = window.BP.reconcileLedger(persisted.progressionLedger, {
                    weekKey: window.BP.weekKey(when), schedule: persisted.schedule,
                    sessionLog: persisted.sessionLog, now: when,
                });
            }
            syncProgression('test');          // brings it up to the real today
            const p = currentProgression();
            return { state: p.state, qualifying: p.eligibility.qualifyingWeeks };
        }, { SCHEDULE });
        expect(r.qualifying).toBe(0);
        expect(r.state).not.toBe('eligible');
    }, 30_000);

    test('REGRESSION: a high RPE mean HOLDs an otherwise eligible member', async () => {
        const r = await withWeeks(app.page, 4, [
            { type: 'length', daysAgo: 0, rpe: 9 },
            { type: 'length', daysAgo: 1, rpe: 9 },
            { type: 'length', daysAgo: 2, rpe: 9 },
        ]);
        expect(r.state).toBe('hold');
        expect(r.holds).toContain('rpe');
    }, 30_000);

    test('REGRESSION: missing RPE is UNKNOWN and never silently passes as clear', async () => {
        const r = await withWeeks(app.page, 4);
        expect(r.rpeUnknown).toBe(true);
        // and it does not block: the member is still eligible
        expect(r.state).toBe('eligible');
        expect(r.holds).not.toContain('rpe');
    }, 30_000);

    test('REGRESSION: three completed Recovery sessions in 14 days HOLD progression', async () => {
        const r = await withWeeks(app.page, 4, [
            { type: 'recovery', daysAgo: 1 }, { type: 'recovery', daysAgo: 4 }, { type: 'recovery', daysAgo: 8 },
        ]);
        expect(r.state).toBe('hold');
        expect(r.holds).toContain('recovery');
    }, 30_000);

    test('two completed Recovery sessions do not', async () => {
        const r = await withWeeks(app.page, 4, [
            { type: 'recovery', daysAgo: 1 }, { type: 'recovery', daysAgo: 4 },
        ]);
        expect(r.holds).not.toContain('recovery');
    }, 30_000);
});

describe('nothing has been granted or taken away yet', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test.each(['beginner', 'intermediate', 'advanced', 'elite'])
    ('an existing %s member keeps their tier through the wiring', async (tier) => {
        const after = await app.page.evaluate((t) => {
            persisted.difficulty = t;
            persisted.allTimeSessionCount = 300;
            persisted.sessionLog = [];
            renderDashboard();
            syncProgression('test');
            return persisted.difficulty;
        }, tier);
        expect(after).toBe(tier);
    }, 30_000);

    test('REGRESSION: a huge lifetime session count grants nothing', async () => {
        const r = await app.page.evaluate(() => {
            persisted.difficulty = 'beginner';
            persisted.allTimeSessionCount = 1000;
            persisted.sessionLog = [];
            persisted.progressionLedger = [];
            syncProgression('test');
            return { tier: persisted.difficulty, state: currentProgression().state };
        });
        expect(r.tier).toBe('beginner');
        expect(r.state).not.toBe('eligible');
    });

    test('the tier gate is still the old logic; progression is read-only so far', async () => {
        // isTierLocked must not yet consult the new engine. Changing that
        // is a later checkpoint.
        const r = await app.page.evaluate(() => {
            persisted.diffUnlockedDate = { intermediate: new Date().toISOString() };
            return { advancedLocked: isTierLocked('advanced'), hasState: !!currentProgression() };
        });
        expect(r.advancedLocked).toBe(true);     // four calendar weeks still required
        expect(r.hasState).toBe(true);           // but the new state is readable
    });

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
