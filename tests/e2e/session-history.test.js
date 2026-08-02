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
        session.routineType = 'length'; selectedEQ = 7; selectedRPE = 5;
        _sessionStartTime = Date.now() - 6e5;
        document.getElementById('input-bpel').value = '';
        document.getElementById('input-mseg').value = '';
        document.getElementById('session-note-input').value = n;
        finishSession();
        document.getElementById('session-summary-modal').classList.remove('show');
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
