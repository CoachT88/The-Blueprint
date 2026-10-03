import { describe, test, expect } from 'vitest';
import {
    MECHANICAL_MISSIONS, RPE_STATUS, PROGRAMME_START_SOURCE,
    isQualifyingSession, isRecoverySession, qualifyingSessionDays, lifetimeVolume,
    qualifyingWeek, weeklyRollup, progressionEligibility,
    rpeTolerance, recoverySafety, toleranceHolds, canProgress,
    deloadState, programmeStartBackfill, programmeStartOnCompletion,
} from '../src/progression.js';
import { PROGRESSION_POLICY, withPolicy } from '../src/progressionPolicy.js';

/**
 * The old progression advanced on wall-clock time from a tap. These tests
 * are mostly about the opposite: that nothing advances without completed
 * mechanical work, and that missing data never reads as permission.
 *
 * Dates are built from local components so weekday arithmetic means what the
 * test names say wherever this runs.
 */

const NOW = new Date(2025, 2, 30, 12, 0, 0);          // Sunday 30 March 2025
const daysAgo = (n, h = 12) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, h);

/** A completed session, `n` days before NOW. */
const S = (n, routineType = 'length', extra = {}) =>
    ({ date: daysAgo(n).toISOString(), routineType, ...extra });

/** `count` qualifying sessions spread inside the week that is `weeksBack` old. */
function week(weeksBack, count, routineType = 'length', extra = {}) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(S(weeksBack * 7 + i, routineType, extra));
    return out;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------
