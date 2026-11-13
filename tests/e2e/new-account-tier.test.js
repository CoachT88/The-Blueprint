import { describe, test, expect, afterAll } from 'vitest';
import { openApp, signIn, authSignIn } from './harness.js';

/**
 * A genuinely new account starts at Beginner, however its row came to exist.
 *
 * THE DEFECT. The app's own new-account path (no user_data row) says "starts at
 * Beginner, matching what the intro promises". But the signup trigger has
 * already created the row by then, holding only the id, so that path is never
 * reached: the row's `difficulty` carries the database default, 'intermediate',
 * and the app read it as the member's tier. Found by running the real buyer
 * journey on staging: the first session earned 15 XP at the full Intermediate
 * dose (4 rounds of 120 s jelq and 45 s uli) instead of 10 XP at Beginner's
 * (3 rounds of 60 s and 30 s), and the tier was then saved into the row.
 *
 * THE RULE. A row the app has NEVER SAVED, and in which nothing has been done
 * or chosen, belongs to an account that has not begun, so its tier is the
 * starting tier. "Never saved" is read from several independent markers, never
 * from the session count alone: the app writes week_key and xp_migrated on its
 * very first load, and records the tier a member picks (diff_unlocked_date,
 * first_session_date). Anything the app has already saved is NEVER re-decided:
 * every explicit choice, every returning member, and the 17 production
 * accounts that already carry Intermediate with no sessions.
 *
 * The first mechanical session is Monday's girth circuit, because its numbers
 * differ by tier in four independent places: rounds, jelq seconds, uli seconds
 * and XP.
 */
const MON = new Date('2026-11-23T10:00:00Z');       // Monday, in both the Size and All of It weeks: girth
const BEGINNER = { rounds: 3, durations: [60, 30], restDur: 30, xp: 10 };       // GIRTH_CIRCUIT.beginner, SESSION_XP.beginner
const INTERMEDIATE = { rounds: 4, durations: [120, 45], restDur: 45, xp: 15 };  // GIRTH_CIRCUIT.intermediate, SESSION_XP.intermediate

/** What the signup trigger leaves behind: the id, and the database's own defaults. */
const signupRow = (id, over = {}) => ({
    id, difficulty: 'intermediate',                 // the database default today
    total_xp: 0, all_time_session_count: 0, session_log: [], measurements: [], seen_milestones: [],
    primary_goal: '', programme: null, day_plans: null, progression_ledger: [], progress_checkins: [],
    week_key: '', xp_migrated: false, first_session_date: '', pelvic_profile: '',
    diff_unlocked_date: null, schedule: null, completed_days: null, records: null, ...over,
});

const apps = [];
afterAll(async () => { for (const a of apps) await a.close().catch(() => {}); });

/** A new browser, a real sign-in, the row as given. */
async function signUp(row, { id = row ? row.id : 'NEW1', onDevice = null } = {}) {
    const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' });
    apps.push(app);
    if (onDevice) await app.page.evaluate(onDevice);
    await authSignIn(app.page, { id, email: 'new@example.com', row });
    return app;
}
const tierOf = (page) => page.evaluate(() => getDiff().id);
/** The real goal pick and the real end of the intro, as acceptance ran them. */
const chooseGoal = (page, goal) => page.evaluate(async (goal) => {
    selectGoal(goal); finishOnboarding(); await new Promise(r => setTimeout(r, 900));
}, goal);
/** Wait out the app's save debounce, then until nothing is waiting to be saved. */
const settle = async (page) => {
    await page.waitForTimeout(1600);
    await page.waitForFunction(() => _unsaved === false, null, { timeout: 20_000 });
};
/** Today's dated plan: the dose that will execute is the one stored here. */
const todaysPlan = (page) => page.evaluate(() => {
    const key = window.BP.planDateKey(new Date());
    const plan = persisted.dayPlans.find(p => p.date === key);
    return plan && plan.primarySession ? { type: plan.primarySession.type, dose: plan.primarySession.dose } : null;
});
/** What Today says, as the member reads it. */
const todayCard = (page) => page.evaluate(() => ({
    state: document.getElementById('hq-today-card').dataset.state,
    headline: document.getElementById('today-headline').textContent.trim(),
}));

