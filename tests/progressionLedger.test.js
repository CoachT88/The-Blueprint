import { describe, test, expect } from 'vitest';
import {
    reconcileLedger, pruneLedger, recentWeeks, requiredLedgerWeeks,
    progressionEligibility, deloadState, canProgress,
    WEEK_VERDICT, weekQualified, weekIsMemberFacingMiss, normaliseLedger,
} from '../src/progressionLedger.js';
import { toleranceHolds } from '../src/progression.js';
import { getCurrentWeekKey } from '../src/weekUtils.js';
import { PROGRESSION_POLICY, withPolicy } from '../src/progressionPolicy.js';

/**
 * The ledger exists because the session log cannot say what was SCHEDULED
 * in a past week, and applying today's schedule backwards would invent a
 * target that week never had.
 *
 * Most of this file is about two guarantees: a recorded week is never
 * reinterpreted, and the deload counter is derived rather than stored, so
 * neither pruning nor a long absence can corrupt it.
 */

const DAY = 86400000;
const NOW = new Date(2025, 5, 15, 12, 0, 0);          // Sunday 15 June 2025
const SCHEDULE_4 = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const SCHEDULE_3 = ['length', 'rest', 'stamina', 'rest', 'length', 'rest', 'rest'];

const at = (d) => new Date(NOW.getTime() - d * DAY);
const key = (d) => getCurrentWeekKey(at(d));
/** A qualifying session `d` days before NOW. */
const S = (d, routineType = 'length', extra = {}) => ({ date: at(d).toISOString(), routineType, ...extra });

/** Sessions on `count` distinct days inside the week `weeksBack` ago. */
function sessionsInWeek(weeksBack, count, routineType = 'length') {
    return Array.from({ length: count }, (_, i) => S(weeksBack * 7 + i, routineType));
}

