/**
 * The weekly progression ledger.
 *
 * WHY THIS EXISTS
 *
 * A qualifying week needs two numbers: how many mechanical sessions were
 * SCHEDULED that week, and how many were completed. The session log answers
 * the second. Nothing answers the first, because no schedule history is
 * stored.
 *
 * An earlier version reconstructed history by applying the member's CURRENT
 * schedule to every past week. That was rejected: a member who moved from a
 * three-day to a four-day week would have had every past week silently
 * re-judged against a target it never had. So the target is written down
 * while it is still true, and a recorded week is never reinterpreted.
 *
 * ROW SHAPE — immutable weekly facts, nothing derived
 *
 *   { weekKey, targetSessions, qualifyingSessions, verdict }
 *
 * oldest first, bounded to policy.ledgerMaxWeeks.
 *
 * A CALENDAR SLOT IS NOT A QUALIFICATION VERDICT, and conflating the two
 * was the bug. Every recorded week occupies one chronological position in
 * the rolling window, because the window measures the density of qualifying
 * work across real calendar time. Whether a week can be JUDGED is a
 * separate question, and `qualified: boolean` could not express it: two
 * values for four situations.
 *
 *   'qualified'  target known, rule met. Earns progression credit.
 *   'missed'     target known, rule not met. A real shortfall.
 *   'neutral'    target known and below the minimum, so only 0 or 1
 *                sessions were ever asked for. Cannot qualify, not a
 *                failure.
 *   'unknown'    the target for that week cannot be reconstructed. Occupies
 *                calendar time, earns nothing, and must never be shown to
 *                the member as a missed week, because we do not know what
 *                was asked of them.
 *
 * All four consume a slot. Only 'qualified' counts toward the gate.
 *
 * NO cumulativeQualified, DELIBERATELY
 *
 * A running total was carried here to stop pruning losing the deload count.
 * It was wrong: it counted lifetime qualifying weeks, while deload needs
 * qualifying weeks SINCE THE LAST RESET. After a 60-day absence reset the
 * counter, the running total would have carried straight on through it.
 *
 * It is also unnecessary. Deload is fully derivable from the bounded ledger
 * plus the session log, because the stale rule bounds how far back the last
 * reset can be: see requiredLedgerWeeks().
 *
 * Pure: no DOM, no globals, no clock of its own, no mutation of inputs.
 */
import { PROGRESSION_POLICY } from './progressionPolicy.js';
import { qualifyingWeek, qualifyingSessionDays } from './progression.js';
import { getCurrentWeekKey } from './weekUtils.js';

const DAY_MS = 86400000;

function asDate(v) {
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}
const dayAt = (k) => asDate(k + 'T12:00:00');

/**
 * The normalisation boundary.
 *
 * jsonb enforces no shape, so what comes back from the database is
 * untrusted input: it may predate this phase, come from a restored backup,
 * or have been written by a future app version a cached shell has not seen.
 * Everything downstream assumes a well-formed row, so this is the one place
 * that assumption is established.
 *
 * The governing rule is FAIL SAFE: anything we cannot read confidently
 * becomes `unknown`, which takes its calendar slot and earns nothing.
 * Guessing in the member's favour would hand out progression credit on the
 * strength of corrupt data, and guessing against them would invent missed
 * weeks. `unknown` is the only honest answer for a row we cannot parse.
 *
 * Order is by parsed ISO year and week, not by string comparison, because
 * '2025_w9' sorts after '2025_w10' as text.
 *
 * Unrecognised fields are preserved. An older cached shell must not strip
 * data a newer version wrote.
 */
export function normaliseLedger(ledger, policy) {
    const p = policy || PROGRESSION_POLICY;
    if (!Array.isArray(ledger)) return [];           // null, object, string, anything

    const byKey = new Map();
    for (const raw of ledger) {
        if (!raw || typeof raw !== 'object') continue;
        const weekKey = typeof raw.weekKey === 'string' ? raw.weekKey.trim() : '';
        if (!parseWeekKey(weekKey)) continue;        // unparseable key, drop the row

        // Last write wins on a duplicate. Deterministic, and the later row
        // is the one a later reconcile produced.
        byKey.set(weekKey, { ...raw, weekKey, ...normaliseFields(raw, p) });
    }

    const rows = [...byKey.values()].sort((a, b) => {
        const A = parseWeekKey(a.weekKey), B = parseWeekKey(b.weekKey);
        return A.year - B.year || A.week - B.week;
    });
    return pruneLedger(rows, p);
}

