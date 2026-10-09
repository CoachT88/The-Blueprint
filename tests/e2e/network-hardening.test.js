import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, authSignIn, authSignOut, legacyProgramme } from './harness.js';

/**
 * Failure injection for the pre-deployment hardening pass.
 *
 * Three questions, and only these three:
 *
 *   1. Does every network wait end? A hung promise must never leave a
 *      control disabled or a spinner turning forever.
 *   2. Is an UNKNOWN outcome handled as unknown? A timeout may mean the
 *      server committed and the answer was lost, so local state must be kept,
 *      the dirty flag must stand, and nothing may be rolled back or declared
 *      failed.
 *   3. Can a result that lands late touch the wrong account? A write
 *      scheduled by A must never resolve against B.
 *
 * Cross-tab locking, multi-device merge and session IDs are 3C.6 and are not
 * here. Every deadline is shortened by bare assignment, the same way these
 * suites already override isDeloadWeek.
 */

const THU = new Date(Date.UTC(2026, 2, 12, 12));
const SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

const row = (over = {}) => ({
    id: 'ex', total_xp: 500, difficulty: 'intermediate', schedule: SIZE,
    completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 20, xp_migrated: true, week_key: '',
    primary_goal: 'size', programme: legacyProgramme(), day_plans: [],
    pelvic_profile: 'standard', updated_at: '2026-03-12T00:00:00.000Z', ...over,
});

describe('a write that never settles', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /** Drive one save with a chosen injection and report what survived. */
    const save = (inject) => app.page.evaluate(async ({ inject, r }) => {
        try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
        try { localStorage.removeItem('bp_dirty_' + currentUser.id); } catch (e) {}
        window.__row = r; window.__writes = [];
        window.__hangUpsert = false; window.__hangUpsertCommits = false;
        window.__failUpsert = false; window.__throwUpsert = false;
        await loadPersisted();
        WRITE_DEADLINE_MS = 60;                       // shortened for the test
        Object.assign(window, inject);
        persisted.totalXp = 4242;                     // something to save
        const outcome = await _flushSaveNow();
        let backup = null;
        try {
            const raw = localStorage.getItem('bp_data_' + currentUser.id);
            backup = raw ? JSON.parse(raw).totalXp : null;
        } catch (e) {}
        return {
            outcome,
            dirty: !!localStorage.getItem('bp_dirty_' + currentUser.id),
            backup,
            liveXp: persisted.totalXp,
            writes: window.__writes.length,
        };
    }, { inject, r: row() });

    test('resolves normally: clean, and the row is written', async () => {
        const o = await save({});
        expect(o.outcome).toBe('ok');
        expect(o.dirty).toBe(false);
        expect(o.writes).toBe(1);
    }, 60_000);

    test('an ERROR keeps the dirty flag and the local backup', async () => {
        const o = await save({ __failUpsert: true });
        expect(o.outcome).toBe('error');
        expect(o.dirty).toBe(true);
        expect(o.backup).toBe(4242);
        expect(o.liveXp).toBe(4242);                  // never rolled back
    }, 60_000);

    test('a THROW is caught and treated the same way', async () => {
        const o = await save({ __throwUpsert: true });
        expect(o.outcome).toBe('error');
        expect(o.dirty).toBe(true);
        expect(o.backup).toBe(4242);
    }, 60_000);

    test('A HANG ENDS AT THE DEADLINE AND REPORTS UNKNOWN', async () => {
        const o = await save({ __hangUpsert: true });
        expect(o.outcome).toBe('unknown');            // not 'error'
        expect(o.dirty).toBe(true);
        expect(o.backup).toBe(4242);
        expect(o.liveXp).toBe(4242);
    }, 60_000);

    test('A TIMEOUT AFTER THE SERVER COMMITTED STAYS SAFELY RETRYABLE', async () => {
        /* The case that makes "timeout is not failure" matter: the row DID
           land and only the response was lost. The dirty flag must stand so
           the next load resends, and a resend is a whole-row upsert, so it
           replaces rather than appending a second completion. */
        const o = await save({ __hangUpsert: true, __hangUpsertCommits: true });
        expect(o.outcome).toBe('unknown');
        expect(o.dirty).toBe(true);
        expect(o.writes).toBe(1);                     // it really did commit
        expect(o.liveXp).toBe(4242);                  // and nothing rolled back
    }, 60_000);

    test('the schema fallback respects the deadline on its retry', async () => {
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = r; window.__writes = []; window.__attempts = [];
            window.__hangUpsert = false; window.__failUpsert = false;
            await loadPersisted();
            WRITE_DEADLINE_MS = 60;
            /* First attempt is rejected for an unknown column, which trips the
               fallback; the fallback attempt then hangs. */
            window.__rejectOnce = true;
            const realFrom = window.__writes;
            window.__hangUpsert = true;
            const outcome = await _flushSaveNow();
            return { outcome, dirty: !!localStorage.getItem('bp_dirty_' + currentUser.id) };
        }, row());
        expect(o.outcome).toBe('unknown');
        expect(o.dirty).toBe(true);
    }, 60_000);

    test('SESSION COMPLETION SUCCEEDS WHILE THE REMOTE SYNC HANGS', async () => {
        /* The local-first guarantee. A dead network may delay the sync; it may
           never gate the completion the member just finished. */
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            try { localStorage.setItem(getTodaySorenessKey(), 'none'); } catch (e) {}
            window.__row = r;
            await loadPersisted();
            WRITE_DEADLINE_MS = 60;
            window.__hangUpsert = true;               // the network is gone
            renderDashboard();
            const before = persisted.allTimeSessionCount;
            session.routineType = 'girth'; session.step = 4;
            selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            let threw = null;
            try { finishSession(); } catch (e) { threw = String(e); }
            const last = persisted.sessionLog[persisted.sessionLog.length - 1];
            try { closeSessionSummary(); } catch (e) {}
            return { threw, before, after: persisted.allTimeSessionCount,
                     recorded: !!last, dirty: !!localStorage.getItem('bp_dirty_' + currentUser.id) };
        }, row());
        expect(o.threw).toBeNull();
        expect(o.after).toBe(o.before + 1);
        expect(o.recorded).toBe(true);
        expect(o.dirty).toBe(true);                   // deferred, not lost
    }, 90_000);
});

