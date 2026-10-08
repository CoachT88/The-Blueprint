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
        /* Same reason as seedWeeks: start unclassified, or a member cut over
           by an earlier test keeps their programme and the authority
           transition projects its week over the one being seeded here. */
        persisted.programme = window.__legacyProgramme();
        persisted.dayPlans = [];
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
        captureLaunchPrescription();   /* the production launch capture: finishSession records the prescription the session LAUNCHED under, so a harness that sets routineType by hand must freeze it the same way the real startMission() does */
        session.routineType = routineType;
        _sessionStartTime = Date.now() - 60000;
        selectedEQ = extra.eq || null;
        selectedRPE = extra.rpe || null;
        document.getElementById('input-bpel').value = '';
        document.getElementById('input-mseg').value = '';
        document.getElementById('session-note-input').value = '';
        finishSession();
        const out = { start: persisted.programmeStartDate, ledger: persisted.progressionLedger,
                      log: persisted.sessionLog.length };
        /* Read first, THEN close. closeSessionSummary returns to the HQ,
           which re-renders and reconciles again; the assertion is about what
           finishSession itself produced. Closing is not optional though: it
           is the only way out of a completion in production and the only
           thing that releases the one-shot finish guard, so a harness that
           completes more than once has to do what the member does. */
        closeSessionSummary();
        return out;
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
        // Reported moderate soreness, so the resolver really is in MODIFIED
        // and the session that follows is the reduced one. Reduced mechanical
        // work is still mechanical work.
        // Every day is a training day here, so the fixture does not depend
        // on which weekday the suite runs on. REST outranks MODIFIED.
        await reset(app.page, { schedule: ['length', 'length', 'length', 'length', 'length', 'length', 'length'] });
        const state = await app.page.evaluate(() => {
            localStorage.setItem(getTodaySorenessKey(), 'moderate');
            renderDashboard();
            return window.BP.nextBestAction(buildResolverInput()).state;
        });
        expect(state).toBe('MODIFIED');
        const r = await finish(app.page, 'length', {});
        expect(r.ledger[r.ledger.length - 1].qualifyingSessions).toBe(1);
        await app.page.evaluate(() => { localStorage.removeItem(getTodaySorenessKey()); renderDashboard(); });
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

/**
 * Seed a run of FINISHED weeks and leave the member sitting on them.
 *
 * Each spec is one week: `weeksAgo` (1 is last week), `q` qualifying
 * mechanical days, `recovery` Recovery days, `type` to substitute a
 * different mission, `rpe` on those sessions, `rest: true` for a week whose
 * schedule was all rest, and `away: true` to train nothing and write no row,
 * so reconcile has to fill the slot itself.
 *
 * Rows go in through the same reconcileLedger the app calls, because the
 * ledger is only ever written while a week is current and a browser suite
 * cannot wind the page's clock back.
 *
 * Every week in `specs` has already finished, deliberately. The current
 * week cannot be made to qualify on an arbitrary weekday: qualifying needs
 * at least two distinct training days, and on a Monday there has only been
 * one. Anchoring to finished weeks is what makes these fixtures give the
 * same answer whichever day the suite runs on.
 *
 * `opts.live` adds that many sessions to the week in progress and writes
 * its row, capped at the days that have actually elapsed. It exists to
 * prove the answers that must NOT depend on how far into the week the
 * member is, so the tests assert on the result rather than the count.
 */
