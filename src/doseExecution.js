/**
 * What exactly does this session execute?
 *
 * One question. The dated plan already stored the answer when it was
 * generated, and until Phase 3C.5 nothing read it: execution rebuilt the
 * session from the member's CURRENT tier, the CURRENT routine tables and the
 * CURRENT clock every time. So a tier advance silently rewrote a prescription
 * that had already been made, and a table edit rewrote every plan ever
 * generated, including yesterday's.
 *
 * This module is the one place that turns a stored dose into executable
 * steps, and the one place that applies a live adjustment to it.
 *
 * THE BASELINE IS STORED. THE ADJUSTMENT IS LIVE.
 *
 *   stored dose        the programme's baseline for that date, at the tier the
 *                      member was on when it was generated. Audited: the
 *                      generator has never shaped it by deload or soreness,
 *                      in any revision, so it is the unmodified baseline.
 *   deload             execution-time. The member's current accumulated load
 *                      is not a property of a prescription made a week ago.
 *   moderate soreness  execution-time, same reasoning, same day.
 *
 * Each is applied EXACTLY ONCE, deload then soreness, left to right, and the
 * result is validated again. A modifier that produces an out-of-range dose
 * fails the launch rather than falling back to the unmodified one: that is a
 * bug in the modifier, not a reason to run the wrong session.
 *
 * THE ARITHMETIC IS NOT REDESIGNED HERE
 *
 * applyShape() from sessionDuration.js is imported rather than reimplemented,
 * so the numbers are bit-for-bit what the app already produced: sets floored
 * at 1, duration rounded half-up, rounding at EACH application rather than
 * once at the end. Modifier strength is a training-science decision and it is
 * not this phase's to make.
 *
 * WHAT A DOSE DOES NOT CONTAIN, ON PURPOSE
 *
 * Cues, how-to text, EQ targets and direction names stay in code. They are
 * instruction, they improve, and freezing them would mean a corrected safety
 * cue never reaching a session already underway. The dose owns the NUMBERS;
 * the tables own the WORDS. A stored title is the join between them.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs, no writes.
 */

import { applyShape } from './sessionDuration.js';

/**
 * The dose SCHEMA version, which is not PROGRAMME_CONTENT_VERSION.
 *
 * They are different concerns and conflating them would make one unusable.
 * PROGRAMME_CONTENT_VERSION says which revision of a programme's content a
 * plan came from: bump it when Last Longer's week changes. This says what
 * SHAPE a dose object has: bump it when a field is added, removed or
 * reinterpreted. A content change leaves the shape alone, and a shape change
 * says nothing about content, so a single number could not answer either
 * question honestly.
 *
 * Absent is read as 1. Every dose in the field was written before this
 * existed and they are all shape 1, so the default is a statement of fact
 * rather than a guess.
 */
export const DOSE_SCHEMA_VERSION = 1;

/** The two shapes the generator produces. Closed. */
export const DOSE_SHAPE = Object.freeze({
    /** Per-exercise sets and holds. length, stamina. */
    SETS:    'sets',
    /** Rounds through fixed stations. girth. */
    CIRCUIT: 'circuit',
});

/** Live adjustments, in application order. */
export const EXECUTION_MODIFIER = Object.freeze({
    DELOAD:            'deload',
    MODERATE_SORENESS: 'moderate-soreness',
});

/**
 * Why a dose is not executable. Stable codes, no prose.
 *
 * The code is diagnostic and goes to analytics. The member sees the one
 * existing "we couldn't read today's session" line, because there is no
 * failure here they can act on.
 */
export const DOSE_INVALID = Object.freeze({
    NOT_AN_OBJECT:          'not_an_object',
    UNSUPPORTED_VERSION:    'unsupported_version',
    UNKNOWN_SHAPE:          'unknown_shape',
    EMPTY_ITEMS:            'empty_items',
    ITEM_MALFORMED:         'item_malformed',
    SETS_OUT_OF_RANGE:      'sets_out_of_range',
    DURATION_OUT_OF_RANGE:  'duration_out_of_range',
    ROUNDS_OUT_OF_RANGE:    'rounds_out_of_range',
    REST_OUT_OF_RANGE:      'rest_out_of_range',
    DIRECTIONS_OUT_OF_RANGE:'directions_out_of_range',
    TITLE_UNRESOLVED:       'title_unresolved',
    TITLE_AMBIGUOUS:        'title_ambiguous',
    TYPE_NOT_EXECUTABLE:    'type_not_executable',
    POST_MODIFIER_INVALID:  'post_modifier_invalid',
});

