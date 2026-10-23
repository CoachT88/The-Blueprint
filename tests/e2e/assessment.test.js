import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { startServer, launchOptions } from './harness.js';

/**
 * THE ASSESSMENT, DRIVEN.
 *
 * tests/assessment.test.js reads the file and checks it against
 * docs/assessment-logic.md. This drives it: every branch answered through
 * the real UI, the result read off the rendered page, and the privacy
 * promise checked against what the browser actually did rather than
 * against what the source appears to say.
 *
 * The privacy checks here are the ones that matter. A static scan can miss
 * a call built from a string; a storage probe after a completed run cannot.
 */

const URL = '/assessment/index.html';
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

const open = async (width = 390) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${srv.origin}${URL}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(200);
    return page;
};

/** Answer the flow by option VALUE, skipping a step when given null. */
async function run(page, values) {
    const seen = [];
    for (const v of values) {
        const q = await page.evaluate(() => document.getElementById('qtext').textContent);
        seen.push(q);
        if (v === null) {
            await page.click('#skip');
        } else {
            const ok = await page.evaluate((val) => {
                const el = document.querySelector(`input[name="q"][value="${val}"]`);
                if (!el) return false;
                el.click();
                return true;
            }, v);
            if (!ok) throw new Error(`no option "${v}" on question: ${q}`);
            await page.click('#next');
        }
        await page.waitForTimeout(90);
    }
    await page.waitForTimeout(150);
    return seen;
}

const resultText = (page) => page.evaluate(() =>
    document.getElementById('result').innerText.replace(/\s+/g, ' '));
const verdict = (page) => page.evaluate(() =>
    (document.querySelector('#result .a-verdict') || {}).textContent || '');

describe('the flow runs', () => {
    test('IT ASKS FIVE QUESTIONS AND REACHES A RESULT', async () => {
        const page = await open();
        const asked = await run(page, ['erection', 'partner_only', 'usually', 'gt6m', 'no']);
        expect(asked.length).toBe(5);
        expect(asked[0]).toBe('What brings you here?');
        expect(await page.evaluate(() => document.getElementById('quiz').hidden)).toBe(true);
        expect(await page.evaluate(() => document.getElementById('result').hidden)).toBe(false);
        expect(await verdict(page)).toBe('This pattern looks situational');
        await page.close();
    }, 60_000);

    test('IT ASKS ONLY FOUR WHEN THE ERECTION QUESTION DOES NOT APPLY', async () => {
        /* pain and conditioning skip question 3 outright. */
        for (const [concern, where] of [['pain', 'sex'], ['conditioning', 'positions']]) {
            const page = await open();
            const asked = await run(page, [concern, where, 'gt6m', 'no']);
            expect(asked.length, concern).toBe(4);
            expect(asked.join(' '), `${concern} was asked about morning erections`)
                .not.toMatch(/morning and solo/);
            expect(await page.evaluate(() => document.getElementById('result').hidden)).toBe(false);
            await page.close();
        }
    }, 60_000);

    test('progress reflects the real number of questions', async () => {
        const page = await open();
        await page.evaluate(() => document.querySelector('input[value="pain"]').click());
        await page.click('#next');
        await page.waitForTimeout(90);
        expect(await page.evaluate(() => document.getElementById('prog').textContent))
            .toBe('Question 2 of 4');
        await page.close();
    }, 60_000);

    test('Back returns the previous answer still selected', async () => {
        const page = await open();
        await page.evaluate(() => document.querySelector('input[value="timing"]').click());
        await page.click('#next');
        await page.waitForTimeout(90);
        await page.click('#back');
        await page.waitForTimeout(90);
        const m = await page.evaluate(() => ({
            q: document.getElementById('qtext').textContent,
            checked: (document.querySelector('input[name="q"]:checked') || {}).value,
            backDisabled: document.getElementById('back').disabled,
        }));
        expect(m.q).toBe('What brings you here?');
        expect(m.checked, 'the earlier answer was lost').toBe('timing');
        expect(m.backDisabled, 'Back is disabled on the first question').toBe(true);
        await page.close();
    }, 60_000);

    test('EVERY QUESTION CAN BE SKIPPED, AND AN ALL-SKIPPED RUN STILL RESOLVES', async () => {
        const page = await open();
        /* Skipping question 1 leaves the concern unknown, which correctly
           drops the conditional erection question. Four, not five. */
        const asked = await run(page, [null, null, null, null]);
        expect(asked.length).toBe(4);
        expect(asked.join(' ')).not.toMatch(/morning and solo/);
        expect(await page.evaluate(() => document.getElementById('result').hidden)).toBe(false);
        const t = await resultText(page);
        expect(await verdict(page)).toBe('Your answers do not point clearly in one direction yet');
        /* Even with nothing answered, the safety floor is present. */
        expect(t).toMatch(/See a doctor promptly if any of these apply/i);
        expect(t).toMatch(/cannot diagnose/);
        await page.close();
    }, 60_000);

    test('Start again clears the answers', async () => {
        const page = await open();
        await run(page, ['timing', 'partner_only', 'usually', 'always', 'no']);
        await page.click('#again');
        await page.waitForTimeout(120);
        const m = await page.evaluate(() => ({
            q: document.getElementById('qtext').textContent,
            checked: document.querySelectorAll('input[name="q"]:checked').length,
            resultHidden: document.getElementById('result').hidden,
        }));
        expect(m.q).toBe('What brings you here?');
        expect(m.checked, 'an answer survived the reset').toBe(0);
        expect(m.resultHidden).toBe(true);
        await page.close();
    }, 60_000);
});