describe('logout and the account boundary', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('THE LOGOUT FLUSH IS NOT A NO-OP', async () => {
        await authSignIn(app.page, { id: 'A', email: 'a@example.com', row: row({ id: 'A' }) });
        const o = await app.page.evaluate(async () => {
            window.__writes = [];
            WRITE_DEADLINE_MS = 60;
            persisted.totalXp = 777;
            _writeLocalBackup();
            await handleLogout();                      // the real logout
            return { writes: window.__writes.length,
                     sentXp: window.__writes.length ? window.__writes[0].total_xp : null,
                     sentId: window.__writes.length ? window.__writes[0].id : null,
                     dirtyA: !!localStorage.getItem('bp_dirty_A') };
        });
        /* Before the fix this was zero: the flush ran after currentUser was
           already null and refused on its own guard. */
        expect(o.writes).toBe(1);
        expect(o.sentXp).toBe(777);
        expect(o.sentId).toBe('A');
        expect(o.dirtyA).toBe(false);
    }, 90_000);

    test("A PENDING SAVE CANNOT WRITE UNDER B, OR CLEAR B's DIRTY FLAG", async () => {
        await authSignIn(app.page, { id: 'A', email: 'a@example.com', row: row({ id: 'A' }) });
        /* A changes state, which arms the debounce with A's uid and A's
           payload captured. The write is NOT allowed to settle before B
           arrives, so the deadline stays long here on purpose. */
        await app.page.evaluate(() => {
            window.__writes = [];
            persisted.totalXp = 111;
            savePersisted();
        });
        await authSignOut(app.page);                   // the real handleLogout
        await authSignIn(app.page, { id: 'B', email: 'b@example.com',
                                     row: row({ id: 'B', total_xp: 10 }) });
        const o = await app.page.evaluate(async () => {
            persisted.totalXp = 222;
            _writeLocalBackup();                       // B is dirty now
            const bDirtyBefore = !!localStorage.getItem('bp_dirty_B');
            /* Let every pending timer fire, including A's if it survived. */
            await new Promise(r => setTimeout(r, 1200));
            return {
                bDirtyBefore,
                bDirtyAfter: !!localStorage.getItem('bp_dirty_B'),
                writes: window.__writes.map(w => ({ id: w.id, xp: w.total_xp })),
                currentId: currentUser ? currentUser.id : null,
            };
        });

        expect(o.currentId).toBe('B');
        expect(o.bDirtyBefore).toBe(true);
        /* The decisive assertion: no write carries A's data under B's id, and
           no write carries B's data under A's id. */
        for (const w of o.writes) {
            if (w.id === 'B') expect(w.xp).not.toBe(111);
            if (w.id === 'A') expect(w.xp).not.toBe(222);
        }
        /* B's dirty flag may legitimately be cleared, but ONLY by a write
           that actually carried B's id. The defect being excluded is a stale
           callback clearing it on A's behalf, so the question is not whether
           it is clean, it is whether a B write earned that. */
        if (!o.bDirtyAfter) {
            expect(o.writes.some(w => w.id === 'B')).toBe(true);
        }
        /* And A's captured payload must never have been sent at all under B. */
        expect(o.writes.some(w => w.id === 'B' && w.xp === 111)).toBe(false);
    }, 90_000);

    test('logout with a pending save and NO next account loses nothing', async () => {
        await authSignIn(app.page, { id: 'A', email: 'a@example.com', row: row({ id: 'A' }) });
        const o = await app.page.evaluate(async () => {
            WRITE_DEADLINE_MS = 60;
            window.__writes = [];
            persisted.totalXp = 909;
            savePersisted();                           // armed
            await handleLogout();                      // captured and flushed
            await new Promise(res => setTimeout(res, 1200));
            let backup = null;
            try {
                const raw = localStorage.getItem('bp_data_A');
                backup = raw ? JSON.parse(raw).totalXp : null;
            } catch (e) {}
            return { writes: window.__writes.filter(w => w.id === 'A').map(w => w.total_xp),
                     backup, current: currentUser };
        });
        expect(o.current).toBeNull();
        expect(o.backup).toBe(909);                    // durable locally
        expect(o.writes).toContain(909);               // and it reached the row
    }, 90_000);

    test('an independent SIGNED_OUT is idempotent and clears cleanly', async () => {
        await authSignIn(app.page, { id: 'A', email: 'a@example.com', row: row({ id: 'A' }) });
        const o = await app.page.evaluate(async () => {
            /* Token expiry: SIGNED_OUT arrives with handleLogout never run. */
            let threw = null;
            try {
                window.__fireAuth('SIGNED_OUT', null);
                window.__fireAuth('SIGNED_OUT', null);   // twice: must be harmless
            } catch (e) { threw = String(e); }
            return { threw, current: currentUser, loaded: _persistedLoaded,
                     authVisible: !document.getElementById('auth-screen').classList.contains('hidden') };
        });
        expect(o.threw).toBeNull();
        expect(o.current).toBeNull();
        expect(o.loaded).toBe(false);
        expect(o.authVisible).toBe(true);
    }, 90_000);
});