const VALID_VERDICTS = new Set(['qualified', 'missed', 'neutral', 'unknown']);

function normaliseFields(raw, p) {
    // A target must be a non-negative integer or genuinely absent. Anything
    // else is corruption, and corruption means we do not know the target.
    const t = raw.targetSessions;
    const targetSessions = (typeof t === 'number' && Number.isFinite(t) && t >= 0)
        ? Math.floor(t) : null;

    const q = raw.qualifyingSessions;
    const qualifyingSessions = (typeof q === 'number' && Number.isFinite(q) && q >= 0)
        ? Math.floor(q) : 0;

    /* A row written before the verdict model carried `qualified: true|false`.
       It is NOT honoured, even when true. A boolean cannot distinguish a
       qualified week from a neutral or unknown one, so trusting it would
       hand out credit the new rule never granted. Those rows become
       `unknown`: the slot is kept, the credit is not. */
    if (!VALID_VERDICTS.has(raw.verdict)) {
        return { targetSessions, qualifyingSessions, verdict: 'unknown' };
    }

    if (targetSessions === null) {
        return { targetSessions, qualifyingSessions, verdict: 'unknown' };
    }

    /* A stored `unknown` is a deliberate statement that this week cannot be
       judged, and it is final. Recomputing it would undo the fail-safe on
       the very next load: a legacy boolean row is demoted to `unknown`
       above, and if that were then recomputed against its surviving target
       it would come back as `qualified` on the second pass. Normalisation
       runs on every load, so that is not a hypothetical. */
    if (raw.verdict === 'unknown') {
        return { targetSessions, qualifyingSessions, verdict: 'unknown' };
    }

    /* Otherwise the verdict must agree with the numbers beside it. A stored
       `qualified` on a row whose counts say otherwise is the one corruption
       that would silently grant progression. */
    return {
        targetSessions,
        qualifyingSessions,
        verdict: verdictFor(targetSessions, qualifyingSessions, p),
    };
}

/** '2025_w14' -> { year: 2025, week: 14 }, or null if it is not one. */
function parseWeekKey(key) {
    const m = /^(\d{4})_w(\d{1,2})$/.exec(key || '');
    if (!m) return null;
    const year = Number(m[1]), week = Number(m[2]);
    if (week < 1 || week > 53) return null;
    return { year, week };
}

/** Tolerate anything; a corrupt ledger must never break the app. */
function sane(ledger) {
    return (Array.isArray(ledger) ? ledger : []).filter(
        e => e && typeof e.weekKey === 'string' && e.weekKey);
}

/**
 * How many ledger weeks the deload derivation needs to stay correct.
 *
 * The counter runs from the last reset, and the stale rule caps how long a
 * cycle can take: between two qualifying weeks in the same cycle there can
 * be at most ceil(staleResetDays / 7) empty weeks, or a reset would have
 * intervened. So a full cycle spans at most
 *
 *     every + (every - 1) * ceil(stale / 7)
 *
 * weeks. With the current policy that is 5 + 4 * 4 = 21, comfortably inside
 * the 26 retained. A test asserts the inequality so a future policy change
 * that breaks derivability fails loudly instead of quietly miscounting.
 */
export function requiredLedgerWeeks(policy) {
    const p = policy || PROGRESSION_POLICY;
    return p.deloadEveryQualifyingWeeks
        + (p.deloadEveryQualifyingWeeks - 1) * Math.ceil(p.deloadStaleResetDays / 7);
}

/* ═══════════════════════════════════════════════════════════════════════
   Writing
   ═══════════════════════════════════════════════════════════════════════ */

/** Keep the newest `ledgerMaxWeeks` entries. Bounded growth by construction. */
export function pruneLedger(ledger, policy) {
    const p = policy || PROGRESSION_POLICY;
    const rows = sane(ledger);
    return rows.length <= p.ledgerMaxWeeks ? rows : rows.slice(rows.length - p.ledgerMaxWeeks);
}

