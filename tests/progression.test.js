import { describe, test, expect } from 'vitest';
import {
    MECHANICAL_MISSIONS, RPE_STATUS, PROGRAMME_START_SOURCE,
    isQualifyingSession, isRecoverySession, qualifyingSessionDays, lifetimeVolume,
    qualifyingWeek, countQualifyingDaysInWeek,
    rpeTolerance, recoverySafety, toleranceHolds,
    programmeStartBackfill, programmeStartOnCompletion, provablyFirstMechanicalSession,
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
        // Move a knob and assert the behaviour moves with it. This is what
        // stops a literal creeping back into a rule.
        const loose = withPolicy({ qualifyingWeekMinSessions: 1, qualifyingWeekMaxMissed: 3 });
        expect(qualifyingWeek(4, 1).qualifies).toBe(false);
        expect(qualifyingWeek(4, 1, loose).qualifies).toBe(true);

        const strict = withPolicy({ rpeHoldThreshold: 4 });
        const easy = [S(3, 'length', { rpe: 5 }), S(2, 'length', { rpe: 5 }), S(1, 'length', { rpe: 5 })];
        expect(rpeTolerance(easy).status).toBe(RPE_STATUS.CLEAR);
        expect(rpeTolerance(easy, strict).status).toBe(RPE_STATUS.HOLD);
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
        expect(r.minSamples).toBe(3);
    });

    test('no RPE at all is UNKNOWN', () => {
        expect(rpeTolerance([S(3), S(2), S(1)]).status).toBe(RPE_STATUS.UNKNOWN);
        expect(rpeTolerance([]).status).toBe(RPE_STATUS.UNKNOWN);
    });

    test('UNKNOWN does not block: it is not a hold', () => {
        const log = [...week(0, 3), ...week(1, 3)];                 // no RPE anywhere
        const holds = toleranceHolds(log, { now: NOW });
        expect(holds.rpe.status).toBe(RPE_STATUS.UNKNOWN);
        expect(holds.held).toBe(false);
        expect(holds.active).toEqual([]);
    });

    test('exactly one short of the minimum is still UNKNOWN', () => {
        // rpeMinSamples is 3, so two valid values is not enough.
        const log = [S(3, 'length', { rpe: 10 }), S(2, 'length', { rpe: 10 }), S(1)];
        const r = rpeTolerance(log);
        expect(r.samples).toBe(2);
        expect(r.status).toBe(RPE_STATUS.UNKNOWN);
    });

    test('only the recent window is considered', () => {
        const log = [
            ...Array.from({ length: 6 }, (_, i) => S(20 - i, 'length', { rpe: 10 })),  // old and brutal
            ...Array.from({ length: 5 }, (_, i) => S(5 - i, 'length', { rpe: 4 })),    // recent and easy
        ];
        expect(rpeTolerance(log).status).toBe(RPE_STATUS.CLEAR);
    });

    test('recovery sessions are not part of the RPE window', () => {
        // Three brutal recovery ratings and three easy mechanical ones: only
        // the mechanical three are considered, so this clears.
        const log = [
            S(6, 'recovery', { rpe: 10 }), S(5, 'recovery', { rpe: 10 }), S(4, 'recovery', { rpe: 10 }),
            S(3, 'length', { rpe: 4 }), S(2, 'length', { rpe: 4 }), S(1, 'length', { rpe: 4 }),
        ];
        const r = rpeTolerance(log);
        expect(r.samples).toBe(3);
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
    // Whether a hold BLOCKS is decided in progressionLedger.canProgress(),
    // which is where eligibility lives. This is only about detection.
    test('no signals means no holds', () => {
        expect(toleranceHolds([], { now: NOW })).toMatchObject({ held: false, active: [] });
    });

    test('an RPE hold is detected and named', () => {
        const sore = [S(3, 'length', { rpe: 9 }), S(2, 'length', { rpe: 9 }), S(1, 'length', { rpe: 9 })];
        const h = toleranceHolds(sore, { now: NOW });
        expect(h.held).toBe(true);
        expect(h.active).toContain('rpe');
    });

    test('a recovery hold is detected and named', () => {
        const recovering = [S(1, 'recovery'), S(3, 'recovery'), S(6, 'recovery')];
        const h = toleranceHolds(recovering, { now: NOW });
        expect(h.held).toBe(true);
        expect(h.active).toContain('recovery');
    });

    test('both are reported separately, never averaged into one number', () => {
        const both = [S(3, 'length', { rpe: 9 }), S(2, 'length', { rpe: 9 }), S(1, 'length', { rpe: 9 }),
            S(2, 'recovery'), S(4, 'recovery'), S(6, 'recovery')];
        expect(toleranceHolds(both, { now: NOW }).active.sort()).toEqual(['recovery', 'rpe']);
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

/**
 * Proving a first mechanical session, Phase 2B.3.3.
 *
 * The acknowledgment this gates says the programme has begun, so it must
 * never reach someone it has already begun for. The question is answered
 * from evidence or refused; there is deliberately no session-count
 * threshold, because no N separates a new member whose debut was Recovery
 * from a tenured one whose log was pruned.
 */
describe('provably first mechanical session', () => {
    const S = (routineType, day) => ({ date: `2025-06-${String(day).padStart(2, '0')}T12:00:00.000Z`, routineType });
    /** `log`, with allTimeSessionCount defaulting to a complete history. */
    const ask = (log, count) => provablyFirstMechanicalSession({
        sessionLog: log, allTimeSessionCount: count === undefined ? log.length : count,
    });

    test('ACCEPTANCE: the first session ever, and it is mechanical', () => {
        expect(ask([S('length', 1)])).toBe(true);
    });

    test('ACCEPTANCE: Recovery first, then the first mechanical one', () => {
        expect(ask([S('recovery', 1), S('length', 2)])).toBe(true);
    });

    test('ACCEPTANCE: several Recovery sessions, then the first mechanical one', () => {
        expect(ask([S('recovery', 1), S('recovery', 2), S('recovery', 3), S('length', 4)])).toBe(true);
    });

    test('ACCEPTANCE: a veteran with a pruned log is refused', () => {
        // 300 sessions ever, 50 retained. The equality is what catches it.
        const log = Array.from({ length: 50 }, (_, i) => S('recovery', (i % 28) + 1));
        log.push(S('length', 29));
        expect(ask(log, 300)).toBe(false);
    });

    test('ACCEPTANCE: established-start-unknown is refused', () => {
        // One retained entry, a lifetime of history behind it.
        expect(ask([S('length', 1)], 300)).toBe(false);
    });

    test('ACCEPTANCE: retained history already holding a mechanical session is refused', () => {
        // Complete history, but they have trained mechanically before. This
        // is the case the count alone would miss, because a member can hold
        // mechanical history and still have no programme start date.
        expect(ask([S('length', 1), S('recovery', 2), S('girth', 3)])).toBe(false);
    });

    test('every mechanical type counts as prior history', () => {
        for (const type of MECHANICAL_MISSIONS) {
            expect(ask([S(type, 1), S('length', 2)])).toBe(false);
        }
    });

    test('REGRESSION: the session being asked about does not veto itself', () => {
        // It is the last entry and is excluded, or nothing would ever pass.
        expect(ask([S('length', 1)])).toBe(true);
        expect(ask([S('recovery', 1), S('girth', 2)])).toBe(true);
    });

    test('REGRESSION: a count above the retained length is refused', () => {
        for (const count of [2, 3, 51, 300]) {
            expect(ask([S('length', 1)], count)).toBe(false);
        }
    });

    test('REGRESSION: a count below the retained length is refused too', () => {
        // A member predating the field, or an import whose backup omitted
        // it, loads as 0 against a populated log. Not provable either way.
        expect(ask([S('recovery', 1), S('length', 2)], 0)).toBe(false);
        expect(ask([S('recovery', 1), S('recovery', 2), S('length', 3)], 1)).toBe(false);
    });

    test('an empty or absent log proves nothing', () => {
        expect(ask([], 0)).toBe(false);
        expect(provablyFirstMechanicalSession({ sessionLog: null, allTimeSessionCount: 0 })).toBe(false);
        expect(provablyFirstMechanicalSession({})).toBe(false);
        expect(provablyFirstMechanicalSession()).toBe(false);
    });

    test('a missing or malformed count is refused rather than assumed', () => {
        const log = [S('recovery', 1), S('length', 2)];
        for (const count of [undefined, null, NaN, '2', {}]) {
            expect(provablyFirstMechanicalSession({ sessionLog: log, allTimeSessionCount: count })).toBe(false);
        }
    });

    test('junk entries do not throw', () => {
        expect(() => provablyFirstMechanicalSession({
            sessionLog: [null, 'junk', {}, S('length', 2)], allTimeSessionCount: 4,
        })).not.toThrow();
    });
});
