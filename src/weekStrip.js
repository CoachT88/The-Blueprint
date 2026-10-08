/**
 * Where am I in the week?
 *
 * That is the only question this module answers. Not what to do next, not
 * whether to train, not what a day should contain. It turns three separate
 * truths into seven presentation records and decides nothing else.
 *
 * THREE TRUTHS, AND THEY STAY APART
 *
 *   What was PRESCRIBED   authoritative members: dated day plans.
 *                         legacy and custom members: the seven-slot column,
 *                         which for them is still the programme.
 *   What was PERFORMED    the session log, and nothing else.
 *   Was it SATISFIED      the canonical weekCompletion() answer, passed in.
 *                         This module never recomputes it.
 *
 * Collapsing any two of those is how a strip starts lying. A day can have a
 * known prescription and no activity, activity and no knowable prescription,
 * or a substitution that satisfied the obligation anyway.
 *
 * THREE DATE RELATIONSHIPS, WHICH IS THE SUBTLE PART
 *
 *   authoritative prescription lookup   localDateKeyForWeekday()
 *   the seven-slot array for completion Sunday-indexed, weekCompletion's
 *                                       own contract
 *   session-log cross-check             dateKeyForWeekday(), the frozen
 *                                       legacy relationship
 *
 * The first is NOT negotiable and is the reason PR C exists: a day plan's
 * date is the day the member lived through, so at UTC+14 a Wednesday plan is
 * keyed Wednesday. Using the legacy helper to find it would read the wrong
 * day's prescription, and because a week recurs it would usually return a
 * plausible type rather than nothing, which is the dangerous kind of wrong.
 *
 * The third stays legacy on purpose. Session log entries are stored as
 * toISOString(), so their date part is a UTC date, and weekCompletion()
 * already compares against dateKeyForWeekday(). Matching that keeps the
 * cross-check self-consistent. It is the carried _dayKey() debt and it is not
 * repaired here: that audit has to move session_log, pass dates, messaging
 * and the notification consumers together.
 *
 * So at extreme positive offsets a cell's prescription and its performed mark
 * can come from keys a day apart. That is a known, recorded seam, not an
 * oversight, and the fix is the day-key audit rather than a second opinion
 * invented here.
 *
 * MONDAY FIRST, BECAUSE THE UI IS NOT THE STORAGE SCHEMA
 *
 * The column is Sunday-indexed because notifyRules.js requires it. Everything
 * about a programme week is ISO: the week key, the ledger, the generator's
 * Monday anchor. Rendering Sunday first also puts the ISO week's LAST day in
 * the leftmost cell, which is how the old calendar showed a future Sunday to
 * the left of today for six days out of seven.
 *
 * NO HIDDEN CLOCK
 *
 * `now` is required. A missing or unreadable one is a refusal, not a reason to
 * read the clock: a view model that quietly consults time when its caller
 * forgot to pass it is worse than one that says so, because the bug then only
 * appears at a date boundary.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs, no writes.
 */

import { localDateKeyForWeekday, dateKeyForWeekday, localDateKey } from './weekUtils.js';
import { attributeEntry, ATTRIBUTION } from './sessionAttribution.js';
import { normaliseDayPlan } from './dayPlan.js';
import { classifySlot, SLOT_CLASS } from './scheduleSlot.js';

/**
 * The four base display states. Everything else is a modifier.
 *
 * `today` and `future` are NOT states: a rest day today is the rest treatment
 * plus the today highlight, not a ninth thing to recognise. Nor is a
 * substitution: if the obligation was satisfied, the cell is satisfied, and
 * which work did it is detail.
 *
 * There is deliberately no MISSED. Past unsatisfied training is PENDING with
 * isPast true, which says the same thing without a fifth visual language, and
 * without the strip passing a judgement a day may not deserve.
 */
export const WEEK_STRIP_STATE = Object.freeze({
    /** Scheduled work the canonical answer counts as done. */
    SATISFIED: 'satisfied',
    /** Scheduled training not yet satisfied. Past or future. */
    PENDING:   'pending',
    /** Prescribed rest. Never satisfied, never missed, never a tick. */
    REST:      'rest',
    /** No prescription this build can attribute to that date. */
    UNKNOWN:   'unknown',
});

