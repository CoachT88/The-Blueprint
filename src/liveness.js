/**
 * What the app says about the member's recent behaviour.
 *
 * Phase 2B.2. Everything here is COMMUNICATION. Nothing in this module may
 * change a mission, a set count, a duration, a difficulty, a tier, the
 * deload, readiness or the schedule. The prescription is decided elsewhere
 * and stays authoritative; this only decides what is said alongside it.
 *
 * It acknowledges facts the app can prove from its own records: a week was
 * finished, a break happened, a past week did not go to plan. It must never
 * infer adaptation, vascular or hormonal change, tissue recovery, erection
 * quality, discipline or confidence. Behaviour, not biology, and not
 * identity.
 *
 * Pure: no DOM, no globals, no clock.
 */
import { PROGRESSION_POLICY } from './progressionPolicy.js';
import { qualifyingSessionDays } from './progression.js';
import { weekIsMemberFacingMiss } from './progressionLedger.js';

const DAY_MS = 86400000;

/** How long the member has been away from qualifying mechanical work. */
export const RETURN_CONTEXT = {
    RETURNING: 'returning',
    EXTENDED: 'extended-return',
};

/** The one contextual message the Today experience may show. */
export const LIVENESS = {
    WEEK_COMPLETE: 'week-complete',
    RETURNING: 'returning',
    EXTENDED_RETURN: 'extended-return',
    MISSED_WEEK: 'missed-week',
};

function dayAt(key) {
    const d = new Date(key + 'T12:00:00');
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Has this member been away, and roughly how long?
 *
 *   under returningAfterDays        null, nothing to say
 *   up to extendedReturnAfterDays   returning
 *   beyond that                     extended-return
 *
 * Measured from the last QUALIFYING MECHANICAL day, so a Recovery session
 * does not quietly reset the clock on an absence from training. Both
 * thresholds are product policy about when an acknowledgement is useful.
 *
 * A member with no qualifying history at all gets null. Someone who has
 * never started has not come back, and greeting them as a returner would be
 * the app inventing a past for them.
 */
export function returnContext(sessionLog, { now, policy } = {}) {
    const p = policy || PROGRESSION_POLICY;
    const ref = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    const days = qualifyingSessionDays(sessionLog);
    if (!days.length) return null;

    const last = dayAt(days[days.length - 1]);
    if (!last) return null;

    const away = Math.floor((ref.getTime() - last.getTime()) / DAY_MS);
    if (away >= p.extendedReturnAfterDays) return RETURN_CONTEXT.EXTENDED;
    if (away >= p.returningAfterDays) return RETURN_CONTEXT.RETURNING;
    return null;
}

/** Days since the last qualifying mechanical day, or null if there are none. */
export function daysSinceLastMechanical(sessionLog, now) {
    const ref = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    const days = qualifyingSessionDays(sessionLog);
    if (!days.length) return null;
    const last = dayAt(days[days.length - 1]);
    return last ? Math.floor((ref.getTime() - last.getTime()) / DAY_MS) : null;
}

/**
 * The previous finished week, when it is honest to mention that it did not
 * go to plan.
 *
 * ONLY the week immediately before this one, and only when it is a
 * member-facing miss. weekIsMemberFacingMiss() already refuses the current
 * week, and a verdict of neutral or unknown is not a miss, so a week nobody
 * can judge and a week that asked for nothing are both silently skipped
 * rather than blamed on anyone.
 *
 * Returns the week row, so a caller can show what it actually was, or null.
 */
export function missedWeekReentry(ledger, currentWeekKey) {
    const rows = Array.isArray(ledger) ? ledger : [];
    for (let i = rows.length - 1; i >= 0; i--) {
        const w = rows[i];
        if (!w || typeof w.weekKey !== 'string') continue;
        if (currentWeekKey && w.weekKey === currentWeekKey) continue;   // not finished
        // The first finished week we meet is the previous one, and it is the
        // only one this phase will ever mention.
        return weekIsMemberFacingMiss(w, currentWeekKey) ? w : null;
    }
    return null;
}

/**
 * The single contextual message, by precedence.
 *
 *   1  the prescription state, decided elsewhere and never obscured here
 *   2  week complete
 *   3  return context
 *   4  missed week
 *   5  nothing
 *
 * Week Complete outranks both of the others because there is no work left to
 * orient anyone toward: telling someone who has finished their week that
 * they have been away, or that last week went badly, is noise at the one
 * moment the right answer is "you are done".
 *
 * At most one key comes back. Two liveness messages at once is clutter, and
 * the Today card has one slot by design.
 */
export function livenessContext({ weekComplete, returnContext: ret, missedWeek } = {}) {
    if (weekComplete) return LIVENESS.WEEK_COMPLETE;
    if (ret === RETURN_CONTEXT.EXTENDED) return LIVENESS.EXTENDED_RETURN;
    if (ret === RETURN_CONTEXT.RETURNING) return LIVENESS.RETURNING;
    if (missedWeek) return LIVENESS.MISSED_WEEK;
    return null;
}
