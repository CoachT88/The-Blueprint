import { describe, test, expect } from 'vitest';
import {
    entryKey, normaliseMeta, recordTrim, classifyEntry, mergeRecovery,
    classifyOutcome, isRevisionRefusal, settingsFingerprint, TOMBSTONE_CAP,
} from '../src/syncRecovery.js';

/* The app's own trimToByteBudget (app/index.html), copied verbatim: the module
   takes it as a parameter, and the tests must trim the way the app trims. */
function trim(arr, budget) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    let out = arr;
    while (out.length > 1 && JSON.stringify(out).length > budget) {
        const drop = out.length > 200 ? Math.ceil(out.length * 0.1) : 1;
        out = out.slice(drop);
    }
    return out;
}
const day = (n) => new Date(Date.UTC(2026, 0, 1 + n, 9)).toISOString();
const mk = (i, extra = {}) => ({ sid: 's' + i, date: day(i), routineType: 'stamina', xpEarned: 40, ...extra });
const wk = (iso) => (iso ? iso.slice(0, 7) + '-w' + Math.floor(Number(iso.slice(8, 10)) / 7) : '');
const BASE_OPTS = { passCap: 3, weekKeyOf: wk, dayOfWeek: (iso) => new Date(iso).getUTCDay(),
    currentWeekKey: wk(day(40)), authoritative: false, trim, logBudget: 100_000, measurementsBudget: 100_000 };
const server0 = (over = {}) => ({
    sessionLog: [], measurements: [], totalXp: 0, allTimeSessionCount: 0, completedDays: [false, false, false, false, false, false, false],
    records: { longestStreak: 0, bestWeekXp: 0, bestSessionXp: 0 }, streakPasses: 0, passProtectedDates: [],
    lastPassEarnedDate: '', primaryGoal: 'eq', schedule: ['rest'], difficulty: 'beginner', syncMeta: null, ...over });
const merge = (server, local, extra = {}) => mergeRecovery(server, local, { ...BASE_OPTS, ...extra });

describe('identity', () => {
    test('a stable id wins; a legacy entry falls back to date and routine; the two never collide', () => {
        expect(entryKey({ sid: 'x', date: 'd', routineType: 'eq' })).toBe('s:x');
        expect(entryKey({ date: 'd', routineType: 'eq' })).toBe('d:d|eq');
        expect(entryKey({ sid: 'd:d|eq' })).not.toBe(entryKey({ date: 'd', routineType: 'eq' }));
    });
    test('two sessions in the same millisecond are different sessions when their ids differ', () => {
        const a = mk(5, { sid: 'a' }), b = mk(5, { sid: 'b' });
        const r = merge(server0(), server0({ sessionLog: [a, b] }));
        expect(r.replayed.sort()).toEqual(['s:a', 's:b']);
        expect(r.state.totalXp).toBe(80);
    });
});

describe('replay is additive and idempotent', () => {
    test('a session the server lacks is added once: history, XP and count', () => {
        const server = server0({ sessionLog: [mk(1)], totalXp: 40, allTimeSessionCount: 1 });
        const local = server0({ sessionLog: [mk(1), mk(2)] });
        const r = merge(server, local);
        expect(r.state.sessionLog.map(e => e.sid)).toEqual(['s1', 's2']);
        expect(r.state.totalXp).toBe(80);
        expect(r.state.allTimeSessionCount).toBe(2);
    });
    test('running recovery again on its own result changes nothing', () => {
        const server = server0({ sessionLog: [mk(1)], totalXp: 40, allTimeSessionCount: 1 });
        const local = server0({ sessionLog: [mk(1), mk(2)] });
        const once = merge(server, local);
        const twice = merge(once.state, local);
        expect(twice.replayed).toEqual([]);
        expect(twice.state).toEqual(once.state);
    });
    test('the journal and the snapshot both holding a session count it once', () => {
        const e = mk(2);
        const r = merge(server0(), server0({ sessionLog: [e] }), { pending: [{ entry: { ...e } }, { entry: e }] });
        expect([r.state.sessionLog.length, r.state.totalXp, r.state.allTimeSessionCount]).toEqual([1, 40, 1]);
    });
    test('if our write had in fact landed, nothing is awarded again', () => {
        const e = mk(2);
        const r = merge(server0({ sessionLog: [e], totalXp: 40, allTimeSessionCount: 1 }), server0({ sessionLog: [e] }), { pending: [{ entry: e }] });
        expect(r.replayed).toEqual([]);
        expect(r.state.totalXp).toBe(40);
    });
    test("a replayed session's measurement comes with it, once", () => {
        const e = mk(2), m = { sid: 's2', date: e.date, bpel: 6.2 };
        const r1 = merge(server0(), server0({ sessionLog: [e], measurements: [m] }));
        expect(r1.state.measurements).toEqual([m]);
        expect(merge(r1.state, server0({ sessionLog: [e], measurements: [m] })).state.measurements).toEqual([m]);
    });
    test('a legacy member gets the replayed session ticked on its own weekday, this week only', () => {
        const e = mk(40);                                   // in the current week
        const old = mk(10);                                 // some other week
        const r = merge(server0(), server0({ sessionLog: [e, old] }), { authoritative: false });
        const tick = new Date(e.date).getUTCDay();
        expect(r.state.completedDays[tick]).toBe(true);
        expect(r.state.completedDays.filter(Boolean).length).toBe(1);
        expect(merge(server0(), server0({ sessionLog: [e] }), { authoritative: true }).state.completedDays.some(Boolean)).toBe(false);
    });
});