describe('every result profile is reachable through the UI', () => {
    const PATHS = [
        ['urgent', ['pain', 'urinating', 'lt1m', 'no'], 'Please get this looked at promptly'],
        ['pelvic', ['pain', 'sex', 'gt6m', 'no'], 'A pelvic health assessment is the most useful next step'],
        ['erection_physical', ['erection', 'both', 'rarely', 'gt6m', 'no'],
            'Worth a general health check, not only a sexual health one'],
        ['erection_situational', ['erection', 'partner_only', 'usually', '1to6m', 'no'],
            'This pattern looks situational'],
        ['erection_mixed', ['erection', 'varies', 'unknown', 'lt1m', 'no'],
            'Your answers do not point clearly in one direction yet'],
        ['timing_acquired', ['timing', 'partner_only', 'usually', '1to6m', 'no'],
            'A recent change is worth raising with a doctor'],
        ['timing_lifelong', ['timing', 'both', 'usually', 'always', 'evaluated'],
            'Arousal awareness is the skill to build first'],
        ['conditioning', ['conditioning', 'positions', 'gt6m', 'evaluated'],
            'Comfort and positioning are the realistic targets'],
    ];

    for (const [id, answers, want] of PATHS) {
        test(`${id}`, async () => {
            const page = await open();
            await run(page, answers);
            expect(await verdict(page)).toBe(want);
            const t = await resultText(page);
            /* Two free actions, the safety floor, and the limits, always. */
            expect(await page.evaluate(() => document.querySelectorAll('#result .a-actions li').length))
                .toBe(2);
            expect(t, 'no urgent signs list').toMatch(/See a doctor promptly if any of these apply/i);
            expect(t, 'no cannot-diagnose line').toMatch(/Five questions cannot diagnose/);
            expect(t, 'no price').toContain('$49 one-time access.');
            await page.close();
        }, 60_000);
    }

    test('THE URGENT RULE OUTRANKS EVERYTHING ELSE', async () => {
        /* Same answers that would otherwise give a pelvic result, plus the
           red flag. The red flag has to win. */
        const page = await open();
        await run(page, ['pain', 'urinating', 'always', 'evaluated']);
        const t = await resultText(page);
        expect(await verdict(page)).toBe('Please get this looked at promptly');
        expect(t).toMatch(/deliberately not suggesting exercises/);
        expect(await page.evaluate(() => document.querySelectorAll('#result .topics a').length),
            'the urgent result sends the reader to a guide').toBe(0);
        await page.close();
    }, 60_000);

    test('the unexamined long-standing steer appears, and only when it should', async () => {
        const on = await open();
        await run(on, ['erection', 'partner_only', 'usually', 'gt6m', 'no']);
        expect(await resultText(on)).toMatch(/that is worth an appointment/);
        await on.close();

        const off = await open();
        await run(off, ['erection', 'partner_only', 'usually', '1to6m', 'evaluated']);
        expect(await resultText(off)).not.toMatch(/that is worth an appointment/);
        await off.close();
    }, 60_000);

    test('and the pelvic result refuses to send anyone to strengthening', async () => {
        const page = await open();
        await run(page, ['pain', 'most', 'gt6m', 'no']);
        const t = await resultText(page);
        expect(t).toMatch(/Kegel exercises can make symptoms worse/);
        expect(t).toMatch(/strengthening is left out on purpose/);
        expect(t).toMatch(/pelvic health physiotherapy assessment/);
        await page.close();
    }, 60_000);
});

