/**
 * When to send a member a push notification, and what it should say.
 *
 * A separate module for the same reason as src/weekUtils.js: this is logic that
 * is easy to get subtly wrong, only misbehaves for people in particular
 * timezones on particular days, and nobody would notice for months. It has no
 * imports so both the Deno edge function and vitest can load it unchanged.
 *
 * It lives under supabase/functions/_shared rather than next to weekUtils.js in
 * src/ because that is the directory the Supabase CLI bundles when it deploys.
 * A file in src/ would pass its tests here and then fail to deploy, which is
 * the worst of both. tests/notifyRules.test.js imports it from this path.
 *
 * The settings screen promises one reminder a day at a chosen time. This file
 * is the whole of that promise. Anything not expressed here does not get sent.
 *
 * WHAT WAS REMOVED, AND WHY. Until Phase 2B.2 this also sent a warning before
 * a daily streak broke, and carried its own port of the app's streak
 * calculation to decide when. The app has since retired the streak: it broke
 * on prescribed rest days, so following the programme exactly cost you one
 * twice a week. Nothing in the app computes, uses or shows a streak any more.
 * A push telling someone their 6 day streak was at risk was then the single
 * remaining place the concept existed, arriving on a lock screen about a
 * number they could not find anywhere in the product. It is gone, along with
 * currentStreak(), STREAK_WARN_MIN and the streak_warning message.
 *
 * The one rule left that is not obvious and is load-bearing: nothing here
 * mentions erections, EQ, the pelvic floor or anatomy. These land on a lock
 * screen that other people can read.
 */

/** Hours a reminder is allowed to land in, member's local time. */
export const EARLIEST_HOUR = 5;
export const LATEST_HOUR = 23;

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Read a date in someone else's timezone.
 *
 * Deliberately one Intl call with formatToParts rather than the
 * `new Date(d.toLocaleString())` round-trip the previous version used. That
 * pattern reparses a localised string with the *local* parser, so it lands an
 * hour out on DST changeover days and is simply wrong for half-hour offsets
 * like Asia/Kolkata and Australia/Adelaide.
 */
function zonedParts(now, timezone) {
    let fmt;
    try {
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || 'UTC',
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', weekday: 'short',
        });
    } catch {
        // An unrecognised timezone must not take the whole run down with it.
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', weekday: 'short',
        });
    }
    const out = {};
    for (const p of fmt.formatToParts(now)) out[p.type] = p.value;
    return out;
}

/** Hour 0-23 in the member's timezone. */
export function localHourFor(now, timezone) {
    // h23 should never produce 24, but ICU has historically disagreed.
    return Number(zonedParts(now, timezone).hour) % 24;
}

/** Minutes since midnight in the member's timezone, including fractional offsets. */
export function localMinuteOfDay(now, timezone) {
    const p = zonedParts(now, timezone);
    return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** YYYY-MM-DD in the member's timezone. Used only for the one-a-day cap. */
export function localDateFor(now, timezone) {
    const p = zonedParts(now, timezone);
    return `${p.year}-${p.month}-${p.day}`;
}

/** Day of week in the member's timezone, 0 = Sunday, matching schedule[]. */
export function localWeekdayFor(now, timezone) {
    const w = zonedParts(now, timezone).weekday;
    return WEEKDAY_INDEX[w] ?? 0;
}

/** The UTC day key the app uses for session and streak bookkeeping. */
export function utcDayKey(date) {
    return new Date(date).toISOString().split('T')[0];
}

/** Did any session land on this day key? */
export function trainedOn(sessionLog, dayKey) {
    return (sessionLog || []).some(s => s && typeof s.date === 'string' && s.date.split('T')[0] === dayKey);
}

/** '19:10' -> 1150. Invalid times use the app's default of 19:00. */
export function reminderMinuteOfDay(reminderTime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(reminderTime || '').trim());
    if (!m) return 19 * 60;
    const h = Number(m[1]);
    const minute = Number(m[2]);
    return h >= 0 && h <= 23 && minute >= 0 && minute <= 59 ? h * 60 + minute : 19 * 60;
}

/** Kept for callers that only need the hour; decisions use the full time. */
export function reminderHour(reminderTime) {
    return Math.floor(reminderMinuteOfDay(reminderTime) / 60);
}

/**
 * Wording.
 *
 * Neutral on purpose. Someone glancing at a phone on a table should learn
 * nothing beyond the app's name, and the member gets the real coaching once
 * they open it.
 */
export const MESSAGES = {
    daily_reminder: () => ({
        title: 'The Blueprint',
        body: "Time to train. Open when you're ready.",
        tag: 'bp-reminder',
    }),
};

/**
 * The whole decision. Returns null far more often than it returns a message,
 * which is the point.
 *
 * @returns {null|{kind:string,title:string,body:string,tag:string,url:string}}
 */
export function decideNotification({
    sessionLog = [],
    passProtectedDates = [],
    schedule = null,
    programme = null,
    reminderTime = '19:00',
    timezone = 'UTC',
    lastNotifiedDate = null,
    now = new Date(),
} = {}) {
    const localDate = localDateFor(now, timezone);

    // 1. One a day, whatever else is true.
    if (lastNotifiedDate && String(lastNotifiedDate).slice(0, 10) === localDate) return null;

    // 2. Only in the minute they picked, and never in the middle of the night
    //    even if they picked one.
    const minuteOfDay = localMinuteOfDay(now, timezone);
    const hour = Math.floor(minuteOfDay / 60);
    if (minuteOfDay !== reminderMinuteOfDay(reminderTime)) return null;
    if (hour < EARLIEST_HOUR || hour > LATEST_HOUR) return null;

    const todayKey = utcDayKey(now);

    // 3. They already did the work. Saying nothing is the correct behaviour.
    if (trainedOn(sessionLog, todayKey)) return null;

    // 4. A Recovery Pass is covering today. The member has a banked Pass and
    //    this is the day it is spent on, so the gap is already accounted for.
    //    Chasing someone whose Pass covered the day is worse than silence.
    //    This is the only thing passProtectedDates is read for here, and it
    //    outlives the streak warning it was first written alongside.
    if ((passProtectedDates || []).includes(todayKey)) return null;

    // 5. Today is a scheduled rest day. "Time to train" on a rest day teaches
    //    members that the app is not paying attention.
    // A scheduled goal change must also take effect when the app is closed.
    const change = programme && programme.pendingChange;
    const nextWeek = change && change.schedule;
    const effectiveSchedule = change && typeof change.effectiveDate === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(change.effectiveDate)
        && change.effectiveDate <= localDate
        && Array.isArray(nextWeek) && nextWeek.length === 7
        && nextWeek.every(t => ['length', 'girth', 'stamina', 'rest'].includes(t))
        ? nextWeek : schedule;
    if (Array.isArray(effectiveSchedule) && effectiveSchedule.length === 7) {
        if (effectiveSchedule[localWeekdayFor(now, timezone)] === 'rest') return null;
    }

    return { kind: 'daily_reminder', ...MESSAGES.daily_reminder(), url: '/app/' };
}
