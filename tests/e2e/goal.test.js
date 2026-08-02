import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * The goal question ("What are you here for?") sets the weekly schedule, decides
 * which number leads the HQ, points Mission Select at the right session, and
 * tells Coach Tee what to lead with. Schedule-safety rules live in
 * schedule-safety.test.js; this covers capture and the adaptive surfaces.
 */
describe('goal capture', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'g1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the picker slide and its dot exist', async () => {
        const r = await app.page.evaluate(() => ({
            slides: document.querySelectorAll('.ob-slide').length,
            dots: document.querySelectorAll('.ob-dot').length,
            last: _obLastIdx(),
        }));
        expect(r.slides).toBe(4);
        expect(r.dots).toBe(4);
        expect(r.last).toBe(3);
    });

    test('the terminal index is derived, so Get Started shows only on the last slide', async () => {
        await app.page.evaluate(() => showOnboarding());
        await app.page.waitForTimeout(300);
        // textContent, not innerText: .btn-primary applies text-transform:uppercase.
        expect(await app.page.evaluate(() => document.getElementById('ob-next-btn').textContent)).toBe('Next');
        await app.page.evaluate(() => goToObSlide(3));
        await app.page.waitForTimeout(250);
        expect(await app.page.evaluate(() => document.getElementById('ob-next-btn').textContent)).toBe('Get Started');
    }, 30_000);

    test('choosing a goal records it and marks the option selected', async () => {
        const r = await app.page.evaluate(() => {
            persisted.allTimeSessionCount = 0;
            persisted.schedule = DEFAULT_PERSISTED.schedule.slice();
            persisted.primaryGoal = '';
            document.querySelector('.goal-opt[data-goal="stamina"]').click();
            return { goal: persisted.primaryGoal, selected: document.querySelector('.goal-opt.selected')?.dataset.goal };
        });
        expect(r.goal).toBe('stamina');
        expect(r.selected).toBe('stamina');
    });

    test('an unanswered goal behaves exactly as "all"', async () => {
        const key = await app.page.evaluate(() => { persisted.primaryGoal = ''; return getGoalKey(); });
        expect(key).toBe('all');
    });

    test('primary_goal is in the save payload and the fallback column list', async () => {
        const r = await app.page.evaluate(() => ({
            payload: _buildSavePayload(),
            inFallback: _NEWER_COLUMNS.includes('primary_goal'),
        }));
        expect('primary_goal' in r.payload).toBe(true);
        expect(r.inFallback).toBe(true);
    });
});

describe('stamina as a fourth calendar day type', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'g2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('renders purple with the flame icon, not the rest bed', async () => {
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule = Array(7).fill('rest');
            persisted.schedule[d] = 'stamina';
            persisted.primaryGoal = 'stamina';
            renderDashboard();
            const cell = document.querySelectorAll('#dashboard-grid .calendar-day')[d];
            return { cls: cell.className, icon: cell.querySelector('i').className, blackout: isBlackoutDay() };
        });
        expect(r.cls).toMatch(/type-stamina/);
        expect(r.icon).toMatch(/fa-fire-flame-curved/);
        expect(r.icon).not.toMatch(/fa-bed/);
        expect(r.blackout).toBe(false);      // stamina is a training day
        expect(r.cls).toMatch(/scheduled-focus/);
    });

    test('an unknown day type renders neutrally rather than as a rest day', async () => {
        // A stale cached shell can receive a type it does not know. The old
        // ternary fell through to the bed icon, so it looked like a rest day
        // while the app still treated it as training.
        const r = await app.page.evaluate(() => ({
            icon: dayTypeIcon('banana'),
            label: dayTypeLabel('banana'),
            known: !!DAY_TYPES['banana'],
        }));
        expect(r.icon).toBe('fa-circle-question');
        expect(r.icon).not.toBe('fa-bed');
        expect(r.known).toBe(false);
    });

    test('the HQ button names each day type', async () => {
        const labels = {};
        for (const t of ['length', 'girth', 'stamina', 'rest']) {
            labels[t] = await app.page.evaluate(ty => {
                const d = new Date().getDay();
                persisted.schedule[d] = ty;
                renderDashboard();
                return document.getElementById('launch-btn').textContent;
            }, t);
        }
        expect(labels).toEqual({
            length: 'BEGIN LENGTH SESSION',
            girth: 'BEGIN GIRTH SESSION',
            stamina: 'BEGIN STAMINA SESSION',
            rest: 'BEGIN RECOVERY SESSION',
        });
    }, 30_000);
});

