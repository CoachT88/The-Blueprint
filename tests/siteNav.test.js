import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ONE HEADER, EVERY PAGE, ONE SOURCE.
 *
 * The site had two navigations on the home page (a bar added on top of the
 * original brand header) and a third, different one on every supporting
 * page: no Learn, no purchase button, and flex-wrap:wrap inside a fixed
 * 60px bar, which clips its own first line on a narrow phone.
 *
 * Every page here is self-contained by design: one inline <style>, no
 * external stylesheet, no font CDN. tests/landingCss.test.js enforces that
 * and explains why. So a shared header cannot be a <link>. It is one source,
 * tools/site-nav.{css,html}, written into each page by
 * tools/sync-site-nav.mjs, and THIS FILE is what makes that real: without a
 * drift test, N copies are just N navigations again.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const PAGES = [
    'index.html', 'learn/index.html', 'daily/index.html', 'last-longer/index.html',
    'stronger-erections/index.html',
    'better-sexual-performance/index.html',
    'how-it-works/index.html', 'whats-inside/index.html', 'faq/index.html',
    'support/index.html', 'safety/index.html',
    'assessment/index.html',
    'research-lab/index.html',
    'research-lab/manual-techniques/index.html',
    'performance-anxiety-erections/index.html',
    'blood-sugar-erections/index.html',
    'hydration-erections/index.html',
    'pelvic-floor-premature-ejaculation/index.html',
    'hip-mobility-sexual-performance/index.html',
    'improve-sexual-stamina/index.html',
    'cardio-erections/index.html',
    'weaker-morning-erections/index.html',
    'anxiety-or-physical-ed/index.html',
    'finish-quickly-penetration/index.html',
    'ejaculation-warning-signs/index.html',
    'arousal-awareness-practice/index.html',
    'last-longer-alone-than-sex/index.html',
    'breathing-manage-arousal/index.html',
    'sleep-erections-libido/index.html',
    'stay-composed-during-arousal/index.html',
];

/** Every destination the header offers, and where it must resolve. */
const DESTINATIONS = [
    ['/daily/', 'daily/index.html'],
    ['/last-longer/', 'last-longer/index.html'],
    ['/stronger-erections/', 'stronger-erections/index.html'],
    ['/better-sexual-performance/', 'better-sexual-performance/index.html'],
    ['/how-it-works/', 'how-it-works/index.html'],
    ['/whats-inside/', 'whats-inside/index.html'],
    ['/faq/', 'faq/index.html'],
    ['/support/', 'support/index.html'],
    ['/safety/', 'safety/index.html'],
    ['/app/', 'app/index.html'],
];

const navCss = read('tools/site-nav.css').trim();
const navHtml = read('tools/site-nav.html').trim();

