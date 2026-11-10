// Recovery after a refused write. Pure: no DOM, no clock, no globals.
//
// WHY THIS EXISTS. The server row carries a revision, and a write based on an
// older revision is refused. A refusal must never lose what the member did, and
// it must never award anything twice. This module decides, from three snapshots
// the caller supplies, what the recovered row is. It does no I/O.
//
//   server   the row as the server holds it now          (wins by default)
//   local    this tab's in-memory or backed-up state     (the stale side)
//   base     what this tab last knew the server held     (null when unknown)
//
// WHAT IS RECOVERED, AND WHY ONLY THAT. Completed sessions are identified by a
// stable id and are additive, so they can be replayed safely. Personal records
// only ever rise, so the larger value is always right. Recovery Passes are the
// one reward that goes up and down, so they are reconciled from the CHANGES this
// tab made against its base, deduplicated by week and by date. Goal, schedule
// and difficulty are never replayed over the server's: the server wins, and the
// caller is told when a member's edit was therefore not kept.

export const TOMBSTONE_CAP = 100;
const PASS_DATES_KEPT = 30;

/** Identity of one completed session. A stable id when there is one; legacy
 *  entries fall back to date + routine. Prefixed so the two can never collide. */
export function entryKey(e) {
    if (e && e.sid) return 's:' + e.sid;
    return 'd:' + (e && e.date) + '|' + (e && e.routineType);
}
const measurementKey = (m) => (m && m.sid ? 's:' + m.sid : 'd:' + (m && m.date));

/* ── Trimming memory ───────────────────────────────────────────────────────
   The session log is trimmed to a byte budget, oldest first. A session that
   was saved and then trimmed is absent from the log, and would look exactly
   like a session that was never saved. So trimming leaves a bounded record:
   the keys of the most recent drops, and a floor date, the newest date ever
   dropped. Bounded, because the keys are capped and the floor is one string. */

export function normaliseMeta(m) {
    const t = m && Array.isArray(m.trimmed) ? m.trimmed.filter(x => typeof x === 'string') : [];
    return { trimmed: t.slice(-TOMBSTONE_CAP), floor: m && typeof m.floor === 'string' ? m.floor : '' };
}

/** The meta after `before` was trimmed down to `after`. */
export function recordTrim(meta, before, after) {
    const m = normaliseMeta(meta);
    const kept = new Set((after || []).map(entryKey));
    const dropped = (before || []).filter(e => !kept.has(entryKey(e)));
    if (!dropped.length) return m;
    const seen = new Set();
    const keys = [...m.trimmed, ...dropped.map(entryKey)].filter(k => (seen.has(k) ? false : (seen.add(k), true)));
    const floor = dropped.reduce((f, e) => (e.date > f ? e.date : f), m.floor);
    return { trimmed: keys.slice(-TOMBSTONE_CAP), floor };
}

/** 'applied' (already counted, possibly trimmed since), 'held' (cannot be told
 *  apart from a trimmed one, so it is NOT awarded), or 'new'. */
export function classifyEntry(e, ctx) {
    const k = entryKey(e);
    if (ctx.serverKeys.has(k)) return 'applied';
    if (ctx.tombstones.has(k)) return 'applied';
    if (ctx.meta.floor && e.date <= ctx.meta.floor) return 'held';
    /* A row written before trimming was recorded has no floor. Older than the
       oldest retained entry is only suspicious when the log is near its budget,
       because a small log cannot have been trimmed. */
    if (!ctx.meta.floor && ctx.logBudget && ctx.serverLog.length) {
        const oldest = ctx.serverLog.reduce((m, x) => (x.date < m ? x.date : m), ctx.serverLog[0].date);
        if (e.date < oldest && JSON.stringify(ctx.serverLog).length >= 0.8 * ctx.logBudget) return 'held';
    }
    return 'new';
}

/* ── Outcomes ─────────────────────────────────────────────────────────────── */