describe('trimming cannot cause a second award', () => {
    // A tiny budget so trimming happens in a handful of sessions.
    const BUDGET = 1500;
    function grow(n) {
        let log = [], meta = null, xp = 0;
        for (let i = 1; i <= n; i++) {
            const next = trim([...log, mk(i)], BUDGET);
            meta = recordTrim(meta, [...log, mk(i)], next);
            log = next; xp += 40;
        }
        return { log, meta, xp };
    }
    test('a session saved and then trimmed away is NOT awarded again when a stale tab replays it', () => {
        const { log, meta, xp } = grow(40);
        expect(log.some(e => e.sid === 's1')).toBe(false);          // s1 really was trimmed
        const server = server0({ sessionLog: log, syncMeta: meta, totalXp: xp, allTimeSessionCount: 40 });
        const stale = server0({ sessionLog: [mk(1), mk(2), mk(3)] });   // the stale tab still holds them
        const r = merge(server, stale, { pending: [{ entry: mk(1) }], logBudget: BUDGET });
        expect(r.replayed).toEqual([]);
        expect(r.held).toEqual([]);          // recognised as applied, not reported as a mystery
        expect(r.state.totalXp).toBe(xp);
        expect(r.state.allTimeSessionCount).toBe(40);
    });
    test('a genuinely new session beside trimmed ones is still awarded exactly once', () => {
        const { log, meta, xp } = grow(40);
        const server = server0({ sessionLog: log, syncMeta: meta, totalXp: xp, allTimeSessionCount: 40 });
        const r = merge(server, server0({ sessionLog: [mk(1), mk(41)] }), { logBudget: BUDGET });
        expect(r.replayed).toEqual(['s:s41']);
        expect(r.state.totalXp).toBe(xp + 40);
    });
    test('the memory is bounded: keys are capped and the floor is a single date', () => {
        const { meta } = grow(600);
        expect(meta.trimmed.length).toBeLessThanOrEqual(TOMBSTONE_CAP);
        expect(typeof meta.floor).toBe('string');
        expect(JSON.stringify(meta).length).toBeLessThan(TOMBSTONE_CAP * 40);
    });
    test('beyond the capped keys the floor still refuses to re-award, and says so (held)', () => {
        const { log, meta, xp } = grow(600);
        expect(meta.trimmed).not.toContain('s:s1');                  // evicted from the keys
        const server = server0({ sessionLog: log, syncMeta: meta, totalXp: xp, allTimeSessionCount: 600 });
        const r = merge(server, server0({ sessionLog: [mk(1)] }), { logBudget: BUDGET });
        expect(r.replayed).toEqual([]);
        expect(r.held).toEqual(['s:s1']);
        expect(r.state.totalXp).toBe(xp);
    });
    test('recovery trims exactly as a finish does, and remembers what it dropped', () => {
        const { log, meta, xp } = grow(40);
        const server = server0({ sessionLog: log, syncMeta: meta, totalXp: xp, allTimeSessionCount: 40 });
        const r = merge(server, server0({ sessionLog: [mk(41)] }), { logBudget: BUDGET });
        expect(JSON.stringify(r.state.sessionLog).length).toBeLessThanOrEqual(BUDGET);
        // The entry trimmed by THIS merge is now remembered, so replaying it again awards nothing.
        const dropped = log.find(e => !r.state.sessionLog.some(x => x.sid === e.sid));
        const again = merge(r.state, server0({ sessionLog: [dropped] }), { logBudget: BUDGET });
        expect(again.replayed).toEqual([]);
    });
    test('a row from before trimming was recorded: a small log cannot have been trimmed, so an old session is awarded', () => {
        const server = server0({ sessionLog: [mk(5)], totalXp: 40, allTimeSessionCount: 1 });
        const r = merge(server, server0({ sessionLog: [mk(2)] }));
        expect(r.replayed).toEqual(['s:s2']);
    });
    test('a row from before trimming was recorded: a log near its budget makes an old session ambiguous, not awardable', () => {
        const big = Array.from({ length: 30 }, (_, i) => mk(10 + i));
        const server = server0({ sessionLog: big, totalXp: 1200, allTimeSessionCount: 30 });
        const budget = JSON.stringify(big).length;                   // exactly full
        const r = merge(server, server0({ sessionLog: [mk(2)] }), { logBudget: budget });
        expect(r.replayed).toEqual([]);
        expect(r.held).toEqual(['s:s2']);
    });
    test('classifyEntry: applied beats held, and a tombstone beats the floor', () => {
        const ctx = { serverKeys: new Set(), tombstones: new Set(['s:s1']), meta: { trimmed: ['s:s1'], floor: day(50) }, serverLog: [] };
        expect(classifyEntry(mk(1), ctx)).toBe('applied');
        expect(classifyEntry(mk(2), ctx)).toBe('held');
        expect(classifyEntry(mk(60), ctx)).toBe('new');
    });
});

