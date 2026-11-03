import { describe, test, expect } from 'vitest';
import { openApp, authSignIn } from './harness.js';

/**
 * WHO OWNS A LOAD, AND WHOSE FLAG MAY IT CLEAR.
 *
 * loadPersisted() awaits twice: once for the server read, once for the
 * resync write. `currentUser` is a mutable global, and the function used to
 * read `currentUser.id` five separate times across those awaits: for the
 * backup key, the query filter, the dirty probe, the dirty clear, and the XP
 * migration backup key. A sign-out or an account switch between any two of
 * them applied one member's data, or cleared one member's flag, inside
 * another member's session.
 *
 * _commitWrite() has captured its uid for exactly this reason since Phase 2B
 * and says so in its own comment. loadPersisted() never adopted the
 * discipline. This file is the regression evidence for doing so.
 *
 * TWO GROUPS, AND THE SPLIT IS THE POINT.
 *
 * "existing behaviour" must pass before and after the fix. It is the proof
 * that today's members are untouched, and it is the group that matters most:
 * a protection that changes ordinary loading is not a protection.
 *
 * "new protections" must FAIL before the fix. Each one is a way the old code
 * could corrupt or falsely confirm, and a test here that passes against the
 * original implementation is testing nothing.
 *
 * NOT COVERED, deliberately: a stale write from ANOTHER TAB landing on the
 * server after this tab's. Nothing in a single client can prevent that, and
 * claiming otherwise would be worse than the gap. It belongs to the
 * revision-CAS work and is asserted nowhere in this file.
 */

const A = { id: 'member-a', email: 'a@example.com' };
const B = { id: 'member-b', email: 'b@example.com' };

/** A server row, deliberately older than any backup we write. */
const rowFor = (over = {}) => ({
    id: A.id,
    schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
    completed_days: [false, false, false, false, false, false, false],
    total_xp: 300, all_time_session_count: 10, difficulty: 'intermediate',
    session_log: [], measurements: [], progress_checkins: [],
    week_key: 'server-week', xp_migrated: true,
    updated_at: '2026-03-10T12:00:00Z',
    ...over,
});

/** A local backup, newer than the row, so the resync branch is taken. */
const backupFor = (over = {}) => JSON.stringify({
    schedule: ['stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest', 'rest'],
    completedDays: [true, false, false, false, false, false, false],
    totalXp: 450, allTimeSessionCount: 12, difficulty: 'advanced',
    sessionLog: [{ date: '2026-03-15T13:00:00Z', routineType: 'stamina', xpEarned: 15 }],
    measurements: [], progressCheckins: [], weekKey: 'server-week', xpMigrated: true,
    _savedAt: '2026-03-16T13:00:00Z',
    ...over,
});

/** Seed one account's row, backup and dirty flag before signing in. */
const seed = (page, { uid, row, backup, dirty }) => page.evaluate(
    ({ uid, row, backup, dirty }) => {
        window.__rowsByUser[uid] = row;
        if (backup !== null) localStorage.setItem('bp_data_' + uid, backup);
        if (dirty) localStorage.setItem('bp_dirty_' + uid, '1');
    }, { uid, row, backup, dirty });

const localState = (page, uid) => page.evaluate(uid => ({
    dirty: localStorage.getItem('bp_dirty_' + uid),
    xpBackup: localStorage.getItem('bp_xp_backup_' + uid),
    backup: localStorage.getItem('bp_data_' + uid),
}), uid);

/* THE DIRTY FLAG IS NOT A STABLE POST-CONDITION.
   _writeLocalBackup() re-sets bp_dirty_ on every save, and the app saves
   during boot after loadPersisted() returns. So "is the flag null now" says
   nothing about whether the resync decided to clear it. These tests watch the
   DECISION instead: which keys removeItem was called with, and which keys were
   re-set afterwards. */
