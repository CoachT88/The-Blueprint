import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * "You're officially underway." Phase 2B.3.3.
 *
 * One acknowledgment, the first time a qualifying mechanical session sets
 * programme_start_date. It means the programme has begun and nothing more:
 * not that adaptation has started, not that results are underway, not that
 * anything has changed physically.
 *
 * The gate is the existing control flow rather than new storage, so most of
 * this file is about proving the things that must NOT trigger it.
 */

const LINE = "officially underway";
const EVERY_DAY = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];

/** A member with no history at all, nothing started. */
const brandNew = (page, { schedule = EVERY_DAY, patch = {} } = {}) => page.evaluate(({ schedule, patch }) => {
    _persistedLoaded = true;
    persisted.primaryGoal = 'all';
    persisted.pelvicProfile = 'standard';
    persisted.schedule = [...schedule];
    persisted.completedDays = [false, false, false, false, false, false, false];
    persisted.sessionLog = [];
    persisted.progressionLedger = [];
    persisted.programmeStartDate = null;
    persisted.allTimeSessionCount = 0;
    persisted.firstSessionDate = '';
    persisted.streakPasses = 0;
    persisted.lastPassEarnedDate = '';
    Object.assign(persisted, patch);
    try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
    renderDashboard();
    return { start: persisted.programmeStartDate };
}, { schedule, patch });

/** Finish a session through the real path and read the summary. */
const finish = (page, routineType = 'length') => page.evaluate((routineType) => {
    captureLaunchPrescription();   /* the production launch capture: finishSession records the prescription the session LAUNCHED under, so a harness that sets routineType by hand must freeze it the same way the real startMission() does */
    session.routineType = routineType;
    _sessionStartTime = Date.now() - 30 * 60000;
    selectedEQ = 8; selectedRPE = 5;
    document.getElementById('input-bpel').value = '';
    document.getElementById('input-mseg').value = '';
    document.getElementById('session-note-input').value = '';
    finishSession();
    const out = {
        records: document.getElementById('summary-records').textContent,
        start: persisted.programmeStartDate,
        flag: _programmeStartedThisSession,
    };
    closeSessionSummary();
    return out;
}, routineType);

