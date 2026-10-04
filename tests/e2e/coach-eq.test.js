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
        expect(ctx).not.toMatch(/Qualifying training weeks in the last 8: \d+/);
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

        expect(ctx).toMatch(/Qualifying training weeks in the last 8: \d+/);
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

/**
 * The preferred name as deterministic Coach Tee context, Phase 2B.3.3.
 *
 * One line, only when a name exists. The model may use it naturally and is
 * never told to. It determines no identity and calculates no state: every
 * fact in the block is supplied by the app.
 */
describe('preferred name in the Coach Tee context', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'ctn' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const ctx = (page, { name, log } = {}) => page.evaluate(({ name, log }) => {
        currentUser = { id: 'ctn', email: 'marcus.kane@example.com',
                        user_metadata: name ? { preferred_name: name } : {} };
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.sessionLog = log
            ? [{ date: new Date().toISOString(), routineType: 'length', eq: 8, rpe: 5, xpEarned: 15 }]
            : [];
        return _coachContext();
    }, { name, log: !!log });

    test('a name produces exactly one context line', async () => {
        const c = await ctx(app.page, { name: 'Marcus', log: true });
        expect(c).toContain('Preferred name: Marcus');
        expect(c.match(/Preferred name:/g)).toHaveLength(1);
    }, 30_000);

    test('and for a brand new member too', async () => {
        const c = await ctx(app.page, { name: 'Marcus', log: false });
        expect(c).toContain('brand new');
        expect(c).toContain('Preferred name: Marcus');
        expect(c.match(/Preferred name:/g)).toHaveLength(1);
    }, 30_000);

    test('ACCEPTANCE: no name means no line, never a null', async () => {
        for (const log of [true, false]) {
            const c = await ctx(app.page, { name: null, log });
            expect(c).not.toContain('Preferred name');
            expect(c).not.toContain('null');
            expect(c).not.toContain('undefined');
        }
    }, 30_000);

    test('ACCEPTANCE: the email is never used as a fallback', async () => {
        const c = await ctx(app.page, { name: null, log: true });
        expect(c).not.toMatch(/marcus/i);
        expect(c).not.toContain('@');
    }, 30_000);

    test('ACCEPTANCE: the deterministic facts are identical with and without it', async () => {
        const withName = await ctx(app.page, { name: 'Marcus', log: true });
        const without = await ctx(app.page, { name: null, log: true });
        const strip = t => t.split('\n').filter(l => !l.startsWith('Preferred name:')).join('\n');
        expect(strip(withName)).toBe(strip(without));
    }, 30_000);

    test('ACCEPTANCE: Coach Tee is still stateless, one user turn and no history', async () => {
        const r = await app.page.evaluate(async () => {
            const seen = [];
            // fetchClaude bails without a session, and the harness stub has
            // none, so one is supplied for the length of this call.
            const realGetSession = sb.auth.getSession;
            sb.auth.getSession = () => Promise.resolve({ data: { session: { access_token: 'stub-token' } } });
            const realFetch = window.fetch;
            window.fetch = (url, opts) => {
                if (String(url).includes('/api/coach-tee')) {
                    seen.push(JSON.parse(opts.body));
                    return Promise.resolve(new Response(JSON.stringify({ content: [{ text: 'ok' }] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }));
                }
                return realFetch(url, opts);
            };
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
            document.getElementById('coach-input').value = 'Is this working?';
            await askCoach();
            window.fetch = realFetch;
            sb.auth.getSession = realGetSession;
            return seen;
        });
        expect(r.length).toBeGreaterThan(0);
        const body = r[0];
        expect(body.context).toContain('Preferred name: Marcus');
        // No conversation history is sent, and nothing new was added to the
        // transport: mode, userMsg and context, as before.
        expect(body).not.toHaveProperty('messages');
        expect(body).not.toHaveProperty('history');
        expect(Object.keys(body).sort()).toEqual(['context', 'mode', 'userMsg']);
    }, 30_000);

    test('REGRESSION: the name reaches no other payload', async () => {
        const r = await app.page.evaluate(() => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Zebediah' } };
            _analyticsBuffer = [];
            track('coach_asked');
            renderDashboard();
            return {
                payload: JSON.stringify(_buildSavePayload()),
                persisted: JSON.stringify(persisted),
                analytics: JSON.stringify(_analyticsBuffer),
                local: Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('|'),
                ledger: JSON.stringify(persisted.progressionLedger || []),
            };
        });
        for (const blob of [r.payload, r.persisted, r.analytics, r.local, r.ledger]) {
            expect(blob).not.toContain('Zebediah');
        }
    }, 30_000);

    test('the context states facts and gives no instruction about the name', async () => {
        const c = await ctx(app.page, { name: 'Marcus', log: true });
        const line = c.split('\n').find(l => l.startsWith('Preferred name:'));
        expect(line).toBe('Preferred name: Marcus');
        // No "address them as", "use their name", "always call them".
        expect(c).not.toMatch(/use (their|his) name|address them|always call/i);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
