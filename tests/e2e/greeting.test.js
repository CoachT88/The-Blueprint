import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The deterministic greeting, Phase 2B.3.2.
 *
 * It is the lowest-priority thing the app says. Most of this file is
 * therefore about when it does NOT appear, and about the gate it spends:
 * one greeting per local calendar day, spent only when something was
 * actually shown.
 */

const EVERY_DAY = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
const FOUR = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];

/** An ordinary TRAIN day for a member called `name`, then render. */
const ordinary = (page, { name = 'Marcus', schedule = EVERY_DAY, patch = {}, clearGate = true } = {}) =>
    page.evaluate(({ name, schedule, patch, clearGate }) => {
        currentUser = { ...currentUser, user_metadata: name ? { preferred_name: name } : {} };
        _persistedLoaded = true;
        _storageFull = false;
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.schedule = [...schedule];
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', duration: 30 }];
        persisted.progressionLedger = [];
        Object.assign(persisted, patch);
        try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
        try { localStorage.removeItem('bp_session_draft_' + (currentUser?.id || '')); } catch (e) {}
        if (clearGate) {
            Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
        }
        renderDashboard();
        const el = document.getElementById('hq-greeting');
        return {
            shown: !el.classList.contains('hidden'),
            text: el.textContent.trim(),
            band: el.dataset.band || null,
            state: window.BP.nextBestAction(buildResolverInput()).state,
            liveness: document.getElementById('today-liveness').dataset.liveness || null,
            gateSet: Object.keys(localStorage).some(k => k.startsWith('bp_greeted_')),
            headline: document.getElementById('today-headline').textContent.trim(),
            brand: document.querySelector('#step-0 h1').textContent.trim(),
        };
    }, { name, schedule, patch, clearGate });

const reread = (page) => page.evaluate(() => {
    renderDashboard();
    const el = document.getElementById('hq-greeting');
    return { shown: !el.classList.contains('hidden'), text: el.textContent.trim() };
});

describe('when it renders', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'gr1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a named member on an ordinary day is greeted', async () => {
        const r = await ordinary(app.page);
        expect(r.state).toBe('TRAIN');
        expect(r.shown).toBe(true);
        expect(r.text).toMatch(/^Good (morning|afternoon|evening), Marcus\.$/);
    }, 30_000);

    test('ACCEPTANCE: a member with no name gets no surface, not a generic one', async () => {
        const r = await ordinary(app.page, { name: null });
        expect(r.shown).toBe(false);
        expect(r.text).toBe('');
        // And nothing generic was substituted to fill the space.
        expect(r.text).not.toMatch(/Good (morning|afternoon|evening)/);
    }, 30_000);

    test('the band matches the hour the browser is actually in', async () => {
        const r = await ordinary(app.page);
        const expected = await app.page.evaluate(() => window.BP.greetingBand(new Date()));
        expect(r.band).toBe(expected);
        expect(r.text).toContain({ morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' }[expected]);
    }, 30_000);

    test('every band produces the right sentence', async () => {
        // The page reads the real clock, so the copy table is exercised
        // directly across all three rather than waiting for the hour.
        const out = await app.page.evaluate(() =>
            ['morning', 'afternoon', 'evening'].map(b => GREETING_COPY[b]('Marcus')));
        expect(out).toEqual(['Good morning, Marcus.', 'Good afternoon, Marcus.', 'Good evening, Marcus.']);
    }, 30_000);

    test('the brand lockup is untouched and Today still leads', async () => {
        const r = await ordinary(app.page);
        expect(r.brand).toBe('The Blueprint');
        expect(r.headline.length).toBeGreaterThan(0);
        // The greeting sits above the Today card in the document.
        const before = await app.page.evaluate(() => {
            const g = document.getElementById('hq-greeting');
            const t = document.getElementById('hq-today-card');
            return !!(g.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(before).toBe(true);
    }, 30_000);

    test('ACCEPTANCE: it changes nothing about the prescription', async () => {
        const withName = await ordinary(app.page, { name: 'Marcus' });
        const without = await ordinary(app.page, { name: null });
        expect(withName.state).toBe(without.state);
        expect(withName.headline).toBe(without.headline);
        const sameCard = await app.page.evaluate(() => {
            const a = window.BP.nextBestAction(buildResolverInput());
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
            const b = window.BP.nextBestAction(buildResolverInput());
            return JSON.stringify(a) === JSON.stringify(b);
        });
        expect(sameCard).toBe(true);
    }, 30_000);

    test('a MODIFIED day still allows it', async () => {
        const r = await app.page.evaluate(({ EVERY_DAY }) => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
            _persistedLoaded = true;
            persisted.primaryGoal = 'all'; persisted.pelvicProfile = 'standard';
            persisted.schedule = [...EVERY_DAY];
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', duration: 30 }];
            persisted.progressionLedger = [];
            Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
            localStorage.setItem(getTodaySorenessKey(), 'moderate');
            renderDashboard();
            const out = { state: window.BP.nextBestAction(buildResolverInput()).state,
                          shown: !document.getElementById('hq-greeting').classList.contains('hidden') };
            localStorage.removeItem(getTodaySorenessKey());
            return out;
        }, { EVERY_DAY });
        expect(r.state).toBe('MODIFIED');
        expect(r.shown).toBe(true);
    }, 30_000);
});

describe('the once-per-day gate', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'gr2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a second open the same day says nothing', async () => {
        const first = await ordinary(app.page);
        expect(first.shown).toBe(true);
        const second = await reread(app.page);
        expect(second.shown).toBe(false);
        expect(second.text).toBe('');
    }, 30_000);

    test('a new local calendar day is eligible again', async () => {
        await ordinary(app.page);
        const r = await app.page.evaluate(() => {
            // Age the gate by one calendar day, which is what midnight does.
            const today = window.BP.localDayKey(new Date());
            const key = 'bp_greeted_' + currentUser.id + '_' + today;
            localStorage.removeItem(key);
            const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            localStorage.setItem('bp_greeted_' + currentUser.id + '_' + window.BP.localDayKey(yesterday), '1');
            renderDashboard();
            return !document.getElementById('hq-greeting').classList.contains('hidden');
        });
        expect(r).toBe(true);
    }, 30_000);

    test('the key carries the user id and the local date, and no name', async () => {
        await ordinary(app.page, { name: 'Zebediah' });
        const r = await app.page.evaluate(() => {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_'));
            return { keys, values: keys.map(k => localStorage.getItem(k)) };
        });
        expect(r.keys).toHaveLength(1);
        expect(r.keys[0]).toMatch(/^bp_greeted_.+_\d{4}-\d{2}-\d{2}$/);
        expect(r.keys[0]).not.toContain('Zebediah');
        expect(r.values[0]).toBe('1');
    }, 30_000);

    test('REGRESSION: the gate is a calendar date, not elapsed hours', async () => {
        const r = await app.page.evaluate(() => {
            const k = Object.keys(localStorage).find(x => x.startsWith('bp_greeted_'));
            return { key: k, looksNumeric: /_\d{10,}$/.test(k || '') };
        });
        expect(r.looksNumeric).toBe(false);
        expect(r.key).toMatch(/\d{4}-\d{2}-\d{2}$/);
    }, 30_000);
});

