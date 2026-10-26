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

const GUIDE = '/performance-anxiety-erections/index.html';
const HUB = '/stronger-erections/index.html';
/* Every published guide. The per-guide checks below run against all of
   them, because the thing that breaks is one page quietly diverging from
   the set, and the set is what a reader moves through. */
const GUIDES = [
    '/performance-anxiety-erections/index.html',
    '/blood-sugar-erections/index.html',
    '/hydration-erections/index.html',
    '/pelvic-floor-premature-ejaculation/index.html',
    '/hip-mobility-sexual-performance/index.html',
    '/improve-sexual-stamina/index.html',
];
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
            expect(m.sections, 'the numbered sections plus related guides')
                .toBeGreaterThanOrEqual(10);
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
        expect(m.path).toBe('/performance-anxiety-erections/');
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

    test('Explore The Blueprint reaches the offer page, which still says $99 once', async () => {
        const page = await open(390, GUIDE);
        await page.click('.actions .cta:not(.secondary)');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => ({
            path: location.pathname,
            body: document.body.textContent.replace(/\s+/g, ' '),
        }));
        expect(m.path).toBe('/whats-inside/');
        expect(m.body).toMatch(/\$99/);
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

describe('the free seven-day check is usable on the page itself', () => {
    test('IT RENDERS WHOLE, WITH NOTHING GATED BEHIND A PURCHASE', async () => {
        const page = await open(390, GUIDE);
        const m = await page.evaluate(() => {
            const s = document.getElementById('seven-day-check');
            const r = s.getBoundingClientRect();
            return {
                heading: s.querySelector('h2').textContent,
                /* Five daily observations and the review questions, all
                   painted. A collapsed <details> or a hidden block would
                   read as present in the HTML and be unusable here. */
                daily: [...s.querySelectorAll('.check li')].map(li => ({
                    label: li.querySelector('strong').textContent,
                    shown: li.getBoundingClientRect().height > 0,
                })),
                review: s.querySelectorAll('.ask li').length,
                limitsShown: s.querySelector('.limits').getBoundingClientRect().height > 0,
                /* The one section a non-buyer can use must not route him
                   into the funnel to use it. */
                ctas: s.querySelectorAll('a.cta,a[href="/whats-inside/"],a[href="/app/"]').length,
                links: s.querySelectorAll('a').length,
                wide: r.width <= document.documentElement.clientWidth,
            };
        });
        expect(m.heading).toBe('7. Try This: Your 7-Day Erection Consistency Check');
        expect(m.daily.map(d => d.label))
            .toEqual(['Sleep', 'Stress', 'Morning erection', 'Situation', 'Worry']);
        expect(m.daily.every(d => d.shown), 'every observation is visible').toBe(true);
        expect(m.review, 'the review questions').toBeGreaterThanOrEqual(3);
        expect(m.limitsShown, 'the limits of the check are on screen').toBe(true);
        expect(m.ctas, 'the free exercise sells something').toBe(0);
        expect(m.links, 'the free exercise links out').toBe(0);
        expect(m.wide, 'the section fits the viewport').toBe(true);
        await page.close();
    }, 60_000);

    test('and it says on screen that it cannot diagnose anything', async () => {
        const page = await open(390, GUIDE);
        const t = await page.evaluate(() =>
            document.querySelector('#seven-day-check .limits').textContent.replace(/\s+/g, ' '));
        expect(t).toMatch(/cannot diagnose the cause of erection difficulties/i);
        expect(t).toMatch(/not a reason to delay an appointment/i);
        await page.close();
    }, 60_000);
});

describe('the references are real links a reader can follow', () => {
    test('EVERY SOURCE IS HTTPS, OPENS SAFELY, AND SAYS WHAT IT SUPPORTS', async () => {
        const page = await open(390, GUIDE);
        const refs = await page.evaluate(() =>
            [...document.querySelectorAll('.refs li')].map(li => {
                const a = li.querySelector('a');
                return {
                    href: a.href,
                    rel: a.rel,
                    target: a.target,
                    /* The anchor must name the source to a screen reader
                       reading links out of context, not just "here". */
                    label: a.textContent.replace(/\s+/g, ' ').trim(),
                    supports: (li.querySelector('a + span') || {}).textContent || '',
                    shown: li.getBoundingClientRect().height > 0,
                };
            }));
        expect(refs.length, 'too few sources').toBeGreaterThanOrEqual(5);
        for (const r of refs) {
            expect(r.href.startsWith('https://'), `${r.href}`).toBe(true);
            expect(r.rel).toBe('noopener noreferrer');
            expect(r.target).toBe('_blank');
            expect(r.label.length, `link text too short: ${r.label}`).toBeGreaterThan(25);
            expect(r.label).toContain('(opens in a new tab)');
            expect(r.supports).toMatch(/^Supports /);
            expect(r.shown).toBe(true);
        }
        await page.close();
    }, 60_000);

    test('the new-tab notice reaches a screen reader without being painted', async () => {
        const page = await open(390, GUIDE);
        const m = await page.evaluate(() => {
            const a = document.querySelector('.refs li a');
            const sr = a.querySelector('.sr-only');
            const r = sr.getBoundingClientRect();
            const cs = getComputedStyle(sr);
            return {
                w: Math.round(r.width), h: Math.round(r.height),
                position: cs.position, clip: cs.clip, overflow: cs.overflow,
                /* It has to stay in the accessible name. Hiding it with
                   display:none or visibility:hidden would take it out of
                   the name as well as off the screen, which is the whole
                   failure this pattern exists to avoid. */
                inName: a.textContent.includes('(opens in a new tab)'),
                display: cs.display, visibility: cs.visibility,
            };
        });
        /* innerText is not the probe here: Chromium reports clipped text in
           innerText, so a passing innerText check would prove nothing. The
           1px clipped box is what keeps it off the screen. */
        expect(m.w).toBeLessThanOrEqual(1);
        expect(m.h).toBeLessThanOrEqual(1);
        expect(m.position).toBe('absolute');
        expect(m.clip).toBe('rect(0px, 0px, 0px, 0px)');
        expect(m.overflow).toBe('hidden');
        expect(m.display, 'display:none would drop it from the name').not.toBe('none');
        expect(m.visibility, 'visibility:hidden would drop it from the name').not.toBe('hidden');
        expect(m.inName, 'the notice is not in the accessible name').toBe(true);
        await page.close();
    }, 60_000);
});

describe('every guide, driven', () => {
    /* The static suite reads the files. This renders them. A guide that
       parses perfectly can still paint its principle cards off the side of
       a 320px screen, or print a safety block in a colour nobody can read
       against the panel behind it. */
    for (const g of GUIDES) {
        test(`${g}: renders as part of the set, not as its own website`, async () => {
            const page = await open(390, g);
            const m = await page.evaluate(() => ({
                headers: document.querySelectorAll('header').length,
                overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                h1: document.querySelectorAll('h1').length,
                /* The shared components, all painted. */
                principles: [...document.querySelectorAll('.principle')]
                    .filter(e => e.getBoundingClientRect().height > 0).length,
                parts: [...document.querySelectorAll('.principle')]
                    .map(p => [...p.querySelectorAll('dt')].map(d => d.textContent)),
                takeaway: !!document.querySelector('.takeaway')
                    && document.querySelector('.takeaway').getBoundingClientRect().height > 0,
                plan: !!document.querySelector('[id$="-check"] .check, [id$="-check"] .steps'),
                limits: !!document.querySelector('.limits')
                    && document.querySelector('.limits').getBoundingClientRect().height > 0,
                refs: document.querySelectorAll('.refs li').length,
                related: document.querySelectorAll('.topics a').length,
                price: (document.querySelector('.price') || {}).textContent,
                /* The one section a non-buyer uses must not sell him anything. */
                planLinks: document.querySelectorAll('[id$="-check"] a').length,
                /* Body text in the range the brief asks for. */
                bodyPx: parseFloat(getComputedStyle(document.querySelector('.reading')).fontSize),
                lineH: parseFloat(getComputedStyle(document.querySelector('.reading')).lineHeight)
                       / parseFloat(getComputedStyle(document.querySelector('.reading')).fontSize),
            }));
            expect(m.headers, 'exactly one header').toBe(1);
            expect(m.overflowX, 'no horizontal scrolling').toBe(false);
            expect(m.h1).toBe(1);
            expect(m.principles, 'fewer than three principles painted').toBeGreaterThanOrEqual(3);
            for (const parts of m.parts) {
                expect(parts).toEqual(['Why it matters', 'Practical example', 'Apply it']);
            }
            expect(m.takeaway, 'no takeaway on screen').toBe(true);
            expect(m.plan, 'no action plan list').toBe(true);
            expect(m.limits, 'no limits block on screen').toBe(true);
            expect(m.refs, 'too few references').toBeGreaterThanOrEqual(4);
            expect(m.related, 'no related guides').toBeGreaterThanOrEqual(2);
            expect(m.price.trim()).toBe('$99 one-time access.');
            expect(m.planLinks, 'the free plan links out').toBe(0);
            expect(m.bodyPx).toBeGreaterThanOrEqual(17);
            expect(m.bodyPx).toBeLessThanOrEqual(18);
            expect(m.lineH).toBeGreaterThanOrEqual(1.6);
            expect(m.lineH).toBeLessThanOrEqual(1.75);
            await page.close();
        }, 60_000);
    }

    test('NO LINE OF ANY GUIDE FAILS AA, AT THE NARROWEST WIDTH', async () => {
        /* Composited down to the canvas. Reading the first non-transparent
           background instead reports 1.10:1 for perfectly legible text. */
        const bad = [];
        const page = await browser.newPage({ viewport: { width: 320, height: 860 } });
        for (const g of GUIDES) {
            await page.goto(`${srv.origin}${g}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            await page.waitForTimeout(150);
            const low = await page.evaluate((probeSrc) => {
                const { R, px, bgOf } = eval(probeSrc);
                const out = [];
                document.querySelectorAll('main p,main li,main h1,main h2,main h3,main a,'
                    + 'main strong,main dt,main dd,main span').forEach(el => {
                    const t = (el.textContent || '').trim();
                    if (!t || el.getBoundingClientRect().height === 0) return;
                    const cs = getComputedStyle(el);
                    const size = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight) || 400;
                    const need = (size >= 24 || (size >= 18.66 && wt >= 700)) ? 3 : 4.5;
                    const got = R(px(cs.color), bgOf(el));
                    if (got < need) out.push(`${el.tagName} "${t.slice(0, 24)}" ${got.toFixed(2)}/${need}`);
                });
                return out;
            }, PROBE);
            if (low.length) bad.push(`${g}: ${low.join(', ')}`);
        }
        await page.close();
        expect(bad, bad.join(' | ')).toEqual([]);
    }, 120_000);

    test('the prose column stays in the comfortable reading range', async () => {
        const page = await open(1280, '/blood-sugar-erections/index.html');
        const ch = await page.evaluate(() => {
            const p = [...document.querySelectorAll('.reading > p')]
                .find(e => e.textContent.trim().length > 200);
            const cs = getComputedStyle(p);
            /* Approximate character count from the average advance width of
               the actual font, measured rather than assumed. */
            const c = document.createElement('canvas').getContext('2d');
            c.font = `${cs.fontSize} ${cs.fontFamily}`;
            const avg = c.measureText('abcdefghijklmnopqrstuvwxyz ').width / 27;
            return p.getBoundingClientRect().width / avg;
        });
        expect(ch, `measured ${Math.round(ch)} characters per line`).toBeGreaterThan(55);
        expect(ch, `measured ${Math.round(ch)} characters per line`).toBeLessThan(85);
        await page.close();
    }, 60_000);

    test('and every related link actually lands on a guide', async () => {
        const page = await open(390, '/blood-sugar-erections/index.html');
        const hrefs = await page.evaluate(() =>
            [...document.querySelectorAll('.topics a')].map(a => a.getAttribute('href')));
        expect(hrefs.length).toBeGreaterThanOrEqual(2);
        for (const h of hrefs) {
            await page.goto(`${srv.origin}${h}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            const ok = await page.evaluate(() => ({
                h1: (document.querySelector('h1') || {}).textContent || '',
                header: document.querySelectorAll('header').length,
            }));
            expect(ok.h1.trim().length, `${h} has no heading`).toBeGreaterThan(0);
            expect(ok.header, `${h} is not a real page`).toBe(1);
        }
        await page.close();
    }, 90_000);
});
