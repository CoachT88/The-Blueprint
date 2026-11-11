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
 * Two default check-ins, an optional extra time, and a completion follow-up.
 * Delivery keys distinguish those moments without exposing the training type.
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

/**
 * THE SLOT VOCABULARY IS OPEN AT THE BOTTOM, CLOSED AT THE TOP.
 *
 * The 7-element Sunday-indexed schedule is about to gain values this Worker
 * has never seen. A programme will be able to prescribe a day that carries
 * real supporting work but no mechanical primary session, and a day that
 * genuinely requires nothing at all. The Worker deploys on its own lifecycle,
 * so it has to tolerate those values BEFORE any client can emit one.
 *
 * The old rule was `slot === 'rest'` suppresses, everything else sends. That
 * is open at the top: a value this file has never heard of produces "Make
 * sure you show up for training today" on a lock screen, for a day we cannot
 * actually say contains training. A support day is not mechanical training
 * and must not be announced as though it were.
 *
 * So the test is inverted. Only a value in TRAINING_SLOTS may produce a
 * reminder. Rest suppresses as before, and so does anything unrecognised.
 * New vocabulary is then tolerated by construction and needs no second
 * deploy here: it simply is not training until this list says it is. That
 * matches src/scheduleSlot.js, where an unresolved slot is in neither the
 * numerator nor the denominator, so the two sides of the wire agree.
 *
 * THE ABSENCE OF A SCHEDULE IS NOT THE PRESENCE OF A REST DAY.
 *
 * This distinction is the whole safety argument for the change and it is
 * easy to lose. Inverting the test naively would have read "no schedule, so
 * no training slot, so no reminder" and silenced entire cohorts:
 *
 *   - a project that has not run the migration adding the schedule column.
 *     send-notifications/index.ts falls back to a select without it and every
 *     row then arrives with schedule null, by design.
 *   - a member who has never been given a programme.
 *   - the session_log-only fallback, below both of those.
 *
 * Those members get reminders today and must keep getting them. The gate
 * therefore applies ONLY to a schedule that is present and readable: an
 * array of exactly seven entries. Anything else falls through untouched,
 * exactly as before.
 */
export const TRAINING_SLOTS = Object.freeze(['length', 'girth', 'stamina']);

/** Is this slot mechanical primary training, the only thing worth a push? */
export function isTrainingSlot(slot) {
    return TRAINING_SLOTS.includes(slot);
}

/** A schedule we are entitled to draw a conclusion from. */
function isReadableSchedule(s) {
    return Array.isArray(s) && s.length === 7;
}

/**
 * A QUEUED CHANGE IS A STRICTER QUESTION THAN TODAY'S SLOT.
 *
 * These two look similar and are not, and conflating them was the flaw in
 * the first version of this change.
 *
 *   TODAY'S SLOT is data we already hold about a day that is happening. We
 *   cannot refuse it. All we can decide is what to infer, and the safe
 *   inference from a value we do not recognise is "not training", which
 *   sends nothing. Open at the bottom: any future value lands there.
 *
 *   A PENDING CHANGE is an assertion that a member's whole week is about to
 *   become something else. We can and should refuse that outright unless we
 *   recognise what it says. Accepting any seven non-empty strings meant a
 *   typo, a truncated write or a foreign record became the member's
 *   effective reminder schedule for every day of the week. Failing safe on
 *   one unreadable day is reasonable; adopting an unreadable WEEK is not.
 *
 * So this list is closed, and it is the one place the Worker commits to a
 * forward vocabulary. 'support' and 'full-rest' are the two new kinds of
 * day, named LEGACY_SUPPORT and LEGACY_FULL_REST in src/scheduleSlot.js,
 * which is the authority on their names. tests/notifyRules.test.js pins this
 * list to those constants, and the training tokens to LEGACY_PRIMARY_TYPES,
 * so the two sides of the wire cannot drift silently. Today's client never
 * writes either token into the persisted schedule (toLegacySlot refuses a
 * support-only day, and the EQ week uses only legacy values); this only
 * makes the Worker safe for the day one is written. If either name changes,
 * this list changes with it and must deploy before any client can write it.
 */
export const PENDING_SLOT_VOCABULARY = Object.freeze([
    'length', 'girth', 'stamina',  // mechanical primary training
    'rest',                        // prescribed non-training, today's meaning
    'support',                     // real supporting work, no primary session
    'full-rest',                   // nothing required at all
]);

/** Is this queued week something we recognise well enough to adopt? */
function isAcceptablePendingSchedule(week) {
    return isReadableSchedule(week) && week.every(t => PENDING_SLOT_VOCABULARY.includes(t));
}

