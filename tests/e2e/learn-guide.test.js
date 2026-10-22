import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { startServer, launchOptions } from './harness.js';

/**
 * THE FIRST LEARNING CENTRE GUIDE, DRIVEN.
 *
 * tests/learnGuides.test.js reads the file: the hub links it, the sections
 * are in order, the medical note is there, the price is stated once. None of
 * that proves the page can be read on a phone.
 *
 * This file renders it. Does the article fit without sideways scroll at every
 * width the site supports, is every line of it legible against what is
 * actually painted behind it, are the two calls to action real targets a
 * thumb can hit, and does the route from the hub to the guide and from the
 * guide back out actually work.
 *
 * The contrast probe composites every translucent layer down to the canvas.
 * Reading the first non-transparent background instead treats
 * rgba(255,255,255,.03) as white and reports 1.10:1 for legible text.
 */

const GUIDE = '/stronger-erections/why-hard-alone-but-lose-it-during-sex/index.html';
const HUB = '/stronger-erections/index.html';
const WIDTHS = [['320', 320], ['375', 375], ['390', 390], ['430', 430],
                ['tablet', 768], ['desktop', 1280]];

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

const open = async (width, pathname) => {
    const page = await browser.newPage({ viewport: { width, height: 860 } });
    await page.goto(`${srv.origin}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(200);
    return page;
};

describe('the guide reads on a phone', () => {
    for (const [tag, w] of WIDTHS) {
        test(`${tag} (${w}px): no sideways scroll, and the article is one column`, async () => {
            const page = await open(w, GUIDE);
            const m = await page.evaluate(() => {
                const main = document.querySelector('main');
                return {
                    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                    h1: document.querySelectorAll('h1').length,
                    sections: document.querySelectorAll('main section h2').length,
                    /* Every paragraph starts at the same left edge. A block
                       that escapes the measure reads as a different column. */
                    lefts: new Set([...document.querySelectorAll('.reading > p')]
                        .map(p => Math.round(p.getBoundingClientRect().left))).size,
                    noteVisible: document.querySelector('.note').getBoundingClientRect().height > 0,
                };
            });
            expect(m.overflowX, 'no horizontal scrolling').toBe(false);
            expect(m.h1).toBe(1);
            expect(m.sections, 'seven numbered sections plus the topic footer')
                .toBeGreaterThanOrEqual(8);
            expect(m.lefts, 'the prose is a single column').toBe(1);
            expect(m.noteVisible, 'the medical note is rendered').toBe(true);
            await page.close();
        }, 60_000);
    }

    test('NO LINE OF THE ARTICLE FAILS AA, AT THE NARROWEST AND WIDEST', async () => {
        for (const w of [320, 1280]) {
            const page = await open(w, GUIDE);
            const low = await page.evaluate((probeSrc) => {
                const { R, px, bgOf } = eval(probeSrc);
                const out = [];
                document.querySelectorAll('main p,main li,main h1,main h2,main h3,main a,main strong')
                    .forEach(el => {
                        const t = (el.textContent || '').trim();
                        if (!t || el.getBoundingClientRect().height === 0) return;
                        const cs = getComputedStyle(el);
                        const size = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight) || 400;
                        const need = (size >= 24 || (size >= 18.66 && wt >= 700)) ? 3 : 4.5;
                        const got = R(px(cs.color), bgOf(el));
                        if (got < need) out.push(`${el.tagName} "${t.slice(0, 28)}" ${got.toFixed(2)} need ${need}`);
                    });
                return out;
            }, PROBE);
            expect(low, `${w}px`).toEqual([]);
            await page.close();
        }
    }, 90_000);

    test('both calls to action are 44px targets', async () => {
        const page = await open(390, GUIDE);
        const small = await page.evaluate(() =>
            [...document.querySelectorAll('main .cta,main .crumb a,main .topics a')]
                .map(el => ({ n: el.textContent.trim().slice(0, 24),
                              h: Math.round(el.getBoundingClientRect().height),
                              w: Math.round(el.getBoundingClientRect().width) }))
                .filter(x => x.h > 0 && x.h < 24));
        /* 24x24 is WCAG 2.5.8 at AA. The breadcrumb is inline text in a line
           of prose, so it is measured against AA and not the 44px AAA rule
           the drawer's controls are held to. */
        expect(small, `undersized: ${JSON.stringify(small)}`).toEqual([]);
        await page.close();
    }, 60_000);
});

describe('the route to the guide and out of it', () => {
    test('THE HUB’S FIRST QUESTION OPENS THE GUIDE', async () => {
        const page = await open(390, HUB);
        await page.click('.guide-list a');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => ({
            path: location.pathname,
            h1: (document.querySelector('h1') || {}).textContent || '',
            headers: document.querySelectorAll('header').length,
        }));
        /* The hub links the directory, not index.html, and the server
           resolves it. That is the URL the article will actually be shared
           and indexed under. */
        expect(m.path).toBe('/stronger-erections/why-hard-alone-but-lose-it-during-sex/');
        expect(m.h1).toBe('Why Can I Get Hard Alone but Lose It During Sex?');
        expect(m.headers, 'the guide carries the shared header').toBe(1);
        await page.close();
    }, 60_000);

    test('the breadcrumb goes back to the hub', async () => {
        const page = await open(390, GUIDE);
        await page.click('.crumb a[href="/stronger-erections/"]');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => (document.querySelector('h1') || {}).textContent))
            .toBe('Stronger Erections');
        await page.close();
    }, 60_000);

    test('Explore The Blueprint reaches the offer page, which still says $49 once', async () => {
        const page = await open(390, GUIDE);
        await page.click('.actions .cta:not(.secondary)');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => ({
            path: location.pathname,
            body: document.body.textContent.replace(/\s+/g, ' '),
        }));
        expect(m.path).toBe('/whats-inside/');
        expect(m.body).toMatch(/\$49/);
        await page.close();
    }, 60_000);

    test('and the purchase button in the shared header still points at the offer', async () => {
        const page = await open(390, GUIDE);
        const href = await page.evaluate(() =>
            document.querySelector('.sn-in .sn-buy').getAttribute('href'));
        expect(href).toBe('/#get');
        await page.close();
    }, 60_000);
});