describe('the first qualifying mechanical session', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'fs1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: it is acknowledged, once', async () => {
        const before = await brandNew(app.page);
        expect(before.start).toBeNull();
        const r = await finish(app.page);
        expect(r.start).toBeTruthy();                 // the programme began
        expect(r.records).toContain(LINE);
    }, 30_000);

    test('the second session does not repeat it', async () => {
        const r = await finish(app.page);
        expect(r.flag).toBe(false);
        expect(r.records).not.toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: reopening the app does not repeat it', async () => {
        // The summary has one caller, so there is nothing to re-render, and
        // the flag does not survive a reload.
        await brandNew(app.page);
        await finish(app.page);
        const after = await app.page.evaluate(() => {
            goToStep(4); goToStep(0);
            renderDashboard();
            return { records: document.getElementById('summary-records').textContent,
                     flag: _programmeStartedThisSession,
                     hqText: document.getElementById('step-0').textContent };
        });
        expect(after.hqText).not.toContain(LINE);
        // The flag is still set from that completion but nothing renders it
        // again, because showSessionSummary() is not called on a reopen.
        expect(after.flag).toBe(true);
        const next = await finish(app.page);
        expect(next.records).not.toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: Recovery does not trigger it', async () => {
        const before = await brandNew(app.page);
        expect(before.start).toBeNull();
        const r = await finish(app.page, 'recovery');
        expect(r.start).toBeNull();                   // Recovery starts nothing
        expect(r.flag).toBe(false);
        expect(r.records).not.toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: a debut Recovery session no longer costs them the line', async () => {
        /* Their first mechanical session is their second overall. The
           threshold this replaced excluded them; the proof does not,
           because the retained history is demonstrably whole and contains
           no earlier mechanical session. */
        const r = await finish(app.page, 'length');
        expect(r.start).toBeTruthy();
        expect(r.records).toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: several Recovery sessions first still gets the line', async () => {
        await brandNew(app.page);
        await finish(app.page, 'recovery');
        await finish(app.page, 'recovery');
        const r = await finish(app.page, 'length');
        expect(r.records).toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: retained history already holding mechanical work refuses', async () => {
        /* A member can hold mechanical history AND a null programme start,
           because the backfill will not date anyone without corroboration.
           The completeness count alone would wave this through. */
        await brandNew(app.page, { patch: {
            allTimeSessionCount: 2,
            sessionLog: [
                { date: new Date(Date.now() - 5 * 86400000).toISOString(), routineType: 'length', duration: 30 },
                { date: new Date(Date.now() - 2 * 86400000).toISOString(), routineType: 'recovery', duration: 20 },
            ],
        } });
        const r = await finish(app.page, 'length');
        expect(r.start).toBeTruthy();               // the date does get set
        expect(r.flag).toBe(false);                 // but they are not new
        expect(r.records).not.toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: a pruned log refuses even when the last sessions were Recovery', async () => {
        await brandNew(app.page, { patch: {
            allTimeSessionCount: 300,
            sessionLog: [
                { date: new Date(Date.now() - 3 * 86400000).toISOString(), routineType: 'recovery', duration: 20 },
            ],
        } });
        const r = await finish(app.page, 'length');
        expect(r.flag).toBe(false);
        expect(r.records).not.toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: an established member is not told they are starting', async () => {
        // Months of history, start date unknowable because the log was
        // pruned. They must never be congratulated on a first session.
        await brandNew(app.page, { patch: {
            allTimeSessionCount: 300,
            firstSessionDate: '2024-01-01T00:00:00.000Z',
            sessionLog: [{ date: new Date(Date.now() - 3 * 86400000).toISOString(), routineType: 'length', duration: 30 }],
        } });
        const r = await app.page.evaluate(() => {
            // The backfill decides what it decides; what matters is that a
            // completion afterwards does not read as a first session.
            const back = window.BP.programmeStartBackfill({
                programmeStartDate: persisted.programmeStartDate,
                sessionLog: persisted.sessionLog,
                firstSessionDate: persisted.firstSessionDate,
                allTimeSessionCount: persisted.allTimeSessionCount,
                now: new Date(),
            });
            if (back && back.date) persisted.programmeStartDate = back.date;
            return { backfilled: persisted.programmeStartDate };
        });
        expect(r.backfilled).toBe('2024-01-01');     // from the legacy date
        const done = await finish(app.page);
        expect(done.flag).toBe(false);
        expect(done.records).not.toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: nor is one whose start is genuinely unknowable', async () => {
        /* The hole these tests found. A long-tenured member with a pruned
           log and no legacy firstSessionDate backfills as
           "established-start-unknown", which correctly leaves the date
           null. Their next completion sets it, and without the lifetime
           count check they would be congratulated on starting a programme
           they are three hundred sessions into. */
        await brandNew(app.page, { patch: {
            allTimeSessionCount: 300,
            firstSessionDate: '',
            sessionLog: [{ date: new Date(Date.now() - 3 * 86400000).toISOString(), routineType: 'length', duration: 30 }],
        } });
        const unknown = await app.page.evaluate(() => window.BP.programmeStartBackfill({
            programmeStartDate: persisted.programmeStartDate,
            sessionLog: persisted.sessionLog,
            firstSessionDate: persisted.firstSessionDate,
            allTimeSessionCount: persisted.allTimeSessionCount,
            now: new Date(),
        }));
        expect(unknown.date).toBeNull();
        expect(unknown.established).toBe(true);
        const done = await finish(app.page);
        expect(done.start).toBeTruthy();            // the date does get set
        expect(done.flag).toBe(false);              // but this is no first session
        expect(done.records).not.toContain(LINE);
    }, 30_000);

    test('REGRESSION: a start already set is never re-announced', async () => {
        await brandNew(app.page, { patch: { programmeStartDate: '2025-01-01' } });
        const r = await finish(app.page);
        expect(r.start).toBe('2025-01-01');            // never moved
        expect(r.flag).toBe(false);
        expect(r.records).not.toContain(LINE);
    }, 30_000);

    test('ACCEPTANCE: Week Complete outranks it', async () => {
        // A one-session week for a brand new member, so the same completion
        // starts the programme AND finishes the week.
        const r = await app.page.evaluate(() => {
            const today = new Date().getDay();
            _persistedLoaded = true;
            persisted.primaryGoal = 'all'; persisted.pelvicProfile = 'standard';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => i === today ? 'length' : 'rest');
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            persisted.progressionLedger = [];
            persisted.programmeStartDate = null;
            persisted.allTimeSessionCount = 0;
            persisted.firstSessionDate = '';
            captureLaunchPrescription();   /* the production launch capture: finishSession records the prescription the session LAUNCHED under, so a harness that sets routineType by hand must freeze it the same way the real startMission() does */
            session.routineType = 'length';
            _sessionStartTime = Date.now() - 30 * 60000;
            selectedEQ = 8; selectedRPE = 5;
            ['input-bpel', 'input-mseg', 'session-note-input'].forEach(id => { document.getElementById(id).value = ''; });
            finishSession();
            const out = { records: document.getElementById('summary-records').textContent,
                          flag: _programmeStartedThisSession, weekComplete: currentWeekComplete() };
            closeSessionSummary();
            renderDashboard();
            out.liveness = document.getElementById('today-liveness').dataset.liveness || null;
            return out;
        });
        expect(r.flag).toBe(true);                     // it did start the programme
        expect(r.weekComplete).toBe(true);             // and finished the week
        expect(r.records).not.toContain(LINE);         // so only one line shows
        expect(r.liveness).toBe('week-complete');
    }, 30_000);

    test('ACCEPTANCE: account A\'s acknowledgment does not affect B', async () => {
        await brandNew(app.page);
        const a = await finish(app.page);
        expect(a.records).toContain(LINE);
        const b = await app.page.evaluate(() => {
            currentUser = { id: 'other', email: 'other@example.com', user_metadata: {} };
            return _programmeStartedThisSession;
        });
        // Nothing was persisted, so B starts from a clean slate.
        await brandNew(app.page);
        const second = await finish(app.page);
        expect(b).toBe(true);                          // A's in-memory flag
        expect(second.records).toContain(LINE);        // B still gets their own
    }, 30_000);

    test('the copy claims only that the programme began', async () => {
        await brandNew(app.page);
        const r = await finish(app.page);
        const line = r.records;
        expect(line).toContain(LINE);
        expect(line).not.toMatch(/adapt|vascular|hormon|tissue|erection|blood flow|testosterone/i);
        expect(line).not.toMatch(/result|transform|guarantee|gains|improve/i);
        expect(line).not.toMatch(/discipline|committed|willpower/i);
    }, 30_000);

    test('no name is used here', async () => {
        await brandNew(app.page);
        await app.page.evaluate(() => { currentUser = { ...currentUser, user_metadata: { preferred_name: 'Zebediah' } }; });
        const r = await finish(app.page);
        expect(r.records).toContain(LINE);
        expect(r.records).not.toContain('Zebediah');
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
