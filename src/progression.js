/**
 * Progression: what the member has earned, and what is holding it.
 *
 * Phase 2A.1 established the pattern and this follows it exactly. Pure
 * functions, every input an argument including the clock, no DOM, no
 * globals, no writes. Nothing here is wired into the app yet.
 *
 * THE MODEL
 *
 *   ADHERENCE   earns eligibility
 *   TOLERANCE   can hold it
 *   TIME        is no longer the mechanism
 *
 * There is no score. Eligibility is a boolean, each hold is a named boolean,
 * and advancement is "eligible and nothing holding". A member can be told
 * which sentence applies to them, which is the entire reason not to build a
 * weighted index.
 *
 * WHAT REPLACED WHAT
 *
 * The old system advanced on wall-clock time from a tap: `firstSessionDate`
 * was written by tapping a difficulty button, `diffUnlockedDate` by
 * selecting a tier, and Advanced unlocked four calendar weeks later whether
 * or not a single session was ever completed. Nothing in it read the session
 * log. This reads only the session log.
 *
 * Every number lives in src/progressionPolicy.js. None is a medical constant.
 */
import { getCurrentWeekKey } from './weekUtils.js';
import { PROGRESSION_POLICY } from './progressionPolicy.js';

/** Missions that load tissue mechanically. Recovery is deliberately absent. */
export const MECHANICAL_MISSIONS = ['length', 'girth', 'stamina'];

/** RPE can say hold, clear, or nothing at all. Never silently clear. */
export const RPE_STATUS = { HOLD: 'hold', CLEAR: 'clear', UNKNOWN: 'unknown' };

const DAY_MS = 86400000;

function asDate(v) {
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}

/** Local calendar day, matching how the app keys everything else. */
function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   1. What counts
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Is this log entry a completed mechanical session?
 *
 * Presence in the session log IS completion: there is no status field, and
 * abandoned drafts never reach it. So the only question is the mission.
 *
 * A manual substitution counts in full. The member trained; which of the
 * three mechanical missions they chose is a preference, not a measure of
 * exposure. A MODIFIED session counts in full for the same reason: reduced
 * volume is still mechanical work, and not counting it would punish someone
 * for reporting soreness honestly.
 */
export function isQualifyingSession(entry) {
    return !!entry && MECHANICAL_MISSIONS.includes(entry.routineType);
}

/** Completed recovery. Counts for lifetime volume and for the safety hold, never for exposure. */
export function isRecoverySession(entry) {
    return !!entry && entry.routineType === 'recovery';
}

/**
 * Qualifying sessions, at most one per calendar day.
 *
 * Adherence and progression are both day-shaped, because `completedDays`
 * holds one boolean per weekday and cannot represent a second session. A
 * member who trains twice on Monday has one day of exposure as far as every
 * other part of the system is concerned, and progression must agree with it
 * or the two will drift. Lifetime volume still counts both; see
 * lifetimeVolume().
 */
export function qualifyingSessionDays(sessionLog) {
    const days = new Set();
    for (const e of sessionLog || []) {
        if (!isQualifyingSession(e)) continue;
        const d = asDate(e.date);
        if (d) days.add(dayKey(d));
    }
    return [...days].sort();
}

