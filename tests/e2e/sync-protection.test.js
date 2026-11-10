import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Stale-write protection, from the member's side.
 *
 * The Supabase stub models supabase/revision-guard.sql (which tests/sql/ proves
 * against real PostgreSQL): a write that names a stale base_rev is refused, a
 * write that names none is accepted in SOFT mode and refused in HARD mode. The
 * app is driven through its real load, write, journal and recovery paths.
 *
 * What these protect: a member's completed sessions are never lost and never
 * awarded twice, earned records and Recovery Passes survive, and a settings
 * edit that was overridden is reported as not saved rather than as saved.
 */
describe('stale-write protection', () => {
    let app, wk, n = 0;
    const A = { sid: 'sA', date: '2026-01-05T09:00:00.000Z', routineType: 'stamina', xpEarned: 40 };
    const B = { sid: 'sB', date: '2026-01-06T09:00:00.000Z', routineType: 'stamina', xpEarned: 25 };
    const C = { sid: 'sC', date: '2026-01-07T09:00:00.000Z', routineType: 'stamina', xpEarned: 30 };

    beforeAll(async () => {
        app = await openApp();
        wk = await app.page.evaluate(() => getCurrentWeekKey());
    }, 60_000);
    afterAll(async () => { await app?.close(); });
    afterEach(async () => { await app.page.evaluate(() => { WRITE_DEADLINE_MS = 10000; window.__revMode = null; }); });

    const baseRow = (over = {}) => ({
        schedule: ['rest', 'stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest'],
        completed_days: [false, false, false, false, false, false, false], total_xp: 0,
        session_log: [], measurements: [], seen_milestones: [], difficulty: 'beginner',
        diff_unlocked_date: { intermediate: '', advanced: '', elite: '' }, first_session_date: '',
        week_key: wk, records: { longestStreak: 0, bestWeekXp: 0, bestSessionXp: 0 }, tip_index: 0,
        last_tip_date: new Date().toISOString().split('T')[0], all_time_session_count: 0, xp_migrated: true,
        streak_passes: 0, pass_protected_dates: [], last_pass_earned_date: '', primary_goal: 'eq',
        pelvic_profile: '', programme_start_date: null, progression_ledger: [], pelvic_screen_date: '',
        programme: null, day_plans: [], updated_at: '2026-01-01T00:00:00.000Z', ...over,
    });

    /** Seed a server row and load it the way production does. */
    async function load(over = {}, { mode = 'soft', rev = 5, backup = null, journal = [] } = {}) {
        const uid = 'sp' + (++n);
        const row = baseRow({ id: uid, ...over });
        if (rev !== null) Object.assign(row, { rev, base_rev: null, last_write_id: null, sync_meta: over.sync_meta ?? null });
        await app.page.evaluate(({ uid, row, mode, backup, journal }) => {
            localStorage.clear(); _syncNotice = null; _journalMem.clear();
            window.__row = row; window.__revMode = mode; window.__writes = []; window.__attempts = [];
            window.__hangUpsert = window.__hangUpsertOnce = window.__hangUpsertCommits = false;
            if (backup) {
                localStorage.setItem('bp_data_' + uid, JSON.stringify({ ...DEFAULT_PERSISTED, ...backup.state,
                    _savedAt: '2099-01-01T00:00:00.000Z',
                    ...(backup.baseRev !== undefined ? { _baseRev: backup.baseRev } : {}),
                    ...(backup.syncBase ? { _syncBase: backup.syncBase } : {}) }));
                localStorage.setItem('bp_dirty_' + uid, '1');
            }
            for (const j of journal) localStorage.setItem('bp_pending_' + uid + '_' + j.entry.sid, JSON.stringify({ v: 1, ...j }));
        }, { uid, row, mode, backup, journal });
        await signIn(app.page, { id: uid, loaded: false });
        await app.page.evaluate(() => loadPersisted());
        await app.page.evaluate(() => { window.__writes = []; window.__attempts = []; });
        return uid;
    }
    const row = () => app.page.evaluate(() => window.__row);
    const commit = () => app.page.evaluate(() => _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq));

    /* ── Legacy tables are untouched ─────────────────────────────────────── */

    test('a table without the migration is written exactly as before', async () => {
        await load({}, { rev: null, mode: null });
        const r = await app.page.evaluate(async () => {
            const protectedMode = _protectedFor(currentUser.id);
            persisted.totalXp = 7; savePersisted();
            await _flushSaveNow();
            return { protectedMode, w: window.__writes.map(w => Object.keys(w)) };
        });
        expect(r.protectedMode).toBe(false);
        expect(r.w.length).toBeGreaterThan(0);
        for (const keys of r.w) {
            expect(keys).not.toContain('base_rev');
            expect(keys).not.toContain('last_write_id');
            expect(keys).not.toContain('sync_meta');
            expect(keys).not.toContain('_sync_meta');
        }
    });

    /* ── The guarded writer ──────────────────────────────────────────────── */

    test('each write names the revision it read and a write id of its own, and the next one uses the new revision', async () => {
        await load();
        const r = await app.page.evaluate(async () => {
            persisted.totalXp = 10; const first = await _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq);
            persisted.totalXp = 20; const second = await _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq);
            return { first, second, w: window.__writes.map(w => ({ base: w.base_rev, id: w.last_write_id, hasMeta: 'sync_meta' in w })) };
        });
        expect([r.first, r.second]).toEqual(['ok', 'ok']);
        expect(r.w.map(x => x.base)).toEqual([5, 6]);
        expect(r.w[0].id).toBeTruthy();
        expect(r.w[0].id).not.toBe(r.w[1].id);
        expect(r.w.every(x => x.hasMeta)).toBe(true);
        expect((await row()).rev).toBe(7);
    });

    test('two saves fired together are sent in order and never refuse each other', async () => {
        await load();
        const r = await app.page.evaluate(async () => {
            const uid = currentUser.id;
            persisted.totalXp = 1; const p1 = _commitWrite(uid, { id: uid, ..._buildSavePayload() }, ++_changeSeq);
            persisted.totalXp = 2; const p2 = _commitWrite(uid, { id: uid, ..._buildSavePayload() }, ++_changeSeq);
            return { out: await Promise.all([p1, p2]), bases: window.__writes.map(w => w.base_rev), notice: _syncNotice };
        });
        expect(r.out).toEqual(['ok', 'ok']);
        expect(r.bases).toEqual([5, 6]);
        expect(r.notice).toBe(null);
        expect((await row()).total_xp).toBe(2);
    });

    test('an idle tab that is out of date writes nothing when it is backgrounded', async () => {
        await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 });
        const r = await app.page.evaluate(async () => {
            // Another device moves the row on.
            window.__applyRevGuard({ base_rev: 5, last_write_id: 'dev2', total_xp: 999, session_log: [] });
            const unsaved = _unsaved;
            await _flushSaveNow();                     // the hidden-tab flush
            return { unsaved, writes: window.__writes.length };
        });
        expect(r.unsaved).toBe(false);
        expect(r.writes).toBe(0);
        expect((await row()).total_xp).toBe(999);       // the other device's progress stands
    });

    test('a tab with something unsaved does flush when backgrounded', async () => {
        await load();
        const r = await app.page.evaluate(async () => { persisted.totalXp = 5; savePersisted(); await _flushSaveNow(); return window.__writes.length; });
        expect(r).toBe(1);
        expect((await row()).total_xp).toBe(5);
    });

    /* ── Two tabs: the core guarantee ────────────────────────────────────── */

    test('an out-of-date tab finishing a session loses nothing and awards nothing twice', async () => {
        const uid = await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 });
        const out = await app.page.evaluate(async ({ B, C }) => {
            // Another device finishes B, earns a record and a pass, and changes the goal.
            window.__applyRevGuard({ base_rev: 5, last_write_id: 'dev2', session_log: [window.__row.session_log[0], B],
                total_xp: 65, all_time_session_count: 2, primary_goal: 'all',
                records: { longestStreak: 0, bestWeekXp: 0, bestSessionXp: 90 }, streak_passes: 1,
                last_pass_earned_date: new Date().toISOString().split('T')[0] });
            // This (stale) tab: the member edits their goal AND finishes session C.
            persisted.primaryGoal = 'size';
            persisted.sessionLog = [...persisted.sessionLog, C]; persisted.totalXp += C.xpEarned; persisted.allTimeSessionCount += 1;
            _journalWrite(C, null);
            savePersisted();
            const outcome = await _flushSaveNow();
            return { outcome, journal: _journalRead(currentUser.id).length, goal: persisted.primaryGoal,
                     notice: _syncNotice, bannerHidden: document.getElementById('hq-sync-notice-banner').classList.contains('hidden'),
                     bannerText: document.getElementById('hq-sync-notice-text').textContent };
        }, { B, C });
        const r = await row();
        expect(out.outcome).toBe('ok');
        expect(r.session_log.map(e => e.sid)).toEqual(['sA', 'sB', 'sC']);   // nothing lost, nothing doubled
        expect(r.total_xp).toBe(65 + 30);                                      // server's XP + only the new session's
        expect(r.all_time_session_count).toBe(3);
        expect(r.records.bestSessionXp).toBe(90);                              // the other device's record survives
        expect(r.streak_passes).toBe(1);                                       // and its pass
        expect(r.primary_goal).toBe('all');                                    // newer settings are not overwritten
        expect(out.goal).toBe('all');
        expect(r.rev).toBe(7);
        expect(out.journal).toBe(0);                                           // confirmed saved, so settled
        // The overridden edit is reported as NOT saved, never as saved.
        expect(out.notice.settings).toBe(true);
        expect(out.bannerHidden).toBe(false);
        expect(out.bannerText).toMatch(/not saved/i);
        expect(out.bannerText).not.toMatch(/\bwere saved\b|has been saved/i);
        expect(uid).toBeTruthy();
    });

    test('a tab that never edited settings is not told it lost any', async () => {
        await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 });
        const out = await app.page.evaluate(async ({ B, C }) => {
            window.__applyRevGuard({ base_rev: 5, last_write_id: 'dev2', primary_goal: 'all', session_log: [window.__row.session_log[0], B], total_xp: 65, all_time_session_count: 2 });
            persisted.sessionLog = [...persisted.sessionLog, C]; persisted.totalXp += 30; persisted.allTimeSessionCount += 1;
            _journalWrite(C, null); savePersisted(); await _flushSaveNow();
            return _syncNotice;
        }, { B, C });
        expect(out).toBe(null);
    });

    test('replaying the same recovery again changes nothing', async () => {
        await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 });
        const r = await app.page.evaluate(async ({ A, B, C }) => {
            window.__applyRevGuard({ base_rev: 5, last_write_id: 'dev2', session_log: [window.__row.session_log[0], B], total_xp: 65, all_time_session_count: 2 });
            persisted.sessionLog = [...persisted.sessionLog, C]; persisted.totalXp += 30; persisted.allTimeSessionCount += 1;
            _journalWrite(C, null); savePersisted(); await _flushSaveNow();
            const once = JSON.stringify([window.__row.session_log, window.__row.total_xp, window.__row.all_time_session_count]);
            // The same stale snapshot arrives again (a second tab, a reload).
            _journalWrite(C, null);
            const res = _mergeAgainstRow(currentUser.id, window.__row, { ...DEFAULT_PERSISTED, sessionLog: [A, C] }, null);
            return { once, again: JSON.stringify([res.state.sessionLog, res.state.totalXp, res.state.allTimeSessionCount]), replayed: res.replayed };
        }, { A, B, C });
        expect(r.again).toBe(r.once);
        expect(r.replayed).toEqual([]);
    });

    /* ── Trimming ────────────────────────────────────────────────────────── */

    test('a real session finish journals the session, stamps an id, and remembers what it trimmed', async () => {
        const big = Array.from({ length: 330 }, (_, i) => ({ sid: 'old' + i, date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
            routineType: 'stamina', xpEarned: 15, note: 'x'.repeat(900) }));
        const uid = await load({ session_log: big, total_xp: 330 * 15, all_time_session_count: 330 });
        const r = await app.page.evaluate(async () => {
            const before = persisted.sessionLog.length;
            captureLaunchPrescription();
            session.routineType = 'length'; selectedEQ = 8; selectedRPE = 6; _sessionStartTime = Date.now() - 12e5;
            finishSession(); closeSessionSummary();
            const entry = persisted.sessionLog.at(-1);
            const journaled = _journalRead(currentUser.id).map(j => j.entry.sid);
            const meta = JSON.parse(JSON.stringify(persisted.syncMeta));
            const outcome = await _flushSaveNow();
            return { before, after: persisted.sessionLog.length, sid: entry.sid, journaled, meta, outcome,
                     journalAfter: _journalRead(currentUser.id).length };
        });
        expect(typeof r.sid).toBe('string');
        expect(r.journaled).toEqual([r.sid]);
        expect(r.after).toBeLessThanOrEqual(r.before);              // trimmed to the budget
        expect(r.meta.trimmed.length).toBeGreaterThan(0);
        expect(r.meta.trimmed).toContain('s:old0');                 // the oldest drop is remembered
        expect(r.meta.floor >= big[0].date).toBe(true);
        expect(r.outcome).toBe('ok');
        expect(r.journalAfter).toBe(0);                             // settled once the server held it
        const saved = await row();
        expect(saved.sync_meta.trimmed).toContain('s:old0');        // and the memory reaches the server
        expect(uid).toBeTruthy();
    });

    test('a session saved, then trimmed away, is not awarded again when a stale tab replays it', async () => {
        // The server trimmed sA long ago and remembers that it did.
        const uid = await load({ session_log: [B], total_xp: 1000, all_time_session_count: 40,
            sync_meta: { trimmed: ['s:sA'], floor: A.date } }, { journal: [{ entry: A, measurement: null }] });
        const r = await row();
        expect(r.total_xp).toBe(1000);                 // no award
        expect(r.session_log.map(e => e.sid)).toEqual(['sB']);
        expect(r.all_time_session_count).toBe(40);
        expect((await app.page.evaluate(() => _journalRead(currentUser.id).length))).toBe(0);   // settled, not retried forever
        expect((await app.page.evaluate(() => window.__writes.length))).toBe(0);
        expect(uid).toBeTruthy();
    });

    test('a session older than everything trimmed, and unrecognised, is held and reported, not awarded', async () => {
        await load({ session_log: [B], total_xp: 1000, all_time_session_count: 40, sync_meta: { trimmed: [], floor: B.date } },
            { journal: [{ entry: A, measurement: null }] });
        const out = await app.page.evaluate(() => ({ notice: _syncNotice, journal: _journalRead(currentUser.id).length, writes: window.__writes.length }));
        expect((await row()).total_xp).toBe(1000);
        expect(out.notice.held).toBe(1);
        expect(out.journal).toBe(0);                   // held entries are not retried or re-reported
        expect(out.writes).toBe(0);
    });

    /* ── Load: a stale backup is recovered from, never promoted ─────────── */

    test('a dirty backup the server has moved past is recovered from, not adopted over the row', async () => {
        await load({ session_log: [A, B], total_xp: 65, all_time_session_count: 2, primary_goal: 'all' },
            { rev: 8, backup: { baseRev: 5, state: { sessionLog: [A, C], totalXp: 70, allTimeSessionCount: 2, primaryGoal: 'size' } } });
        const r = await row();
        expect(r.session_log.map(e => e.sid)).toEqual(['sA', 'sB', 'sC']);
        expect(r.total_xp).toBe(65 + 30);
        expect(r.primary_goal).toBe('all');
        expect(r.rev).toBe(9);
    });

    test('a backup from before revisions existed is recovered from by identity, and the member is asked to check settings', async () => {
        await load({ session_log: [A, B], total_xp: 65, all_time_session_count: 2, primary_goal: 'all' },
            { rev: 3, backup: { state: { sessionLog: [{ date: C.date, routineType: 'stamina', xpEarned: 30 }], totalXp: 30, allTimeSessionCount: 1, primaryGoal: 'size' } } });
        const r = await row();
        expect(r.total_xp).toBe(65 + 30);
        expect(r.primary_goal).toBe('all');
        const notice = await app.page.evaluate(() => _syncNotice);
        expect(notice.check).toBe(true);                // truthful: "we loaded the latest saved version"
        expect(notice.settings).toBe(false);            // and never claims it knew they edited
    });

    test('a backup taken at the current revision is still adopted, so offline work is not discarded', async () => {
        await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 },
            { rev: 5, backup: { baseRev: 5, state: { sessionLog: [A, C], totalXp: 70, allTimeSessionCount: 2 } } });
        const r = await row();
        expect(r.session_log.map(e => e.sid)).toEqual(['sA', 'sC']);
        expect(r.total_xp).toBe(70);
        expect(r.rev).toBe(6);
    });

    /* ── An answer that never arrives ────────────────────────────────────── */

    test('a write that landed but was never acknowledged is confirmed by its own id, and not sent twice', async () => {
        await load();
        const out = await app.page.evaluate(async () => {
            WRITE_DEADLINE_MS = 200; window.__hangUpsertOnce = true; window.__hangUpsertCommits = true;
            persisted.totalXp = 20; return _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq);
        });
        expect(out).toBe('ok');
        expect(await app.page.evaluate(() => window.__attempts.length)).toBe(1);   // no blind resend
        expect((await row()).rev).toBe(6);
        expect(await app.page.evaluate(() => _syncState[currentUser.id].rev)).toBe(6);
    });

    test('a write that never landed is sent again unchanged, and lands once', async () => {
        await load();
        const out = await app.page.evaluate(async () => {
            WRITE_DEADLINE_MS = 200; window.__hangUpsertOnce = true;                 // lost, NOT committed
            persisted.totalXp = 20; const o = await _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq);
            return { o, a: window.__attempts.map(w => [w.base_rev, w.last_write_id]) };
        });
        expect(out.o).toBe('ok');
        expect(out.a.length).toBe(2);
        expect(out.a[1]).toEqual(out.a[0]);              // same base, same id
        expect((await row()).rev).toBe(6);
    });

    test('while a write is in doubt, someone else landing makes ours stale, and it is recovered rather than assumed', async () => {
        await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 });
        const out = await app.page.evaluate(async ({ B, C }) => {
            WRITE_DEADLINE_MS = 200; window.__hangUpsertOnce = true;                 // ours is lost, not committed
            persisted.sessionLog = [...persisted.sessionLog, C]; persisted.totalXp += 30; persisted.allTimeSessionCount += 1;
            _journalWrite(C, null);
            const p = _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, ++_changeSeq);
            window.__applyRevGuard({ base_rev: 5, last_write_id: 'dev2', session_log: [window.__row.session_log[0], B], total_xp: 65, all_time_session_count: 2 });
            return p;
        }, { B, C });
        const r = await row();
        expect(out).toBe('ok');
        expect(r.session_log.map(e => e.sid)).toEqual(['sA', 'sB', 'sC']);
        expect(r.total_xp).toBe(95);
    });

    test('an unresolved write stays unresolved: the journal and the dirty flag are kept', async () => {
        const uid = await load();
        const out = await app.page.evaluate(async ({ C }) => {
            WRITE_DEADLINE_MS = 150; window.__hangUpsert = true;                     // every attempt is lost
            persisted.sessionLog = [...persisted.sessionLog, C]; persisted.totalXp += 30; persisted.allTimeSessionCount += 1;
            _journalWrite(C, null); savePersisted();
            const o = await _flushSaveNow();
            return { o, journal: _journalRead(currentUser.id).length, dirty: localStorage.getItem('bp_dirty_' + currentUser.id), unsaved: _unsaved };
        }, { C });
        expect(out.o).toBe('unknown');
        expect(out.journal).toBe(1);
        expect(out.dirty).toBe('1');
        expect(out.unsaved).toBe(true);
        expect(uid).toBeTruthy();
    });

    /* ── The journal itself ──────────────────────────────────────────────── */

    test('when the journal cannot be written to storage the session is held in memory and the failure is reported', async () => {
        await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 });
        const out = await app.page.evaluate(async ({ B, C }) => {
            const real = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('bp_pending_')) throw new DOMException('full', 'QuotaExceededError'); return real.call(this, k, v); };
            try { _journalWrite(C, null); } finally { Storage.prototype.setItem = real; }
            const stored = Object.keys(localStorage).filter(k => k.startsWith('bp_pending_')).length;
            const read = _journalRead(currentUser.id).map(j => j.entry.sid);
            // And recovery still finds it.
            window.__applyRevGuard({ base_rev: 5, last_write_id: 'dev2', session_log: [window.__row.session_log[0], B], total_xp: 65, all_time_session_count: 2 });
            persisted.sessionLog = [...persisted.sessionLog, C]; persisted.totalXp += 30; persisted.allTimeSessionCount += 1; savePersisted();
            await _flushSaveNow();
            return { stored, read, buffered: JSON.stringify(_analyticsBuffer).includes('journal_fallback') };
        }, { B, C });
        expect(out.stored).toBe(0);
        expect(out.read).toEqual(['sC']);
        expect(out.buffered).toBe(true);
        expect((await row()).session_log.map(e => e.sid)).toEqual(['sA', 'sB', 'sC']);
    });

    test('tabs cannot overwrite each other\'s pending sessions: each is its own key', async () => {
        const uid = await load();
        const r = await app.page.evaluate(({ B, C }) => {
            _journalWrite(B, null); _journalWrite(C, null);        // as two tabs would
            return Object.keys(localStorage).filter(k => k.startsWith('bp_pending_')).sort();
        }, { B, C });
        expect(r).toEqual([`bp_pending_${uid}_sB`, `bp_pending_${uid}_sC`]);
    });

    /* ── Legacy clients, and soft to hard ────────────────────────────────── */

    test('SOFT: a legacy write lands, but the protected tab notices and recovers its own session', async () => {
        await load({ session_log: [A], total_xp: 40, all_time_session_count: 1 }, { mode: 'soft' });
        const out = await app.page.evaluate(async ({ C }) => {
            // An old client overwrites the row with a stale snapshot, naming no revision.
            const err = window.__applyRevGuard({ session_log: [window.__row.session_log[0]], total_xp: 40 });
            const afterLegacy = { rev: window.__row.rev, id: window.__row.last_write_id };
            persisted.sessionLog = [...persisted.sessionLog, C]; persisted.totalXp += 30; persisted.allTimeSessionCount += 1;
            _journalWrite(C, null);
            const o = await _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, ++_changeSeq);
            return { err, afterLegacy, o };
        }, { C });
        expect(out.err).toBe(null);                              // soft mode accepted it
        expect(out.afterLegacy).toEqual({ rev: 6, id: null });   // ...and made it visible
        expect(out.o).toBe('ok');
        expect((await row()).session_log.map(e => e.sid)).toEqual(['sA', 'sC']);
    });

    test('HARD: a legacy write is refused, a protected one is not', async () => {
        await load({}, { mode: 'hard' });
        const out = await app.page.evaluate(async () => {
            const legacy = window.__applyRevGuard({ total_xp: 1 });
            persisted.totalXp = 9; const o = await _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq);
            return { legacy, o };
        });
        expect(out.legacy.message).toBe('rev_required');
        expect(out.o).toBe('ok');
        expect((await row()).total_xp).toBe(9);
    });

    test('switching the table from soft to hard mid-session does not strand a protected tab', async () => {
        await load({}, { mode: 'soft' });
        const out = await app.page.evaluate(async () => {
            persisted.totalXp = 3; const a = await _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq);
            window.__revMode = 'hard';
            persisted.totalXp = 4; const b = await _commitWrite(currentUser.id, { id: currentUser.id, ..._buildSavePayload() }, _changeSeq);
            return [a, b];
        });
        expect(out).toEqual(['ok', 'ok']);
    });

    test('EQ sessions stay disabled', async () => {
        expect(await app.page.evaluate(() => EQ_SESSIONS_ENABLED)).toBe(false);
    });
});