describe('the policy object', () => {
    test('holds every tunable number and is frozen', () => {
        for (const k of ['qualifyingWeeksRequired', 'qualifyingWindowWeeks', 'qualifyingWeekMaxMissed',
            'qualifyingWeekMinSessions', 'rpeWindowSessions', 'rpeHoldThreshold', 'rpeMinSamples',
            'recoverySafetyWindowDays', 'recoveryCompletedHoldCount',
            'deloadEveryQualifyingWeeks', 'deloadStaleResetDays']) {
            expect(typeof PROGRESSION_POLICY[k], k).toBe('number');
        }
        expect(Object.isFrozen(PROGRESSION_POLICY)).toBe(true);
    });

    test('carries the agreed initial values', () => {
        expect(PROGRESSION_POLICY.qualifyingWeeksRequired).toBe(4);
        expect(PROGRESSION_POLICY.qualifyingWindowWeeks).toBe(8);
        expect(PROGRESSION_POLICY.rpeWindowSessions).toBe(5);
        expect(PROGRESSION_POLICY.rpeHoldThreshold).toBe(8);
        expect(PROGRESSION_POLICY.recoverySafetyWindowDays).toBe(14);
        expect(PROGRESSION_POLICY.recoveryCompletedHoldCount).toBe(3);
        expect(PROGRESSION_POLICY.deloadEveryQualifyingWeeks).toBe(5);
        expect(PROGRESSION_POLICY.deloadStaleResetDays).toBe(28);
    });

    test('every rule reads the policy rather than a hard-coded number', () => {
        // Move every knob and assert the behaviour moves with it. This is
        // what stops a literal creeping back into a rule.
        const loose = withPolicy({ qualifyingWeeksRequired: 1, qualifyingWeekMinSessions: 1, qualifyingWeekMaxMissed: 3 });
        const log = week(0, 1);
        expect(progressionEligibility(log, { now: NOW, defaultTarget: 4 }).eligible).toBe(false);
        expect(progressionEligibility(log, { now: NOW, defaultTarget: 4, policy: loose }).eligible).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// What counts
// ---------------------------------------------------------------------------
describe('qualifying mechanical session', () => {
    test('the three mechanical missions count', () => {
        for (const m of MECHANICAL_MISSIONS) expect(isQualifyingSession({ routineType: m }), m).toBe(true);
    });

    test('recovery does not', () => {
        expect(isQualifyingSession({ routineType: 'recovery' })).toBe(false);
        expect(isRecoverySession({ routineType: 'recovery' })).toBe(true);
    });

    test('a safe manual substitution counts in full', () => {
        // Which of the three they chose is a preference, not less exposure.
        expect(isQualifyingSession({ routineType: 'girth', scheduledType: 'length', manualOverride: true })).toBe(true);
    });

    test('a MODIFIED session counts in full', () => {
        // Reduced volume is still mechanical work, and not counting it would
        // penalise reporting soreness honestly.
        expect(isQualifyingSession({ routineType: 'length', modified: true })).toBe(true);
    });

    test('a resumed and completed session counts, because only completion is logged', () => {
        expect(isQualifyingSession({ routineType: 'girth', resumed: true })).toBe(true);
    });

    test('an abandoned draft never counts, because it never reaches the log', () => {
        expect(qualifyingSessionDays([])).toEqual([]);
        expect(isQualifyingSession(null)).toBe(false);
        expect(isQualifyingSession({})).toBe(false);
        expect(isQualifyingSession({ routineType: 'mystery' })).toBe(false);
    });

    test('rest is not an entry at all', () => {
        expect(isQualifyingSession({ routineType: 'rest' })).toBe(false);
    });
});

describe('same-day doubles', () => {
    const twoInADay = [S(1, 'length', {}), { ...S(1, 'girth'), date: daysAgo(1, 19).toISOString() }];

    test('count once for adherence and progression', () => {
        expect(qualifyingSessionDays(twoInADay)).toHaveLength(1);
    });

    test('but both count toward lifetime volume', () => {
        expect(lifetimeVolume(twoInADay).mechanical).toBe(2);
    });

    test('lifetime volume separates mechanical from recovery', () => {
        const v = lifetimeVolume([S(1), S(2, 'recovery'), S(3, 'girth')]);
        expect(v).toEqual({ mechanical: 2, recovery: 1, total: 3 });
    });
});

// ---------------------------------------------------------------------------
// Qualifying week
// ---------------------------------------------------------------------------
describe('qualifying week: miss at most one, complete at least two', () => {
    test.each([
        [4, 4, true], [4, 3, true], [4, 2, false], [4, 0, false],
        [3, 3, true], [3, 2, true], [3, 1, false],
        [2, 2, true], [2, 1, false],
    ])('target %i with %i completed -> qualifies %s', (target, completed, expected) => {
        expect(qualifyingWeek(target, completed).qualifies).toBe(expected);
    });

    test('the required count is what the sentence says', () => {
        expect(qualifyingWeek(4, 0).required).toBe(3);
        expect(qualifyingWeek(3, 0).required).toBe(2);
        expect(qualifyingWeek(2, 0).required).toBe(2);   // the floor binds
    });

    test('a 0 or 1 session target is neutral: neither qualifies nor fails', () => {
        for (const t of [0, 1]) {
            const r = qualifyingWeek(t, t);
            expect(r.qualifies, `target ${t}`).toBe(false);
            expect(r.neutral).toBe(true);
            expect(r.required).toBeNull();
        }
    });

    test('a percentage would have behaved differently, which is why it is not used', () => {
        // 75% of 3 rounds to 3, demanding perfection on the stamina and eq
        // schedules while asking 3 of 4 on the others. The absolute rule
        // gives the same standard to both.
        expect(qualifyingWeek(3, 2).qualifies).toBe(true);
        expect(Math.ceil(3 * 0.75)).toBe(3);
    });

    test('nonsense inputs do not throw', () => {
        expect(qualifyingWeek(undefined, undefined).neutral).toBe(true);
        expect(qualifyingWeek(-4, -2).neutral).toBe(true);
        expect(qualifyingWeek(NaN, NaN).neutral).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------
describe('the 4-of-8 rolling gate', () => {
    const fourGoodWeeks = [...week(0, 3), ...week(1, 3), ...week(2, 3), ...week(3, 3)];

    test('four qualifying weeks inside the window opens it', () => {
        const r = progressionEligibility(fourGoodWeeks, { now: NOW, defaultTarget: 4 });
        expect(r.qualifyingWeeks).toBeGreaterThanOrEqual(4);
        expect(r.eligible).toBe(true);
    });

    test('three does not', () => {
        const r = progressionEligibility([...week(0, 3), ...week(1, 3), ...week(2, 3)], { now: NOW, defaultTarget: 4 });
        expect(r.qualifyingWeeks).toBe(3);
        expect(r.eligible).toBe(false);
    });

    test('the weeks need not be consecutive', () => {
        // One bad fortnight should not cost a month of work.
        const gapped = [...week(0, 3), ...week(1, 3), ...week(3, 3), ...week(5, 3)];
        expect(progressionEligibility(gapped, { now: NOW, defaultTarget: 4 }).eligible).toBe(true);
    });

    test('old qualifying weeks age out of the window', () => {
        // Four good weeks, all older than the 8-week window.
        const ancient = [...week(9, 3), ...week(10, 3), ...week(11, 3), ...week(12, 3)];
        const r = progressionEligibility(ancient, { now: NOW, defaultTarget: 4 });
        expect(r.qualifyingWeeks).toBe(0);
        expect(r.eligible).toBe(false);
    });

    test('the window is exactly the policy length, newest first', () => {
        const r = progressionEligibility([], { now: NOW, defaultTarget: 4 });
        expect(r.weeks).toHaveLength(PROGRESSION_POLICY.qualifyingWindowWeeks);
        expect(r.windowWeeks).toBe(8);
    });

    test('recovery sessions never earn a qualifying week', () => {
        const allRecovery = [...week(0, 4, 'recovery'), ...week(1, 4, 'recovery'),
            ...week(2, 4, 'recovery'), ...week(3, 4, 'recovery')];
        expect(progressionEligibility(allRecovery, { now: NOW, defaultTarget: 4 }).eligible).toBe(false);
    });

    test('substitutions earn qualifying weeks exactly like scheduled work', () => {
        const subbed = [0, 1, 2, 3].flatMap(w => week(w, 3, 'girth', { scheduledType: 'length', manualOverride: true }));
        expect(progressionEligibility(subbed, { now: NOW, defaultTarget: 4 }).eligible).toBe(true);
    });

    test('it reports that the weekly target was assumed, not remembered', () => {
        // The app stores no schedule history, so this must never be mistaken
        // for a record of what was actually prescribed each week.
        const r = progressionEligibility(fourGoodWeeks, { now: NOW, defaultTarget: 4 });
        expect(r.targetSource).toBe('current-schedule-assumed');
        const withHistory = progressionEligibility(fourGoodWeeks, { now: NOW, weeklyTargets: { x: 4 } });
        expect(withHistory.targetSource).toBe('provided');
    });

    test('an empty log is simply not eligible', () => {
        expect(progressionEligibility([], { now: NOW, defaultTarget: 4 }).eligible).toBe(false);
        expect(progressionEligibility(null, { now: NOW, defaultTarget: 4 }).eligible).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------
describe('RPE tolerance', () => {
    test('a high mean holds advancement', () => {
        const log = [S(4, 'length', { rpe: 9 }), S(3, 'length', { rpe: 8 }), S(2, 'length', { rpe: 9 })];
        const r = rpeTolerance(log);
        expect(r.status).toBe(RPE_STATUS.HOLD);
        expect(r.mean).toBeCloseTo(8.67, 1);
    });

    test('a comfortable mean clears', () => {
        const log = [S(4, 'length', { rpe: 6 }), S(3, 'length', { rpe: 5 }), S(2, 'length', { rpe: 7 })];
        expect(rpeTolerance(log).status).toBe(RPE_STATUS.CLEAR);
    });

    test('it averages only the sessions that carry an RPE', () => {
        // Five qualifying sessions, three with RPE: average the three.
        const log = [S(5, 'length', { rpe: 9 }), S(4), S(3, 'length', { rpe: 9 }), S(2), S(1, 'length', { rpe: 9 })];
        const r = rpeTolerance(log);
        expect(r.samples).toBe(3);
        expect(r.consideredSessions).toBe(5);
        expect(r.mean).toBe(9);
        expect(r.status).toBe(RPE_STATUS.HOLD);
    });

    test('REGRESSION: too little RPE is UNKNOWN, never CLEAR', () => {
        // Missing data must not read as evidence of tolerance.
        const r = rpeTolerance([S(2, 'length', { rpe: 3 })]);
        expect(r.status).toBe(RPE_STATUS.UNKNOWN);
        expect(r.status).not.toBe(RPE_STATUS.CLEAR);
        expect(r.mean).toBeNull();
        expect(r.samples).toBe(1);
        expect(r.minSamples).toBe(2);
    });

    test('no RPE at all is UNKNOWN', () => {
        expect(rpeTolerance([S(3), S(2), S(1)]).status).toBe(RPE_STATUS.UNKNOWN);
        expect(rpeTolerance([]).status).toBe(RPE_STATUS.UNKNOWN);
    });

    test('UNKNOWN does not block forever: it is not a hold', () => {
        const log = [...week(0, 3), ...week(1, 3), ...week(2, 3), ...week(3, 3)];   // no RPE anywhere
        const r = canProgress(log, { now: NOW, defaultTarget: 4 });
        expect(r.rpeUnknown).toBe(true);
        expect(r.held).toBe(false);
        expect(r.available).toBe(true);
    });

    test('only the recent window is considered', () => {
        const log = [
            ...Array.from({ length: 6 }, (_, i) => S(20 - i, 'length', { rpe: 10 })),  // old and brutal
            ...Array.from({ length: 5 }, (_, i) => S(5 - i, 'length', { rpe: 4 })),    // recent and easy
        ];
        expect(rpeTolerance(log).status).toBe(RPE_STATUS.CLEAR);
    });

    test('recovery sessions are not part of the RPE window', () => {
        const log = [S(5, 'recovery', { rpe: 10 }), S(4, 'recovery', { rpe: 10 }), S(3, 'length', { rpe: 4 }), S(2, 'length', { rpe: 4 })];
        const r = rpeTolerance(log);
        expect(r.samples).toBe(2);
        expect(r.status).toBe(RPE_STATUS.CLEAR);
    });

    test('non-numeric RPE values are ignored rather than coerced', () => {
        const log = [S(3, 'length', { rpe: '9' }), S(2, 'length', { rpe: null }), S(1, 'length', { rpe: NaN })];
        expect(rpeTolerance(log).status).toBe(RPE_STATUS.UNKNOWN);
    });
});

describe('recovery safety hold', () => {
    test('three completed recovery sessions in the window holds advancement', () => {
        const log = [S(2, 'recovery'), S(5, 'recovery'), S(9, 'recovery')];
        const r = recoverySafety(log, { now: NOW });
        expect(r.count).toBe(3);
        expect(r.hold).toBe(true);
    });

    test('two does not', () => {
        expect(recoverySafety([S(2, 'recovery'), S(5, 'recovery')], { now: NOW }).hold).toBe(false);
    });

    test('older recovery sessions fall outside the window', () => {
        const log = [S(20, 'recovery'), S(25, 'recovery'), S(30, 'recovery')];
        expect(recoverySafety(log, { now: NOW }).count).toBe(0);
    });

    test('it counts COMPLETED recovery, because routing is never persisted', () => {
        // Gate 0: the resolver is pure, rendering writes nothing, opening the
        // picker writes nothing, and today's soreness is a localStorage key
        // that gets pruned. A log entry is the only durable trace.
        const mechanicalOnly = [S(1), S(2), S(3)];
        expect(recoverySafety(mechanicalOnly, { now: NOW }).count).toBe(0);
    });

    test('future-dated entries are not counted', () => {
        const future = [{ date: new Date(NOW.getTime() + 86400000).toISOString(), routineType: 'recovery' }];
        expect(recoverySafety(future, { now: NOW }).count).toBe(0);
    });
});

describe('holds combine without a score', () => {
    const goodWork = [...week(0, 3), ...week(1, 3), ...week(2, 3), ...week(3, 3)];

    test('eligible and unheld means available', () => {
        expect(canProgress(goodWork, { now: NOW, defaultTarget: 4 }).available).toBe(true);
    });

    test('any single hold is enough to stop it', () => {
        const sore = [...goodWork, S(1, 'length', { rpe: 9 }), S(0, 'length', { rpe: 9 })];
        const r = canProgress(sore, { now: NOW, defaultTarget: 4 });
        expect(r.eligible).toBe(true);
        expect(r.available).toBe(false);
        expect(r.activeHolds).toContain('rpe');
    });

    test('a recovery hold stops it too', () => {
        const recovering = [...goodWork, S(1, 'recovery'), S(3, 'recovery'), S(6, 'recovery')];
        const r = canProgress(recovering, { now: NOW, defaultTarget: 4 });
        expect(r.available).toBe(false);
        expect(r.activeHolds).toContain('recovery');
    });

    test('both holds are reported, not averaged away', () => {
        const both = [...goodWork, S(1, 'length', { rpe: 9 }), S(0, 'length', { rpe: 9 }),
            S(2, 'recovery'), S(4, 'recovery'), S(6, 'recovery')];
        expect(canProgress(both, { now: NOW, defaultTarget: 4 }).activeHolds.sort()).toEqual(['recovery', 'rpe']);
    });

    test('a hold without eligibility is still unavailable', () => {
        const r = canProgress([S(1, 'length', { rpe: 9 }), S(2, 'length', { rpe: 9 })], { now: NOW, defaultTarget: 4 });
        expect(r.eligible).toBe(false);
        expect(r.available).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Deload
// ---------------------------------------------------------------------------
describe('deload on accumulated work', () => {
    const qualifyingWeeks = (n) => Array.from({ length: n }, (_, i) => week(i, 3)).flat();

    test('the fifth qualifying week is the deload week', () => {
        const r = deloadState(qualifyingWeeks(5), { now: NOW, defaultTarget: 4 });
        expect(r.accumulated).toBe(5);
        expect(r.isDeloadWeek).toBe(true);
    });

    test('four is not', () => {
        const r = deloadState(qualifyingWeeks(4), { now: NOW, defaultTarget: 4 });
        expect(r.accumulated).toBe(4);
        expect(r.isDeloadWeek).toBe(false);
    });

    test('a non-qualifying week PAUSES the counter rather than resetting it', () => {
        // weeks 0,1,2 good; week 3 only one session; week 4 good -> 4 total
        const log = [...week(0, 3), ...week(1, 3), ...week(2, 3), ...week(3, 1), ...week(4, 3)];
        const r = deloadState(log, { now: NOW, defaultTarget: 4 });
        expect(r.accumulated).toBe(4);
        expect(r.isDeloadWeek).toBe(false);
    });

    test('and does not advance it either', () => {
        const paused = deloadState([...qualifyingWeeks(4), ...week(5, 0)], { now: NOW, defaultTarget: 4 });
        expect(paused.accumulated).toBe(4);
    });

    test('a recovery-heavy week does not advance the counter', () => {
        const log = [...week(0, 4, 'recovery'), ...week(1, 3), ...week(2, 3)];
        expect(deloadState(log, { now: NOW, defaultTarget: 4 }).accumulated).toBe(2);
    });

    test('substitutions advance it normally', () => {
        const subbed = [0, 1, 2, 3, 4].flatMap(w => week(w, 3, 'girth', { manualOverride: true }));
        expect(deloadState(subbed, { now: NOW, defaultTarget: 4 }).isDeloadWeek).toBe(true);
    });

    test('28 days with no qualifying work resets accumulated progress', () => {
        // Four weeks banked, then a long absence. Returning must not be met
        // with a deload before a single session back.
        const log = [40, 41, 42, 47, 48, 49, 54, 55, 56, 61, 62, 63].map(d => S(d));
        const r = deloadState(log, { now: NOW, defaultTarget: 4 });
        expect(r.stale).toBe(true);
        expect(r.accumulated).toBe(0);
        expect(r.isDeloadWeek).toBe(false);
        expect(r.daysSinceLastQualifying).toBeGreaterThan(PROGRESSION_POLICY.deloadStaleResetDays);
    });

    test('an absence shorter than the stale window does not reset', () => {
        const log = [...week(2, 3), ...week(3, 3)];
        const r = deloadState(log, { now: NOW, defaultTarget: 4 });
        expect(r.stale).toBe(false);
        expect(r.accumulated).toBe(2);
    });

    test('a member who has never trained is not stale, just at zero', () => {
        const r = deloadState([], { now: NOW, defaultTarget: 4 });
        expect(r.accumulated).toBe(0);
        expect(r.stale).toBe(false);
        expect(r.daysSinceLastQualifying).toBeNull();
    });

    test('recovery-only history does not keep the counter alive', () => {
        const log = [S(40, 'recovery'), S(2, 'recovery')];
        expect(deloadState(log, { now: NOW, defaultTarget: 4 }).accumulated).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Programme start
// ---------------------------------------------------------------------------
describe('programme start for new members', () => {
    test('set once, on the first completed qualifying session', () => {
        const d = programmeStartOnCompletion({ programmeStartDate: null, completedEntry: S(0, 'length'), now: NOW });
        expect(d).toBe('2025-03-30');
    });

    test('never moved once it exists', () => {
        expect(programmeStartOnCompletion({ programmeStartDate: '2024-01-01', completedEntry: S(0), now: NOW })).toBeNull();
    });

    test('recovery completion does not start the programme', () => {
        expect(programmeStartOnCompletion({ programmeStartDate: null, completedEntry: S(0, 'recovery'), now: NOW })).toBeNull();
    });

    test('nothing else starts it either', () => {
        for (const entry of [null, {}, { routineType: 'rest' }, { routineType: 'mystery' }]) {
            expect(programmeStartOnCompletion({ programmeStartDate: null, completedEntry: entry, now: NOW })).toBeNull();
        }
    });
});

describe('programme start backfill for existing members', () => {
    test('an existing value is never recomputed', () => {
        const r = programmeStartBackfill({ programmeStartDate: '2024-06-01', sessionLog: [S(1)], now: NOW });
        expect(r.date).toBe('2024-06-01');
        expect(r.source).toBe(PROGRAMME_START_SOURCE.EXISTING);
    });

    test('earliest retained session, but only when history is confirmed complete', () => {
        const log = [S(30), S(20), S(10)];
        const confirmed = programmeStartBackfill({ sessionLog: log, historyComplete: true, allTimeSessionCount: 3, now: NOW });
        expect(confirmed.source).toBe(PROGRAMME_START_SOURCE.EARLIEST_SESSION);
        expect(confirmed.date).toBe('2025-02-28');
    });

    test('REGRESSION: without a completeness guarantee it does not guess', () => {
        // The log is pruned oldest-first at 300 KB, so the earliest retained
        // entry is not always the earliest entry. Preferring UNKNOWN is the
        // whole point.
        const log = [S(30), S(20), S(10)];
        const r = programmeStartBackfill({ sessionLog: log, allTimeSessionCount: 400, now: NOW });
        expect(r.source).toBe(PROGRAMME_START_SOURCE.UNKNOWN_ESTABLISHED);
        expect(r.date).toBeNull();
        expect(r.established).toBe(true);
    });

    test('the legacy field is used only when it does not contradict the log', () => {
        const log = [S(30), S(20)];
        const ok = programmeStartBackfill({ sessionLog: log, firstSessionDate: daysAgo(60).toISOString(), allTimeSessionCount: 2, now: NOW });
        expect(ok.source).toBe(PROGRAMME_START_SOURCE.LEGACY_FIELD);
        expect(ok.date).toBe('2025-01-29');
    });

    test('a legacy date later than the first known session is rejected', () => {
        // It records a tap on a difficulty button, not a session, so it can
        // land anywhere. After the first logged session it is incoherent.
        const log = [S(30), S(20)];
        const r = programmeStartBackfill({ sessionLog: log, firstSessionDate: daysAgo(5).toISOString(), allTimeSessionCount: 2, now: NOW });
        expect(r.source).toBe(PROGRAMME_START_SOURCE.UNKNOWN_ESTABLISHED);
    });

    test('a future legacy date is rejected', () => {
        const future = new Date(NOW.getTime() + 30 * 86400000).toISOString();
        const r = programmeStartBackfill({ sessionLog: [], firstSessionDate: future, allTimeSessionCount: 12, now: NOW });
        expect(r.source).toBe(PROGRAMME_START_SOURCE.UNKNOWN_ESTABLISHED);
    });

    test('an invalid legacy date is rejected', () => {
        const r = programmeStartBackfill({ sessionLog: [], firstSessionDate: 'not a date', allTimeSessionCount: 12, now: NOW });
        expect(r.source).toBe(PROGRAMME_START_SOURCE.UNKNOWN_ESTABLISHED);
    });

    test('an established member with no datable history is never reset to week one', () => {
        const r = programmeStartBackfill({ sessionLog: [], allTimeSessionCount: 220, now: NOW });
        expect(r.established).toBe(true);
        expect(r.date).toBeNull();
        // null date plus history IS the established marker. No second column.
        expect(r.source).toBe(PROGRAMME_START_SOURCE.UNKNOWN_ESTABLISHED);
    });

    test('a genuinely new member is simply not started', () => {
        const r = programmeStartBackfill({ sessionLog: [], allTimeSessionCount: 0, now: NOW });
        expect(r.established).toBe(false);
        expect(r.date).toBeNull();
        expect(r.source).toBe(PROGRAMME_START_SOURCE.NOT_STARTED);
    });

    test('recovery-only history counts as established, not as a start date', () => {
        const r = programmeStartBackfill({ sessionLog: [S(40, 'recovery')], allTimeSessionCount: 1, historyComplete: true, now: NOW });
        expect(r.date).toBeNull();
        expect(r.established).toBe(true);
    });

    test('nothing throws on junk input', () => {
        expect(() => programmeStartBackfill()).not.toThrow();
        expect(programmeStartBackfill({}).source).toBe(PROGRAMME_START_SOURCE.NOT_STARTED);
    });
});