const spyDirty = page => page.evaluate(() => {
    window.__dirtyRemoved = [];
    window.__dirtySet = [];
    const realRemove = Storage.prototype.removeItem;
    const realSet = Storage.prototype.setItem;
    Storage.prototype.removeItem = function (k) {
        if (String(k).startsWith('bp_dirty_')) window.__dirtyRemoved.push(String(k));
        return realRemove.call(this, k);
    };
    Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith('bp_dirty_')) window.__dirtySet.push(String(k));
        return realSet.call(this, k, v);
    };
});
const dirtyEvents = page => page.evaluate(() => ({
    removed: window.__dirtyRemoved.slice(),
    set: window.__dirtySet.slice(),
}));

/* Run ONE loadPersisted() and report only what it did.
   A later successful save also clears the flag, legitimately, via
   _commitWrite(). Measuring the whole boot therefore cannot tell the resync's
   decision from an ordinary save's. This awaits the load itself and reads the
   spy at its resolution, so the window contains nothing else. */
const measuredLoad = page => page.evaluate(async () => {
    window.__dirtyRemoved.length = 0;
    window.__dirtySet.length = 0;
    await loadPersisted();
    return { removed: window.__dirtyRemoved.slice(), set: window.__dirtySet.slice() };
});

const appState = page => page.evaluate(() => ({
    uid: typeof currentUser === 'undefined' || !currentUser ? null : currentUser.id,
    loaded: _persistedLoaded,
    schedule: persisted.schedule,
    totalXp: persisted.totalXp,
    difficulty: persisted.difficulty,
    logLen: (persisted.sessionLog || []).length,
}));

describe('existing behaviour: a V1 member loads and resyncs exactly as before', () => {
    test('1. a dirty backup newer than the row is adopted, resynced, and the flag cleared', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await spyDirty(app.page);
            // Restore the unsynced state and measure one load.
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
            }, backupFor());
            const ev = await measuredLoad(app.page);
            const st = await appState(app.page);
            // The backup won, so its values are live.
            expect(st.difficulty).toBe('advanced');
            expect(st.totalXp).toBe(450);
            expect(st.logLen).toBe(1);
            // And the resync was acknowledged, so it cleared A's flag.
            expect(ev.removed).toContain('bp_dirty_' + A.id);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    }, 90_000);

    test('2. with no backup the server row is adopted and no flag is touched', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await spyDirty(app.page);
            await app.page.evaluate(() => {
                localStorage.removeItem('bp_data_member-a');
                localStorage.removeItem('bp_dirty_member-a');
            });
            const ev = await measuredLoad(app.page);
            const st = await appState(app.page);
            expect(st.difficulty).toBe('intermediate');
            expect(st.totalXp).toBe(300);
            // No backup means no resync branch, so nothing decided to clear.
            expect(ev.removed).not.toContain('bp_dirty_' + A.id);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    }, 90_000);

    test('3. a read that never answers falls back to the backup', async () => {
        const app = await openApp({ hangRead: true });
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await app.page.evaluate(({ id, email }) => {
                window.__authUser = { id, email, user_metadata: {} };
                if (!window.__members.includes(email)) window.__members.push(email);
                window.__fireAuth('SIGNED_IN', { user: { id, email, user_metadata: {} },
                                                 access_token: 'stub-' + id });
            }, A);
            // The 8s read timeout plus the fallback.
            await app.page.waitForFunction(() => _persistedLoaded === true, null, { timeout: 20_000 });
            const st = await appState(app.page);
            expect(st.difficulty).toBe('advanced');     // from the backup
            expect(st.logLen).toBe(1);
        } finally { await app.close(); }
    }, 120_000);

    test('4. no row and no backup gives a brand-new account its beginner defaults', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: null, backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: null });
            const st = await appState(app.page);
            expect(st.difficulty).toBe('beginner');
            expect(st.loaded).toBe(true);
        } finally { await app.close(); }
    }, 90_000);

    test('5. an unknown-column rejection still falls back through the schema tiers', async () => {
        const app = await openApp({ rejectColumns: ['programme', 'day_plans'] });
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await spyDirty(app.page);
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
            }, backupFor());
            const ev = await measuredLoad(app.page);
            const writes = await app.page.evaluate(() => window.__writes.map(w => Object.keys(w)));
            // Something was accepted, and it was the stripped payload.
            expect(writes.length).toBeGreaterThan(0);
            expect(writes.some(k => !k.includes('programme'))).toBe(true);
            expect(ev.removed).toContain('bp_dirty_' + A.id);  // stripped write acknowledged
        } finally { await app.close(); }
    }, 90_000);
});

