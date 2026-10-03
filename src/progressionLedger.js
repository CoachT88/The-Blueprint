/**
 * The weekly progression ledger.
 *
 * WHY THIS EXISTS
 *
 * Progression asks "how many qualifying weeks has this member had", and a
 * qualifying week needs two numbers: how many mechanical sessions were
 * SCHEDULED that week, and how many were completed. The session log answers
 * the second. Nothing answers the first, because no schedule history is
 * stored anywhere.
 *
 * The first version of this module reconstructed history by applying the
 * member's CURRENT schedule to every past week. That was rejected, and
 * rightly: a member who switched from a 3-day to a 4-day week would have
 * every past week silently re-judged against a target it never had. It
 * manufactures precision that was never recorded.
 *
 * So the target is written down at the time, once a week, and never
 * recomputed. The ledger is the trustworthy source for every rolling
 * window. It starts empty for everyone at launch, including long-tenured
 * members, and fills forward. No synthetic history.
 *
 * SHAPE
 *
 *   [{ weekKey, targetSessions, qualifyingSessions, qualified, cumulativeQualified }]
 *
 * oldest first, bounded to policy.ledgerMaxWeeks.
 *
 * `cumulativeQualified` is a running total rather than something recomputed
 * from the surviving entries. That is what makes pruning safe: a member with
 * 40 qualifying weeks still has the right deload count after the oldest
 * fourteen have been dropped.
 *
 * Pure: no DOM, no globals, no clock of its own, and every function returns
 * a new array rather than mutating the one it was given.
 */
import { PROGRESSION_POLICY } from './progressionPolicy.js';
import { qualifyingWeek, qualifyingSessionDays } from './progression.js';
import { getCurrentWeekKey } from './weekUtils.js';

const DAY_MS = 86400000;

function asDate(v) {
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}

/** Tolerate anything; a corrupt ledger must never break the app. */
function sane(ledger) {
    return (Array.isArray(ledger) ? ledger : []).filter(
        e => e && typeof e.weekKey === 'string' && e.weekKey);
}

/* ═══════════════════════════════════════════════════════════════════════
   Writing
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Record, or update, one week.
 *
 * Called with the week currently in progress, so it runs repeatedly for the
 * same `weekKey` as sessions accumulate. Re-running it is safe and is the
 * normal case: the entry is replaced, and every cumulative total after it is
 * recalculated so the chain stays consistent when a week flips from not
 * qualifying to qualifying mid-week.
 *
 * Entries are kept in ascending weekKey order. ISO week keys sort correctly
 * as strings within a year but not across a year boundary ('2025_w9' sorts
 * after '2025_w10'), so ordering is by insertion and by explicit week
 * sequence rather than by string comparison. New weeks append.
 */
export function ledgerUpsertWeek(ledger, week, policy) {
    const p = policy || PROGRESSION_POLICY;
    const rows = sane(ledger);
    if (!week || typeof week.weekKey !== 'string' || !week.weekKey) return rows;

    const target = Math.max(0, Number(week.targetSessions) || 0);
    const done = Math.max(0, Number(week.qualifyingSessions) || 0);
    const verdict = qualifyingWeek(target, done, p);

    const entry = {
        weekKey: week.weekKey,
        targetSessions: target,
        qualifyingSessions: done,
        qualified: verdict.qualifies,
        cumulativeQualified: 0,       // filled by the recount below
    };

    const idx = rows.findIndex(e => e.weekKey === week.weekKey);
    const next = idx >= 0
        ? [...rows.slice(0, idx), entry, ...rows.slice(idx + 1)]
        : [...rows, entry];

    return pruneLedger(recountCumulative(next), p);
}

/**
 * Recompute the running totals from the first retained entry forward.
 *
 * The first entry keeps whatever cumulative total it already had, so a
 * member whose early weeks were pruned does not lose them. Only entries
 * after it are rebuilt.
 */
function recountCumulative(rows) {
    let running = 0;
    return rows.map((e, i) => {
        if (i === 0) {
            // Preserve history that predates the retained window.
            const base = Number.isFinite(e.cumulativeQualified) && e.cumulativeQualified > 0
                ? e.cumulativeQualified
                : (e.qualified ? 1 : 0);
            running = base;
            return { ...e, cumulativeQualified: running };
        }
        if (e.qualified) running += 1;
        return { ...e, cumulativeQualified: running };
    });
}