const seedWeeks = (page, specs, patch = {}, opts = {}) => page.evaluate(({ specs, patch, SCHEDULE, opts }) => {
    persisted.primaryGoal = 'all';
    persisted.schedule = [...SCHEDULE];
    persisted.completedDays = [false, false, false, false, false, false, false];
    persisted.sessionLog = [];
    persisted.progressionLedger = [];
    persisted.difficulty = 'intermediate';
    persisted.diffUnlockedDate = {};
    persisted.allTimeSessionCount = 0;
    /* Phase 3S.1 PR C. Reset the programme too, or a member cut over by an
       earlier test in this browser stays cut over, and the authority
       transition then correctly projects THEIR programme's week over the
       schedule this fixture just seeded. Two tests seed a deliberately
       non-preset week (all-length, all-rest) and both silently became a
       different scenario. Starting unclassified means classification runs
       against the seeded week, which is what these tests are about. */
    persisted.programme = window.__legacyProgramme();
    persisted.dayPlans = [];
    Object.assign(persisted, patch);

    const ALL_REST = ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'];
    const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

    for (const s of [...specs].sort((a, b) => b.weeksAgo - a.weeksAgo)) {
        const monday = mondayOf(new Date(Date.now() - s.weeksAgo * 7 * 86400000));
        const type = s.recovery ? 'recovery' : (s.type || 'length');
        for (let i = 0; i < (s.recovery || s.q || 0); i++) {
            const d = new Date(monday); d.setDate(d.getDate() + i);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: type, ...(s.rpe ? { rpe: s.rpe } : {}) });
        }
        if (s.away) continue;
        persisted.progressionLedger = window.BP.reconcileLedger(persisted.progressionLedger, {
            weekKey: window.BP.weekKey(monday),
            schedule: s.rest ? ALL_REST : persisted.schedule,
            sessionLog: persisted.sessionLog,
            now: monday,
        });
    }

    let liveDays = 0;
    if (opts.live != null) {
        const monday = mondayOf(new Date());
        const elapsed = ((new Date().getDay() + 6) % 7) + 1;      // days so far, today included
        liveDays = Math.min(opts.live, elapsed);
        for (let i = 0; i < liveDays; i++) {
            const d = new Date(monday); d.setDate(d.getDate() + i);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
        }
        persisted.progressionLedger = window.BP.reconcileLedger(persisted.progressionLedger, {
            weekKey: getCurrentWeekKey(), schedule: persisted.schedule,
            sessionLog: persisted.sessionLog, now: new Date(),
        });
    }

    const p = currentProgression();
    return {
        state: p.state, qualifying: p.eligibility.qualifyingWeeks, unknownWeeks: p.unknownWeeks,
        deload: isDeloadWeek(), ledger: persisted.progressionLedger, liveDays,
        accumulated: window.BP.deloadState(persisted.progressionLedger, persisted.sessionLog, { now: new Date() }).accumulated,
    };
}, { specs, patch, SCHEDULE, opts });

/** `n` consecutive qualifying weeks, the newest finishing `from` weeks ago. */
const qWeeks = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ weeksAgo: from + i, q: 3 }));

/** Fixtures that put the page in each of the four progression states. */
const STATE_FIXTURES = {
    not_eligible: qWeeks(2),
    eligible:     qWeeks(4),
    // Earned, then braked: the most recent week's sessions were all at 9.
    hold:         [{ weeksAgo: 1, q: 3, rpe: 9 }, ...qWeeks(3, 2)],
    // Two qualifying weeks, two we cannot judge, and had those two qualified
    // the member would be through. We genuinely do not know.
    unknown:      [{ weeksAgo: 1, q: 0 }, { weeksAgo: 2, away: true }, { weeksAgo: 3, away: true }, ...qWeeks(2, 4)],
};