describe('new protections: ownership of the load and of the dirty flag', () => {
    /* THESE TESTS NEED A LOAD THAT IS STILL IN FLIGHT.
       My first attempt switched account after authSignIn(), which waits for
       boot to finish. A's load was therefore already complete, there was no
       overlap, and six of these tests passed against the UNFIXED code. They
       were proving nothing.

       So the read is suspended deliberately: sb.from('user_data').single() is
       wrapped to return a promise this file releases by hand. The sequence is
       the one the guard exists for: start A's load, suspend it at the read,
       move the session to B, release A's reply, and see where it lands.

       currentUser is reassigned directly to move the session. That is a top
       level `let` in the app's script and is exactly the binding a real
       account switch rewrites, which is why the harness signs in the same
       way. */
    const suspendRead = page => page.evaluate(() => {
        const origFrom = sb.from.bind(sb);
        window.__release = null;
        window.__restoreFrom = () => { sb.from = origFrom; };
        sb.from = (table) => {
            const q = origFrom(table);
            if (table === 'user_data') {
                const realSingle = q.single.bind(q);
                q.single = () => new Promise(res => { window.__release = () => res(realSingle()); });
            }
            return q;
        };
    });

    /** Start loadPersisted() and stop at the suspended read. */
    const startLoad = async page => {
        await page.evaluate(() => {
            window.__loadSettled = false;
            window.__loadPromise = loadPersisted().then(() => { window.__loadSettled = true; });
        });
        await page.waitForFunction(() => typeof window.__release === 'function', null, { timeout: 10_000 });
    };

    /** Move the session to another account, the way a switch does. */
    const moveSessionTo = (page, who) => page.evaluate(({ id, email }) => {
        currentUser = { id, email, user_metadata: {} };
    }, who);

    /** Let A's reply arrive and wait for the load to finish. */
    const releaseAndSettle = async page => {
        await page.evaluate(() => window.__release());
        await page.waitForFunction(() => window.__loadSettled === true, null, { timeout: 15_000 });
    };

    test('6. a reply arriving after the session moved cannot adopt into the new account', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            // B's own state, so a leak from A is visible.
            await app.page.evaluate(() => {
                adoptPersisted({ difficulty: 'beginner', totalXp: 7, sessionLog: [] });
            });
            await suspendRead(app.page);
            await startLoad(app.page);
            await moveSessionTo(app.page, B);
            await releaseAndSettle(app.page);
            const st = await appState(app.page);
            expect(st.uid).toBe(B.id);
            expect(st.difficulty).toBe('beginner');   // not A's 'advanced'
            expect(st.totalXp).toBe(7);               // not A's 450
            expect(st.logLen).toBe(0);                // not A's 1
        } finally { await app.close(); }
    }, 90_000);

    test('7. A then B then A: the first load cannot clear the flag the second one owns', async () => {
        /* THE CASE A UID COMPARISON ALONE MISSES. Back on A the uid matches
           again, so without the load token the first load's late reply passes
           every check and clears a flag that now belongs to a newer load and a
           newer, still-unsynced backup. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await suspendRead(app.page);
            await spyDirty(app.page);
            await startLoad(app.page);                      // load #1, suspended
            await moveSessionTo(app.page, B);               // away
            await moveSessionTo(app.page, A);               // and back: same uid
            // A newer unsynced backup, belonging to a newer load.
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
            }, backupFor({ totalXp: 999, _savedAt: '2026-03-18T09:00:00Z' }));
            await app.page.evaluate(() => { window.__dirtyRemoved.length = 0; });
            await app.page.evaluate(() => { _loadToken++; });  // a newer load exists
            await releaseAndSettle(app.page);
            const ev = await dirtyEvents(app.page);
            expect(ev.removed).not.toContain('bp_dirty_member-a');
        } finally { await app.close(); }
    }, 90_000);

    test('8. a backup replaced during the read is re-read, not adopted stale', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor({ totalXp: 450 }), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await suspendRead(app.page);
            await startLoad(app.page);
            // Another tab writes a newer backup while the read is in flight.
            await app.page.evaluate(b => localStorage.setItem('bp_data_member-a', b),
                backupFor({ totalXp: 777, _savedAt: '2026-03-17T09:00:00Z' }));
            await releaseAndSettle(app.page);
            const st = await appState(app.page);
            expect(st.totalXp).toBe(777);
        } finally { await app.close(); }
    }, 90_000);

    test('9. a backup it cannot verify leaves the flag set rather than claiming a save', async () => {
        /* The capture read SUCCEEDS, so the resync branch is taken, and only
           the verification read throws. The old code had no verification read
           at all and cleared on acknowledgement alone. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await spyDirty(app.page);
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
                // Break reads only AFTER the capture, by counting calls.
                window.__dataReads = 0;
                const real = Storage.prototype.getItem;
                Storage.prototype.getItem = function (k) {
                    if (String(k).startsWith('bp_data_')) {
                        window.__dataReads++;
                        if (window.__dataReads > 1) throw new Error('storage unavailable');
                    }
                    return real.call(this, k);
                };
            }, backupFor());
            const ev = await measuredLoad(app.page);
            expect(ev.removed).not.toContain('bp_dirty_member-a');
        } finally { await app.close(); }
    }, 90_000);

    /* CHARACTERIZATION, and listed as such because I could not demonstrate it
       failing against the unfixed code. The migration runs on first boot and
       sets persisted.xpMigrated, so reaching the block a second time inside a
       measured, suspended load did not reproduce. The ownership GATE that
       guards this block is proven by test 11 below, which shares it, and the
       `_uid` key capture here is hardening whose live reachability I have not
       shown. Saying so is the point: an unproven test presented as evidence is
       worse than no test. */
    test('9b. a backup it cannot verify is not adopted at all', async () => {
        /* The companion to 9. That one proves the flag is not cleared; this
           one proves the STALE COPY IS NOT ADOPTED. Treating an unreadable
           re-read as "fine" would hand the member the copy captured before
           the await, which is the thing another tab may have replaced. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
                // A sentinel that must survive, because nothing may be adopted.
                persisted.totalXp = 11;
                window.__dataReads = 0;
                const real = Storage.prototype.getItem;
                Storage.prototype.getItem = function (k) {
                    if (String(k).startsWith('bp_data_')) {
                        window.__dataReads++;
                        if (window.__dataReads > 1) throw new Error('storage unavailable');
                    }
                    return real.call(this, k);
                };
            }, backupFor({ totalXp: 450 }));
            await app.page.evaluate(() => loadPersisted());
            await app.page.waitForTimeout(1200);
            const xp = await app.page.evaluate(() => persisted.totalXp);
            expect(xp).not.toBe(450);   // the unverifiable backup was refused
            expect(xp).toBe(11);        // and nothing else was adopted either
        } finally { await app.close(); }
    }, 90_000);

    test('10. the XP migration writes its backup under the captured account (characterization)', async () => {
        const app = await openApp();
        try {
            const migRow = rowFor({ xp_migrated: false, total_xp: 9000, all_time_session_count: 10 });
            await seed(app.page, { uid: A.id, row: migRow, backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: migRow });
            /* Reset the stored ROW, not just the live globals. The first boot
               migrates and saves, so the stub's row comes back with
               xp_migrated true and the measured load would skip the block
               entirely. That is why this test passed against the unfixed code
               on the first attempt. */
            await app.page.evaluate(() => {
                window.__rowsByUser['member-a'] = {
                    ...window.__rowsByUser['member-a'],
                    xp_migrated: false, total_xp: 9000, all_time_session_count: 10,
                };
                persisted.xpMigrated = false; persisted.totalXp = 9000;
                persisted.allTimeSessionCount = 10;
                localStorage.removeItem('bp_xp_backup_member-a');
                localStorage.removeItem('bp_xp_backup_member-b');
            });
            await suspendRead(app.page);
            await startLoad(app.page);
            await moveSessionTo(app.page, B);
            await releaseAndSettle(app.page);
            const lsA = await localState(app.page, A.id);
            const lsB = await localState(app.page, B.id);
            // B must never acquire a migration backup from A's load.
            expect(lsB.xpBackup).toBeNull();
            // And if A's migration wrote at all, it is keyed to A.
            if (lsA.xpBackup !== null) expect(JSON.parse(lsA.xpBackup).totalXp).toBe(9000);
        } finally { await app.close(); }
    }, 90_000);

    test('11. the weekly reset cannot clear the arriving account completedDays', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor({ week_key: 'stale-week' }), backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: rowFor({ week_key: 'stale-week' }) });
            await app.page.evaluate(() => {
                persisted.weekKey = 'stale-week';
                persisted.completedDays = [true, true, true, false, false, false, false];
            });
            await suspendRead(app.page);
            await startLoad(app.page);
            await moveSessionTo(app.page, B);
            await releaseAndSettle(app.page);
            const done = await app.page.evaluate(() => persisted.completedDays.filter(Boolean).length);
            // B's load did not run A's weekly reset over whatever is live.
            expect(done).toBe(3);
        } finally { await app.close(); }
    }, 90_000);

    /* THE RESYNC'S OWN AWAIT IS A SECOND WINDOW, and my first pass missed it.
       Six mutants survived because every test above acts during the READ's
       await, which the adopt guard already covers. The dirty-clear conditions,
       the XP and weekly gate, and the captured payload all run AFTER the
       upsert resolves, so they need the write suspended instead. */
    const suspendUpsert = page => page.evaluate(() => {
        const origFrom = sb.from.bind(sb);
        window.__releaseWrite = null;
        window.__sentPayloads = [];
        sb.from = (table) => {
            const q = origFrom(table);
            if (table === 'user_data') {
                const realUpsert = q.upsert.bind(q);
                q.upsert = (payload, opts) => {
                    window.__sentPayloads.push(JSON.parse(JSON.stringify(payload)));
                    return new Promise(res => {
                        window.__releaseWrite = () => res(realUpsert(payload, opts));
                    });
                };
            }
            return q;
        };
    });

    /** Start a load that will suspend at the resync write. */
    const startLoadToWrite = async page => {
        await page.evaluate(() => {
            window.__loadSettled = false;
            loadPersisted().then(() => { window.__loadSettled = true; });
        });
        await page.waitForFunction(() => typeof window.__releaseWrite === 'function',
            null, { timeout: 15_000 });
    };
    const releaseWriteAndSettle = async page => {
        await page.evaluate(() => window.__releaseWrite());
        await page.waitForFunction(() => window.__loadSettled === true, null, { timeout: 15_000 });
    };

    /** Seeded, signed in, with an unsynced backup ready to resync. */
    const readyToResync = async (app, over = {}) => {
        await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
        await seed(app.page, { uid: B.id, row: rowFor({ id: B.id }), backup: null, dirty: false });
        await authSignIn(app.page, { ...A, row: rowFor() });
        await app.page.evaluate(b => {
            localStorage.setItem('bp_data_member-a', b);
            localStorage.setItem('bp_dirty_member-a', '1');
        }, backupFor(over));
    };

    test('12a. a newer backup written during the resync keeps the flag set', async () => {
        /* The acknowledged write covered an OLDER snapshot than the one now on
           disk, so the member still has unsynced work. */
        const app = await openApp();
        try {
            await readyToResync(app);
            await spyDirty(app.page);
            await suspendUpsert(app.page);
            await startLoadToWrite(app.page);
            await app.page.evaluate(() => { window.__dirtyRemoved.length = 0; });
            // Another save lands while the write is in flight.
            await app.page.evaluate(b => localStorage.setItem('bp_data_member-a', b),
                backupFor({ totalXp: 1234, _savedAt: '2026-03-20T10:00:00Z' }));
            await releaseWriteAndSettle(app.page);
            const ev = await dirtyEvents(app.page);
            expect(ev.removed).not.toContain('bp_dirty_member-a');
        } finally { await app.close(); }
    }, 90_000);

    test('12b. a session that moved during the resync clears nothing', async () => {
        const app = await openApp();
        try {
            await readyToResync(app);
            await spyDirty(app.page);
            await suspendUpsert(app.page);
            await startLoadToWrite(app.page);
            await app.page.evaluate(() => { window.__dirtyRemoved.length = 0; });
            await moveSessionTo(app.page, B);
            await releaseWriteAndSettle(app.page);
            const ev = await dirtyEvents(app.page);
            expect(ev.removed).not.toContain('bp_dirty_member-a');
            expect(ev.removed).not.toContain('bp_dirty_member-b');
        } finally { await app.close(); }
    }, 90_000);

    test('12c. the resync payload is the captured account, not whoever arrived', async () => {
        const app = await openApp();
        try {
            await readyToResync(app);
            await suspendUpsert(app.page);
            await startLoadToWrite(app.page);
            await moveSessionTo(app.page, B);
            await releaseWriteAndSettle(app.page);
            const sent = await app.page.evaluate(() => window.__sentPayloads);
            expect(sent.length).toBeGreaterThan(0);
            // Every payload this load sent names A, built before the await.
            for (const pl of sent) expect(pl.id).toBe(A.id);
        } finally { await app.close(); }
    }, 90_000);

    test('12d. the XP and weekly blocks do not run for the account that arrived', async () => {
        /* These sit after the resync await, so moving the session there is the
           only way to reach them in the wrong hands. */
        const app = await openApp();
        try {
            await readyToResync(app);
            await suspendUpsert(app.page);
            await startLoadToWrite(app.page);
            await moveSessionTo(app.page, B);
            // Whatever is live must survive: a stale weekKey would otherwise
            // trigger the reset against B's session.
            await app.page.evaluate(() => {
                persisted.weekKey = 'stale-week';
                persisted.completedDays = [true, true, false, false, false, false, false];
                window.__xpKeys = [];
                const realSet = Storage.prototype.setItem;
                Storage.prototype.setItem = function (k, v) {
                    if (String(k).startsWith('bp_xp_backup_')) window.__xpKeys.push(String(k));
                    return realSet.call(this, k, v);
                };
            });
            await releaseWriteAndSettle(app.page);
            const out = await app.page.evaluate(() => ({
                done: persisted.completedDays.filter(Boolean).length,
                xpKeys: window.__xpKeys,
            }));
            expect(out.done).toBe(2);                       // reset did not run
            expect(out.xpKeys).not.toContain('bp_xp_backup_member-b');
        } finally { await app.close(); }
    }, 90_000);

    test('12. only the captured account dirty key is ever cleared', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await suspendRead(app.page);
            await spyDirty(app.page);
            await app.page.evaluate(() => { localStorage.setItem('bp_dirty_member-b', '1'); });
            await startLoad(app.page);
            await moveSessionTo(app.page, B);
            await releaseAndSettle(app.page);
            const ev = await dirtyEvents(app.page);
            // A's load may touch A's key and must never touch B's.
            expect(ev.removed).not.toContain('bp_dirty_member-b');
        } finally { await app.close(); }
    }, 90_000);

    /* CHARACTERIZATION, not a new protection, and it is listed here so the
       distinction is not lost. The query is built synchronously before the
       first await, so `currentUser.id` and the captured `_uid` are necessarily
       the same value at that moment and no test can make them differ. Using
       `_uid` there is hardening for consistency, not a fixed defect, and this
       test passes against the unfixed code too. */
    /* ===================================================================
       REVIEW FIXES. Every branch decision must be made from a backup that
       was refreshed and validated FIRST, including the `!data` path, and a
       decision must not be carried out against a snapshot it was not made
       from. These six all fail against the pre-fix implementation.
       =================================================================== */

    test('R1. an older captured backup replaced by a newer one flips the decision', async () => {
        /* Captured backup is OLDER than the row, so the pre-fix decision went
           to the server branch and ignored local work entirely. The copy
           actually on disk by then is NEWER than the row. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await app.page.evaluate(b => localStorage.setItem('bp_data_member-a', b),
                backupFor({ totalXp: 450, _savedAt: '2026-03-01T00:00:00Z' }));  // older than row
            await suspendRead(app.page);
            await startLoad(app.page);
            await app.page.evaluate(b => localStorage.setItem('bp_data_member-a', b),
                backupFor({ totalXp: 888, _savedAt: '2026-03-19T00:00:00Z' }));  // newer than row
            await releaseAndSettle(app.page);
            const st = await appState(app.page);
            expect(st.totalXp).toBe(888);
        } finally { await app.close(); }
    }, 90_000);

    test('R2. a backup appearing during the read is seen by the no-row branch', async () => {
        /* THE WORST OF THE SET. With no row and no captured backup, the
           pre-fix `!data` branch decided from the stale view, took the
           brand-new-account path and reset a returning member to beginner
           defaults, even though a backup had arrived meanwhile. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await app.page.evaluate(() => {
                localStorage.removeItem('bp_data_member-a');
                window.__rowsByUser['member-a'] = null;      // no row this time
                persisted.difficulty = 'advanced';
            });
            await suspendRead(app.page);
            await startLoad(app.page);
            await app.page.evaluate(b => localStorage.setItem('bp_data_member-a', b),
                backupFor({ difficulty: 'advanced', totalXp: 640 }));
            await releaseAndSettle(app.page);
            const st = await appState(app.page);
            expect(st.difficulty).toBe('advanced');   // not reset to beginner
            expect(st.totalXp).toBe(640);
        } finally { await app.close(); }
    }, 90_000);

    test('R3. a newer captured backup replaced by an older one re-decides', async () => {
        /* The copy on disk is the truth even when it moves backwards: another
           tab may have restored an export. The replacement here is older than
           the ROW, so a decision made from it goes to the server branch, while
           a decision made from the captured copy goes to the resync branch and
           then adopts the older local data. The two answers differ, which is
           what makes this test worth having: my first version asserted only
           "not the copy we no longer hold" and passed either way. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await app.page.evaluate(b => localStorage.setItem('bp_data_member-a', b),
                backupFor({ totalXp: 950, _savedAt: '2026-03-19T00:00:00Z' }));   // newer than row
            await suspendRead(app.page);
            await startLoad(app.page);
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.removeItem('bp_dirty_member-a');
            }, backupFor({ totalXp: 120, _savedAt: '2026-03-05T00:00:00Z' }));    // older than row
            await releaseAndSettle(app.page);
            const st = await appState(app.page);
            expect(st.totalXp).toBe(300);       // the server row, per the re-decision
        } finally { await app.close(); }
    }, 90_000);

    test('R4. a backup changing between the decision and the adoption refuses the load', async () => {
        /* The branch was chosen from one snapshot. If the backup moves again
           before adoption, carrying out that decision against a different copy
           would be acting on a judgement nobody made about it. Refuse, and do
           not enable writes. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
                persisted.totalXp = 13;                       // sentinel
                /* Move the backup once more on the NEXT read, which is the one
                   _adopt performs after the decision has been taken. */
                /* Reads: 1 the capture, 2 the pre-decision refresh, 3 the one
                   _adopt performs. The swap lands on the THIRD, which is the
                   only way to move the backup AFTER the branch was chosen. */
                window.__reads = 0;
                const real = Storage.prototype.getItem;
                const newer = b.replace('"totalXp":450', '"totalXp":4242');
                Storage.prototype.getItem = function (k) {
                    if (String(k) === 'bp_data_member-a') {
                        window.__reads++;
                        if (window.__reads >= 3) return newer;
                    }
                    return real.call(this, k);
                };
            }, backupFor({ totalXp: 450 }));
            await app.page.evaluate(() => loadPersisted());
            await app.page.waitForTimeout(1500);
            const out = await app.page.evaluate(() => ({
                xp: persisted.totalXp, loaded: _persistedLoaded,
            }));
            expect(out.xp).toBe(13);          // neither copy adopted
            expect(out.loaded).toBe(false);   // and writes stay disabled
        } finally { await app.close(); }
    }, 90_000);

    test('R5. an unverifiable backup leaves _persistedLoaded false and blocks writes', async () => {
        /* The flag only matters through savePersisted(), which gates on it, so
           this asserts the consequence and not just the boolean. Pre-fix the
           flag was set unconditionally before the branch, so a refused
           adoption still left the app free to overwrite the row. */
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: backupFor(), dirty: true });
            await authSignIn(app.page, { ...A, row: rowFor() });
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
                window.__reads = 0;
                const real = Storage.prototype.getItem;
                Storage.prototype.getItem = function (k) {
                    if (String(k).startsWith('bp_data_')) {
                        window.__reads++;
                        if (window.__reads > 1) throw new Error('storage unavailable');
                    }
                    return real.call(this, k);
                };
            }, backupFor());
            await app.page.evaluate(() => loadPersisted());
            await app.page.waitForTimeout(1500);
            const loaded = await app.page.evaluate(() => _persistedLoaded);
            expect(loaded).toBe(false);
            /* Cleared HERE, not before the load: the sign-in boot debounces a
               save by 800ms and it would otherwise be counted against this. */
            await app.page.evaluate(() => { window.__writes.length = 0; });
            // And the consequence: a save is refused outright.
            await app.page.evaluate(() => savePersisted());
            await app.page.waitForTimeout(1200);
            const writes = await app.page.evaluate(() => window.__writes.length);
            expect(writes).toBe(0);
        } finally { await app.close(); }
    }, 90_000);

    test('R6. server check-in history survives a backup refresh', async () => {
        /* The merge that protects newly available check-ins used to be a
           one-off statement, which _refreshBackupIfChanged() then undid by
           re-parsing localData from the raw string. */
        const app = await openApp();
        try {
            const withCheckins = rowFor({ progress_checkins: [{ date: '2026-03-02', score: 4 }] });
            await seed(app.page, { uid: A.id, row: withCheckins, backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: withCheckins });
            // A backup that carries no check-ins of its own, and wins on time.
            const noCheckins = JSON.stringify({
                ...JSON.parse(backupFor()), progressCheckins: undefined,
            });
            await app.page.evaluate(b => {
                localStorage.setItem('bp_data_member-a', b);
                localStorage.setItem('bp_dirty_member-a', '1');
            }, noCheckins);
            await suspendRead(app.page);
            await startLoad(app.page);
            // Replaced mid-read, forcing the refresh path that dropped the merge.
            await app.page.evaluate(b => localStorage.setItem('bp_data_member-a', b),
                JSON.stringify({ ...JSON.parse(noCheckins), totalXp: 460,
                                 _savedAt: '2026-03-17T10:00:00Z' }));
            await releaseAndSettle(app.page);
            const checkins = await app.page.evaluate(() => persisted.progressCheckins);
            expect(Array.isArray(checkins)).toBe(true);
            expect(checkins).toHaveLength(1);
            expect(checkins[0].score).toBe(4);
        } finally { await app.close(); }
    }, 90_000);

    test('13. the server read is filtered by the captured account id (characterization)', async () => {
        const app = await openApp();
        try {
            await seed(app.page, { uid: A.id, row: rowFor(), backup: null, dirty: false });
            await authSignIn(app.page, { ...A, row: rowFor() });
            // Record the id every user_data read filters on.
            await app.page.evaluate(() => {
                window.__filters = [];
                const origFrom = sb.from.bind(sb);
                sb.from = (table) => {
                    const q = origFrom(table);
                    if (table === 'user_data') {
                        const realEq = q.eq.bind(q);
                        q.eq = (col, val) => { window.__filters.push([col, val]); return realEq(col, val); };
                    }
                    return q;
                };
            });
            await app.page.evaluate(() => {
                window.__loadSettled = false;
                loadPersisted().then(() => { window.__loadSettled = true; });
            });
            await moveSessionTo(app.page, B);
            await app.page.waitForFunction(() => window.__loadSettled === true, null, { timeout: 15_000 });
            const filters = await app.page.evaluate(() => window.__filters);
            // Every filter names the account the load captured, never the one
            // that arrived part way through.
            for (const [col, val] of filters) {
                if (col === 'id') expect(val).toBe(A.id);
            }
            expect(filters.some(([c]) => c === 'id')).toBe(true);
        } finally { await app.close(); }
    }, 90_000);
});