/** Non-blocking observations. Reported, never a refusal. */
export const DOSE_WARNING = Object.freeze({
    TIER_DISAGREES:  'tier_disagrees',
    UNKNOWN_FIELD:   'unknown_field',
});

/**
 * Bounds.
 *
 * Integers throughout: this programme has no load and no repetitions, only
 * timed holds and counted sets, so there is no decimal field to give a
 * precision rule to. The ceilings are sanity rails rather than programming
 * limits; nothing the generator produces comes near them.
 *
 * restDur is the ONE field where zero is meaningful. Zero sets or a zero
 * second hold is not a lighter session, it is a missing one.
 */
export const BOUNDS = Object.freeze({
    sets:       Object.freeze({ min: 1, max: 20 }),
    duration:   Object.freeze({ min: 1, max: 3600 }),
    rounds:     Object.freeze({ min: 1, max: 20 }),
    restDur:    Object.freeze({ min: 0, max: 600 }),
    directions: Object.freeze({ min: 1, max: 12 }),
});

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, b) => Number.isInteger(v) && v >= b.min && v <= b.max;

/** Fields a dose item may carry. Anything else is a warning, never a refusal. */
const ITEM_FIELDS = new Set(['title', 'sets', 'duration', 'restDur', 'directions']);
const DOSE_FIELDS = new Set(['shape', 'tier', 'v', 'exercises', 'stations', 'rounds', 'restDur']);

const fail = (code, detail, warnings) => ({ ok: false, code, detail: detail || null,
                                            warnings: warnings || [] });

/**
 * Is this stored dose executable, and what is its normalised form?
 *
 * Validates AND normalises in one pass, returning a frozen copy. It never
 * mutates the input and never reads a clock, a global or the DOM, so the same
 * call from the launch gate, from resume, from the reporting path and from a
 * test gives the same answer.
 *
 * `titles` is the set of exercise definitions this build can execute. Passing
 * it is what makes a renamed or deleted exercise fail closed instead of
 * throwing deep inside the engine. Omitting it skips the join check, which is
 * what the generator's own self-check wants.
 *
 * Returns { ok: true, value, warnings } or { ok: false, code, detail, warnings }.
 */