describe('difficulty access', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const locks = (page) => page.evaluate(() => ({
        beginner: isTierLocked('beginner'), intermediate: isTierLocked('intermediate'),
        advanced: isTierLocked('advanced'), elite: isTierLocked('elite'),
        why: { advanced: getTierUnlockInfo('advanced'), elite: getTierUnlockInfo('elite') },
    }));

    test.each(Object.keys(STATE_FIXTURES))('the fixture really does produce %s', async (state) => {
        const r = await seedWeeks(app.page, STATE_FIXTURES[state]);
        expect(r.state).toBe(state);
    }, 30_000);

    test.each(Object.keys(STATE_FIXTURES))
    ('Beginner and Intermediate stay available in %s', async (state) => {
        await seedWeeks(app.page, STATE_FIXTURES[state]);
        const l = await locks(app.page);
        expect(l.beginner).toBe(false);
        expect(l.intermediate).toBe(false);
    }, 30_000);

    test('Advanced is locked when NOT_ELIGIBLE, and the reason is about work left', async () => {
        await seedWeeks(app.page, STATE_FIXTURES.not_eligible);
        const l = await locks(app.page);
        expect(l.advanced).toBe(true);
        expect(l.why.advanced).toMatch(/more solid week/i);
    }, 30_000);

    test('Advanced is locked when UNKNOWN, and is not described as a failure', async () => {
        await seedWeeks(app.page, STATE_FIXTURES.unknown);
        const l = await locks(app.page);
        expect(l.advanced).toBe(true);
        expect(l.why.advanced).toMatch(/keep logging/i);
    }, 30_000);

    test('Advanced is locked when HOLD, framed as a pause rather than a shortfall', async () => {
        await seedWeeks(app.page, STATE_FIXTURES.hold);
        const l = await locks(app.page);
        expect(l.advanced).toBe(true);
        expect(l.why.advanced).toMatch(/ease off/i);
    }, 30_000);

    test('Advanced unlocks when ELIGIBLE', async () => {
        await seedWeeks(app.page, STATE_FIXTURES.eligible);
        const l = await locks(app.page);
        expect(l.advanced).toBe(false);
        expect(l.why.advanced).toBeNull();
    }, 30_000);

    test('REGRESSION: earning Advanced does not select it', async () => {
        const after = await app.page.evaluate(() => persisted.difficulty);
        expect(after).toBe('intermediate');
    });

    test('REGRESSION: calendar time alone unlocks nothing', async () => {
        // The retired rule: diffUnlockedDate written four weeks ago by a tap
        // on Intermediate, and not one session since.
        const l = await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.progressionLedger = [];
            persisted.difficulty = 'intermediate';
            persisted.diffUnlockedDate = { intermediate: new Date(Date.now() - 60 * 864e5).toISOString() };
            persisted.firstSessionDate = new Date(Date.now() - 60 * 864e5).toISOString();
            persisted.allTimeSessionCount = 0;
            syncProgression('test');
            return { advanced: isTierLocked('advanced'), elite: isTierLocked('elite') };
        });
        expect(l.advanced).toBe(true);
        expect(l.elite).toBe(true);
    }, 30_000);

    test('REGRESSION: a huge lifetime session count grants nothing', async () => {
        const r = await app.page.evaluate(() => {
            persisted.difficulty = 'beginner';
            persisted.allTimeSessionCount = 1000;
            persisted.sessionLog = [];
            persisted.progressionLedger = [];
            persisted.diffUnlockedDate = {};
            syncProgression('test');
            return { tier: persisted.difficulty, advanced: isTierLocked('advanced'), state: currentProgression().state };
        });
        expect(r.tier).toBe('beginner');
        expect(r.advanced).toBe(true);
        expect(r.state).not.toBe('eligible');
    });

    test.each(['advanced', 'elite'])
    ('an existing %s member keeps their tier whatever the engine now says', async (tier) => {
        // Grandfathering is absolute: nothing in this phase may demote anyone.
        const r = await seedWeeks(app.page, STATE_FIXTURES.not_eligible, {
            difficulty: tier, diffUnlockedDate: { [tier]: '2024-01-01T00:00:00.000Z' }, allTimeSessionCount: 300,
        });
        const l = await locks(app.page);
        expect(r.state).toBe('not_eligible');
        expect(await app.page.evaluate(() => persisted.difficulty)).toBe(tier);
        expect(l[tier]).toBe(false);
    }, 30_000);

    test('a tier once owned survives moving down off it', async () => {
        const r = await app.page.evaluate(() => {
            persisted.progressionLedger = []; persisted.sessionLog = [];
            persisted.difficulty = 'advanced';
            persisted.diffUnlockedDate = { advanced: '2024-01-01T00:00:00.000Z' };
            setDifficulty('beginner');                       // the real production call
            return { now: persisted.difficulty, advancedStillOpen: !isTierLocked('advanced') };
        });
        expect(r.now).toBe('beginner');
        expect(r.advancedStillOpen).toBe(true);
    });

    test.each([['elite', 'advanced'], ['advanced', 'intermediate'], ['intermediate', 'beginner']])
    ('moving down from %s to %s never needs permission', async (from, to) => {
        const after = await app.page.evaluate(({ from, to }) => {
            persisted.progressionLedger = []; persisted.sessionLog = [];
            persisted.difficulty = from;
            persisted.diffUnlockedDate = {};                 // no ownership record at all
            setDifficulty(to);
            return persisted.difficulty;
        }, { from, to });
        expect(after).toBe(to);
    }, 30_000);

    test('no unlock message leaks the engine vocabulary', async () => {
        const messages = [];
        for (const state of Object.keys(STATE_FIXTURES)) {
            await seedWeeks(app.page, STATE_FIXTURES[state]);
            const l = await locks(app.page);
            messages.push(l.why.advanced, l.why.elite);
        }
        const joined = messages.filter(Boolean).join(' | ');
        expect(joined.length).toBeGreaterThan(0);
        // The engine's own words, not ordinary English ones.
        expect(joined).not.toMatch(/\b(ledger|verdict|denominator|qualifying week|rolling window)\b/i);
        expect(joined).not.toMatch(/\b(UNKNOWN|NOT_ELIGIBLE|ELIGIBLE|HOLD)\b/);
    }, 60_000);
});

