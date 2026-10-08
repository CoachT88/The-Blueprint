/**
 * What is the next training session on the plan?
 *
 * One question, asked once, at the end of a finished session. Not what to do
 * today, not whether the week went well, not what the session contains. The
 * member has just closed a session and the only thing this answers is where
 * their next one sits.
 *
 * WHY THIS IS NOT PART OF weekStrip.js
 *
 * The strip answers "where am I in THIS week" and its whole contract is seven
 * cells inside one ISO week. The next session frequently is not in this week:
 * ask on a Sunday evening and the honest answer is in the week after. A
 * module whose answer may leave its own window does not belong inside one
 * whose answer may not.
 *
 * WHY IT DOES NOT WRAP
 *
 * The surface this replaces walked the seven-slot recurring column and
 * wrapped around the end: from Sunday it read index 0 again and announced
 * whatever that recurring week prescribes. For a member on dated plans that
 * answer is manufactured. It names a weekday that has no plan behind it, and
 * because a recurring week repeats it almost always sounds plausible, which
 * is the dangerous kind of wrong.
 *
 * So this walks FORWARD through calendar dates and reads only plans that
 * actually exist. Generation already reaches the end of next ISO week, so a
 * Sunday finds Monday in the next week because that Monday was really
 * generated, not because an array index came back round.
 *
 * REST IS SKIPPED, BECAUSE THE QUESTION IS ABOUT TRAINING
 *
 * A caller that wants the next calendar day wants a different function. This
 * one is asked at the end of a session and means the next session, so rest
 * days and days with supporting work only are passed over rather than
 * announced. A day with no readable plan is also passed over: an unreadable
 * record is a data-integrity condition and never an answer.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs, no writes.
 */

import { localDateKey } from './weekUtils.js';
import { normaliseDayPlan } from './dayPlan.js';

export const NEXT_UP_REFUSAL = Object.freeze({
    /** `now` was missing or unreadable. The caller must supply it. */
    NO_CLOCK: 'no_clock',
});

/**
 * How far forward to look, in days, when the caller does not say.
 *
 * Matches the generation horizon, which reaches the end of next ISO week and
 * is therefore between 8 and 14 dates. Looking further would be looking past
 * everything that exists.
 */
export const NEXT_UP_HORIZON_DAYS = 14;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validDate = (v) => v instanceof Date && !isNaN(v.getTime());

/**
 * The next dated Primary Training Session after today, or nothing.
 *
 * Starts at TOMORROW on purpose. This is asked once a session is finished, so
 * today is behind the member even when today's plan is the one that was just
 * satisfied.
 *
 * `daysAway` is returned because a weekday name alone only identifies a day
 * inside the coming week. A caller that renders "THU" must decide for itself
 * what to do with an answer seven or more days out, rather than this module
 * quietly shortening its own horizon to make the caller's copy work.
 *
 * Returns { ok: true, found: true, date, type, weekdayIndex, daysAway },
 *         { ok: true, found: false } or { ok: false, reason }.
 */
export function nextTrainingDay(input) {
    const i = isPlainObject(input) ? input : {};
    if (!validDate(i.now)) return { ok: false, reason: NEXT_UP_REFUSAL.NO_CLOCK };

    const horizon = Number.isInteger(i.horizonDays) && i.horizonDays > 0
        ? i.horizonDays : NEXT_UP_HORIZON_DAYS;

    const byDate = new Map();
    for (const p of (Array.isArray(i.dayPlans) ? i.dayPlans : [])) {
        if (isPlainObject(p) && typeof p.date === 'string') byDate.set(p.date, p);
    }

    /* Noon, so adding days cannot land on a daylight-saving boundary and slip
       an hour back into the previous date. The same guard localDateKey's
       siblings use, and the reason authoritative identities are local. */
    const cursor = new Date(i.now);
    cursor.setHours(12, 0, 0, 0);

    for (let away = 1; away <= horizon; away++) {
        cursor.setDate(cursor.getDate() + 1);
        const plan = normaliseDayPlan(byDate.get(localDateKey(cursor)));
        if (!plan) continue;                       // absent or unreadable
        const type = plan.primarySession && plan.primarySession.type;
        if (typeof type !== 'string' || !type) continue;   // rest, or support only
        return {
            ok: true,
            found: true,
            date: plan.date,
            type,
            /* Date#getDay(), because the only consumer labels a day with the
               Sunday-indexed DAY_NAMES the rest of the page uses. */
            weekdayIndex: cursor.getDay(),
            daysAway: away,
        };
    }

    return { ok: true, found: false };
}
