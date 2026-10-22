import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE LEARNING CENTRE CONTENT STANDARD, ENFORCED.
 *
 * docs/learning-centre-content-standard.md is the prose version. This file
 * is the half of it a machine can hold. Add a guide to GUIDES below and the
 * whole standard applies to it: shape, free action plan, references,
 * claims, price, language, page mechanics.
 *
 * Each hub lists the questions it covers. Until the first guide shipped,
 * every one of those was plain text under "guides are being prepared", so
 * the hub could not be wrong. The moment a question becomes a link, things
 * can go wrong silently that no browser will throw on:
 *
 *   1. the hub links a guide that does not exist, or still claims every
 *      guide is pending while one is published;
 *   2. the page loses the two statements that have to travel with this
 *      subject matter: that the app does not diagnose or treat, and that
 *      persistent difficulty belongs with a clinician;
 *   3. the free exercise quietly starts requiring the app, which turns the
 *      one section a non-buyer can use into another advertisement;
 *   4. a reference rots, or cites a domain nobody should be taking medical
 *      claims from;
 *   5. the price drifts, and now it lives in two files.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Government health bodies, national health services, medical schools and
 *  major clinical nonprofits. Adding one is a deliberate edit here, not
 *  something a new guide does on its way past. */
const CREDIBLE_DOMAINS = [
    'www.niddk.nih.gov', 'www.nhs.uk', 'www.mayoclinic.org', 'www.heart.org',
    'my.clevelandclinic.org', 'www.urologyhealth.org', 'medlineplus.gov',
    'www.ncbi.nlm.nih.gov', 'www.cdc.gov',
];

const GUIDES = [{
    name: 'why hard alone but not during sex',
    slug: '/performance-anxiety-erections/',
    file: 'performance-anxiety-erections/index.html',
    hub: 'stronger-erections/index.html',
    hubQuestion: 'Why can I get hard alone but lose it during sex?',
    hubQuestionCount: 5,
    title: 'Why Can I Get Hard Alone but Lose It During Sex?',
    /* Section 5 of the standard, the free action plan, by its heading. */
    actionPlan: '6. Try This: Your 7-Day Erection Consistency Check',
    /* What the daily checklist has to cover. */
    observations: ['Sleep', 'Stress', 'Morning erection', 'Situation', 'Worry'],
    sections: [
        '1. Why your erections may be different with a partner',
        '2. How one bad experience can affect the next',
        '3. What your erections during masturbation can tell you',
        '4. What to try during your next sexual encounter',
        '5. Pay attention to your health outside the bedroom',
        '6. Try This: Your 7-Day Erection Consistency Check',
        '7. When should you see a doctor?',
        '8. Where this information comes from',
        '9. Your next step',
    ],
    features: [
        'Guided sessions focused on sexual stamina and pelvic floor awareness.',
        'Erection quality and progress tracking.',
        'Breathing and recovery exercises.',
        'Goal-based scheduling.',
        'In-app guidance from Coach Tee.',
    ],
}];