describe('the header is shared, not merely similar', () => {
    test('EVERY PAGE CARRIES THE CANONICAL HEADER, BYTE FOR BYTE', () => {
        /* The drift guard. Edit tools/site-nav.*, run
           `node tools/sync-site-nav.mjs`, and this passes again. */
        for (const p of PAGES) {
            const src = read(p);
            const css = src.match(/\/\* SITE-NAV:START \*\/([\s\S]*?)\/\* SITE-NAV:END \*\//);
            const html = src.match(/<!-- SITE-NAV:START -->([\s\S]*?)<!-- SITE-NAV:END -->/);
            expect(css, `${p} has no header CSS block`).not.toBeNull();
            expect(html, `${p} has no header markup block`).not.toBeNull();
            expect(css[1].trim(), `${p} header CSS has drifted`).toBe(navCss);
            expect(html[1].trim(), `${p} header markup has drifted`).toBe(navHtml);
        }
    });

    test('and there is exactly ONE header on each page', () => {
        for (const p of PAGES) {
            const n = (read(p).match(/<header[\s>]/gi) || []).length;
            expect(n, `${p} has ${n} headers`).toBe(1);
        }
    });

    test('the old per-page navigations are gone', () => {
        for (const p of PAGES) {
            const src = read(p);
            expect(src, `${p} still has the old wrap nav`)
                .not.toMatch(/<nav class="wrap" aria-label="Main navigation">/);
            expect(src, `${p} still has the duplicate site nav`)
                .not.toMatch(/aria-label="Site navigation"/);
        }
    });
});

describe('every destination the header offers actually exists', () => {
    for (const [href, file] of DESTINATIONS) {
        test(`${href} resolves to a real page`, () => {
            expect(existsSync(path.join(ROOT, file)), `${file} missing`).toBe(true);
            expect(readFileSync(path.join(ROOT, file), 'utf8').length,
                `${file} is empty`).toBeGreaterThan(500);
        });
    }

    test('and the header links to all of them', () => {
        for (const [href] of DESTINATIONS) {
            expect(navHtml, `header does not link ${href}`).toContain(`href="${href}"`);
        }
    });

    test('the purchase CTA points at the price section', () => {
        expect(navHtml).toContain('href="/#get"');
        expect(read('index.html'), 'the home page has no #get anchor').toMatch(/id="get"/);
    });
});

describe('what this change must not break', () => {
    test('THE PRICE IS STILL $99, STATED ONCE AS THE PRICE', () => {
        const html = read('index.html');
        const figs = [...html.matchAll(/class="fig"[^>]*>([^<]+)</g)].map(m => m[1].trim());
        expect(figs).toEqual(['$99']);
        expect(html).toMatch(/\$99 once/);
        expect(html).toMatch(/No subscription/);
        expect(html).toMatch(/Future app updates included/);
    });

    test('the brand lockup is the original, on every page', () => {
        /* The gradient B and the italic wordmark are the brand. The
           supporting pages used to render a plain text "B The Blueprint". */
        expect(navHtml).toMatch(/class="sn-mark"[^>]*>B</);
        expect(navCss).toMatch(/linear-gradient\(150deg,var\(--sn-blue\),#1d4ed8\)/);
        expect(navCss).toMatch(/font-style:italic/);
    });

    test('theblueprint.site stays canonical everywhere', () => {
        for (const p of PAGES) {
            const m = read(p).match(/<link rel="canonical" href="([^"]+)"/);
            expect(m, `${p} has no canonical`).not.toBeNull();
            expect(m[1], `${p} canonical`).toMatch(/^https:\/\/theblueprint\.site\//);
        }
    });

    test('no page gains an external stylesheet or a font CDN', () => {
        for (const p of PAGES) {
            const src = read(p);
            expect(/<link[^>]+rel=["']?stylesheet/i.test(src), `${p}`).toBe(false);
            expect(/fonts\.googleapis|fonts\.gstatic|cdnjs|unpkg/i.test(src), `${p}`).toBe(false);
        }
    });

    test('the password-recovery forwarder on the home page is untouched', () => {
        const src = read('index.html');
        expect(src).toMatch(/isRecovery/);
        expect(src).toMatch(/window\.location\.replace\('\/app\/' \+ q \+ h\)/);
        expect(src).toMatch(/display-mode: standalone/);
    });
});

describe('the header markup is accessible before any script runs', () => {
    test('every destination is a real anchor, not a scripted handler', () => {
        /* With JavaScript off the drawer cannot open, so the links must at
           least be present and crawlable. */
        const anchors = [...navHtml.matchAll(/<a [^>]*href="([^"]+)"/g)].map(m => m[1]);
        for (const [href] of DESTINATIONS) {
            expect(anchors, `${href} is not an anchor`).toContain(href);
        }
    });

    test('the toggle and the drawer are wired to each other', () => {
        expect(navHtml).toMatch(/id="sn-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="sn-drawer"/);
        expect(navHtml).toMatch(/id="sn-drawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
        expect(navHtml).toMatch(/aria-label="Open menu"/);
        expect(navHtml).toMatch(/aria-label="Close menu"/);
    });

    test('the Learn menu is a button with state, not a hover-only trap', () => {
        expect(navHtml).toMatch(/id="sn-learn-btn"[^>]*aria-expanded="false"[^>]*aria-controls="sn-learn-menu"/);
        expect(navCss).not.toMatch(/\.sn-learn:hover \.sn-learn-menu/);
    });

    test('the bar never wraps, which is what clipped the old one', () => {
        expect(navCss).toMatch(/\.sn-in\{[^}]*flex-wrap:nowrap/s);
    });

    test('it honours safe areas and reduced motion', () => {
        expect(navCss).toMatch(/env\(safe-area-inset-top\)/);
        expect(navCss).toMatch(/env\(safe-area-inset-bottom\)/);
        expect(navCss).toMatch(/prefers-reduced-motion/);
    });

    test('and it gives keyboard focus something to show', () => {
        expect(navCss).toMatch(/:focus-visible\{[^}]*outline:2px solid/s);
    });
});
