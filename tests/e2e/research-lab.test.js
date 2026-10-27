import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { startServer, launchOptions } from './harness.js';

/**
 * THE RESEARCH LAB, DRIVEN.
 *
 * tests/researchLab.test.js reads the files. This renders them, because the
 * things most likely to go wrong here are visual: an evidence label that
 * cannot be read against the panel behind it, a method card that overflows
 * a phone, or a claim ledger whose two halves separate so that a claim
 * appears on screen without its assessment.
 */

const LANDING = '/research-lab/index.html';
const TOPIC = '/research-lab/manual-techniques/index.html';
const PAGES = [LANDING, TOPIC];
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

const open = async (url, width = 390) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${srv.origin}${url}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(180);
    return page;
};

describe('both pages render as part of the site', () => {
    for (const [tag, w] of WIDTHS) {
        test(`${tag} (${w}px): one header, no sideways scroll, nothing clipped`, async () => {
            const bad = [];
            const page = await browser.newPage({ viewport: { width: w, height: 900 } });
            for (const p of PAGES) {
                await page.goto(`${srv.origin}${p}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
                await page.waitForTimeout(140);
                const m = await page.evaluate(() => {
                    const over = [...document.querySelectorAll('main .method, main .ledger, main .ev')]
                        .filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
                        .map(e => e.className);
                    return {
                        headers: document.querySelectorAll('header').length,
                        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                        h1: document.querySelectorAll('h1').length,
                        over,
                    };
                });
                if (m.headers !== 1 || m.overflowX || m.h1 !== 1 || m.over.length) {
                    bad.push(`${p} ${JSON.stringify(m)}`);
                }
            }
            await page.close();
            expect(bad, bad.join(' | ')).toEqual([]);
        }, 90_000);
    }

    test('body text stays in the Learning Center range', async () => {
        for (const p of PAGES) {
            const page = await open(p);
            const m = await page.evaluate(() => {
                const cs = getComputedStyle(document.querySelector('.reading'));
                return { px: parseFloat(cs.fontSize),
                         lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) };
            });
            expect(m.px, p).toBeGreaterThanOrEqual(17);
            expect(m.px, p).toBeLessThanOrEqual(18);
            expect(m.lh, p).toBeGreaterThanOrEqual(1.6);
            expect(m.lh, p).toBeLessThanOrEqual(1.75);
            await page.close();
        }
    }, 60_000);
});

describe('the evidence labels', () => {
    test('ALL FOUR ARE DEFINED AND VISIBLE ON THE LANDING PAGE', async () => {
        const page = await open(LANDING);
        const m = await page.evaluate(() => {
            const items = [...document.querySelectorAll('.ev-key li')];
            return items.map(li => ({
                label: li.querySelector('.ev').textContent.trim(),
                cls: li.querySelector('.ev').className,
                shown: li.querySelector('.ev').getBoundingClientRect().height > 0,
                explanation: li.querySelector('p').textContent.trim().length,
            }));
        });
        expect(m.map(x => x.label)).toEqual([
            'Supported by clinical evidence', 'Preliminary evidence',
            'Community-reported, unverified', 'Insufficient evidence',
        ]);
        for (const x of m) {
            expect(x.shown, `${x.label} not painted`).toBe(true);
            expect(x.explanation, `${x.label} explanation too thin`).toBeGreaterThan(180);
        }
        await page.close();
    }, 60_000);

    test('EVERY LABEL MEETS AA AGAINST WHAT IS ACTUALLY BEHIND IT', async () => {
        /* Four hues on a dark panel is exactly where contrast goes wrong,
           and a label nobody can read is worse than no label. */
        for (const p of PAGES) {
            const page = await open(p, 320);
            const low = await page.evaluate((probeSrc) => {
                const { R, px, bgOf } = eval(probeSrc);
                const out = [];
                document.querySelectorAll('.ev').forEach(el => {
                    if (el.getBoundingClientRect().height === 0) return;
                    const cs = getComputedStyle(el);
                    const got = R(px(cs.color), bgOf(el));
                    if (got < 4.5) out.push(`${el.textContent.trim()} ${got.toFixed(2)}`);
                });
                return out;
            }, PROBE);
            expect(low, `${p}: ${low.join(', ')}`).toEqual([]);
            await page.close();
        }
    }, 90_000);

    test('and no line of either page fails AA at the narrowest width', async () => {
        for (const p of PAGES) {
            const page = await open(p, 320);
            const low = await page.evaluate((probeSrc) => {
                const { R, px, bgOf } = eval(probeSrc);
                const out = [];
                document.querySelectorAll('main p,main li,main h1,main h2,main h3,main h4,'
                    + 'main a,main strong,main span,main div').forEach(el => {
                    if (el.children.length && !['A', 'P', 'LI', 'SPAN', 'STRONG'].includes(el.tagName)) return;
                    const t = (el.textContent || '').trim();
                    if (!t || el.getBoundingClientRect().height === 0) return;
                    const cs = getComputedStyle(el);
                    const size = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight) || 400;
                    const need = (size >= 24 || (size >= 18.66 && wt >= 700)) ? 3 : 4.5;
                    const got = R(px(cs.color), bgOf(el));
                    if (got < need) out.push(`${el.tagName} "${t.slice(0, 22)}" ${got.toFixed(2)}/${need}`);
                });
                return out;
            }, PROBE);
            expect(low, `${p}: ${low.join(' | ')}`).toEqual([]);
            await page.close();
        }
    }, 90_000);
});

describe('the topic page shows the whole argument', () => {
    test('FOUR METHOD CARDS, EACH WITH ITS SIX SECTIONS', async () => {
        const page = await open(TOPIC);
        const m = await page.evaluate(() => [...document.querySelectorAll('.method')].map(c => ({
            name: c.querySelector('h3').textContent,
            alias: c.querySelector('.alias').textContent,
            heads: [...c.querySelectorAll('h4')].map(h => h.textContent),
            labels: c.querySelectorAll('.ev').length,
            shown: c.getBoundingClientRect().height > 0,
        })));
        expect(m.map(x => x.name)).toEqual(['Directional pulls', 'V-stretch', 'Wet jelq', 'Uli']);
        for (const c of m) {
            expect(c.shown, `${c.name} not painted`).toBe(true);
            expect(c.heads).toEqual(['What it generally involves', 'Why men are interested',
                'What men report', 'What published research establishes', 'Risks',
                'What remains unknown']);
            expect(c.labels, `${c.name} carries no evidence label`).toBeGreaterThanOrEqual(2);
            expect(/traction|compression/i.test(c.alias), `${c.name} alias: ${c.alias}`).toBe(true);
        }
        await page.close();
    }, 60_000);

    test('A CLAIM IS NEVER ON SCREEN WITHOUT ITS ASSESSMENT', async () => {
        /* The ledger is a two-column grid that stacks on a phone. If the
           halves ever separated, a reader could see the claim and scroll
           past the correction. */
        for (const w of [320, 390, 1280]) {
            const page = await open(TOPIC, w);
            const rows = await page.evaluate(() => [...document.querySelectorAll('.ledger-row')]
                .map(r => {
                    const c = r.querySelector('.ledger-claim').getBoundingClientRect();
                    const a = r.querySelector('.ledger-real').getBoundingClientRect();
                    return {
                        claim: r.querySelector('.ledger-claim').textContent.trim().slice(0, 40),
                        gap: Math.round(Math.max(a.top - c.bottom, c.top - a.bottom)),
                        hasLabel: !!r.querySelector('.ledger-real .ev'),
                        assessment: r.querySelector('.ledger-real p').textContent.trim().length,
                    };
                }));
            expect(rows.length, `${w}px`).toBe(4);
            for (const r of rows) {
                expect(r.hasLabel, `${r.claim} has no label at ${w}px`).toBe(true);
                expect(r.assessment, `${r.claim} assessment too thin`).toBeGreaterThan(150);
                expect(r.gap, `${r.claim} separated from its assessment at ${w}px`).toBeLessThan(40);
            }
            await page.close();
        }
    }, 90_000);

    test('the four forbidden claims are each present and each refused', async () => {
        const page = await open(TOPIC);
        const t = await page.evaluate(() =>
            document.querySelector('.ledger').innerText.replace(/\s+/g, ' '));
        for (const claim of ['improve erection quality', 'increase blood flow',
                             'permanent growth', 'safe as long as you are gentle']) {
            expect(t.toLowerCase(), `missing claim: ${claim}`).toContain(claim.toLowerCase());
        }
        expect((t.match(/Insufficient evidence/gi) || []).length).toBe(4);
        await page.close();
    }, 60_000);

    test('and the review stamp is visible on both pages', async () => {
        for (const p of PAGES) {
            const page = await open(p);
            const m = await page.evaluate(() => {
                const s = document.querySelector('.stamp');
                return { shown: s.getBoundingClientRect().height > 0,
                         text: s.innerText.replace(/\s+/g, ' ') };
            });
            expect(m.shown, `${p} stamp not painted`).toBe(true);
            expect(m.text).toMatch(/Last reviewed:\s*\d{1,2} \w+ \d{4}/);
            expect(m.text).toMatch(/No clinician has reviewed/);
            await page.close();
        }
    }, 60_000);
});

describe('navigation', () => {
    test('THE LEARNING CENTER REACHES THE LAB, AND THE LAB REACHES THE TOPIC', async () => {
        const page = await open('/learn/index.html');
        await page.click('main a[href="/research-lab/"]');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(180);
        expect(await page.evaluate(() => location.pathname)).toBe('/research-lab/');
        expect(await page.evaluate(() => document.querySelector('h1').textContent))
            .toContain('What is actually known');

        await page.click('a[href="/research-lab/manual-techniques/"]');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(180);
        expect(await page.evaluate(() => location.pathname)).toBe('/research-lab/manual-techniques/');
        expect(await page.evaluate(() => document.querySelector('h1').textContent))
            .toBe('Manual Techniques');
        await page.close();
    }, 90_000);

    test('the breadcrumb returns to the Lab and to Learn', async () => {
        const page = await open(TOPIC);
        await page.click('.crumb a[href="/research-lab/"]');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(180);
        expect(await page.evaluate(() => location.pathname)).toBe('/research-lab/');
        await page.click('.crumb a[href="/learn/"]');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(180);
        expect(await page.evaluate(() => location.pathname)).toBe('/learn/');
        await page.close();
    }, 90_000);

    test('every reference opens safely and names its source', async () => {
        const page = await open(TOPIC);
        const refs = await page.evaluate(() => [...document.querySelectorAll('.refs li')].map(li => {
            const a = li.querySelector('a');
            return { href: a.href, rel: a.rel, target: a.target,
                     label: a.textContent.replace(/\s+/g, ' ').trim(),
                     supports: (li.querySelector('a + span') || {}).textContent || '' };
        }));
        expect(refs.length).toBeGreaterThanOrEqual(5);
        for (const r of refs) {
            expect(r.href.startsWith('https://'), r.href).toBe(true);
            expect(r.rel).toBe('noopener noreferrer');
            expect(r.target).toBe('_blank');
            expect(r.label).toContain('(opens in a new tab)');
            expect(r.supports).toMatch(/^Supports /);
        }
        await page.close();
    }, 60_000);

    test('AND THE LAB SELLS NOTHING', async () => {
        for (const p of PAGES) {
            const page = await open(p);
            const m = await page.evaluate(() => ({
                ctas: document.querySelectorAll('main a.cta').length,
                price: /\$\d/.test(document.querySelector('main').innerText),
                offer: document.querySelectorAll('main .offer').length,
            }));
            expect(m.ctas, `${p} has a call to action`).toBe(0);
            expect(m.price, `${p} shows a price`).toBe(false);
            expect(m.offer, `${p} has an offer block`).toBe(0);
            await page.close();
        }
    }, 60_000);
});
