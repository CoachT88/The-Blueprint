import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Mobile viewport preconditions, and an honest statement of their limits.
 *
 * WHAT THESE TESTS CAN PROVE. Chromium at a phone viewport can read the
 * computed font size of every editable control, and the viewport meta. Those
 * are the exact MECHANISMS behind two real iOS failures: Safari zooms the page
 * when a focused field's text is under 16px, and env(safe-area-inset-*)
 * resolves to zero unless viewport-fit=cover is set.
 *
 * WHAT THEY CANNOT PROVE. Chromium cannot emulate the iOS keyboard, the
 * visualViewport insets it produces, Safari's address-bar collapse, the real
 * safe-area insets, or standalone PWA display mode. So nothing here claims the
 * app "works on iPhone". Keyboard overlap, CTA reachability and bottom-sheet
 * behaviour are on the manual device checklist, deliberately, rather than
 * being implied by a DOM assertion that cannot see them.
 */

const THU = new Date(Date.UTC(2026, 2, 12, 12));

const row = () => ({
    id: 'ex', total_xp: 500, difficulty: 'intermediate',
    schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
    completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 20, xp_migrated: true, week_key: '',
    primary_goal: 'size', programme: null, day_plans: [], pelvic_profile: 'standard',
    updated_at: '2026-03-12T00:00:00.000Z',
});

describe('iOS focus zoom cannot be triggered', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
        await app.page.evaluate(async (r) => {
            window.__row = r; await loadPersisted(); renderDashboard();
        }, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('NO EDITABLE CONTROL INVITES iOS ZOOM', async () => {
        /* Under 16px, Safari on iPhone zooms the whole page on focus, which
           shifts the layout and can push the submit button off screen. Every
           editable control in the document is checked, including the ones
           inside modals that are hidden right now, because a hidden field is
           still focusable once its modal opens. */
        const bad = await app.page.evaluate(() => {
            const out = [];
            document.querySelectorAll('input,textarea,select').forEach(el => {
                const t = (el.getAttribute('type') || '').toLowerCase();
                /* Not typeable, so focus never raises the keyboard. */
                if (['hidden', 'checkbox', 'radio', 'range', 'file',
                     'button', 'submit', 'reset', 'color'].includes(t)) return;
                const px = parseFloat(getComputedStyle(el).fontSize);
                if (!(px >= 16)) out.push({ id: el.id || el.className || t || el.tagName, px });
            });
            return out;
        });
        expect(bad).toEqual([]);
    }, 60_000);

    test('A NEWLY ADDED CONTROL INHERITS THE FLOOR WITHOUT BEING TOLD', async () => {
        /* Every control that exists today is at 16px via a more specific rule,
           so deleting the blanket element rule would not move any of them: the
           mutation testing that found this called it equivalent, correctly.
           The blanket rule's real job is the NEXT control somebody adds, which
           is exactly what gets forgotten. So the net is tested directly. */
        const r = await app.page.evaluate(() => {
            const el = document.createElement('input');
            el.type = 'text';                      // no class, no inline style
            document.body.appendChild(el);
            const onBody = parseFloat(getComputedStyle(el).fontSize);
            /* And inside a small-font container, which is the case that
               actually bites: Tailwind's preflight sets font-size:100% on form
               controls, so without a stronger rule a bare input INHERITS the
               tiny context instead of the 16px floor. */
            const box = document.createElement('div');
            box.style.fontSize = '10px';
            const el2 = document.createElement('input');
            el2.type = 'text';
            box.appendChild(el2);
            document.body.appendChild(box);
            const nested = parseFloat(getComputedStyle(el2).fontSize);
            el.remove(); box.remove();
            return { onBody, nested };
        });
        expect(r.onBody).toBeGreaterThanOrEqual(16);
        expect(r.nested).toBeGreaterThanOrEqual(16);
    }, 60_000);

    test('and the member can still zoom deliberately', async () => {
        /* The lazy fix for the above is maximum-scale=1 or user-scalable=no.
           Both stop a member pinch-zooming anything, which is an
           accessibility regression, so neither may appear. */
        const content = await app.page.evaluate(() => {
            const m = document.querySelector('meta[name="viewport"]');
            return m ? m.getAttribute('content') : null;
        });
        expect(content).toBeTruthy();
        expect(content).not.toContain('maximum-scale');
        expect(content).not.toContain('user-scalable');
    }, 60_000);

    test('viewport-fit is deliberately absent, and that is why env() is unused', async () => {
        /* Recorded as a decision, not an oversight. Without viewport-fit=cover
           iOS insets the layout viewport itself, so content cannot reach under
           the notch or the home indicator AND env(safe-area-inset-*) is zero.
           Adding env() padding would therefore do nothing, and adding
           viewport-fit=cover would create the overlap it is meant to fix.

           If a future change adds viewport-fit=cover, this test fails and the
           safe-area audit becomes mandatory rather than optional. */
        const r = await app.page.evaluate(() => {
            const m = document.querySelector('meta[name="viewport"]');
            const probe = document.createElement('div');
            probe.style.paddingTop = 'env(safe-area-inset-top)';
            document.body.appendChild(probe);
            const pad = getComputedStyle(probe).paddingTop;
            probe.remove();
            return { content: m ? m.getAttribute('content') : null, pad };
        });
        expect(r.content).not.toContain('viewport-fit');
        /* And no stylesheet rule is relying on env() today. */
        expect(['0px', '']).toContain(r.pad);
    }, 60_000);

    test('the app renders at a phone width with no horizontal overflow', async () => {
        const o = await app.page.evaluate(() => ({
            docW: document.documentElement.clientWidth,
            scrollW: document.documentElement.scrollWidth,
            bodyScrollW: document.body.scrollWidth,
        }));
        /* A horizontal scrollbar on a phone is the symptom that something is
           wider than the viewport, which is also how a CTA ends up off
           screen. One pixel of tolerance for subpixel rounding. */
        expect(o.scrollW).toBeLessThanOrEqual(o.docW + 1);
        expect(o.bodyScrollW).toBeLessThanOrEqual(o.docW + 1);
    }, 60_000);
});
