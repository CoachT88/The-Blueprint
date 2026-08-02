import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/** The tour must show once, stay replayable, and not be consumed by a one-off tip. */
describe('tour lifecycle', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'u1' });
        await app.page.evaluate(() => goToStep(0));
        await app.page.waitForTimeout(600);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    const shown = () => app.page.evaluate(() => document.getElementById('tour-layer').classList.contains('show'));

    test('runs the first time', async () => {
        await app.page.evaluate(() => maybeStartTour());
        await app.page.waitForTimeout(700);
        expect(await shown()).toBe(true);
    }, 30_000);

    test('skipping marks it seen', async () => {
        await app.page.evaluate(() => endTour());
        await app.page.waitForTimeout(200);
        expect(await app.page.evaluate(() => localStorage.getItem('bp_tour_done_u1'))).toBe('1');
    });

    test('does not run again', async () => {
        await app.page.evaluate(() => maybeStartTour());
        await app.page.waitForTimeout(500);
        expect(await shown()).toBe(false);
    }, 30_000);

    test('replaying from the Manual forces it back on', async () => {
        await app.page.evaluate(() => replayTour());
        await app.page.waitForTimeout(900);
        expect(await shown()).toBe(true);
        await app.page.evaluate(() => endTour());
    }, 30_000);

    test('a one-time tip shows once, with no dots', async () => {
        await app.page.evaluate(() => localStorage.removeItem('bp_tour_done_u1'));
        await app.page.evaluate(() => oneTimeTip('demo', '#launch-btn', 'Tip', 'Body text'));
        await app.page.waitForTimeout(600);
        const r = await app.page.evaluate(() => ({
            shown: document.getElementById('tour-layer').classList.contains('show'),
            dots: document.getElementById('tour-dots').children.length,
        }));
        expect(r.shown).toBe(true);
        expect(r.dots).toBe(0);
    }, 30_000);

    test('and does not consume the main tour flag', async () => {
        await app.page.evaluate(() => endTour());
        expect(await app.page.evaluate(() => localStorage.getItem('bp_tour_done_u1'))).toBeNull();
    });

    test('the same tip never shows twice', async () => {
        await app.page.evaluate(() => oneTimeTip('demo', '#launch-btn', 'Tip', 'Body text'));
        await app.page.waitForTimeout(400);
        expect(await shown()).toBe(false);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('intro to tour chain', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'newbie' });
        await app.page.evaluate(() => goToStep(0));
        await app.page.waitForTimeout(500);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('finishing the intro flows into the tour', async () => {
        await app.page.evaluate(() => showOnboarding());
        await app.page.waitForTimeout(400);
        expect(await app.page.evaluate(
            () => document.getElementById('onboarding-overlay').classList.contains('show'))).toBe(true);

        // Click through every slide using the real button.
        const slides = await app.page.evaluate(() => document.querySelectorAll('.ob-slide').length);
        for (let i = 0; i < slides; i++) {
            await app.page.click('#ob-next-btn');
            await app.page.waitForTimeout(350);
        }

        expect(await app.page.evaluate(() => localStorage.getItem('bp_onboarded_newbie'))).toBe('1');
        await app.page.waitForTimeout(1_200); // finishOnboarding defers the tour by 450ms
        expect(await app.page.evaluate(
            () => document.getElementById('tour-layer').classList.contains('show'))).toBe(true);
    }, 40_000);

    test('skipping the intro does not force the tour', async () => {
        await app.page.evaluate(() => {
            endTour();
            localStorage.removeItem('bp_tour_done_newbie');
            showOnboarding();
        });
        await app.page.waitForTimeout(300);
        await app.page.click('#ob-skip-btn');
        await app.page.waitForTimeout(1_400);
        expect(await app.page.evaluate(
            () => document.getElementById('tour-layer').classList.contains('show'))).toBe(false);
        expect(app.errors).toEqual([]);
    }, 40_000);
});