describe('elite', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Recent sessions carrying EQ ratings, newest last. */
    const withEq = (page, eqs) => page.evaluate((eqs) => {
        eqs.forEach((eq, i) => {
            const d = new Date(); d.setDate(d.getDate() - (eqs.length - i));
            persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length', eq });
        });
        return { elite: isTierLocked('elite'), why: getTierUnlockInfo('elite') };
    }, eqs);

    test('eligibility alone does not open it: Advanced has to have been reached', async () => {
        await seedWeeks(app.page, qWeeks(4));
        const r = await withEq(app.page, [10, 10, 10, 10]);
        expect(r.elite).toBe(true);
        expect(r.why).toMatch(/reach advanced first/i);
    }, 30_000);

    test('owning Advanced is not enough on its own without eligibility', async () => {
        await seedWeeks(app.page, qWeeks(2), { diffUnlockedDate: { advanced: '2024-01-01T00:00:00.000Z' } });
        const r = await withEq(app.page, [10, 10, 10, 10]);
        expect(r.elite).toBe(true);
    }, 30_000);

    test('REGRESSION: calendar time on Advanced does not open it', async () => {
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.progressionLedger = [];
            persisted.difficulty = 'advanced';
            persisted.diffUnlockedDate = { advanced: new Date(Date.now() - 365 * 864e5).toISOString() };
            return isTierLocked('elite');
        });
        expect(r).toBe(true);
    });

    test('Advanced plus eligibility still needs the EQ condition', async () => {
        await seedWeeks(app.page, qWeeks(4), { diffUnlockedDate: { advanced: '2024-01-01T00:00:00.000Z' } });
        const r = await withEq(app.page, [6, 6, 6, 6]);
        expect(r.elite).toBe(true);
        expect(r.why).toMatch(/average EQ/i);
    }, 30_000);

    test('REGRESSION: too little EQ data is not a pass', async () => {
        await seedWeeks(app.page, qWeeks(4), { diffUnlockedDate: { advanced: '2024-01-01T00:00:00.000Z' } });
        const r = await withEq(app.page, [10, 10]);          // two ratings, minimum is three
        expect(r.elite).toBe(true);
    }, 30_000);

    test('all three conditions together open it', async () => {
        await seedWeeks(app.page, qWeeks(4), { diffUnlockedDate: { advanced: '2024-01-01T00:00:00.000Z' } });
        const r = await withEq(app.page, [10, 10, 9]);
        expect(r.elite).toBe(false);
        expect(r.why).toBeNull();
    }, 30_000);

    test('an existing Elite member is never revoked, even with no EQ data at all', async () => {
        await seedWeeks(app.page, STATE_FIXTURES.not_eligible, {
            difficulty: 'elite', diffUnlockedDate: { elite: '2024-01-01T00:00:00.000Z' },
        });
        const r = await app.page.evaluate(() => ({ locked: isTierLocked('elite'), tier: persisted.difficulty }));
        expect(r.locked).toBe(false);
        expect(r.tier).toBe('elite');
    }, 30_000);
});

