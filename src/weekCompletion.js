/**
 * How much of this week's programme is done.
 *
 * The denominator is scheduled non-rest sessions, not seven days. A rest day
 * is part of the programme, so it is not a gap in the week and must never read
 * as a failure. Four scheduled sessions with two logged is "2 of 4 this week",
 * and the member is on track.
 *
 * Extra activity does not move either number. A recovery session on a rest day
 * is worth doing, but it is not one of the four, and inflating the numerator
 * for it would turn a fixed target into a moving one.
 *
 * WHAT A SCHEDULED DAY COUNTS FOR (Phase 2B.2, locked)
 *
 * completedDays is one boolean per weekday and finishSession() sets it for
 * ANY completed session, Recovery included. On its own it therefore cannot
 * answer "was the scheduled mechanical work done", and a member who did
 * Recovery on a scheduled Length day used to read as having completed it.
 * With Week Complete built on this number, that mattered.
 *
 * THE SESSION LOG IS THE TRUTH WHEN A LOG EXISTS. The tick is the fallback
 * only when there is nothing logged for that day at all. In precedence:
 *
 *   1  mechanical session logged that day            counts
 *   2  safe manual mechanical substitution logged    counts
 *   3  MODIFIED mechanical session logged            counts
 *   4  Recovery logged that day                      does NOT count, even
 *                                                    though completedDays
 *                                                    is true for it
 *   5  nothing logged, member ticked the day         counts, self-reported
 *   6  nothing logged, no tick                       does not count
 *
 * Rules 1 to 3 are one check, not three: an approved MECHANICAL routineType
 * on the day. It deliberately does NOT compare routineType to the scheduled
 * type, because that would break the approved manual substitution behaviour
 * where Girth is done on a day Length was scheduled. Reduced sessions log a
 * mechanical routineType too, so MODIFIED needs no special case either.
 *
 * Rule 5 keeps toggleDayCompletion() meaningful. It is the member telling us
 * about work the app did not time, and it is accepted as self-reported
 * mechanical completion. Rule 4 outranks it: once a Recovery session is on
 * record for that day, the day has an answer and the tick cannot overrule it.
 *
 * An abandoned session needs no rule. Only finishSession() writes to the
 * log, so an abandoned one leaves no entry and, on its own, no tick.
 *
 * ACCEPTED LEGACY DEBT, deliberately not fixed here: finishSession() still
 * marks completedDays for Recovery, so completedDays[today] can be true
 * after a Recovery session. That is tolerated. What is NOT tolerated is that
 * boolean alone creating mechanical weekly completion, which is exactly what
 * rule 4 prevents. completedDays is not authoritative whenever a session log
 * exists for the day. The writer feeds the calendar tick UI and the
 * substitution behaviour, so the question is answered at this read boundary
 * instead of by changing it.
 *
 * Also unresolved, and older: completedDays has one slot per weekday, so two
 * sessions on one day collapse and a session on a scheduled rest day cannot
 * be counted at all.
 *
 * Pure: no DOM, no globals, no clock. `now` is passed in.
 */

import { isScheduledPrimary } from './scheduleSlot.js';
import { dateKeyForWeekday, localDateKeyForWeekday } from './weekUtils.js';
import { performedByAttribution } from './sessionAttribution.js';

/** Day types that are not a session. */
export const REST_TYPES = ['rest'];

/** Routine types that are mechanical work. Mirrors MECHANICAL_MISSIONS. */
export const MECHANICAL_TYPES = ['length', 'girth', 'stamina'];


/* Delegated to the canonical classifier in Phase 3S.1 PR E.
   This used to be `truthy and not rest`, which counted a slot nobody could
   interpret toward the weekly target. nextBestAction already refused to
   prescribe from such a slot, so the two disagreed about the same value;
   there is now one rule and it is membership of the known set. */
function isScheduledSession(type, restTypes, primaryTypes) {
    return isScheduledPrimary(type, { restTypes, primaryTypes });
}


