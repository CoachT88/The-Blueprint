import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, visibleStep } from './harness.js';

/**
 * prefers-reduced-motion, which is accessibility debt rather than a feature.
 *
 * The reason this file exists at all is one line of CSS:
 *
 *     .hq-anim { opacity: 0; animation: fadeInUp ... forwards }
 *
 * Every section of the HQ is invisible until its animation runs. The usual
 * reduced-motion recipe is `animation: none !important`, and applying it here
 * would leave the entire home screen permanently blank for exactly the
 * members who asked the operating system to calm things down. The patch
 * collapses durations instead, and these tests are what stop someone
 * "simplifying" it back into an outage.
 *
 * Playwright's emulateMedia sets the real media feature, so the assertions
 * below are against the browser's own matching, not a stub.
 */

const SEEN = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return parseFloat(s.opacity) > 0.9 && s.visibility !== 'hidden'
        && s.display !== 'none' && r.width > 0 && r.height > 0;
};

describe('reduced motion keeps the product usable', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await app.page.emulateMedia({ reducedMotion: 'reduce' });
        await signIn(app.page, { id: 'rm' });
        await app.page.evaluate(() => {
            persisted.primaryGoal = 'all';
            persisted.schedule[new Date().getDay()] = 'length';
            goToStep(0);
        });
        await app.page.waitForTimeout(600);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the media feature is actually active', async () => {
        const matched = await app.page.evaluate(() =>
            window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        expect(matched).toBe(true);
    });

    test('REGRESSION: every animated HQ section is still visible', async () => {
        // The failure this guards is a blank home screen.
        const hidden = await app.page.evaluate((fn) => {
            const seen = new Function('el', `return (${fn})(el)`);
            return [...document.querySelectorAll('#step-0 .hq-anim')]
                .filter(el => !seen(el))
                .map(el => el.id || el.className);
        }, SEEN.toString());
        expect(hidden).toEqual([]);
    });

    test('the Today card and its primary action are visible', async () => {
        const r = await app.page.evaluate((fn) => {
            const seen = new Function('el', `return (${fn})(el)`);
            const card = document.getElementById('hq-today-card');
            const launch = document.getElementById('launch-btn');
            return {
                card: seen(card),
                launch: seen(launch),
                headline: document.getElementById('today-headline').textContent.trim(),
                cardOpacity: getComputedStyle(card).opacity,
            };
        }, SEEN.toString());
        expect(r.card).toBe(true);
        expect(r.launch).toBe(true);
        expect(r.headline).toBe('Length Day');
        expect(r.cardOpacity).toBe('1');
    });

    test('animations are collapsed, not removed', async () => {
        // `animation: none` would discard the `forwards` end state that makes
        // .hq-anim visible in the first place.
        const r = await app.page.evaluate(() => {
            const el = document.querySelector('#step-0 .hq-anim');
            const s = getComputedStyle(el);
            return { name: s.animationName, duration: s.animationDuration };
        });
        expect(r.name).not.toBe('none');
        expect(parseFloat(r.duration)).toBeLessThan(0.05);
    });

    test('transitions are collapsed too', async () => {
        const ms = await app.page.evaluate(() =>
            parseFloat(getComputedStyle(document.getElementById('launch-btn')).transitionDuration));
        expect(ms).toBeLessThan(0.05);
    });

    test('no navigation or session regression', async () => {
        // The patch is CSS only, so the whole funnel must behave identically.
        const r = await app.page.evaluate(() => {
            document.getElementById('launch-btn').click();
            const atReady = session.step;
            document.querySelector('[data-soreness="none"]').click();
            document.getElementById('ready-cta').click();
            return { atReady, after: session.step, routineType: session.routineType };
        });
        expect(r.atReady).toBe(1);
        expect(r.after).toBe(2);
        expect(r.routineType).toBe('length');
        await app.page.evaluate(() => { session._aborting = true; goToStep(0); session._aborting = false; });
        expect(await visibleStep(app.page)).toBe('step-0');
    }, 30_000);

    test('the page threw nothing along the way', () => {
        expect(app.errors).toEqual([]);
    });
});

describe('without reduced motion nothing changed', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'rm2' });
        await app.page.evaluate(() => { persisted.primaryGoal = 'all'; goToStep(0); });
        await app.page.waitForTimeout(600);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the full-length animation is still in place by default', async () => {
        const r = await app.page.evaluate(() => {
            const s = getComputedStyle(document.querySelector('#step-0 .hq-anim'));
            return { name: s.animationName, duration: parseFloat(s.animationDuration) };
        });
        expect(r.name).toBe('fadeInUp');
        expect(r.duration).toBeGreaterThan(0.1);
    });

    test('and the HQ is visible here too', async () => {
        const visible = await app.page.evaluate(() =>
            parseFloat(getComputedStyle(document.getElementById('hq-today-card')).opacity) > 0.9);
        expect(visible).toBe(true);
    });
});