describe('deload follows accumulated work, not the calendar', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a member with no history is not in a deload week', async () => {
        expect((await seedWeeks(app.page, [])).deload).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: four banked weeks, and the next week is a deload week from day one', async () => {
        // The whole point of the Phase 2B.2 correction. The member opens the
        // app on the first day of the fifth week, before any session, and
        // the reduction is already in force.
        const fresh = await seedWeeks(app.page, qWeeks(4), {}, { live: 0 });
        expect(fresh.accumulated).toBe(4);
        expect(fresh.deload).toBe(true);
        expect(await app.page.evaluate(() => applyDeload({ sets: 4, duration: 60 })))
            .toMatchObject({ sets: 3, duration: 36 });

        // And it does not change as that week fills.
        const partway = await seedWeeks(app.page, qWeeks(4), {}, { live: 3 });
        expect(partway.liveDays).toBeGreaterThanOrEqual(1);
        expect(partway.accumulated).toBe(4);
        expect(partway.deload).toBe(true);
    }, 60_000);

    test('three banked weeks are not a deload week', async () => {
        const r = await seedWeeks(app.page, qWeeks(3), {}, { live: 0 });
        expect(r.accumulated).toBe(3);
        expect(r.deload).toBe(false);
    }, 30_000);

    test('a member doing exactly the minimum still gets the whole following week', async () => {
        // The schedule targets four sessions, so three is the minimum that
        // qualifies. Under the old rule this member got no deload at all,
        // because the live week never reached a qualifying verdict before
        // their last session of it.
        const r = await seedWeeks(app.page, qWeeks(4), {}, { live: 0 });
        const banked = r.ledger.filter(w => w.verdict === 'qualified');
        expect(banked).toHaveLength(4);
        for (const w of banked) {
            expect(w.qualifyingSessions).toBe(3);
            expect(w.targetSessions).toBe(4);
        }
        expect(r.deload).toBe(true);
    }, 30_000);

    test('the deload week discharges the cycle as it elapses', async () => {
        const r = await seedWeeks(app.page, qWeeks(5), {}, { live: 0 });
        expect(r.accumulated).toBe(0);
        expect(r.deload).toBe(false);
    }, 30_000);

    /**
     * DISCHARGE. A deload week is one calendar week and is spent by
     * elapsing, not by being trained well. These are the three cases the
     * product rule names, each driven through the page's own isDeloadWeek().
     */
    test.each([
        ['one mechanical session', 1],
        ['no sessions at all', 0],
        ['a full qualifying week', 3],
    ])('DISCHARGE: a deload week with %s does not repeat', async (_label, sessions) => {
        const r = await seedWeeks(app.page, [
            ...qWeeks(4, 2),
            { weeksAgo: 1, q: sessions },        // the deload week, now elapsed
        ], {}, { live: 0 });
        expect(r.accumulated).toBe(0);
        expect(r.deload).toBe(false);
    }, 30_000);

    test('REGRESSION: a quiet deload week does not reduce the following weeks too', async () => {
        // The retired behaviour. Pausing alone left the count at four, so
        // every later week read as a deload until one qualified, which is a
        // reduced-workload loop a member could not get out of by resting.
        const r = await seedWeeks(app.page, [
            ...qWeeks(4, 3),
            { weeksAgo: 2, q: 0 },               // deload week, untrained
            { weeksAgo: 1, q: 0 },               // and another quiet week
        ], {}, { live: 0 });
        expect(r.deload).toBe(false);
        expect(await app.page.evaluate(() => applyDeload({ sets: 4, duration: 60 })))
            .toMatchObject({ sets: 4, duration: 60 });
    }, 30_000);

    test('and the cycle then builds again from zero', async () => {
        // Discharged, then four fresh qualifying weeks, and the reduction
        // comes back round. It is a cycle, not a one-off.
        const r = await seedWeeks(app.page, [
            ...qWeeks(4, 6), { weeksAgo: 5, q: 0 }, ...qWeeks(4),
        ], {}, { live: 0 });
        expect(r.accumulated).toBe(4);
        expect(r.deload).toBe(true);
    }, 30_000);

    test('a poor week before the trigger still only pauses', async () => {
        // Discharge applies to the deload week, not to every bad week.
        const r = await seedWeeks(app.page, [
            ...qWeeks(3, 3), { weeksAgo: 2, q: 1 }, { weeksAgo: 1, q: 3 },
        ], {}, { live: 0 });
        expect(r.accumulated).toBe(4);
        expect(r.deload).toBe(true);
    }, 30_000);

    test('REGRESSION: the ISO calendar week does not decide it', async () => {
        // Both of these run inside the same real calendar week, so the only
        // thing that differs is accumulated qualifying work. That is the
        // regression against `getISOWeek() % 4 === 0`.
        expect((await seedWeeks(app.page, qWeeks(3))).deload).toBe(false);
        expect((await seedWeeks(app.page, qWeeks(4))).deload).toBe(true);
    }, 60_000);

    test('a poor week pauses the count rather than resetting it', async () => {
        // Three qualifying, a week of one session, then a qualifying week.
        // Paused banks four and is a deload week. A reset would bank one and
        // counting the poor week would bank five, and neither is one.
        const r = await seedWeeks(app.page, [
            ...qWeeks(3, 3), { weeksAgo: 2, q: 1 }, { weeksAgo: 1, q: 3 },
        ]);
        expect(r.deload).toBe(true);
    }, 30_000);

    test('a neutral all-rest week does not advance it', async () => {
        const r = await seedWeeks(app.page, [
            ...qWeeks(3, 3), { weeksAgo: 2, rest: true }, { weeksAgo: 1, q: 3 },
        ]);
        expect(r.ledger.some(w => w.verdict === 'neutral')).toBe(true);
        expect(r.deload).toBe(true);                 // four, not five
    }, 30_000);

    test('a week we cannot judge does not advance it', async () => {
        const r = await seedWeeks(app.page, [
            ...qWeeks(3, 3), { weeksAgo: 2, away: true }, { weeksAgo: 1, q: 3 },
        ]);
        expect(r.ledger.some(w => w.verdict === 'unknown')).toBe(true);
        expect(r.deload).toBe(true);
    }, 30_000);

    test('REGRESSION: a week of Recovery does not advance it', async () => {
        const r = await seedWeeks(app.page, [
            ...qWeeks(3, 3), { weeksAgo: 2, recovery: 3 }, { weeksAgo: 1, q: 3 },
        ]);
        expect(r.deload).toBe(true);                 // four, not five
    }, 30_000);

    test('a substituted mission still advances it', async () => {
        const r = await seedWeeks(app.page, [
            ...qWeeks(3, 2), { weeksAgo: 1, q: 3, type: 'girth' },
        ]);
        expect(r.accumulated).toBe(4);
        expect(r.deload).toBe(true);
    }, 30_000);

    test("REGRESSION: the brief's stale case, four weeks then a long gap", async () => {
        // Four qualifying weeks, well over 28 days of nothing, then one
        // qualifying week back. Accumulation restarts, so the week after
        // the return is an ordinary training week.
        const r = await seedWeeks(app.page, [...qWeeks(4, 11), { weeksAgo: 1, q: 3 }]);
        expect(r.accumulated).toBe(1);
        expect(r.deload).toBe(false);
    }, 30_000);

    test('and after the reset it takes four fresh weeks, not one', async () => {
        const r = await seedWeeks(app.page, [...qWeeks(4, 11), ...qWeeks(4)]);
        expect(r.accumulated).toBe(4);
        expect(r.deload).toBe(true);
    }, 30_000);

    test('someone currently away is not in a deload week', async () => {
        const r = await seedWeeks(app.page, qWeeks(4, 11));
        expect(r.accumulated).toBe(0);
        expect(r.deload).toBe(false);
    }, 30_000);

    test('REGRESSION: spending a Recovery Pass does not move deload timing', async () => {
        // A Pass covers a missed day for reminders and messaging. It may not
        // bring the reduction forward, nor push it back.
        const before = await seedWeeks(app.page, qWeeks(3), {}, { live: 1 });
        expect(before.deload).toBe(false);
        const after = await app.page.evaluate(() => {
            persisted.streakPasses = 2;
            persisted.passProtectedDates = [];
            /* Yesterday untrained, the day before trained, so a Pass applies.
               The first half of that was only ever a comment: seedWeeks with
               { live: 1 } seeds one session on MONDAY of the current week, and
               on a Tuesday Monday is yesterday, so maybeConsumeStreakPass()
               exited at its first guard with nothing to cover and this test
               failed on Tuesdays only. The fixture now makes the condition it
               claims to test actually true. */
            persisted.sessionLog = persisted.sessionLog.filter(
                s => !s.date.startsWith(_dayKey(1)));
            const d = new Date(); d.setDate(d.getDate() - 2);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
            const consumed = maybeConsumeStreakPass();
            syncProgression('test');
            return { consumed, protectedDays: persisted.passProtectedDates.length, deload: isDeloadWeek(),
                     accumulated: window.BP.deloadState(persisted.progressionLedger, persisted.sessionLog, { now: new Date() }).accumulated };
        });
        expect(after.consumed).toBe(true);
        expect(after.protectedDays).toBe(1);
        expect(after.accumulated).toBe(3);
        expect(after.deload).toBe(false);

        // And it cannot delay one that is due either.
        const due = await seedWeeks(app.page, qWeeks(4), {}, { live: 1 });
        expect(due.deload).toBe(true);
        /* Same precondition, and the consumed assertion is new. Without it
           this half asserted that a due deload stays due while, on a Tuesday,
           no Pass had been spent at all. It was vacuous rather than wrong,
           which is worse. */
        const delayed = await app.page.evaluate(() => {
            persisted.streakPasses = 2; persisted.passProtectedDates = [];
            persisted.sessionLog = persisted.sessionLog.filter(
                s => !s.date.startsWith(_dayKey(1)));
            const d = new Date(); d.setDate(d.getDate() - 2);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
            const consumed = maybeConsumeStreakPass();
            syncProgression('test');
            return { consumed, deload: isDeloadWeek() };
        });
        expect(delayed.consumed).toBe(true);
        expect(delayed.deload).toBe(true);
    }, 60_000);

    test('when it is off, the prescription is untouched', async () => {
        await seedWeeks(app.page, qWeeks(3));
        const r = await app.page.evaluate(() => applyDeload({ sets: 4, duration: 60 }));
        expect(r).toMatchObject({ sets: 4, duration: 60 });
    }, 30_000);
});