/**
 * Bring the ledger up to date, and leave recorded history alone.
 *
 * FINALISATION. A row is final the moment its week stops being the current
 * week. Nothing rewrites a past row, ever. During the live week the row is
 * re-upserted on every save, so it tracks the week as it fills, and the
 * target it carries is the target that was true at the last save inside that
 * week. When the week rolls over the row simply stops being touched. There
 * is no separate finalise step to miss, which matters because the app may
 * not be open at the moment a week turns over.
 *
 * GAP WEEKS. Weeks between the last recorded row and now get a row with
 * `targetSessions: null` and `qualified: false`. This is not fabrication.
 * Completing a session writes to persisted state, which reconciles the
 * ledger, so a week with any completed session always has a row. A week with
 * no row therefore had no completed sessions, and zero can never satisfy a
 * minimum of two whatever the target was. Recording them matters: without
 * them an absent week would vanish from the rolling window, and a member who
 * only opened the app in good weeks could assemble eligibility out of four
 * good weeks spread across a year.
 */
export function reconcileLedger(ledger, { weekKey, schedule, sessionLog, now, restTypes, policy } = {}) {
    const p = policy || PROGRESSION_POLICY;
    const ref = asDate(now) || new Date();
    const currentKey = weekKey || getCurrentWeekKey(ref);
    const rows = sane(ledger);

    // Qualifying days per week key, from exact session dates.
    const perWeek = new Map();
    for (const day of qualifyingSessionDays(sessionLog)) {
        const d = dayAt(day);
        if (!d) continue;
        const k = getCurrentWeekKey(d);
        perWeek.set(k, (perWeek.get(k) || 0) + 1);
    }

    const rest = restTypes || ['rest'];
    const sched = Array.isArray(schedule) ? schedule : [];
    const liveTarget = sched.filter(t => typeof t === 'string' && t && !rest.includes(t)).length;

    const byKey = new Map(rows.map(r => [r.weekKey, r]));

    /* Walk the retained window oldest to newest so gaps land in order.
       `started` suppresses the weeks before this member's first recorded
       one: they were not on the system then, and inventing absent weeks for
       that period would make every new member look like they had already
       failed several. */
    const span = Math.max(p.ledgerMaxWeeks, requiredLedgerWeeks(p));
    const out = [];
    let started = false;
    for (let i = span - 1; i >= 0; i--) {
        const key = getCurrentWeekKey(new Date(ref.getTime() - i * 7 * DAY_MS));
        const existing = byKey.get(key);
        const done = perWeek.get(key) || 0;

        if (key === currentKey) {
            // Live week: recorded against the schedule as it is right now,
            // and re-recorded on every save until the week rolls over.
            out.push(row(key, liveTarget, done, p));
            started = true;
        } else if (existing) {
            out.push(existing);          // final, and never reinterpreted
            started = true;
        } else if (started || done > 0) {
            /* No row for this week. Either nobody opened the app, or the
               row was pruned or lost while the log still shows work. The
               target cannot be reconstructed either way, so the verdict is
               UNKNOWN and the session count is recorded as the fact it is.
               The slot IS taken: omitting it would stretch the rolling
               window across the absence and keep four old good weeks
               reading as recent months later. */
            out.push(row(key, null, done, p));
            /* Sessions in a week are proof the member existed and trained
               then, even with no row to show for it. Without this the
               leading-empties guard would also swallow every week of a
               member whose ledger is empty but whose log is not, and their
               entire history would vanish from the window. */
            started = true;
        }
    }
    return pruneLedger(out, p);
}

/** The four verdicts. Only QUALIFIED earns credit; all four take a slot. */
export const WEEK_VERDICT = {
    QUALIFIED: 'qualified',
    MISSED: 'missed',
    NEUTRAL: 'neutral',
    UNKNOWN: 'unknown',
};

function row(weekKey, targetSessions, qualifyingSessions, p) {
    return { weekKey, targetSessions, qualifyingSessions,
             verdict: verdictFor(targetSessions, qualifyingSessions, p) };
}

/** The single place a verdict is decided, used by writes and by normalisation. */
function verdictFor(targetSessions, qualifyingSessions, p) {
    let verdict;
    if (targetSessions === null) {
        /* No recorded target. Covers both a week nobody opened the app in
           and a week whose row was pruned or lost while the session log
           still proves work happened. Neither can be judged, and calling
           either a missed week would penalise the member for a gap in our
           own records rather than in their training. */
        verdict = WEEK_VERDICT.UNKNOWN;
    } else if (targetSessions < p.qualifyingWeekMinSessions) {
        verdict = WEEK_VERDICT.NEUTRAL;
    } else {
        verdict = qualifyingWeek(targetSessions, qualifyingSessions, p).qualifies
            ? WEEK_VERDICT.QUALIFIED : WEEK_VERDICT.MISSED;
    }
    return verdict;
}

