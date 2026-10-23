import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE ASSESSMENT, AGAINST ITS SPECIFICATION.
 *
 * docs/assessment-logic.md is the spec. This file holds the half a machine
 * can check: the five questions, the branch and skip logic, every result
 * profile, the three layers of medical safety, and the privacy design.
 *
 * Privacy is the part worth being severe about. This is the only page on
 * the site that collects anything, and what it collects is a man's account
 * of his own sexual difficulty. The design answer is that the answers live
 * in one closure variable and nowhere else, so there is nothing to leak.
 * A single localStorage call, a query parameter, or an analytics snippet
 * would quietly undo that, and none of them would look wrong in review.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const FILE = 'assessment/index.html';
const src = read(FILE);
const doc = read('docs/assessment-logic.md');

/** The page's own script, with the shared header's script excluded. */
const ownScript = src
    .replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, ' ');

/**
 * The same, with comments removed, for the API bans below.
 *
 * The script's own header comment lists the APIs it promises not to use, so
 * scanning the raw text flags the promise as if it were the violation. Only
 * code can call anything.
 */
const code = ownScript.replace(/\/\*[\s\S]*?\*\//g, ' ');

const prose = (s) => s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

/* ──────────────────────────────────────────────────────────── privacy ── */

describe('privacy: there is nothing to leak', () => {
    test('NOTHING IS STORED ON THE DEVICE', () => {
        for (const api of ['localStorage', 'sessionStorage', 'document.cookie',
                           'indexedDB', 'caches.open']) {
            expect(code.includes(api), `${api} appears`).toBe(false);
        }
    });

    test('NOTHING IS SENT ANYWHERE', () => {
        for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket',
                           'EventSource', 'navigator.connection', 'new Image(']) {
            expect(code.includes(api), `${api} appears`).toBe(false);
        }
        /* No third party at all, and no form that could post. */
        expect(/<form[^>]*\saction=/i.test(src), 'the form has an action').toBe(false);
        /* Resources the browser actually fetches. A canonical link and an
           og:url are metadata: they name the page, they do not load it, and
           banning them would ban correct markup. */
        expect(/<(script|img|iframe|embed|object|video|audio|source)[^>]+src=["']https?:/i.test(code),
            'an external subresource is loaded').toBe(false);
        expect(/<link[^>]+rel=["']?(stylesheet|preconnect|dns-prefetch|prefetch|preload)/i.test(code),
            'an external connection is opened by a link tag').toBe(false);
        expect(/@import|url\(https?:/i.test(code),
            'the stylesheet reaches out').toBe(false);
    });

    test('NO ANSWER REACHES THE URL', () => {
        /* A result in the address bar is shareable, recoverable, and leaks
           through the referrer header to every link the reader follows. */
        for (const api of ['location.search', 'location.hash', 'pushState',
                           'replaceState', 'URLSearchParams', 'location.href =']) {
            expect(code.includes(api), `${api} appears`).toBe(false);
        }
        expect(src).toContain('<meta name="referrer" content="no-referrer">');
    });

    test('no analytics, tag manager or pixel', () => {
        expect(/gtag|googletagmanager|google-analytics|fbq|hotjar|mixpanel|segment|plausible|posthog/i
            .test(src), 'a tracker appears').toBe(false);
    });

    test('the answers live in one closure variable', () => {
        expect(ownScript).toMatch(/\(function \(\) \{/);
        expect(ownScript).toMatch(/var answers = \{\};/);
        expect(ownScript).toContain("'use strict'");
    });

    test('and the page tells the visitor all of this in plain words', () => {
        const text = prose(src);
        expect(text).toMatch(/answers stay in this browser tab/i);
        expect(text).toMatch(/nothing is put in the web address/i);
        expect(text).toMatch(/Close or reload the tab and the answers are gone/i);
        expect(text).toMatch(/nothing to sign up for/i);
    });
});

/* ────────────────────────────────────────────────────────── questions ── */

describe('the five questions', () => {
    const keys = [...ownScript.matchAll(/^\s{6}key: '(\w+)',$/gm)].map(m => m[1]);

    test('THERE ARE EXACTLY FIVE, IN THE SPECIFIED ORDER', () => {
        expect(keys).toEqual(['concern', 'where', 'morning', 'duration', 'seen']);
    });

    test('they cover what the brief asked for', () => {
        const text = ownScript;
        expect(text).toContain('What brings you here?');
        expect(text).toContain('When does it happen?');
        expect(text).toContain('What are your morning and solo erections like?');
        expect(text).toContain('How long has this been going on?');
        expect(text).toContain('How does this compare to earlier in your life?');
        expect(text).toContain('Have you talked to a doctor about it?');
    });

    test('QUESTION 2 ADAPTS TO THE CONCERN', () => {
        const where = ownScript.match(/var WHERE = \{([\s\S]*?)\n  \};/)[1];
        for (const branch of ['erection', 'timing', 'pain', 'conditioning', 'unsure']) {
            expect(where, `no options for ${branch}`).toMatch(new RegExp(`\\b${branch}: \\[`));
        }
        /* The branches are genuinely different, not the same list relabelled. */
        expect(where).toContain('Some positions get uncomfortable');
        expect(where).toContain('During or after sex');
    });

    test('QUESTION 4 ASKS THE TIMING BRANCH ABOUT HISTORY, NOT DURATION', () => {
        /* Duration cannot establish whether ejaculation difficulty is
           lifelong or acquired. A man who has had it since his first
           experiences and only began minding it last month reads as a
           recent change. The timing branch asks the comparison directly. */
        const d = ownScript.match(/var DURATION = \{([\s\S]*?)\n  \};/)[1];
        expect(d).toContain("['changed_recent'");
        expect(d).toContain("['changed_long'");
        expect(d).toContain("['unsure_history'");
        expect(d).toMatch(/used to be satisfactory, and changed/);
        expect(d).toMatch(/since I became sexually active/);
        /* And the generic duration options survive for every other branch. */
        expect(d).toContain("['lt1m'");
        expect(d).toContain("['gt6m'");
    });

    test('THE ACQUIRED RULE READS THE REPORTED CHANGE, NEVER THE DURATION', () => {
        const rules = ownScript.match(/var RULES = \[([\s\S]*?)\n  \];/)[1];
        const acquired = rules.match(/id: 'timing_acquired'[\s\S]*?\} \},/)[0];
        expect(acquired).toContain("a.duration === 'changed_recent'");
        expect(acquired).toContain("a.duration === 'changed_long'");
        /* The bug this replaced: inferring "acquired" from a short duration. */
        expect(acquired, 'the acquired rule still reads a plain duration')
            .not.toMatch(/'lt1m'|'1to6m'|'gt6m'/);
        const lifelong = rules.match(/id: 'timing_lifelong'[\s\S]*?\} \},/)[0];
        expect(lifelong).toContain("a.duration === 'always'");
        /* And an unestablished history falls to the neutral result. */
        expect(rules.indexOf("id: 'timing_general'"))
            .toBeGreaterThan(rules.indexOf("id: 'timing_lifelong'"));
    });

    test('EVERY RESULT THAT NAMES A PATTERN ALSO QUALIFIES IT', () => {
        /* The acquired result is the one that repeats back something the
           visitor told us, so it is the one that most needs to say what it
           has and has not established. */
        const results = ownScript.match(/var RESULTS = \{([\s\S]*?)\n  \};/)[1];
        const acq = results.match(/\n    timing_acquired: \{([\s\S]*?)\n    \},/)[1];
        expect(acq, 'the acquired result lost its qualifier')
            .toContain('Only a clinician can confirm it');
        expect(acq).toMatch(/You told us this used to be satisfactory and then changed/);
    });

    test('the neutral timing result claims neither pattern', () => {
        const results = ownScript.match(/var RESULTS = \{([\s\S]*?)\n  \};/)[1];
        const g = results.match(/\n    timing_general: \{([\s\S]*?)\n    \},/)[1];
        expect(g).toContain("verdict: 'Ejaculation timing concerns'");
        expect(g).toMatch(/did not establish which applies to you/);
        expect(g).toMatch(/does not assume either/);
        expect(g).toMatch(/Take the history question to a clinician/);
    });

    test('question 3 is skipped where it has no bearing', () => {
        const q = ownScript.match(/key: 'morning',[\s\S]*?when: function \(\) \{([\s\S]*?)\},/)[1];
        expect(q).toContain("['erection', 'timing', 'unsure']");
        expect(q).not.toContain("'pain'");
        expect(q).not.toContain("'conditioning'");
    });

    test('EVERY QUESTION CAN BE SKIPPED', () => {
        expect(src).toContain('id="skip"');
        expect(src).toContain('Skip this question');
        /* Skipping clears the answer rather than leaving a stale one. */
        expect(ownScript).toMatch(/\$\('skip'\)\.addEventListener\('click', function \(\) \{\s*delete answers\[/);
    });

    test('and a skipped path still reaches a result', () => {
        /* Every rule chain ends in a catch-all, so an all-skipped run cannot
           fall through to nothing. */
        const rules = ownScript.match(/var RULES = \[([\s\S]*?)\n  \];/)[1];
        expect(rules).toMatch(/test: function \(\) \{ return true; \}/);
        expect(ownScript).toMatch(/return 'erection_mixed';/);
    });
});

/* ──────────────────────────────────────────────────────────── results ── */

const PROFILES = ['urgent', 'pelvic', 'erection_physical', 'erection_situational',
    'erection_mixed', 'timing_acquired', 'timing_general', 'timing_lifelong',
    'conditioning'];

describe('every result profile', () => {
    const results = ownScript.match(/var RESULTS = \{([\s\S]*?)\n  \};/)[1];

    test('ALL EIGHT EXIST AND ARE REACHABLE', () => {
        const rules = ownScript.match(/var RULES = \[([\s\S]*?)\n  \];/)[1];
        for (const p of PROFILES) {
            expect(results, `no result for ${p}`).toMatch(new RegExp(`\\n    ${p}: \\{`));
            expect(rules, `${p} is unreachable`).toContain(`id: '${p}'`);
        }
    });

    test('each gives a verdict, an explanation, and EXACTLY TWO free actions', () => {
        const blocks = results.split(/\n    (?=\w+: \{)/).filter(b => /verdict:/.test(b));
        expect(blocks.length).toBe(PROFILES.length);
        for (const b of blocks) {
            const name = b.match(/^(\w+):/)[1];
            expect(b, `${name} has no verdict`).toMatch(/verdict: '[^']{20,}'/);
            expect(b, `${name} has no explanation`).toMatch(/body: \[/);
            const actions = [...b.matchAll(/\n        \['/g)].length;
            expect(actions, `${name} offers ${actions} actions, needs 2`).toBe(2);
        }
    });

    test('THE EXPLANATIONS CARRY UNCERTAINTY RATHER THAN VERDICTS', () => {
        /* Nothing may tell a visitor what he has. */
        /* Adjectives between "you have" and the condition slipped past the
           first version of this list. A mutation replaced a qualifier with
           "This confirms you have acquired premature ejaculation" and
           survived, which is a page telling a man his diagnosis. */
        for (const re of [
            /\byou (have|had|are showing)\b[^.!?]{0,30}\b(diabetes|erectile dysfunction|premature ejaculation|pelvic floor dysfunction|an? infection)\b/i,
            /\bconfirms?\b[^.!?]{0,20}\byou (have|are)\b/i,
            /\bthis means you\b/i, /\bdiagnos(is|ed|es)\b[^.!?]{0,20}\byou\b/i,
            /\byou are suffering from\b/i, /\bwhat you have is\b/i,
        ]) {
            const m = results.match(re);
            expect(m, `diagnostic claim "${m && m[0]}" appears in a result`).toBeNull();
        }
        /* And the hedging language is actually present. */
        expect(results).toMatch(/cannot (rule out|establish)/i);
        expect(results).toMatch(/does not mean you have/i);
    });

    test('free actions never require a purchase or an account', () => {
        const blocks = results.match(/actions: \[([\s\S]*?)\n      \]/g).join(' ');
        for (const re of [/\/whats-inside\//, /\/app\//, /sign up/i, /subscribe/i,
                          /\bbuy\b/i, /\baccount\b/i]) {
            expect(re.test(blocks), `${re} appears in a free action`).toBe(false);
        }
    });

    test('and the urgent result offers no exercise at all', () => {
        const urgent = results.match(/\n    urgent: \{([\s\S]*?)\n    \},/)[1];
        expect(urgent).toContain('urgent: true');
        expect(urgent).toContain('guides: []');
        expect(urgent).toMatch(/deliberately not suggesting exercises/i);
        expect(urgent).toMatch(/Contact a clinician today/);
    });
});

/* ─────────────────────────────────────────────────────── medical logic ── */

describe('medical safety logic', () => {
    test('LAYER 1: THE URGENT RULE IS EVALUATED FIRST AND CANNOT BE OUTRANKED', () => {
        const rules = ownScript.match(/var RULES = \[([\s\S]*?)\n  \];/)[1];
        const ids = [...rules.matchAll(/id: '(\w+)'/g)].map(m => m[1]);
        expect(ids[0], 'urgent is not the first rule').toBe('urgent');
        expect(rules).toMatch(/id: 'urgent', test: function \(a\) \{ return a\.where === 'urinating'; \}/);
        /* First match wins, so order is the guarantee. */
        expect(ownScript).toMatch(/for \(var i = 0; i < RULES\.length; i\+\+\) if \(RULES\[i\]\.test\(a\)\) return RULES\[i\]\.id;/);
    });

    test('the red flag is reachable from the question that carries it', () => {
        const where = ownScript.match(/var WHERE = \{([\s\S]*?)\n  \};/)[1];
        expect(where).toContain("['urinating', 'When passing urine, or there is blood in my urine or semen']");
    });

    test('LAYER 2: AN UNEXAMINED LONG-STANDING PROBLEM GETS AN ADDED STEER', () => {
        const fn = ownScript.match(/function steer\(a\) \{([\s\S]*?)\n  \}/)[1];
        expect(fn).toContain("a.duration === 'gt6m'");
        expect(fn).toContain("a.duration === 'always'");
        expect(fn).toContain("a.seen === 'no'");
        expect(fn).toContain("a.seen === 'mentioned'");
        expect(ownScript).toMatch(/if \(!r\.urgent && steer\(answers\)\)/);
        expect(ownScript).toMatch(/that is worth an appointment/);
    });

    test('LAYER 3: EVERY RESULT CARRIES THE URGENT SIGNS AND THE CANNOT-DIAGNOSE LINE', () => {
        /* Built unconditionally into show(), not per profile, so no profile
           can be added later that quietly omits them. */
        const show = ownScript.match(/function show\(id\) \{([\s\S]*?)\n  \}/)[1];
        expect(show).toContain('URGENT_SIGNS.map');
        /* Visible, not merely present. Wrapping either block in `hidden`
           keeps the text in the source and takes it off the screen. */
        expect(show).toMatch(/html \+= '<div class="a-red">/);
        expect(show).toMatch(/html \+= '<div class="limits">/);
        expect(show).toMatch(/whatever this result said/);
        const flat = show.replace(/'\s*\+\s*'/g, '');
        expect(flat).toMatch(/cannot diagnose erectile dysfunction, premature ejaculation, pelvic floor dysfunction or any other condition/);
        /* No conditional wraps either block. */
        expect(show).not.toMatch(/if \([^)]*\)\s*\{?\s*html \+= '<div class="a-red"/);
    });

    test('the urgent signs list is complete', () => {
        const signs = ownScript.match(/var URGENT_SIGNS = \[([\s\S]*?)\n  \];/)[1];
        for (const s of ['blood in your urine or semen', 'Sudden severe testicular pain',
                         'unable to pass urine', 'more than four hours',
                         'Fever alongside pelvic or testicular pain', 'new lump']) {
            expect(signs, `missing urgent sign: ${s}`).toContain(s);
        }
    });

    test('the page says it cannot diagnose, before any question is answered', () => {
        const text = prose(src);
        expect(text).toMatch(/It cannot diagnose erectile dysfunction, premature ejaculation, pelvic floor dysfunction or any other condition/);
        expect(src, 'no medical note').toMatch(/class="note[^"]*"/);
    });

    test('and the pelvic result refuses to prescribe strengthening', () => {
        const pelvic = ownScript.match(/\n    pelvic: \{([\s\S]*?)\n    \},/)[1];
        expect(pelvic).toMatch(/Kegel exercises can make symptoms worse/);
        expect(pelvic).toMatch(/symptoms cannot establish which one it is/);
        expect(pelvic).toMatch(/strengthening is left out on purpose/);
    });
});

/* ───────────────────────────────────────────────── page and integration ── */

describe('the page behaves like the rest of the site', () => {
    test('one inline stylesheet, no external one, no font CDN', () => {
        expect([...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].length).toBe(1);
        expect(/<link[^>]+rel=["']?stylesheet/i.test(src)).toBe(false);
        expect(/fonts\.googleapis|fonts\.gstatic|cdnjs|unpkg/i.test(src)).toBe(false);
    });

    test('IT CARRIES THE SHARED DESIGN SYSTEM, BYTE FOR BYTE', () => {
        const want = read('tools/guide.css').trim();
        const got = src.match(/\/\* GUIDE-CSS:START \*\/([\s\S]*?)\/\* GUIDE-CSS:END \*\//);
        expect(got, 'no guide stylesheet block').not.toBeNull();
        expect(got[1].trim()).toBe(want);
    });

    test('canonical, title, one h1, Open Graph', () => {
        expect(src).toContain('<link rel="canonical" href="https://theblueprint.site/assessment/">');
        expect(src).toContain('<title>What Should I Work On? | The Blueprint</title>');
        expect([...src.matchAll(/<h1[\s>]/g)].length).toBe(1);
        expect(src).toContain('<meta property="og:url" content="https://theblueprint.site/assessment/">');
    });

    test('it is registered everywhere a page has to be', () => {
        /* PAGES specifically. The name also appears in STYLED, so grepping
           the whole file passes even after it is dropped from the list that
           actually drives the header and the sitemap. A mutation found
           that. */
        const sync = read('tools/sync-site-nav.mjs');
        const pages = sync.match(/export const PAGES = \[([\s\S]*?)\];/)[1];
        expect(pages, 'not in PAGES').toContain("'assessment/index.html'");
        const styled = sync.match(/export const STYLED = ([^;]*);/)[1];
        expect(styled, 'not in STYLED').toContain("'assessment/index.html'");
        expect(read('tests/siteNav.test.js')).toContain("'assessment/index.html'");
        expect(read('tests/e2e/site-nav.test.js')).toContain("'/assessment/index.html'");
        expect(read('sitemap.xml')).toContain('<loc>https://theblueprint.site/assessment/</loc>');
    });

    test('THE LEARNING CENTER AND EVERY GUIDE LINK TO IT', () => {
        expect(read('learn/index.html')).toContain('href="/assessment/"');
        for (const g of ['performance-anxiety-erections', 'blood-sugar-erections',
                         'hydration-erections', 'pelvic-floor-premature-ejaculation',
                         'hip-mobility-sexual-performance', 'improve-sexual-stamina']) {
            expect(read(`${g}/index.html`), `${g} does not link the assessment`)
                .toContain('href="/assessment/"');
        }
    });

    test('every guide it recommends exists', () => {
        const map = ownScript.match(/var GUIDE = \{([\s\S]*?)\n  \};/)[1];
        const hrefs = [...map.matchAll(/\['(\/[a-z-]+\/)'/g)].map(m => m[1]);
        expect(hrefs.length).toBe(6);
        for (const h of hrefs) {
            expect(existsSync(path.join(ROOT, h.replace(/^\//, ''), 'index.html')),
                `${h} does not resolve`).toBe(true);
        }
    });

    test('the price is $49 one-time, stated once, and the offer is last', () => {
        const show = ownScript.match(/function show\(id\) \{([\s\S]*?)\n  \}/)[1];
        expect((ownScript.match(/\$49/g) || []).length).toBe(1);
        expect(show).toContain('$49 one-time access.');
        expect(show).toContain('Build a plan around your goals');
        expect(show).toMatch(/Everything suggested above is free and needs none of it/);
        /* Education first: the offer is appended after the actions, the
           guides, the red flags and the limits. */
        expect(show.indexOf('a-actions')).toBeLessThan(show.indexOf('class="offer"'));
        expect(show.indexOf('a-red')).toBeLessThan(show.indexOf('class="offer"'));
        expect(show.indexOf('class="limits"')).toBeLessThan(show.indexOf('class="offer"'));
    });

    test('it works without JavaScript, at least as a signpost', () => {
        const ns = src.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
        expect(ns).toContain('href="/learn/"');
        expect([...ns.matchAll(/href="\/[a-z-]+\/"/g)].length).toBeGreaterThanOrEqual(6);
    });

    test('American English, no em dashes, no contrast constructions', () => {
        const text = prose(src.replace(/\/\* GUIDE-CSS:START \*\/[\s\S]*?\/\* GUIDE-CSS:END \*\//, ' ')
            .replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, ' '));
        const all = text + ' ' + ownScript;
        for (const ch of ['—', '–', '⸺', '⸻']) {
            expect(all.includes(ch), `${JSON.stringify(ch)} appears`).toBe(false);
        }
        for (const re of [/\brecognis(e|ed|es|ing|able)\b/i, /\bbehaviour(s|al)?\b/i,
                          /\bprogramme(s)?\b/i, /\bpractis(e|ed|es|ing)\b/i,
                          /\bcounselling\b/i, /\bcolour(s|ed)?\b/i]) {
            expect(re.test(all), `British spelling ${re}`).toBe(false);
        }
        for (const re of [/\bnot just\b/i, /\bnot merely\b/i, /\bbut rather\b/i,
                          /\b(is|are) not\b[^.!?]{0,90}\.\s*(It|They|That|This)\s+(is|are)\s+(?!not\b)/]) {
            expect(re.test(all), `contrast construction ${re}`).toBe(false);
        }
    });
});

/* ─────────────────────────────────────────────────────── the spec itself ── */

describe('the specification is written down and matches', () => {
    test('EVERY PROFILE IN THE CODE IS DOCUMENTED', () => {
        for (const p of PROFILES) {
            expect(doc, `the spec omits ${p}`).toContain(`\`${p}\``);
        }
    });

    test('the spec records the privacy design and the three safety layers', () => {
        expect(doc).toContain('## Privacy');
        expect(doc).toContain('## Medical safety logic');
        expect(doc).toMatch(/Layer 1, the urgent rule/);
        expect(doc).toMatch(/Layer 2, the evaluation steer/);
        expect(doc).toMatch(/Layer 3, the constant floor/);
        expect(doc).toMatch(/localStorage/);
    });

    test('and the five question keys are documented', () => {
        for (const k of ['concern', 'where', 'morning', 'duration', 'seen']) {
            expect(doc, `the spec omits question key ${k}`).toContain(`(\`${k}\`)`);
        }
    });
});