/** Tap Start, answer the readiness check, press Start again; then read what the engine will run. */
const startFirstSession = (page) => page.evaluate(() => {
    document.getElementById('launch-btn').click();
    document.querySelector('#soreness-btns [data-soreness="none"]').click();
    document.querySelector('#sleep-btns [data-sleep="good"]').click();
    document.getElementById('ready-cta').click();
    const durations = [];
    const was = session.exerciseIndex;
    for (let i = 0; i < ROUTINES[session.routineType].length; i++) { session.exerciseIndex = i; durations.push(getCurEx().duration); }
    session.exerciseIndex = was;
    const snap = _launchedPrescription;
    return { routine: session.routineType, rounds: session.girthTotalRounds, durations,
             xpTier: snap ? snap.xpTier : null, dose: snap ? JSON.parse(JSON.stringify(snap.prescribedDose)) : null };
});
/** Finish the way a member does: every set, every rest skipped, the summary, done. */
const finishSessionAndRead = (page) => page.evaluate(() => {
    _sessionStartTime = Date.now() - 6e5; selectedEQ = 8; selectedRPE = 5;
    for (let i = 0; i < 900; i++) {
        if (session.timer) { session.timer.cancel(); session.timer = null; }
        onSetDone();
        if (!document.getElementById('rest-overlay').classList.contains('hidden')) skipRest();
        const s5 = document.getElementById('step-5');
        if (s5 && !s5.classList.contains('hidden-step')) break;
    }
    finishSession(); closeSessionSummary();
    const e = persisted.sessionLog.at(-1);
    return { xp: e.xpEarned, total: persisted.totalXp, best: persisted.records.bestSessionXp,
             routine: e.routineType, count: persisted.allTimeSessionCount, tierAfter: getDiff().id };
});
/** Every tier this account ever sent to the server. */
const savedTiers = (page) => page.evaluate(() => window.__writes.map(w => w.difficulty));
/** The row the server holds after the writes this browser made, for another device to read. */
const serverRowAfter = async (page, initial) => {
    const writes = await page.evaluate(() => window.__writes);
    const row = Object.assign({}, initial);
    for (const w of writes) { const c = { ...w }; delete c._sync_meta; Object.assign(row, c); }
    return row;
};

// ═══ 1. A new account begins at Beginner, whichever way its row came to be ═══
const NEW_ACCOUNTS = [
    // [name, row, whether this case also runs the whole first session]
    ["no user_data row at all (the app's own new-account path)", null, true],
    ['the row the signup trigger creates today (database default Intermediate)', signupRow('NEW1'), true],
    ['the same row on a table with the revision guard', signupRow('NEW1', { rev: 0, base_rev: null, last_write_id: null, sync_meta: null }), true],
    ['the same row where the column has no default at all (NULL)', signupRow('NEW1', { difficulty: null }), false],
    ['the same row where the column is empty text', signupRow('NEW1', { difficulty: '' }), false],
    ['the same row where the other columns are NULL rather than blank', signupRow('NEW1', { total_xp: null, all_time_session_count: null, session_log: null, measurements: null, seen_milestones: null, progression_ledger: null, week_key: null, xp_migrated: null, first_session_date: null, primary_goal: null, pelvic_profile: null, progress_checkins: null }), false],
    ['the row after the database default is fixed (Beginner)', signupRow('NEW1', { difficulty: 'beginner' }), false],
];
describe('a genuinely new account begins at Beginner', () => {
    test.each(NEW_ACCOUNTS)('%s', async (_name, row, wholeSession) => {
        const app = await signUp(row);
        expect(await tierOf(app.page), 'the tier at sign-in').toBe('beginner');
        await chooseGoal(app.page, 'size');
        expect(await todayCard(app.page)).toEqual({ state: 'TRAIN', headline: 'Girth Day' });
        const plan = await todaysPlan(app.page);
        expect(plan.type).toBe('girth');
        expect(plan.dose, 'the plan generated for the first day is Beginner dosing').toMatchObject({ shape: 'circuit', rounds: BEGINNER.rounds, restDur: BEGINNER.restDur });
        if (wholeSession) {
            const started = await startFirstSession(app.page);
            expect(started.routine).toBe('girth');
            expect({ rounds: started.rounds, durations: started.durations }, 'what the engine will actually run')
                .toEqual({ rounds: BEGINNER.rounds, durations: BEGINNER.durations });
            expect(started.xpTier).toBe('beginner');
            expect(started.dose).toMatchObject({ rounds: BEGINNER.rounds, restDur: BEGINNER.restDur });
            const done = await finishSessionAndRead(app.page);
            expect(done).toEqual({ xp: BEGINNER.xp, total: BEGINNER.xp, best: BEGINNER.xp, routine: 'girth', count: 1, tierAfter: 'beginner' });
            await settle(app.page);
            const tiers = await savedTiers(app.page);
            expect(tiers.length).toBeGreaterThan(0);
            expect(tiers.every(t => t === 'beginner'), 'Intermediate is never sent to the server: ' + JSON.stringify(tiers)).toBe(true);
        }
        expect(app.errors).toEqual([]);
    }, 120_000);
});

