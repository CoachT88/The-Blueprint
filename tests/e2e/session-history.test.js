import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * The session log used to be trimmed to the last 50 entries, which silently
 * deleted the history of whoever had been here longest. It is now bounded by
 * serialised size instead, because a count is not a size: the note field is free
 * text and one entry can be arbitrarily large.
 */
describe('history retention', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'hist' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const logSession = (note = '') => app.page.evaluate((n) => {
        captureLaunchPrescription();   /* the production launch capture: finishSession records the prescription the session LAUNCHED under, so a harness that sets routineType by hand must freeze it the same way the real startMission() does */
        session.routineType = 'length'; selectedEQ = 7; selectedRPE = 5;
        _sessionStartTime = Date.now() - 6e5;
        document.getElementById('input-bpel').value = '';
        document.getElementById('input-mseg').value = '';
        document.getElementById('session-note-input').value = n;
        finishSession();
        /* The real way out, not just hiding the modal: closeSessionSummary()
           is the only thing that releases the one-shot finish guard, and a
           member cannot complete twice without going through it. */
        closeSessionSummary();
    }, note);

    test('far more than 50 sessions are all kept', async () => {
        await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.allTimeSessionCount = 0; persisted.measurements = [];
        });
        for (let i = 0; i < 60; i++) await logSession();
        const r = await app.page.evaluate(() => ({
            logged: persisted.sessionLog.length, lifetime: persisted.allTimeSessionCount,
        }));
        expect(r.logged).toBe(60);        // would have been 50 before
        expect(r.lifetime).toBe(60);
    }, 90_000);

    test('the byte budget drops oldest-first and holds the ceiling', async () => {
        const r = await app.page.evaluate(() => {
            const budget = SESSION_LOG_BUDGET_BYTES;
            // Build a log that overshoots the budget outright.
            const fat = 'x'.repeat(400);
            const arr = [];
            for (let i = 0; i < 2000; i++) {
                arr.push({ date: new Date(Date.now() - (2000 - i) * 6e4).toISOString(), routineType: 'length', xpEarned: 15, note: fat, eq: 7, rpe: 5, duration: 10 });
            }
            const before = arr.length;
            const trimmed = trimToByteBudget(arr, budget);
            return {
                before, after: trimmed.length,
                bytes: JSON.stringify(trimmed).length, budget,
                // Oldest dropped, newest kept.
                keptNewest: trimmed[trimmed.length - 1].date === arr[arr.length - 1].date,
                droppedOldest: trimmed[0].date !== arr[0].date,
            };
        });
        expect(r.after).toBeLessThan(r.before);
        expect(r.bytes).toBeLessThanOrEqual(r.budget);
        expect(r.keptNewest).toBe(true);
        expect(r.droppedOldest).toBe(true);
    });

    test('a single entry is never discarded, even if it alone exceeds the budget', async () => {
        const len = await app.page.evaluate(
            () => trimToByteBudget([{ note: 'y'.repeat(500_000) }], SESSION_LOG_BUDGET_BYTES).length);
        expect(len).toBe(1);
    });

    test('notes are bounded at the input and again when read', async () => {
        const maxAttr = await app.page.evaluate(
            () => document.getElementById('session-note-input').getAttribute('maxlength'));
        expect(maxAttr).toBe('500');

        // Bypass the attribute the way a paste-and-script would.
        await app.page.evaluate(() => { persisted.sessionLog = []; });
        await logSession('z'.repeat(5_000));
        const noteLen = await app.page.evaluate(() => persisted.sessionLog.at(-1).note.length);
        expect(noteLen).toBe(500);
    }, 30_000);
});