describe('Coach Tee always lets go of the button', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /** Replace fetch with a chosen behaviour and ask a question for real. */
    const ask = (mode) => app.page.evaluate(async ({ mode, r }) => {
        window.__row = r;
        await loadPersisted();
        COACH_DEADLINE_MS = 60;
        window.__session = { access_token: 't', user: { id: 'ex' } };
        let calls = 0;
        const realFetch = window.fetch;
        window.fetch = (url, opts) => {
            calls += 1;
            if (mode === 'hang') return new Promise((_, rej) => {
                if (opts && opts.signal) opts.signal.addEventListener('abort',
                    () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            });
            if (mode === 'throw') return Promise.reject(new Error('network down'));
            if (mode === '401-then-ok' && calls === 1)
                return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
            return Promise.resolve({ ok: true, status: 200,
                json: () => Promise.resolve({ content: [{ type: 'text', text: 'answer ' + calls }] }) });
        };
        openCoach && openCoach();
        const inp = document.getElementById('coach-input');
        const btn = document.getElementById('coach-submit-btn');
        inp.value = 'how do I progress?';
        await askCoach();
        const area = document.getElementById('coach-chat-area');
        window.fetch = realFetch;
        return { calls, disabled: btn.disabled, label: btn.textContent,
                 html: area.innerHTML, aborted: mode === 'hang' };
    }, { mode, r: row() });

    test('a hung request aborts at the deadline and recovers the button', async () => {
        const o = await ask('hang');
        expect(o.disabled).toBe(false);
        expect(o.label).toBe('Send');
        expect(o.html).toContain('taking too long');
        expect(o.calls).toBe(1);                       // never auto-resent
    }, 60_000);

    test('a thrown request also recovers the button', async () => {
        const o = await ask('throw');
        expect(o.disabled).toBe(false);
        expect(o.label).toBe('Send');
    }, 60_000);

    test('the one-time 401 refresh and retry still works', async () => {
        const o = await ask('401-then-ok');
        expect(o.calls).toBe(2);                       // original plus retry
        expect(o.html).toContain('answer 2');
        expect(o.disabled).toBe(false);
    }, 60_000);

    test('a 401 whose REFRESH FAILS still returns the button', async () => {
        const o = await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted();
            COACH_DEADLINE_MS = 2000;
            window.__session = { access_token: 't', user: { id: 'ex' } };
            window.__refreshFails = true;
            let calls = 0;
            const realFetch = window.fetch;
            window.fetch = () => { calls += 1; return Promise.resolve(
                { ok: false, status: 401, json: () => Promise.resolve({ error: { message: 'unauthorised' } }) }); };
            const btn = document.getElementById('coach-submit-btn');
            document.getElementById('coach-input').value = 'hello?';
            await askCoach();
            window.fetch = realFetch; window.__refreshFails = false;
            return { calls, disabled: btn.disabled, label: btn.textContent };
        }, row());
        /* No second request, because there was no fresh token to retry with,
           and above all no loop. */
        expect(o.calls).toBe(1);
        expect(o.disabled).toBe(false);
        expect(o.label).toBe('Send');
    }, 60_000);

    test('a 401 whose REFRESH HANGS is still bounded by the one budget', async () => {
        const o = await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted();
            COACH_DEADLINE_MS = 80;
            window.__session = { access_token: 't', user: { id: 'ex' } };
            window.__hangRefresh = true;               // the refresh never settles
            const realFetch = window.fetch;
            window.fetch = () => Promise.resolve(
                { ok: false, status: 401, json: () => Promise.resolve({}) });
            const btn = document.getElementById('coach-submit-btn');
            document.getElementById('coach-input').value = 'hello?';
            const started = Date.now();
            await askCoach();
            const waited = Date.now() - started;
            window.fetch = realFetch; window.__hangRefresh = false;
            return { waited, disabled: btn.disabled, label: btn.textContent };
        }, row());
        /* THE GAP THIS CLOSES: the deadline aborts the fetch, but a hung
           REFRESH is not a fetch and no AbortController reaches it. If this
           ever regresses, the member waits forever on a disabled button. */
        expect(o.disabled).toBe(false);
        expect(o.label).toBe('Send');
    }, 60_000);
});

