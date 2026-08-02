import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The regression this guards is the one that actually cost members their
 * progress.
 *
 * If loadPersisted() could not read a member's row (slow connection, timeout)
 * and the device had no localStorage backup, `persisted` was left holding
 * DEFAULT_PERSISTED. Nothing marked that as an unloaded state, so the next
 * ordinary save — the daily tip rotating, the weekly reset — upserted zeros
 * straight over the real row. A returning member on a new phone with bad signal
 * could be wiped without touching anything.
 *
 * If this test ever fails, stop and fix it before shipping.
 */
describe('a failed load must never overwrite the server row', () => {
    let app;
    beforeAll(async () => { app = await openApp({ hangRead: true }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('no zeroed write reaches Supabase when the read times out', async () => {
        const { page } = app;

        // A returning member on a device with no local backup.
        await page.evaluate(() => localStorage.clear());
        await signIn(page, { id: 'veteran', email: 'v@v.com', loaded: false });

        await page.evaluate(() => loadPersisted());
        await page.waitForTimeout(9_000); // the app's own read timeout is 8s

        // In-memory state is defaults, which is expected. What matters is that
        // the app knows it never loaded.
        const loadedFlag = await page.evaluate(() => _persistedLoaded);
        expect(loadedFlag).toBe(false);

        // Now do what the app normally does on reaching the HQ.
        await page.evaluate(() => { goToStep(0); renderDailyTip(); });
        await page.waitForTimeout(1_200);
        await page.evaluate(() => _flushSaveNow());
        await page.waitForTimeout(600);

        const writes = await page.evaluate(() => window.__writes.map(w => ({
            total_xp: w.total_xp, sessions: (w.session_log || []).length,
        })));

        expect(writes).toEqual([]);
        expect(app.errors).toEqual([]);
    }, 40_000);

    test('the member is told, rather than shown a silently empty dashboard', async () => {
        const bannerHidden = await app.page.evaluate(
            () => document.getElementById('hq-load-failed-banner').classList.contains('hidden'));
        expect(bannerHidden).toBe(false);
    });
});
