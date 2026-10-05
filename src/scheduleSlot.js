/**
 * What one slot of the schedule means, and how one is produced.
 *
 * WHY THIS EXISTS
 *
 * Three places decided independently whether a schedule slot was scheduled
 * training, and they disagreed about the case that matters most: a value
 * nobody can interpret.
 *
 *   weekCompletion    isScheduledSession() counted anything truthy and not
 *                     'rest', so 'mystery' entered both the numerator and
 *                     the weekly target.
 *   progressionLedger the liveTarget filter did the same, so 'mystery'
 *                     became a session the member owed.
 *   nextBestAction    rung 7 required membership of the known missions, so
 *                     'mystery' was unresolved and prescribed nothing.
 *
 * Two of the three turned a slot nobody could read into a commitment the
 * member was judged against, purely because it was a non-empty string that
 * did not happen to say 'rest'. This module is the one answer.
 *
 * UNKNOWN FAILS SAFE AS UNRESOLVED
 *
 * A value is scheduled primary work only if it is IN THE KNOWN SET. An
 * unresolved slot is in neither the numerator nor the denominator, because a
 * slot we cannot interpret is not a commitment the member should be judged
 * against. That is the behaviour this module changes, deliberately, and it
 * aligns the other two with the resolver rather than the reverse.
 *
 * This applies to LIVE calculation only. Stored historical targets are
 * historical truth and are never recomputed: see reconcileLedger, where
 * liveTarget touches the current week and nothing else.
 *
 * THE LEGACY PROJECTION IS LOSSY, AND SAYS SO
 *
 * The 7-element Sunday-indexed schedule is an external contract: it is read
 * server side by notifyRules to suppress rest-day pushes. Day plans become
 * the authoritative model and that array becomes a derived compatibility
 * output, which means some day plans cannot be expressed in it at all.
 *
 * A support-only day is the clear case: it has real work, so it is not
 * 'rest', and it has no primary session, so there is no legacy type to name.
 * toLegacySlot() reports that rather than resolving it. It is not turned into
 * 'rest', which would suppress a notification for a day that has work; not
 * into a mechanical type, which would falsely claim primary training; and not
 * into a new sentinel, which would quietly widen a vocabulary other consumers
 * also read.
 *
 * The limitation is surfaced so it drives the notification migration instead
 * of being discovered after it ships.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs.
 */

/** What a slot is. Three answers, and the third is not a failure state. */
export const SLOT_CLASS = Object.freeze({
    PRIMARY:    'primary',
    REST:       'rest',
    UNRESOLVED: 'unresolved',
});

/**
 * The legacy vocabulary. Exactly the values the 7-slot column may hold, and
 * exactly the values DAY_TYPES knows, which is what makes it the known set
 * rather than a guess.
 */
export const LEGACY_PRIMARY_TYPES = Object.freeze(['length', 'girth', 'stamina']);
export const LEGACY_REST = 'rest';

/** Why a day plan has no faithful legacy representation. */
export const PROJECTION_REFUSAL = Object.freeze({
    SUPPORT_ONLY:  'support_only_not_representable',
    NOT_A_PLAN:    'not_a_plan',
    UNKNOWN_TYPE:  'primary_type_not_in_legacy_vocabulary',
});

const DAY_MS = 86400000;

/* Options are read the way weekCompletion already reads restTypes and
   mechanicalTypes, so a future programme can widen the vocabulary at a call
   site without editing this file. */
const primariesOf = (opts) =>
    (opts && Array.isArray(opts.primaryTypes)) ? opts.primaryTypes : LEGACY_PRIMARY_TYPES;
const restsOf = (opts) =>
    (opts && Array.isArray(opts.restTypes)) ? opts.restTypes : [LEGACY_REST];

/**
 * The canonical classifier.
 *
 * Membership of the known set, never "truthy and not rest". Missing, empty,
 * non-string and unrecognised all land on UNRESOLVED together, because from
 * the member's point of view they are the same thing: the app cannot say what
 * today is.
 *
 * Rest is checked first so that a vocabulary which somehow listed 'rest' as a
 * primary type still cannot turn a rest day into training.
 */
