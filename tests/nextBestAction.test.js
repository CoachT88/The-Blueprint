import { describe, test, expect } from 'vitest';
import {
    nextBestAction, isDeloadWeek, hasPelvicScreen, isPelvicSpecific, allowedRecoveryPlan,
    STATES, TRAINING_MISSIONS,
} from '../src/nextBestAction.js';
import { estimateSessionMinutes } from '../src/sessionDuration.js';

/**
 * The precedence IS the product decision, so most of this file is about which
 * rule wins when two of them could fire. Every adjacent pair in the ladder has
 * a test where both conditions hold.
 *
 * Dates are built from local components rather than parsed from strings, so
 * getDay() means the weekday the test name says it does regardless of where
 * this runs.
 */

const GOALS = {
    size: { label: 'Size', mission: 'length' },
    stamina: { label: 'Lasting longer', mission: 'stamina' },
    eq: { label: 'Erection quality', mission: 'stamina' },
    all: { label: 'All of it', mission: 'length' },
};
const DAY_TYPES = {
    length: { label: 'Length' }, girth: { label: 'Girth' },
    stamina: { label: 'Stamina' }, rest: { label: 'Rest' },
};
// The 'all' goal's schedule, Sunday indexed to match Date#getDay().
const SCHEDULE = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const NO_DAYS = [false, false, false, false, false, false, false];
const CONTRACTION = [0, 3];
const NIGHT_RECOVERY = [0, 1, 2, 3];     // includes both contraction exercises
const MORNING_RECOVERY = [4, 5];         // hip work only

const SUN = new Date(2025, 0, 5);        // schedule[0] length
const MON = new Date(2025, 0, 6);        // schedule[1] girth
const TUE = new Date(2025, 0, 7);        // schedule[2] rest
const WED = new Date(2025, 0, 8);        // schedule[3] stamina
const THU = new Date(2025, 0, 9);        // schedule[4] length
const DELOAD_MON = new Date(2025, 0, 20); // ISO week 4, still schedule[1] girth

const input = (over) => ({
    dataLoaded: true,
    now: MON,
    goals: GOALS,
    goalKey: 'all',
    dayTypes: DAY_TYPES,
    schedule: SCHEDULE,
    completedDays: NO_DAYS,
    sessionDraft: null,
    soreness: '',
    pelvicProfile: 'standard',
    firstSessionDate: '2024-09-01',
    recoveryPlan: NIGHT_RECOVERY,
    contractionIndices: CONTRACTION,
    ...over,
});

// ---------------------------------------------------------------------------
// The helpers the ladder is built from
// ---------------------------------------------------------------------------
describe('isDeloadWeek', () => {
    test('every fourth ISO week once there is enough history', () => {
        expect(isDeloadWeek('2024-09-01', DELOAD_MON)).toBe(true);   // ISO week 4
        expect(isDeloadWeek('2024-09-01', MON)).toBe(false);          // ISO week 2
    });
    test('a member with under four weeks of history never deloads', () => {
        expect(isDeloadWeek('2025-01-14', DELOAD_MON)).toBe(false);
    });
    test('no first session, no deload', () => {
        expect(isDeloadWeek(null, DELOAD_MON)).toBe(false);
        expect(isDeloadWeek('not a date', DELOAD_MON)).toBe(false);
    });
});

describe('hasPelvicScreen', () => {
    test('only the two supported profiles count as screened', () => {
        expect(hasPelvicScreen('tight')).toBe(true);
        expect(hasPelvicScreen('standard')).toBe(true);
        expect(hasPelvicScreen('')).toBe(false);
        // Profiles the screener does not support must never read as screened.
        expect(hasPelvicScreen('weak')).toBe(false);
        expect(hasPelvicScreen('balanced')).toBe(false);
    });
});

describe('isPelvicSpecific', () => {
    test('true only when the plan contains contraction work', () => {
        expect(isPelvicSpecific('recovery', NIGHT_RECOVERY, CONTRACTION)).toBe(true);
        expect(isPelvicSpecific('recovery', MORNING_RECOVERY, CONTRACTION)).toBe(false);
    });
    test('mechanical missions are never pelvic specific today', () => {
        for (const m of TRAINING_MISSIONS) {
            expect(isPelvicSpecific(m, NIGHT_RECOVERY, CONTRACTION)).toBe(false);
        }
    });
});

