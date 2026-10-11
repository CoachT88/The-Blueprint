import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * A real legacy member can have completed sessions but no primary_goal:
 * older releases treated that value as 'all'. The Today card must not turn
 * that established programme into a first-run setup gate.
 *
 * This exercises production renderDashboard() and buildResolverInput(), not
 * a reconstructed answer or synthetic DOM state.
 */
describe('empty historical goal is not an onboarding reset', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'legacy-goal' });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    const run = (data) => app.page.evaluate(({ count, history }) => {
        _persistedLoaded = true;
        persisted.primaryGoal = '';
        persisted.programme = window.__legacyProgramme();
        persisted.dayPlans = [];
        persisted.schedule = Array(7).fill('length');
        persisted.completedDays = Array(7).fill(false);
        persisted.allTimeSessionCount = count;
        persisted.sessionLog = history
            ? [{ date: new Date(Date.now() - 86400000).toISOString(),
                 routineType: 'length', duration: 30, xpEarned: 20 }]
            : [];
        persisted.programmeStartDate = null;
        persisted.firstSessionDate = '';
        persisted.progressionLedger = [];
        persisted.pelvicProfile = 'standard';
        try {
            localStorage.removeItem(getTodaySorenessKey());
            localStorage.removeItem('bp_session_draft_' + currentUser.id);
        } catch (e) {}

        const goalBefore = persisted.primaryGoal;
        const weekBefore = JSON.stringify(persisted.schedule);
        const historyBefore = JSON.stringify(persisted.sessionLog);
        goToStep(0);
        renderDashboard();
        const resolver = buildResolverInput();
        const result = window.BP.nextBestAction(resolver);
        return {
            inputGoal: resolver.goalKey,
            state: document.getElementById('hq-today-card').dataset.state,
            prepare: result.prepare,
            chooseGoalVisible: !document.getElementById('today-prepare-btn').classList.contains('hidden')
                && document.getElementById('today-prepare-btn').textContent.includes('CHOOSE A GOAL'),
            unchangedGoal: persisted.primaryGoal === goalBefore,
            unchangedWeek: JSON.stringify(persisted.schedule) === weekBefore,
            unchangedHistory: JSON.stringify(persisted.sessionLog) === historyBefore,
        };
    }, data);

    test('the genuinely new member still must choose a goal', async () => {
        const x = await run({ count: 0, history: false });
        expect(x.inputGoal).toBe('');
        expect(x.state).toBe('PREPARE');
        expect(x.prepare).toBe('goal');
        expect(x.chooseGoalVisible).toBe(true);
        expect(x.unchangedGoal).toBe(true);
        expect(x.unchangedWeek).toBe(true);
        expect(x.unchangedHistory).toBe(true);
    });

    test('history with a blank goal keeps the existing schedule actionable', async () => {
        const x = await run({ count: 3, history: true });
        expect(x.inputGoal).toBe('all');
        expect(x.state).not.toBe('PREPARE');
        expect(x.prepare).not.toBe('goal');
        expect(x.chooseGoalVisible).toBe(false);
        expect(x.unchangedGoal).toBe(true);
        expect(x.unchangedWeek).toBe(true);
        expect(x.unchangedHistory).toBe(true);
    });

    test('a pruned session log still respects the durable completion count', async () => {
        const x = await run({ count: 50, history: false });
        expect(x.inputGoal).toBe('all');
        expect(x.prepare).not.toBe('goal');
        expect(x.chooseGoalVisible).toBe(false);
        expect(x.unchangedGoal).toBe(true);
        expect(x.unchangedWeek).toBe(true);
        expect(x.unchangedHistory).toBe(true);
    });
});
