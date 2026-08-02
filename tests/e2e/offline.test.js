import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * The write guard added after the data-loss incident blocks saving until the
 * app knows the server state. This checks it does not overreach: a member whose
 * device has a local backup is a known-good state, so they must still load and
 * still save even with the network down.
 */
describe('offline member with a local backup', () => {
    let app, state;
    beforeAll(async () => {
        app = await openApp({ hangRead: true });
        await app.page.evaluate((entry) => {
            localStorage.setItem('bp_data_off', JSON.stringify({
                totalXp: 900, difficulty: 'intermediate', allTimeSessionCount: 40,
                sessionLog: [entry], measurements: [], seenMilestones: [],
                schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
                completedDays: [false, false, false, false, false, false, false],
                records: { longestStreak: 5, bestWeekXp: 60, bestSessionXp: 20 },
                _savedAt: new Date().toISOString(),
            }));
        }, sessionEntry(0));
        await signIn(app.page, { id: 'off', email: 'o@o.com', loaded: false });
        await app.page.evaluate(() => loadPersisted());
        await app.page.waitForTimeout(9_000); // wait out the read timeout
        state = await app.page.evaluate(() => ({
            xp: persisted.totalXp, count: persisted.allTimeSessionCount, loaded: _persistedLoaded,
            bannerHidden: document.getElementById('hq-load-failed-banner').classList.contains('hidden'),
        }));
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('restores from the local backup', () => {
        expect(state.xp).toBe(900);
        expect(state.count).toBe(40);
    });

    test('counts as loaded, so saving stays enabled', () => {
        expect(state.loaded).toBe(true);
    });

    test('shows no alarming banner when the backup covered it', () => {
        expect(state.bannerHidden).toBe(true);
    });

    test('can still save', async () => {
        await app.page.evaluate(() => { window.__writes = []; _flushSaveNow(); });
        await app.page.waitForTimeout(700);
        const writes = await app.page.evaluate(() => window.__writes);
        expect(writes).toHaveLength(1);
        expect(writes[0].total_xp).toBe(900);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