describe('goal-aware surfaces', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'g3' });
        await app.page.evaluate((log) => {
            persisted.sessionLog = log;
            persisted.measurements = [{ date: new Date().toISOString(), bpel: 6.25, mseg: 4.75 }];
        }, [6, 7, 7, 8, 8, 9].map((eq, i) => sessionEntry(5 - i, { type: 'stamina', eq })));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test.each([
        ['size', false], ['all', false], ['stamina', true], ['eq', true],
    ])('goal %s leads with the right row and renderDashboard still completes', async (goal, expectEq) => {
        const r = await app.page.evaluate(g => {
            persisted.primaryGoal = g;
            renderDashboard();
            return {
                meas: !document.getElementById('last-measure-row').classList.contains('hidden'),
                eq: !document.getElementById('eq-summary-row').classList.contains('hidden'),
                eqAvg: document.getElementById('eq-avg').textContent,
                // Everything after the row swap must still render — these are
                // written unguarded and would abort the rest of the function.
                logRendered: document.getElementById('session-log').innerHTML.length > 0,
                tipRendered: document.getElementById('daily-tip').textContent.length > 0,
            };
        }, goal);
        expect(r.eq).toBe(expectEq);
        expect(r.meas).toBe(!expectEq);
        expect(r.logRendered).toBe(true);
        expect(r.tipRendered).toBe(true);
        if (expectEq) expect(r.eqAvg).toBe('7.5');
    }, 30_000);

    test('getEqSummary computes average and direction', async () => {
        const eq = await app.page.evaluate(() => getEqSummary(7));
        expect(eq.count).toBe(6);
        expect(eq.avg).toBeCloseTo(7.5, 2);
        expect(eq.trend).toBe('improving');
    });

    test('Coach Tee is told the goal and today\'s focus, for an established member', async () => {
        const ctx = await app.page.evaluate(() => _coachContext());
        expect(ctx).toMatch(/Stated goal:/);
        expect(ctx).toMatch(/Today's scheduled focus:/);
    });

    test('and for a brand-new member, who is exactly who just answered', async () => {
        const ctx = await app.page.evaluate(() => { persisted.sessionLog = []; return _coachContext(); });
        expect(ctx).toMatch(/brand new/);
        expect(ctx).toMatch(/Stated goal:/);
        expect(ctx).toMatch(/Today's scheduled focus:/);
    });

    test('mission select flags today\'s scheduled mission', async () => {
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule[d] = 'stamina';
            persisted.primaryGoal = 'stamina';
            persisted.allTimeSessionCount = 0;
            persisted.difficulty = 'beginner';
            goToStep(3);
            return {
                note: document.getElementById('beginner-rec-note').textContent,
                hidden: document.getElementById('beginner-rec-note').classList.contains('hidden'),
                focused: document.querySelector('.mission-focus')?.id,
            };
        });
        expect(r.hidden).toBe(false);
        expect(r.note).toMatch(/Stamina day/i);
        expect(r.focused).toBe('mission-stamina-btn');
    }, 30_000);

    test('on a rest day the blackout still wins and nothing is recommended', async () => {
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule[d] = 'rest';
            goToStep(3);
            return {
                noteHidden: document.getElementById('beginner-rec-note').classList.contains('hidden'),
                lengthDisabled: document.getElementById('mission-length-btn').disabled,
                focused: document.querySelector('.mission-focus')?.id || null,
            };
        });
        expect(r.noteHidden).toBe(true);
        expect(r.lengthDisabled).toBe(true);
        expect(r.focused).toBeNull();
        expect(app.errors).toEqual([]);
    }, 30_000);
});