describe('personal records are never lowered', () => {
    test('each record keeps the larger of the two', () => {
        const server = server0({ records: { longestStreak: 4, bestWeekXp: 90, bestSessionXp: 60 } });
        const local = server0({ records: { longestStreak: 2, bestWeekXp: 200, bestSessionXp: 40 } });
        expect(merge(server, local).state.records).toEqual({ longestStreak: 4, bestWeekXp: 200, bestSessionXp: 60 });
    });
    test('a record earned only on the stale side survives', () => {
        const r = merge(server0(), server0({ records: { longestStreak: 0, bestWeekXp: 0, bestSessionXp: 75 } }));
        expect(r.state.records.bestSessionXp).toBe(75);
    });
});

describe('Recovery Passes', () => {
    const base = (over = {}) => ({ settings: 'x', passes: { protectedDates: [], lastPassEarnedDate: '', ...over } });
    test('a pass earned only on the stale tab is kept', () => {
        const server = server0({ streakPasses: 1, lastPassEarnedDate: day(20) });
        const local = server0({ streakPasses: 1, lastPassEarnedDate: day(40) });
        const r = merge(server, local, { base: base({ lastPassEarnedDate: day(20) }) });
        expect(r.state.streakPasses).toBe(2);
        expect(r.passesAmbiguous).toBe(false);
    });
    test('the same week paid out on both sides is one pass, not two', () => {
        const server = server0({ streakPasses: 1, lastPassEarnedDate: day(40) });
        const local = server0({ streakPasses: 1, lastPassEarnedDate: day(41) });
        expect(merge(server, local, { base: base() }).state.streakPasses).toBe(1);
    });
    test('a pass spent on the stale tab is spent once, and the date is protected', () => {
        const server = server0({ streakPasses: 2 });
        const local = server0({ streakPasses: 1, passProtectedDates: [day(39).slice(0, 10)] });
        const r = merge(server, local, { base: base() });
        expect(r.state.streakPasses).toBe(1);
        expect(r.state.passProtectedDates).toEqual([day(39).slice(0, 10)]);
    });
    test('the same pass spent on both sides for the same day is not charged twice', () => {
        const d = day(39).slice(0, 10);
        const server = server0({ streakPasses: 1, passProtectedDates: [d] });
        const local = server0({ streakPasses: 1, passProtectedDates: [d] });
        expect(merge(server, local, { base: base() }).state.streakPasses).toBe(1);
    });
    test('never above the cap, never below zero', () => {
        const server = server0({ streakPasses: 3 });
        expect(merge(server, server0({ streakPasses: 3, lastPassEarnedDate: day(40) }), { base: base() }).state.streakPasses).toBe(3);
        const s0 = server0({ streakPasses: 0 });
        expect(merge(s0, server0({ passProtectedDates: [day(1).slice(0, 10)] }), { base: base() }).state.streakPasses).toBe(0);
    });
    test('an untouched tab leaves the server count alone', () => {
        const server = server0({ streakPasses: 2, lastPassEarnedDate: day(30) });
        const r = merge(server, server0({ streakPasses: 0 }), { base: base({ lastPassEarnedDate: day(30) }) });
        expect(r.state.streakPasses).toBe(2);
    });
    test('with no base the higher count is kept, and the judgement is reported', () => {
        const r = merge(server0({ streakPasses: 1 }), server0({ streakPasses: 2 }), { base: null });
        expect(r.state.streakPasses).toBe(2);
        expect(r.passesAmbiguous).toBe(true);
        expect(merge(server0({ streakPasses: 1 }), server0({ streakPasses: 1 }), { base: null }).passesAmbiguous).toBe(false);
    });
});