// ═══ 2. An explicit choice of Intermediate is kept ════════════════════════
describe('a member who chooses Intermediate keeps it', () => {
    const initial = signupRow('NEW1');
    let first, second, server;

    test('the choice is made through the real tier selector on a new account', async () => {
        first = await signUp(initial);
        expect(await tierOf(first.page)).toBe('beginner');                          // the account began at Beginner...
        const chosen = await first.page.evaluate(async () => {
            goToStep(3);                                                             // ...and the member opens mission select
            const btn = document.querySelector('.diff-btn[data-diff="intermediate"]');
            if (!btn || btn.dataset.locked === 'true') return { missing: true };
            btn.click();
            return { tier: getDiff().id, unlocked: !!(persisted.diffUnlockedDate && persisted.diffUnlockedDate.intermediate) };
        });
        expect(chosen).toEqual({ tier: 'intermediate', unlocked: true });
        await chooseGoal(first.page, 'size');                                        // then picks a goal; the plan is made at their tier
        await settle(first.page);
        expect((await savedTiers(first.page)).at(-1), 'the choice is what the app saved').toBe('intermediate');
        expect(await todaysPlan(first.page)).toMatchObject({ type: 'girth', dose: { rounds: INTERMEDIATE.rounds, restDur: INTERMEDIATE.restDur } });
        server = await serverRowAfter(first.page, initial);
        expect(server.session_log, 'no session was done, so the count is not what decides').toEqual([]);
        expect(server.difficulty).toBe('intermediate');
    }, 120_000);

    test('on another device the same account is still Intermediate: it is not decided again', async () => {
        second = await signUp(server, { onDevice: () => { localStorage.setItem('bp_welcomed_NEW1', '1'); localStorage.setItem('bp_onboarded_NEW1', '1'); } });
        expect(await tierOf(second.page)).toBe('intermediate');
        expect(await todayCard(second.page)).toEqual({ state: 'TRAIN', headline: 'Girth Day' });
    }, 120_000);

    test('their first mechanical session is Intermediate: full dosing and 15 XP', async () => {
        const started = await startFirstSession(second.page);
        expect(started.routine).toBe('girth');
        expect({ rounds: started.rounds, durations: started.durations }).toEqual({ rounds: INTERMEDIATE.rounds, durations: INTERMEDIATE.durations });
        expect(started.xpTier).toBe('intermediate');
        const done = await finishSessionAndRead(second.page);
        expect(done).toEqual({ xp: INTERMEDIATE.xp, total: INTERMEDIATE.xp, best: INTERMEDIATE.xp, routine: 'girth', count: 1, tierAfter: 'intermediate' });
        await settle(second.page);
        expect((await savedTiers(second.page)).every(t => t === 'intermediate')).toBe(true);
    }, 120_000);
});