/** Hours a reminder is allowed to land in, member's local time. */
export const EARLIEST_HOUR = 5;
export const LATEST_HOUR = 23;
export const DEFAULT_REMINDER_TIMES = ['09:00', '19:00'];
export const COMPLETION_DELAY_MS = 20 * 60 * 1000;
// A short outage can catch up; old or late-synced sessions never get stale praise.
export const COMPLETION_EXPIRY_MS = 60 * 60 * 1000;

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map();

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
    const zone = timezone || 'UTC';
    let fmt = formatters.get(zone);
    if (!fmt) {
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
        if (formatters.size >= 64) formatters.clear();
        formatters.set(zone, fmt);
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

/** YYYY-MM-DD in the member's timezone. Used for training and delivery keys. */
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

/** Real completion dates belong to the member's calendar, not the server's. */
export function trainedOnLocalDay(sessionLog, dayKey, timezone) {
    return (Array.isArray(sessionLog) ? sessionLog : []).some(s => {
        if (!s || (s.workKind==='dailyPractice' && s.trainingRestSatisfied!==true) || typeof s.date !== 'string') return false;
        // Older date-only history has no timestamp to reinterpret.
        if (/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return s.date === dayKey;
        const when = new Date(s.date);
        return Number.isFinite(when.getTime()) && localDateFor(when, timezone) === dayKey;
    });
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
 * nothing beyond the app and coach names, and the member gets the real coaching once
 * they open it.
 */
export const MESSAGES = {
    daily_reminder: () => ({
        title: 'Coach Tee',
        body: 'Make sure you show up for training today.',
        tag: 'bp-reminder',
    }),
    completion_praise: (sameDay = true) => ({
        title: 'Coach Tee',
        body: sameDay ? 'Good job for showing up today.' : 'Good job for showing up.',
        tag: 'bp-completion',
    }),
};

/**
 * The whole decision. Returns null far more often than it returns a message,
 * which is the point.
 *
 * @returns {null|{kind:string,title:string,body:string,tag:string,url:string,eventKey:string}}
 */
export function decideNotification({
    sessionLog = [],
    passProtectedDates = [],
    schedule = null,
    programme = null,
    reminderTime = '19:00',
    customEnabled = true,
    timezone = 'UTC',
    deliveredEventKeys = [],
    now = new Date(),
} = {}) {
    const localDate = localDateFor(now, timezone);

    const delivered = new Set(deliveredEventKeys || []);
    const log = Array.isArray(sessionLog) ? sessionLog : [];

    // Completion praise is independent of reminder slots and rest-day guards.
    // Only actual timestamped completions qualify. A launch or date-only import
    // cannot fabricate a twenty-minute follow-up.
    const completed = log.filter(s => s && s.workKind!=='dailyPractice' && typeof s.date === 'string' && s.date.includes('T'))
        .map(s => new Date(s.date)).filter(d => {
            const age = now.getTime() - d.getTime();
            return age >= COMPLETION_DELAY_MS && age < COMPLETION_EXPIRY_MS;
        })
        .sort((a, b) => a.getTime() - b.getTime());
    for (const when of completed) {
        const age = now.getTime() - when.getTime();
        if (age < COMPLETION_DELAY_MS || age >= COMPLETION_EXPIRY_MS) continue;
        const eventKey = 'completion:' + when.toISOString();
        if (!delivered.has(eventKey)) return {
            kind: 'completion_praise', ...MESSAGES.completion_praise(localDateFor(when, timezone) === localDate),
            eventKey, tag: 'bp-completion-' + when.getTime(), url: '/app/',
        };
    }

    // 2. Only in the minute they picked, and never in the middle of the night
    //    even if they picked one.
    const minuteOfDay = localMinuteOfDay(now, timezone);
    const hour = Math.floor(minuteOfDay / 60);
    const defaultDue = DEFAULT_REMINDER_TIMES.some(t => reminderMinuteOfDay(t) === minuteOfDay);
    if (!defaultDue && !(customEnabled && minuteOfDay === reminderMinuteOfDay(reminderTime))) return null;
    if (hour < EARLIEST_HOUR || hour > LATEST_HOUR) return null;

    const todayKey = utcDayKey(now);

    // 3. They already did the work. Saying nothing is the correct behaviour.
    if (trainedOnLocalDay(log, localDate, timezone)) return null;

    // 4. A Recovery Pass is covering today. The member has a banked Pass and
    //    this is the day it is spent on, so the gap is already accounted for.
    //    Chasing someone whose Pass covered the day is worse than silence.
    //    This is the only thing passProtectedDates is read for here, and it
    //    outlives the streak warning it was first written alongside.
    if ((passProtectedDates || []).includes(todayKey)) return null;

    // 5. Today is not a day this member trains. "Time to train" on a rest day
    //    teaches members that the app is not paying attention, and the same
    //    is true of a day whose work is not mechanical training at all.
    // A scheduled goal change must also take effect when the app is closed.
    //
    // The pending schedule is accepted against a CLOSED vocabulary, widened
    // to carry the forward values rather than opened up. The old list of four
    // discarded a queued change the moment it named anything new and silently
    // ran the member on the schedule they had just replaced, which is the one
    // outcome worse than either schedule. Widening fixes that; dropping the
    // list entirely would let a typo or a truncated write become the member's
    // effective week. See PENDING_SLOT_VOCABULARY on why this is stricter
    // than the test applied to today's slot below.
    const change = programme && programme.pendingChange;
    const nextWeek = change && change.schedule;
    const effectiveSchedule = change && typeof change.effectiveDate === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(change.effectiveDate)
        && change.effectiveDate <= localDate
        && isAcceptablePendingSchedule(nextWeek)
        ? nextWeek : schedule;
    // Present and readable only. A null, short or absent schedule says nothing
    // about today and must not be read as rest. See TRAINING_SLOTS above.
    if (isReadableSchedule(effectiveSchedule)) {
        if (!isTrainingSlot(effectiveSchedule[localWeekdayFor(now, timezone)])) return null;
    }

    // A custom time coinciding with AM/PM is one message, never a double alert.
    const hhmm = String(hour).padStart(2, '0') + ':' + String(minuteOfDay % 60).padStart(2, '0');
    const eventKey = 'reminder:' + localDate + ':' + hhmm;
    if (delivered.has(eventKey)) return null;
    return { kind: 'daily_reminder', ...MESSAGES.daily_reminder(), eventKey,
        tag: 'bp-reminder-' + localDate + '-' + hhmm.replace(':', ''), url: '/app/' };
}
