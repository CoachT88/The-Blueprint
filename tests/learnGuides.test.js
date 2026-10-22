import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE LEARNING CENTRE GUIDES.
 *
 * Each hub lists the questions it covers. Until now every one of those was
 * plain text with "guides are being prepared" above it, so the hub could not
 * be wrong. The moment a question becomes a link, three things can go wrong
 * silently and none of them throws in a browser:
 *
 *   1. the hub links a guide that does not exist, or the hub still claims
 *      every guide is pending while one is published;
 *   2. the page loses the two statements that have to travel with this
 *      subject matter: that the app does not diagnose or treat, and that
 *      persistent difficulty belongs with a clinician;
 *   3. the page states the price, and now the price lives in two files.
 *
 * So this file checks the guide against the hub that links it and against
 * the claims it is allowed to make, not merely that the file is on disk.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const HUB = 'stronger-erections/index.html';
const SLUG = '/stronger-erections/why-hard-alone-but-lose-it-during-sex/';
const GUIDE = 'stronger-erections/why-hard-alone-but-lose-it-during-sex/index.html';

/** The page's own CSS, with the shared header block taken back out. */
function pageCss(src) {
    const blocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
    return blocks.join('\n')
        .replace(/\/\* SITE-NAV:START \*\/[\s\S]*?\/\* SITE-NAV:END \*\//, '');
}

/** Text content, tags and the inline header script removed. */
function prose(src) {
    return src
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
}

describe('the hub and the guide agree with each other', () => {
    test('THE HUB LINKS THE GUIDE, AND THE GUIDE EXISTS', () => {
        const hub = read(HUB);
        const links = [...hub.matchAll(/<li><a href="([^"]+)">/g)].map(m => m[1]);
        expect(links, 'the first question is not a link').toContain(SLUG);
        expect(existsSync(path.join(ROOT, GUIDE)), `${GUIDE} missing`).toBe(true);
    });

    test('the published question is the first one on the list', () => {
        /* The hub is ordered. Publishing the first question and linking the
           third would read as the list being shuffled. */
        const list = read(HUB).match(/<ul class="guide-list">([\s\S]*?)<\/ul>/)[1];
        const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
        expect(items.length).toBe(5);
        expect(items[0]).toContain(`href="${SLUG}"`);
        expect(items[0]).toContain('Why can I get hard alone but lose it during sex?');
    });

    test('and the hub no longer says every guide is still being prepared', () => {
        const hub = read(HUB);
        expect(hub, 'the blanket pending claim is now false')
            .not.toContain('Detailed educational guides are being prepared for these topics.');
        expect(hub).toContain('Guides for the remaining topics are being prepared.');
    });

    test('each unpublished question stays plain text, not a dead link', () => {
        const list = read(HUB).match(/<ul class="guide-list">([\s\S]*?)<\/ul>/)[1];
        const hrefs = [...list.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
        expect(hrefs).toEqual([SLUG]);
    });

    test('the guide links back to the hub and to Learn', () => {
        const src = read(GUIDE);
        const crumb = src.match(/<p class="crumb">([\s\S]*?)<\/p>/);
        expect(crumb, 'no breadcrumb').not.toBeNull();
        expect(crumb[1]).toContain('href="/learn/"');
        expect(crumb[1]).toContain('href="/stronger-erections/"');
    });
});

describe('what the guide is allowed to claim', () => {
    const src = read(GUIDE);
    const text = prose(src);

    test('IT CARRIES THE MEDICAL NOTE AND THE NOT-A-TREATMENT STATEMENT', () => {
        /* Both, on this page, next to the claim. Not in the footer of
           another page. */
        expect(text).toContain('It does not diagnose or treat erectile dysfunction.');
        expect(text).toMatch(
            /Persistent erection difficulties should be evaluated by a qualified healthcare professional/);
        expect(src, 'the medical note is not visually set apart')
            .toMatch(/class="note[^"]*"/);
    });

    test('it tells the reader when to see a doctor, as its own section', () => {
        const h2 = [...src.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]);
        expect(h2).toContain('6. When should you see a doctor?');
    });

    test('the seven sections are all present and in order', () => {
        const h2 = [...src.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]);
        expect(h2.slice(0, 7)).toEqual([
            '1. Why your erections may be different with a partner',
            '2. How one bad experience can affect the next',
            '3. What your erections during masturbation can tell you',
            '4. What to try during your next sexual encounter',
            '5. Pay attention to your health outside the bedroom',
            '6. When should you see a doctor?',
            '7. Your next step',
        ]);
    });

    test('it does not promise an outcome', () => {
        /* The copy is careful: "can", "may", "can help". A guarantee would
           be both a false claim and an FTC problem. */
        expect(text).toContain('They don’t guarantee an erection.');
        for (const banned of [/\bwill cure\b/i, /\bguaranteed\b/i, /\bfix your ED\b/i,
                              /\bcures? erectile dysfunction\b/i]) {
            expect(banned.test(text), `${banned} appears`).toBe(false);
        }
    });

    test('and it uses no em dashes', () => {
        for (const ch of ['—', '–', '⸺', '⸻']) {
            expect(src.includes(ch), `${JSON.stringify(ch)} appears`).toBe(false);
        }
    });
});