/** Keep the newest `ledgerMaxWeeks` entries. Bounded growth, by construction. */
export function pruneLedger(ledger, policy) {
    const p = policy || PROGRESSION_POLICY;
    const rows = sane(ledger);
    return rows.length <= p.ledgerMaxWeeks ? rows : rows.slice(rows.length - p.ledgerMaxWeeks);
}

/**
 * Build the week entry for the week currently in progress.
 *
 * `targetSessions` must come from the schedule as it is RIGHT NOW, because
 * right now is the week being recorded. That is the whole point: the target
 * is captured while it is still true.
 */
export function currentWeekEntry({ weekKey, schedule, sessionLog, restTypes }) {
    const rest = restTypes || ['rest'];
    const sched = Array.isArray(schedule) ? schedule : [];
    const targetSessions = sched.filter(t => typeof t === 'string' && t && !rest.includes(t)).length;

    let qualifyingSessions = 0;
    for (const day of qualifyingSessionDays(sessionLog)) {
        const d = asDate(day + 'T12:00:00');
        if (d && getCurrentWeekKey(d) === weekKey) qualifyingSessions += 1;
    }
    return { weekKey, targetSessions, qualifyingSessions };
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
 * The window counts RECORDED weeks, not calendar weeks. A member who has
 * only been on the new system for three weeks has a three-week window, and
 * is simply not eligible yet. That is the honest answer, and it is why
 * existing members start clean rather than with invented history.
 */
export function progressionEligibility(ledger, policy) {
    const p = policy || PROGRESSION_POLICY;
    const window = recentWeeks(ledger, p.qualifyingWindowWeeks);
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
 * Deload, driven by accumulated qualifying weeks.
 *
 *   qualifying week      advances the counter
 *   non-qualifying week  PAUSES it. Not a reset, which would make someone
 *                        re-earn a rest after one bad week, and not an
 *                        advance, which would deload someone who has not
 *                        trained.
 *   no qualifying work for deloadStaleResetDays
 *                        resets. Stops a member returning after months and
 *                        meeting a deload before their first session back.
 *
 * The stale rule is a programme policy, not a claim about how fatigue
 * behaves over time.
 */
export function deloadState(ledger, { now, lastQualifyingDate, policy } = {}) {
    const p = policy || PROGRESSION_POLICY;
    const ref = asDate(now) || new Date();
    const last = asDate(lastQualifyingDate);
    const daysSince = last ? Math.floor((ref.getTime() - last.getTime()) / DAY_MS) : null;

    const rows = sane(ledger);
    if (!rows.length) {
        return { isDeloadWeek: false, accumulated: 0, every: p.deloadEveryQualifyingWeeks,
                 stale: false, daysSinceLastQualifying: daysSince };
    }
    if (daysSince !== null && daysSince > p.deloadStaleResetDays) {
        return { isDeloadWeek: false, accumulated: 0, every: p.deloadEveryQualifyingWeeks,
                 stale: true, daysSinceLastQualifying: daysSince };
    }

    const latest = rows[rows.length - 1];
    const accumulated = Number.isFinite(latest.cumulativeQualified) ? latest.cumulativeQualified : 0;
    return {
        isDeloadWeek: latest.qualified && accumulated > 0
            && accumulated % p.deloadEveryQualifyingWeeks === 0,
        accumulated,
        every: p.deloadEveryQualifyingWeeks,
        stale: false,
        daysSinceLastQualifying: daysSince,
    };
}

/**
 * The whole answer: eligible by work, and nothing holding.
 *
 * `holds` is produced by toleranceHolds() in src/progression.js from the
 * session log, and passed in, because holds are session-shaped while
 * eligibility is week-shaped and the two sources are genuinely different.
 *
 * `rpeUnknown` is surfaced rather than folded in. UNKNOWN is not a hold, and
 * a later product decision about persistent missing RPE should be made
 * explicitly rather than inherited from a silent default here.
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
