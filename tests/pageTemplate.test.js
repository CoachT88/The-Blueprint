import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ONE PRIMARY ACTION PER PAGE, AND ONE H1.
 *
 * The site-wide simplification turned on a single rule: a man should never
 * be shown two buttons of equal weight and asked to rank them. Before it,
 * every one of the sixteen guides ended with "Explore The Blueprint" and
 * "See How The Blueprint Works" side by side, the three goal hubs printed
 * three more goal cards under the guide list, the assessment result
 * offered two, and the Daily Blueprint offered two.
 *
 * That is not a style preference. Two equal buttons is a decision the page
 * has refused to make on the reader's behalf, and it is measurable: the
 * second one exists because nobody could agree which was the real one.
 *
 * The rule is scoped to each page's own body. The shared header and footer
 * are navigation, identical on all 31 pages, and are stripped first.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Every public page, found rather than listed, so a new one is covered. */
function publicPages(dir = ROOT, found = []) {
    const SKIP = new Set(['node_modules', '.git', '.github', '.claude', 'app',
        'tests', 'tools', 'docs', 'src', 'supabase', 'functions', 'icons', 'img']);
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const abs = path.join(dir, name);
        if (statSync(abs).isDirectory()) publicPages(abs, found);
        else if (name === 'index.html') found.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
    return found;
}

/** The page's own content: no shared header, no shared footer. */
const body = (src) => src
    .replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/, ' ');

/** A full-weight call to action, in any of the three vocabularies on this
    site: .cta on the supporting pages, .btn on the home page, .daily-cta on
    the Daily Blueprint. Anchors only. The assessment's Back, Next, Skip and
    Start again are .btn too, and they are form controls inside a quiz, not
    somewhere the page is asking the reader to go. */
const PRIMARY = /<a class="(?:cta|btn|daily-cta)"/g;

const PAGES = publicPages();

describe('every public page follows the same template rules', () => {
    test('the walk found the whole site', () => {
        expect(PAGES).toContain('index.html');
        expect(PAGES).toContain('learn/index.html');
        expect(PAGES).toContain('whats-inside/index.html');
        expect(PAGES.length).toBeGreaterThanOrEqual(30);
    });

    test('NEVER TWO PRIMARY BUTTONS SIDE BY SIDE', () => {
        /* A page may carry a primary action at more than one decision
           stage: the Daily Blueprint opens with "read today's note" and
           closes with "explore the guides", which are different moments.
           What it may not do is put two full-weight buttons next to each
           other and make the reader rank them, which is what every guide,
           the three goal hubs, the assessment result and the Daily
           Blueprint all did before this.

           Measured as adjacency, because that is the defect. A secondary
           button beside a primary is fine; it is visibly the lesser one. */
        const offenders = [];
        for (const p of PAGES) {
            /* <noscript> holds a fallback that only renders when the real
               action cannot, so it is never beside anything. */
            const src = body(read(p)).replace(/<noscript>[\s\S]*?<\/noscript>/g, ' ');
            const at = [...src.matchAll(PRIMARY)].map(m => m.index);
            for (let i = 1; i < at.length; i++) {
                const gap = src.slice(at[i - 1], at[i]);
                /* Anything between them that is not markup and whitespace
                   means they are not side by side. */
                if (!/<\/(section|main|ul|ol|table|figure)>|<h[1-4][\s>]/i.test(gap)
                    && gap.length < 400) {
                    offenders.push(`${p}: two primary buttons ${gap.length} chars apart`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('and no page offers more than two primary actions in total', () => {
        /* The ceiling. Two is a page with two honest stages; three is a
           page that has not decided what it wants. */
        for (const p of PAGES) {
            const src = body(read(p)).replace(/<noscript>[\s\S]*?<\/noscript>/g, ' ');
            const n = (src.match(PRIMARY) || []).length;
            expect(n, `${p} has ${n} primary buttons`).toBeLessThanOrEqual(2);
        }
    });


    test('THE SITEMAP IS EXACTLY THE PUBLIC SITE', () => {
        /* Both directions. A page missing from the sitemap is a page search
           engines have to find by luck; a URL in the sitemap with no page
           behind it is a 404 handed to a crawler on purpose.

           /welcome/ is the only exclusion, and it is deliberate: it is the
           page a man lands on straight after paying, and it means nothing
           to anybody who has not. /app/ is excluded in robots.txt. */
        const locs = new Set([...read('sitemap.xml')
            .matchAll(/<loc>https:\/\/theblueprint\.site([^<]*)<\/loc>/g)].map(m => m[1]));
        const routes = new Set(PAGES.map(p => p === 'index.html' ? '/' : '/' + path.dirname(p) + '/'));
        routes.delete('/welcome/');
        expect([...locs].filter(l => !routes.has(l)), 'in the sitemap, no page behind it')
            .toEqual([]);
        expect([...routes].filter(r => !locs.has(r)), 'a public page the sitemap omits')
            .toEqual([]);
        expect(read('robots.txt')).toContain('Disallow: /app/');
    });

    test('exactly one h1 per page', () => {
        for (const p of PAGES) {
            const n = (read(p).match(/<h1[\s>]/gi) || []).length;
            expect(n, `${p} has ${n} h1 elements`).toBe(1);
        }
    });

    test('no page links a route that does not exist', () => {
        const broken = [];
        for (const p of PAGES) {
            const src = read(p);
            for (const m of src.matchAll(/href="(\/[^"#?]*)"/g)) {
                const href = m[1];
                if (href === '/') continue;
                if (href.endsWith('.jpg') || href.endsWith('.png')
                    || href.endsWith('.json') || href.endsWith('.xml')) continue;
                const target = path.join(ROOT, href, 'index.html');
                try { statSync(target); } catch { broken.push(`${p} -> ${href}`); }
            }
        }
        expect([...new Set(broken)]).toEqual([]);
    });

    test('and every in-page anchor it uses is an id the page has', () => {
        const broken = [];
        for (const p of PAGES) {
            const src = read(p);
            const ids = new Set([...src.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
            for (const m of src.matchAll(/href="#([^"]+)"/g)) {
                if (!ids.has(m[1])) broken.push(`${p} -> #${m[1]}`);
            }
        }
        expect(broken).toEqual([]);
    });

    test('the two cross-page anchors into the home page still resolve', () => {
        /* /#get is the purchase CTA in the shared header, on all 31 pages.
           /#look is The App page's link to the full screenshot gallery. */
        const home = read('index.html');
        for (const id of ['get', 'look']) {
            expect(home, `the home page lost #${id}`).toMatch(new RegExp(`id="${id}"`));
        }
    });
});