/** Every completed session, doubles included. The honest lifetime number. */
export function lifetimeVolume(sessionLog) {
    const log = sessionLog || [];
    return {
        mechanical: log.filter(isQualifyingSession).length,
        recovery: log.filter(isRecoverySession).length,
        total: log.length,
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   2. Qualifying weeks
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Did this week earn progression credit?
 *
 *   Miss at most one scheduled mechanical session, AND complete at least two.
 *
 *   target 4  -> need 3        target 2  -> need 2 (the floor binds)
 *   target 3  -> need 2        target 0 or 1 -> neither qualifies nor fails
 *
 * A one-session week cannot qualify, and must not count as a failure either:
 * a member cannot be penalised for a week the schedule never asked much of.
 * That is why the return carries `neutral` rather than just a boolean.
 */
export function qualifyingWeek(target, completed, policy) {
    const p = policy || PROGRESSION_POLICY;
    const t = Number.isFinite(target) ? Math.max(0, target) : 0;
    const c = Number.isFinite(completed) ? Math.max(0, completed) : 0;

    if (t < p.qualifyingWeekMinSessions) {
        return { qualifies: false, neutral: true, required: null, target: t, completed: c };
    }
    const required = Math.max(p.qualifyingWeekMinSessions, t - p.qualifyingWeekMaxMissed);
    return { qualifies: c >= required, neutral: false, required, target: t, completed: c };
}

/**
 * Roll the session log up into weeks.
 *
 * `weeklyTargets` maps a week key to the number of scheduled mechanical
 * sessions that week. The app does not store schedule history, so in
 * practice the caller supplies today's target for every week. That is an
 * approximation and it is the caller's to make, not this function's: it is
 * recorded in the result as `targetSource` so nothing downstream mistakes it
 * for history.
 */
export function weeklyRollup(sessionLog, { now, weeklyTargets, defaultTarget, policy } = {}) {
    const p = policy || PROGRESSION_POLICY;
    const ref = asDate(now) || new Date();
    const targets = weeklyTargets || {};
    const byWeek = new Map();

    for (const day of qualifyingSessionDays(sessionLog)) {
        const d = asDate(day + 'T12:00:00');
        if (!d) continue;
        const key = getCurrentWeekKey(d);
        byWeek.set(key, (byWeek.get(key) || 0) + 1);
    }

    // Walk back week by week from now, so empty weeks appear as themselves
    // rather than as gaps in a list of weeks that happened to have sessions.
    const weeks = [];
    for (let i = 0; i < p.qualifyingWindowWeeks; i++) {
        const when = new Date(ref.getTime() - i * 7 * DAY_MS);
        const key = getCurrentWeekKey(when);
        const target = Number.isFinite(targets[key]) ? targets[key]
            : (Number.isFinite(defaultTarget) ? defaultTarget : 0);
        const completed = byWeek.get(key) || 0;
        weeks.push({ weekKey: key, ...qualifyingWeek(target, completed, p) });
    }
    return {
        weeks,                                   // newest first
        targetSource: weeklyTargets ? 'provided' : 'current-schedule-assumed',
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   3. The gate
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Eligibility: enough qualifying weeks inside the rolling window.
 *
 * Not consecutive. A member who has a bad fortnight and then three good
 * weeks has done the work; requiring an unbroken run would mean one illness
 * costs them a month.
 */
export function progressionEligibility(sessionLog, opts) {
    const p = (opts && opts.policy) || PROGRESSION_POLICY;
    const rollup = weeklyRollup(sessionLog, { ...opts, policy: p });
    const qualifying = rollup.weeks.filter(w => w.qualifies);
    return {
        eligible: qualifying.length >= p.qualifyingWeeksRequired,
        qualifyingWeeks: qualifying.length,
        required: p.qualifyingWeeksRequired,
        windowWeeks: p.qualifyingWindowWeeks,
        weeks: rollup.weeks,
        targetSource: rollup.targetSource,
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   4. Holds
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * RPE across the recent qualifying sessions.
 *
 * The important property: missing data returns UNKNOWN, never CLEAR.
 * RPE is optional at the success screen, so a member who never fills it in
 * would otherwise look permanently well-recovered, and an absence of
 * evidence would be read as evidence. UNKNOWN lets the caller decide, and
 * the caller's decision is a product question rather than one this function
 * should make quietly.
 *
 * It also must not block forever. UNKNOWN is not a hold; `holds()` treats
 * only HOLD as a hold.
 */
export function rpeTolerance(sessionLog, policy) {
    const p = policy || PROGRESSION_POLICY;
    const recent = (sessionLog || []).filter(isQualifyingSession).slice(-p.rpeWindowSessions);
    const values = recent
        .map(e => e.rpe)
        .filter(v => typeof v === 'number' && Number.isFinite(v));

    if (values.length < p.rpeMinSamples) {
        return {
            status: RPE_STATUS.UNKNOWN,
            mean: null,
            samples: values.length,
            minSamples: p.rpeMinSamples,
            consideredSessions: recent.length,
        };
    }
    const mean = values.reduce((t, v) => t + v, 0) / values.length;
    return {
        status: mean >= p.rpeHoldThreshold ? RPE_STATUS.HOLD : RPE_STATUS.CLEAR,
        mean,
        samples: values.length,
        minSamples: p.rpeMinSamples,
        consideredSessions: recent.length,
    };
}

/**
 * Recent recovery usage.
 *
 * Counts COMPLETED recovery sessions, not RECOVER routings, because routing
 * is not persisted: the resolver is pure, rendering writes nothing, opening
 * the picker writes nothing, and today's soreness lives in a localStorage
 * key that is pruned. The only durable trace of a recovery day is a log
 * entry. See the Gate 0 report.
 *
 * This does not diagnose anything. It is a conservative product rule: three
 * recovery sessions in a fortnight suggests holding the current workload
 * rather than adding to it.
 */
export function recoverySafety(sessionLog, { now, policy } = {}) {
    const p = policy || PROGRESSION_POLICY;
    const ref = asDate(now) || new Date();
    const cutoff = ref.getTime() - p.recoverySafetyWindowDays * DAY_MS;
    const count = (sessionLog || []).filter(e => {
        if (!isRecoverySession(e)) return false;
        const d = asDate(e.date);
        return d && d.getTime() >= cutoff && d.getTime() <= ref.getTime();
    }).length;
    return {
        hold: count >= p.recoveryCompletedHoldCount,
        count,
        threshold: p.recoveryCompletedHoldCount,
        windowDays: p.recoverySafetyWindowDays,
    };
}

/**
 * All holds, and whether any is active.
 *
 * Any confirmed hold wins. No weighting, no averaging of unrelated signals,
 * no composite. Each hold is a sentence a member could be shown.
 */
export function toleranceHolds(sessionLog, opts) {
    const p = (opts && opts.policy) || PROGRESSION_POLICY;
    const rpe = rpeTolerance(sessionLog, p);
    const recovery = recoverySafety(sessionLog, { ...opts, policy: p });
    const active = [];
    if (rpe.status === RPE_STATUS.HOLD) active.push('rpe');
    if (recovery.hold) active.push('recovery');
    return { held: active.length > 0, active, rpe, recovery };
}

/**
 * The whole answer: eligible by work, and nothing holding.
 *
 * `rpeUnknown` is surfaced rather than folded in, so a caller can choose to
 * treat persistent missing RPE differently later without this function
 * having quietly decided for them.
 */
export function canProgress(sessionLog, opts) {
    const eligibility = progressionEligibility(sessionLog, opts);
    const holds = toleranceHolds(sessionLog, opts);
    return {
        available: eligibility.eligible && !holds.held,
        eligible: eligibility.eligible,
        held: holds.held,
        activeHolds: holds.active,
        rpeUnknown: holds.rpe.status === RPE_STATUS.UNKNOWN,
        eligibility,
        holds,
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   5. Deload
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Deload driven by accumulated exposure instead of the calendar.
 *
 * The old rule was `getISOWeek() % 4 === 0` gated on a date set by a tap, so
 * it fired on members who had not trained and on members mid-absence.
 *
 * Counting rules, each chosen to avoid a specific wrong answer:
 *   qualifying week      advances the counter
 *   non-qualifying week  PAUSES it. Not a reset: making someone re-earn a
 *                        rest because of one bad week punishes absence.
 *                        Not an advance: deloading someone who has not
 *                        trained is backwards.
 *   28 days with no qualifying work  resets. Stops a member returning after
 *                        months and meeting a deload before their first
 *                        session back. This is a product rule, not a claim
 *                        about how fatigue behaves.
 */
export function deloadState(sessionLog, opts) {
    const p = (opts && opts.policy) || PROGRESSION_POLICY;
    const ref = asDate(opts && opts.now) || new Date();

    const days = qualifyingSessionDays(sessionLog);
    const last = days.length ? asDate(days[days.length - 1] + 'T12:00:00') : null;
    const daysSince = last ? Math.floor((ref.getTime() - last.getTime()) / DAY_MS) : null;

    if (!days.length || daysSince > p.deloadStaleResetDays) {
        return {
            isDeloadWeek: false,
            accumulated: 0,
            every: p.deloadEveryQualifyingWeeks,
            stale: days.length > 0,
            daysSinceLastQualifying: daysSince,
        };
    }

    // Oldest first, so the count is "how many qualifying weeks so far".
    const weeks = weeklyRollup(sessionLog, { ...opts, policy: p }).weeks.slice().reverse();
    let accumulated = 0;
    let isDeloadWeek = false;
    for (const w of weeks) {
        if (!w.qualifies) continue;             // pause, neither advance nor reset
        accumulated += 1;
        isDeloadWeek = accumulated % p.deloadEveryQualifyingWeeks === 0;
    }
    return {
        isDeloadWeek,
        accumulated,
        every: p.deloadEveryQualifyingWeeks,
        stale: false,
        daysSinceLastQualifying: daysSince,
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   6. Programme start
   ═══════════════════════════════════════════════════════════════════════ */

export const PROGRAMME_START_SOURCE = {
    EXISTING: 'existing',
    EARLIEST_SESSION: 'earliest-session',
    LEGACY_FIELD: 'legacy-first-session-date',
    UNKNOWN_ESTABLISHED: 'established-start-unknown',
    NOT_STARTED: 'not-started',
};

/**
 * Work out when this member's programme began.
 *
 * `firstSessionDate` cannot be trusted on its own: it is written by
 * setDifficulty(), so it records a tap on a difficulty button, not a
 * session. It is usable only as a fallback and only when it does not
 * contradict the log.
 *
 * The order, and what each step is protecting against:
 *
 *   0. Already set            never recompute, never move a member's start.
 *   1. Earliest qualifying    only when history looks complete. The log is
 *      session                pruned oldest-first at 300 KB, so the earliest
 *                             retained entry is not always the earliest
 *                             entry.
 *   2. Legacy field           only when valid, not future, and not later
 *                             than the earliest retained session. A date
 *                             after the first known session is incoherent.
 *   3. Established, unknown   has history, cannot date it. Returns null with
 *                             established: true. A long-tenured member is
 *                             never reset to week one because their early
 *                             history aged out.
 *   4. Not started            no history. Starts when they train.
 *
 * Deliberately NOT used as proof of completeness: sessionLog.length >=
 * allTimeSessionCount. Imports, older app versions, recovery entries and
 * past schema changes can all break that equality in either direction. The
 * completeness test is the caller's to supply via `historyComplete`, and
 * when it is not supplied the answer is "established, start unknown" rather
 * than a guess. Preferring UNKNOWN is the whole point.
 */
export function programmeStartBackfill({
    programmeStartDate,
    sessionLog,
    firstSessionDate,
    allTimeSessionCount,
    historyComplete,
    now,
} = {}) {
    const ref = asDate(now) || new Date();

    if (programmeStartDate) {
        const d = asDate(programmeStartDate);
        if (d) return { date: dayKey(d), source: PROGRAMME_START_SOURCE.EXISTING, established: true };
    }

    const days = qualifyingSessionDays(sessionLog);
    const earliest = days.length ? days[0] : null;
    const lifetime = Number.isFinite(allTimeSessionCount) ? allTimeSessionCount : 0;
    const hasHistory = days.length > 0 || lifetime > 0;

    if (earliest && historyComplete === true) {
        return { date: earliest, source: PROGRAMME_START_SOURCE.EARLIEST_SESSION, established: true };
    }

    const legacy = asDate(firstSessionDate);
    const legacyUsable = legacy
        && legacy.getTime() <= ref.getTime()
        && (!earliest || legacy.getTime() <= asDate(earliest + 'T23:59:59').getTime());
    if (legacyUsable && hasHistory) {
        return { date: dayKey(legacy), source: PROGRAMME_START_SOURCE.LEGACY_FIELD, established: true };
    }

    if (hasHistory) {
        // Null date plus established: true. There is no second column for
        // this, and there does not need to be: null with history means
        // exactly this and nothing else.
        return { date: null, source: PROGRAMME_START_SOURCE.UNKNOWN_ESTABLISHED, established: true };
    }

    return { date: null, source: PROGRAMME_START_SOURCE.NOT_STARTED, established: false };
}

/**
 * The new-member rule, kept separate from backfill because it is a different
 * question. Set once, on the first completed qualifying mechanical session,
 * and never from a sign-up, a goal choice, opening Mission Select, picking a
 * difficulty, or completing recovery.
 */
export function programmeStartOnCompletion({ programmeStartDate, completedEntry, now } = {}) {
    if (programmeStartDate) return null;              // already set, never move it
    if (!isQualifyingSession(completedEntry)) return null;
    const d = asDate(completedEntry.date) || asDate(now) || new Date();
    return dayKey(d);
}
