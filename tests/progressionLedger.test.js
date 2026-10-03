import { describe, test, expect } from 'vitest';
import {
    ledgerUpsertWeek, pruneLedger, recentWeeks, currentWeekEntry,
    progressionEligibility, deloadState, canProgress,
} from '../src/progressionLedger.js';
import { toleranceHolds } from '../src/progression.js';
import { PROGRESSION_POLICY, withPolicy } from '../src/progressionPolicy.js';

/**
 * The ledger exists because the session log cannot say what was SCHEDULED in
 * a past week, and applying today's schedule backwards would invent a target
 * that week never had. Most of what follows is about that: the recorded
 * target is never recomputed, and history is never fabricated.
 */

const NOW = new Date(2025, 2, 30, 12, 0, 0);
const WEEK_MS = 7 * 86400000;

/** Build a ledger by recording `specs` in order, oldest first. */
function build(specs, policy) {
    return specs.reduce((led, [weekKey, targetSessions, qualifyingSessions]) =>
        ledgerUpsertWeek(led, { weekKey, targetSessions, qualifyingSessions }, policy), []);
}
/** n weeks that all qualify, as [key, target, done]. */
const good = (n, from = 1) =>
    Array.from({ length: n }, (_, i) => [`2025_w${from + i}`, 4, 3]);

describe('writing the ledger', () => {
    test('records the target that was true at the time', () => {
        const led = build([['2025_w10', 3, 2]]);
        expect(led[0]).toMatchObject({ weekKey: '2025_w10', targetSessions: 3, qualifyingSessions: 2, qualified: true });
    });

    test('REGRESSION: a later schedule change does not re-judge a recorded week', () => {
        // The member was on a 3-session week and did 2, which qualified.
        // They then move to a 4-session week. The old week must stay
        // qualified: it was judged against the target it actually had.
        let led = build([['2025_w10', 3, 2]]);
        led = ledgerUpsertWeek(led, { weekKey: '2025_w11', targetSessions: 4, qualifyingSessions: 3 });
        expect(led[0]).toMatchObject({ weekKey: '2025_w10', targetSessions: 3, qualified: true });
        expect(led[1]).toMatchObject({ weekKey: '2025_w11', targetSessions: 4, qualified: true });
    });

    test('re-recording the same week replaces it, which is the normal case', () => {
        // Called repeatedly as the current week fills up.
        let led = ledgerUpsertWeek([], { weekKey: '2025_w10', targetSessions: 4, qualifyingSessions: 1 });
        expect(led[0].qualified).toBe(false);
        led = ledgerUpsertWeek(led, { weekKey: '2025_w10', targetSessions: 4, qualifyingSessions: 3 });
        expect(led).toHaveLength(1);
        expect(led[0].qualified).toBe(true);
    });

    test('a week flipping to qualified mid-week fixes every total after it', () => {
        let led = build([['2025_w10', 4, 3], ['2025_w11', 4, 1], ['2025_w12', 4, 3]]);
        expect(led.map(e => e.cumulativeQualified)).toEqual([1, 1, 2]);
        led = ledgerUpsertWeek(led, { weekKey: '2025_w11', targetSessions: 4, qualifyingSessions: 3 });
        expect(led.map(e => e.cumulativeQualified)).toEqual([1, 2, 3]);
    });

    test('it never mutates the ledger it was given', () => {
        const before = build([['2025_w10', 4, 3]]);
        const snapshot = JSON.parse(JSON.stringify(before));
        ledgerUpsertWeek(before, { weekKey: '2025_w11', targetSessions: 4, qualifyingSessions: 3 });
        expect(before).toEqual(snapshot);
    });

    test('junk is tolerated rather than thrown on', () => {
        expect(ledgerUpsertWeek(null, null)).toEqual([]);
        expect(ledgerUpsertWeek(undefined, { weekKey: '' })).toEqual([]);
        expect(ledgerUpsertWeek([{ nonsense: 1 }, null], { weekKey: '2025_w1', targetSessions: 4, qualifyingSessions: 3 }))
            .toHaveLength(1);
    });

    test('negative and non-numeric counts are clamped, not trusted', () => {
        const led = build([['2025_w10', -4, 'three']]);
        expect(led[0]).toMatchObject({ targetSessions: 0, qualifyingSessions: 0, qualified: false });
    });
});