/* The per-date "what was logged" maps come from sessionAttribution.js as of
   Phase 3C.4, so that primarySatisfied, this function, the WeekStrip and the
   Weekly Report cannot disagree about which prescription a session satisfied.
   The local logByDate that used to live here keyed everything by the
   completion timestamp, which credited a Thursday session finished after
   midnight to Friday. */

/**
 * weekCompletion(schedule, completedDays, options)
 *   -> { completed, target, remaining, allDone, label, satisfied }
 *
 * `satisfied` is seven booleans, one per weekday index, true when that day's
 * SCHEDULED MECHANICAL work was satisfied by the rules above. It is the same
 * array the counts are summed from, returned rather than recomputed, so the
 * calendar tick and the weekly headline cannot say different things about
 * the same day. A rest day is never satisfied: it has no scheduled
 * mechanical work to satisfy, which is also why it is in neither the
 * numerator nor the denominator.
 *
 * schedule      persisted.schedule, seven entries indexed by Date#getDay()
 * completedDays persisted.completedDays, seven booleans, same indexing
 * options       { sessionLog, now, restTypes, mechanicalTypes }
 *
 * Both arrays are tolerated as missing or short. A slot the schedule does not
 * describe is not counted in either number, because an undescribed day is not
 * a commitment the member made.
 *
 * Without `sessionLog` this falls back to completedDays alone, so a caller
 * that has not been updated keeps its old answer rather than silently
 * reading zero. The two real call sites pass it, and a test proves they do.
 */
export function weekCompletion(schedule, completedDays, options) {
    const opts = options || {};
    const restTypes = opts.restTypes || REST_TYPES;
    const mechanicalTypes = opts.mechanicalTypes || MECHANICAL_TYPES;
    const sched = Array.isArray(schedule) ? schedule : [];
    const done = Array.isArray(completedDays) ? completedDays : [];

    const crossCheck = Array.isArray(opts.sessionLog);
    const perf = crossCheck ? performedByAttribution(opts.sessionLog, mechanicalTypes) : null;
    const ref = opts.now instanceof Date && !isNaN(opts.now.getTime()) ? opts.now : new Date();

    /**
     * Was weekday `i` satisfied?
     *
     * TWO KEYS, each read with its own relationship, because they are not
     * interchangeable. A dated identity is the LOCAL calendar day the member
     * lived through, which is the identity a day plan carries. A pre-3C.4
     * entry has only its completion timestamp, whose date part is a UTC date,
     * and that is the relationship those records were written under. Merging
     * them would credit a day twice or not at all.
     *
     * The dated answer is checked first and wins outright: a session whose
     * launch prescription was proven is better evidence than one attributed
     * by the clock it happened to finish on. A Recovery-only day still
     * refuses, and a manual tick is still the last resort.
     *
     * An entry whose prescription identity could not be proven appears in
     * NEITHER map and so cannot satisfy anything. See sessionAttribution.js
     * for why that is deliberate rather than data loss.
     */
    const isSatisfied = (i) => {
        if (!crossCheck) return done[i] === true;
        const dated = perf.dated.get(localDateKeyForWeekday(ref, i));
        if (dated && dated.mechanical) return true;            // proven prescription
        const legacy = perf.legacy.get(dateKeyForWeekday(ref, i));
        if (legacy && legacy.mechanical) return true;          // the real thing
        if ((dated && dated.any) || (legacy && legacy.any)) return false;   // Recovery only
        return done[i] === true;                               // a manual tick
    };

    /* One pass, one array, and everything else is derived from it. The
       calendar used to ask completedDays directly and so could show a tick
       on a day the headline did not count. */
    const perDay = Array.from({ length: 7 }, (_, i) =>
        isScheduledSession(sched[i], restTypes, mechanicalTypes) && isSatisfied(i));

    const target = sched.filter(t => isScheduledSession(t, restTypes, mechanicalTypes)).length;
    const completed = perDay.filter(Boolean).length;

    return {
        completed,
        target,
        remaining: Math.max(0, target - completed),
        allDone: target > 0 && completed >= target,
        label: target > 0 ? `${completed} of ${target} this week` : 'No sessions scheduled this week',
        satisfied: perDay,
    };
}
