import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The goal question can rewrite a member's weekly schedule. A calendar someone
 * arranged themselves is theirs, so the rule is: apply automatically only when
 * the account is genuinely untouched, otherwise ask, and obey the answer.
 */
const CUSTOM = ['girth', 'girth', 'rest', 'length', 'rest', 'stamina', 'rest'];
const STAMINA_PRESET = ['stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest', 'rest'];
const SIZE_PRESET = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

describe('goal presets never trample an existing schedule', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a brand-new account gets its preset applied silently', async () => {
        const r = await app.page.evaluate(() => {
            persisted.allTimeSessionCount = 0;
            persisted.schedule = DEFAULT_PERSISTED.schedule.slice();
            persisted.primaryGoal = '';
            selectGoal('stamina');
            return { goal: persisted.primaryGoal, schedule: persisted.schedule };
        });
        expect(r.goal).toBe('stamina');
        expect(r.schedule).toEqual(STAMINA_PRESET);
    });

    test('a member with history is asked first, and a decline changes nothing', async () => {
        const r = await app.page.evaluate((custom) => {
            persisted.allTimeSessionCount = 40;
            persisted.schedule = custom.slice();
            persisted.primaryGoal = '';
            let asked = 0;
            window.confirm = () => { asked++; return false; };
            selectGoal('size');
            return { asked, goal: persisted.primaryGoal, schedule: persisted.schedule };
        }, CUSTOM);
        expect(r.asked).toBe(1);
        expect(r.goal).toBe('size');       // the goal itself is still recorded
        expect(r.schedule).toEqual(CUSTOM); // but the week is untouched
    });

    test('accepting the prompt applies the preset', async () => {
        const schedule = await app.page.evaluate(() => {
            window.confirm = () => true;
            selectGoal('size');
            return persisted.schedule;
        });
        expect(schedule).toEqual(SIZE_PRESET);
    });

    test('a customised schedule with no history is still protected', async () => {
        const r = await app.page.evaluate((custom) => {
            persisted.allTimeSessionCount = 0;
            persisted.schedule = custom.slice();
            let asked = 0;
            window.confirm = () => { asked++; return false; };
            selectGoal('eq');
            return { asked, schedule: persisted.schedule };
        }, CUSTOM);
        expect(r.asked).toBe(1);
        expect(r.schedule).toEqual(CUSTOM);
    });

    test('a malformed stored schedule is repaired slot by slot', async () => {
        const schedule = await app.page.evaluate(() => {
            persisted.schedule = ['length', 'banana', 'rest'];  // short AND invalid
            normaliseSchedule();
            return persisted.schedule;
        });
        expect(schedule).toHaveLength(7);
        expect(schedule.every(t => ['length', 'girth', 'stamina', 'rest'].includes(t))).toBe(true);
        expect(schedule[0]).toBe('length'); // the valid slot is kept, not discarded
        expect(app.errors).toEqual([]);
    });
});

describe('a pre-goal row loads and saves unchanged', () => {
    let app;
    const VET = {
        id: 'vet2', total_xp: 2400, difficulty: 'elite', schedule: CUSTOM,
        completed_days: [true, false, true, false, false, true, false],
        session_log: [], measurements: [], seen_milestones: [],
        records: { longestStreak: 20, bestWeekXp: 200, bestSessionXp: 25 },
        all_time_session_count: 120, xp_migrated: true, week_key: '',
        updated_at: new Date(Date.now() - 3600e3).toISOString(),
    };
    beforeAll(async () => {
        app = await openApp({ row: VET });
        await app.page.evaluate(() => localStorage.clear());
        await signIn(app.page, { id: 'vet2', loaded: false });
        await app.page.evaluate(() => loadPersisted());
        await app.page.waitForTimeout(500);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('schedule and goal survive the load', async () => {
        const r = await app.page.evaluate(() => ({
            schedule: persisted.schedule, goal: persisted.primaryGoal, goalKey: getGoalKey(),
        }));
        expect(r.schedule).toEqual(CUSTOM);
        expect(r.goal).toBe('');
        expect(r.goalKey).toBe('all');   // unset behaves exactly as before
    });

    test('an unset goal leaves the HQ size-led, as it has always been', async () => {
        await app.page.evaluate(() => { _persistedLoaded = true; goToStep(0); });
        await app.page.waitForTimeout(400);
        const r = await app.page.evaluate(() => ({
            meas: !document.getElementById('last-measure-row').classList.contains('hidden'),
            eq: !document.getElementById('eq-summary-row').classList.contains('hidden'),
        }));
        expect(r.meas).toBe(true);
        expect(r.eq).toBe(false);
    });

    test('the save round-trips the schedule unchanged', async () => {
        await app.page.evaluate(() => { window.__writes = []; _flushSaveNow(); });
        await app.page.waitForTimeout(700);
        const w = await app.page.evaluate(() => window.__writes[0]);
        expect(w.schedule).toEqual(CUSTOM);
        expect(w.primary_goal).toBe('');
        expect(app.errors).toEqual([]);
    }, 30_000);
});