describe('one deload answer, read by everything that mentions it', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /**
     * nextBestAction() used to carry its own copy of the retired
     * `getISOWeek % 4` rule, gated on firstSessionDate. It decided what the
     * Today card SAID and what duration it showed, while the ledger decided
     * what the session actually DID, and the two disagreed most weeks. The
     * resolver now takes the answer as an input.
     */
    const readAll = (page) => page.evaluate(() => {
        renderDashboard();
        const r = window.BP.nextBestAction(buildResolverInput());
        return {
            engine: isDeloadWeek(),
            resolver: r.modifiers.deload,
            saysSo: r.changes.join(' '),
            duration: r.duration,
            banner: !document.getElementById('deload-banner').classList.contains('hidden'),
            prescription: applyDeload({ sets: 4, duration: 60 }),
        };
    });

    /* Every day is a training day, so the fixture does not depend on the
       weekday the suite runs on. That makes the target seven and the bar to
       qualify six, so these weeks are seeded full rather than with the three
       that qualify against the usual four-session schedule. */
    const EVERY_DAY = { schedule: ['length', 'length', 'length', 'length', 'length', 'length', 'length'] };
    const fullWeeks = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ weeksAgo: from + i, q: 7 }));

    test('on a deload week they all agree it is on', async () => {
        await seedWeeks(app.page, fullWeeks(4), EVERY_DAY, { live: 0 });
        const r = await readAll(app.page);
        expect(r.engine).toBe(true);
        expect(r.resolver).toBe(true);
        expect(r.saysSo).toMatch(/deload/i);
        expect(r.prescription).toMatchObject({ sets: 3, duration: 36 });
        expect(r.banner).toBe(true);
    }, 30_000);

    test('on an ordinary week they all agree it is off', async () => {
        await seedWeeks(app.page, fullWeeks(3), EVERY_DAY, { live: 0 });
        const r = await readAll(app.page);
        expect(r.engine).toBe(false);
        expect(r.resolver).toBe(false);
        expect(r.saysSo).not.toMatch(/deload/i);
        expect(r.prescription).toMatchObject({ sets: 4, duration: 60 });
        expect(r.banner).toBe(false);
    }, 30_000);

    test('the duration the member is shown moves with it', async () => {
        await seedWeeks(app.page, fullWeeks(3), EVERY_DAY, { live: 0 });
        const normal = (await readAll(app.page)).duration;
        await seedWeeks(app.page, fullWeeks(4), EVERY_DAY, { live: 0 });
        const reduced = (await readAll(app.page)).duration;
        expect(normal).toBeGreaterThan(0);
        expect(reduced).toBeLessThan(normal);
    }, 60_000);

    test('REGRESSION: the resolver no longer computes it from the calendar', async () => {
        // firstSessionDate was the old gate's input. It must now change
        // nothing, on a week the retired rule would have called a deload.
        const r = await app.page.evaluate(() => {
            persisted.firstSessionDate = '2020-01-01T00:00:00.000Z';   // years of history
            const input = buildResolverInput();
            return {
                passesFirstSession: 'firstSessionDate' in input,
                deloadInInput: input.deload,
                resolver: window.BP.nextBestAction(input).modifiers.deload,
                engine: isDeloadWeek(),
            };
        });
        expect(r.passesFirstSession).toBe(false);
        expect(r.deloadInInput).toBe(r.engine);
        expect(r.resolver).toBe(r.engine);
    }, 30_000);

    test('the banner says it is planned, not that something is wrong', async () => {
        await seedWeeks(app.page, fullWeeks(4), EVERY_DAY, { live: 0 });
        const copy = await app.page.evaluate(() => {
            renderDashboard();
            return document.getElementById('deload-banner').textContent;
        });
        expect(copy).toMatch(/on purpose/i);
        expect(copy).toMatch(/back to normal next week/i);
        // No fatigue, injury or decline framing, and no engine vocabulary.
        expect(copy).not.toMatch(/fatigue|injur|overtrain|recover(y|ed)|decline|damage/i);
        expect(copy).not.toMatch(/\b(ledger|verdict|denominator|qualifying week)\b/i);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});

