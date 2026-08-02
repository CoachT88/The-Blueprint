import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Water logging was never actually capped — only the progress bar was clamped,
 * so passing 3L showed a full bar and "Goal hit" and looked like a ceiling.
 * Surplus is now visible, and because bigger numbers are encouraged, a mistyped
 * entry has to be recoverable.
 */
describe('hydration', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'hyd' });
        await app.page.evaluate(() => { localStorage.clear(); loadHydrationUnit(); goToStep(0); });
        await app.page.waitForTimeout(300);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    const read = () => app.page.evaluate(() => ({
        ml: getHydration(),
        amount: document.getElementById('hydration-amount').innerText,
        over: document.getElementById('hydration-over').classList.contains('hidden')
            ? null : document.getElementById('hydration-over').textContent,
        msg: document.getElementById('hydration-msg').innerText,
        barPct: document.getElementById('hydration-bar').style.width,
        complete: document.getElementById('hydration-bar').className.includes('complete'),
        undoShown: !document.getElementById('hydration-undo-btn').classList.contains('hidden'),
        note: document.getElementById('hydration-entry-note').classList.contains('hidden')
            ? null : document.getElementById('hydration-entry-note').textContent,
    }));

    test('exactly 3L completes the goal', async () => {
        await app.page.evaluate(() => setHydration(3));
        await app.page.waitForTimeout(150);
        const r = await read();
        expect(r.ml).toBe(3000);
        expect(r.complete).toBe(true);
        expect(r.barPct).toBe('100%');
        expect(r.over).toBeNull();
    });

    test('logging past the goal keeps counting and shows the surplus', async () => {
        await app.page.evaluate(() => setHydration(0.6));
        await app.page.waitForTimeout(150);
        const r = await read();
        expect(r.ml).toBe(3600);
        expect(r.amount).toMatch(/3\.6L \/ 3L/);
        expect(r.over).toBe('+0.6L over');
        expect(r.barPct).toBe('100%');           // bar stays full, does not overflow
        expect(r.msg).toMatch(/bonus|Past target|Over the line/i);
    });

    test('the card layout holds with a large total', async () => {
        await app.page.evaluate(() => setHydration(4.9));
        await app.page.waitForTimeout(150);
        const fits = await app.page.evaluate(() => {
            const card = document.getElementById('hq-hydration-card');
            return card.scrollWidth <= card.clientWidth + 1;
        });
        expect(fits).toBe(true);
    });

    test('an implausible entry is refused without changing the total', async () => {
        const before = await app.page.evaluate(() => getHydration());
        await app.page.evaluate(() => setHydration(500));
        await app.page.waitForTimeout(150);
        const r = await read();
        expect(r.ml).toBe(before);
        expect(r.note).toMatch(/typo/i);
    });

    test('the last entry can be undone', async () => {
        await app.page.evaluate(() => {
            localStorage.setItem(getTodayKey(), '1000'); _lastHydrationDelta = 0; renderHydration();
            setHydration(0.5);
        });
        await app.page.waitForTimeout(150);
        let r = await read();
        expect(r.ml).toBe(1500);
        expect(r.undoShown).toBe(true);

        await app.page.evaluate(() => undoHydration());
        await app.page.waitForTimeout(150);
        r = await read();
        expect(r.ml).toBe(1000);
        expect(r.undoShown).toBe(false);
    });

    test('clearing the day asks first', async () => {
        const afterCancel = await app.page.evaluate(() => {
            const orig = window.confirm; window.confirm = () => false;
            resetHydration(); const v = getHydration(); window.confirm = orig; return v;
        });
        expect(afterCancel).toBe(1000);

        await app.page.evaluate(() => { window.confirm = () => true; resetHydration(); });
        await app.page.waitForTimeout(150);
        expect(await app.page.evaluate(() => getHydration())).toBe(0);
    });

    test('switching units redraws immediately', async () => {
        await app.page.evaluate(() => {
            localStorage.setItem(getTodayKey(), '1500'); renderHydration(); setHydrationUnit('oz');
        });
        await app.page.waitForTimeout(150);
        const r = await read();
        expect(r.amount).toMatch(/51oz \/ 101oz/);
    });

    test('three 33.8oz entries reach the goal despite float drift', async () => {
        // These used to total 2999.75ml, so the display read 101oz / 101oz while
        // the goal never registered as complete.
        await app.page.evaluate(() => {
            localStorage.setItem(getTodayKey(), '0'); _lastHydrationDelta = 0; setHydrationUnit('oz');
            setHydration(33.8); setHydration(33.8); setHydration(33.8);
        });
        await app.page.waitForTimeout(150);
        const r = await read();
        expect(r.complete).toBe(true);
    });

    test('the unit choice survives a reload', async () => {
        await app.page.reload({ waitUntil: 'domcontentloaded' });
        await app.page.addStyleTag({ path: new URL('./tw-shim.css', import.meta.url).pathname });
        await app.page.waitForTimeout(900);
        await signIn(app.page, { id: 'hyd' });
        await app.page.evaluate(() => { loadHydrationUnit(); goToStep(0); });
        await app.page.waitForTimeout(300);
        expect(await app.page.evaluate(() => _hydrationUnit)).toBe('oz');
    }, 40_000);

    test('Coach Tee is told litres, not millilitres', async () => {
        // This read `getHydration().toFixed(1)` and labelled it litres, so a
        // member at 2.5L was reported to the model as "2500.0L of 3L".
        await app.page.evaluate(() => {
            setHydrationUnit('L');
            localStorage.setItem(getTodayKey(), '2500');
            persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', eq: 7, rpe: 5, xpEarned: 15 }];
        });
        const ctx = await app.page.evaluate(() => _coachContext());
        expect(ctx).toMatch(/Water logged today: 2\.5L of 3L/);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
