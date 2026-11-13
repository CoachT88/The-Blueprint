/**
 * The tier a genuinely new account starts at, and how the app knows the
 * account is genuinely new.
 *
 * THE DEFECT THIS CLOSES. The intro promises a new member Beginner, and the
 * app has a path for it: no user_data row means a brand-new account, adopted at
 * Beginner. But the signup trigger (handle_new_user) creates the row first,
 * holding only the id, so the app never meets "no row". It meets a row whose
 * `difficulty` is whatever the column defaults to, which was 'intermediate',
 * and it read that default as a choice the member made. The buyer's first
 * session then ran at the full Intermediate dose for 15 XP, and the tier was
 * saved into the row as if chosen.
 *
 * THE RULE. A row the app has never saved, in which nothing has been done or
 * chosen, belongs to an account that has not begun. The tier it carries is only
 * a default, so the account starts at the starting tier.
 *
 * "NEVER SAVED" IS READ FROM EVERY MARKER, NOT FROM THE SESSION COUNT.
 * Zero sessions is what a new account has in common with the 17 production
 * accounts that already carry Intermediate and were never trained; it is not
 * what separates them. What separates them is that the app has saved those
 * rows. Its very first load writes week_key and xp_migrated, and choosing a
 * tier records diff_unlocked_date and first_session_date. A row is untouched
 * only when all of those, and every kind of history, goal, plan and pelvic
 * check, are blank.
 *
 * DOUBT RESOLVES TO "ESTABLISHED". The two mistakes are not the same size.
 * Reading a real member as new would move their tier on their next load.
 * Reading a new account as established leaves them at Intermediate, which is
 * where every new account was before this module existed. So a blank is a
 * closed set (null, empty text, zero, false, an empty list), and anything else,
 * including a value of an unexpected type, counts as a mark.
 *
 * WHAT IT DOES NOT TOUCH. It never changes a stored row, and it is only ever
 * applied to the copy the app is about to adopt. It leaves Advanced and Elite
 * alone, leaves Beginner as it is, and never reads the clock. Rows that are
 * not signup rows are returned as the very same object.
 *
 * Pure: no DOM, no globals, no network.
 */

/** The tier an account that has not begun starts at. Matches DIFFICULTIES[0] in the app. */
export const STARTING_TIER = 'beginner';

/** What the column carried before this change: the database default, or nothing. */
const DEFAULT_TIERS = new Set([null, undefined, '', 'intermediate']);

const isBlankText = (v) => v === null || v === undefined || v === '';
const isBlankFlag = (v) => v === null || v === undefined || v === false;
const isBlankCount = (v) => v === null || v === undefined || v === 0;
/** An absent list, or an empty one. An object, a string or anything else is not a list and is a mark. */
const isBlankList = (v) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);
/** Absent, or an object whose every slot is blank text: the tier-choice record before any tier is chosen. */
const isBlankTierRecord = (v) => v === null || v === undefined
    || (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isBlankText));
/** A programme is an object once one exists, even an empty one: "a programme exists and says nothing". */
const isAbsent = (v) => v === null || v === undefined;

/**
 * [column, blank?] for every column the app or the member writes. The signup
 * trigger leaves each of these at a blank.
 */
const MARKERS = [
    // Written by the app's own first load, before the member does anything.
    ['week_key', isBlankText],
    ['xp_migrated', isBlankFlag],
    // Written when a tier is chosen or a session starts.
    ['first_session_date', isBlankText],
    ['diff_unlocked_date', isBlankTierRecord],
    // History.
    ['total_xp', isBlankCount],
    ['all_time_session_count', isBlankCount],
    ['session_log', isBlankList],
    ['measurements', isBlankList],
    ['seen_milestones', isBlankList],
    ['progress_checkins', isBlankList],
    ['progression_ledger', isBlankList],
    // A goal, a programme and its plans.
    ['primary_goal', isBlankText],
    ['programme', isAbsent],
    ['day_plans', isBlankList],
    ['programme_start_date', isBlankText],
    // The pelvic check.
    ['pelvic_profile', isBlankText],
    ['pelvic_screen_date', isBlankText],
];

const isRow = (row) => row !== null && typeof row === 'object' && !Array.isArray(row);

/**
 * Has anything, the app or the member, ever been put in this row?
 * True only when every marker is blank. Says nothing about the tier the row
 * carries: see applyStartingTier.
 */
export function isUntouchedSignupRow(row) {
    if (!isRow(row)) return false;
    return MARKERS.every(([column, isBlank]) => isBlank(row[column]));
}

/**
 * The row the app should adopt. A COPY with Beginner in place of the default
 * tier when the row is an untouched signup row; otherwise the very same object.
 *
 * The tier is replaced only when it is the old default or empty. A row that
 * carries Beginner already needs nothing, and one that carries Advanced or
 * Elite was set by somebody and is never overridden.
 */
export function applyStartingTier(row) {
    if (!isRow(row)) return row;
    if (!DEFAULT_TIERS.has(row.difficulty)) return row;
    if (!isUntouchedSignupRow(row)) return row;
    return { ...row, difficulty: STARTING_TIER };
}