describe('an explicit choice survives a first save that never reached the server', () => {
    test('the member picks Intermediate with no connection; reopening keeps it', async () => {
        const initial = signupRow('NEW1');
        const app = await signUp(initial, { onDevice: () => { window.__failUpsert = true; } });   // the network is down for every write
        expect(await tierOf(app.page)).toBe('beginner');
        await app.page.evaluate(async () => {
            goToStep(3); document.querySelector('.diff-btn[data-diff="intermediate"]').click();
            await new Promise(r => setTimeout(r, 1500));
        });
        expect(await tierOf(app.page)).toBe('intermediate');
        expect(await app.page.evaluate(() => window.__writes.length), 'nothing reached the server').toBe(0);
        // Reopen with the connection back. The SERVER row is still the untouched signup row.
        await app.page.reload();
        await app.page.waitForTimeout(900);
        await authSignIn(app.page, { id: 'NEW1', email: 'new@example.com', row: initial });
        expect(await tierOf(app.page), "the unsynced choice is the member's own state").toBe('intermediate');
    }, 120_000);
});

// ═══ 3. Returning members are never re-decided ════════════════════════════
describe('nobody the app has already seen is re-decided', () => {
    /** The row after the app has saved it once: what every returning member has. */
    const saved = (id, over = {}) => signupRow(id, { week_key: '2026-W47', xp_migrated: true, ...over });
    const AT = '2026-11-10T10:00:00.000Z';
    const CASES = [
        // The 17 in production: Intermediate by the old default, saved by the app, never trained.
        ['Intermediate, saved by the app, no sessions (the shape of the 17 production accounts)', saved('u1'), 'intermediate'],
        ['Intermediate, saved by the app, with sessions', saved('u2', { all_time_session_count: 5, total_xp: 75, session_log: [{ date: AT, routineType: 'length', xpEarned: 15, sid: 'a' }] }), 'intermediate'],
        ['Beginner, saved by the app', saved('u3', { difficulty: 'beginner' }), 'beginner'],
        ['Advanced, earned', saved('u4', { difficulty: 'advanced', all_time_session_count: 30, total_xp: 600 }), 'advanced'],
        ['Elite, earned', saved('u5', { difficulty: 'elite', all_time_session_count: 90, total_xp: 2000 }), 'elite'],
        ['no tier saved at all on an old member row (as it has always read)', saved('u6', { difficulty: null, all_time_session_count: 8, total_xp: 120 }), 'intermediate'],
        // Each marker ALONE is enough to keep Intermediate: nothing about the session count decides it.
        ['only week_key says the app has been here', signupRow('u7', { week_key: '2026-W47' }), 'intermediate'],
        ['only xp_migrated says the app has been here', signupRow('u8', { xp_migrated: true }), 'intermediate'],
        ['only a recorded tier choice says the member chose', signupRow('u9', { diff_unlocked_date: { intermediate: AT, advanced: '', elite: '' } }), 'intermediate'],
        ['only first_session_date says a tier was tapped', signupRow('u10', { first_session_date: AT }), 'intermediate'],
        ['only a chosen goal says the app has been used', signupRow('u11', { primary_goal: 'size' }), 'intermediate'],
        ['only a programme says the app has been used', signupRow('u12', { programme: { key: 'size' } }), 'intermediate'],
        ['only a dated plan says the app has been used', signupRow('u13', { day_plans: [{ date: '2026-11-23' }] }), 'intermediate'],
        ['only XP says the app has been used', signupRow('u14', { total_xp: 15 }), 'intermediate'],
        ['only a session count says the app has been used', signupRow('u15', { all_time_session_count: 1 }), 'intermediate'],
        ['only a logged session says the app has been used', signupRow('u16', { session_log: [{ date: AT, routineType: 'length', sid: 'z' }] }), 'intermediate'],
        ['only a measurement says the app has been used', signupRow('u17', { measurements: [{ date: AT, bpel: 6.5, sid: 'm' }] }), 'intermediate'],
        ['only a progression entry says the app has been used', signupRow('u18', { progression_ledger: [{ weekKey: '2026-W46' }] }), 'intermediate'],
        ['only a pelvic check says the app has been used', signupRow('u19', { pelvic_profile: 'standard' }), 'intermediate'],
        // And the cases that ARE new, in the same harness, so the table cannot pass by never deciding.
        ['control: the untouched signup row', signupRow('u20'), 'beginner'],
        ['control: the untouched signup row, with the database default fixed', signupRow('u21', { difficulty: 'beginner' }), 'beginner'],
    ];
    test.each(CASES)('%s', async (_name, row, want) => {
        const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' }); apps.push(app);
        await signIn(app.page, { id: row.id, loaded: false });
        const tier = await app.page.evaluate(async (r) => {
            try { localStorage.clear(); } catch (e) {}
            window.__row = r; await loadPersisted();
            return getDiff().id;
        }, row);
        expect(tier).toBe(want);
    }, 60_000);

    test('a returning member stays put through repeated loads', async () => {
        const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' }); apps.push(app);
        await signIn(app.page, { id: 'rm', loaded: false });
        const tiers = await app.page.evaluate(async (r) => {
            try { localStorage.clear(); } catch (e) {}
            const out = [];
            for (let i = 0; i < 3; i++) { window.__row = r; await loadPersisted(); out.push(getDiff().id); }
            return out;
        }, saved('rm'));
        expect(tiers).toEqual(['intermediate', 'intermediate', 'intermediate']);
    }, 60_000);

    test('a returning member who opens the app on a Monday with history keeps their tier and sends nothing else', async () => {
        const app = await signUp(saved('NEW1', {
            difficulty: 'intermediate', primary_goal: 'size', all_time_session_count: 12, total_xp: 180,
            session_log: [{ date: AT, routineType: 'girth', xpEarned: 15, sid: 's1' }],
        }));
        expect(await tierOf(app.page)).toBe('intermediate');
        await settle(app.page);
        expect((await savedTiers(app.page)).every(t => t === 'intermediate')).toBe(true);
    }, 120_000);
});

