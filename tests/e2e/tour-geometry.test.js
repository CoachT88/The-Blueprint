import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The guided tour spotlights HQ elements one at a time. Two constraints make
 * this measurable at all:
 *
 *   - #step-0 is the scrolling element (html/body are overflow:hidden), so
 *     getBoundingClientRect already returns viewport coordinates and the fixed
 *     hole and card need no scroll-offset maths.
 *   - Smooth scrolling has no resolvable completion signal, so the app settles
 *     before measuring and so does this test.
 */
describe('tour geometry', () => {
    let app, stops;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'tour1' });
        await app.page.evaluate(() => goToStep(0));
        await app.page.waitForTimeout(700);
        await app.page.evaluate(() => startTour());
        await app.page.waitForTimeout(900);
        stops = await app.page.evaluate(() => _tourStops.map(s => s.sel));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('resolves all eight stops', () => {
        expect(stops).toEqual([
            '#hq-stat-chips', '#hq-calendar-card', '#hq-tip-card', '#hq-hydration-card',
            '#hq-checkin-card', '#launch-btn', '#hq-coach-row', '#hq-tools-row',
        ]);
    });

    test('every stop lands on its target, in view, clear of the spotlight', async () => {
        const results = [];
        for (let i = 0; i < stops.length; i++) {
            results.push(await app.page.evaluate(() => {
                const hole = document.getElementById('tour-hole').getBoundingClientRect();
                const card = document.getElementById('tour-card').getBoundingClientRect();
                const tgt = document.querySelector(_tourStops[_tourIdx].sel).getBoundingClientRect();
                return {
                    sel: _tourStops[_tourIdx].sel,
                    // The hole is drawn with 8px of padding around the target.
                    holeOnTarget: Math.abs(hole.top + 8 - tgt.top) < 3 && Math.abs(hole.left + 8 - tgt.left) < 3,
                    cardInViewport: card.top >= 0 && card.bottom <= window.innerHeight
                        && card.left >= 0 && card.right <= window.innerWidth,
                    cardOverlapsHole: !(card.bottom < hole.top || card.top > hole.bottom),
                    nextLabel: document.getElementById('tour-next').textContent,
                    shown: document.getElementById('tour-layer').classList.contains('show'),
                };
            }));
            await app.page.evaluate(() => tourNext());
            await app.page.waitForTimeout(800);
        }

        for (const r of results) {
            expect(r.holeOnTarget, `${r.sel} spotlight off target`).toBe(true);
            expect(r.cardInViewport, `${r.sel} card outside viewport`).toBe(true);
            expect(r.cardOverlapsHole, `${r.sel} card covers the spotlight`).toBe(false);
            expect(r.shown).toBe(true);
        }
        expect(results.at(-1).nextLabel).toBe('Done');
        expect(app.errors).toEqual([]);
    }, 60_000);

    test('the layer closes at the end', async () => {
        const shown = await app.page.evaluate(
            () => document.getElementById('tour-layer').classList.contains('show'));
        expect(shown).toBe(false);
    });
});