export function validateDose(dose, opts) {
    const o = isPlainObject(opts) ? opts : {};
    const warnings = [];
    if (!isPlainObject(dose)) return fail(DOSE_INVALID.NOT_AN_OBJECT, { got: typeof dose });

    /* Absent means 1: every dose written before this field existed is shape 1. */
    const v = dose.v === undefined ? 1 : dose.v;
    if (v !== DOSE_SCHEMA_VERSION) {
        return fail(DOSE_INVALID.UNSUPPORTED_VERSION, { got: dose.v, supported: DOSE_SCHEMA_VERSION });
    }

    if (dose.shape !== DOSE_SHAPE.SETS && dose.shape !== DOSE_SHAPE.CIRCUIT) {
        return fail(DOSE_INVALID.UNKNOWN_SHAPE, { got: dose.shape });
    }
    for (const k of Object.keys(dose)) {
        if (!DOSE_FIELDS.has(k)) warnings.push({ code: DOSE_WARNING.UNKNOWN_FIELD, detail: { at: 'dose', field: k } });
    }
    if (o.tier !== undefined && typeof dose.tier === 'string' && dose.tier !== o.tier) {
        /* A warning, not a refusal: the tier inside the dose is provenance,
           and the numbers are what execute. */
        warnings.push({ code: DOSE_WARNING.TIER_DISAGREES, detail: { dose: dose.tier, session: o.tier } });
    }

    const known = o.titles instanceof Set ? o.titles
        : (Array.isArray(o.titles) ? new Set(o.titles) : null);
    const seen = new Set();

    const checkItem = (item, needSets) => {
        if (!isPlainObject(item)) return DOSE_INVALID.ITEM_MALFORMED;
        if (typeof item.title !== 'string' || !item.title) return DOSE_INVALID.ITEM_MALFORMED;
        /* EXACT match. No case folding, no whitespace trimming, no aliases:
           a fuzzy join would silently rescue a rename, and a rename is
           precisely the change that must be loud. */
        if (known && !known.has(item.title)) return DOSE_INVALID.TITLE_UNRESOLVED;
        if (seen.has(item.title)) return DOSE_INVALID.TITLE_AMBIGUOUS;
        seen.add(item.title);
        if (needSets && !inRange(item.sets, BOUNDS.sets)) return DOSE_INVALID.SETS_OUT_OF_RANGE;
        if (!inRange(item.duration, BOUNDS.duration)) return DOSE_INVALID.DURATION_OUT_OF_RANGE;
        if (item.restDur !== undefined && !inRange(item.restDur, BOUNDS.restDur)) return DOSE_INVALID.REST_OUT_OF_RANGE;
        if (item.directions !== undefined && !inRange(item.directions, BOUNDS.directions)) return DOSE_INVALID.DIRECTIONS_OUT_OF_RANGE;
        for (const k of Object.keys(item)) {
            if (!ITEM_FIELDS.has(k)) warnings.push({ code: DOSE_WARNING.UNKNOWN_FIELD, detail: { at: item.title, field: k } });
        }
        return null;
    };

    if (dose.shape === DOSE_SHAPE.SETS) {
        if (!Array.isArray(dose.exercises) || !dose.exercises.length) {
            return fail(DOSE_INVALID.EMPTY_ITEMS, { at: 'exercises' }, warnings);
        }
        if (dose.stations !== undefined) return fail(DOSE_INVALID.UNKNOWN_SHAPE, { mixed: true }, warnings);
        for (const ex of dose.exercises) {
            const bad = checkItem(ex, true);
            if (bad) return fail(bad, { title: isPlainObject(ex) ? ex.title : null }, warnings);
        }
        return { ok: true, warnings, value: Object.freeze({
            v: DOSE_SCHEMA_VERSION,
            shape: DOSE_SHAPE.SETS,
            tier: typeof dose.tier === 'string' ? dose.tier : null,
            exercises: Object.freeze(dose.exercises.map(e => Object.freeze(normItem(e, true)))),
        }) };
    }

    if (!Array.isArray(dose.stations) || !dose.stations.length) {
        return fail(DOSE_INVALID.EMPTY_ITEMS, { at: 'stations' }, warnings);
    }
    if (dose.exercises !== undefined) return fail(DOSE_INVALID.UNKNOWN_SHAPE, { mixed: true }, warnings);
    if (!inRange(dose.rounds, BOUNDS.rounds)) return fail(DOSE_INVALID.ROUNDS_OUT_OF_RANGE, { got: dose.rounds }, warnings);
    if (dose.restDur !== undefined && !inRange(dose.restDur, BOUNDS.restDur)) {
        return fail(DOSE_INVALID.REST_OUT_OF_RANGE, { got: dose.restDur }, warnings);
    }
    for (const st of dose.stations) {
        /* A station has no sets of its own: one pass per round is the set. */
        const bad = checkItem(st, false);
        if (bad) return fail(bad, { title: isPlainObject(st) ? st.title : null }, warnings);
    }
    const out = {
        v: DOSE_SCHEMA_VERSION,
        shape: DOSE_SHAPE.CIRCUIT,
        tier: typeof dose.tier === 'string' ? dose.tier : null,
        rounds: dose.rounds,
        stations: Object.freeze(dose.stations.map(s => Object.freeze(normItem(s, false)))),
    };
    if (dose.restDur !== undefined) out.restDur = dose.restDur;
    return { ok: true, warnings, value: Object.freeze(out) };
}

