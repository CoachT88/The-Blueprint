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

/** Day types that are not a session. */
export const REST_TYPES = ['rest'];

/** Routine types that are mechanical work. Mirrors MECHANICAL_MISSIONS. */
export const MECHANICAL_TYPES = ['length', 'girth', 'stamina'];

const DAY_MS = 86400000;

function isScheduledSession(type, restTypes) {
    return typeof type === 'string' && type !== '' && !restTypes.includes(type);
}

/** Local YYYY-MM-DD for the weekday `index` (Date#getDay) of ref's ISO week. */
function dateKeyForWeekday(ref, index) {
    const monday = new Date(ref);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const d = new Date(monday.getTime() + (((index + 6) % 7) * DAY_MS));
    return d.toISOString().split('T')[0];
}

/** What was logged on each date: whether anything, and whether mechanical. */
function logByDate(sessionLog, mechanicalTypes) {
    const map = new Map();
    for (const e of (Array.isArray(sessionLog) ? sessionLog : [])) {
        if (!e || typeof e.date !== 'string') continue;
        const key = e.date.split('T')[0];
        const prev = map.get(key) || { any: false, mechanical: false };
        map.set(key, {
            any: true,
            mechanical: prev.mechanical || mechanicalTypes.includes(e.routineType),
        });
    }
    return map;
}

/**
 * weekCompletion(schedule, completedDays, options)
 *   -> { completed, target, remaining, allDone, label }
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
    const byDate = crossCheck ? logByDate(opts.sessionLog, mechanicalTypes) : null;
    const ref = opts.now instanceof Date && !isNaN(opts.now.getTime()) ? opts.now : new Date();

    const satisfied = (i) => {
        if (!crossCheck) return done[i] === true;
        const logged = byDate.get(dateKeyForWeekday(ref, i));
        if (logged && logged.mechanical) return true;          // the real thing
        if (logged && logged.any) return false;                // Recovery only
        return done[i] === true;                               // a manual tick
    };

    const target = sched.filter(t => isScheduledSession(t, restTypes)).length;
    const completed = sched.filter((t, i) => isScheduledSession(t, restTypes) && satisfied(i)).length;

    return {
        completed,
        target,
        remaining: Math.max(0, target - completed),
        allDone: target > 0 && completed >= target,
        label: target > 0 ? `${completed} of ${target} this week` : 'No sessions scheduled this week',
    };
}
