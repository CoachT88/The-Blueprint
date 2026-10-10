import { describe, test, expect } from 'vitest';
import {
    validateDose, applyExecutionModifiers, expandSteps,
    DOSE_SCHEMA_VERSION, DOSE_SHAPE, DOSE_INVALID, DOSE_WARNING,
    EXECUTION_MODIFIER, BOUNDS,
} from '../src/doseExecution.js';
import { DELOAD_SHAPE, MODERATE_SORENESS_SHAPE } from '../src/sessionDuration.js';

/**
 * The stored dose as execution truth.
 *
 * Two properties carry the whole phase. The numbers a session runs come from
 * the stored dose and from nowhere else, and a live modifier is applied to it
 * exactly once. Everything below is one of those two, or a refusal.
 *
 * The fixtures are the REAL generated shapes, captured from the generator
 * rather than invented, because a schema test against a made-up shape proves
 * nothing about production.
 */

/* Verbatim from the generator at intermediate. */
const GIRTH = Object.freeze({
    v: 1, shape: 'circuit', tier: 'intermediate', rounds: 4, restDur: 45,
    stations: [{ title: 'Wet Jelq', duration: 120 }, { title: 'Uli — Manual Clamp', duration: 45 }],
});
const LENGTH = Object.freeze({
    v: 1, shape: 'sets', tier: 'intermediate',
    exercises: [{ title: 'Directional Pulls', sets: 3, duration: 30, directions: 5 },
                { title: 'V-Stretch', sets: 3, duration: 30 }],
});
const STAMINA = Object.freeze({
    v: 1, shape: 'sets', tier: 'intermediate',
    exercises: [{ title: 'Edging — Controlled Hold', sets: 3, duration: 120 },
                { title: 'Lateral Compression', sets: 3, duration: 15, restDur: 30 }],
});
const SHAPES = { deloadShape: DELOAD_SHAPE, sorenessShape: MODERATE_SORENESS_SHAPE };

describe('every real generated shape validates', () => {
    test.each([['girth', GIRTH], ['length', LENGTH], ['stamina', STAMINA]])(
        '%s', (_n, dose) => {
            const r = validateDose(dose);
            expect(r.ok).toBe(true);
            expect(r.warnings).toEqual([]);
            expect(Object.isFrozen(r.value)).toBe(true);
        });

    test('the normalised value keeps only what execution reads', () => {
        const r = validateDose(LENGTH);
        expect(Object.keys(r.value).sort()).toEqual(['exercises', 'shape', 'tier', 'v']);
        expect(Object.keys(r.value.exercises[0]).sort()).toEqual(['directions', 'duration', 'sets', 'title']);
    });

    test('an absent version reads as 1, because every dose in the field predates the field', () => {
        const { v: _drop, ...noVersion } = LENGTH;
        expect(validateDose(noVersion).ok).toBe(true);
        expect(validateDose(noVersion).value.v).toBe(DOSE_SCHEMA_VERSION);
    });
});