/** Did the server refuse this write on revision grounds? */
export function isRevisionRefusal(error) {
    if (!error) return false;
    return error.code === 'PT409' || error.status === 409
        || /rev_(conflict|required)/.test(String(error.message || ''));
}

/** A write whose answer was lost. Evidence is the server's own record of who
 *  wrote last, never a timestamp.
 *    confirmed  the row's last_write_id is ours: our write is the latest one
 *    refused    the revision moved without us: ours is stale and can never land
 *    unknown    nothing has changed: ours may still be in flight; retry it as is */
export function classifyOutcome({ row, ourWriteId, baseRev }) {
    if (!row) return 'unknown';
    if (row.last_write_id && row.last_write_id === ourWriteId) return 'confirmed';
    if (typeof row.rev === 'number' && row.rev !== baseRev) return 'refused';
    return 'unknown';
}

/* ── Recovery ─────────────────────────────────────────────────────────────── */

const num = (v) => (Number.isFinite(v) ? v : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const settingsOf = (s) => JSON.stringify([s.primaryGoal || '', s.schedule || null, s.difficulty || '']);

/** The settings snapshot a tab keeps as its base. */
export function settingsFingerprint(s) { return settingsOf(s || {}); }

function mergePasses(server, local, base, cap, weekKeyOf) {
    const protectedDates = [...new Set([...(server.passProtectedDates || []), ...(local.passProtectedDates || [])])]
        .sort().slice(-PASS_DATES_KEPT);
    const later = (a, b) => ((a || '') >= (b || '') ? (a || '') : (b || ''));
    const lastPassEarnedDate = later(server.lastPassEarnedDate, local.lastPassEarnedDate);
    const sameAsServer = (local.streakPasses || 0) === (server.streakPasses || 0)
        && (local.lastPassEarnedDate || '') === (server.lastPassEarnedDate || '')
        && JSON.stringify(local.passProtectedDates || []) === JSON.stringify(server.passProtectedDates || []);
    if (base && base.passes) {
        const baseDates = new Set(base.passes.protectedDates || []);
        const serverDates = new Set(server.passProtectedDates || []);
        // Spends this tab made that the server does not already know about.
        const spent = (local.passProtectedDates || []).filter(d => !baseDates.has(d) && !serverDates.has(d)).length;
        // An earn this tab made, unless the server already paid out that week.
        const localEarned = !!local.lastPassEarnedDate && local.lastPassEarnedDate !== base.passes.lastPassEarnedDate;
        const earned = localEarned
            && weekKeyOf(local.lastPassEarnedDate) !== weekKeyOf(server.lastPassEarnedDate || '') ? 1 : 0;
        return { streakPasses: clamp(num(server.streakPasses) + earned - spent, 0, cap),
                 passProtectedDates: protectedDates, lastPassEarnedDate, ambiguous: false };
    }
    /* No base, so the tab's changes cannot be isolated. Never lose a pass the
       member earned: keep the higher count (capped), and say it was a judgement. */
    return { streakPasses: clamp(Math.max(num(server.streakPasses), num(local.streakPasses)), 0, cap),
             passProtectedDates: protectedDates, lastPassEarnedDate, ambiguous: !sameAsServer };
}

/**
 * @param server   internal-shape state from the server row
 * @param local    the stale side's internal-shape state
 * @param opts.pending       journal items { entry, measurement } not yet confirmed
 * @param opts.base          { settings, passes } as last synced, or null
 * @param opts.passCap       Recovery Pass cap
 * @param opts.weekKeyOf     ISO date string -> week key ('' for '')
 * @param opts.dayOfWeek     ISO date string -> 0..6
 * @param opts.currentWeekKey this week's key
 * @param opts.authoritative member's completion comes from the log, not completedDays
 * @param opts.trim          (array, budget) -> array, the app's trimToByteBudget
 * @param opts.logBudget / opts.measurementsBudget
 * @returns { state, replayed, held, settings, passesAmbiguous }
 */
export function mergeRecovery(server, local, opts) {
    const o = opts || {};
    const trim = o.trim || ((a) => a);
    const serverLog = Array.isArray(server.sessionLog) ? server.sessionLog : [];
    const meta = normaliseMeta(server.syncMeta);
    const ctx = { serverKeys: new Set(serverLog.map(entryKey)), tombstones: new Set(meta.trimmed),
                  meta, serverLog, logBudget: o.logBudget };

    // Every completed session the stale side holds, once, by identity.
    const localMeasure = new Map((local.measurements || []).map(m => [measurementKey(m), m]));
    const candidates = new Map();
    for (const p of o.pending || []) {
        if (p && p.entry && p.entry.date) candidates.set(entryKey(p.entry), { entry: p.entry, measurement: p.measurement || null });
    }
    for (const e of local.sessionLog || []) {
        if (!e || !e.date) continue;
        const k = entryKey(e);
        if (!candidates.has(k)) candidates.set(k, { entry: e, measurement: localMeasure.get(measurementKey(e)) || null });
    }

    const fresh = [], held = [];
    for (const [k, c] of candidates) {
        const verdict = classifyEntry(c.entry, ctx);
        if (verdict === 'new') fresh.push(c);
        else if (verdict === 'held') held.push(k);
    }

    // Merge, then trim exactly as a session finish does, remembering what was dropped.
    const merged = [...serverLog, ...fresh.map(f => f.entry)].sort(byDate);
    const sessionLog = trim(merged, o.logBudget);
    const syncMeta = recordTrim(server.syncMeta, merged, sessionLog);

    const known = new Set((server.measurements || []).map(measurementKey));
    const extra = fresh.map(f => f.measurement).filter(m => m && !known.has(measurementKey(m)));
    const measurements = extra.length
        ? trim([...(server.measurements || []), ...extra], o.measurementsBudget)
        : (server.measurements || []);

    // completedDays: legacy-model members only; a replayed session ticks its own weekday this week.
    let completedDays = server.completedDays;
    if (!o.authoritative && fresh.length && Array.isArray(completedDays)) {
        completedDays = completedDays.slice();
        for (const f of fresh) {
            if (f.entry.workKind === 'dailyPractice') continue;
            if (o.weekKeyOf && o.weekKeyOf(f.entry.date) === o.currentWeekKey) completedDays[o.dayOfWeek(f.entry.date)] = true;
        }
    }

    const sr = server.records || {}, lr = local.records || {};
    const records = { ...sr,
        longestStreak: Math.max(num(sr.longestStreak), num(lr.longestStreak)),
        bestWeekXp: Math.max(num(sr.bestWeekXp), num(lr.bestWeekXp)),
        bestSessionXp: Math.max(num(sr.bestSessionXp), num(lr.bestSessionXp)) };

    const passes = mergePasses(server, local, o.base, o.passCap, o.weekKeyOf || (() => ''));

    const localS = settingsOf(local), serverS = settingsOf(server);
    const baseS = o.base && o.base.settings;
    const settings = {
        changedElsewhere: localS !== serverS,
        // A member's own edit that the server's newer settings overrode. Only
        // claimable when we know what the tab started from.
        droppedLocalEdit: !!baseS && localS !== baseS && localS !== serverS,
        // Different, but nothing says who changed it. Never claimed as "your edit";
        // the caller can still ask the member to check.
        unverifiable: !baseS && localS !== serverS,
    };

    const state = { ...server, sessionLog, measurements, completedDays, syncMeta, records,
        totalXp: num(server.totalXp) + fresh.reduce((s, f) => s + num(f.entry.xpEarned), 0),
        allTimeSessionCount: num(server.allTimeSessionCount) + fresh.length,
        streakPasses: passes.streakPasses, passProtectedDates: passes.passProtectedDates,
        lastPassEarnedDate: passes.lastPassEarnedDate };

    return { state, replayed: fresh.map(f => entryKey(f.entry)), held, settings, passesAmbiguous: passes.ambiguous };
}