export const WEEK_STRIP_REFUSAL = Object.freeze({
    /** `now` was missing or unreadable. The caller must supply it. */
    NO_CLOCK: 'no_clock',
});

/** Monday first, which is the member's week rather than the column's. */
export const WEEK_STRIP_DAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

/* Monday-first position -> Date#getDay() index. Position 0 is Monday, which
   is getDay() 1; position 6 is Sunday, which is getDay() 0. */
const WEEKDAY_INDEX = Object.freeze([1, 2, 3, 4, 5, 6, 0]);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validDate = (v) => v instanceof Date && !isNaN(v.getTime());

/**
 * The legacy type a day plan prescribes, or undefined.
 *
 * normaliseDayPlan decides what is readable, because src/dayPlan.js is
 * explicit that an unreadable record is a data-integrity condition rather
 * than a fifth kind of prescribed day. An unreadable plan is therefore
 * UNKNOWN here and is neither repaired nor synthesised.
 *
 * A prescribed day with no primary session is support-only, which the legacy
 * vocabulary has no word for and toLegacySlot already refuses. It reads as
 * unknown until supporting work has a display of its own.
 */
function typeOfPlan(plan) {
    if (!isPlainObject(plan)) return undefined;
    const valid = normaliseDayPlan(plan);
    if (!valid) return undefined;                       // unreadable, not repaired
    if (valid.mode === 'rest') return 'rest';
    const type = valid.primarySession && valid.primarySession.type;
    return typeof type === 'string' && type ? type : undefined;
}

/**
 * The seven-slot prescription array, Sunday-indexed, for weekCompletion().
 *
 * Sunday-indexed because that is weekCompletion()'s contract, not because the
 * member sees it that way. `undefined` where there is no prescription this
 * build can attribute to the date, which weekCompletion() already treats as
 * "not a commitment the member made" and so leaves out of the denominator.
 *
 * THAT is what keeps a midweek cutover honest. A member who cut over on a
 * Thursday has no authoritative Monday plan, and feeding the recurring
 * compatibility projection in instead would recreate at presentation time
 * exactly the historical backfill storage correctly refused.
 *
 * Returns { ok: true, slots } or { ok: false, reason }.
 */
export function weekStripSlots(input) {
    const i = isPlainObject(input) ? input : {};
    if (!validDate(i.now)) return { ok: false, reason: WEEK_STRIP_REFUSAL.NO_CLOCK };
    const ref = i.now;

    if (i.authoritative !== true) {
        /* Legacy and custom members: the column IS their programme, and it is
           already Sunday-indexed, so it passes straight through. Supplied as
           an input, never read from a global. */
        const sched = Array.isArray(i.legacySchedule) ? i.legacySchedule : [];
        return { ok: true, slots: Array.from({ length: 7 }, (_, n) => sched[n]) };
    }

    const byDate = new Map();
    for (const p of (Array.isArray(i.dayPlans) ? i.dayPlans : [])) {
        if (isPlainObject(p) && typeof p.date === 'string') byDate.set(p.date, p);
    }
    /* LOCAL date identity. A plan's date is the day the member lived through;
       using dateKeyForWeekday here would read the wrong day's prescription at
       UTC+13 and UTC+14 and, because the week recurs, would usually return a
       plausible type rather than nothing. */
    return {
        ok: true,
        slots: Array.from({ length: 7 }, (_, n) =>
            typeOfPlan(byDate.get(localDateKeyForWeekday(ref, n)))),
    };
}

/**
 * What actually happened that week, by Sunday-indexed weekday.
 *
 * The legacy date relationship on purpose: session log entries store
 * toISOString(), so their date part is a UTC date, and weekCompletion()
 * compares against dateKeyForWeekday(). Matching it keeps the cross-check
 * self-consistent. Carried _dayKey() debt; see the module header.
 */