describe('what it refuses, and the code it gives', () => {
    const cases = [
        ['a non-object',            7,                                        DOSE_INVALID.NOT_AN_OBJECT],
        ['null',                    null,                                     DOSE_INVALID.NOT_AN_OBJECT],
        ['a future version',        { ...LENGTH, v: 2 },                      DOSE_INVALID.UNSUPPORTED_VERSION],
        ['an unknown shape',        { ...LENGTH, shape: 'ladder' },           DOSE_INVALID.UNKNOWN_SHAPE],
        ['both item lists',         { ...LENGTH, stations: GIRTH.stations },  DOSE_INVALID.UNKNOWN_SHAPE],
        ['no exercises',            { ...LENGTH, exercises: [] },             DOSE_INVALID.EMPTY_ITEMS],
        ['no stations',             { ...GIRTH, stations: [] },               DOSE_INVALID.EMPTY_ITEMS],
        ['a malformed item',        { ...LENGTH, exercises: [7] },            DOSE_INVALID.ITEM_MALFORMED],
        ['an untitled item',        { ...LENGTH, exercises: [{ sets: 1, duration: 10 }] }, DOSE_INVALID.ITEM_MALFORMED],
        ['zero sets',               setsOf(0),                                DOSE_INVALID.SETS_OUT_OF_RANGE],
        ['negative sets',           setsOf(-1),                               DOSE_INVALID.SETS_OUT_OF_RANGE],
        ['fractional sets',         setsOf(2.5),                              DOSE_INVALID.SETS_OUT_OF_RANGE],
        ['sets past the ceiling',   setsOf(BOUNDS.sets.max + 1),              DOSE_INVALID.SETS_OUT_OF_RANGE],
        ['zero duration',           durOf(0),                                 DOSE_INVALID.DURATION_OUT_OF_RANGE],
        ['negative duration',       durOf(-30),                               DOSE_INVALID.DURATION_OUT_OF_RANGE],
        ['fractional duration',     durOf(30.5),                              DOSE_INVALID.DURATION_OUT_OF_RANGE],
        ['duration past the ceiling', durOf(BOUNDS.duration.max + 1),         DOSE_INVALID.DURATION_OUT_OF_RANGE],
        ['zero rounds',             { ...GIRTH, rounds: 0 },                  DOSE_INVALID.ROUNDS_OUT_OF_RANGE],
        ['missing rounds',          omit(GIRTH, 'rounds'),                    DOSE_INVALID.ROUNDS_OUT_OF_RANGE],
        ['negative rest',           { ...GIRTH, restDur: -1 },                DOSE_INVALID.REST_OUT_OF_RANGE],
        ['rest past the ceiling',   { ...GIRTH, restDur: BOUNDS.restDur.max + 1 }, DOSE_INVALID.REST_OUT_OF_RANGE],
        ['zero directions',         dirOf(0),                                 DOSE_INVALID.DIRECTIONS_OUT_OF_RANGE],
        ['a duplicate title',       dupTitles(),                              DOSE_INVALID.TITLE_AMBIGUOUS],
    ];
    test.each(cases)('%s is refused with its own code', (_n, dose, code) => {
        const r = validateDose(dose);
        expect(r.ok).toBe(false);
        expect(r.code).toBe(code);
        /* A refusal carries no value, so a caller that forgets to check ok
           cannot read a plausible blank off it. */
        expect(r.value).toBeUndefined();
    });

    test('ZERO REST is valid, and it is the only field where zero means something', () => {
        /* No rest between rounds is a real prescription. Zero sets or a zero
           second hold is not a lighter session, it is a missing one. */
        expect(validateDose({ ...GIRTH, restDur: 0 }).ok).toBe(true);
        expect(validateDose(setsOf(0)).ok).toBe(false);
        expect(validateDose(durOf(0)).ok).toBe(false);
    });

    test('a title the build cannot run is refused, and the join is EXACT', () => {
        const titles = ['Directional Pulls', 'V-Stretch'];
        expect(validateDose(LENGTH, { titles }).ok).toBe(true);
        /* No case folding, no trimming, no aliases. A fuzzy join would
           silently rescue a rename, and a rename is the change that has to
           be loud. */
        for (const near of ['directional pulls', 'Directional  Pulls', 'Directional Pulls ', 'Directional-Pulls']) {
            const r = validateDose(LENGTH, { titles: [near, 'V-Stretch'] });
            expect(r.ok, near).toBe(false);
            expect(r.code).toBe(DOSE_INVALID.TITLE_UNRESOLVED);
        }
    });

    test('the em dash in a real station title is not negotiable', () => {
        expect(validateDose(GIRTH, { titles: ['Wet Jelq', 'Uli — Manual Clamp'] }).ok).toBe(true);
        expect(validateDose(GIRTH, { titles: ['Wet Jelq', 'Uli - Manual Clamp'] }).ok).toBe(false);
    });
});

describe('warnings observe without refusing', () => {
    test('a tier disagreement is a warning, because the numbers are what execute', () => {
        const r = validateDose(LENGTH, { tier: 'elite' });
        expect(r.ok).toBe(true);
        expect(r.warnings.map(w => w.code)).toContain(DOSE_WARNING.TIER_DISAGREES);
    });

    test('an unknown field is a warning, so a newer writer is not rejected', () => {
        const r = validateDose({ ...LENGTH, tempo: 'slow' });
        expect(r.ok).toBe(true);
        expect(r.warnings.map(w => w.code)).toContain(DOSE_WARNING.UNKNOWN_FIELD);
        /* And it is dropped from the normalised value rather than carried
           into execution. */
        expect(r.value.tempo).toBeUndefined();
    });
});