describe('the streak no longer decides anything', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('REGRESSION: a long daily run grants no tier and no deload', async () => {
        const r = await app.page.evaluate(() => {
            persisted.progressionLedger = []; persisted.difficulty = 'intermediate';
            persisted.diffUnlockedDate = {};
            persisted.sessionLog = Array.from({ length: 30 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - i);
                return { date: d.toISOString(), routineType: 'length' };
            }).reverse();
            // Thirty consecutive days of training, which under the retired
            // rule was a 30 day streak and a tier nudge. It buys nothing.
            return { days: new Set(persisted.sessionLog.map(e => e.date.split('T')[0])).size,
                     advanced: isTierLocked('advanced'), deload: isDeloadWeek() };
        });
        expect(r.days).toBeGreaterThanOrEqual(30);
        expect(r.advanced).toBe(true);
        expect(r.deload).toBe(false);
    }, 30_000);

    test('the streak calculation is gone from the page entirely', async () => {
        // Phase 2B.2. It had no callers after 2B.1 and was kept only as the
        // parity anchor for the server's streak warning. That warning is
        // retired, so both sides of the parity are deleted.
        const found = await app.page.evaluate(() => {
            const src = [...document.querySelectorAll('script')].map(s => s.textContent).join('\n');
            return {
                decl: /function\s+getCurrentStreak/.test(src),
                calls: (src.match(/getCurrentStreak\s*\(/g) || []).length,
                defined: typeof window.getCurrentStreak,
            };
        });
        expect(found.decl).toBe(false);
        expect(found.calls).toBe(0);
        expect(found.defined).toBe('undefined');
    });

    test('records.longestStreak is frozen across a real completion', async () => {
        const r = await reset(app.page, { records: { longestStreak: 11, bestWeekXp: 0, bestSessionXp: 0 } });
        expect(r).toBeTruthy();
        await finish(app.page, 'length', { eq: 8, rpe: 5 });
        expect(await app.page.evaluate(() => persisted.records.longestStreak)).toBe(11);
    }, 30_000);

    test('the Full Week milestone is earned by a qualifying week, not by seven days', async () => {
        const daily = await app.page.evaluate(() => {
            persisted.progressionLedger = [];
            persisted.sessionLog = Array.from({ length: 9 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - i);
                return { date: d.toISOString(), routineType: 'length' };
            }).reverse();
            return MILESTONES.find(m => m.id === 'streak_7').trigger(persisted);
        });
        expect(daily).toBe(false);
        await seedWeeks(app.page, qWeeks(1));
        const earned = await app.page.evaluate(() => MILESTONES.find(m => m.id === 'streak_7').trigger(persisted));
        expect(earned).toBe(true);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});