/** Did this week earn progression credit? The only question the gate asks. */
export function weekQualified(week) {
    return !!week && week.verdict === WEEK_VERDICT.QUALIFIED;
}

/**
 * May this week be described to the member as one they missed?
 *
 * Only when the target was actually recorded. An unknown week is a hole in
 * our data, not a shortfall in their training, and a neutral week is one we
 * never asked much of.
 *
 * And never the week currently in progress. The live row is recomputed as
 * the week fills, so a four-session week reads as `missed` from Monday
 * morning until the third session lands. That verdict is correct for the
 * gate, which only ever asks "has this qualified yet", and badly wrong as
 * copy: nobody has missed a week they are still in. Pass the current week
 * key and this returns false for it.
 *
 * The row shape is locked at four fields, so this is derived at the
 * boundary rather than stored.
 */
export function weekIsMemberFacingMiss(week, currentWeekKey) {
    if (!week || week.verdict !== WEEK_VERDICT.MISSED) return false;
    if (currentWeekKey && week.weekKey === currentWeekKey) return false;
    return true;
}

/* ═══════════════════════════════════════════════════════════════════════
   Reading
   ═══════════════════════════════════════════════════════════════════════ */

/** The most recent `n` recorded weeks, newest first. */
export function recentWeeks(ledger, n) {
    const rows = sane(ledger);
    return rows.slice(Math.max(0, rows.length - n)).reverse();
}

/**
 * Eligibility: enough qualifying weeks inside the rolling window.
 *
 * The window counts RECORDED weeks. A member three weeks into the new
 * system has a three-week window and is simply not eligible yet, which is
 * the honest answer and the reason existing members start clean.
 */
export function progressionEligibility(ledger, policy) {
    const p = policy || PROGRESSION_POLICY;
    /* Every recorded week takes a slot, whatever its verdict. The window
       measures how dense qualifying work has been across real calendar
       time, so excusing light or unknown weeks from it would stretch the
       window and leave four good weeks reading as recent months after the
       member stopped. Occupying a slot is not a penalty; it is simply not
       a credit. */
    const window = recentWeeks(ledger, p.qualifyingWindowWeeks);
    const qualifying = window.filter(weekQualified).length;
    return {
        eligible: qualifying >= p.qualifyingWeeksRequired,
        qualifyingWeeks: qualifying,
        required: p.qualifyingWeeksRequired,
        windowWeeks: p.qualifyingWindowWeeks,
        recordedWeeks: window.length,
        weeks: window,
    };
}

/**
 * Deload, derived rather than stored.
 *
 * Two sources, each used for what it can actually answer:
 *   the SESSION LOG supplies exact dates, so the 28-day stale rule stays a
 *     day rule rather than being rounded to whole weeks;
 *   the LEDGER supplies the qualified verdicts, which only it can state.
 *
 * Counting:
 *   qualifying week       advances the counter
 *   non-qualifying week   PAUSES it. Not a reset, which would make someone
 *                         re-earn a rest after one bad week, and not an
 *                         advance, which would deload someone who has not
 *                         trained.
 *   >28 days with no qualifying session
 *                         resets to zero, both historically and live. A
 *                         programme policy, not a claim about fatigue.
 */