describe('the modifiers, applied exactly once', () => {
    test('no modifier leaves the baseline alone', () => {
        const r = applyExecutionModifiers(LENGTH, {}, {});
        expect(r.ok).toBe(true);
        expect(r.applied).toEqual([]);
        expect(r.value.exercises[0]).toMatchObject({ sets: 3, duration: 30 });
    });

    test('deload alone: the audited numbers', () => {
        const r = applyExecutionModifiers(LENGTH, { deload: true, ...SHAPES });
        expect(r.applied).toEqual([EXECUTION_MODIFIER.DELOAD]);
        expect(r.value.exercises.map(e => [e.sets, e.duration])).toEqual([[2, 18], [2, 18]]);
    });

    test('moderate soreness alone: the same constants, so the same numbers', () => {
        const r = applyExecutionModifiers(LENGTH, { moderateSoreness: true, ...SHAPES });
        expect(r.applied).toEqual([EXECUTION_MODIFIER.MODERATE_SORENESS]);
        expect(r.value.exercises.map(e => [e.sets, e.duration])).toEqual([[2, 18], [2, 18]]);
    });

    test('both compose, deload FIRST, and the order is recorded', () => {
        /* 3x30s to 1x11s, which is the arithmetic the app already produced:
           30*0.6=18, 18*0.6=10.8 rounded to 11, sets floored at 1. Rounding
           happens at EACH application rather than once at the end. */
        const r = applyExecutionModifiers(LENGTH, { deload: true, moderateSoreness: true, ...SHAPES });
        expect(r.applied).toEqual([EXECUTION_MODIFIER.DELOAD, EXECUTION_MODIFIER.MODERATE_SORENESS]);
        expect(r.value.exercises.map(e => [e.sets, e.duration])).toEqual([[1, 11], [1, 11]]);
    });

    test('A MODIFIER IS NEVER APPLIED TWICE', () => {
        /* The property, stated directly: feeding the result back in applies
           the modifier to an ALREADY reduced dose, which is the double
           shaping this phase exists to prevent. The pipeline calls this once,
           and this test is what makes a second call visible. */
        const once = applyExecutionModifiers(LENGTH, { deload: true, ...SHAPES });
        const twice = applyExecutionModifiers(once.value, { deload: true, ...SHAPES });
        expect(once.value.exercises[0].duration).toBe(18);
        expect(twice.value.exercises[0].duration).toBe(11);
        expect(twice.value.exercises[0].duration).not.toBe(once.value.exercises[0].duration);
    });

    test('a circuit shapes its STATIONS and leaves rounds and round rest alone', () => {
        /* Observed behaviour, preserved. Shaping the round count would be a
           far larger reduction than the app has ever applied, and the rest
           between rounds is recovery rather than work. */
        const r = applyExecutionModifiers(GIRTH, { deload: true, ...SHAPES });
        expect(r.value.stations.map(s => s.duration)).toEqual([72, 27]);
        expect(r.value.rounds).toBe(4);
        expect(r.value.restDur).toBe(45);
    });

    test('an explicit inter-set rest is never shaped either', () => {
        const r = applyExecutionModifiers(STAMINA, { deload: true, ...SHAPES });
        const lat = r.value.exercises.find(e => e.title === 'Lateral Compression');
        expect(lat.restDur).toBe(30);
        expect(lat.duration).toBe(9);
    });

    test('directions are never shaped', () => {
        const r = applyExecutionModifiers(LENGTH, { deload: true, moderateSoreness: true, ...SHAPES });
        expect(r.value.exercises[0].directions).toBe(5);
    });

    test('sets can never be reduced to zero, however many shapes apply', () => {
        const r = applyExecutionModifiers(LENGTH,
            { deload: true, moderateSoreness: true, ...SHAPES });
        for (const e of r.value.exercises) expect(e.sets).toBeGreaterThanOrEqual(BOUNDS.sets.min);
    });

    test('an invalid baseline is refused before any modifier runs', () => {
        const r = applyExecutionModifiers(setsOf(0), { deload: true, ...SHAPES });
        expect(r.ok).toBe(false);
        expect(r.code).toBe(DOSE_INVALID.SETS_OUT_OF_RANGE);
        expect(r.applied).toBeUndefined();
    });

    test('POST MODIFIER validation: a modifier may not produce what a baseline could not be', () => {
        /* The second check, which is the one worth having. A modifier that
           drives a hold below the floor fails the launch rather than running
           the unmodified session, because that is a bug in the modifier. */
        const tiny = { ...LENGTH, exercises: [{ title: 'Directional Pulls', sets: 1, duration: 1 }] };
        expect(validateDose(tiny).ok).toBe(true);
        const r = applyExecutionModifiers(tiny, { deload: true, deloadShape: { setsOffset: 0, durationMult: 0.1 } });
        expect(r.ok).toBe(false);
        expect(r.code).toBe(DOSE_INVALID.POST_MODIFIER_INVALID);
        expect(r.detail.applied).toEqual([EXECUTION_MODIFIER.DELOAD]);
        expect(r.detail.cause).toBe(DOSE_INVALID.DURATION_OUT_OF_RANGE);
    });

    test('a modifier is allowed to change nothing and still be recorded', () => {
        /* Deload on a single-set exercise cannot reduce the sets further. It
           still happened, and history has to be able to say so. */
        const one = { ...LENGTH, exercises: [{ title: 'Directional Pulls', sets: 1, duration: 100 }] };
        const r = applyExecutionModifiers(one, { deload: true, deloadShape: { setsOffset: -1, durationMult: 1 } });
        expect(r.applied).toEqual([EXECUTION_MODIFIER.DELOAD]);
        expect(r.value.exercises[0]).toMatchObject({ sets: 1, duration: 100 });
    });
});