// ═══ 4. Two devices ═══════════════════════════════════════════════════════
describe('a new account decided on one device is the same on the next', () => {
    test('device two reads Beginner from what device one saved, and does not decide again', async () => {
        const initial = signupRow('NEW1');
        const one = await signUp(initial);
        await chooseGoal(one.page, 'size');
        await settle(one.page);
        const server = await serverRowAfter(one.page, initial);
        expect(server.difficulty).toBe('beginner');
        expect(server.week_key, 'the row is no longer an untouched signup row').toBeTruthy();
        const two = await signUp(server, { onDevice: () => { localStorage.setItem('bp_welcomed_NEW1', '1'); localStorage.setItem('bp_onboarded_NEW1', '1'); } });
        expect(await tierOf(two.page)).toBe('beginner');
    }, 120_000);
});

// ═══ 5. The revision guard must not read the inference as a member's edit ══
describe('the revision guard does not turn the inference into an edit', () => {
    /* Two devices open the same untouched signup row. One infers Beginner and has not
       saved yet. The other, where the member explicitly picked Intermediate, saves
       first. When the first device then writes, the server refuses it (stale revision)
       and the settings are decided three ways: what this tab last synced, what this tab
       holds, what the server holds. If "last synced" were the RAW row (Intermediate), the
       inferred Beginner would look like an edit THIS tab made, and would overwrite the
       member's explicit choice. It is the row as the app read it (Beginner), so it is not
       an edit and the server's choice stands. */
    test("another device's explicit Intermediate is not overwritten by a tab that inferred Beginner", async () => {
        const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' }); apps.push(app);
        const initial = signupRow('rg1', { rev: 0, base_rev: null, last_write_id: null, sync_meta: null });
        await app.page.evaluate((row) => { localStorage.clear(); window.__row = row; window.__revMode = 'soft'; }, initial);
        await signIn(app.page, { id: 'rg1', loaded: false });
        const out = await app.page.evaluate(async () => {
            await loadPersisted();
            const loaded = { tier: getDiff().id, guarded: _protectedFor(currentUser.id) };
            // The other device, which saw the same row, chose Intermediate and saved first.
            const at = new Date().toISOString();
            const refused = window.__applyRevGuard({ base_rev: 0, last_write_id: 'dev2', difficulty: 'intermediate',
                week_key: getCurrentWeekKey(), xp_migrated: true, first_session_date: at,
                diff_unlocked_date: { intermediate: at, advanced: '', elite: '' } });
            window.__writes = [];
            savePersisted();
            const outcome = await _flushSaveNow();                 // this tab writes with a stale revision
            return { loaded, refused, outcome, notice: _syncNotice, tier: getDiff().id, row: window.__row };
        });
        expect(out.loaded).toEqual({ tier: 'beginner', guarded: true });
        expect(out.refused).toBe(null);
        expect(out.row.difficulty, "the member's explicit choice stands on the server").toBe('intermediate');
        expect(out.tier, 'and this tab follows it').toBe('intermediate');
        expect(out.notice, 'nothing of the member was lost, so nothing is reported').toBe(null);
    }, 90_000);

    test('a tab that infers Beginner on a guarded table writes Beginner, and nothing is reported', async () => {
        const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' }); apps.push(app);
        const initial = signupRow('rg2', { rev: 0, base_rev: null, last_write_id: null, sync_meta: null });
        await app.page.evaluate((row) => { localStorage.clear(); window.__row = row; window.__revMode = 'soft'; }, initial);
        await signIn(app.page, { id: 'rg2', loaded: false });
        const out = await app.page.evaluate(async () => {
            await loadPersisted();
            const outcome = await _flushSaveNow();
            return { outcome, notice: _syncNotice, tier: getDiff().id, row: window.__row };
        });
        expect(out.row.difficulty).toBe('beginner');
        expect(out.tier).toBe('beginner');
        expect(out.notice).toBe(null);
    }, 90_000);

    test('a server write that leaves the row untouched does not flip the tier when this tab is then refused', async () => {
        /* Something other than the app (a support edit, a database job) updates the row
           between this tab's load and its first save. Nothing the app stores changes, so the
           row is still an untouched signup row. The refused write re-reads the row, and that
           re-read must be read the same way the load was, or this tab would adopt the raw
           default and flip a new account to Intermediate in front of the member. */
        const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' }); apps.push(app);
        const initial = signupRow('rg3', { rev: 0, base_rev: null, last_write_id: null, sync_meta: null });
        await app.page.evaluate((row) => { localStorage.clear(); window.__row = row; window.__revMode = 'soft'; }, initial);
        await signIn(app.page, { id: 'rg3', loaded: false });
        const out = await app.page.evaluate(async () => {
            await loadPersisted();
            const refused = window.__applyRevGuard({ base_rev: 0, last_write_id: 'ops', updated_at: new Date().toISOString() });
            window.__writes = [];
            savePersisted();
            const outcome = await _flushSaveNow();                 // refused: the revision moved without this tab
            return { refused, outcome, notice: _syncNotice, tier: getDiff().id, rev: window.__row.rev,
                     sent: window.__writes.map(w => w.difficulty) };
        });
        expect(out.refused).toBe(null);
        expect(out.rev, 'the row really did move on without this tab').toBeGreaterThanOrEqual(1);
        expect(out.tier).toBe('beginner');
        expect(out.sent.every(t => t === 'beginner'), 'only Beginner is ever sent: ' + JSON.stringify(out.sent)).toBe(true);
        expect(out.notice).toBe(null);
    }, 90_000);
});
