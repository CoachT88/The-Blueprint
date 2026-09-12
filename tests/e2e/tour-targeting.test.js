import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The tour used to run against the wrong part of the screen, and before that
 * it did not run at all. Three separate faults, each of which looks like
 * nothing in the source:
 *
 *   1. _blockingModalOpen() counted .ambient-bg — a full-screen decorative
 *      layer with pointer-events:none that is always there — as an open
 *      modal. maybeStartTour() then waited fifteen seconds for it to close
 *      and gave up. The tour never ran, for anybody, permanently.
 *
 *   2. A brand-new account was shown the "what's new" notice about a version
 *      it had never used. That is a full-screen modal, so it stood in front
 *      of the first session and pushed the tour behind it.
 *
 *   3. renderTourStop() smooth-scrolled to the target and then measured it
 *      after a flat 380ms. When the scroll ran longer, the spotlight was cut
 *      where the element had been. On the calendar stop that was 93px away —
 *      a hole in empty space beside the card being described.
 *
 * These assert what a user sees, not what the code says.
 */

const STOP_COUNT = 8;

describe('the tour starts at all', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'tt1' });
        await app.page.evaluate(() => goToStep(0));
        await app.page.waitForTimeout(600);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the ambient background is not mistaken for a modal', async () => {
        /* It is fixed, opaque, full-viewport and permanent. The only thing
           separating it from a real overlay is that you can tap through it. */
        const seen = await app.page.evaluate(() => {
            const bg = document.querySelector('.ambient-bg');
            const cs = getComputedStyle(bg);
            return {
                present: !!bg,
                fixed: cs.position === 'fixed',
                fullScreen: bg.getBoundingClientRect().height > window.innerHeight * 0.5,
                clickThrough: cs.pointerEvents === 'none',
                blocking: _blockingModalOpen()
            };
        });
        expect(seen.present).toBe(true);
        expect(seen.fixed).toBe(true);
        expect(seen.fullScreen).toBe(true);
        expect(seen.clickThrough).toBe(true);
        expect(seen.blocking).toBe(false);
    }, 30_000);

    test('a real modal still holds the tour back', async () => {
        // The guard has to keep working, or the tour talks over the Manual.
        /* Opened the way the app opens it — the Manual is styled in plain CSS
           and shows on a .show class, while the update notice is Tailwind
           utilities and shows by dropping .hidden. Testing one mechanism
           would miss the other, which is the exact trap this guard exists
           for. Both are checked. */
        const blocked = await app.page.evaluate(async () => {
            const out = {};
            const manual = document.getElementById('manual-modal');
            manual.classList.add('show');
            await new Promise(r => requestAnimationFrame(r));
            out.manual = _blockingModalOpen();
            manual.classList.remove('show');

            const notice = document.getElementById('update-notice-modal');
            notice.classList.remove('hidden');
            await new Promise(r => requestAnimationFrame(r));
            out.notice = _blockingModalOpen();
            notice.classList.add('hidden');

            await new Promise(r => requestAnimationFrame(r));
            out.afterBothClosed = _blockingModalOpen();
            return out;
        });
        expect(blocked.manual).toBe(true);
        expect(blocked.notice).toBe(true);
        expect(blocked.afterBothClosed).toBe(false);
    }, 30_000);

    test('a new account is not told what is new in a version it never had', async () => {
        const shown = await app.page.evaluate(() => {
            localStorage.removeItem('bp_update_notice_v1_tt1');
            localStorage.removeItem('bp_onboarded_tt1');
            maybeShowUpdateNotice();
            return !document.getElementById('update-notice-modal').classList.contains('hidden');
        });
        expect(shown).toBe(false);
    }, 30_000);

    test('someone who used the last version still gets the notice', async () => {
        const shown = await app.page.evaluate(() => {
            localStorage.removeItem('bp_update_notice_v1_tt1');
            localStorage.setItem('bp_onboarded_tt1', '1');
            maybeShowUpdateNotice();
            const open = !document.getElementById('update-notice-modal').classList.contains('hidden');
            dismissUpdateNotice();
            return open;
        });
        expect(shown).toBe(true);
    }, 30_000);
});

describe('the tour points at what it is talking about', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'tt2' });
        await app.page.evaluate(() => goToStep(0));
        await app.page.waitForTimeout(600);
        await app.page.evaluate(() => maybeStartTour());
        await app.page.waitForTimeout(900);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('every stop cuts its hole over its own element', async () => {
        const count = await app.page.evaluate(() => _tourStops.length);
        expect(count).toBe(STOP_COUNT);

        const misses = [];
        for (let i = 0; i < count; i++) {
            // Past the hole's own 0.32s transition, or the box read is mid-flight.
            await app.page.waitForTimeout(1_100);
            const s = await app.page.evaluate(() => {
                const el = document.querySelector(_tourStops[_tourIdx].sel);
                const r = el.getBoundingClientRect();
                const h = document.getElementById('tour-hole');
                const hr = h.getBoundingClientRect();
                return {
                    sel: _tourStops[_tourIdx].sel,
                    /* The hole is the target plus 8px of padding on every
                       side, so it must contain the target rather than merely
                       sit near it. A couple of pixels of slack covers the
                       spotlight's own border and subpixel layout. */
                    covers: hr.top <= r.top + 3 && hr.bottom >= r.bottom - 3
                         && hr.left <= r.left + 3 && hr.right >= r.right - 3,
                    inView: r.top >= -5 && r.bottom <= window.innerHeight + 5,
                    gap: Math.round(Math.abs(hr.top - (r.top - 8)))
                };
            });
            if (!s.covers || !s.inView) misses.push(s);
            if (i < count - 1) await app.page.evaluate(() => tourNext());
        }
        expect(misses).toEqual([]);
    }, 120_000);
});
