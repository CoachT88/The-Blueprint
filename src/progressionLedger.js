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
 *   { weekKey, targetSessions, qualifyingSessions, qualified }
 *
 * oldest first, bounded to policy.ledgerMaxWeeks.
 *
 * `targetSessions` is null for a week the app was never opened in. We know
 * the member completed nothing that week, and nothing can never qualify
 * whatever the target was, so the verdict is sound without inventing a
 * target. See reconcileLedger.
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
        } else if (started && done === 0) {
            // A week nobody opened the app in. Zero sessions cannot reach
            // the minimum, so the verdict holds without a known target.
            out.push(row(key, null, done, p));
        }
        /* A week with sessions but no row was pruned, not skipped. Its
           target is genuinely unknown and it plainly was not inactive, so
           re-adding it as a failure would invent a verdict. It is left out:
           the window is shorter, which is honest, rather than wrong. */
    }
    return pruneLedger(out, p);
}

function row(weekKey, targetSessions, qualifyingSessions, p) {
    // A null target means "we never saw this week". Zero sessions cannot
    // reach the minimum, so the verdict is sound without a target.
    const qualified = targetSessions === null
        ? false
        : qualifyingWeek(targetSessions, qualifyingSessions, p).qualifies;
    return { weekKey, targetSessions, qualifyingSessions, qualified };
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
    /* A week scheduled for 0 or 1 sessions is neutral: it can neither
       qualify nor fail, so letting it occupy a window slot would quietly
       penalise a legitimately light week. Derived rather than stored; a
       gap week has a null target and is NOT neutral, because zero sessions
       against an unknown target is still a week with no training in it. */
    const countable = sane(ledger).filter(
        w => !(typeof w.targetSessions === 'number' && w.targetSessions < p.qualifyingWeekMinSessions));
    const window = recentWeeks(countable, p.qualifyingWindowWeeks);
    const qualifying = window.filter(w => w.qualified).length;
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
        if (w.qualified) accumulated += 1;
    });

    const latest = rows[rows.length - 1];
    return {
        // Only a qualifying week can BE the deload week; a poor week that
        // happens to follow the fifth has had no exposure to deload from.
        isDeloadWeek: !!latest.qualified && accumulated > 0
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
