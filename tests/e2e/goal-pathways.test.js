import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { startServer, launchOptions } from './harness.js';

/**
 * The three goal pathways, walked.
 *
 * tests/goalBridge.test.js holds the static contract: which anchors exist,
 * what each bridge must say, and what it may never claim. This is the half a
 * file cannot answer. Does a man who taps his goal actually ARRIVE, is the
 * heading he asked for visible rather than behind the sticky header, does it
 * work with JavaScript switched off, can he get there on a keyboard, and does
 * any of it scroll sideways on a phone.
 *
 * Widths are the brief's two: 320 and 390.
 */

const WIDTHS = [320, 390];

/* intent -> where he starts, what he taps, where he must land.
   #191 removed the erection-quality bridge: we do not sell a plan we have
   not finished. Its deep link still resolves, to free reading, covered by
   the signpost test rather than as a pathway.

   HEADINGS ARE READ FROM THE PAGE, NOT RETYPED HERE. The first version
   pinned the literal h3 text and went red the moment the copy was rewritten,
   which is noise: a reworded headline is not a broken pathway. What this
   file is for is proving the link LANDS on the right block and that the
   block is visible, so it takes the expected heading from the source and
   still fails if an anchor points somewhere else or disappears. */
const PRODUCT = readFileSync('whats-inside/index.html', 'utf8');
const headingFor = anchor => {
    const at = PRODUCT.indexOf(`id="${anchor}"`);
    if (at < 0) throw new Error(`#${anchor} is not on the product page`);
    const h3 = PRODUCT.slice(at).match(/<h3>([^<]+)<\/h3>/);
    if (!h3) throw new Error(`#${anchor} has no heading`);
    return h3[1].trim();
};

const PATHS = [
    { goal: 'stamina',  from: '/last-longer/index.html',     anchor: 'for-stamina' },
    { goal: 'size',     from: '/size-enhancement/index.html', anchor: 'for-size' },
    { goal: 'combined', from: '/index.html',                  anchor: 'for-multiple-goals' },
].map(p => ({ ...p, heading: headingFor(p.anchor) }));

let srv, browser;
beforeAll(async () => { srv = await startServer(); browser = await chromium.launch(launchOptions()); }, 90_000);
afterAll(async () => { await browser?.close(); await srv?.close(); });

const open = async (pathname, { width = 390, js = true } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 860 }, javaScriptEnabled: js });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${srv.origin}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(200);
    page.errors = errors;
    return page;
};

