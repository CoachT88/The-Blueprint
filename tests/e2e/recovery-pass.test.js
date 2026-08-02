import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * One Recovery Pass is earned per seven-day streak, capped at two, and spent
 * automatically to cover a missed day. The consume path is deliberately
 * conservative — the four no-op cases below are the ones that would otherwise
 * hand out free streaks.
 */
describe('recovery pass', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'u7' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const seed = (daysAgoList) => app.page.evaluate((list) => {
        persisted.sessionLog = list.map(d => ({
            date: new Date(Date.now() - d * 864e5).toISOString(),
            routineType: 'length', eq: 7, rpe: 5, xpEarned: 15,
        }));
        persisted.streakPasses = 0;
        persisted.passProtectedDates = [];
        persisted.lastPassEarnedDate = '';
    }, daysAgoList);

    test('a seven-day streak earns exactly one pass', async () => {
        await seed([6, 5, 4, 3, 2, 1, 0]);
        const r = await app.page.evaluate(() => ({
            streak: getCurrentStreak(), earned: maybeEarnStreakPass(), passes: persisted.streakPasses,
        }));
        expect(r.streak).toBe(7);
        expect(r.earned).toBe(true);
        expect(r.passes).toBe(1);
    });

    test('and cannot be earned twice on the same day', async () => {
        const r = await app.page.evaluate(() => ({
            earned: maybeEarnStreakPass(), passes: persisted.streakPasses,
        }));
        expect(r.earned).toBe(false);
        expect(r.passes).toBe(1);
    });

    test('a five-day streak earns nothing', async () => {
        await seed([4, 3, 2, 1, 0]);
        const r = await app.page.evaluate(() => ({ earned: maybeEarnStreakPass(), passes: persisted.streakPasses }));
        expect(r.earned).toBe(false);
        expect(r.passes).toBe(0);
    });

    test('the cap of two holds', async () => {
        await seed([6, 5, 4, 3, 2, 1, 0]);
        const r = await app.page.evaluate(() => {
            persisted.streakPasses = 2; persisted.lastPassEarnedDate = '';
            return { earned: maybeEarnStreakPass(), passes: persisted.streakPasses };
        });
        expect(r.earned).toBe(false);
        expect(r.passes).toBe(2);
    });

    test('a missed day is covered and the streak survives', async () => {
        const r = await app.page.evaluate(() => {
            // Trained 4, 3 and 2 days ago. Yesterday missed.
            persisted.sessionLog = [4, 3, 2].map(d => ({
                date: new Date(Date.now() - d * 864e5).toISOString(),
                routineType: 'length', eq: 7, rpe: 5, xpEarned: 15,
            }));
            persisted.streakPasses = 1;
            persisted.passProtectedDates = [];
            const before = getCurrentStreak();
            const consumed = maybeConsumeStreakPass();
            return { before, consumed, after: getCurrentStreak(), passes: persisted.streakPasses };
        });
        expect(r.before).toBe(0);        // streak already broken
        expect(r.consumed).toBe(true);
        expect(r.after).toBe(4);         // rescued
        expect(r.passes).toBe(0);
    });

    test.each([
        ['the same day twice', () => maybeConsumeStreakPass()],
    ])('does not consume for %s', async (_label) => {
        expect(await app.page.evaluate(() => maybeConsumeStreakPass())).toBe(false);
    });

    test('does not consume with no passes banked', async () => {
        const r = await app.page.evaluate(() => {
            persisted.streakPasses = 0; persisted.passProtectedDates = [];
            return maybeConsumeStreakPass();
        });
        expect(r).toBe(false);
    });

    test('does not consume when yesterday was trained', async () => {
        await seed([2, 1, 0]);
        const r = await app.page.evaluate(() => { persisted.streakPasses = 1; return maybeConsumeStreakPass(); });
        expect(r).toBe(false);
    });

    test('cannot resurrect a long-dead streak', async () => {
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = [{
                date: new Date(Date.now() - 30 * 864e5).toISOString(),
                routineType: 'length', eq: 7, rpe: 5, xpEarned: 15,
            }];
            persisted.streakPasses = 1; persisted.passProtectedDates = [];
            return maybeConsumeStreakPass();
        });
        expect(r).toBe(false);
    });

    test('the fields round-trip into the save payload', async () => {
        const p = await app.page.evaluate(() => {
            persisted.streakPasses = 2;
            persisted.passProtectedDates = ['2026-01-01'];
            persisted.lastPassEarnedDate = '2026-01-02';
            return _buildSavePayload();
        });
        expect(p.streak_passes).toBe(2);
        expect(p.pass_protected_dates).toEqual(['2026-01-01']);
        expect(p.last_pass_earned_date).toBe('2026-01-02');
    });

    test('the HQ streak chip shows banked passes', async () => {
        await seed([2, 1, 0]);
        const chip = await app.page.evaluate(() => {
            persisted.streakPasses = 2; goToStep(0);
            return document.getElementById('hq-streak').innerText;
        });
        expect(chip).toMatch(/3 Day Streak/);
        expect(chip).toMatch(/2/);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