describe('allowedRecoveryPlan', () => {
    test('a screened, not-tight member gets everything', () => {
        expect(allowedRecoveryPlan(NIGHT_RECOVERY, CONTRACTION, { screened: true, tightFloor: false }))
            .toEqual(NIGHT_RECOVERY);
    });
    test('a tight floor loses contraction work', () => {
        expect(allowedRecoveryPlan(NIGHT_RECOVERY, CONTRACTION, { screened: true, tightFloor: true }))
            .toEqual([1, 2]);
    });
    test('an unscreened member loses it too', () => {
        expect(allowedRecoveryPlan(NIGHT_RECOVERY, CONTRACTION, { screened: false, tightFloor: false }))
            .toEqual([1, 2]);
    });
});

// ---------------------------------------------------------------------------
// The fifteen required cases
// ---------------------------------------------------------------------------
describe('nextBestAction: the required cases', () => {
    test('data unavailable', () => {
        const r = nextBestAction(input({ dataLoaded: false }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
        expect(r.mission).toBeNull();
        expect(r.overrideAllowed).toBe(false);
    });

    test('an unfinished session exists', () => {
        const r = nextBestAction(input({ sessionDraft: { routineType: 'girth', exerciseIndex: 1 } }));
        expect(r.state).toBe('RESUME');
        expect(r.mission).toBe('girth');
    });

    test('no goal', () => {
        const r = nextBestAction(input({ goalKey: '' }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('goal');
    });

    test('an unrecognised goal key is treated as no goal, not as a crash', () => {
        expect(nextBestAction(input({ goalKey: 'hypertrophy' })).prepare).toBe('goal');
    });

    test('pelvic specific prescription and an unscreened member', () => {
        // Reachable once a goal prescribes pelvic work directly. Today no
        // scheduled day does, so this uses a goal whose mission is recovery
        // and a day the schedule does not describe.
        const r = nextBestAction(input({
            goals: { ...GOALS, floor: { label: 'Pelvic health', mission: 'recovery' } },
            goalKey: 'floor',
            schedule: [],
            pelvicProfile: '',
        }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('pelvic-screen');
        expect(r.intendedMission).toBe('recovery');
        expect(r.modifiers.pelvicScreenRequired).toBe(true);
        expect(r.reason).toContain('whether your floor tends to stay tight');
        expect(r.overrideAllowed).toBe(false);
    });

    test('today is already complete', () => {
        const r = nextBestAction(input({ completedDays: [false, true, false, false, false, false, false] }));
        expect(r.state).toBe('COMPLETE');
        expect(r.mission).toBeNull();
        expect(r.reason).toBe('Today is done.');
        // Quiet secondary offer, never a second required task.
        expect(r.optional).toMatchObject({ mission: 'recovery', label: 'Active Recovery', countsTowardWeek: false });
    });

    test('scheduled rest', () => {
        const r = nextBestAction(input({ now: TUE }));
        expect(r.state).toBe('REST');
        expect(r.mission).toBeNull();
        expect(r.reason).toBe('Rest is on the schedule today, and it is part of the programme.');
        expect(r.reason).not.toMatch(/locked/i);
        expect(r.optional.label).toBe('Active Recovery');
        expect(r.optional.label).not.toMatch(/bonus/i);
        expect(r.optional.countsTowardWeek).toBe(false);
    });

    test('a normal scheduled length day', () => {
        const r = nextBestAction(input({ now: THU }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('length');
        expect(r.reason).toBe('Today is a Length day on your schedule.');
        expect(r.optional).toBeNull();
    });

    test('a normal scheduled girth day', () => {
        const r = nextBestAction(input({ now: MON }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('girth');
    });

    test('a normal scheduled stamina day', () => {
        const r = nextBestAction(input({ now: WED }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('stamina');
    });

    test('high soreness, after Ready has supplied it', () => {
        const r = nextBestAction(input({ now: THU, soreness: 'high' }));
        expect(r.state).toBe('RECOVER');
        expect(r.mission).toBe('recovery');
        expect(r.reason).toBe('Mechanical training is on hold today because you reported high muscle soreness.');
        // Not an injury claim, and not overridable.
        expect(r.reason).not.toMatch(/injur|damage|scar/i);
        expect(r.overrideAllowed).toBe(false);
    });

    test('moderate soreness', () => {
        const r = nextBestAction(input({ now: THU, soreness: 'moderate' }));
        expect(r.state).toBe('MODIFIED');
        expect(r.mission).toBe('length');
        expect(r.modifiers.moderateSoreness).toBe(true);
        expect(r.reason).toBe('Reduced today because you reported moderate muscle soreness.');
        // A product heuristic, never presented as a validated dose.
        expect(r.reason).not.toMatch(/research|study|clinical|60%/i);
        expect(r.overrideAllowed).toBe(true);
    });

    test('mild soreness changes nothing, matching current behaviour', () => {
        const r = nextBestAction(input({ now: THU, soreness: 'mild' }));
        expect(r.state).toBe('TRAIN');
        expect(r.modifiers.moderateSoreness).toBe(false);
    });

    test('a tight pelvic profile', () => {
        const r = nextBestAction(input({ now: TUE, pelvicProfile: 'tight' }));
        expect(r.modifiers.tightFloor).toBe(true);
        // Contraction work is withheld, and the result says so rather than
        // quietly shortening the list.
        expect(r.recoveryPlan).toEqual([1, 2]);
        expect(r.changes.join(' ')).toMatch(/tight floor/i);
        // A tight floor is not an unscreened member.
        expect(r.modifiers.pelvicScreenRequired).toBe(false);
    });

    test('a tight profile does not change a mechanical training day', () => {
        const r = nextBestAction(input({ now: THU, pelvicProfile: 'tight' }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('length');
    });

    test('the deload modifier', () => {
        const r = nextBestAction(input({ now: DELOAD_MON }));
        expect(r.state).toBe('TRAIN');
        expect(r.modifiers.deload).toBe(true);
        expect(r.changes.join(' ')).toMatch(/deload/i);
    });

    test('an unknown or malformed schedule falls back to the goal mission', () => {
        for (const schedule of [null, [], ['mystery'], [undefined], 'length']) {
            const r = nextBestAction(input({ now: SUN, schedule, goalKey: 'stamina' }));
            expect(r.state, JSON.stringify(schedule)).toBe('TRAIN');
            expect(r.mission).toBe('stamina');
            expect(r.reason).toBe('Nothing is scheduled for today, so this follows your goal.');
        }
    });

    test('an explicit rest is a rest, but an unreadable slot is not', () => {
        // getScheduledType() returns 'rest' for both, which turns a corrupt
        // array into a week off. Only the explicit value rests here.
        expect(nextBestAction(input({ now: TUE })).state).toBe('REST');
        expect(nextBestAction(input({ now: TUE, schedule: ['length', 'girth', 'mystery'] })).state).toBe('TRAIN');
    });
});

// ---------------------------------------------------------------------------
// Precedence: every adjacent pair, with both conditions true
// ---------------------------------------------------------------------------
describe('nextBestAction: precedence', () => {
    test('1 over 2: no data beats an unfinished session', () => {
        const r = nextBestAction(input({ dataLoaded: false, sessionDraft: { routineType: 'girth' } }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
    });

    test('2 over 3: an unfinished session beats a missing goal', () => {
        const r = nextBestAction(input({ sessionDraft: { routineType: 'girth' }, goalKey: '' }));
        expect(r.state).toBe('RESUME');
    });

    test('3 over 4: a missing goal beats a finished day', () => {
        const r = nextBestAction(input({ goalKey: '', completedDays: [false, true] }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('goal');
    });

    test('4 over 5: a finished day beats high soreness', () => {
        const r = nextBestAction(input({ completedDays: [false, true], soreness: 'high' }));
        expect(r.state).toBe('COMPLETE');
    });

    test('5 over 6: high soreness beats a scheduled rest day', () => {
        // Both point away from training, but the reason the member is shown
        // has to be the one that matters.
        const r = nextBestAction(input({ now: TUE, soreness: 'high' }));
        expect(r.state).toBe('RECOVER');
        expect(r.overrideAllowed).toBe(false);
    });

    test('6 over 7: a scheduled rest day beats moderate soreness', () => {
        const r = nextBestAction(input({ now: TUE, soreness: 'moderate' }));
        expect(r.state).toBe('REST');
        expect(r.modifiers.moderateSoreness).toBe(false);
    });

    test('7 over 8: moderate soreness beats a normal scheduled day', () => {
        const r = nextBestAction(input({ now: MON, soreness: 'moderate' }));
        expect(r.state).toBe('MODIFIED');
        expect(r.mission).toBe('girth');
    });

    test('8 over 9: a readable schedule beats the goal fallback', () => {
        // Scheduled girth, but the goal's mission is length.
        const r = nextBestAction(input({ now: MON, goalKey: 'size' }));
        expect(r.mission).toBe('girth');
    });

    test('moderate soreness still uses the goal when the schedule is unreadable', () => {
        const r = nextBestAction(input({ now: MON, schedule: ['x'], soreness: 'moderate', goalKey: 'stamina' }));
        expect(r.state).toBe('MODIFIED');
        expect(r.mission).toBe('stamina');
    });

    test('every condition at once resolves to the highest rule', () => {
        const r = nextBestAction(input({
            dataLoaded: false,
            sessionDraft: { routineType: 'length' },
            goalKey: '',
            completedDays: [true, true, true, true, true, true, true],
            soreness: 'high',
            now: TUE,
            pelvicProfile: '',
        }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
    });

    test('the result always carries a state the UI knows', () => {
        const cases = [
            input({ dataLoaded: false }), input({ sessionDraft: {} }), input({ goalKey: '' }),
            input({ completedDays: [false, true] }), input({ soreness: 'high' }),
            input({ now: TUE }), input({ soreness: 'moderate' }), input({}), input({ schedule: null }),
        ];
        for (const c of cases) expect(STATES).toContain(nextBestAction(c).state);
    });
});

// ---------------------------------------------------------------------------
// The pelvic gate, where it does not change the state
// ---------------------------------------------------------------------------
describe('nextBestAction: the pelvic screener gate', () => {
    test('an unscreened member routed to Recovery is not stopped by the screener', () => {
        // Answering a safety signal with a questionnaire would leave a sore
        // member with nothing to do.
        const r = nextBestAction(input({ soreness: 'high', pelvicProfile: '' }));
        expect(r.state).toBe('RECOVER');
        expect(r.mission).toBe('recovery');
        expect(r.modifiers.pelvicScreenRequired).toBe(true);
        expect(r.recoveryPlan).toEqual([1, 2]);
        expect(r.changes.join(' ')).toMatch(/pelvic floor check/i);
    });

    test('a rest day flags the screener for its optional recovery', () => {
        const r = nextBestAction(input({ now: TUE, pelvicProfile: '' }));
        expect(r.state).toBe('REST');
        expect(r.modifiers.pelvicScreenRequired).toBe(true);
        expect(r.optional.exercises).toEqual([1, 2]);
    });

    test('a plan with no contraction work does not raise the gate', () => {
        const r = nextBestAction(input({ soreness: 'high', pelvicProfile: '', recoveryPlan: MORNING_RECOVERY }));
        expect(r.modifiers.pelvicScreenRequired).toBe(false);
        expect(r.recoveryPlan).toEqual(MORNING_RECOVERY);
    });

    test('a screened member keeps the whole plan', () => {
        const r = nextBestAction(input({ soreness: 'high', pelvicProfile: 'standard' }));
        expect(r.modifiers.pelvicScreenRequired).toBe(false);
        expect(r.recoveryPlan).toEqual(NIGHT_RECOVERY);
    });

    test('an offer that narrows to nothing is not made', () => {
        const r = nextBestAction(input({ now: TUE, pelvicProfile: '', recoveryPlan: CONTRACTION }));
        expect(r.optional).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Duration, wired to the real estimator
// ---------------------------------------------------------------------------
describe('nextBestAction: duration', () => {
    const ROUTINES = {
        length: [{ sets: 3, duration: 30 }, { sets: 3, duration: 30 }],
        girth: [], stamina: [{ sets: 3, duration: 120 }, { sets: 3, duration: 15, restDur: 30 }],
        recovery: [
            { sets: 3, duration: 60 }, { sets: 3, duration: 45 }, { sets: 3, duration: 45 },
            { sets: 3, duration: 60 }, { sets: 2, duration: 60 }, { sets: 2, duration: 45 },
            { sets: 2, duration: 60 }, { sets: 2, duration: 45 },
        ],
    };
    const DIFFICULTIES = [{ id: 'intermediate', durationMult: 1.0, setsOffset: 0 }];
    const estimateMinutes = (mission, opts) => estimateSessionMinutes(mission, {
        routines: ROUTINES, difficulties: DIFFICULTIES, difficulty: 'intermediate', ...opts,
    });

    test('a training day reports its length', () => {
        const r = nextBestAction(input({ now: THU, estimateMinutes }));
        expect(r.duration).toBe(14);
    });

    test('moderate soreness shortens the reported length', () => {
        const normal = nextBestAction(input({ now: THU, estimateMinutes })).duration;
        const reduced = nextBestAction(input({ now: THU, soreness: 'moderate', estimateMinutes })).duration;
        expect(reduced).toBeLessThan(normal);
    });

    test('recovery is costed from the narrowed plan, not the requested one', () => {
        const screened = nextBestAction(input({ soreness: 'high', pelvicProfile: 'standard', estimateMinutes }));
        const unscreened = nextBestAction(input({ soreness: 'high', pelvicProfile: '', estimateMinutes }));
        expect(unscreened.duration).toBeLessThan(screened.duration);
    });

    test('without an estimator the duration is null rather than a guess', () => {
        expect(nextBestAction(input({ now: THU })).duration).toBeNull();
    });

    test('states that are not a session report no duration', () => {
        expect(nextBestAction(input({ now: TUE, estimateMinutes })).duration).toBeNull();
        expect(nextBestAction(input({ completedDays: [false, true], estimateMinutes })).duration).toBeNull();
        expect(nextBestAction(input({ dataLoaded: false, estimateMinutes })).duration).toBeNull();
    });

    test('the optional offer still carries its own duration', () => {
        const r = nextBestAction(input({ now: TUE, estimateMinutes }));
        expect(r.optional.duration).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Shape and hygiene
// ---------------------------------------------------------------------------
describe('nextBestAction: the returned object', () => {
    test('presentation never has to reverse engineer the decision', () => {
        const r = nextBestAction(input({ now: THU }));
        for (const key of ['state', 'mission', 'reason', 'duration', 'modifiers', 'overrideAllowed',
            'optional', 'changes', 'prepare', 'intendedMission', 'recoveryPlan']) {
            expect(Object.hasOwn(r, key), `missing ${key}`).toBe(true);
        }
        expect(Object.keys(r.modifiers).sort())
            .toEqual(['deload', 'moderateSoreness', 'pelvicScreenRequired', 'tightFloor']);
    });

    test('an empty input does not throw', () => {
        const r = nextBestAction({});
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
    });

    test('no reason uses an em dash', () => {
        const cases = [
            input({ dataLoaded: false }), input({ goalKey: '' }), input({ sessionDraft: {} }),
            input({ completedDays: [false, true] }), input({ soreness: 'high' }),
            input({ soreness: 'moderate' }), input({ now: TUE }), input({ now: THU }),
            input({ schedule: null }), input({ pelvicProfile: '', soreness: 'high' }),
        ];
        for (const c of cases) {
            const r = nextBestAction(c);
            expect(r.reason).not.toContain('—');
            for (const change of r.changes) expect(change).not.toContain('—');
        }
    });

    test('no reason implies that soreness is an injury', () => {
        for (const soreness of ['mild', 'moderate', 'high']) {
            const r = nextBestAction(input({ now: THU, soreness }));
            expect(r.reason).not.toMatch(/injur|damage|scar tissue|risk/i);
        }
    });

    test('the resolver is deterministic for the same input', () => {
        const a = nextBestAction(input({ now: THU }));
        const b = nextBestAction(input({ now: THU }));
        expect(a).toEqual(b);
    });

    test('it reads no clock of its own', () => {
        // Same state, two different days, two different answers.
        expect(nextBestAction(input({ now: MON })).mission).toBe('girth');
        expect(nextBestAction(input({ now: WED })).mission).toBe('stamina');
    });
});
