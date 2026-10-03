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
 * WHAT A SCHEDULED DAY COUNTS FOR (Phase 2B.2)
 *
 * completedDays is one boolean per weekday and finishSession() sets it for
 * ANY completed session, Recovery included. On its own it therefore cannot
 * answer "was the scheduled mechanical work done", and a member who did
 * Recovery on a scheduled Length day used to read as having completed it.
 * With Week Complete now built on this number, that mattered.
 *
 * So a scheduled day counts when:
 *
 *   a MECHANICAL session was logged on that date                     counts
 *   the day was ticked by hand and NOTHING was logged that date      counts
 *   only Recovery was logged on that date                            does not
 *
 * The second case preserves the manual tick, which is the member telling us
 * about work the app did not time. The third is the correction.
 *
 * Substitutions and reduced sessions are unaffected: both log a mechanical
 * routineType, so both still count, which is the locked rule.
 *
 * LEGACY DEBT, deliberately not fixed here: finishSession() still marks
 * completedDays for Recovery. It feeds the calendar tick UI and the
 * substitution behaviour, so the mechanical question is answered at this
 * read boundary instead of by changing that writer.
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
