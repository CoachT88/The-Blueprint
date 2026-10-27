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
    'size-enhancement/index.html',
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
    ['/assessment/', 'assessment/index.html'],
    ['/learn/', 'learn/index.html'],
    ['/size-enhancement/', 'size-enhancement/index.html'],
    ['/research-lab/', 'research-lab/index.html'],
    ['/daily/', 'daily/index.html'],
    ['/last-longer/', 'last-longer/index.html'],
    ['/stronger-erections/', 'stronger-erections/index.html'],
    ['/better-sexual-performance/', 'better-sexual-performance/index.html'],
    ['/whats-inside/', 'whats-inside/index.html'],
    ['/faq/', 'faq/index.html'],
    ['/support/', 'support/index.html'],
    ['/safety/', 'safety/index.html'],
    ['/app/', 'app/index.html'],
];

/* /how-it-works/ is deliberately NOT in that list any more. It and
   /whats-inside/ were two entrances to one subject, sitting side by side in
   the bar, in the drawer, and at the end of all sixteen guides. The App is
   now one entrance. The page keeps its URL, its search equity and its
   content; it is reached from The App page and from every footer, and
   'the second app entrance stays reachable' below is what holds that. */
const DEEPER = ['/how-it-works/', 'how-it-works/index.html'];

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