describe('settings: each one decided from three views (last synced, this tab, server)', () => {
    const fp = (s) => settingsFingerprint(s);
    const noPasses = { protectedDates: [], lastPassEarnedDate: '' };
    const base = (s) => ({ settings: fp(s), passes: noPasses });
    const B = server0({ primaryGoal: 'eq', schedule: ['rest', 'stamina'], difficulty: 'beginner' });
    const mix = (over) => server0({ primaryGoal: 'eq', schedule: ['rest', 'stamina'], difficulty: 'beginner', ...over });

    test('only the member changed it: the edit is kept, for each setting on its own', () => {
        for (const [field, value, name] of [['primaryGoal', 'size', 'goal'], ['schedule', ['stamina', 'rest'], 'schedule'], ['difficulty', 'advanced', 'difficulty']]) {
            const r = merge(mix({}), mix({ [field]: value }), { base: base(B) });
            expect(r.state[field]).toEqual(value);
            expect(r.settings.kept).toEqual([name]);
            expect(r.settings.dropped).toEqual([]);
            expect(r.settings.droppedLocalEdit).toBe(false);
        }
    });
    test('only the server changed it: the server value stands and nothing is reported', () => {
        const r = merge(mix({ primaryGoal: 'all', difficulty: 'advanced' }), mix({}), { base: base(B) });
        expect([r.state.primaryGoal, r.state.difficulty]).toEqual(['all', 'advanced']);
        expect([r.settings.kept, r.settings.dropped, r.settings.unverifiable]).toEqual([[], [], false]);
    });
    test('both changed it differently: the server value wins and the member is told which one', () => {
        const r = merge(mix({ primaryGoal: 'all' }), mix({ primaryGoal: 'size' }), { base: base(B) });
        expect(r.state.primaryGoal).toBe('all');
        expect(r.settings.dropped).toEqual(['goal']);
        expect(r.settings.droppedLocalEdit).toBe(true);
        expect(r.settings.kept).toEqual([]);
    });
    test('both made the same change: they agree, so there is nothing to report', () => {
        const r = merge(mix({ primaryGoal: 'size' }), mix({ primaryGoal: 'size' }), { base: base(B) });
        expect([r.settings.dropped, r.settings.kept, r.settings.unverifiable, r.state.primaryGoal]).toEqual([[], [], false, 'size']);
    });
    test('the three are independent: one kept, one the server\'s, one overridden, in a single recovery', () => {
        const server = mix({ primaryGoal: 'all', schedule: ['stamina', 'stamina'] });      // server changed goal and schedule
        const local = mix({ primaryGoal: 'size', difficulty: 'advanced' });               // tab changed goal and difficulty
        const r = merge(server, local, { base: base(B) });
        expect(r.state.primaryGoal).toBe('all');                    // both changed: server wins
        expect(r.state.schedule).toEqual(['stamina', 'stamina']);   // only the server changed
        expect(r.state.difficulty).toBe('advanced');                // only the tab changed: kept
        expect(r.settings.dropped).toEqual(['goal']);
        expect(r.settings.kept).toEqual(['difficulty']);
    });
    test('a kept goal brings its own plan with it, never the other side\'s', () => {
        const serverPlan = { key: 'server-plan' }, localPlan = { key: 'local-plan' };
        const r = merge(mix({ programme: serverPlan, dayPlans: [{ d: 'server' }] }),
                        mix({ primaryGoal: 'size', programme: localPlan, dayPlans: [{ d: 'local' }] }), { base: base(B) });
        expect([r.state.programme, r.state.dayPlans]).toEqual([localPlan, [{ d: 'local' }]]);
        // And when the goal is NOT kept, the server's plan stands.
        const r2 = merge(mix({ primaryGoal: 'all', programme: serverPlan, dayPlans: [{ d: 'server' }] }),
                         mix({ primaryGoal: 'size', programme: localPlan, dayPlans: [{ d: 'local' }] }), { base: base(B) });
        expect([r2.state.programme, r2.state.dayPlans]).toEqual([serverPlan, [{ d: 'server' }]]);
    });
    test('a kept difficulty keeps the tier unlocks it needs, without losing the server\'s', () => {
        const r = merge(mix({ diffUnlockedDate: { intermediate: '2026-01-01', advanced: '', elite: '' } }),
                        mix({ difficulty: 'advanced', diffUnlockedDate: { intermediate: '', advanced: '2026-02-02', elite: '' } }), { base: base(B) });
        expect(r.state.difficulty).toBe('advanced');
        expect(r.state.diffUnlockedDate).toEqual({ intermediate: '2026-01-01', advanced: '2026-02-02', elite: '' });
    });
    test('a setting changed on only one side never touches the other two', () => {
        const r = merge(mix({ difficulty: 'elite' }), mix({ primaryGoal: 'size' }), { base: base(B) });
        expect([r.state.primaryGoal, r.state.schedule, r.state.difficulty]).toEqual(['size', ['rest', 'stamina'], 'elite']);
        expect([r.settings.kept, r.settings.dropped]).toEqual([['goal'], []]);
    });
    test('with no base nothing is kept or dropped: the server stands and the member is only asked to check', () => {
        const r = merge(mix({ primaryGoal: 'all' }), mix({ primaryGoal: 'size' }), { base: null });
        expect(r.state.primaryGoal).toBe('all');
        expect(r.settings).toMatchObject({ changedElsewhere: true, droppedLocalEdit: false, dropped: [], kept: [], unverifiable: true });
    });
    test('an unreadable base is treated as no base', () => {
        const r = merge(mix({ primaryGoal: 'all' }), mix({ primaryGoal: 'size' }), { base: { settings: 'not json', passes: noPasses } });
        expect(r.settings.unverifiable).toBe(true);
        expect(r.state.primaryGoal).toBe('all');
    });
    test('recovery of sessions is unaffected by what happens to settings', () => {
        const server = mix({ primaryGoal: 'all', sessionLog: [mk(1)], totalXp: 40, allTimeSessionCount: 1 });
        const local = mix({ primaryGoal: 'size', difficulty: 'advanced', sessionLog: [mk(1), mk(2)] });
        const r = merge(server, local, { base: base(B) });
        expect(r.replayed).toEqual(['s:s2']);
        expect([r.state.totalXp, r.state.allTimeSessionCount]).toEqual([80, 2]);
    });
});