describe('bounded growth', () => {
    test('the ledger is pruned to the policy limit', () => {
        const led = build(good(40));
        expect(led).toHaveLength(PROGRESSION_POLICY.ledgerMaxWeeks);
        expect(led[led.length - 1].weekKey).toBe('2025_w40');
    });

    test('REGRESSION: pruning does not lose the deload count', () => {
        // 40 qualifying weeks, 26 retained. Recomputing from the survivors
        // would say 26; the running total says 40.
        const led = build(good(40));
        expect(led[led.length - 1].cumulativeQualified).toBe(40);
    });

    test('pruning keeps the newest, not the oldest', () => {
        const led = build(good(30));
        expect(led[0].weekKey).toBe('2025_w5');
        expect(led.some(e => e.weekKey === '2025_w1')).toBe(false);
    });

    test('pruneLedger is idempotent and tolerant', () => {
        const led = build(good(30));
        expect(pruneLedger(pruneLedger(led))).toEqual(pruneLedger(led));
        expect(pruneLedger(null)).toEqual([]);
    });

    test('the bound is policy-controlled', () => {
        const tiny = withPolicy({ ledgerMaxWeeks: 3 });
        expect(build(good(10), tiny)).toHaveLength(3);
    });
});

describe('the current week entry', () => {
    const schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];

    test('the target is counted from the schedule as it is right now', () => {
        const e = currentWeekEntry({ weekKey: '2025_w1', schedule, sessionLog: [] });
        expect(e.targetSessions).toBe(4);
    });

    test('rest days are not part of the target', () => {
        const allRest = currentWeekEntry({ weekKey: '2025_w1', schedule: ['rest', 'rest', 'rest'], sessionLog: [] });
        expect(allRest.targetSessions).toBe(0);
    });

    test('it counts qualifying days in that week only', () => {
        // 30 March 2025 is in ISO week 13; a month earlier is not.
        const log = [
            { date: new Date(2025, 2, 25).toISOString(), routineType: 'length' },
            { date: new Date(2025, 2, 26).toISOString(), routineType: 'girth' },
            { date: new Date(2025, 1, 10).toISOString(), routineType: 'length' },
        ];
        const e = currentWeekEntry({ weekKey: '2025_w13', schedule, sessionLog: log });
        expect(e.qualifyingSessions).toBe(2);
    });

    test('recovery is not counted toward the week', () => {
        const log = [{ date: new Date(2025, 2, 25).toISOString(), routineType: 'recovery' }];
        expect(currentWeekEntry({ weekKey: '2025_w13', schedule, sessionLog: log }).qualifyingSessions).toBe(0);
    });

    test('a malformed schedule yields a zero target rather than throwing', () => {
        expect(currentWeekEntry({ weekKey: '2025_w1', schedule: null, sessionLog: null }).targetSessions).toBe(0);
    });
});

describe('the 4-of-8 gate, read from the ledger', () => {
    test('four qualifying weeks inside the window opens it', () => {
        const r = progressionEligibility(build(good(4)));
        expect(r.qualifyingWeeks).toBe(4);
        expect(r.eligible).toBe(true);
    });

    test('three does not', () => {
        expect(progressionEligibility(build(good(3))).eligible).toBe(false);
    });

    test('they need not be consecutive', () => {
        const led = build([
            ['2025_w1', 4, 3], ['2025_w2', 4, 3], ['2025_w3', 4, 1],
            ['2025_w4', 4, 0], ['2025_w5', 4, 3], ['2025_w6', 4, 3],
        ]);
        expect(progressionEligibility(led).eligible).toBe(true);
    });

    test('old qualifying weeks age out of the window', () => {
        // Four good weeks then eight poor ones: the good weeks fall outside.
        const led = build([...good(4), ...Array.from({ length: 8 }, (_, i) => [`2025_w${5 + i}`, 4, 0])]);
        const r = progressionEligibility(led);
        expect(r.qualifyingWeeks).toBe(0);
        expect(r.eligible).toBe(false);
    });

    test('REGRESSION: a new ledger means not eligible, not an error', () => {
        // Existing members start clean at launch. Three recorded weeks is a
        // three-week window and simply is not four yet.
        const r = progressionEligibility(build(good(3)));
        expect(r.recordedWeeks).toBe(3);
        expect(r.eligible).toBe(false);
        expect(progressionEligibility([]).eligible).toBe(false);
        expect(progressionEligibility(null).eligible).toBe(false);
    });

    test('the window never exceeds the policy length', () => {
        expect(progressionEligibility(build(good(20))).weeks).toHaveLength(8);
    });

    test('the thresholds are policy-controlled', () => {
        const loose = withPolicy({ qualifyingWeeksRequired: 2 });
        expect(progressionEligibility(build(good(2))).eligible).toBe(false);
        expect(progressionEligibility(build(good(2)), loose).eligible).toBe(true);
    });

    test('recentWeeks returns newest first', () => {
        const w = recentWeeks(build(good(5)), 3);
        expect(w.map(e => e.weekKey)).toEqual(['2025_w5', '2025_w4', '2025_w3']);
    });
});

