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
 * KNOWN LIMITATION, documented rather than solved in Phase 2A:
 * completedDays is one boolean per weekday index. Two sessions on the same day
 * collapse into one, and a session logged on a scheduled rest day cannot be
 * counted at all. Fixing it means changing the persisted shape, which is a
 * migration and a separate decision.
 *
 * Pure: no DOM, no globals, no clock.
 */

/** Day types that are not a session. */
export const REST_TYPES = ['rest'];

function isScheduledSession(type, restTypes) {
    return typeof type === 'string' && type !== '' && !restTypes.includes(type);
}

/**
 * weekCompletion(schedule, completedDays) -> { completed, target, remaining, allDone, label }
 *
 * schedule      persisted.schedule, seven entries indexed by Date#getDay()
 * completedDays persisted.completedDays, seven booleans, same indexing
 *
 * Both are tolerated as missing or short. A slot the schedule does not
 * describe is not counted in either number, because an undescribed day is not
 * a commitment the member made.
 */
export function weekCompletion(schedule, completedDays, options) {
    const restTypes = (options && options.restTypes) || REST_TYPES;
    const sched = Array.isArray(schedule) ? schedule : [];
    const done = Array.isArray(completedDays) ? completedDays : [];

    const target = sched.filter(t => isScheduledSession(t, restTypes)).length;
    const completed = sched.filter((t, i) => isScheduledSession(t, restTypes) && done[i] === true).length;

    return {
        completed,
        target,
        remaining: Math.max(0, target - completed),
        allDone: target > 0 && completed >= target,
        label: target > 0 ? `${completed} of ${target} this week` : 'No sessions scheduled this week',
    };
}