function performedByWeekday(sessionLog, ref) {
    const out = new Map();
    /* TWO lookups, as of Phase 3C.4, because the two attribution keys are not
       interchangeable: a dated identity is the LOCAL day the member lived
       through and a pre-3C.4 entry carries only the UTC date part of its
       completion timestamp. An entry whose prescription identity could not be
       proven is in neither map, so it shows no performed mark against any
       day, which is the same conservative rule satisfaction follows. */
    const want = new Map();
    for (let n = 0; n < 7; n++) {
        want.set('d:' + localDateKeyForWeekday(ref, n), n);
        want.set('l:' + dateKeyForWeekday(ref, n), n);
    }
    for (const e of (Array.isArray(sessionLog) ? sessionLog : [])) {
        if (!isPlainObject(e)) continue;
        const a = attributeEntry(e);
        if (a.kind === ATTRIBUTION.UNKNOWN) continue;
        const n = want.get((a.kind === ATTRIBUTION.DATED ? 'd:' : 'l:') + a.key);
        if (n === undefined) continue;
        const prev = out.get(n);
        /* Last one wins for the type, and a substitution anywhere that day is
           remembered, matching how the old calendar built its map. Note that
           SATISFACTION does not come from here: it arrives as the canonical
           weekCompletion array, which OR-accumulates, so a Recovery entry
           logged after a mechanical one cannot erase the tick. This map only
           decides which type the cell mentions. */
        out.set(n, {
            type: e.routineType || (prev && prev.type) || null,
            substituted: !!e.manualOverride || !!(prev && prev.substituted),
        });
    }
    return out;
}

/**
 * Seven presentation records, Monday first.
 *
 * `satisfied` is the canonical weekCompletion().satisfied array, Sunday
 * indexed, passed in rather than recomputed so the strip and the weekly
 * headline cannot disagree about a day. A missing or malformed one yields no
 * satisfied cells, which can only ever under-report: this module must never
 * invent satisfaction.
 *
 * Returns { ok: true, days } or { ok: false, reason }.
 */
export function buildWeekStripModel(input) {
    const i = isPlainObject(input) ? input : {};
    if (!validDate(i.now)) return { ok: false, reason: WEEK_STRIP_REFUSAL.NO_CLOCK };
    const ref = i.now;

    const slotsResult = weekStripSlots(i);
    if (!slotsResult.ok) return slotsResult;
    const slots = slotsResult.slots;

    const satisfied = Array.isArray(i.satisfied) ? i.satisfied : [];
    const performed = performedByWeekday(i.sessionLog, ref);
    const todayKey = localDateKey(ref);

    const days = WEEK_STRIP_DAYS.map((label, position) => {
        const weekday = WEEKDAY_INDEX[position];
        /* The member's own calendar date, the same identity the plan carries. */
        const date = localDateKeyForWeekday(ref, weekday);
        const slot = slots[weekday];

        const prescriptionKnown = typeof slot === 'string' && slot !== ''
            && classifySlot(slot) !== SLOT_CLASS.UNRESOLVED;
        const isRest = prescriptionKnown && classifySlot(slot) === SLOT_CLASS.REST;

        /* DERIVED, not passed through. A cell with no knowable prescription
           cannot have satisfied scheduled work, and rest is never satisfied
           because there was nothing to satisfy. Correct wiring makes both
           combinations impossible upstream; the view model enforces its own
           semantics anyway so a mismatched array cannot produce a cell that
           contradicts itself. */
        const isSatisfied = prescriptionKnown && !isRest && satisfied[weekday] === true;

        const act = performed.get(weekday) || null;

        let state;
        if (!prescriptionKnown) state = WEEK_STRIP_STATE.UNKNOWN;
        else if (isRest) state = WEEK_STRIP_STATE.REST;
        else if (isSatisfied) state = WEEK_STRIP_STATE.SATISFIED;
        else state = WEEK_STRIP_STATE.PENDING;

        return {
            date,
            weekday: label,
            weekdayIndex: weekday,
            isToday: date === todayKey,
            isPast: date < todayKey,
            isFuture: date > todayKey,
            prescriptionKnown,
            prescriptionType: prescriptionKnown ? slot : null,
            isRest,
            satisfied: isSatisfied,
            /* Performed truth, kept separate from prescription truth. A day
               can have activity we know about and a prescription we cannot
               attribute, which is exactly the pre-cutover case. */
            performedType: act ? act.type : null,
            /* Detail, never a state of its own. If the obligation was
               satisfied the cell is satisfied; which work did it belongs in a
               detail view, not in seven cells a few millimetres wide. */
            substituted: !!(act && act.substituted),
            state,
        };
    });

    return { ok: true, days };
}
