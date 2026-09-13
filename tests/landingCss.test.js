import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/**
 * The sales page is one file with one inline <style> and no script, so nothing
 * here throws and nothing shows up in a console. A custom property that does
 * not exist fails silently: the declaration is dropped and the element renders
 * with whatever it inherited.
 *
 * That is not hypothetical. Recolouring the page from the old manila-and-red
 * dossier to the app's blue rewrote :root and deleted --go, --mono, --paper,
 * --paper-ink and --stamp, but eight declarations further down the sheet still
 * referenced them. The manila card lost its background and rendered as
 * transparent-on-near-black; the feature-list keys lost their colour. The page
 * still loaded, still passed every other test, and looked broken.
 */
function styleBlocks(src) {
    return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
}

describe('landing page custom properties', () => {
    const css = styleBlocks(html).join('\n');

    test('the page has exactly one inline stylesheet and no external one', () => {
        // Not style: a man reading a page about erectile function should not
        // have the visit announced to a font CDN.
        expect(styleBlocks(html).length).toBe(1);
        expect(/<link[^>]+rel=["']?stylesheet/i.test(html)).toBe(false);
    });

    test('every var(--x) it reads is a property it defines', () => {
        const declared = new Set(
            [...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1].toLowerCase())
        );
        expect(declared.size).toBeGreaterThan(10);

        /* A var() with a fallback still renders, so only bare ones matter:
           var(--x) and var( --x ), but not var(--x, #fff). */
        const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)]
            .map(m => m[1].toLowerCase());
        expect(used.length).toBeGreaterThan(20);

        const dangling = [...new Set(used.filter(v => !declared.has(v)))];
        expect(dangling).toEqual([]);
    });

    test('every property it defines is a property it uses', () => {
        /* The other direction of the same mistake: a rename that leaves the
           old token behind, so the next person cannot tell which is live. */
        const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
        expect(rootBlock).not.toBeNull();
        const declared = [...rootBlock[1].matchAll(/(--[a-z0-9-]+)\s*:/gi)]
            .map(m => m[1].toLowerCase());
        const unused = declared.filter(v => {
            const re = new RegExp('var\\(\\s*' + v + '\\s*[,)]', 'i');
            return !re.test(css);
        });
        expect(unused).toEqual([]);
    });
});

describe('landing page claims', () => {
    test('a testimonial that states a result is qualified on the same screen', () => {
        /* Three of the four quotes state a number. The FTC's position is that
           a stated result reads as the expected result unless the page says
           otherwise near the claim — not in the footer, not on another page.
           If the section exists and is visible, the qualifier goes with it. */
        const section = html.match(/<section id="proof"([^>]*)>([\s\S]*?)<\/section>/);
        expect(section).not.toBeNull();

        const hidden = /\bhidden\b/.test(section[1]);
        /* Comments stripped first. The section shipped with a commented-out
           template block showing the shape of a quote, and counting that as a
           published testimonial is how you end up demanding a disclaimer for
           an empty section. */
        const body = section[2].replace(/<!--[\s\S]*?-->/g, '');
        const quotes = [...body.matchAll(/<figure class="quote">/g)].length;
        // Prose in this file wraps at ~80 columns, so a phrase to match on
        // may well have a newline and six spaces sitting in the middle of it.
        const prose = body.replace(/\s+/g, ' ');

        if (hidden) {
            // Nothing published, nothing to qualify.
            expect(quotes).toBe(0);
            return;
        }
        expect(quotes).toBeGreaterThan(0);
        expect(/individual results/i.test(prose)).toBe(true);
        expect(/not a promise/i.test(prose)).toBe(true);
    });

    test('the price is stated once and is the price', () => {
        const figs = [...html.matchAll(/class="fig"[^>]*>([^<]*)</g)].map(m => m[1].trim());
        expect(figs).toEqual(['$30']);
    });
});
