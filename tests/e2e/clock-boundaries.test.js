import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The identity surfaces against a clock we control. Phase 2B.3.5.
 *
 * tests/liveness.test.js already sweeps the pure functions across all 24
 * hours and both return boundaries, because 2B.2 shipped a defect that a
 * fixed-noon fixture hid. What it cannot reach is the PAGE: every browser
 * suite until now read the real clock, so the greeting band and the daily
 * gate were only ever exercised at whatever hour the run happened to start,
 * and the once-per-local-day gate had never been seen to roll over at all.
 *
 * Playwright's own clock.setFixedTime closes that. Not install(): that
 * replaces the timer queue too, and the app would come up half wired.
 * This is deliberately a handful of integration cases rather than a general
 * clock facility, which stays on the debt list.
 */

const EVERY_DAY = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
const at = (y, m, d, h, min = 0) => new Date(y, m, d, h, min, 0);

/** A named member on an ordinary day, rendered fresh. */
const ordinary = (page, patch = {}) => page.evaluate(({ patch, EVERY_DAY }) => {
    currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
    _persistedLoaded = true; _storageFull = false;
    persisted.primaryGoal = 'all';
    persisted.pelvicProfile = 'standard';
    persisted.pelvicScreenDate = '2025-01-01';
    persisted.schedule = [...EVERY_DAY];
    persisted.completedDays = [false, false, false, false, false, false, false];
    persisted.sessionLog = [{ date: new Date(Date.now() - 2 * 86400000).toISOString(),
                              routineType: 'length', duration: 30 }];
    persisted.progressionLedger = [];
    Object.assign(persisted, patch);
    try {
        localStorage.setItem('bp_onboarded_' + currentUser.id, '1');
        localStorage.removeItem(getTodaySorenessKey());
        Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
    } catch (e) {}
    goToStep(0);
    try { Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    renderDashboard();
    const el = document.getElementById('hq-greeting');
    return { text: el.textContent, band: el.dataset.band,
             shown: !el.classList.contains('hidden'),
             key: _greetedKey(), hour: new Date().getHours() };
}, { patch, EVERY_DAY });

describe('the greeting band, at hours the real clock would never give us', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: at(2025, 5, 15, 9) });
        await signIn(app.page, { id: 'ck1' });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    const CASES = [
        [4, 59, 'evening', 'Good evening'],     // before 05:00 is still evening
        [5, 0, 'morning', 'Good morning'],
        [11, 59, 'morning', 'Good morning'],
        [12, 0, 'afternoon', 'Good afternoon'],
        [16, 59, 'afternoon', 'Good afternoon'],
        [17, 0, 'evening', 'Good evening'],
        [23, 59, 'evening', 'Good evening'],
        [0, 30, 'evening', 'Good evening'],     // 2am is not morning
    ];

    test.each(CASES)('ACCEPTANCE: %i:%i renders the %s copy', async (h, m, band, copy) => {
        await app.page.clock.setFixedTime(at(2025, 5, 15, h, m));
        const r = await ordinary(app.page);
        expect(r.hour).toBe(h);                 // the page really believes it
        expect(r.shown).toBe(true);
        expect(r.band).toBe(band);
        expect(r.text).toBe(`${copy}, Marcus.`);
    }, 40_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

describe('the once-per-local-day gate, over a real midnight', () => {
    let app;
    beforeAll(async () => {
        /* Tuesday into Wednesday, deliberately. A Sunday-into-Monday
           midnight also rolls the ISO week over, syncProgression() closes
           the finished week out as a miss, and the missed-week line
           correctly outranks the greeting. That is the right behaviour and
           the wrong fixture for a question about the DAILY gate. */
        app = await openApp({ clock: at(2025, 5, 17, 23, 50) });
        await signIn(app.page, { id: 'ck2' });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: greeted at 23:50, silent at 23:55, eligible again at 00:10', async () => {
        const late = await ordinary(app.page);
        expect(late.shown).toBe(true);
        expect(late.key).toBe('bp_greeted_ck2_2025-06-17');

        // Same day, five minutes later. The gate is spent.
        await app.page.clock.setFixedTime(at(2025, 5, 17, 23, 55));
        const again = await app.page.evaluate(() => {
            renderDashboard();
            const el = document.getElementById('hq-greeting');
            return { shown: !el.classList.contains('hidden'), key: _greetedKey() };
        });
        expect(again.key).toBe('bp_greeted_ck2_2025-06-17');
        expect(again.shown).toBe(false);

        // Twenty minutes later it is tomorrow, and the key moves with it.
        await app.page.clock.setFixedTime(at(2025, 5, 18, 0, 10));
        const tomorrow = await app.page.evaluate(() => {
            renderDashboard();
            const el = document.getElementById('hq-greeting');
            return { shown: !el.classList.contains('hidden'), key: _greetedKey(),
                     text: el.textContent, band: el.dataset.band };
        });
        expect(tomorrow.key).toBe('bp_greeted_ck2_2025-06-18');
        expect(tomorrow.shown).toBe(true);
        expect(tomorrow.band).toBe('evening');   // 00:10 is evening, not morning
        // And yesterday's key is still there, un-reused.
        const keys = await app.page.evaluate(() =>
            Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).sort());
        expect(keys).toEqual(['bp_greeted_ck2_2025-06-17', 'bp_greeted_ck2_2025-06-18']);
    }, 60_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

describe('the gate key is local, not UTC', () => {
    let app;
    beforeAll(async () => {
        /* UTC+12/13. At 10:00 in Auckland the UTC date is still YESTERDAY, so
           a key built from toISOString would roll over mid-morning and let a
           member be greeted twice in one of their days. localDayKey() reads
           local date parts for exactly this reason; this proves it in the
           page rather than only in the unit test. */
        app = await openApp({ clock: at(2025, 5, 17, 22), timezoneId: 'Pacific/Auckland' });
        await signIn(app.page, { id: 'ck3' });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: at UTC+12 the key follows the local date', async () => {
        const r = await ordinary(app.page);
        const utc = await app.page.evaluate(() => new Date().toISOString().split('T')[0]);
        const local = await app.page.evaluate(() => {
            const d = new Date();
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        });
        expect(utc).not.toBe(local);              // the trap is actually armed
        expect(r.key).toBe('bp_greeted_ck3_' + local);
        expect(r.key).not.toContain(utc);
    }, 60_000);

    test('ACCEPTANCE: crossing UTC midnight does not re-open the gate', async () => {
        // 00:30 UTC is 12:30 the same local day: a new UTC date, no new
        // local date, which is precisely the case a UTC key would botch.
        await app.page.clock.setFixedTime(at(2025, 5, 18, 0, 30));
        const r = await app.page.evaluate(() => {
            renderDashboard();
            const el = document.getElementById('hq-greeting');
            return { shown: !el.classList.contains('hidden'), key: _greetedKey(),
                     utc: new Date().toISOString().split('T')[0] };
        });
        expect(r.shown).toBe(false);              // still spent
        expect(r.key).toBe('bp_greeted_ck3_2025-06-18');
    }, 60_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

describe('the return boundaries, read at different hours', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: at(2025, 5, 15, 12) });
        await signIn(app.page, { id: 'ck4' });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /* A session logged at 20:45, so the stored time of day is nowhere near
       the hour it is read at. This is the shape of the 2B.2 defect: the
       comparison used to drift with the reading hour. */
    const logged = (daysAgo) => {
        const d = new Date(2025, 5, 15 - daysAgo, 20, 45, 0);
        return [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
    };

    const READ_HOURS = [0, 6, 9, 12, 18, 23];

    test.each(READ_HOURS)('ACCEPTANCE: at %i:00, six days away is still nothing', async (h) => {
        await app.page.clock.setFixedTime(at(2025, 5, 15, h));
        const r = await ordinary(app.page, { sessionLog: logged(6) });
        const key = await app.page.evaluate(() =>
            document.getElementById('today-liveness').dataset.liveness || null);
        expect(key).toBeNull();
        expect(r.shown).toBe(true);               // so the greeting gets its turn
    }, 40_000);

    test.each(READ_HOURS)('ACCEPTANCE: at %i:00, seven days away is returning', async (h) => {
        await app.page.clock.setFixedTime(at(2025, 5, 15, h));
        await ordinary(app.page, { sessionLog: logged(7) });
        const key = await app.page.evaluate(() =>
            document.getElementById('today-liveness').dataset.liveness || null);
        expect(key).toBe('returning');
    }, 40_000);

    test.each(READ_HOURS)('ACCEPTANCE: at %i:00, twenty-seven days is still returning', async (h) => {
        await app.page.clock.setFixedTime(at(2025, 5, 15, h));
        await ordinary(app.page, { sessionLog: logged(27) });
        const key = await app.page.evaluate(() =>
            document.getElementById('today-liveness').dataset.liveness || null);
        expect(key).toBe('returning');
    }, 40_000);

    test.each(READ_HOURS)('ACCEPTANCE: at %i:00, twenty-eight days is an extended return', async (h) => {
        await app.page.clock.setFixedTime(at(2025, 5, 15, h));
        await ordinary(app.page, { sessionLog: logged(28) });
        const r = await app.page.evaluate(() => ({
            key: document.getElementById('today-liveness').dataset.liveness || null,
            text: document.getElementById('today-liveness').textContent,
        }));
        expect(r.key).toBe('extended-return');
        expect(r.text).toContain('Welcome back, Marcus.');
    }, 40_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});
