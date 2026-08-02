import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * Coach Tee receives a snapshot of the member's real data so it answers as
 * someone who knows them. It must never be handed a number the member did not
 * generate, and a brand-new member must get an explicit instruction not to
 * invent history.
 */
describe('Coach Tee context', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'u5' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a brand-new member gets orientation, not fabricated stats', async () => {
        const ctx = await app.page.evaluate(() => { persisted.sessionLog = []; return _coachContext(); });
        expect(ctx).toMatch(/brand new/i);
        expect(ctx).toMatch(/do not invent history or numbers/i);
        expect(ctx).not.toMatch(/Streak: \d+ day/);
    });

    test('an established member gets real figures and an EQ direction', async () => {
        const ctx = await app.page.evaluate((log) => {
            persisted.sessionLog = log;
            persisted.totalXp = 420;
            persisted.difficulty = 'intermediate';
            persisted.allTimeSessionCount = 6;
            persisted.measurements = [{ date: new Date().toISOString(), bpel: 6.25, mseg: 4.75 }];
            localStorage.setItem(getTodaySleepKey(), 'good');
            localStorage.setItem(getTodaySorenessKey(), 'mild');
            return _coachContext();
        }, [
            sessionEntry(7, { eq: 5, rpe: 6 }), sessionEntry(6, { type: 'girth', eq: 5, rpe: 7 }),
            sessionEntry(5, { eq: 6, rpe: 6 }), sessionEntry(3, { eq: 7, rpe: 5 }),
            sessionEntry(1, { type: 'girth', eq: 8, rpe: 6 }), sessionEntry(0, { eq: 8, rpe: 5 }),
        ]);

        expect(ctx).toMatch(/Streak: \d+ day/);
        expect(ctx).toMatch(/Level:/);
        expect(ctx).toMatch(/Difficulty tier: Intermediate/);
        expect(ctx).toMatch(/Sessions logged all time: 6/);
        expect(ctx).toMatch(/EQ trend: improving/);
        expect(ctx).toMatch(/BPEL 6\.25in/);
        expect(ctx).toMatch(/sleep good/);
        expect(ctx).toMatch(/never dump it back verbatim/);
    });

    test('the context stays compact enough to prepend to every prompt', async () => {
        const len = await app.page.evaluate(() => _coachContext().length);
        expect(len).toBeLessThan(1_200);
    });
});

describe('EQ chart', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'u6' });
        await app.page.evaluate((log) => {
            persisted.sessionLog = log;
            persisted.measurements = [
                { date: new Date(Date.now() - 30 * 864e5).toISOString(), bpel: 6.0, mseg: 4.5 },
                { date: new Date().toISOString(), bpel: 6.25, mseg: 4.75 },
            ];
            renderProgressChart();
        }, [4, 5, 6, 6, 7, 8].map((eq, i) => sessionEntry(5 - i, { eq })));
        await app.page.waitForTimeout(300);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    const texts = (id) => app.page.evaluate(
        i => [...document.getElementById(i).querySelectorAll('text')].map(t => t.textContent), id);

    test('plots EQ with no inch marks and no percent gain', async () => {
        // A percent change is meaningless on a subjective 1-10 scale, and inches
        // would be nonsense. Assert on text nodes, not innerHTML: attributes like
        // stroke-width="2.5" would false-positive an inch-mark regex.
        const t = await texts('eq-chart');
        expect(t.length).toBeGreaterThan(0);
        expect(t.some(x => x.includes('"'))).toBe(false);
        expect(t.some(x => x.includes('%'))).toBe(false);
    });

    test('the measurement charts keep both', async () => {
        const t = await texts('bpel-chart');
        expect(t.some(x => x.includes('"'))).toBe(true);
        expect(t.some(x => x.includes('%'))).toBe(true);
    });

    test('renders its empty state with no EQ data', async () => {
        const html = await app.page.evaluate(() => {
            persisted.sessionLog = []; renderProgressChart();
            return document.getElementById('eq-chart').innerHTML;
        });
        expect(html).toMatch(/No data yet/);
    });

    test('an EQ-led member is not told they have no data', async () => {
        const stats = await app.page.evaluate((log) => {
            persisted.sessionLog = log;
            persisted.measurements = [];   // no measurements, but plenty of EQ
            renderProgressChart();
            return document.getElementById('chart-stats').innerText;
        }, [4, 5, 6, 7].map((eq, i) => sessionEntry(3 - i, { eq })));
        expect(stats).toMatch(/EQ trend is above/i);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