export function classifySlot(value, opts) {
    if (typeof value !== 'string' || value === '') return SLOT_CLASS.UNRESOLVED;
    if (restsOf(opts).includes(value)) return SLOT_CLASS.REST;
    if (primariesOf(opts).includes(value)) return SLOT_CLASS.PRIMARY;
    return SLOT_CLASS.UNRESOLVED;
}

/** The predicate the three call sites now share. */
export function isScheduledPrimary(value, opts) {
    return classifySlot(value, opts) === SLOT_CLASS.PRIMARY;
}

export function isRestSlot(value, opts) {
    return classifySlot(value, opts) === SLOT_CLASS.REST;
}

export function isUnresolvedSlot(value, opts) {
    return classifySlot(value, opts) === SLOT_CLASS.UNRESOLVED;
}

/**
 * How many slots are scheduled primary work.
 *
 * The weekly denominator. Unresolved slots are not counted, which is the
 * whole point: an undescribed day is not a commitment the member made.
 */
export function countScheduledPrimary(slots, opts) {
    if (!Array.isArray(slots)) return 0;
    let n = 0;
    for (const s of slots) if (isScheduledPrimary(s, opts)) n += 1;
    return n;
}

/**
 * One day plan to one legacy slot, or a refusal that says why.
 *
 * Returns { ok: true, slot } or { ok: false, reason }. A refusal is not an
 * error and must not be treated as one: it is this module declining to
 * express something the legacy shape cannot hold.
 */
export function toLegacySlot(plan, opts) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        return { ok: false, reason: PROJECTION_REFUSAL.NOT_A_PLAN };
    }
    const primary = plan.primarySession;
    if (primary && typeof primary === 'object' && typeof primary.type === 'string') {
        /* A primary type outside the legacy vocabulary is refused rather than
           passed through. Writing it into the column would survive one save
           and then be repaired away by normaliseSchedule, and in the meantime
           the calendar would render it as unknown. */
        if (!primariesOf(opts).includes(primary.type)) {
            return { ok: false, reason: PROJECTION_REFUSAL.UNKNOWN_TYPE, detail: primary.type };
        }
        return { ok: true, slot: primary.type };
    }
    if (plan.mode === 'rest') return { ok: true, slot: LEGACY_REST };

    /* No primary session, and the day is not rest, so there is work here that
       the legacy shape has no word for. Deliberately refused. */
    return { ok: false, reason: PROJECTION_REFUSAL.SUPPORT_ONLY };
}

/** Local YYYY-MM-DD for weekday `index` (Date#getDay) of ref's ISO week. */
function dateKeyForWeekday(ref, index) {
    const monday = new Date(ref);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const d = new Date(monday.getTime() + (((index + 6) % 7) * DAY_MS));
    return d.toISOString().split('T')[0];
}

/**
 * A week of day plans to the legacy 7-slot array.
 *
 * ALWAYS exactly 7 elements, Sunday-indexed by Date#getDay, because that is
 * the external contract notifyRules depends on.
 *
 * A day with no plan, or a plan this module refuses to express, is left as
 * null and NAMED in `unrepresentable`. Nothing is fabricated for a hole:
 * choosing a value would mean choosing between suppressing a notification for
 * a day that has work and claiming training that was not prescribed, and that
 * is a wiring decision taken alongside the notification migration, not a
 * default buried in a pure helper.
 */
export function toLegacySchedule(plans, weekOf, opts) {
    const byDate = new Map();
    for (const p of (Array.isArray(plans) ? plans : [])) {
        if (p && typeof p === 'object' && typeof p.date === 'string') byDate.set(p.date, p);
    }
    const ref = weekOf instanceof Date && !isNaN(weekOf.getTime()) ? weekOf : new Date(0);

    const slots = new Array(7).fill(null);
    const unrepresentable = [];
    for (let i = 0; i < 7; i++) {
        const date = dateKeyForWeekday(ref, i);
        const plan = byDate.get(date);
        if (!plan) { unrepresentable.push({ index: i, date, reason: 'no_plan' }); continue; }
        const r = toLegacySlot(plan, opts);
        if (r.ok) slots[i] = r.slot;
        else unrepresentable.push({ index: i, date, reason: r.reason, detail: r.detail });
    }
    return { slots, unrepresentable };
}