/**
 * The Recovery Pass regression, on every weekday.
 *
 * The test above failed on Tuesdays and only on Tuesdays, for eight months,
 * because seedWeeks({ live: 1 }) seeds its one live session on MONDAY of the
 * current week and on a Tuesday Monday is yesterday. maybeConsumeStreakPass()
 * then exited at its first guard with nothing to cover, and the assertion
 * that a Pass was spent was false. Nothing in the fixture made its own stated
 * precondition true.
 *
 * Fixing the fixture is not enough on its own: the next fixture to seed a
 * relative day would reintroduce it, and the failure would again be invisible
 * six days out of seven. So the scenario runs against a pinned clock, stepped
 * through a full week.
 *
 * Date.UTC and timezoneId 'UTC' rather than the at() helper in
 * tests/e2e/clock-boundaries.test.js, which builds a LOCAL Date in the test
 * process. Pinning both ends to UTC is what makes the weekday the only
 * variable: at UTC+13 a local-noon fixture lands on the previous UTC day and
 * the sweep would quietly test the wrong days. Noon for the same reason the
 * shared week helper anchors at noon.
 *
 * This says nothing about whether the day boundary itself is in the right
 * place. _dayKey() derives its key from toISOString(), so the Pass boundary
 * is midnight UTC rather than the member's own midnight, while
 * src/liveness.js already exports localDayKey(). That is a production
 * question with session_log, pass_protected_dates, last_pass_earned_date,
 * messaging and the notification rules all reading the same contract, and it
 * is carried as debt rather than touched from a test.
 */
describe('spending a Recovery Pass works on every weekday', () => {
    const atUtc = (y, m, d, h) => new Date(Date.UTC(y, m, d, h, 0, 0));
    const MONDAY = atUtc(2026, 2, 9, 12);          // 2026-03-09 is a Monday
    const DAY = 86400000;
    const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    let app;
    beforeAll(async () => {
        app = await openApp({ clock: MONDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: UID });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /* Every case establishes ALL of its own preconditions. seedWeeks resets
       the session log, the ledger, the schedule, difficulty and the counts,
       but NOT streakPasses or passProtectedDates, so one iteration could
       otherwise be reading state the previous one left behind. */
    const spendOn = async (offsetDays) => {
        await app.page.clock.setFixedTime(new Date(MONDAY.getTime() + offsetDays * DAY));
        await seedWeeks(app.page, qWeeks(3), {}, { live: 1 });
        return app.page.evaluate(() => {
            persisted.streakPasses = 2;                 // 4. banked Passes
            persisted.passProtectedDates = [];          // 5. none spent yet
            persisted.sessionLog = persisted.sessionLog // 2. yesterday untrained
                .filter(s => !s.date.startsWith(_dayKey(1)));
            const d = new Date(); d.setDate(d.getDate() - 2);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' }); // 3.
            const consumed = maybeConsumeStreakPass();  // 6.
            syncProgression('test');
            return {
                consumed,
                protectedDays: persisted.passProtectedDates.length,
                protecting: persisted.passProtectedDates[0],
                yesterday: _dayKey(1),
                weekday: new Date().getDay(),
                passesLeft: persisted.streakPasses,
                deload: isDeloadWeek(),
                accumulated: window.BP.deloadState(persisted.progressionLedger,
                    persisted.sessionLog, { now: new Date() }).accumulated,
            };
        });
    };

    test('the clock is pinned to the Monday the sweep starts from', async () => {
        /* If this is not a Monday the offsets below name the wrong days and
           every assertion after it is measuring something else. */
        await app.page.clock.setFixedTime(MONDAY);
        const d = await app.page.evaluate(() => ({ day: new Date().getDay(), key: _dayKey(0) }));
        expect(d).toEqual({ day: 1, key: '2026-03-09' });
    }, 30_000);

    test.each(NAMES.map((name, i) => [name, i]))('%s', async (name, offset) => {
        const r = await spendOn(offset);
        expect(r.weekday, `${name} is not the day the offset claims`)
            .toBe((1 + offset) % 7);
        expect(r.consumed, `no Pass was spent on ${name}`).toBe(true);
        expect(r.protectedDays).toBe(1);
        expect(r.protecting).toBe(r.yesterday);
        expect(r.passesLeft).toBe(1);
        expect(r.accumulated).toBe(3);
        expect(r.deload).toBe(false);
    }, 30_000);

    test('the page threw nothing across the week', () => {
        expect(app.errors).toEqual([]);
    });
});
