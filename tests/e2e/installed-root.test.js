import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { startServer, VIEWPORT, launchOptions } from './harness.js';

/**
 * An installed member must never be shown the sales page.
 *
 * The manifest is already correct for new installs: start_url and scope are
 * both /app/, so a current install opens the product and never reaches the
 * root document. The installs made BEFORE that structure still point their
 * Home Screen icon at "/", so every launch dropped a paying member onto the
 * acquisition page. The root page now recovers those installs itself.
 *
 * HOW THESE TESTS EMULATE AN INSTALL. Playwright cannot set display-mode, so
 * the two platform signals the production code actually reads are injected
 * before navigation: matchMedia('(display-mode: standalone)') and the iOS-only
 * navigator.standalone. That is emulating the PLATFORM input, not the outcome:
 * the redirect decision is still entirely the page's own.
 *
 * What they cannot prove: that a real iOS Home Screen shortcut reports
 * standalone. That is on the manual device checklist.
 */

const ROOT_MARKER = /sexual performance can be trained/i;

/** Open a fresh browser, optionally pretending to be an installed launch. */
async function openRoot(srv, { media = false, iosFlag = false, path = '/' } = {}) {
    const browser = await chromium.launch(launchOptions());
    const page = await browser.newPage({ viewport: VIEWPORT });
    for (const pattern of ['**://cdn.tailwindcss.com/**', '**://cdnjs.cloudflare.com/**',
                           '**://fonts.googleapis.com/**']) {
        await page.route(pattern, r => r.abort());
    }
    if (media || iosFlag) {
        await page.addInitScript(({ media, iosFlag }) => {
            if (media) {
                const real = window.matchMedia.bind(window);
                window.matchMedia = (q) => (String(q).includes('display-mode: standalone')
                    ? { matches: true, media: q, addListener() {}, removeListener() {},
                        addEventListener() {}, removeEventListener() {} }
                    : real(q));
            }
            if (iosFlag) {
                try { Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true }); }
                catch (e) { window.navigator.standalone = true; }
            }
        }, { media, iosFlag });
    }
    await page.goto(`${srv.origin}${path}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(600);     // let any replace() settle
    return { browser, page };
}

describe('the root page and an installed launch', () => {
    let srv;
    beforeAll(async () => { srv = await startServer(); }, 60_000);
    afterAll(async () => { await srv?.close(); });

    test('an ORDINARY browser visit stays on the sales page', async () => {
        const { browser, page } = await openRoot(srv, {});
        try {
            expect(new URL(page.url()).pathname).toBe('/');
            expect(await page.title()).toMatch(ROOT_MARKER);
        } finally { await browser.close(); }
    }, 90_000);

    test('DISPLAY-MODE STANDALONE AT ROOT REDIRECTS TO /app/', async () => {
        const { browser, page } = await openRoot(srv, { media: true });
        try {
            expect(new URL(page.url()).pathname).toBe('/app/');
            expect(await page.title()).not.toMatch(ROOT_MARKER);
        } finally { await browser.close(); }
    }, 90_000);

    test('NAVIGATOR.STANDALONE AT ROOT REDIRECTS TOO (the iOS case)', async () => {
        /* The signal an older Home Screen shortcut is exactly the thing to
           report, and the one the media query does not cover on iOS. */
        const { browser, page } = await openRoot(srv, { iosFlag: true });
        try {
            expect(new URL(page.url()).pathname).toBe('/app/');
        } finally { await browser.close(); }
    }, 90_000);

    test('REPLACEMENT SEMANTICS: BACK DOES NOT RETURN TO THE SALES PAGE', async () => {
        /* assign() would leave the sales page in history, so an installed
           member tapping Back would be shown the thing they already bought. */
        const { browser, page } = await openRoot(srv, { media: true });
        try {
            expect(new URL(page.url()).pathname).toBe('/app/');
            await page.goBack({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(400);
            /* Either there is nowhere to go back to, or going back lands
               somewhere that is not the sales page. Never the sales page. */
            expect(await page.title()).not.toMatch(ROOT_MARKER);
        } finally { await browser.close(); }
    }, 90_000);

    test('a direct /app/ load is unaffected, and cannot loop', async () => {
        /* The redirect lives only in the root document, so /app/ never runs
           it. This is the structural reason there is no loop. */
        const { browser, page } = await openRoot(srv, { media: true, path: '/app/index.html' });
        try {
            expect(new URL(page.url()).pathname).toBe('/app/index.html');
            expect(await page.title()).not.toMatch(ROOT_MARKER);
        } finally { await browser.close(); }
    }, 90_000);

    test('AN INSTALLED SIGNED-OUT MEMBER GETS THE APP, NOT THE SALES PAGE', async () => {
        /* The decision is deliberately NOT based on login state. Tapping an
           app icon means "open the product", so a signed-out install must
           land on the product's own authentication screen. Asking them to buy
           something they already own is the bug being fixed. */
        const { browser, page } = await openRoot(srv, { media: true });
        try {
            expect(new URL(page.url()).pathname).toBe('/app/');
            /* No session was established, so the app should be showing its
               auth surface rather than the acquisition page. */
            const shown = await page.evaluate(() => {
                const auth = document.getElementById('auth-screen');
                const loading = document.getElementById('loading-screen');
                return { hasAuth: !!auth, hasLoading: !!loading,
                         salesCopy: document.body.innerText.slice(0, 400) };
            });
            expect(shown.hasAuth).toBe(true);
            expect(shown.salesCopy).not.toMatch(ROOT_MARKER);
        } finally { await browser.close(); }
    }, 90_000);

    test('the redirect decision reads both signals and nothing else', async () => {
        /* Structural. If login state, a cookie or a query parameter ever
           enters this decision, an installed member can be sent to the sales
           page by something unrelated to being installed. */
        const { browser, page } = await openRoot(srv, {});
        try {
            const src = await page.evaluate(() => {
                const s = [...document.querySelectorAll('script:not([src])')]
                    .map(n => n.textContent).find(t => t.includes('display-mode: standalone'));
                return s || '';
            });
            expect(src).toContain('display-mode: standalone');
            expect(src).toContain('navigator.standalone');
            expect(src).toContain("location.replace('/app/')");
            expect(src).not.toMatch(/currentUser|getSession|localStorage|document\.cookie/);
        } finally { await browser.close(); }
    }, 90_000);
});