describe('privacy, observed rather than read', () => {
    test('A COMPLETED RUN LEAVES NOTHING ON THE DEVICE', async () => {
        const page = await open();
        await run(page, ['pain', 'urinating', 'gt6m', 'no']);
        const m = await page.evaluate(() => ({
            local: Object.keys(localStorage).length,
            session: Object.keys(sessionStorage).length,
            cookie: document.cookie,
            url: location.href,
        }));
        expect(m.local, 'localStorage was written').toBe(0);
        expect(m.session, 'sessionStorage was written').toBe(0);
        expect(m.cookie, 'a cookie was set').toBe('');
        expect(m.url, 'an answer reached the URL').toBe(`${srv.origin}${URL}`);
        await page.close();
    }, 60_000);

    test('AND SENDS NO NETWORK REQUEST OF ANY KIND', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
        const requests = [];
        page.on('request', (r) => requests.push(r.url()));
        await page.goto(`${srv.origin}${URL}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForTimeout(200);
        const afterLoad = requests.length;
        await run(page, ['erection', 'both', 'rarely', 'gt6m', 'no']);
        await page.waitForTimeout(400);
        const during = requests.slice(afterLoad);
        expect(during, `requests during the run: ${during.join(', ')}`).toEqual([]);
        /* And the page load itself pulled nothing off-site. */
        const offsite = requests.filter(u => !u.startsWith(srv.origin));
        expect(offsite, `off-site requests: ${offsite.join(', ')}`).toEqual([]);
        await page.close();
    }, 60_000);

    test('reloading destroys the answers, as the page promises', async () => {
        const page = await open();
        await run(page, ['timing', 'both', 'usually', 'always', 'no']);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => ({
            q: document.getElementById('qtext').textContent,
            resultHidden: document.getElementById('result').hidden,
            checked: document.querySelectorAll('input[name="q"]:checked').length,
        }));
        expect(m.q).toBe('What brings you here?');
        expect(m.resultHidden).toBe(true);
        expect(m.checked).toBe(0);
        await page.close();
    }, 60_000);
});

describe('it is usable', () => {
    for (const [tag, w] of WIDTHS) {
        test(`${tag} (${w}px): one header, no sideways scroll, real targets`, async () => {
            const page = await open(w);
            const m = await page.evaluate(() => {
                const small = [...document.querySelectorAll('#quiz .opt span, #quiz button')]
                    .map(el => ({ n: el.textContent.trim().slice(0, 20),
                                  h: Math.round(el.getBoundingClientRect().height) }))
                    .filter(x => x.h > 0 && x.h < 44);
                return {
                    headers: document.querySelectorAll('header').length,
                    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
                    small,
                };
            });
            expect(m.headers).toBe(1);
            expect(m.overflowX, 'no horizontal scrolling').toBe(false);
            expect(m.small, `undersized: ${JSON.stringify(m.small)}`).toEqual([]);
            await page.close();
        }, 60_000);
    }

    test('THE WHOLE FLOW WORKS BY KEYBOARD', async () => {
        const page = await open();
        /* Tab to the first radio, choose with the arrow keys, submit with
           Enter. No mouse anywhere. */
        await page.keyboard.press('Tab');
        for (let i = 0; i < 12; i++) {
            const onRadio = await page.evaluate(() =>
                document.activeElement && document.activeElement.name === 'q');
            if (onRadio) break;
            await page.keyboard.press('Tab');
        }
        expect(await page.evaluate(() => document.activeElement.name)).toBe('q');
        await page.keyboard.press('ArrowDown');
        const picked = await page.evaluate(() => document.activeElement.value);
        expect(picked).toBe('timing');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(120);
        expect(await page.evaluate(() => document.getElementById('qtext').textContent))
            .toBe('When does it happen?');
        await page.close();
    }, 60_000);

    test('focus moves to the new question, and the change is announced', async () => {
        const page = await open();
        await page.evaluate(() => document.querySelector('input[value="erection"]').click());
        await page.click('#next');
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => ({
            focused: document.activeElement.id,
            live: document.getElementById('live').textContent,
            legendIsHeading: document.getElementById('qtext').tagName,
        }));
        expect(m.focused, 'focus did not move to the question').toBe('qtext');
        expect(m.live).toMatch(/Question 2 of 5/);
        expect(m.legendIsHeading).toBe('LEGEND');
        await page.close();
    }, 60_000);

    test('the result is announced and focused too', async () => {
        const page = await open();
        await run(page, ['conditioning', 'general', 'lt1m', 'no']);
        const m = await page.evaluate(() => ({
            focused: document.activeElement.id,
            live: document.getElementById('live').textContent,
        }));
        expect(m.focused).toBe('result');
        expect(m.live).toMatch(/Your result is ready/);
        await page.close();
    }, 60_000);

    test('and no text on the question screen or a result fails AA', async () => {
        for (const stage of ['question', 'result']) {
            const page = await open(320);
            if (stage === 'result') await run(page, ['pain', 'urinating', 'gt6m', 'no']);
            const low = await page.evaluate((probeSrc) => {
                const { R, px, bgOf } = eval(probeSrc);
                const out = [];
                document.querySelectorAll('main p,main li,main h1,main h3,main a,main strong,'
                    + 'main legend,main span,main button').forEach(el => {
                    const t = (el.textContent || '').trim();
                    if (!t || el.getBoundingClientRect().height === 0) return;
                    const cs = getComputedStyle(el);
                    if (cs.visibility === 'hidden' || cs.opacity === '0') return;
                    const size = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight) || 400;
                    const need = (size >= 24 || (size >= 18.66 && wt >= 700)) ? 3 : 4.5;
                    const got = R(px(cs.color), bgOf(el));
                    if (got < need) out.push(`${el.tagName} "${t.slice(0, 24)}" ${got.toFixed(2)}/${need}`);
                });
                return out;
            }, PROBE);
            expect(low, `${stage}: ${low.join(' | ')}`).toEqual([]);
            await page.close();
        }
    }, 90_000);
});

describe('it joins the rest of the site', () => {
    test('the guides it recommends load', async () => {
        const page = await open();
        await run(page, ['erection', 'both', 'rarely', 'gt6m', 'no']);
        const hrefs = await page.evaluate(() =>
            [...document.querySelectorAll('#result .topics a')].map(a => a.getAttribute('href')));
        expect(hrefs.length).toBeGreaterThanOrEqual(2);
        for (const h of hrefs) {
            await page.goto(`${srv.origin}${h}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            const ok = await page.evaluate(() => ({
                h1: (document.querySelector('h1') || {}).textContent || '',
                headers: document.querySelectorAll('header').length,
            }));
            expect(ok.h1.trim().length, `${h} is empty`).toBeGreaterThan(0);
            expect(ok.headers, `${h} is not a real page`).toBe(1);
        }
        await page.close();
    }, 90_000);

    test('and the Learning Center offers it', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
        await page.goto(`${srv.origin}/learn/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.click('a[href="/assessment/"]');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => location.pathname)).toBe('/assessment/');
        expect(await page.evaluate(() => document.querySelector('h1').textContent))
            .toBe('What Should I Work On?');
        await page.close();
    }, 60_000);
});