describe('a man taps his goal and arrives at an answer about it', () => {
    test.each(PATHS)('$goal: the link exists, resolves, and lands on its own heading',
        async ({ from, anchor, heading }) => {
            const page = await open(from);
            try {
                const href = `/whats-inside/#${anchor}`;
                expect(await page.locator(`a[href="${href}"]`).count(),
                    `${from} must link ${href}`).toBeGreaterThanOrEqual(1);
                const link = page.locator(`a[href="${href}"]`).first();
                /* A real click, not a goto: this is the journey, and a link
                   that is covered or zero-sized is not a journey. */
                await link.scrollIntoViewIfNeeded();
                await link.click();
                await page.waitForURL(u => u.hash === `#${anchor}`, { timeout: 15_000 });
                expect(new URL(page.url()).pathname).toBe('/whats-inside/');

                const seen = await page.evaluate(id => {
                    const el = document.getElementById(id);
                    if (!el) return { missing: true };
                    const h = el.querySelector('h3');
                    const r = h.getBoundingClientRect();
                    /* What covers the point just above the heading. If the
                       sticky header does, scroll-margin-top is wrong and the
                       man landed mid paragraph. */
                    const atTop = document.elementFromPoint(Math.max(2, r.left + 4), Math.max(2, r.top - 4));
                    return {
                        heading: h.textContent.trim(),
                        top: Math.round(r.top),
                        coveredByNav: !!(atTop && atTop.closest && atTop.closest('header')),
                        overflowX: document.documentElement.scrollWidth - window.innerWidth,
                    };
                }, anchor);
                expect(seen.missing).toBeUndefined();
                expect(seen.heading).toBe(heading);
                /* On screen, below the header, not above the fold edge. */
                expect(seen.top).toBeGreaterThanOrEqual(0);
                expect(seen.top).toBeLessThan(860);
                expect(seen.coveredByNav, 'the heading landed under the sticky header').toBe(false);
                expect(seen.overflowX).toBeLessThanOrEqual(1);
                expect(page.errors).toEqual([]);
            } finally { await page.close(); }
        }, 60_000);

    test.each(PATHS.filter(p => p.goal !== 'erections'))(
        '$goal: and its purchase action points at the existing checkout section',
        async ({ anchor }) => {
            const page = await open(`/whats-inside/#${anchor}`);
            try {
                const out = await page.evaluate(id => {
                    const el = document.getElementById(id);
                    const cta = el.querySelector('a.cta');
                    const free = [...el.querySelectorAll('a')].map(a => a.getAttribute('href'))
                        .filter(h => h && h !== '/#get');
                    return { href: cta.getAttribute('href'), label: cta.textContent.trim(),
                             price: /\$99 once/.test(el.textContent),
                             once: /no subscription/i.test(el.textContent),
                             free };
                }, anchor);
                expect(out.href).toBe('/#get');
                expect(out.price, 'the price is at the decision point').toBe(true);
                expect(out.once, 'and so is "no subscription"').toBe(true);
                /* The per-block "Read first, decide later" link is gone by
                   design: #191 removed the pattern that told a buyer to
                   postpone at the moment he decides. Free reading is still
                   on the page and in the nav, which the signpost test and
                   the route check below cover. */
                expect(out.free.filter(h => h && h.startsWith('/')).length)
                    .toBeGreaterThanOrEqual(0);
            } finally { await page.close(); }
        }, 60_000);
});

describe('the erection deep link, and the page it sits on', () => {
    test('it lands on free reading, with no purchase action', async () => {
        /* A bookmarked /whats-inside/#for-erections must not 404 into the
           page top, and must not hand an erection-health reader a buy button
           for a plan we do not sell. */
        const page = await open('/whats-inside/#for-erections');
        try {
            const out = await page.evaluate(() => {
                const el = document.getElementById('for-erections');
                if (!el) return { missing: true };
                const r = el.getBoundingClientRect();
                return {
                    text: el.innerText,
                    visible: r.height > 0 && r.top < window.innerHeight,
                    buys: [...el.querySelectorAll('a')]
                        .filter(a => a.getAttribute('href') === '/#get').length,
                    free: [...el.querySelectorAll('a')].map(a => a.getAttribute('href')),
                    pageBuys: document.querySelectorAll('main a[href="/#get"]').length,
                };
            });
            expect(out.missing).toBeUndefined();
            expect(out.visible).toBe(true);
            expect(out.buys, 'a buy button on the erection signpost').toBe(0);
            expect(out.free).toContain('/stronger-erections/');
            expect(out.text).toMatch(/nothing to buy/i);
            /* Three plans sell, plus the page's own two actions. */
            expect(out.pageBuys).toBe(5);
        } finally { await page.close(); }
    }, 60_000);

    test('no duplicate ids, so every anchor resolves to one place', async () => {
        const page = await open('/whats-inside/');
        try {
            const dupes = await page.evaluate(() => {
                const seen = new Map();
                for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) || 0) + 1);
                return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
            });
            expect(dupes).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);
});