export function deloadState(ledger, sessionLog, { now, policy } = {}) {
    const p = policy || PROGRESSION_POLICY;
    const ref = asDate(now) || new Date();
    const days = qualifyingSessionDays(sessionLog);
    const rows = sane(ledger);

    const none = (extra) => ({
        isDeloadWeek: false, accumulated: 0, every: p.deloadEveryQualifyingWeeks,
        stale: false, daysSinceLastQualifying: null, resetAtWeek: null, ...extra,
    });
    if (!days.length || !rows.length) return none();

    const lastDay = dayAt(days[days.length - 1]);
    const daysSince = Math.floor((ref.getTime() - lastDay.getTime()) / DAY_MS);

    // Currently stale: nothing has accumulated, whatever the ledger says.
    if (daysSince > p.deloadStaleResetDays) {
        return none({ stale: true, daysSinceLastQualifying: daysSince });
    }

    // The most recent historical reset: the first qualifying session after a
    // gap longer than the stale window. Everything before it is discarded.
    let resetAfter = null;
    for (let i = 1; i < days.length; i++) {
        const gap = Math.floor((dayAt(days[i]).getTime() - dayAt(days[i - 1]).getTime()) / DAY_MS);
        if (gap > p.deloadStaleResetDays) resetAfter = days[i];
    }
    const resetWeek = resetAfter ? getCurrentWeekKey(dayAt(resetAfter)) : null;
    const resetIdx = resetWeek ? rows.findIndex(r => r.weekKey === resetWeek) : -1;

    let accumulated = 0;
    rows.forEach((w, i) => {
        if (resetIdx >= 0 && i < resetIdx) return;      // before the reset
        if (weekQualified(w)) accumulated += 1;         // every other verdict pauses
    });

    const latest = rows[rows.length - 1];
    return {
        // Only a qualifying week can BE the deload week; a poor week that
        // happens to follow the fifth has had no exposure to deload from.
        isDeloadWeek: weekQualified(latest) && accumulated > 0
            && accumulated % p.deloadEveryQualifyingWeeks === 0,
        accumulated,
        every: p.deloadEveryQualifyingWeeks,
        stale: false,
        daysSinceLastQualifying: daysSince,
        resetAtWeek: resetWeek,
    };
}

/**
 * The whole answer: eligible by work, and nothing holding.
 *
 * `holds` comes from toleranceHolds() in src/progression.js and is passed
 * in, because holds are session-shaped while eligibility is week-shaped.
 *
 * `rpeUnknown` is surfaced rather than folded in: UNKNOWN is not a hold, and
 * a later decision about persistent missing RPE should be made explicitly
 * rather than inherited from a silent default here.
 */
export function canProgress(ledger, holds, policy) {
    const eligibility = progressionEligibility(ledger, policy);
    const held = !!(holds && holds.held);
    return {
        available: eligibility.eligible && !held,
        eligible: eligibility.eligible,
        held,
        activeHolds: (holds && holds.active) || [],
        rpeUnknown: !!(holds && holds.rpe && holds.rpe.status === 'unknown'),
        eligibility,
        holds: holds || null,
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   The explicit state
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Four states, and none of them is produced by an absence of data.
 *
 *   ELIGIBLE      enough qualifying weeks, nothing holding
 *   HOLD          enough qualifying weeks, but a confirmed hold is active
 *   NOT_ELIGIBLE  not enough qualifying weeks, and the gap is real
 *   UNKNOWN       not enough qualifying weeks, but the window contains
 *                 weeks we could not judge, and had they qualified the
 *                 member would be eligible. We genuinely cannot tell.
 */
export const PROGRESSION_STATE = {
    ELIGIBLE: 'eligible',
    HOLD: 'hold',
    NOT_ELIGIBLE: 'not_eligible',
    UNKNOWN: 'unknown',
};

/**
 * The single question the app asks: may this member be offered more load?
 *
 * Holds only decide the state once eligibility is earned. A brake on
 * someone who has not reached the gate is moot, and reporting HOLD then
 * would imply they were otherwise ready.
 *
 * UNKNOWN exists so that gaps in our own records cannot be read as a
 * verdict on the member. It is not a pass and not a failure, and it never
 * arises from missing optional RPE, which is reported separately and is
 * deliberately non-blocking.
 */
export function progressionState(ledger, holds, policy) {
    const p = policy || PROGRESSION_POLICY;
    const eligibility = progressionEligibility(ledger, p);
    const held = !!(holds && holds.held);
    const unknownWeeks = eligibility.weeks.filter(w => w.verdict === WEEK_VERDICT.UNKNOWN).length;

    let state;
    if (eligibility.eligible) {
        state = held ? PROGRESSION_STATE.HOLD : PROGRESSION_STATE.ELIGIBLE;
    } else if (eligibility.qualifyingWeeks + unknownWeeks >= p.qualifyingWeeksRequired) {
        // Unjudgeable weeks could account for the shortfall.
        state = PROGRESSION_STATE.UNKNOWN;
    } else {
        state = PROGRESSION_STATE.NOT_ELIGIBLE;
    }

    return {
        state,
        available: state === PROGRESSION_STATE.ELIGIBLE,
        eligibility,
        holds: holds || null,
        activeHolds: (holds && holds.active) || [],
        // Surfaced, never folded in. Missing optional data is not a verdict.
        rpeUnknown: !!(holds && holds.rpe && holds.rpe.status === 'unknown'),
        unknownWeeks,
    };
}