describe('the executable steps', () => {
    test('order is the stored order, which the generator took from the table', () => {
        const r = expandSteps(LENGTH);
        expect(r.ok).toBe(true);
        expect(r.steps.map(s => s.title)).toEqual(['Directional Pulls', 'V-Stretch']);
    });

    test('a circuit reports its rounds and round rest; stations are one pass each', () => {
        const r = expandSteps(GIRTH);
        expect(r.shape).toBe(DOSE_SHAPE.CIRCUIT);
        expect(r.rounds).toBe(4);
        expect(r.roundRest).toBe(45);
        for (const s of r.steps) expect(s.sets).toBe(1);
    });

    test('a sets dose is one round', () => {
        const r = expandSteps(LENGTH);
        expect(r.rounds).toBe(1);
        expect(r.roundRest).toBeNull();
    });

    test('the derived inter-set rest mirrors startRest exactly', () => {
        /* A third of the hold, clamped to 20 and 90. 30/3 is 10, which clamps
           up to 20; 120/3 is 40; a 400 second hold would clamp down to 90. */
        expect(expandSteps(LENGTH).steps[0].restDur).toBe(20);
        expect(expandSteps(STAMINA).steps[0].restDur).toBe(40);
        const long = { ...LENGTH, exercises: [{ title: 'Directional Pulls', sets: 1, duration: 400 }] };
        expect(expandSteps(long).steps[0].restDur).toBe(90);
    });

    test('an explicit rest wins over the derived one', () => {
        expect(expandSteps(STAMINA).steps[1].restDur).toBe(30);
    });

    test('directions become the loop width, and zero means not directional', () => {
        /* The FLAG is not stored and does not need to be: a positive count is
           what makes a hold directional. */
        const r = expandSteps(LENGTH);
        expect(r.steps[0].directions).toBe(5);
        expect(r.steps[1].directions).toBe(0);
    });

    test('an invalid dose expands to a refusal rather than throwing', () => {
        const r = expandSteps(setsOf(0));
        expect(r.ok).toBe(false);
        expect(r.code).toBe(DOSE_INVALID.SETS_OUT_OF_RANGE);
    });
});

describe('it is pure', () => {
    test('nothing mutates the input', () => {
        const snap = JSON.stringify({ GIRTH, LENGTH, STAMINA });
        validateDose(LENGTH);
        applyExecutionModifiers(GIRTH, { deload: true, moderateSoreness: true, ...SHAPES });
        expandSteps(STAMINA);
        expect(JSON.stringify({ GIRTH, LENGTH, STAMINA })).toBe(snap);
    });

    test('junk cannot throw', () => {
        for (const junk of [null, undefined, 7, 'x', [], true]) {
            expect(() => validateDose(junk)).not.toThrow();
            expect(() => applyExecutionModifiers(junk, {})).not.toThrow();
            expect(() => expandSteps(junk)).not.toThrow();
        }
    });

    test('the same input always gives the same answer', () => {
        const a = applyExecutionModifiers(LENGTH, { deload: true, ...SHAPES });
        const b = applyExecutionModifiers(LENGTH, { deload: true, ...SHAPES });
        expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
    });
});

/* ── helpers that bend one field at a time ───────────────────────────────── */
function setsOf(n) {
    return { ...LENGTH, exercises: [{ title: 'Directional Pulls', sets: n, duration: 30 }] };
}
function durOf(n) {
    return { ...LENGTH, exercises: [{ title: 'Directional Pulls', sets: 3, duration: n }] };
}
function dirOf(n) {
    return { ...LENGTH, exercises: [{ title: 'Directional Pulls', sets: 3, duration: 30, directions: n }] };
}
function dupTitles() {
    return { ...LENGTH, exercises: [{ title: 'V-Stretch', sets: 3, duration: 30 },
                                    { title: 'V-Stretch', sets: 3, duration: 30 }] };
}
function omit(o, k) { const { [k]: _drop, ...rest } = o; return rest; }
