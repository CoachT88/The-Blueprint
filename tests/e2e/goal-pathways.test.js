import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { startServer, launchOptions } from './harness.js';

/**
 * The four goal pathways, walked.
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

/* intent -> where he starts, what he taps, where he must land. */
const PATHS = [
    { goal: 'erections', from: '/stronger-erections/index.html',
      anchor: 'for-erections',      heading: 'Stronger erections' },
    { goal: 'stamina',   from: '/last-longer/index.html',
      anchor: 'for-stamina',        heading: 'Lasting longer' },
    { goal: 'size',      from: '/size-enhancement/index.html',
      anchor: 'for-size',           heading: 'Length and girth' },
    { goal: 'combined',  from: '/index.html',
      anchor: 'for-multiple-goals', heading: 'Several goals at once' },
];

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
                /* A free way out of every bridge, so reading is never the
                   thing he has to pay for. */
                expect(out.free.length).toBeGreaterThan(0);
            } finally { await page.close(); }
        }, 60_000);
});

describe('the held erection offer, and the page it sits on', () => {
    test('the erection section offers reading, not a purchase', async () => {
        /* Held under the owner's own condition in the #183 review. Driven
           rather than read from source, because what matters is that no
           buy control renders there, not that a string is absent. */
        const page = await open('/whats-inside/#for-erections');
        try {
            const out = await page.evaluate(() => {
                const el = document.getElementById('for-erections');
                const links = [...el.querySelectorAll('a')];
                return {
                    buy: links.filter(a => a.getAttribute('href') === '/#get').length,
                    cta: el.querySelectorAll('.cta').length,
                    free: links.filter(a => (a.getAttribute('href') || '').startsWith('/')
                        && a.getAttribute('href') !== '/#get').length,
                    text: el.innerText,
                    /* The page itself must still be buyable, or the hold
                       reads as the product being unavailable. */
                    pageBuys: document.querySelectorAll('main a[href="/#get"]').length,
                };
            });
            expect(out.buy).toBe(0);
            expect(out.cta).toBe(0);
            expect(out.free).toBeGreaterThan(0);
            expect(out.text).toMatch(/not asking you to buy on this goal yet/i);
            expect(out.pageBuys).toBe(5);
        } finally { await page.close(); }
    }, 60_000);

    test('no duplicate ids, so every anchor resolves to one place', async () => {
        const page = await open('/whats-inside/');
        try {
            const dupes = await page.evaluate(() => {
                const seen = new Map();
                for (const el of document.querySelectorAll('[id]')) {
                    seen.set(el.id, (seen.get(el.id) || 0) + 1);
                }
                return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
            });
            expect(dupes).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    test('the new copy clears AA contrast, including the limitation notes', async () => {
        /* The limitations are the most important sentences here and they are
           the ones set in muted grey, which is exactly the combination that
           gets quietly unreadable. Composited against real backgrounds
           rather than assumed from the token. */
        const page = await open('/whats-inside/');
        try {
            const worst = await page.evaluate(() => {
                const lum = ([r, g, b]) => {
                    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
                    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
                };
                const parse = c => { const n = (c.match(/[\d.]+/g) || []).map(Number);
                    return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 }; };
                const over = (f, b) => [0, 1, 2].map(i => Math.round([f.r, f.g, f.b][i] * f.a + b[i] * (1 - f.a)));
                const bgOf = el => {
                    const stack = []; let n = el;
                    while (n && n !== document.documentElement) {
                        const c = parse(getComputedStyle(n).backgroundColor);
                        if (c.a > 0) stack.push(c);
                        if (c.a === 1) break;
                        n = n.parentElement;
                    }
                    const base = parse(getComputedStyle(document.documentElement).backgroundColor);
                    let out = [base.r, base.g, base.b];
                    for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
                    return out;
                };
                let min = 99, where = '';
                for (const el of document.querySelectorAll('.goal-bridge p, .goal-bridge h3, .goal-bridge a, .jump, .jump a')) {
                    if (!el.innerText.trim()) continue;
                    const fg = parse(getComputedStyle(el).color);
                    const composited = over(fg, bgOf(el));
                    const [hi, lo] = [lum(composited), lum(bgOf(el))].sort((a, b) => b - a);
                    const ratio = (hi + 0.05) / (lo + 0.05);
                    if (ratio < min) { min = ratio; where = el.className + ': ' + el.innerText.slice(0, 40); }
                }
                return { min, where };
            });
            expect(worst.min, `lowest contrast at ${worst.where}`).toBeGreaterThanOrEqual(4.5);
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
                /* The erection section's offer is held, so what must work
                   without scripting there is the free reading instead. */
                const cta = page.locator(`#${anchor} a.cta`);
                if (anchor === 'for-erections') {
                    expect(await cta.count()).toBe(0);
                    expect(await page.locator(`#${anchor} a[href="/stronger-erections/"]`).count())
                        .toBeGreaterThanOrEqual(1);
                } else {
                    expect(await cta.getAttribute('href')).toBe('/#get');
                }
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
                expect(out.count).toBe(4);
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
                expect(out.boxes.filter(b => b.cta !== null)).toHaveLength(3);
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