describe('deload on accumulated qualifying weeks', () => {
    const justTrained = { now: NOW, lastQualifyingDate: new Date(NOW.getTime() - 86400000) };

    test('the fifth qualifying week is the deload week', () => {
        const r = deloadState(build(good(5)), justTrained);
        expect(r.accumulated).toBe(5);
        expect(r.isDeloadWeek).toBe(true);
    });

    test('the fourth is not', () => {
        expect(deloadState(build(good(4)), justTrained).isDeloadWeek).toBe(false);
    });

    test('a non-qualifying week PAUSES rather than resetting', () => {
        const led = build([...good(4), ['2025_w5', 4, 1]]);
        const r = deloadState(led, justTrained);
        expect(r.accumulated).toBe(4);
        expect(r.isDeloadWeek).toBe(false);
    });

    test('and does not advance either', () => {
        const led = build([...good(4), ['2025_w5', 4, 0], ['2025_w6', 4, 0]]);
        expect(deloadState(led, justTrained).accumulated).toBe(4);
    });

    test('the deload week itself must be a qualifying week', () => {
        // Hitting five and then having a poor week must not deload the poor
        // week, which had no exposure to deload from.
        const led = build([...good(5), ['2025_w6', 4, 1]]);
        const r = deloadState(led, justTrained);
        expect(r.accumulated).toBe(5);
        expect(r.isDeloadWeek).toBe(false);
    });

    test('28 days with no qualifying work resets accumulated progress', () => {
        const led = build(good(4));
        const r = deloadState(led, { now: NOW, lastQualifyingDate: new Date(NOW.getTime() - 40 * 86400000) });
        expect(r.stale).toBe(true);
        expect(r.accumulated).toBe(0);
        expect(r.isDeloadWeek).toBe(false);
    });

    test('an absence inside the stale window does not reset', () => {
        const r = deloadState(build(good(4)), { now: NOW, lastQualifyingDate: new Date(NOW.getTime() - 20 * 86400000) });
        expect(r.stale).toBe(false);
        expect(r.accumulated).toBe(4);
    });

    test('an empty ledger is at zero and not stale', () => {
        const r = deloadState([], { now: NOW });
        expect(r).toMatchObject({ accumulated: 0, isDeloadWeek: false, stale: false });
    });

    test('the interval and the stale window are policy-controlled', () => {
        const p = withPolicy({ deloadEveryQualifyingWeeks: 3 });
        expect(deloadState(build(good(3), p), justTrained, ).isDeloadWeek).toBe(false);
        expect(deloadState(build(good(3), p), { ...justTrained, policy: p }).isDeloadWeek).toBe(true);
    });

    test('it survives pruning, because the total is carried not recomputed', () => {
        const led = build(good(30));          // pruned to 26, cumulative 30
        const r = deloadState(led, justTrained);
        expect(r.accumulated).toBe(30);
        expect(r.isDeloadWeek).toBe(true);    // 30 % 5 === 0
    });
});

describe('the whole answer', () => {
    const eligible = build(good(4));
    const hard = Array.from({ length: 3 }, (_, i) =>
        ({ date: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - i).toISOString(), routineType: 'length', rpe: 9 }));
    const recovering = Array.from({ length: 3 }, (_, i) =>
        ({ date: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - i * 3).toISOString(), routineType: 'recovery' }));

    test('eligible and unheld is available', () => {
        const r = canProgress(eligible, toleranceHolds([], { now: NOW }));
        expect(r.available).toBe(true);
    });

    test('an RPE hold blocks it', () => {
        const r = canProgress(eligible, toleranceHolds(hard, { now: NOW }));
        expect(r.eligible).toBe(true);
        expect(r.available).toBe(false);
        expect(r.activeHolds).toContain('rpe');
    });

    test('a recovery hold blocks it', () => {
        const r = canProgress(eligible, toleranceHolds(recovering, { now: NOW }));
        expect(r.available).toBe(false);
        expect(r.activeHolds).toContain('recovery');
    });

    test('UNKNOWN RPE does not block', () => {
        const r = canProgress(eligible, toleranceHolds([], { now: NOW }));
        expect(r.rpeUnknown).toBe(true);
        expect(r.available).toBe(true);
    });

    test('not eligible is not available however clear the holds', () => {
        expect(canProgress(build(good(2)), toleranceHolds([], { now: NOW })).available).toBe(false);
    });

    test('missing holds are treated as no holds, not as an error', () => {
        expect(canProgress(eligible, null).available).toBe(true);
    });
});