/** Reconcile as if the app were opened on each of a series of past weeks. */
function simulate(weeks, { schedule = SCHEDULE_4, policy } = {}) {
    // weeks: [{ weeksBack, sessions, schedule? }] oldest first
    let ledger = [];
    let log = [];
    for (const w of [...weeks].sort((a, b) => b.weeksBack - a.weeksBack)) {
        log = [...log, ...sessionsInWeek(w.weeksBack, w.sessions)];
        const when = at(w.weeksBack * 7);
        ledger = reconcileLedger(ledger, {
            weekKey: getCurrentWeekKey(when),
            schedule: w.schedule || schedule,
            sessionLog: log, now: when, policy,
        });
    }
    return { ledger, log };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
describe('the ledger row holds immutable weekly facts only', () => {
    test('exactly four fields, and no running total', () => {
        const { ledger } = simulate([{ weeksBack: 0, sessions: 3 }]);
        expect(Object.keys(ledger[0]).sort())
            .toEqual(['qualifyingSessions', 'targetSessions', 'verdict', 'weekKey']);
        // cumulativeQualified counted lifetime weeks while deload needs
        // weeks since the last reset, so a 60-day absence could not clear
        // it. Derived instead; see deloadState.
        expect(ledger[0]).not.toHaveProperty('cumulativeQualified');
    });

    test('it records the target that was true at the time', () => {
        const { ledger } = simulate([{ weeksBack: 0, sessions: 2, schedule: SCHEDULE_3 }]);
        expect(ledger[ledger.length - 1]).toMatchObject({ targetSessions: 3, qualifyingSessions: 2, verdict: WEEK_VERDICT.QUALIFIED });
    });
});

// ---------------------------------------------------------------------------
// Finalisation
// ---------------------------------------------------------------------------
describe('finalisation: a week is final once it stops being the current week', () => {
    test('REGRESSION: a later schedule change never re-judges a recorded week', () => {
        // Week 2 on a 3-session schedule, 2 done -> qualified.
        // Then the member moves to a 4-session schedule. Under the old
        // current-schedule assumption week 2 would become 2-of-4 and fail.
        const { ledger } = simulate([
            { weeksBack: 2, sessions: 2, schedule: SCHEDULE_3 },
            { weeksBack: 1, sessions: 3, schedule: SCHEDULE_4 },
            { weeksBack: 0, sessions: 3, schedule: SCHEDULE_4 },
        ]);
        const wk2 = ledger.find(r => r.weekKey === key(14));
        expect(wk2).toMatchObject({ targetSessions: 3, verdict: WEEK_VERDICT.QUALIFIED });
    });

    test('the live week is re-recorded as it fills', () => {
        const wk = getCurrentWeekKey(NOW);
        let ledger = reconcileLedger([], { weekKey: wk, schedule: SCHEDULE_4, sessionLog: [S(0)], now: NOW });
        expect(ledger[ledger.length - 1]).toMatchObject({ qualifyingSessions: 1, verdict: WEEK_VERDICT.MISSED });

        ledger = reconcileLedger(ledger, { weekKey: wk, schedule: SCHEDULE_4, sessionLog: [S(0), S(1), S(2)], now: NOW });
        expect(ledger[ledger.length - 1]).toMatchObject({ qualifyingSessions: 3, verdict: WEEK_VERDICT.QUALIFIED });
        expect(ledger.filter(r => r.weekKey === wk)).toHaveLength(1);
    });

    test('completing early then missing the rest still reflects the week as it ended', () => {
        // Three sessions on days 6,5,4 of the week, nothing after. The week
        // qualified when it qualified; later inactivity does not revoke it.
        const wk = getCurrentWeekKey(NOW);
        const ledger = reconcileLedger([], { weekKey: wk, schedule: SCHEDULE_4, sessionLog: [S(4), S(5), S(6)], now: NOW });
        expect(weekQualified(ledger[ledger.length - 1])).toBe(true);
    });

    test('a schedule changed mid-week takes the target as of the last save that week', () => {
        const wk = getCurrentWeekKey(NOW);
        let ledger = reconcileLedger([], { weekKey: wk, schedule: SCHEDULE_4, sessionLog: [S(0), S(1)], now: NOW });
        expect(ledger[ledger.length - 1]).toMatchObject({ targetSessions: 4, verdict: WEEK_VERDICT.MISSED });
        ledger = reconcileLedger(ledger, { weekKey: wk, schedule: SCHEDULE_3, sessionLog: [S(0), S(1)], now: NOW });
        expect(ledger[ledger.length - 1]).toMatchObject({ targetSessions: 3, verdict: WEEK_VERDICT.QUALIFIED });
    });

    test('there is no separate finalise step that can be missed', () => {
        // Rolling over without the app being open at the boundary still
        // leaves the old week recorded exactly as it was.
        const { ledger } = simulate([{ weeksBack: 1, sessions: 3 }]);
        const before = ledger.find(r => r.weekKey === key(7));
        const after = reconcileLedger(ledger, {
            weekKey: getCurrentWeekKey(NOW), schedule: SCHEDULE_3,
            sessionLog: sessionsInWeek(1, 3), now: NOW,
        });
        expect(after.find(r => r.weekKey === key(7))).toEqual(before);
    });
});

// ---------------------------------------------------------------------------
// Weeks away
// ---------------------------------------------------------------------------
describe('weeks the app was never opened in', () => {
    test('they take a calendar slot without being judged', () => {
        const { ledger } = simulate([{ weeksBack: 3, sessions: 3 }, { weeksBack: 0, sessions: 3 }]);
        const gap = ledger.filter(r => r.weekKey === key(14) || r.weekKey === key(7));
        expect(gap).toHaveLength(2);
        for (const g of gap) {
            expect(g.targetSessions).toBeNull();          // never invented
            expect(g.qualifyingSessions).toBe(0);
            expect(g.verdict).toBe(WEEK_VERDICT.UNKNOWN);
            expect(weekQualified(g)).toBe(false);         // earns nothing
        }
    });

    test('REGRESSION: a gap week is never a member-facing missed week', () => {
        // We do not know what was asked of them that week, so calling it a
        // miss would penalise a hole in our records, not their training.
        const { ledger } = simulate([{ weeksBack: 3, sessions: 3 }, { weeksBack: 0, sessions: 3 }]);
        const gaps = ledger.filter(r => r.verdict === WEEK_VERDICT.UNKNOWN);
        expect(gaps.length).toBeGreaterThan(0);
        for (const g of gaps) expect(weekIsMemberFacingMiss(g)).toBe(false);
    });

    test('a genuinely missed week against a known target IS one', () => {
        // The complement: when the target was recorded, a shortfall is real
        // and may be shown as such.
        const { ledger } = simulate([{ weeksBack: 1, sessions: 1 }]);
        const wk = ledger.find(w => w.weekKey === key(7));
        expect(wk.verdict).toBe(WEEK_VERDICT.MISSED);
        expect(weekIsMemberFacingMiss(wk, getCurrentWeekKey(NOW))).toBe(true);
    });

    test('REGRESSION: the week in progress is never a missed week', () => {
        // The live row is recomputed as the week fills, so a four-session
        // week reads as `missed` from Monday until the third session lands.
        // Right for the gate, wrong as copy: nobody has missed a week they
        // are still in.
        const { ledger } = simulate([{ weeksBack: 0, sessions: 1 }]);
        const live = ledger[ledger.length - 1];
        expect(live.weekKey).toBe(getCurrentWeekKey(NOW));
        expect(live.verdict).toBe(WEEK_VERDICT.MISSED);          // correct for the gate
        expect(weekIsMemberFacingMiss(live, getCurrentWeekKey(NOW))).toBe(false);
        // and it still earns nothing, which is the gate's business
        expect(weekQualified(live)).toBe(false);
    });

    test('REGRESSION: absent weeks cannot be skipped to assemble eligibility', () => {
        // Four good weeks spread over eight months, only opening the app in
        // the good ones. Without gap rows the window would hold four
        // qualifying weeks and open the gate.
        const { ledger } = simulate([
            { weeksBack: 24, sessions: 3 }, { weeksBack: 16, sessions: 3 },
            { weeksBack: 8, sessions: 3 }, { weeksBack: 0, sessions: 3 },
        ]);
        expect(progressionEligibility(ledger).eligible).toBe(false);
    });

    test('multiple rollovers between launches are all accounted for', () => {
        const { ledger } = simulate([{ weeksBack: 5, sessions: 3 }, { weeksBack: 0, sessions: 3 }]);
        for (const d of [28, 21, 14, 7]) {
            expect(ledger.some(r => r.weekKey === key(d)), `week ${d}d back`).toBe(true);
        }
    });

    test('weeks before the member existed are not invented', () => {
        // A brand new member must not look like they already failed 25 weeks.
        const ledger = reconcileLedger([], {
            weekKey: getCurrentWeekKey(NOW), schedule: SCHEDULE_4, sessionLog: [S(0)], now: NOW,
        });
        expect(ledger).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Bounded growth
// ---------------------------------------------------------------------------
describe('bounded growth', () => {
    test('the ledger never exceeds the policy limit', () => {
        const { ledger } = simulate(Array.from({ length: 40 }, (_, i) => ({ weeksBack: i, sessions: 3 })));
        expect(ledger.length).toBeLessThanOrEqual(PROGRESSION_POLICY.ledgerMaxWeeks);
    });

    test('pruning keeps the newest', () => {
        const { ledger } = simulate(Array.from({ length: 40 }, (_, i) => ({ weeksBack: i, sessions: 3 })));
        expect(ledger[ledger.length - 1].weekKey).toBe(getCurrentWeekKey(NOW));
    });

    test('pruneLedger is idempotent and tolerant', () => {
        const { ledger } = simulate([{ weeksBack: 0, sessions: 3 }]);
        expect(pruneLedger(pruneLedger(ledger))).toEqual(pruneLedger(ledger));
        expect(pruneLedger(null)).toEqual([]);
    });

    test('the bound is policy-controlled', () => {
        const tiny = withPolicy({ ledgerMaxWeeks: 3 });
        const { ledger } = simulate(
            Array.from({ length: 10 }, (_, i) => ({ weeksBack: i, sessions: 3 })), { policy: tiny });
        expect(ledger).toHaveLength(3);
    });

    test('junk input does not throw', () => {
        expect(reconcileLedger(null, {})).toBeInstanceOf(Array);
        expect(reconcileLedger([{ nonsense: 1 }, null], { now: NOW, sessionLog: null, schedule: null })).toBeInstanceOf(Array);
    });
});

// ---------------------------------------------------------------------------
// Derivability
// ---------------------------------------------------------------------------
describe('deload is derivable from the bounded ledger', () => {
    test('REGRESSION: the retained window is long enough for a full cycle', () => {
        // The stale rule caps how long a deload cycle can take, so the
        // counter can always be recomputed from retained rows. If a policy
        // change breaks that, this fails rather than quietly miscounting.
        expect(requiredLedgerWeeks()).toBe(21);
        expect(PROGRESSION_POLICY.ledgerMaxWeeks).toBeGreaterThanOrEqual(requiredLedgerWeeks());
    });

    test('and the requirement tracks the policy', () => {
        expect(requiredLedgerWeeks(withPolicy({ deloadEveryQualifyingWeeks: 3 }))).toBe(3 + 2 * 4);
        expect(requiredLedgerWeeks(withPolicy({ deloadStaleResetDays: 14 }))).toBe(5 + 4 * 2);
    });
});

describe('deload counting', () => {
    const consecutive = (n) => simulate(Array.from({ length: n }, (_, i) => ({ weeksBack: i, sessions: 3 })));

    test('the fifth qualifying week is the deload week', () => {
        const { ledger, log } = consecutive(5);
        const r = deloadState(ledger, log, { now: NOW });
        expect(r.accumulated).toBe(5);
        expect(r.isDeloadWeek).toBe(true);
    });

    test('the fourth is not', () => {
        const { ledger, log } = consecutive(4);
        expect(deloadState(ledger, log, { now: NOW }).isDeloadWeek).toBe(false);
    });

    test('a non-qualifying week pauses rather than resetting', () => {
        const { ledger, log } = simulate([
            { weeksBack: 4, sessions: 3 }, { weeksBack: 3, sessions: 3 },
            { weeksBack: 2, sessions: 1 },                       // poor week
            { weeksBack: 1, sessions: 3 }, { weeksBack: 0, sessions: 3 },
        ]);
        expect(deloadState(ledger, log, { now: NOW }).accumulated).toBe(4);
    });

    test('the deload week itself must be a qualifying week', () => {
        const { ledger, log } = simulate([
            ...Array.from({ length: 5 }, (_, i) => ({ weeksBack: i + 1, sessions: 3 })),
            { weeksBack: 0, sessions: 1 },
        ]);
        const r = deloadState(ledger, log, { now: NOW });
        expect(r.accumulated).toBe(5);
        expect(r.isDeloadWeek).toBe(false);
    });

    test('it survives pruning, because it is derived not stored', () => {
        const { ledger, log } = consecutive(30);
        const r = deloadState(ledger, log, { now: NOW });
        // Everything retained qualified, and no gap was long enough to
        // reset, so the counter equals the retained rows.
        expect(ledger.every(weekQualified)).toBe(true);
        expect(r.accumulated).toBe(ledger.length);
        expect(r.stale).toBe(false);
    });

    test('REGRESSION: a trained week whose row was lost keeps its slot but no verdict', () => {
        // A row can go missing through pruning or a restored backup while
        // the log still proves the member trained. The target is unknown,
        // so the week is neither credited nor called a failure, but it
        // keeps its place in calendar time.
        const log = [...sessionsInWeek(2, 3), ...sessionsInWeek(1, 3), ...sessionsInWeek(0, 3)];
        const partial = [
            { weekKey: key(14), targetSessions: 4, qualifyingSessions: 3, verdict: WEEK_VERDICT.QUALIFIED },
            // the week at key(7) is missing, though the log has three sessions in it
        ];
        const out = reconcileLedger(partial, {
            weekKey: getCurrentWeekKey(NOW), schedule: SCHEDULE_4, sessionLog: log, now: NOW,
        });
        const lost = out.find(w => w.weekKey === key(7));
        expect(lost).toBeDefined();                            // slot kept
        expect(lost.verdict).toBe(WEEK_VERDICT.UNKNOWN);
        expect(lost.qualifyingSessions).toBe(3);               // the fact we do have
        expect(weekQualified(lost)).toBe(false);               // earns nothing
        expect(weekIsMemberFacingMiss(lost)).toBe(false);      // and is not a miss
        expect(weekQualified(out.find(w => w.weekKey === key(14)))).toBe(true);
    });

    test('a week with no sessions and no row is also UNKNOWN, not a miss', () => {
        const log = [...sessionsInWeek(2, 3), ...sessionsInWeek(0, 3)];
        const partial = [{ weekKey: key(14), targetSessions: 4, qualifyingSessions: 3, verdict: WEEK_VERDICT.QUALIFIED }];
        const out = reconcileLedger(partial, {
            weekKey: getCurrentWeekKey(NOW), schedule: SCHEDULE_4, sessionLog: log, now: NOW,
        });
        const gap = out.find(w => w.weekKey === key(7));
        expect(gap).toMatchObject({ targetSessions: null, qualifyingSessions: 0, verdict: WEEK_VERDICT.UNKNOWN });
        expect(weekIsMemberFacingMiss(gap)).toBe(false);
    });
});

describe('the stale reset', () => {
    test('REGRESSION: a long absence truly clears accumulated progress', () => {
        // 14 qualifying weeks, then 60 days away, then one qualifying week.
        // A stored running total would have said 15 and deloaded them on
        // their way back in. Derived, it says 1.
        const old = Array.from({ length: 14 }, (_, i) => ({ weeksBack: i + 10, sessions: 3 }));
        const { ledger, log } = simulate([...old, { weeksBack: 0, sessions: 3 }]);
        const r = deloadState(ledger, log, { now: NOW });
        expect(r.accumulated).toBe(1);
        expect(r.isDeloadWeek).toBe(false);
        expect(r.resetAtWeek).toBe(getCurrentWeekKey(NOW));
    });

    test('currently stale means nothing is accumulated at all', () => {
        const { ledger, log } = simulate([{ weeksBack: 8, sessions: 3 }, { weeksBack: 7, sessions: 3 }]);
        const r = deloadState(ledger, log, { now: NOW });
        expect(r.stale).toBe(true);
        expect(r.accumulated).toBe(0);
        expect(r.daysSinceLastQualifying).toBeGreaterThan(PROGRESSION_POLICY.deloadStaleResetDays);
    });

    test('an absence inside the window does not reset', () => {
        const { ledger, log } = simulate([
            { weeksBack: 4, sessions: 3 }, { weeksBack: 3, sessions: 3 }, { weeksBack: 0, sessions: 3 },
        ]);
        const r = deloadState(ledger, log, { now: NOW });
        expect(r.stale).toBe(false);
        expect(r.accumulated).toBe(3);
        expect(r.resetAtWeek).toBeNull();
    });

    test('recovery sessions do not keep the counter alive', () => {
        const { ledger } = simulate([{ weeksBack: 10, sessions: 3 }]);
        const log = [...sessionsInWeek(10, 3), S(2, 'recovery'), S(5, 'recovery')];
        expect(deloadState(ledger, log, { now: NOW }).stale).toBe(true);
    });

    test('empty inputs are at zero and not stale', () => {
        expect(deloadState([], [], { now: NOW })).toMatchObject({ accumulated: 0, isDeloadWeek: false, stale: false });
        expect(deloadState(null, null, { now: NOW }).accumulated).toBe(0);
    });

    test('the interval and stale window are policy-controlled', () => {
        const p = withPolicy({ deloadEveryQualifyingWeeks: 3 });
        const { ledger, log } = simulate(Array.from({ length: 3 }, (_, i) => ({ weeksBack: i, sessions: 3 })));
        expect(deloadState(ledger, log, { now: NOW }).isDeloadWeek).toBe(false);
        expect(deloadState(ledger, log, { now: NOW, policy: p }).isDeloadWeek).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------
describe('the 4-of-8 gate', () => {
    test('four qualifying weeks inside the window opens it', () => {
        const { ledger } = simulate(Array.from({ length: 4 }, (_, i) => ({ weeksBack: i, sessions: 3 })));
        expect(progressionEligibility(ledger).eligible).toBe(true);
    });

    test('three does not', () => {
        const { ledger } = simulate(Array.from({ length: 3 }, (_, i) => ({ weeksBack: i, sessions: 3 })));
        expect(progressionEligibility(ledger).eligible).toBe(false);
    });

    test('they need not be consecutive', () => {
        const { ledger } = simulate([
            { weeksBack: 5, sessions: 3 }, { weeksBack: 4, sessions: 3 },
            { weeksBack: 3, sessions: 1 }, { weeksBack: 2, sessions: 0 },
            { weeksBack: 1, sessions: 3 }, { weeksBack: 0, sessions: 3 },
        ]);
        expect(progressionEligibility(ledger).eligible).toBe(true);
    });

    test('a new ledger is not eligible, and not an error', () => {
        expect(progressionEligibility([]).eligible).toBe(false);
        expect(progressionEligibility(null).eligible).toBe(false);
    });

    test('the window never exceeds the policy length', () => {
        const { ledger } = simulate(Array.from({ length: 20 }, (_, i) => ({ weeksBack: i, sessions: 3 })));
        expect(progressionEligibility(ledger).weeks).toHaveLength(8);
    });

    test('REGRESSION: a light week takes a slot, and is not a failure', () => {
        // Target 0 or 1 cannot qualify and is not a miss, but the window is
        // calendar-based: excusing it from a slot would stretch the window
        // and keep older weeks reading as recent.
        const allRest = ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'];
        const { ledger } = simulate([
            { weeksBack: 4, sessions: 3 }, { weeksBack: 3, sessions: 3 },
            { weeksBack: 2, sessions: 0, schedule: allRest },
            { weeksBack: 1, sessions: 3 }, { weeksBack: 0, sessions: 3 },
        ]);
        const light = ledger.find(w => w.targetSessions === 0);
        expect(light.verdict).toBe(WEEK_VERDICT.NEUTRAL);
        expect(weekQualified(light)).toBe(false);
        expect(weekIsMemberFacingMiss(light)).toBe(false);
        // It is inside the window, occupying one of the eight.
        const r = progressionEligibility(ledger);
        expect(r.weeks.some(w => w.weekKey === light.weekKey)).toBe(true);
        expect(r.qualifyingWeeks).toBe(4);
        expect(r.eligible).toBe(true);
    });

    test('REGRESSION: the window never stretches past eight calendar weeks', () => {
        // Four good weeks, then a long absence. They must age out on
        // schedule rather than being kept alive by excluded weeks.
        const { ledger } = simulate([
            { weeksBack: 12, sessions: 3 }, { weeksBack: 11, sessions: 3 },
            { weeksBack: 10, sessions: 3 }, { weeksBack: 9, sessions: 3 },
            { weeksBack: 0, sessions: 1 },
        ]);
        const r = progressionEligibility(ledger);
        expect(r.weeks).toHaveLength(8);
        expect(r.qualifyingWeeks).toBe(0);
        expect(r.eligible).toBe(false);
    });

    test('recentWeeks returns newest first', () => {
        const { ledger } = simulate(Array.from({ length: 5 }, (_, i) => ({ weeksBack: i, sessions: 3 })));
        expect(recentWeeks(ledger, 2).map(r => r.weekKey)).toEqual([key(0), key(7)]);
    });
});

describe('the whole answer', () => {
    const eligible = () => simulate(Array.from({ length: 4 }, (_, i) => ({ weeksBack: i, sessions: 3 }))).ledger;

    test('eligible and unheld is available', () => {
        expect(canProgress(eligible(), toleranceHolds([], { now: NOW })).available).toBe(true);
    });

    test('an RPE hold blocks it', () => {
        const hard = [S(1, 'length', { rpe: 9 }), S(2, 'length', { rpe: 9 }), S(3, 'length', { rpe: 9 })];
        const r = canProgress(eligible(), toleranceHolds(hard, { now: NOW }));
        expect(r.eligible).toBe(true);
        expect(r.available).toBe(false);
        expect(r.activeHolds).toContain('rpe');
    });

    test('a recovery hold blocks it', () => {
        const rec = [S(1, 'recovery'), S(4, 'recovery'), S(7, 'recovery')];
        expect(canProgress(eligible(), toleranceHolds(rec, { now: NOW })).activeHolds).toContain('recovery');
    });

    test('UNKNOWN RPE does not block', () => {
        const r = canProgress(eligible(), toleranceHolds([], { now: NOW }));
        expect(r.rpeUnknown).toBe(true);
        expect(r.available).toBe(true);
    });

    test('missing holds are treated as none, not as an error', () => {
        expect(canProgress(eligible(), null).available).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The normalisation boundary
//
// jsonb enforces no shape, so what comes back from the database is untrusted
// input. These are the cases that could otherwise hand out progression
// credit on the strength of corrupt data.
// ---------------------------------------------------------------------------
describe('normaliseLedger', () => {
    const ok = (weekKey, targetSessions, qualifyingSessions, verdict) =>
        ({ weekKey, targetSessions, qualifyingSessions, verdict });

    test('a valid ledger survives unchanged', () => {
        const valid = [
            ok('2025_w1', 4, 3, WEEK_VERDICT.QUALIFIED),
            ok('2025_w2', 4, 1, WEEK_VERDICT.MISSED),
            ok('2025_w3', 0, 0, WEEK_VERDICT.NEUTRAL),
            ok('2025_w4', null, 0, WEEK_VERDICT.UNKNOWN),
        ];
        expect(normaliseLedger(valid)).toEqual(valid);
    });

    test.each([
        ['null', null], ['undefined', undefined], ['an object', { a: 1 }],
        ['a string', '[]'], ['a number', 7],
    ])('%s becomes an empty ledger', (_label, input) => {
        expect(normaliseLedger(input)).toEqual([]);
    });

    test('REGRESSION: a legacy boolean row cannot earn credit', () => {
        // `qualified: true` predates the verdict model. A boolean cannot
        // distinguish qualified from neutral or unknown, so honouring it
        // would grant credit the current rule never gave.
        const out = normaliseLedger([{ weekKey: '2025_w1', targetSessions: 4, qualifyingSessions: 3, qualified: true }]);
        expect(out[0].verdict).toBe(WEEK_VERDICT.UNKNOWN);
        expect(weekQualified(out[0])).toBe(false);
        expect(progressionEligibility(normaliseLedger(
            Array.from({ length: 8 }, (_, i) => ({ weekKey: `2025_w${i + 1}`, targetSessions: 4, qualifyingSessions: 3, qualified: true }))
        )).eligible).toBe(false);
    });

    test('a missing verdict becomes unknown', () => {
        const out = normaliseLedger([{ weekKey: '2025_w1', targetSessions: 4, qualifyingSessions: 3 }]);
        expect(out[0].verdict).toBe(WEEK_VERDICT.UNKNOWN);
    });

    test('an unrecognised verdict becomes unknown', () => {
        for (const v of ['AMAZING', '', 0, true, null, {}]) {
            const out = normaliseLedger([{ weekKey: '2025_w1', targetSessions: 4, qualifyingSessions: 3, verdict: v }]);
            expect(out[0].verdict, String(v)).toBe(WEEK_VERDICT.UNKNOWN);
        }
    });

    test('REGRESSION: a stored verdict that contradicts its numbers is recomputed', () => {
        // The one corruption that would silently grant progression.
        const out = normaliseLedger([ok('2025_w1', 4, 0, WEEK_VERDICT.QUALIFIED)]);
        expect(out[0].verdict).toBe(WEEK_VERDICT.MISSED);
        expect(weekQualified(out[0])).toBe(false);
    });

    test('duplicate weekKeys resolve to the last one written', () => {
        const out = normaliseLedger([
            ok('2025_w1', 4, 0, WEEK_VERDICT.MISSED),
            ok('2025_w1', 4, 3, WEEK_VERDICT.QUALIFIED),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].qualifyingSessions).toBe(3);
        expect(out[0].verdict).toBe(WEEK_VERDICT.QUALIFIED);
    });

    test('rows are ordered by real week, not by string', () => {
        // '2025_w9' sorts after '2025_w10' as text, and across a year
        // boundary string order is wrong outright.
        const out = normaliseLedger([
            ok('2025_w10', 4, 3, WEEK_VERDICT.QUALIFIED),
            ok('2025_w9', 4, 3, WEEK_VERDICT.QUALIFIED),
            ok('2024_w52', 4, 3, WEEK_VERDICT.QUALIFIED),
        ]);
        expect(out.map(r => r.weekKey)).toEqual(['2024_w52', '2025_w9', '2025_w10']);
    });

    test('more than the cap is pruned to the newest', () => {
        const many = Array.from({ length: 40 }, (_, i) => ok(`2025_w${i + 1}`, 4, 3, WEEK_VERDICT.QUALIFIED));
        const out = normaliseLedger(many);
        expect(out).toHaveLength(PROGRESSION_POLICY.ledgerMaxWeeks);
        expect(out[out.length - 1].weekKey).toBe('2025_w40');
    });

    test('an unparseable weekKey drops the row', () => {
        for (const k of ['', 'nonsense', '2025-w1', '25_w1', '2025_w0', '2025_w54', null, 7]) {
            expect(normaliseLedger([{ weekKey: k, targetSessions: 4, qualifyingSessions: 3, verdict: 'qualified' }]),
                String(k)).toEqual([]);
        }
    });

    test('a corrupt target becomes unknown rather than zero', () => {
        // Zero is a real claim: "nothing was scheduled". Corruption is not.
        for (const t of [-4, 'four', NaN, Infinity, {}, true]) {
            const out = normaliseLedger([{ weekKey: '2025_w1', targetSessions: t, qualifyingSessions: 3, verdict: 'qualified' }]);
            expect(out[0].targetSessions, String(t)).toBeNull();
            expect(out[0].verdict).toBe(WEEK_VERDICT.UNKNOWN);
        }
    });

    test('a corrupt session count is floored at zero', () => {
        const out = normaliseLedger([{ weekKey: '2025_w1', targetSessions: 4, qualifyingSessions: -3, verdict: 'qualified' }]);
        expect(out[0].qualifyingSessions).toBe(0);
        expect(out[0].verdict).toBe(WEEK_VERDICT.MISSED);
    });

    test('more sessions than the target is legitimate, not corruption', () => {
        // Training on a scheduled rest day is allowed and should still count.
        const out = normaliseLedger([ok('2025_w1', 3, 5, WEEK_VERDICT.QUALIFIED)]);
        expect(out[0].verdict).toBe(WEEK_VERDICT.QUALIFIED);
    });

    test('fields a future version added are preserved', () => {
        // An older cached shell must not strip data a newer one wrote.
        const out = normaliseLedger([{ ...ok('2025_w1', 4, 3, WEEK_VERDICT.QUALIFIED), futureField: 'keep me' }]);
        expect(out[0].futureField).toBe('keep me');
        expect(out[0].verdict).toBe(WEEK_VERDICT.QUALIFIED);
    });

    test('REGRESSION: a demoted legacy row stays demoted on reload', () => {
        // Normalisation runs on every load. If a recomputation could
        // override the deliberate `unknown`, the legacy row would come back
        // as qualified on the second pass and the fail-safe would be worth
        // nothing.
        const legacy = [{ weekKey: '2025_w1', targetSessions: 4, qualifyingSessions: 3, qualified: true }];
        const first = normaliseLedger(legacy);
        const second = normaliseLedger(first);
        const third = normaliseLedger(second);
        expect(first[0].verdict).toBe(WEEK_VERDICT.UNKNOWN);
        expect(second[0].verdict).toBe(WEEK_VERDICT.UNKNOWN);
        expect(third[0].verdict).toBe(WEEK_VERDICT.UNKNOWN);
        expect(weekQualified(third[0])).toBe(false);
    });

    test('normalisation is idempotent', () => {
        const messy = [
            { weekKey: '2025_w2', targetSessions: 4, qualifyingSessions: 3, qualified: true },
            ok('2025_w1', 4, 3, WEEK_VERDICT.QUALIFIED),
            null, 'junk',
        ];
        const once = normaliseLedger(messy);
        expect(normaliseLedger(once)).toEqual(once);
    });
});