describe('full history rendering', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'hist2' });
        await app.page.evaluate((log) => { persisted.sessionLog = log; },
            Array.from({ length: 130 }, (_, i) => sessionEntry(129 - i)));  // newest is today
        await app.page.evaluate(() => showSessionHistory());
        await app.page.waitForTimeout(400);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('renders a page at a time rather than thousands of rows', async () => {
        const r = await app.page.evaluate(() => ({
            rows: document.querySelectorAll('#history-list .instruction-card').length,
            hasMore: !!document.getElementById('history-load-more'),
            total: persisted.sessionLog.length,
        }));
        expect(r.total).toBe(130);
        expect(r.rows).toBe(50);
        expect(r.hasMore).toBe(true);
    });

    test('newest first', async () => {
        const firstRowDate = await app.page.evaluate(() => {
            const el = document.querySelector('#history-list .instruction-card p.text-\\[10px\\]');
            return el ? el.textContent : '';
        });
        // The most recent entry is "today"; the oldest is ~130 days back.
        const expected = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        expect(firstRowDate).toContain(expected);
    });

    test('Load more appends the next page and finishes cleanly', async () => {
        await app.page.evaluate(() => document.getElementById('history-load-more').click());
        await app.page.waitForTimeout(250);
        let rows = await app.page.evaluate(() => document.querySelectorAll('#history-list .instruction-card').length);
        expect(rows).toBe(100);

        await app.page.evaluate(() => document.getElementById('history-load-more').click());
        await app.page.waitForTimeout(250);
        const r = await app.page.evaluate(() => ({
            rows: document.querySelectorAll('#history-list .instruction-card').length,
            hasMore: !!document.getElementById('history-load-more'),
            text: document.getElementById('history-list').textContent,
        }));
        expect(r.rows).toBe(130);
        expect(r.hasMore).toBe(false);
        expect(r.text).toMatch(/All 130 sessions shown/);
    }, 30_000);

    test('a note containing markup renders as text, not as HTML', async () => {
        // The HQ list escaped the note; Full History interpolated it raw. Combined
        // with an unvalidated import, that was a script-execution path.
        const r = await app.page.evaluate(() => {
            window.__xssFired = false;
            persisted.sessionLog = [{
                date: new Date().toISOString(), routineType: 'length', xpEarned: 15,
                note: '<img src=x onerror="window.__xssFired=true">bad', eq: 7, rpe: 5, duration: 10,
            }];
            showSessionHistory();
            return { html: document.getElementById('history-list').innerHTML };
        });
        await app.page.waitForTimeout(300);
        const fired = await app.page.evaluate(() => window.__xssFired);
        expect(fired).toBe(false);
        expect(r.html).not.toMatch(/<img src=x/);
        expect(r.html).toMatch(/&lt;img/);
        expect(app.errors).toEqual([]);
    }, 30_000);

    test('an empty log still shows its empty state', async () => {
        const text = await app.page.evaluate(() => {
            persisted.sessionLog = []; showSessionHistory();
            return document.getElementById('history-list').textContent;
        });
        expect(text).toMatch(/No sessions logged yet/);
    });
});

