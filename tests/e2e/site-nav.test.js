import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { startServer, launchOptions } from './harness.js';

/**
 * The shared site header, driven.
 *
 * The static contract lives in tests/siteNav.test.js: one source, ten pages,
 * no drift. This file is the half a file cannot answer. Does one header
 * render, does it fit without wrapping or scrolling sideways at every width
 * the brief names, does the drawer open, close, trap focus and return it,
 * and do the destinations actually load.
 *
 * Widths are the brief's: 320, 375, 390, 430, tablet, desktop.
 */

const WIDTHS = [['320', 320], ['375', 375], ['390', 390], ['430', 430],
                ['tablet', 768], ['desktop', 1280]];
const BREAK = 860;   // where the links replace the drawer

/* sRGB contrast with every translucent layer composited to the canvas. */
const PROBE = `(() => {
  const L=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
    return .2126*f(r)+.7152*f(g)+.0722*f(b)};
  const R=(a,b)=>{const[x,y]=[L(a),L(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05)};
  const px=s=>(s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
  const parse=c=>{const n=(c.match(/[\\d.]+/g)||[]).map(Number);
    return {r:n[0]||0,g:n[1]||0,b:n[2]||0,a:n.length>3?n[3]:1}};
  const over=(f,b)=>[0,1,2].map(i=>Math.round([f.r,f.g,f.b][i]*f.a+[b.r,b.g,b.b][i]*(1-f.a)));
  const bgOf=el=>{const st=[];let n=el;
    while(n&&n!==document.documentElement){const c=parse(getComputedStyle(n).backgroundColor);
      if(c.a>0)st.push(c); if(c.a===1)break; n=n.parentElement;}
    const base=parse(getComputedStyle(document.documentElement).backgroundColor);
    let out=[base.r,base.g,base.b];
    for(let i=st.length-1;i>=0;i--)out=over(st[i],{r:out[0],g:out[1],b:out[2]});
    return out;};
  return {R,px,bgOf};
})()`;

let srv, browser;
beforeAll(async () => { srv = await startServer(); browser = await chromium.launch(launchOptions()); }, 90_000);
afterAll(async () => { await browser?.close(); await srv?.close(); });

