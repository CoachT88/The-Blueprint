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
 * The settings screen promises a daily reminder at a chosen time and a warning
 * before a streak breaks. This file is the whole of that promise. Anything not
 * expressed here does not get sent.
 *
 * Two rules that are not obvious and are load-bearing:
 *
 *   1. Streak days are keyed by UTC date, matching getCurrentStreak() in
 *      index.html exactly. It is arguably wrong, but it is what every screen in
 *      the app already shows, and a warning that disagrees with the number on
 *      the member's own HQ is worse than no warning at all.
 *
 *   2. Nothing here mentions erections, EQ, the pelvic floor or anatomy. These
 *      land on a lock screen that other people can read.
 */

/** A streak has to be worth protecting before we interrupt someone about it. */
export const STREAK_WARN_MIN = 3;

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
            hour: '2-digit', weekday: 'short',
        });
    } catch {
        // An unrecognised timezone must not take the whole run down with it.
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', weekday: 'short',
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

/**
 * Port of getCurrentStreak() in index.html. Kept structurally identical rather
 * than tidied, so a reader can diff the two by eye. tests/e2e/notify-parity
 * asserts they agree on real inputs.
 */
export function currentStreak(sessionLog, passProtectedDates, now = new Date()) {
    const sessions = sessionLog || [];
    if (!sessions.length) return 0;
    const days = new Set(sessions.filter(s => s && typeof s.date === 'string').map(s => s.date.split('T')[0]));
    const protectedDays = new Set(passProtectedDates || []);
    const today = new Date(now);
    let streak = 0;
    for (let i = 0; i < 365; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        if (days.has(key) || protectedDays.has(key)) { streak++; }
        else if (i > 0) { break; }   // today may not be trained yet without breaking it
    }
    return streak;
}

/** '19:00' -> 19. Anything unparseable falls back to the app's own default. */
export function reminderHour(reminderTime) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(reminderTime || '').trim());
    if (!m) return 19;
    const h = Number(m[1]);
    return h >= 0 && h <= 23 ? h : 19;
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
    streak_warning: (streak) => ({
        title: 'The Blueprint',
        body: `Your ${streak} day streak is still going. One session today keeps it.`,
        tag: 'bp-streak',
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
    reminderTime = '19:00',
    streakWarn = true,
    timezone = 'UTC',
    lastNotifiedDate = null,
    now = new Date(),
} = {}) {
    const localDate = localDateFor(now, timezone);

    // 1. One a day, whatever else is true.
    if (lastNotifiedDate && String(lastNotifiedDate).slice(0, 10) === localDate) return null;

    // 2. Only in the hour they picked, and never in the middle of the night
    //    even if they picked one.
    const hour = localHourFor(now, timezone);
    const wanted = reminderHour(reminderTime);
    if (hour !== wanted) return null;
    if (hour < EARLIEST_HOUR || hour > LATEST_HOUR) return null;

    const todayKey = utcDayKey(now);

    // 3. They already did the work. Saying nothing is the correct behaviour.
    if (trainedOn(sessionLog, todayKey)) return null;

    // 4. A Recovery Pass is covering today, so they chose to rest and their
    //    streak is not at risk. Nagging someone who spent a pass is worse than
    //    silence.
    if ((passProtectedDates || []).includes(todayKey)) return null;

    // 5. Today is a scheduled rest day. "Time to train" on a rest day teaches
    //    members that the app is not paying attention.
    if (Array.isArray(schedule) && schedule.length === 7) {
        if (schedule[localWeekdayFor(now, timezone)] === 'rest') return null;
    }

    const streak = currentStreak(sessionLog, passProtectedDates, now);
    const kind = (streakWarn && streak >= STREAK_WARN_MIN) ? 'streak_warning' : 'daily_reminder';
    const msg = kind === 'streak_warning' ? MESSAGES.streak_warning(streak) : MESSAGES.daily_reminder();

    return { kind, ...msg, url: '/' };
}