describe('storage safety', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'stor' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a full quota is surfaced instead of silently dropping the backup', async () => {
        const r = await app.page.evaluate(() => {
            const orig = Storage.prototype.setItem;
            // Fail only the main data blob, the way a real quota would.
            Storage.prototype.setItem = function (k, v) {
                if (k.startsWith('bp_data_')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
                return orig.call(this, k, v);
            };
            const ok = _writeLocalBackup();
            Storage.prototype.setItem = orig;
            return {
                ok,
                bannerShown: !document.getElementById('hq-storage-full-banner').classList.contains('hidden'),
                // The dirty flag must not claim there is an unsynced local copy.
                dirty: localStorage.getItem('bp_dirty_stor'),
            };
        });
        expect(r.ok).toBe(false);
        expect(r.bannerShown).toBe(true);
        expect(r.dirty).toBeNull();
    });

    test('stale date-keyed entries are pruned, current ones survive', async () => {
        const r = await app.page.evaluate(() => {
            const old = new Date(Date.now() - 200 * 864e5).toISOString().split('T')[0];
            const today = new Date().toISOString().split('T')[0];
            localStorage.setItem(`bp_hydration_stor_${old}`, '1500');
            localStorage.setItem(`bp_sleep_stor_${old}`, 'good');
            localStorage.setItem(`bp_soreness_stor_${old}`, 'mild');
            localStorage.setItem(`bp_hydration_stor_${today}`, '2000');
            localStorage.setItem('bp_hydration_unit_stor', 'L');   // not date-keyed
            const removed = pruneOldDailyKeys();
            return {
                removed,
                oldGone: localStorage.getItem(`bp_hydration_stor_${old}`) === null,
                todayKept: localStorage.getItem(`bp_hydration_stor_${today}`),
                unitKept: localStorage.getItem('bp_hydration_unit_stor'),
            };
        });
        expect(r.removed).toBeGreaterThanOrEqual(3);
        expect(r.oldGone).toBe(true);
        expect(r.todayKept).toBe('2000');
        expect(r.unitKept).toBe('L');   // the non-dated key must not be swept up
    });

    test('an oversized import is refused without touching stored data', async () => {
        const r = await app.page.evaluate(() => {
            persisted.totalXp = 999;
            const big = new File(['x'.repeat(IMPORT_MAX_BYTES + 10)], 'b.json', { type: 'application/json' });
            importData(big);
            return { xp: persisted.totalXp };
        });
        expect(r.xp).toBe(999);
    });

    test('a malformed import is refused', async () => {
        const r = await app.page.evaluate(async () => {
            persisted.totalXp = 777;
            const bad = new File([JSON.stringify({ sessionLog: 'not-an-array' })], 'b.json', { type: 'application/json' });
            importData(bad);
            await new Promise(res => setTimeout(res, 300));
            return { xp: persisted.totalXp };
        });
        expect(r.xp).toBe(777);
        expect(app.errors).toEqual([]);
    }, 30_000);

    test('export contains the full retained history', async () => {
        const count = await app.page.evaluate(() => {
            persisted.sessionLog = Array.from({ length: 120 }, (_, i) => ({
                date: new Date(Date.now() - i * 864e5).toISOString(),
                routineType: 'length', xpEarned: 15, note: '', eq: 7, rpe: 5, duration: 10,
            }));
            return JSON.parse(JSON.stringify(persisted)).sessionLog.length;
        });
        expect(count).toBe(120);
    });
});

/**
 * scheduledType, prescriptionDate and manualOverride are ONE snapshot, and it
 * is taken at LAUNCH.
 *
 * This block used to prove something weaker. finishSession() resolved the
 * scheduled type twice, from a function that read the clock on every call, so
 * a rollover between the two reads could record an override that never
 * happened. The fix then was to resolve once, at completion.
 *
 * Phase 3C.4 proved that was still wrong. Resolving once at COMPLETION still
 * asks "what is scheduled now", so a Thursday session finished at 00:10
 * recorded Friday's rest day as its prescription and called the member's
 * perfect compliance a manual override. The identity now comes from the
 * prescription the session LAUNCHED under, frozen at launch, so nothing that
 * happens afterwards can move it: not a rerender, not a soreness change, not
 * midnight, not a week rollover, not a regenerated plan.
 *
 * The old stub is gone with the function it stubbed. These assert the
 * stronger property directly, by changing the programme under a session
 * already in flight.
 */