/** One item, with only the fields execution reads. */
function normItem(item, withSets) {
    const out = { title: item.title, duration: item.duration };
    if (withSets) out.sets = item.sets;
    if (item.restDur !== undefined) out.restDur = item.restDur;
    if (item.directions !== undefined) out.directions = item.directions;
    return out;
}

/**
 * Apply the live adjustments, exactly once each, deload then soreness.
 *
 * WHAT EACH SHAPE TOUCHES, and this is observed behaviour rather than a new
 * decision: a sets dose has its sets and hold durations shaped; a circuit has
 * its station durations shaped and its ROUNDS and inter-round REST left
 * alone. Shaping the round count would be a different and much larger
 * reduction than the app has ever applied, so it is not introduced here.
 *
 * restDur and directions are never shaped, in either shape.
 *
 * Returns { ok: true, value, applied } or a validation failure, because the
 * result is re-validated: a modifier is not permitted to produce a dose that
 * would not have been accepted as a baseline.
 */
export function applyExecutionModifiers(dose, input, opts) {
    const i = isPlainObject(input) ? input : {};
    const base = validateDose(dose, opts);
    if (!base.ok) return base;

    const applied = [];
    const shapes = [];
    /* Order is fixed and not configurable. Load management first, then
       today's readiness on top of it. */
    if (i.deload === true) { applied.push(EXECUTION_MODIFIER.DELOAD); shapes.push(i.deloadShape); }
    if (i.moderateSoreness === true) { applied.push(EXECUTION_MODIFIER.MODERATE_SORENESS); shapes.push(i.sorenessShape); }
    if (!applied.length) return { ok: true, value: base.value, applied, warnings: base.warnings };

    /* applyShape, not a local copy, so the numbers stay bit-for-bit what the
       app already produced: floor sets at 1, round duration half-up, and round
       at EACH application rather than once at the end. */
    const shapeItem = (item) => {
        const shaped = shapes.filter(Boolean).reduce((acc, s) => applyShape(acc, s), item);
        const out = { ...item, duration: shaped.duration };
        if (item.sets !== undefined) out.sets = shaped.sets;
        return out;
    };

    const next = base.value.shape === DOSE_SHAPE.SETS
        ? { ...base.value, exercises: base.value.exercises.map(shapeItem) }
        : { ...base.value, stations: base.value.stations.map(shapeItem) };

    const after = validateDose(next, opts);
    if (!after.ok) {
        return fail(DOSE_INVALID.POST_MODIFIER_INVALID,
            { applied, cause: after.code, detail: after.detail }, base.warnings);
    }
    return { ok: true, value: after.value, applied, warnings: base.warnings };
}

/**
 * The ordered executable steps.
 *
 * One entry per exercise, in stored order, which the generator takes from the
 * routine table so the sequence is already authoritative without a separate
 * field. A circuit's rounds are NOT expanded into steps: the engine tracks
 * the round counter itself and re-walks the same stations, which is what it
 * already does.
 *
 * `directions` becomes the loop width for a directional hold. The FLAG is not
 * stored and does not need to be: a positive direction count is what makes a
 * hold directional, so the dose decides the loop shape and the table supplies
 * only the direction names.
 */
export function expandSteps(dose) {
    const r = validateDose(dose);
    if (!r.ok) return { ok: false, code: r.code, detail: r.detail };
    const d = r.value;
    const items = d.shape === DOSE_SHAPE.SETS ? d.exercises : d.stations;
    return {
        ok: true,
        shape: d.shape,
        rounds: d.shape === DOSE_SHAPE.CIRCUIT ? d.rounds : 1,
        roundRest: d.shape === DOSE_SHAPE.CIRCUIT && d.restDur !== undefined ? d.restDur : null,
        steps: items.map(it => Object.freeze({
            title: it.title,
            /* A station is one pass per round. */
            sets: it.sets === undefined ? 1 : it.sets,
            duration: it.duration,
            directions: it.directions === undefined ? 0 : it.directions,
            /* The explicit rest, or the derived one. Mirrors startRest()
               exactly: a third of the hold, clamped to 20 to 90 seconds. */
            restDur: it.restDur !== undefined
                ? it.restDur
                : Math.min(90, Math.max(20, Math.round(it.duration / 3))),
        })),
    };
}