describe('the price and the actions', () => {
    const src = read(GUIDE);

    test('THE PRICE IS $49 ONE-TIME, AND STILL STATED ONCE AS THE PRICE', () => {
        const text = prose(src);
        expect(text).toContain('$49 one-time access.');
        const occurrences = (text.match(/\$49/g) || []).length;
        expect(occurrences, 'the price is repeated on this page').toBe(1);
        /* class="fig" is the home page's price figure, and
           tests/landingCss.test.js asserts there is exactly one of them.
           A second page using that class would not break that test, which
           is precisely why it is worth naming here. */
        expect(src).not.toContain('class="fig"');
        expect(src, 'no subscription language').not.toMatch(/\/mo\b|per month|monthly/i);
    });

    test('both calls to action go to pages that exist', () => {
        const actions = src.match(/<div class="actions">([\s\S]*?)<\/div>/)[1];
        const hrefs = [...actions.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
        expect(hrefs).toEqual(['/whats-inside/', '/how-it-works/']);
        for (const h of hrefs) {
            const f = path.join(ROOT, h.replace(/^\//, ''), 'index.html');
            expect(existsSync(f), `${h} does not resolve`).toBe(true);
        }
    });

    test('the "includes" list describes the app as it is', () => {
        /* Five features, taken from the brief, and nothing added. Inventing
           a sixth here is how a marketing page starts promising a feature
           that was never built. */
        const offer = src.match(/<div class="offer">([\s\S]*?)<\/div>\s*<p class="price">/)[1];
        const items = [...offer.matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1]);
        expect(items).toEqual([
            'Guided sessions focused on sexual stamina and pelvic floor awareness.',
            'Erection quality and progress tracking.',
            'Breathing and recovery exercises.',
            'Goal-based scheduling.',
            'In-app guidance from Coach Tee.',
        ]);
    });
});

describe('the guide obeys the same page rules as every other page', () => {
    const src = read(GUIDE);

    test('one inline stylesheet, no external one, no font CDN', () => {
        /* Paired blocks, not opening tags: the shared header's own comment
           contains the literal text "<style>" to explain why it is inlined,
           and counting that as a second stylesheet is a test defect. */
        expect([...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].length).toBe(1);
        expect(/<link[^>]+rel=["']?stylesheet/i.test(src)).toBe(false);
        expect(/fonts\.googleapis|fonts\.gstatic|cdnjs|unpkg/i.test(src)).toBe(false);
    });

    test('its canonical is its own path on theblueprint.site', () => {
        const m = src.match(/<link rel="canonical" href="([^"]+)"/);
        expect(m).not.toBeNull();
        expect(m[1]).toBe(`https://theblueprint.site${SLUG}`);
    });

    test('it has a title, one h1, and a description for the result page', () => {
        expect(src).toMatch(/<title>Why Can I Get Hard Alone but Lose It During Sex\? \| The Blueprint<\/title>/);
        expect([...src.matchAll(/<h1[\s>]/g)].length).toBe(1);
        const d = src.match(/<meta name="description" content="([^"]+)"/);
        expect(d).not.toBeNull();
        expect(d[1].length).toBeGreaterThan(60);
        expect(d[1].length).toBeLessThan(170);
    });

    test('every var(--x) it reads is a property it defines, and all are used', () => {
        /* The failure tests/landingCss.test.js was written for: a dropped
           declaration renders as whatever it inherited, silently. */
        const css = pageCss(src);
        const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1].toLowerCase()));
        const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map(m => m[1].toLowerCase());
        expect(used.length).toBeGreaterThan(15);
        expect([...new Set(used.filter(v => !declared.has(v)))]).toEqual([]);
        expect([...declared].filter(v => !used.includes(v))).toEqual([]);
    });
});