describe('the prescription identity is frozen at launch', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'snap', persisted: { schedule: Array(7).fill('length') } });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Launch, move the world, finish. */
    const finishAfterUpheaval = (upheaval) => app.page.evaluate((how) => {
        persisted.sessionLog = [];
        persisted.schedule = Array(7).fill('length');
        /* The REAL launch door, so the capture and its ordering are the
           production ones rather than a harness approximation. */
        startMission('length', 'test');
        const captured = JSON.parse(JSON.stringify(_launchedPrescription));
        /* Now change everything a session in flight could be exposed to. */
        if (how === 'schedule') persisted.schedule = Array(7).fill('girth');
        if (how === 'soreness') { try { localStorage.setItem(getTodaySorenessKey(), 'moderate'); } catch (e) {} }
        if (how === 'rerender') { renderDashboard(); renderReady(); }
        if (how === 'plans') persisted.dayPlans = [];
        selectedEQ = 7; selectedRPE = 5;
        _sessionStartTime = Date.now() - 6e5;
        document.getElementById('input-bpel').value = '';
        document.getElementById('input-mseg').value = '';
        document.getElementById('session-note-input').value = '';
        finishSession();
        const e = persisted.sessionLog[persisted.sessionLog.length - 1];
        closeSessionSummary();
        try { localStorage.removeItem(getTodaySorenessKey()); } catch (e2) {}
        return { captured, scheduledType: e.scheduledType, prescriptionDate: e.prescriptionDate,
                 manualOverride: e.manualOverride, routineType: e.routineType, date: e.date };
    }, upheaval);

    test.each(['schedule', 'soreness', 'rerender', 'plans'])(
        'a %s change after launch cannot rewrite the identity', async (how) => {
            const r = await finishAfterUpheaval(how);
            expect(r.captured.scheduledType).toBe('length');
            expect(r.scheduledType).toBe('length');
            expect(r.prescriptionDate).toBe(r.captured.prescriptionDate);
            /* The session ran exactly what was prescribed, so it is not an
               override. Re-resolving after the upheaval would have compared
               'length' against 'girth' and invented one. */
            expect(r.routineType).toBe('length');
            expect(r.manualOverride).toBe(false);
        }, 60_000);

    test('the completion timestamp and the prescription date are separate truths', async () => {
        const r = await finishAfterUpheaval('rerender');
        /* Same day here, so they agree, and they are still two fields. The
           midnight case where they disagree is in the browser suite's
           prescription-authority file, with a pinned clock. */
        expect(r.date).toContain('T');
        expect(r.prescriptionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.date.startsWith(r.prescriptionDate)).toBe(true);
    }, 60_000);

    test('a genuine substitution is still recorded as one', async () => {
        /* THROUGH THE REAL MANUAL DOOR, which matters more than it looks.
           An earlier version of this test called startMission('length') and
           then overwrote session.routineType, which is not how production
           substitutes: the Mission Select handler sets _manualMission and
           then calls startMission with the CHOSEN mission, so the argument
           is 'girth' and the prescription is still 'length'. A mutation that
           built the snapshot from startMission's argument survived the
           approximation and dies against this.

           The real handler is used, not a reimplementation of it. */
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = [];
            persisted.schedule = Array(7).fill('length');
            try { localStorage.setItem(getTodaySorenessKey(), 'none'); } catch (e) {}
            renderToday();
            goToStep(3);
            /* Tap Girth on a Length day. readinessAnswered() is true, so this
               goes straight into startMission('girth', 'manual'). */
            document.getElementById('mission-girth-btn').click();
            const launchedAs = session.routineType;
            const snapshot = _launchedPrescription ? { ..._launchedPrescription } : null;
            selectedEQ = 7; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            const e = persisted.sessionLog[persisted.sessionLog.length - 1];
            closeSessionSummary();
            try { localStorage.removeItem(getTodaySorenessKey()); } catch (e2) {}
            return { launchedAs, snapshot, scheduledType: e.scheduledType,
                     routineType: e.routineType, manualOverride: e.manualOverride };
        });
        /* startMission really was called with the member's choice. */
        expect(r.launchedAs).toBe('girth');
        /* And the snapshot is the PROGRAMME's day, not the argument. */
        expect(r.snapshot.scheduledType).toBe('length');
        expect(r.scheduledType).toBe('length');
        expect(r.routineType).toBe('girth');
        expect(r.manualOverride).toBe(true);
    }, 60_000);
});