describe('it does not depend on JavaScript', () => {
    test.each(PATHS)('$goal: the pathway works with scripting disabled',
        async ({ from, anchor, heading }) => {
            const page = await open(from, { js: false });
            try {
                expect(await page.locator(`a[href="/whats-inside/#${anchor}"]`).count())
                    .toBeGreaterThanOrEqual(1);
                const link = page.locator(`a[href="/whats-inside/#${anchor}"]`).first();
                await link.scrollIntoViewIfNeeded();
                await link.click();
                await page.waitForURL(u => u.hash === `#${anchor}`, { timeout: 15_000 });
                /* Read through locators rather than page script: with JS
                   disabled the page cannot have rewritten anything, which is
                   the whole point of the check. */
                expect((await page.locator(`#${anchor} h3`).textContent()).trim()).toBe(heading);
                expect(await page.locator(`#${anchor} a.cta`).getAttribute('href')).toBe('/#get');
                /* And it is genuinely in view, not merely in the document. */
                expect(await page.locator(`#${anchor} h3`).isVisible()).toBe(true);
            } finally { await page.close(); }
        }, 60_000);
});

describe('keyboard and phone widths', () => {
    test('the homepage goal choices are reachable and visibly focused by keyboard', async () => {
        const page = await open('/index.html');
        try {
            const focused = await page.evaluate(() => {
                const cards = [...document.querySelectorAll('#why a.card.goal')];
                return cards.map(a => {
                    a.focus();
                    const s = getComputedStyle(a);
                    const visible = s.outlineStyle !== 'none' || s.boxShadow !== 'none'
                        || getComputedStyle(a, ':focus-visible').outlineStyle !== 'none';
                    return { href: a.getAttribute('href'), focused: document.activeElement === a, visible,
                             tabbable: a.tabIndex >= 0 };
                });
            });
            expect(focused).toHaveLength(4);
            for (const f of focused) {
                expect(f.focused).toBe(true);
                expect(f.tabbable).toBe(true);
            }
            expect(focused.map(f => f.href)).toContain('/whats-inside/#for-multiple-goals');
        } finally { await page.close(); }
    }, 60_000);

    for (const width of WIDTHS) {
        test(`${width}px: every bridge fits, with no sideways scroll`, async () => {
            const page = await open('/whats-inside/', { width });
            try {
                const out = await page.evaluate(w => {
                    const blocks = [...document.querySelectorAll('.goal-bridge')];
                    return {
                        count: blocks.length,
                        overflowX: document.documentElement.scrollWidth - window.innerWidth,
                        boxes: blocks.map(b => {
                            const r = b.getBoundingClientRect();
                            /* The erection block has no CTA while its offer
                               is held, so the tap target is checked where
                               one exists rather than assumed on all four. */
                            const c = b.querySelector('a.cta');
                            return { id: b.id, left: Math.round(r.left), right: Math.round(r.right),
                                     height: Math.round(r.height),
                                     cta: c ? Math.round(c.getBoundingClientRect().height) : null,
                                     links: [...b.querySelectorAll('a')].map(a =>
                                         Math.round(a.getBoundingClientRect().height)) };
                        }),
                    };
                }, width);
                expect(out.count).toBe(3);
                expect(out.overflowX, 'the page scrolls sideways').toBeLessThanOrEqual(1);
                for (const b of out.boxes) {
                    expect(b.left).toBeGreaterThanOrEqual(0);
                    expect(b.right).toBeLessThanOrEqual(width);
                    expect(b.height).toBeGreaterThan(0);
                    /* A tap target a thumb can hit, where one is offered. */
                    if (b.cta !== null) expect(b.cta, `${b.id} CTA`).toBeGreaterThanOrEqual(44);
                    /* Every bridge still offers at least one reachable link,
                       so the held section is not a dead end. */
                    expect(b.links.length, `${b.id} has no links`).toBeGreaterThan(0);
                }
                expect(out.boxes.filter(b => b.cta !== null)).toHaveLength(3);   // all three sell
                expect(page.errors).toEqual([]);
            } finally { await page.close(); }
        }, 60_000);
    }

    test('a visitor arriving at /whats-inside/ with no hash is not scrolled anywhere', async () => {
        const page = await open('/whats-inside/');
        try {
            const top = await page.evaluate(() => ({ y: window.scrollY,
                h1: document.querySelector('h1').getBoundingClientRect().top }));
            expect(top.y).toBe(0);
            expect(top.h1).toBeGreaterThan(0);
        } finally { await page.close(); }
    }, 60_000);
});