describe('a write whose answer was lost', () => {
    test('confirmed only by our own write id, never by a timestamp', () => {
        expect(classifyOutcome({ row: { last_write_id: 'w1', rev: 4 }, ourWriteId: 'w1', baseRev: 3 })).toBe('confirmed');
        expect(classifyOutcome({ row: { last_write_id: 'w2', rev: 4, updated_at: 'same' }, ourWriteId: 'w1', baseRev: 3 })).toBe('refused');
    });
    test('the revision moving without us means ours can never land', () => {
        expect(classifyOutcome({ row: { last_write_id: null, rev: 9 }, ourWriteId: 'w1', baseRev: 3 })).toBe('refused');
    });
    test('nothing changed means unknown: retry the same write', () => {
        expect(classifyOutcome({ row: { last_write_id: 'older', rev: 3 }, ourWriteId: 'w1', baseRev: 3 })).toBe('unknown');
        expect(classifyOutcome({ row: null, ourWriteId: 'w1', baseRev: 3 })).toBe('unknown');
    });
    test('a legacy write after ours clears the id, so we are not falsely confirmed', () => {
        expect(classifyOutcome({ row: { last_write_id: null, rev: 5 }, ourWriteId: 'w1', baseRev: 3 })).toBe('refused');
    });
    test('refusals are recognised by code, status or message', () => {
        expect(isRevisionRefusal({ code: 'PT409' })).toBe(true);
        expect(isRevisionRefusal({ status: 409 })).toBe(true);
        expect(isRevisionRefusal({ message: 'rev_conflict' })).toBe(true);
        expect(isRevisionRefusal({ message: 'rev_required' })).toBe(true);
        expect(isRevisionRefusal({ code: '503', message: 'down' })).toBe(false);
        expect(isRevisionRefusal(null)).toBe(false);
    });
});

describe('meta hygiene', () => {
    test('unreadable meta normalises to empty rather than throwing', () => {
        expect(normaliseMeta(null)).toEqual({ trimmed: [], floor: '' });
        expect(normaliseMeta({ trimmed: [1, 'a'], floor: 5 })).toEqual({ trimmed: ['a'], floor: '' });
    });
    test('recordTrim with nothing dropped returns the meta unchanged', () => {
        const m = { trimmed: ['s:a'], floor: 'x' };
        expect(recordTrim(m, [mk(1)], [mk(1)])).toEqual(m);
    });
});