describe('photo uploads cannot duplicate', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('A RETRY REUSES THE SAME PATH', async () => {
        const o = await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted();
            window.__uploads = []; window.__storageExisting = [];
            window.__failUpload = true;                // first attempt fails
            const p1 = _photoPathFor('log');
            await _uploadPhoto(p1, new Blob(['a']));
            /* The member taps retry WITHOUT choosing a new file, so the path
               must be the one already in flight, not a fresh timestamp. */
            const p2 = _photoPathFor('log');
            window.__failUpload = false;
            await _uploadPhoto(p2, new Blob(['a']));
            return { p1, p2, uploads: window.__uploads };
        }, row());
        expect(o.p2).toBe(o.p1);
        expect(o.uploads).toEqual([o.p1, o.p1]);
    }, 60_000);

    test('AN ALREADY-EXISTS CONFLICT IS READ AS SUCCESS, NOT FAILURE', async () => {
        const o = await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted();
            window.__uploads = []; window.__storageExisting = [];
            STORAGE_DEADLINE_MS = 60;
            /* The first attempt hangs but DOES commit: the classic lost
               response. The retry then meets the object it created. */
            window.__hangUpload = true; window.__hangUploadCommits = true;
            const path = _photoPathFor('log');
            const first = await _uploadPhoto(path, new Blob(['a']));
            window.__hangUpload = false;
            const second = await _uploadPhoto(path, new Blob(['a']));
            return { first, second, uploads: window.__uploads.length,
                     distinct: new Set(window.__uploads).size };
        }, row());
        expect(o.first.timedOut).toBe(true);           // unknown, not failed
        expect(o.second.conflict).toBe(true);          // confirmation
        expect(o.second.error).toBeUndefined();
        /* Two attempts, ONE object. This is the whole point of a stable path. */
        expect(o.uploads).toBe(2);
        expect(o.distinct).toBe(1);
    }, 60_000);

    test('a NEW file choice does not inherit the old path', async () => {
        const o = await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted();
            const p1 = _photoPathFor('log');
            _photoPathReset('log');                    // what a new choice does
            const p2 = _photoPathFor('log');
            return { p1, p2 };
        }, row());
        expect(o.p2).not.toBe(o.p1);
    }, 60_000);

    test('two paths minted in the same millisecond still differ', async () => {
        /* Date.now() alone is not unique, and a clock that steps backwards
           can repeat it outright. */
        const o = await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted();
            const seen = [];
            for (let i = 0; i < 25; i++) { seen.push(_photoPathFor('x' + i)); }
            return { total: seen.length, distinct: new Set(seen).size };
        }, row());
        expect(o.distinct).toBe(o.total);
    }, 60_000);

    test('a hung gallery read leaves a message, not a spinner', async () => {
        const o = await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted();
            STORAGE_READ_DEADLINE_MS = 60;
            window.__hangStorage = true;
            await renderGalleryInto('photo-log-gallery');
            window.__hangStorage = false;
            const el = document.getElementById('photo-log-gallery');
            return { html: el.innerHTML };
        }, row());
        expect(o.html).toContain('Could not load your photos');
        expect(o.html).not.toContain('fa-spin');
    }, 60_000);
});
