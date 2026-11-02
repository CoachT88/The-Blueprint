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
 * Note the asymmetry in configurability. classifySlot and its predicates
 * accept an explicit known set, because the resolver already passes its own
 * missions and a future programme will widen what counts as training. The
 * PROJECTION functions take no options at all: the persisted vocabulary is
 * closed, and a caller must not be able to widen it through configuration
 * and so reintroduce by the back door the sentinel we rejected at the front.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs.
 */

import { localDateKeyForWeekday } from './weekUtils.js';

/**
 * What a slot is. Four answers now, and neither of the last two is a failure.
 *
 * SUPPORT is the one being added, and the reason is that a support-only day
 * had no answer here at all. classifySlot() sent it to UNRESOLVED, which
 * means "the app cannot say what today is" and is the honest answer for a
 * corrupt record and the wrong one for a day the programme described
 * perfectly well. Every consumer that branches on UNRESOLVED then treated a
 * real prescription as unreadable data.
 *
 * UNRESOLVED keeps its original meaning, so the distinction the module was
 * written to protect survives: a value nobody can interpret is still in
 * neither the numerator nor the denominator, and still prescribes nothing.
 */
export const SLOT_CLASS = Object.freeze({
    PRIMARY:    'primary',
    SUPPORT:    'support',
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

/**
 * The two new kinds of day, as slot values.
 *
 * SUPPORT    real supporting work and no mechanical primary session.
 * FULL_REST  nothing required at all: no primary, no supporting work and no
 *            daily practice. Distinct from LEGACY_REST, which today always
 *            carries a required practice, so a member on a 'rest' day is
 *            asked for something and a member on a 'full-rest' day is not.
 *
 * These are classified here and are NOT added to the legacy projection
 * vocabulary. toLegacySlot() still refuses a support-only day, deliberately,
 * and the long comment there says why. The short version: an older cached
 * client runs normaliseSchedule() on every load, which replaces any slot
 * outside DAY_TYPES with the default for that index, so a 'support' value
 * written into the persisted column does not merely fail to render on an old
 * client, it is silently rewritten to a MECHANICAL type and saved. Widening
 * the projection is therefore gated on old clients, not on this module.
 */
export const LEGACY_SUPPORT = 'support';
export const LEGACY_FULL_REST = 'full-rest';

/** Slot values that mean "no mechanical primary work today". */
export const NON_TRAINING_TYPES = Object.freeze([LEGACY_REST, LEGACY_FULL_REST]);
/** Slot values that mean "work today, but none of it mechanical primary". */
export const SUPPORT_TYPES = Object.freeze([LEGACY_SUPPORT]);

/** Why a day plan has no faithful legacy representation. */
export const PROJECTION_REFUSAL = Object.freeze({
    SUPPORT_ONLY:  'support_only_not_representable',
    NOT_A_PLAN:    'not_a_plan',
    UNKNOWN_TYPE:  'primary_type_not_in_legacy_vocabulary',
    NO_PLAN:       'no_plan',
});


/* Options are read the way weekCompletion already reads restTypes and
   mechanicalTypes, so a future programme can widen the vocabulary at a call
   site without editing this file. */
const primariesOf = (opts) =>
    (opts && Array.isArray(opts.primaryTypes)) ? opts.primaryTypes : LEGACY_PRIMARY_TYPES;
const restsOf = (opts) =>
    (opts && Array.isArray(opts.restTypes)) ? opts.restTypes : NON_TRAINING_TYPES;
const supportsOf = (opts) =>
    (opts && Array.isArray(opts.supportTypes)) ? opts.supportTypes : SUPPORT_TYPES;

/**
 * The canonical classifier.
 *
 * Membership of the known set, never "truthy and not rest". Missing, empty,
 * non-string and unrecognised all land on UNRESOLVED together, because from
 * the member's point of view they are the same thing: the app cannot say what
 * today is.
 *
 * Rest is checked first so that a vocabulary which somehow listed 'rest' as a
 * primary type still cannot turn a rest day into training. Support is checked
 * before primary for the same reason and in the same direction: of the two
 * ways a mistake could go, reading real training as support understates the
 * day, and reading support as training prescribes manual work nobody
 * assigned. The cheaper error is the one that cannot hurt anybody.
 *
 * The default rest set now holds BOTH 'rest' and 'full-rest', so every
 * existing consumer treats a genuine full-rest day the way it already treats
 * a rest day: not training, not a commitment, not a gap in the week. The two
 * are told apart by isFullRestSlot() where the difference matters, which is
 * the Today card and the daily practice, not the counting.
 */
export function classifySlot(value, opts) {
    if (typeof value !== 'string' || value === '') return SLOT_CLASS.UNRESOLVED;
    if (restsOf(opts).includes(value)) return SLOT_CLASS.REST;
    if (supportsOf(opts).includes(value)) return SLOT_CLASS.SUPPORT;
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

/** Real work today, none of it a mechanical primary session. */
export function isSupportSlot(value, opts) {
    return classifySlot(value, opts) === SLOT_CLASS.SUPPORT;
}

/**
 * Nothing required at all, as against a rest day that still asks for the
 * daily practice. Asked of the value directly rather than through
 * classifySlot, because both land on REST there on purpose and this is the
 * one question that needs them separated.
 */
export function isFullRestSlot(value) {
    return value === LEGACY_FULL_REST;
}

/**
 * What kind of day is this PLAN?
 *
 * The plan is the authority, not the projected slot, and until now three
 * callers each worked this out from the plan's fields by hand: typeOfPlan()
 * in weekStrip, toLegacySlot() here, and the Today prescription. They
 * agreed about primary and rest and disagreed about everything else,
 * because a support-only day fell off the end of each of them differently.
 *
 * Takes an ALREADY NORMALISED plan, so this answers a question about valid
 * prescribed state and never about whether a record could be read. A caller
 * holding raw data runs normaliseDayPlan() first and handles its null, which
 * is the data-integrity condition this deliberately does not model.
 *
 * Note what a MIXED day returns: its primary type. A day carrying a
 * mechanical primary session AND supporting work is, as far as the slot
 * vocabulary is concerned, a day of that mechanical type. The supporting
 * work is additional, tracked separately and completed separately. That is
 * what lets All of It schedule primary plus support on one date without
 * needing a slot value for the combination, and it is why no 'mixed' class
 * appears above.
 */
export function classifyDayPlan(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        return { class: SLOT_CLASS.UNRESOLVED, slot: undefined };
    }
    const supporting = Array.isArray(plan.supportingWork) ? plan.supportingWork : [];
    const practice = Array.isArray(plan.dailyPractice) ? plan.dailyPractice : [];

    if (plan.mode === 'rest') {
        /* EVERY rest-mode plan is 'rest' here, and full rest is NOT inferred.
           I wrote the opposite first: no daily practice meant genuine full
           rest. It is wrong, and the way it is wrong is the mistake this
           module exists to prevent.

           An empty dailyPractice does not mean the programme asked for
           nothing. It also happens when buildPelvicPracticePlan returns
           mode 'paused' with no steps, which is what an unresolved PAIN
           report produces, and on terse records written before the practice
           existed. So the rule would have silently relabelled a member's
           rest day as full rest BECAUSE HE REPORTED PAIN, turning a safety
           state into a programme state. dayPlan.js warns about exactly that
           conflation and it is right to.

           Full rest therefore has to be marked by the generator, not deduced
           from an absence, and that marker is a data-contract change with a
           versioned reader and writer. It belongs in the phase that
           introduces it. LEGACY_FULL_REST is defined and classified above so
           the vocabulary is agreed across the wire now; nothing produces one
           yet, which is the honest position. */
        return { class: SLOT_CLASS.REST, slot: LEGACY_REST };
    }

    const primary = plan.primarySession;
    if (primary && typeof primary === 'object' && typeof primary.type === 'string' && primary.type) {
        return {
            class: classifySlot(primary.type) === SLOT_CLASS.PRIMARY
                ? SLOT_CLASS.PRIMARY : SLOT_CLASS.UNRESOLVED,
            slot: primary.type,
            mixed: supporting.length > 0,
        };
    }

    if (supporting.length > 0) return { class: SLOT_CLASS.SUPPORT, slot: LEGACY_SUPPORT };

    /* No primary, not rest, and nothing supporting. The programme has not
       said what this day is, so neither does this. Not relabelled as rest:
       that would claim a prescription nobody made. */
    return { class: SLOT_CLASS.UNRESOLVED, slot: undefined };
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
export function toLegacySlot(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        return { ok: false, reason: PROJECTION_REFUSAL.NOT_A_PLAN };
    }
    const primary = plan.primarySession;
    if (primary && typeof primary === 'object' && typeof primary.type === 'string') {
        /* A primary type outside the legacy vocabulary is refused rather than
           passed through. Writing it into the column would survive one save
           and then be repaired away by normaliseSchedule, and in the meantime
           the calendar would render it as unknown.

           Note the fixed vocabulary: unlike classifySlot, this takes NO
           options. The persisted compatibility vocabulary is closed, and a
           caller must not be able to widen it through configuration and so
           reintroduce by the back door the sentinel we rejected at the front. */
        if (!LEGACY_PRIMARY_TYPES.includes(primary.type)) {
            return { ok: false, reason: PROJECTION_REFUSAL.UNKNOWN_TYPE, detail: primary.type };
        }
        return { ok: true, slot: primary.type };
    }
    if (plan.mode === 'rest') return { ok: true, slot: LEGACY_REST };

    /* No primary session, and the day is not rest, so there is work here that
       the legacy shape has no word for. Deliberately refused. */
    return { ok: false, reason: PROJECTION_REFUSAL.SUPPORT_ONLY };
}


/**
 * A week of day plans to the legacy 7-slot array, or a refusal.
 *
 * ALL OR NOTHING, deliberately.
 *
 *   { ok: true,  slots: [7 valid legacy values] }
 *   { ok: false, reason: 'unrepresentable_days', unrepresentable: [...] }
 *
 * There is no `slots` key on the failure result, and that is the point. An
 * earlier version returned a 7-element array with holes left as null
 * alongside a list of what was missing, which reads like a valid projection
 * and would be written by any caller that forgot to check. The legacy column
 * is a persisted compatibility contract, so the helper has to make it
 * impossible to persist an invalid one by accident rather than merely
 * inadvisable.
 *
 * On success the array is exactly 7 elements, Sunday-indexed by
 * Date#getDay, holding only values from the closed legacy vocabulary, which
 * is what notifyRules depends on.
 *
 * Nothing is fabricated for an unrepresentable day. Choosing a value would
 * mean choosing between suppressing a notification for a day that has work
 * and claiming training that was not prescribed, and that is a wiring
 * decision taken alongside the notification migration, not a default buried
 * in a pure helper.
 */
export function toLegacySchedule(plans, weekOf) {
    const byDate = new Map();
    for (const p of (Array.isArray(plans) ? plans : [])) {
        if (p && typeof p === 'object' && typeof p.date === 'string') byDate.set(p.date, p);
    }
    const ref = weekOf instanceof Date && !isNaN(weekOf.getTime()) ? weekOf : new Date(0);

    const slots = new Array(7);
    const unrepresentable = [];
    for (let i = 0; i < 7; i++) {
        /* The LOCAL key, because that is how an authoritative plan's date is
           written. The projection's external contract is unchanged: seven
           elements, Sunday-indexed, legacy vocabulary. Only the key it looks a
           plan up by is internal, and it has to agree with the identity the
           generator wrote rather than with the legacy helper's UTC shift. */
        const date = localDateKeyForWeekday(ref, i);
        const plan = byDate.get(date);
        if (!plan) {
            unrepresentable.push({ index: i, date, reason: PROJECTION_REFUSAL.NO_PLAN });
            continue;
        }
        const r = toLegacySlot(plan);
        if (r.ok) slots[i] = r.slot;
        else {
            const u = { index: i, date, reason: r.reason };
            if (r.detail !== undefined) u.detail = r.detail;
            unrepresentable.push(u);
        }
    }
    if (unrepresentable.length) {
        return { ok: false, reason: 'unrepresentable_days', unrepresentable };
    }
    return { ok: true, slots };
}