const open = async (width, pathname = '/index.html') => {
    const page = await browser.newPage({ viewport: { width, height: 860 } });
    await page.goto(`${srv.origin}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(250);
    return page;
};

describe('one header, at every width', () => {
    for (const [tag, w] of WIDTHS) {
        test(`${tag} (${w}px): one header, no wrap, no sideways scroll`, async () => {
            const page = await open(w);
            const m = await page.evaluate(() => {
                const bar = document.querySelector('.sn-in');
                /* Only children that are actually laid out. A display:none
                   element reports a zero rect, and counting its top as a
                   second row is how the first version of this test failed
                   on markup that was correct. */
                const kids = [...bar.children]
                    .map(c => c.getBoundingClientRect())
                    .filter(r => r.width > 0 && r.height > 0)
                    .map(r => Math.round(r.top));
                return {
                    headers: document.querySelectorAll('header').length,
                    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                    barHeight: Math.round(bar.getBoundingClientRect().height),
                    /* Every direct child on ONE line is what "does not wrap"
                       means. The old bar wrapped inside a fixed 60px and
                       clipped its own first row. */
                    rows: new Set(kids).size,
                    brandVisible: document.querySelector('.sn-brand').getBoundingClientRect().width > 0,
                    buyVisible: document.querySelector('.sn-buy').getBoundingClientRect().width > 0,
                };
            });
            expect(m.headers, 'exactly one header').toBe(1);
            expect(m.overflowX, 'no horizontal scrolling').toBe(false);
            expect(m.rows, 'the bar is a single row').toBe(1);
            expect(m.barHeight).toBeLessThanOrEqual(72);
            expect(m.brandVisible, 'the logo is shown').toBe(true);
            expect(m.buyVisible, 'the purchase CTA is shown').toBe(true);
            await page.close();
        }, 60_000);
    }

    test('MOBILE SHOWS LOGO, GET THE APP AND A MENU ICON, nothing else', async () => {
        const page = await open(390);
        const m = await page.evaluate(() => ({
            links: getComputedStyle(document.querySelector('.sn-links')).display,
            signin: getComputedStyle(document.querySelector('.sn-in .sn-signin')).display,
            toggle: getComputedStyle(document.querySelector('.sn-toggle')).display,
        }));
        expect(m.links, 'the desktop links are not in the compact bar').toBe('none');
        expect(m.signin, 'sign in moves into the menu').toBe('none');
        expect(m.toggle).not.toBe('none');
        await page.close();
    }, 60_000);

    test('DESKTOP SHOWS THE HORIZONTAL NAV AND NO MENU ICON', async () => {
        const page = await open(1280);
        const m = await page.evaluate(() => ({
            links: getComputedStyle(document.querySelector('.sn-links')).display,
            toggle: getComputedStyle(document.querySelector('.sn-toggle')).display,
            /* Top level and dropdown separately: querySelectorAll returns
               document order, so the three Learn items sit between Learn
               and How It Works and the flat list reads as mis-ordered. */
            top: [...document.querySelector('.sn-links').children].map(c =>
                (c.classList.contains('sn-learn')
                    ? c.querySelector('.sn-learn-btn') : c).textContent.trim()),
            learn: [...document.querySelectorAll('#sn-learn-menu a')]
                .map(a => a.textContent.trim()),
        }));
        expect(m.links).toBe('flex');
        expect(m.toggle).toBe('none');
        expect(m.top).toEqual(['Learn', 'How It Works', 'What’s Inside', 'FAQ', 'Support']);
        expect(m.learn).toEqual(['Last Longer', 'Stronger Erections', 'Better Sexual Performance']);
        await page.close();
    }, 60_000);
});

describe('the slide-out menu works', () => {
    test('IT OPENS, CLOSES, AND RETURNS FOCUS', async () => {
        const page = await open(390);
        const o = await page.evaluate(async () => {
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const tog = document.getElementById('sn-toggle');
            tog.focus(); tog.click(); await wait(320);
            const opened = {
                state: document.body.getAttribute('data-sn-open'),
                expanded: tog.getAttribute('aria-expanded'),
                onScreen: document.getElementById('sn-drawer').getBoundingClientRect().right
                          <= window.innerWidth + 1,
                focusInside: document.getElementById('sn-drawer').contains(document.activeElement),
            };
            document.getElementById('sn-close').click(); await wait(320);
            return { opened, closed: document.body.getAttribute('data-sn-open'),
                     expandedAfter: tog.getAttribute('aria-expanded'),
                     focusReturned: document.activeElement === tog };
        });
        expect(o.opened.state).toBe('true');
        expect(o.opened.expanded).toBe('true');
        expect(o.opened.onScreen, 'the drawer is on screen').toBe(true);
        expect(o.opened.focusInside, 'focus moves into the drawer').toBe(true);
        expect(o.closed, 'it closes').toBeNull();
        expect(o.expandedAfter).toBe('false');
        expect(o.focusReturned, 'focus returns to the button that opened it').toBe(true);
        await page.close();
    }, 60_000);

    test('Escape closes it, and so does the scrim', async () => {
        const page = await open(390);
        await page.click('#sn-toggle');
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.body.getAttribute('data-sn-open'))).toBeNull();
        await page.click('#sn-toggle');
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getElementById('sn-scrim').click());
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.body.getAttribute('data-sn-open'))).toBeNull();
        await page.close();
    }, 60_000);

    test('it lists every learning category and supporting page', async () => {
        const page = await open(390);
        const items = await page.evaluate(() =>
            [...document.querySelectorAll('.sn-drawer a')].map(a => a.textContent.trim()));
        for (const label of ['Last Longer', 'Stronger Erections', 'Better Sexual Performance',
                             'How It Works', 'What’s Inside', 'FAQ', 'Support', 'Safety',
                             'Sign in', 'Get the app']) {
            expect(items, `menu is missing ${label}`).toContain(label);
        }
        await page.close();
    }, 60_000);

    test('and every control in it is a 44px target', async () => {
        const page = await open(390);
        await page.click('#sn-toggle');
        await page.waitForTimeout(300);
        const small = await page.evaluate(() =>
            [...document.querySelectorAll('.sn-drawer a,.sn-drawer button,.sn-in a,.sn-in button')]
                .map(el => ({ n: (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 24),
                              h: Math.round(el.getBoundingClientRect().height),
                              w: Math.round(el.getBoundingClientRect().width) }))
                .filter(x => x.h > 0 && (x.h < 44 || x.w < 44)));
        expect(small, `undersized: ${JSON.stringify(small)}`).toEqual([]);
        await page.close();
    }, 60_000);
});

describe('the Learn menu on desktop', () => {
    test('opens on click and closes on Escape', async () => {
        const page = await open(1280);
        await page.click('#sn-learn-btn');
        await page.waitForTimeout(150);
        let s = await page.evaluate(() => ({
            open: document.querySelector('.sn-learn').getAttribute('data-open'),
            expanded: document.getElementById('sn-learn-btn').getAttribute('aria-expanded'),
            visible: getComputedStyle(document.getElementById('sn-learn-menu')).display,
        }));
        expect(s.open).toBe('true');
        expect(s.expanded).toBe('true');
        expect(s.visible).toBe('block');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        s = await page.evaluate(() => document.querySelector('.sn-learn').getAttribute('data-open'));
        expect(s).toBe('false');
        await page.close();
    }, 60_000);
});

describe('the destinations load, and the page says where you are', () => {
    for (const [label, href] of [
        ['Last Longer', '/last-longer/index.html'],
        ['Stronger Erections', '/stronger-erections/index.html'],
        ['Better Sexual Performance', '/better-sexual-performance/index.html'],
        ['How It Works', '/how-it-works/index.html'],
        ['What’s Inside', '/whats-inside/index.html'],
        ['FAQ', '/faq/index.html'],
        ['Support', '/support/index.html'],
        ['Safety', '/safety/index.html'],
    ]) {
        test(`${label} renders with the shared header`, async () => {
            const page = await open(390, href);
            const m = await page.evaluate(() => ({
                headers: document.querySelectorAll('header').length,
                hasBar: !!document.querySelector('.sn-in'),
                overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                title: document.title,
                h1: (document.querySelector('h1') || {}).textContent || '',
            }));
            expect(m.headers).toBe(1);
            expect(m.hasBar).toBe(true);
            expect(m.overflowX, 'no horizontal scrolling').toBe(false);
            expect(m.title.length).toBeGreaterThan(0);
            expect(m.h1.trim().length, 'the page has real content').toBeGreaterThan(0);
            await page.close();
        }, 60_000);
    }

    test('the current page is marked, and only the current page', async () => {
        const page = await open(1280, '/faq/index.html');
        const marked = await page.evaluate(() =>
            [...document.querySelectorAll('[aria-current="page"]')].map(a => a.getAttribute('href')));
        expect([...new Set(marked)]).toEqual(['/faq/']);
        await page.close();
    }, 60_000);
});

describe('purchase and sign-in still work', () => {
    test('the CTA reaches the $49 offer, which still says $49', async () => {
        const page = await open(390);
        await page.click('.sn-in .sn-buy');
        await page.waitForTimeout(350);
        const m = await page.evaluate(() => {
            const get = document.getElementById('get');
            return { hash: location.hash,
                     price: (document.querySelector('.fig') || {}).textContent,
                     offerExists: !!get };
        });
        expect(m.hash).toBe('#get');
        expect(m.offerExists).toBe(true);
        expect(m.price.trim()).toBe('$49');
        await page.close();
    }, 60_000);

    test('sign in points at the app and is reachable from the menu', async () => {
        const page = await open(390);
        await page.click('#sn-toggle');
        await page.waitForTimeout(300);
        const href = await page.evaluate(() => {
            const a = [...document.querySelectorAll('.sn-drawer a')]
                .find(x => x.textContent.trim() === 'Sign in');
            return a && a.getAttribute('href');
        });
        expect(href).toBe('/app/');
        await page.close();
    }, 60_000);
});

describe('it reads clearly', () => {
    test('header text meets AA at the narrowest and widest widths', async () => {
        for (const w of [320, 1280]) {
            const page = await open(w);
            const low = await page.evaluate((probeSrc) => {
                const { R, px, bgOf } = eval(probeSrc);
                const out = [];
                document.querySelectorAll('.sn-in a,.sn-in button,.sn-links a').forEach(el => {
                    const t = (el.textContent || '').trim(); if (!t) return;
                    const cs = getComputedStyle(el);
                    const size = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight) || 400;
                    const need = (size >= 24 || (size >= 18.66 && wt >= 700)) ? 3 : 4.5;
                    const got = R(px(cs.color), bgOf(el));
                    if (got < need) out.push(`"${t.slice(0, 20)}" ${got.toFixed(2)} need ${need}`);
                });
                return out;
            }, PROBE);
            expect(low, `${w}px`).toEqual([]);
            await page.close();
        }
    }, 90_000);
});

describe('every page at every width, not just the home page', () => {
    /* The gap that let a real defect through. The suite above checked six
       widths on the home page and the supporting pages at 390 only, so
       "supporting page at desktop" was never covered. At 1280 those pages
       styled the bare `nav` element for their own old header
       (min-height:76px, flex-wrap:wrap) and that rule was still reaching
       the shared one, laying it out on two rows. Found by sweeping the
       matrix, not by the tests. */
    const PAGES = ['/index.html', '/learn/index.html', '/last-longer/index.html',
        '/stronger-erections/index.html', '/better-sexual-performance/index.html',
        '/how-it-works/index.html', '/whats-inside/index.html', '/faq/index.html',
        '/support/index.html', '/safety/index.html'];

    for (const [tag, w] of WIDTHS) {
        test(`${tag} (${w}px): all ten pages are one header on one row`, async () => {
            const page = await browser.newPage({ viewport: { width: w, height: 860 } });
            const bad = [];
            for (const p of PAGES) {
                await page.goto(`${srv.origin}${p}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
                await page.waitForTimeout(120);
                const m = await page.evaluate(() => {
                    const bar = document.querySelector('.sn-in');
                    const rows = new Set([...bar.children].map(c => c.getBoundingClientRect())
                        .filter(r => r.width > 0 && r.height > 0).map(r => Math.round(r.top)));
                    return { headers: document.querySelectorAll('header').length,
                             overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                             rows: rows.size,
                             barH: Math.round(bar.getBoundingClientRect().height) };
                });
                if (m.headers !== 1 || m.overflowX || m.rows !== 1 || m.barH > 72)
                    bad.push(`${p} ${JSON.stringify(m)}`);
            }
            await page.close();
            expect(bad, bad.join(' | ')).toEqual([]);
        }, 120_000);
    }
});