describe('the visitor-first menu layout', () => {
    const drawer = navHtml.match(/<nav class="sn-drawer-scroll"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    const desktop = navHtml.match(/<nav class="sn-links"[^>]*>([\s\S]*?)<\/nav>/)?.[1];

    /** Labels in document order, with anything behind a disclosure removed. */
    const choices = (markup, collapse, pattern) => {
        const visible = markup.replace(collapse, '');
        return [...visible.matchAll(pattern)].map(m => m[1] ?? m[2]).filter(Boolean);
    };

    /** What the drawer shows before anything is opened. */
    const drawerTopLevel = () => choices(
        drawer,
        /<div class="sn-fold-body">[\s\S]*?<\/div>/g,
        /<a class="sn-lead" href="([^"]+)"|<summary>([A-Za-z ]+?)</g,
    );

    test('FOUR CHOICES ON ARRIVAL, NOT FOURTEEN', () => {
        /* The drawer used to print every destination at once in five
           always-open groups. On a 390px phone that was fourteen links with
           Support below the fold, so the man looking for one of them had to
           read all of them. Collapsed, it is the same four destinations the
           desktop bar offers. */
        expect(drawer).toBeTruthy();
        expect(drawerTopLevel()).toEqual(['/assessment/', 'Learn', '/whats-inside/', 'Help']);
    });

    test('and the lists behind the folds are intact and unduplicated', () => {
        const urls = [...drawer.matchAll(/<a[^>]* href="([^"]+)"/g)].map(m => m[1]);
        expect(new Set(urls).size, 'a destination appears twice').toBe(urls.length);
        for (const [href] of DESTINATIONS) {
            if (href === '/app/') continue;
            expect(urls, 'mobile menu missing ' + href).toContain(href);
        }
        const learn = drawer.match(/<summary>Learn[\s\S]*?<div class="sn-fold-body">([\s\S]*?)<\/div>/)[1];
        for (const goal of ['/last-longer/', '/stronger-erections/',
            '/better-sexual-performance/', '/size-enhancement/']) {
            expect(learn, 'Learn does not offer ' + goal).toContain(goal);
        }
        expect(learn.indexOf('/last-longer/'), 'the goal hubs come after the index')
            .toBeLessThan(learn.indexOf('/learn/'));
        const help = drawer.match(/<summary>Help[\s\S]*?<div class="sn-fold-body">([\s\S]*?)<\/div>/)[1];
        expect([...help.matchAll(/href="([^"]+)"/g)].map(m => m[1]))
            .toEqual(['/faq/', '/safety/', '/support/']);
    });

    test('a fold cannot leave a hidden link in the keyboard trap', () => {
        /* Links inside a closed <details> have no layout box. Sending Tab to
           one strands the keyboard outside a modal drawer with no way back,
           so the trap is recomputed on each Tab from what is visible. */
        expect(navHtml).toMatch(/function focusables\(\)/);
        expect(navHtml).toMatch(/getClientRects\(\)\.length/);
        expect(navHtml).toMatch(/var els=focusables\(\);/);
    });

    test('opening one fold closes the others', () => {
        /* Otherwise the drawer scrolls back to being the long list. */
        expect(navHtml).toMatch(/\.sn-fold\[open\]/);
        expect(navHtml).toMatch(/if\(o!==d\)o\.open=false/);
    });

    test('THE DESKTOP BAR OFFERS THE SAME FOUR DESTINATIONS', () => {
        const top = choices(
            desktop,
            /<div class="[^"]*sn-drop-menu[^"]*"[^>]*>[\s\S]*?<\/div>/g,
            /<a [^>]*href="([^"]+)"|class="[^"]*sn-drop-btn"[^>]*>([A-Za-z ]+?)</g,
        );
        expect(top).toEqual(['/assessment/', 'Learn', '/whats-inside/', 'Help']);
    });

    test('and the Learn menu still reaches every free resource', () => {
        const learn = navHtml.match(/<div class="sn-learn-menu[^"]*" id="sn-learn-menu">([\s\S]*?)<\/div>/)[1];
        for (const href of ['/last-longer/', '/stronger-erections/',
            '/better-sexual-performance/', '/size-enhancement/', '/learn/',
            '/daily/', '/research-lab/']) {
            expect(learn, 'Learn menu missing ' + href).toContain('href="' + href + '"');
        }
        expect(navHtml).toContain('id="sn-help-btn" aria-expanded="false" aria-controls="sn-help-menu"');
    });

    test('ONE FOOTER ORDER, EVERY PAGE', () => {
        /* There were three. A guide ended with Learn / Safety / Support, a
           product page with Home / How It Works / What's Inside / FAQ /
           Safety / Support, and the home page with a fifth order of its
           own. Somebody who learned where Support lived had to find it
           again on the next page. */
        const ORDER = ['/learn/', '/whats-inside/', '/how-it-works/',
            '/faq/', '/safety/', '/support/'];
        for (const p of [...PAGES, 'welcome/index.html']) {
            const footer = read(p).match(/<footer[\s\S]*<\/footer>/);
            expect(footer, `${p} has no footer`).not.toBeNull();
            const hrefs = [...footer[0].matchAll(/<a href="(\/[^"]*)"/g)].map(m => m[1]);
            expect(hrefs, `${p} footer order`).toEqual(ORDER);
        }
    });

    test('THE SECOND APP ENTRANCE STAYS REACHABLE', () => {
        /* Dropping /how-it-works/ from the header must not orphan it. It
           keeps its URL and its search equity, so it has to keep its
           inbound links too. */
        expect(existsSync(path.join(ROOT, DEEPER[1])), 'the page was deleted').toBe(true);
        expect(read('sitemap.xml'), 'dropped from the sitemap').toContain(DEEPER[0]);
        expect(read('whats-inside/index.html'), 'The App does not link the deeper read')
            .toContain('href="' + DEEPER[0] + '"');
        for (const p of PAGES) {
            const footer = read(p).match(/<footer[\s\S]*<\/footer>/);
            expect(footer, `${p} has no footer`).not.toBeNull();
            expect(footer[0], `${p} footer drops ${DEEPER[0]}`)
                .toContain('href="' + DEEPER[0] + '"');
        }
    });
    test('scrolling links and fixed actions stay separate on mobile', () => {
        expect(navHtml).toContain('class="sn-drawer-actions"');
        expect(navHtml).toMatch(/<div class="sn-drawer-actions">\s*<a class="sn-signin" href="\/app\/">Sign in<\/a>\s*<a class="sn-buy" href="\/#get">Get the app<\/a>/);
        expect(navCss).toMatch(/\.sn-drawer-scroll\{[^}]*overflow-y:auto/s);
        expect(navCss).toMatch(/\.sn-drawer-actions\{[^}]*flex:none/s);
        expect(navHtml).toContain('drawer.inert=true');
        expect(navHtml).toContain("drawer.inert=false");
        expect(navHtml).toContain("aria-hidden");
        expect(navCss).toContain('.sn-drawer[hidden]{display:none}');
    });
    test('free resources are findable from the learning hub', () => {
        const learn = read('learn/index.html');
        for (const href of ['/assessment/', '/daily/', '/last-longer/',
           '/stronger-erections/', '/better-sexual-performance/',
           '/size-enhancement/', '/research-lab/']) {
           expect(learn, 'learning hub missing '+href).toContain('href="'+href+'"');
        }
        for (const p of ['last-longer/index.html','stronger-erections/index.html',
           'better-sexual-performance/index.html']) {
           expect(read(p)).toContain('href="/size-enhancement/"');
        }
    });
});
