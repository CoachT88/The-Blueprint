import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Which overlay wins when two are open. Phase 3B.
 *
 * Written BEFORE the z-index ladder replaced the old values, so it pins the
 * behaviour that shipped rather than the behaviour the ladder produces. If
 * the ladder had changed any of these outcomes, this file would have failed
 * and said so.
 *
 * Asserted with elementFromPoint rather than by reading z-index, because the
 * numbers are exactly what is being changed. What matters is which surface a
 * finger actually lands on.
 *
 * The old values were 25 distinct numbers in four declaration mechanisms,
 * with five collision clusters where DOM order silently decided the winner.
 * `#pass-info-modal` and `#account-modal` both sat at 99996 even though one
 * opens from the other.
 */
const topAt = (page, x, y) => page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    /* Resolve to the BODY-LEVEL container, not merely the nearest ancestor
       carrying an id. Every one of these overlays is a direct child of
       <body> and several hold inner ids of their own (#milestone-desc,
       #rest-arc), so stopping at the first id would report a child and look
       like a stacking failure when the stacking is right. */
    for (let n = el; n; n = n.parentElement)
        if (n.parentElement === document.body) return n.id || n.tagName;
    return el.id || el.tagName;
}, [x, y]);

/** Force an overlay open without going through its opener. */
const show = (page, id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    el.classList.remove('hidden'); el.classList.add('show');
    if (id === 'history-modal') el.style.display = 'flex';
}, id);

describe('overlay stacking', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'stk' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const reset = () => app.page.evaluate(() => {
        document.querySelectorAll('[id$="-modal"],[id$="-overlay"],#tour-layer,#rest-overlay,#auth-screen')
            .forEach(e => { e.classList.add('hidden'); e.classList.remove('show'); e.style.display = ''; });
        goToStep(0);
    });

    /** [label, lower overlay, upper overlay]. Upper must win.. */
    const PAIRS = [
        ['account -> pass-info',            'account-modal',          'pass-info-modal'],
        ['session summary -> milestone',    'session-summary-modal',  'milestone-modal'],
        ['member modal -> tour',            'account-modal',          'tour-layer'],
        ['pelvic screener -> its result',   'pelvic-screen-modal',    'pelvic-result-modal'],
        ['photo log -> photo viewer',       'photo-log-modal',        'photo-viewer-overlay'],
        ['notif sheet -> pelvic result',    'notif-modal',            'pelvic-result-modal'],
    ];

    /* Only pairs that can GENUINELY be open together are listed. Two
       full-screen modals on the same tier (Progress against the manual,
       Coach against the weekly report) tie on DOM order, and that is
       deliberate: every one of them is opened from a control inside #step-0,
       which they themselves cover, so a second cannot be reached while the
       first is up. An earlier draft of this file asserted orderings for
       those pairs and was pinning an accident of the old arbitrary z-index
       numbers rather than any real behaviour. Where overlays really do
       nest, they get an explicit --z-*-over tier instead of relying on
       source order. */

    test.each(PAIRS)('ACCEPTANCE: %s', async (_label, lower, upper) => {
        await reset();
        await show(app.page, lower);
        await show(app.page, upper);
        await app.page.waitForTimeout(80);
        const hit = await topAt(app.page, 195, 500);        // centre of the viewport
        expect(hit, `${upper} must sit above ${lower}`).toBe(upper);
    }, 40_000);

    test('ACCEPTANCE: the auth gate covers every member overlay', async () => {
        await reset();
        for (const id of ['account-modal', 'chart-modal', 'manual-modal', 'coach-modal',
                          'session-summary-modal', 'weekly-report-modal'])
            await show(app.page, id);
        await app.page.evaluate(() => showAuthScreen());
        await app.page.waitForTimeout(80);
        expect(await topAt(app.page, 195, 420)).toBe('auth-screen');
    }, 40_000);

    test('ACCEPTANCE: the rest overlay covers the session screen', async () => {
        await reset();
        await app.page.evaluate(() => { goToStep(4); });
        await show(app.page, 'rest-overlay');
        await app.page.waitForTimeout(80);
        expect(await topAt(app.page, 195, 420)).toBe('rest-overlay');
    }, 40_000);

    test('ACCEPTANCE: the loading screen covers everything, including auth', async () => {
        await reset();
        await app.page.evaluate(() => {
            showAuthScreen();
            document.getElementById('loading-screen').classList.remove('hidden');
            document.getElementById('loading-screen').style.display = '';
        });
        await app.page.waitForTimeout(80);
        expect(await topAt(app.page, 195, 420)).toBe('loading-screen');
    }, 40_000);

    test('ACCEPTANCE: nesting pairs are separated by TIER, not by DOM order', async () => {
        /* The hit test above passes for account -> pass-info even when both
           sit on the same tier, because pass-info happens to come later in
           the markup. That is the exact fragility the ladder replaced, so
           source order must not be what is holding it up: the computed
           z-index has to differ. */
        await reset();
        const pairs = [['account-modal', 'pass-info-modal'],
                       ['pelvic-screen-modal', 'pelvic-result-modal'],
                       ['photo-log-modal', 'photo-viewer-overlay'],
                       ['session-summary-modal', 'milestone-modal']];
        const r = await app.page.evaluate((pairs) => pairs.map(([lo, hi]) => {
            const z = (id) => {
                const el = document.getElementById(id);
                el.classList.remove('hidden'); el.classList.add('show');
                const v = parseInt(getComputedStyle(el).zIndex, 10);
                el.classList.add('hidden'); el.classList.remove('show');
                return v;
            };
            return { lo, hi, loZ: z(lo), hiZ: z(hi) };
        }), pairs);
        for (const x of r)
            expect(x.hiZ, `${x.hi} (${x.hiZ}) must out-rank ${x.lo} (${x.loZ}) by tier`)
                .toBeGreaterThan(x.loZ);
    }, 40_000);

    test('ACCEPTANCE: the attention band stays empty when nothing is wrong', async () => {
        /* Not strictly stacking, but the same failure mode: the CDN injected
           its stylesheet AFTER the inline <style>, so Tailwind's
           .hidden{display:none} beat .deload-banner{display:flex}. Linking
           the vendored file above that block silently flips the cascade and
           the deload banner renders on every HQ. Nothing else in the suite
           notices, because the banner is real UI that is simply never
           supposed to be up on an ordinary day. */
        await reset();
        const r = await app.page.evaluate(() => {
            _persistedLoaded = true; _storageFull = false;
            persisted.primaryGoal = 'all'; persisted.pelvicProfile = 'standard';
            persisted.schedule = ['length','length','length','length','length','length','length'];
            persisted.completedDays = [false,false,false,false,false,false,false];
            persisted.sessionLog = []; persisted.progressionLedger = [];
            renderDashboard();
            const band = document.getElementById('hq-attention-band');
            return { bandHeight: Math.round(band.getBoundingClientRect().height),
                     visible: [...band.children]
                        .filter(c => getComputedStyle(c).display !== 'none')
                        .map(c => c.id) };
        });
        expect(r.visible).toEqual([]);
        expect(r.bandHeight).toBe(0);
    }, 40_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});