describe('suppression', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'gr3' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Render under `patch`, and report whether the gate was spent. */
    const underCondition = (page, setup) => page.evaluate((setup) => {
        currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
        _persistedLoaded = true; _storageFull = false;
        persisted.primaryGoal = 'all'; persisted.pelvicProfile = 'standard';
        persisted.schedule = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', duration: 30 }];
        persisted.progressionLedger = [];
        Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
        try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
        try { localStorage.removeItem('bp_session_draft_' + (currentUser?.id || '')); } catch (e) {}
        // eslint-disable-next-line no-eval
        eval(setup);
        renderDashboard();
        const out = {
            shown: !document.getElementById('hq-greeting').classList.contains('hidden'),
            gateSet: Object.keys(localStorage).some(k => k.startsWith('bp_greeted_')),
            state: window.BP.nextBestAction(buildResolverInput()).state,
            liveness: document.getElementById('today-liveness').dataset.liveness || null,
        };
        try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
        _storageFull = false;
        return out;
    }, setup);

    test('ACCEPTANCE: the critical band suppresses it, and does not spend the gate', async () => {
        const r = await underCondition(app.page, '_persistedLoaded = false;');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('storage-full also suppresses it', async () => {
        const r = await underCondition(app.page, '_storageFull = true;');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: RECOVER suppresses it, and does not spend the gate', async () => {
        const r = await underCondition(app.page, "localStorage.setItem(getTodaySorenessKey(), 'high');");
        expect(r.state).toBe('RECOVER');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('RESUME suppresses it', async () => {
        const r = await underCondition(app.page,
            "localStorage.setItem('bp_session_draft_'+currentUser.id, JSON.stringify({savedAt:Date.now(),exerciseIndex:0,setIndex:1,routineType:'length'}));");
        expect(r.state).toBe('RESUME');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('PREPARE suppresses it', async () => {
        const r = await underCondition(app.page, "persisted.primaryGoal = '';");
        expect(r.state).toBe('PREPARE');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: Week Complete suppresses it', async () => {
        const r = await underCondition(app.page, `
            const n = ((new Date().getDay() + 6) % 7) + 1;
            persisted.schedule = Array.from({length:7}, (_, i) => ((i + 6) % 7) < n ? 'length' : 'rest');
            persisted.sessionLog = [];
            const monday = new Date(); monday.setHours(12,0,0,0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            for (let i = 0; i < n; i++) {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length', duration: 30 });
                persisted.completedDays[d.getDay()] = true;
            }
        `);
        expect(r.liveness).toBe('week-complete');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: a return suppresses it', async () => {
        const r = await underCondition(app.page, `
            const d = new Date(); d.setDate(d.getDate() - 10);
            persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
        `);
        expect(r.liveness).toBe('returning');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: an extended return suppresses it', async () => {
        const r = await underCondition(app.page, `
            const d = new Date(); d.setDate(d.getDate() - 40);
            persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
        `);
        expect(r.liveness).toBe('extended-return');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: a missed week suppresses it', async () => {
        const r = await underCondition(app.page, `
            persisted.schedule = ['length','girth','rest','stamina','length','rest','rest'];
            const lastWeek = window.BP.weekKey(new Date(Date.now() - 7 * 86400000));
            persisted.progressionLedger = [
                { weekKey: lastWeek, targetSessions: 4, qualifyingSessions: 0, verdict: 'missed' },
                { weekKey: getCurrentWeekKey(), targetSessions: 4, qualifyingSessions: 0, verdict: 'missed' },
            ];
        `);
        expect(r.liveness).toBe('missed-week');
        expect(r.shown).toBe(false);
        expect(r.gateSet).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: a suppressed morning still leaves the evening available', async () => {
        // The whole point of marking the gate only on render.
        const blocked = await underCondition(app.page, "localStorage.setItem(getTodaySorenessKey(), 'high');");
        expect(blocked.shown).toBe(false);
        expect(blocked.gateSet).toBe(false);
        const later = await app.page.evaluate(() => {
            localStorage.removeItem(getTodaySorenessKey());
            renderDashboard();
            return { shown: !document.getElementById('hq-greeting').classList.contains('hidden'),
                     gateSet: Object.keys(localStorage).some(k => k.startsWith('bp_greeted_')) };
        });
        expect(later.shown).toBe(true);
        expect(later.gateSet).toBe(true);
    }, 30_000);
});

describe('accounts, safety and privacy', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'gr4' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const become = (page, id, name) => page.evaluate(({ id, name }) => {
        currentUser = { id, email: id + '@example.com', user_metadata: name ? { preferred_name: name } : {} };
        _persistedLoaded = true;
        persisted.primaryGoal = 'all'; persisted.pelvicProfile = 'standard';
        persisted.schedule = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', duration: 30 }];
        persisted.progressionLedger = [];
        renderDashboard();
        const el = document.getElementById('hq-greeting');
        return { shown: !el.classList.contains('hidden'), text: el.textContent.trim() };
    }, { id, name });

    test('ACCEPTANCE: A being greeted does not suppress B', async () => {
        await app.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k)));
        const a = await become(app.page, 'acct-a', 'Alice');
        expect(a.shown).toBe(true);
        expect(a.text).toContain('Alice');
        const b = await become(app.page, 'acct-b', 'Bruno');
        expect(b.shown).toBe(true);
        expect(b.text).toContain('Bruno');
        expect(b.text).not.toContain('Alice');
    }, 30_000);

    test('ACCEPTANCE: switching back to A the same day does not greet again', async () => {
        const again = await become(app.page, 'acct-a', 'Alice');
        expect(again.shown).toBe(false);
    }, 30_000);

    test('and each account holds its own gate', async () => {
        const keys = await app.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).sort());
        expect(keys.some(k => k.includes('acct-a'))).toBe(true);
        expect(keys.some(k => k.includes('acct-b'))).toBe(true);
    }, 30_000);

    test('REGRESSION: a markup-like name stays inert text', async () => {
        await app.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k)));
        const r = await app.page.evaluate(() => {
            window.__xss = 0;
            currentUser = { id: 'xss', email: 'x@example.com',
                            user_metadata: { preferred_name: '<img src=x onerror="window.__xss=1">' } };
            _persistedLoaded = true;
            renderDashboard();
            const el = document.getElementById('hq-greeting');
            return { xss: window.__xss, html: el.innerHTML, text: el.textContent, imgs: el.querySelectorAll('img').length };
        });
        expect(r.xss).toBe(0);
        expect(r.imgs).toBe(0);
        expect(r.html).not.toContain('<img');
        expect(r.text).toContain('<img');
    }, 30_000);

    test('REGRESSION: no email fallback reaches the greeting', async () => {
        const r = await app.page.evaluate(() => {
            Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
            currentUser = { id: 'noname', email: 'marcus.kane@example.com', user_metadata: {} };
            _persistedLoaded = true;
            renderDashboard();
            const el = document.getElementById('hq-greeting');
            return { shown: !el.classList.contains('hidden'), text: el.textContent };
        });
        expect(r.shown).toBe(false);
        expect(r.text).not.toMatch(/marcus/i);
    }, 30_000);

    test('REGRESSION: the name does not reach analytics, the payload or storage', async () => {
        const r = await app.page.evaluate(() => {
            Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
            currentUser = { ...currentUser, id: 'priv', email: 'p@example.com', user_metadata: { preferred_name: 'Zebediah' } };
            _persistedLoaded = true;
            _analyticsBuffer = [];
            renderDashboard();
            track('nudge_dismissed', { nudge: 'x' });
            return {
                shown: !document.getElementById('hq-greeting').classList.contains('hidden'),
                payload: JSON.stringify(_buildSavePayload()),
                persisted: JSON.stringify(persisted),
                analytics: JSON.stringify(_analyticsBuffer),
                local: Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('|'),
            };
        });
        expect(r.shown).toBe(true);                 // it really did render
        for (const blob of [r.payload, r.persisted, r.analytics, r.local]) {
            expect(blob).not.toContain('Zebediah');
        }
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
