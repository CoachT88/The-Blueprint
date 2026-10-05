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

/* Eligibility, deload and the whole-answer helper live in
   src/progressionLedger.js, because all three need to know what was
   SCHEDULED in a past week and the session log cannot say. Applying today's
   schedule backwards would invent precision that was never recorded. */

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
 * How many distinct days in a given ISO week carried a qualifying session.
 *
 * This is the only week-shaped thing the session log can honestly answer:
 * what happened. It cannot answer what was scheduled, because no schedule
 * history is stored. The target comes from the ledger, recorded at the time;
 * see src/progressionLedger.js.
 */
export function countQualifyingDaysInWeek(sessionLog, weekKey) {
    let n = 0;
    for (const day of qualifyingSessionDays(sessionLog)) {
        const d = asDate(day + 'T12:00:00');
        if (d && getCurrentWeekKey(d) === weekKey) n += 1;
    }
    return n;
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

/* ═══════════════════════════════════════════════════════════════════════
   5. Programme start
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

    /* The legacy field needs CORROBORATION, not merely an absence of
       contradiction. With no retained sessions there is nothing for it to
       contradict, and accepting it there would mean trusting a date written
       by a difficulty tap for a member whose history we plainly cannot see.
       That is inventing a start. Requiring retained history to compare
       against is what keeps "prefer unknown when confidence is
       questionable" true in the case where confidence is lowest. */
    const legacy = asDate(firstSessionDate);
    const legacyUsable = legacy
        && earliest
        && legacy.getTime() <= ref.getTime()
        && legacy.getTime() <= asDate(earliest + 'T23:59:59').getTime();
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

/**
 * Can we PROVE no qualifying mechanical session happened before this one?
 *
 * Called just after a completion, so the session in question is the last
 * entry in the log. Two things have to hold.
 *
 * FIRST, the history has to be complete. allTimeSessionCount has exactly one
 * increment site and sessionLog has exactly one push site, and they are
 * adjacent lines in finishSession(), so the two move in lockstep and
 * equality means nothing has been dropped. Every way they can come apart
 * breaks the equality in a direction we can see:
 *
 *   log pruned at the byte budget, or the historic entry cap   count > length
 *   member predates the count field, so it loads as 0          count < length
 *   import whose backup omits the count                        count < length
 *   import of a backup taken after pruning                     count > length
 *
 * All of those refuse. The one case that slips through is a hand-edited
 * backup that is internally consistent, where the member overwrote their own
 * data with a file claiming N sessions and the app has no other evidence.
 *
 * SECOND, the retained history must contain no earlier mechanical session.
 * The count alone is not enough: a member can hold mechanical history AND a
 * null programmeStartDate, because programmeStartBackfill() refuses to date
 * anyone without corroboration. Reading the log catches that.
 *
 * The last entry is excluded, because the question is about what came
 * BEFORE. Trimming removes from the front, so the newest entry is always
 * last; and if this very push triggered a trim then count exceeds length and
 * the completeness half has already refused.
 *
 * Deliberately not a session-count threshold. "Fewer than N sessions" cannot
 * separate a new member whose first session was Recovery from a long-tenured
 * one whose log was pruned, and any N would be invented. This asks a
 * question the data can actually answer, and says no when it cannot.
 */
export function provablyFirstMechanicalSession({ sessionLog, allTimeSessionCount } = {}) {
    const log = Array.isArray(sessionLog) ? sessionLog : [];
    if (!log.length) return false;
    if (allTimeSessionCount !== log.length) return false;         // history not provably whole
    return !log.slice(0, -1).some(isQualifyingSession);           // nothing mechanical before
}
