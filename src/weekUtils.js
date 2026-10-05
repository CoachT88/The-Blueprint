/**
 * ISO week calculation utilities.
 *
 * These are the single source of truth for week-based logic.
 * The equivalent functions in index.html must stay in sync with this file.
 *
 * Why a separate file? These functions are used to decide whether to reset
 * a user's completedDays — a silent data-mutation that runs on every app load.
 * Year-boundary edge cases (e.g. Dec 29-31 belonging to ISO week 1 of the
 * following year) are easy to get wrong and only surface once a year, so
 * they are covered here with explicit tests.
 */

/**
 * Returns the ISO week number (1–53) for a given date.
 * The week containing the year's first Thursday is always week 1.
 */
export function getISOWeek(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    return Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
}

/**
 * Returns the ISO year for a given date.
 * This can differ from the calendar year at year boundaries:
 *   - Dec 29–31 may belong to week 1 of the *next* calendar year
 *   - Jan 1–3  may belong to week 52/53 of the *previous* calendar year
 */
export function getISOYear(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    return d.getFullYear();
}

/**
 * Returns a stable string key for the ISO week containing the given date,
 * e.g. "2025_w1". Used to detect when a new week has started and the
 * user's completedDays should be reset.
 *
 * Important: uses getISOYear(), NOT date.getFullYear(), so that dates like
 * Dec 30, 2024 (which belong to ISO week 1 of 2025) produce "2025_w1"
 * rather than the incorrect "2024_w1".
 */
export function getCurrentWeekKey(date = new Date()) {
    return getISOYear(date) + '_w' + getISOWeek(date);
}

/**
 * Returns true if the stored weekKey differs from the current ISO week,
 * meaning completedDays should be reset.
 */
export function shouldResetWeek(persistedWeekKey, date = new Date()) {
    return persistedWeekKey !== getCurrentWeekKey(date);
}


const DAY_MS = 86400000;

/**
 * Legacy weekday-to-date mapping shared by weekCompletion and scheduleSlot.
 *
 * SEMANTICS ARE INTENTIONALLY PRESERVED, NOT CLEANED UP:
 * - anchor the ISO week at local noon
 * - Monday is the ISO-week anchor
 * - caller index uses Date#getDay() semantics (Sunday 0 ... Saturday 6)
 * - Sunday therefore maps to the last day of the ISO week
 * - the returned key is the UTC date portion of that local-noon timestamp via
 *   toISOString().split('T')[0]
 *
 * That local-noon -> UTC-date combination is awkward and can shift a date in
 * extreme positive UTC offsets. This helper preserves the behaviour exactly;
 * changing those semantics belongs in a separate behavioural PR.
 */
export function dateKeyForWeekday(ref, index) {
    const monday = new Date(ref);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const d = new Date(monday.getTime() + (((index + 6) % 7) * DAY_MS));
    return d.toISOString().split('T')[0];
}
