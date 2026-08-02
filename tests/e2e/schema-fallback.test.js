import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Supabase rejects an entire upsert when one column is unknown. Without a
 * fallback, deploying a feature before its ALTER TABLE would silently stop every
 * member from syncing anything — the same failure mode as the data-loss bug,
 * arriving by a different route.
 *
 * The app detects that specific error once, drops only the new columns, and
 * retries. Core data keeps saving either way.
 */
describe('an unmigrated column cannot break saving', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ rejectColumns: ['streak_passes'] });
        await signIn(app.page, { id: 'u8', persisted: { totalXp: 123, streakPasses: 1 } });
        await app.page.evaluate(() => localStorage.setItem('bp_dirty_u8', '1'));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('retries without the new columns and still persists the real data', async () => {
        await app.page.evaluate(() => { window.__writes = []; _flushSaveNow(); });
        await app.page.waitForTimeout(700);

        const r = await app.page.evaluate(() => ({
            attemptKeys: window.__writes.map(w => Object.keys(w)),
            dirtyCleared: !localStorage.getItem('bp_dirty_u8'),
            flagged: _schemaMissingNewCols,
        }));

        // The rejected first attempt is never recorded (the stub only records
        // accepted writes), so exactly one write lands: the trimmed retry.
        expect(r.attemptKeys).toHaveLength(1);
        const keys = r.attemptKeys[0];
        expect(keys).not.toContain('streak_passes');
        expect(keys).toContain('total_xp');
        expect(keys).toContain('session_log');
        expect(r.dirtyCleared).toBe(true);
        expect(r.flagged).toBe(true);
    }, 30_000);

    test('later saves skip straight to the trimmed payload', async () => {
        await app.page.evaluate(() => { window.__writes = []; _flushSaveNow(); });
        await app.page.waitForTimeout(600);
        const count = await app.page.evaluate(() => window.__writes.length);
        expect(count).toBe(1);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