/** The page's own CSS, with the shared header block taken back out. */
function pageCss(src) {
    const blocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
    return blocks.join('\n')
        .replace(/\/\* SITE-NAV:START \*\/[\s\S]*?\/\* SITE-NAV:END \*\//, '');
}

/** Visible text: tags, the inline header script and the stylesheet removed. */
function prose(src) {
    return src
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
}

/** One <section> by its h2, markup intact. */
function section(src, heading) {
    const i = src.indexOf(`<h2>${heading}</h2>`);
    if (i === -1) return null;
    const start = src.lastIndexOf('<section', i);
    const end = src.indexOf('</section>', i);
    return src.slice(start, end);
}

for (const g of GUIDES) {
    const src = read(g.file);
    const text = prose(src);

    describe(`${g.name}: the hub and the guide agree with each other`, () => {
        test('THE HUB LINKS THE GUIDE, AT THE GUIDE’S REAL URL', () => {
            const hub = read(g.hub);
            const links = [...hub.matchAll(/<li><a href="([^"]+)">/g)].map(m => m[1]);
            expect(links, 'the question is not linked').toContain(g.slug);
            expect(existsSync(path.join(ROOT, g.file)), `${g.file} missing`).toBe(true);
        });

        test('the published question is the first one on the list', () => {
            /* The hub is ordered. Publishing the first question and linking
               the third would read as the list being shuffled. */
            const list = read(g.hub).match(/<ul class="guide-list">([\s\S]*?)<\/ul>/)[1];
            const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
            expect(items.length).toBe(g.hubQuestionCount);
            expect(items[0]).toContain(`href="${g.slug}"`);
            expect(items[0]).toContain(g.hubQuestion);
        });

        test('and the hub no longer says every guide is still being prepared', () => {
            const hub = read(g.hub);
            expect(hub, 'the blanket pending claim is now false')
                .not.toContain('Detailed educational guides are being prepared for these topics.');
            expect(hub).toContain('Guides for the remaining topics are being prepared.');
        });

        test('each unpublished question stays plain text, not a dead link', () => {
            const list = read(g.hub).match(/<ul class="guide-list">([\s\S]*?)<\/ul>/)[1];
            expect([...list.matchAll(/href="([^"]+)"/g)].map(m => m[1])).toEqual([g.slug]);
        });

        test('THE OLD PRE-RELEASE URL IS GONE FROM THE REPOSITORY', () => {
            /* The guide was first written under /stronger-erections/..., was
               never deployed, and was renamed before release. Nothing may
               still point at the dead path, and because nothing published
               ever did, no redirect is owed. */
            const dead = 'why-hard-alone-but-lose-it-during-sex';
            for (const f of ['tools/sync-site-nav.mjs', 'tests/siteNav.test.js',
                             'tests/e2e/site-nav.test.js', g.hub, g.file]) {
                expect(read(f).includes(dead), `${f} still references the old path`).toBe(false);
            }
            expect(existsSync(path.join(ROOT, 'stronger-erections', dead))).toBe(false);
        });

        test('the guide links back to the hub and to Learn', () => {
            const crumb = src.match(/<p class="crumb">([\s\S]*?)<\/p>/);
            expect(crumb, 'no breadcrumb').not.toBeNull();
            expect(crumb[1]).toContain('href="/learn/"');
            expect(crumb[1]).toContain(`href="/${g.hub.replace('/index.html', '')}/"`);
        });
    });

    describe(`${g.name}: the shape the standard requires`, () => {
        test('THE SECTIONS ARE ALL PRESENT AND IN ORDER', () => {
            const h2 = [...src.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]);
            expect(h2.slice(0, g.sections.length)).toEqual(g.sections);
        });

        test('the free action plan comes before the medical section', () => {
            /* Standard order: practical instructions, then the free plan,
               then when evaluation matters, then references. A free plan
               printed after "see a doctor" is a plan nobody reaches. */
            const at = (h) => src.indexOf(`<h2>${h}</h2>`);
            const plan = at(g.actionPlan);
            const doctor = g.sections.find(s => /see a doctor/i.test(s));
            const refs = g.sections.find(s => /where this information comes from/i.test(s));
            expect(plan).toBeGreaterThan(-1);
            expect(plan).toBeLessThan(at(doctor));
            expect(at(doctor)).toBeLessThan(at(refs));
        });

        test('it tells the reader when to see a doctor, with named circumstances', () => {
            const s = section(src, g.sections.find(x => /see a doctor/i.test(x)));
            expect(s, 'no doctor section').not.toBeNull();
            const items = [...s.matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1]);
            expect(items.length, 'a disclaimer instead of a list').toBeGreaterThanOrEqual(4);
        });
    });

    describe(`${g.name}: the free action plan works without buying anything`, () => {
        const plan = section(src, g.actionPlan);
        const planText = prose(plan || '');

        test('THE EXERCISE NEEDS NO PURCHASE, NO ACCOUNT AND NO PERSONAL DATA', () => {
            expect(plan, 'the action plan section is missing').not.toBeNull();
            expect(planText).toMatch(/nothing to buy/i);
            expect(planText).toMatch(/nothing to sign up for/i);
            expect(planText).toMatch(/no personal information/i);
            /* And it must not quietly require the app to run it. */
            expect(plan, 'the free exercise links into the funnel')
                .not.toMatch(/href="\/(whats-inside|how-it-works|app)\/"/);
            expect(plan).not.toMatch(/class="cta"/);
        });

        test('it is a daily checklist covering every observation it promises', () => {
            const items = [...plan.matchAll(/<li><strong>([^<]*)<\/strong>/g)].map(m => m[1]);
            expect(items).toEqual(g.observations);
        });

        test('and it says how to review the week afterward', () => {
            expect(plan, 'no review step').toMatch(/<h3>After seven days, read it back<\/h3>/);
            const review = plan.slice(plan.indexOf('After seven days'));
            const qs = [...review.matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1]);
            expect(qs.length, 'nothing to look for').toBeGreaterThanOrEqual(3);
        });

        test('IT STATES THAT THE OBSERVATIONS CANNOT DIAGNOSE THE CAUSE', () => {
            /* The single most important sentence in the section. A week of
               self-observation that reads as a test is how a man talks
               himself out of an appointment. */
            expect(planText).toMatch(/cannot diagnose the cause of erection difficulties/i);
            expect(planText).toMatch(/not a test/i);
            expect(planText, 'a clean week must not read as reassurance')
                .toMatch(/not a reason to delay an appointment/i);
        });
    });

    describe(`${g.name}: the references hold up the health claims`, () => {
        const refs = section(src, g.sections.find(x => /where this information comes from/i.test(x)));

        test('EVERY REFERENCE IS A CREDIBLE MEDICAL SOURCE OVER HTTPS', () => {
            expect(refs, 'no references section').not.toBeNull();
            const links = [...refs.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
            expect(links.length, 'too few sources for a health article')
                .toBeGreaterThanOrEqual(5);
            for (const u of links) {
                const host = new URL(u).host;
                expect(u.startsWith('https://'), `${u} is not https`).toBe(true);
                expect(CREDIBLE_DOMAINS, `${host} is not an approved source`).toContain(host);
            }
        });

        test('each one names the claim it supports', () => {
            const rows = [...refs.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
            expect(rows.length).toBeGreaterThanOrEqual(5);
            for (const r of rows) {
                expect(r, 'a reference with no link').toMatch(/<a href="https:\/\//);
                const why = r.match(/<\/a><span>([^<]+)<\/span>/);
                expect(why, `reference has no supporting statement: ${r.slice(0, 70)}`).not.toBeNull();
                expect(why[1]).toMatch(/Supports (the introduction|section)/);
                expect(why[1].length).toBeGreaterThan(50);
            }
        });

        test('they leak neither referrer nor window, and announce the new tab', () => {
            /* noreferrer for the same reason this site has no font CDN. */
            const anchors = [...refs.matchAll(/<a href="https:\/\/[^"]+"([^>]*)>/g)].map(m => m[1]);
            for (const a of anchors) {
                expect(a, `missing rel: ${a}`).toContain('rel="noopener noreferrer"');
                expect(a).toContain('target="_blank"');
            }
            expect((refs.match(/class="sr-only"> \(opens in a new tab\)</g) || []).length)
                .toBe(anchors.length);
        });

        test('and the page cites no source it does not list', () => {
            /* An external link anywhere else in the article would be a claim
               with no entry in the reference list. */
            const external = [...src.replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, '')
                .matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
            const listed = [...refs.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
            expect([...new Set(external)].sort()).toEqual([...new Set(listed)].sort());
        });
    });

    describe(`${g.name}: what the guide is allowed to claim`, () => {
        test('IT CARRIES THE MEDICAL NOTE AND THE NOT-A-TREATMENT STATEMENT', () => {
            /* Both, on this page, next to the claim. Not in the footer of
               another page. */
            expect(text).toContain('It does not diagnose or treat erectile dysfunction.');
            expect(text).toMatch(
                /Persistent erection difficulties should be evaluated by a qualified healthcare professional/);
            expect(src, 'the medical note is not visually set apart')
                .toMatch(/class="note[^"]*"/);
        });

        test('it does not promise an outcome', () => {
            /* The copy is careful: "can", "may", "can help". A guarantee
               would be both a false claim and an FTC problem. */
            expect(text).toContain('They don’t guarantee an erection.');
            for (const banned of [/\bwill cure\b/i, /\bguaranteed\b/i, /\bfix your ED\b/i,
                                  /\bcures? erectile dysfunction\b/i, /\bproven to\b/i]) {
                expect(banned.test(text), `${banned} appears`).toBe(false);
            }
        });

        test('and it uses no em dashes', () => {
            for (const ch of ['—', '–', '⸺', '⸻']) {
                expect(src.includes(ch), `${JSON.stringify(ch)} appears`).toBe(false);
            }
        });
    });

    describe(`${g.name}: the price and the actions`, () => {
        test('THE PRICE IS $49 ONE-TIME, AND STILL STATED ONCE AS THE PRICE', () => {
            expect(text).toContain('$49 one-time access.');
            expect((text.match(/\$49/g) || []).length, 'the price is repeated').toBe(1);
            /* class="fig" is the home page's price figure, and
               tests/landingCss.test.js asserts there is exactly one of them.
               A second page using that class would not break that test,
               which is precisely why it is worth naming here. */
            expect(src).not.toContain('class="fig"');
            expect(src, 'no subscription language').not.toMatch(/\/mo\b|per month|monthly/i);
        });

        test('both calls to action keep their destinations, which exist', () => {
            const actions = src.match(/<div class="actions">([\s\S]*?)<\/div>/)[1];
            const hrefs = [...actions.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
            expect(hrefs).toEqual(['/whats-inside/', '/how-it-works/']);
            for (const h of hrefs) {
                expect(existsSync(path.join(ROOT, h.replace(/^\//, ''), 'index.html')),
                    `${h} does not resolve`).toBe(true);
            }
        });

        test('the "includes" list describes the app as it is', () => {
            /* Taken from the brief, with nothing added. Inventing a sixth
               here is how a page starts promising a feature nobody built. */
            const offer = src.match(/<div class="offer">([\s\S]*?)<\/div>\s*<p class="price">/)[1];
            expect([...offer.matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1])).toEqual(g.features);
        });
    });

    describe(`${g.name}: the same page rules as every other page`, () => {
        test('one inline stylesheet, no external one, no font CDN', () => {
            /* Paired blocks, not opening tags: the shared header's own
               comment contains the literal text "<style>" to explain why it
               is inlined, and counting that as a second stylesheet is a
               test defect. */
            expect([...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].length).toBe(1);
            expect(/<link[^>]+rel=["']?stylesheet/i.test(src)).toBe(false);
            expect(/fonts\.googleapis|fonts\.gstatic|cdnjs|unpkg/i.test(src)).toBe(false);
        });

        test('its canonical is its own path on theblueprint.site', () => {
            const m = src.match(/<link rel="canonical" href="([^"]+)"/);
            expect(m).not.toBeNull();
            expect(m[1]).toBe(`https://theblueprint.site${g.slug}`);
        });

        test('it has a title, one h1, and a description for the result page', () => {
            expect(src).toContain(`<title>${g.title} | The Blueprint</title>`);
            expect([...src.matchAll(/<h1[\s>]/g)].length).toBe(1);
            const d = src.match(/<meta name="description" content="([^"]+)"/);
            expect(d).not.toBeNull();
            expect(d[1].length).toBeGreaterThan(60);
            expect(d[1].length).toBeLessThan(200);
        });

        test('it is in the header sync list, so it cannot ship bare', () => {
            expect(read('tools/sync-site-nav.mjs')).toContain(`'${g.file}'`);
            expect(read('tests/siteNav.test.js')).toContain(`'${g.file}'`);
            expect(read('tests/e2e/site-nav.test.js')).toContain(`'/${g.file}'`);
        });

        test('every var(--x) it reads is a property it defines, and all are used', () => {
            /* The failure tests/landingCss.test.js was written for: a
               dropped declaration renders as whatever it inherited,
               silently. */
            const css = pageCss(src);
            const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1].toLowerCase()));
            const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map(m => m[1].toLowerCase());
            expect(used.length).toBeGreaterThan(15);
            expect([...new Set(used.filter(v => !declared.has(v)))]).toEqual([]);
            expect([...declared].filter(v => !used.includes(v))).toEqual([]);
        });
    });
}

describe('the standard itself is written down', () => {
    const doc = read('docs/learning-centre-content-standard.md');

    test('THE DOCUMENT EXISTS AND NAMES ALL EIGHT STAGES', () => {
        for (const stage of ['Direct answer', 'Possible causes', 'What to check',
                             'Practical instructions', 'Free action plan',
                             'When medical evaluation matters', 'Credible references',
                             'Relevant Blueprint next step']) {
            expect(doc, `the standard omits "${stage}"`).toContain(stage);
        }
    });

    test('it records the rules this file enforces, so the two cannot drift apart', () => {
        expect(doc).toContain('CREDIBLE_DOMAINS');
        expect(doc).toContain('tools/sync-site-nav.mjs');
        expect(doc).toContain('$49 one-time access.');
        expect(doc).toMatch(/No em dashes/);
    });

    test('and it does not itself use an em dash', () => {
        for (const ch of ['⸺', '⸻']) {
            expect(doc.includes(ch)).toBe(false);
        }
        /* The document quotes the characters it bans, inside backticks, so
           bare occurrences are what matter. */
        expect(doc.replace(/`[^`]*`/g, '').includes('—')).toBe(false);
    });
});
