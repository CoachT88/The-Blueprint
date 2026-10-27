import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRITISH_SPELLINGS, CONTRAST_CONSTRUCTIONS, context } from './prose.js';

/**
 * THE RESEARCH LAB.
 *
 * These pages describe practices that have never been tested, to an
 * audience that mostly wants to be told they work. That combination is why
 * the checks here are stricter than for a Learning Centre guide.
 *
 * The failures this file exists to catch:
 *
 *   1. an effectiveness claim creeping in, either directly or through the
 *      softer forms: "can help", "many men find", "may improve";
 *   2. an evidence label appearing without the prose that assesses the
 *      evidence, which turns a reasoning aid into a rating badge;
 *   3. a training protocol appearing, which is what separates describing a
 *      practice from teaching it;
 *   4. traction and compression being renamed as massage, which makes a
 *      mechanical load sound like a spa treatment;
 *   5. an invented study, percentage, testimonial or expert endorsement;
 *   6. the last-reviewed date going stale or disappearing.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const LANDING = 'research-lab/index.html';
const TOPIC = 'research-lab/manual-techniques/index.html';
const PAGES = [LANDING, TOPIC];

const LABELS = [
    ['ev-clinical', 'Supported by clinical evidence'],
    ['ev-prelim', 'Preliminary evidence'],
    ['ev-community', 'Community-reported, unverified'],
    ['ev-none', 'Insufficient evidence'],
];

/** Sources the Lab is allowed to cite. */
const CREDIBLE_DOMAINS = [
    'pubmed.ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov', 'www.niddk.nih.gov',
    'www.mayoclinic.org', 'www.nhs.uk', 'healthymale.org.au',
    'my.clevelandclinic.org', 'www.heart.org', 'orthoinfo.aaos.org',
    'www.urologyhealth.org', 'medlineplus.gov', 'www.cdc.gov',
];

const strip = (src) => src
    .replace(/\/\* GUIDE-CSS:START \*\/[\s\S]*?\/\* GUIDE-CSS:END \*\//, ' ')
    .replace(/\/\* RESEARCH-CSS:START \*\/[\s\S]*?\/\* RESEARCH-CSS:END \*\//, ' ')
    .replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, ' ');

const prose = (src) => strip(src)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('the Lab exists and is wired in', () => {
    test('BOTH PAGES EXIST AND CARRY THE SHARED SYSTEM', () => {
        const guide = read('tools/guide.css').trim();
        const research = read('tools/research.css').trim();
        for (const p of PAGES) {
            expect(existsSync(path.join(ROOT, p)), `${p} missing`).toBe(true);
            const src = read(p);
            const g = src.match(/\/\* GUIDE-CSS:START \*\/([\s\S]*?)\/\* GUIDE-CSS:END \*\//);
            const r = src.match(/\/\* RESEARCH-CSS:START \*\/([\s\S]*?)\/\* RESEARCH-CSS:END \*\//);
            expect(g, `${p} has no guide stylesheet`).not.toBeNull();
            expect(r, `${p} has no research stylesheet`).not.toBeNull();
            expect(g[1].trim(), `${p} guide CSS drifted`).toBe(guide);
            expect(r[1].trim(), `${p} research CSS drifted`).toBe(research);
        }
    });

    test('one inline stylesheet, no external one, no font CDN, no tracker', () => {
        for (const p of PAGES) {
            const src = read(p);
            expect([...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].length, p).toBe(1);
            expect(/<link[^>]+rel=["']?stylesheet/i.test(src), p).toBe(false);
            expect(/fonts\.googleapis|fonts\.gstatic|cdnjs|unpkg/i.test(src), p).toBe(false);
            expect(/gtag|googletagmanager|analytics|fbq|hotjar|mixpanel|segment/i.test(strip(src)), p)
                .toBe(false);
        }
    });

    test('canonical, title, one h1, Open Graph and breadcrumbs', () => {
        for (const [p, slug, title] of [
            [LANDING, '/research-lab/', 'The Research Lab | The Blueprint'],
            [TOPIC, '/research-lab/manual-techniques/', 'Manual Techniques | The Research Lab | The Blueprint'],
        ]) {
            const src = read(p);
            expect(src).toContain(`<link rel="canonical" href="https://theblueprint.site${slug}">`);
            expect(src).toContain(`<title>${title}</title>`);
            expect([...src.matchAll(/<h1[\s>]/g)].length, p).toBe(1);
            expect(src).toContain(`<meta property="og:url" content="https://theblueprint.site${slug}">`);
            const crumb = src.match(/<p class="crumb">([\s\S]*?)<\/p>/);
            expect(crumb, `${p} has no breadcrumb`).not.toBeNull();
            expect(crumb[1]).toContain('href="/learn/"');
        }
        /* The topic page sits under the landing page and says so. */
        expect(read(TOPIC).match(/<p class="crumb">([\s\S]*?)<\/p>/)[1])
            .toContain('href="/research-lab/"');
    });

    test('THE SITEMAP AND PAGE REGISTRIES CARRY BOTH URLS', () => {
        const xml = read('sitemap.xml');
        const sync = read('tools/sync-site-nav.mjs');
        const pages = sync.match(/export const PAGES = \[([\s\S]*?)\];/)[1];
        for (const [p, slug] of [[LANDING, '/research-lab/'],
                                 [TOPIC, '/research-lab/manual-techniques/']]) {
            expect(xml, `sitemap missing ${slug}`).toContain(`<loc>https://theblueprint.site${slug}</loc>`);
            expect(sync.match(/export const RESEARCH = \[([\s\S]*?)\];/)[1]).toContain(`'${p}'`);
            expect(pages.includes(`'${p}'`) || pages.includes('...RESEARCH'),
                `${p} not reachable from PAGES`).toBe(true);
            expect(read('tests/siteNav.test.js'), `${p} not in the nav suite`).toContain(`'${p}'`);
            expect(read('tests/e2e/site-nav.test.js')).toContain(`'/${p}'`);
        }
    });

    test('the Learning Center offers the Lab, and the Lab links back', () => {
        expect(read('learn/index.html')).toContain('href="/research-lab/"');
        expect(read(LANDING)).toContain('href="/research-lab/manual-techniques/"');
        expect(read(LANDING)).toContain('href="/learn/"');
        expect(read(TOPIC)).toContain('href="/research-lab/"');
    });

    test('every internal link resolves to a real page', () => {
        for (const p of PAGES) {
            const hrefs = [...strip(read(p)).matchAll(/href="(\/[a-z0-9-/]*\/)"/g)].map(m => m[1]);
            expect(hrefs.length).toBeGreaterThan(2);
            for (const h of new Set(hrefs)) {
                expect(existsSync(path.join(ROOT, h.replace(/^\//, ''), 'index.html')),
                    `${p} links ${h}, which does not exist`).toBe(true);
            }
        }
    });
});

describe('evidence labels are reasoning aids, not ratings', () => {
    test('ALL FOUR ARE DEFINED ON THE LANDING PAGE', () => {
        const src = read(LANDING);
        const key = src.match(/<ul class="ev-key">([\s\S]*?)<\/ul>/);
        expect(key, 'no evidence key').not.toBeNull();
        for (const [cls, text] of LABELS) {
            expect(key[1], `${text} is not defined`).toContain(`class="ev ${cls}"`);
            expect(key[1]).toContain(text);
        }
        /* Each definition explains what the label means, at length. */
        const items = [...key[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
        expect(items.length).toBe(4);
        for (const i of items) {
            const body = i.replace(/<span[\s\S]*?<\/span>/, '').replace(/<[^>]+>/g, '').trim();
            expect(body.length, 'a label definition is too thin to be useful')
                .toBeGreaterThan(180);
        }
    });

    test('the page says a label is not a substitute for assessment', () => {
        const t = prose(read(LANDING));
        expect(t).toMatch(/It is not a score, it is not a rating/);
        expect(t).toMatch(/never appears without prose underneath it/);
        expect(prose(read(TOPIC))).toMatch(/A label is never the assessment/);
    });

    test('EVERY LABEL USE SITS WITH PROSE THAT ASSESSES THE EVIDENCE', () => {
        /* A badge with nothing after it is a rating. The thing that makes
           these honest is the paragraph underneath. */
        const src = read(TOPIC);
        const uses = [...src.matchAll(/<span class="ev ev-\w+">[^<]+<\/span>/g)];
        expect(uses.length, 'no labels used on the topic page').toBeGreaterThanOrEqual(6);
        for (const m of uses) {
            const after = src.slice(m.index + m[0].length, m.index + m[0].length + 600);
            /* Skip the compact legend, which is explicitly a recap. */
            if (after.trimStart().startsWith('<span class="ev')) continue;
            const text = after.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            expect(text.length, `a label has no assessment after it: ${m[0]}`)
                .toBeGreaterThan(120);
        }
    });

    test('and no label is used as a score', () => {
        for (const p of PAGES) {
            const t = prose(read(p));
            for (const re of [/\b\d\s*(out of|\/)\s*\d\s*(stars?|rating)/i, /\brated\b/i,
                              /\bscore of\b/i, /\bgrade [A-D]\b/]) {
                expect(re.test(t), `${p} scores a label: ${re}`).toBe(false);
            }
        }
    });
});

describe('the topic page covers every method as required', () => {
    const src = read(TOPIC);
    const cards = [...src.matchAll(/<div class="method">([\s\S]*?)<\/div>\s*(?=<div class="method">|<\/section>)/g)]
        .map(m => m[1]);

    test('ALL FOUR METHODS ARE PRESENT', () => {
        expect(cards.length).toBe(4);
        const names = cards.map(c => c.match(/<h3>([^<]*)<\/h3>/)[1]);
        expect(names).toEqual(['Directional pulls', 'V-stretch', 'Wet jelq', 'Uli']);
    });

    test('each one answers all six required questions', () => {
        for (const c of cards) {
            const name = c.match(/<h3>([^<]*)<\/h3>/)[1];
            const hs = [...c.matchAll(/<h4>([^<]*)<\/h4>/g)].map(m => m[1]);
            expect(hs, `${name} is missing a required section`).toEqual([
                'What it generally involves',
                'Why men are interested',
                'What men report',
                'What published research establishes',
                'Risks',
                'What remains unknown',
            ]);
        }
    });

    test('each names its actual mechanics rather than calling it massage', () => {
        /* Traction is traction and compression is compression. The page may
           mention the word massage only to reject it. */
        for (const c of cards) {
            const name = c.match(/<h3>([^<]*)<\/h3>/)[1];
            const alias = c.match(/<span class="alias">([^<]*)<\/span>/);
            expect(alias, `${name} has no mechanical description`).not.toBeNull();
            expect(/traction|compression/i.test(alias[1]),
                `${name} alias does not name the mechanics: ${alias[1]}`).toBe(true);
        }
        const t = prose(src);
        expect(t).toMatch(/Some call these activities massage exercises/);
        expect(t).toMatch(/Directional pulls apply traction/);
        expect(t).toMatch(/wet jelqing use compression and pressure/);
    });

    test('REPORTED EXPERIENCE IS ALWAYS LABELLED ANECDOTAL', () => {
        for (const c of cards) {
            const name = c.match(/<h3>([^<]*)<\/h3>/)[1];
            const i = c.indexOf('<h4>What men report</h4>');
            const section = c.slice(i, c.indexOf('<h4>', i + 10));
            expect(section, `${name} reports experience without the label`)
                .toContain('class="ev ev-community"');
        }
        expect(prose(src)).toMatch(/nobody measured anything|unverified/i);
    });

    test('and both positive and negative reports are given', () => {
        for (const c of cards) {
            const name = c.match(/<h3>([^<]*)<\/h3>/)[1];
            const i = c.indexOf('<h4>What men report</h4>');
            const section = prose(c.slice(i, c.indexOf('<h4>', i + 10)));
            expect(section, `${name} omits positives`).toMatch(/Reported positives/);
            expect(section, `${name} omits negatives`).toMatch(/Reported negatives/);
        }
    });

    test('risks separate what is documented from what is plausible', () => {
        for (const c of cards) {
            const name = c.match(/<h3>([^<]*)<\/h3>/)[1];
            const i = c.indexOf('<h4>Risks</h4>');
            const section = c.slice(i, c.indexOf('<h4>', i + 10));
            expect(section, `${name} has no documented risks`).toMatch(/<strong>Documented/);
            expect(section, `${name} has no plausible risks`).toMatch(/<strong>Plausible/);
        }
    });
});

describe('the page does not imply unverified effectiveness', () => {
    test('NO EFFECTIVENESS CLAIM, INCLUDING THE SOFT FORMS', () => {
        /* The hard claims are easy to avoid. These are the ones that slip
           in: hedged verbs that still leave a reader believing it works. */
        for (const p of PAGES) {
            const t = prose(read(p));
            for (const re of [
                /\b(these|this) (technique|practice|method)s? (can|will|does|do) (help|improve|increase|work)/i,
                /\bproven to (work|increase|improve)/i,
                /\bclinically proven\b/i,
                /\bmany men (find|report) (that )?(it|they) (work|help)/i,
                /\bresults? (are|is) typically\b/i,
                /\bsafe (when|if) (performed|done) (gently|correctly)/i,
                /\bgentle (enough|technique)s? (is|are) safe/i,
                /\bwill (increase|improve) (your )?(size|length|girth|erection)/i,
            ]) {
                const m = t.match(re);
                expect(m, `${p} implies effectiveness: "${m && m[0]}"`).toBeNull();
            }
        }
    });

    test('THE FOUR FORBIDDEN CLAIMS ARE EACH REFUSED EXPLICITLY', () => {
        const t = prose(read(TOPIC));
        /* Erection quality, blood flow, growth, and safe-if-gentle. */
        expect(t).toMatch(/Manual techniques improve erection quality/);
        expect(t).toMatch(/increase blood flow to the penis in a lasting way/);
        expect(t).toMatch(/produce permanent growth in length or girth/);
        expect(t).toMatch(/They are safe as long as you are gentle/);
        /* And each is answered with insufficient evidence. */
        const ledger = read(TOPIC).match(/<div class="ledger">([\s\S]*?)<\/div>\s*<\/section>/)[1];
        const rows = [...ledger.matchAll(/<div class="ledger-row">([\s\S]*?)(?=<div class="ledger-row">|$)/g)];
        expect(rows.length).toBe(4);
        for (const r of rows) {
            expect(r[1], 'a claim row has no evidence label').toContain('class="ev ev-none"');
            const real = r[1].match(/<div class="ledger-real">([\s\S]*?)<\/div>/);
            expect(real, 'a claim has no assessment').not.toBeNull();
        }
        expect(t, 'the safe-if-gentle claim is not named as dangerous')
            .toMatch(/the most dangerous claim on the page, because it sounds like caution/);
    });

    test('no protocol is published', () => {
        /* Describing a practice is not teaching it. Any dose is a protocol. */
        for (const p of PAGES) {
            const t = prose(read(p));
            for (const re of [/\b\d+\s*(reps|repetitions|sets)\b/i,
                              /\bfor \d+\s*(seconds|minutes) (each|per|at a time)\b/i,
                              /\b\d+\s*times (a|per) (day|week)\b/i,
                              /\bhold (it |the \w+ )?for \d+/i,
                              /\bstart with \d+/i, /\bwork up to \d+/i]) {
                const m = t.match(re);
                expect(m, `${p} publishes a protocol: "${m && m[0]}"`).toBeNull();
            }
        }
        expect(prose(read(TOPIC)))
            .toMatch(/no repetitions, no durations, no pressures, no progressions, no schedules/);
    });

    test('AND NOTHING IS INVENTED', () => {
        for (const p of PAGES) {
            const src = read(p), t = prose(src);
            /* No fabricated statistics. The only numerals allowed in the
               prose are section numbers, the review date, and the four-hour
               emergency threshold, none of which is a result. */
            const pct = t.match(/\b\d+(\.\d+)?\s*(%|per cent|percent)/i);
            expect(pct, `${p} quotes a percentage: "${pct && pct[0]}"`).toBeNull();
            for (const re of [/\b\d+\s*(men|participants|patients|subjects) (were|took|in the)/i,
                              /\bstudy of \d+/i, /\ba \d{4} study (found|showed)/i]) {
                const m = t.match(re);
                expect(m, `${p} cites a study population: "${m && m[0]}"`).toBeNull();
            }
            /* No testimonials and no endorsements. */
            expect(/["“][^"”]{40,}["”]\s*(said|wrote|reports|according to one)/i.test(t),
                `${p} quotes a testimonial`).toBe(false);
            for (const re of [/\b(urologist|doctor|expert|clinician)s? (recommend|endorse|approve)/i,
                              /\breviewed by Dr\b/i, /\bmedically reviewed\b/i]) {
                const m = t.match(re);
                expect(m, `${p} claims an endorsement: "${m && m[0]}"`).toBeNull();
            }
        }
    });
});

describe('sources and the review stamp', () => {
    test('EVERY SOURCE IS CREDIBLE, HTTPS, AND PAIRED WITH ITS CLAIM', () => {
        const refs = read(TOPIC).match(/<ul class="refs">([\s\S]*?)<\/ul>/);
        expect(refs, 'no reference list').not.toBeNull();
        const rows = [...refs[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
        expect(rows.length, 'too few sources').toBeGreaterThanOrEqual(5);
        for (const r of rows) {
            const a = r.match(/<a href="(https:\/\/[^"]+)"([^>]*)>/);
            expect(a, `a reference has no https link: ${r.slice(0, 60)}`).not.toBeNull();
            expect(CREDIBLE_DOMAINS, `${new URL(a[1]).host} is not approved`)
                .toContain(new URL(a[1]).host);
            expect(a[2]).toContain('rel="noopener noreferrer"');
            expect(a[2]).toContain('target="_blank"');
            const why = r.match(/<\/a><span>([^<]+)<\/span>/);
            expect(why, `reference has no supporting statement: ${r.slice(0, 60)}`).not.toBeNull();
            expect(why[1]).toMatch(/^Supports /);
            expect(why[1].length).toBeGreaterThan(50);
        }
    });

    test('the page cites no source it does not list', () => {
        const src = strip(read(TOPIC));
        const refs = src.match(/<ul class="refs">([\s\S]*?)<\/ul>/)[1];
        const external = [...src.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
        const listed = [...refs.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
        expect([...new Set(external)].sort()).toEqual([...new Set(listed)].sort());
    });

    test('structured data cites only what the page shows', () => {
        const src = read(TOPIC);
        const ld = JSON.parse(src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
        const article = ld['@graph'].find(n => n['@type'] === 'Article');
        const refs = src.match(/<ul class="refs">([\s\S]*?)<\/ul>/)[1];
        const listed = new Set([...refs.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map(m => m[1]));
        for (const c of article.citation) expect(listed, `structured data cites ${c}`).toContain(c);
        /* No invented reviewer, here least of all. */
        expect(article.author['@type']).toBe('Organization');
        expect(article).not.toHaveProperty('reviewedBy');
        expect(JSON.stringify(ld)).not.toMatch(/\b(MD|M\.D\.|reviewedBy|Physician)\b/);
    });

    test('A VISIBLE LAST-REVIEWED DATE, WHICH IS REAL AND NOT IN THE FUTURE', () => {
        for (const p of PAGES) {
            const stamp = read(p).match(/<div class="stamp[^"]*">([\s\S]*?)<\/div>/);
            expect(stamp, `${p} has no review stamp`).not.toBeNull();
            const m = stamp[1].match(/Last reviewed:<\/strong>\s*(\d{1,2} \w+ \d{4})/);
            expect(m, `${p} has no last-reviewed date`).not.toBeNull();
            const when = new Date(m[1]);
            expect(Number.isNaN(when.getTime()), `${p} date unparseable`).toBe(false);
            expect(when.getTime(), `${p} reviewed in the future`).toBeLessThanOrEqual(Date.now());
            /* And it is honest about who reviewed it. */
            expect(stamp[1]).toMatch(/No clinician has reviewed th(is|ese) pages?\./);
        }
    });

    test('and the medical note names the emergency', () => {
        for (const p of PAGES) {
            const t = prose(read(p));
            expect(t, `${p} has no medical note`).toMatch(/Medical note:/);
            expect(t).toMatch(/evaluated promptly by a qualified healthcare professional/);
        }
        expect(prose(read(TOPIC))).toMatch(/erection lasting more than four hours/i);
    });
});

describe('what the Lab must not disturb', () => {
    test('THE ASSESSMENT STILL RECOMMENDS NOTHING FROM THE LAB', () => {
        /* The assessment is medical-adjacent advice. It must not start
           routing men toward unevaluated techniques. */
        const a = read('assessment/index.html');
        expect(strip(a), 'the assessment content links the Research Lab').not.toContain('/research-lab/');
        /* Word boundaries, because "scheduling" contains "uli" and a naive
           substring check fails on the app's own feature list. */
        for (const w of ['jelq', 'jelqing', 'uli', 'v-stretch', 'directional pull']) {
            const re = new RegExp(`\\b${w.replace(/[-]/g, '\\-')}\\b`, 'i');
            expect(re.test(a), `the assessment mentions ${w}`).toBe(false);
        }
    });

    test('no Learning Centre guide starts promoting these techniques', () => {
        for (const g of ['performance-anxiety-erections', 'blood-sugar-erections',
                         'hydration-erections', 'pelvic-floor-premature-ejaculation',
                         'hip-mobility-sexual-performance', 'improve-sexual-stamina']) {
            const t = prose(read(`${g}/index.html`)).toLowerCase();
            for (const w of ['jelq', 'uli', 'directional pull']) {
                expect(new RegExp(`\\b${w}\\b`, 'i').test(t), `${g} mentions ${w}`).toBe(false);
            }
        }
    });

    test('and the Lab carries no sales offer', () => {
        /* Deliberate. A page about unevaluated practices is the wrong place
           to sell, and the landing page says so in its own words. */
        for (const p of PAGES) {
            const src = strip(read(p));
            expect(src, `${p} carries a price`).not.toMatch(/\$\d/);
            expect(src, `${p} carries a call to action`).not.toContain('class="cta"');
            expect(src).not.toContain('href="/whats-inside/"');
        }
        expect(prose(read(LANDING))).toMatch(/these pages carry no sales offer/);
    });

    test('American English, no em dashes, no contrast constructions', () => {
        for (const p of PAGES) {
            const src = strip(read(p)), t = prose(read(p));
            for (const ch of ['—', '–', '⸺', '⸻']) {
                expect(src.includes(ch), `${p} uses ${JSON.stringify(ch)}`).toBe(false);
            }
            for (const re of [/\brecognis(e|ed|es|ing|able)\b/i, /\bbehaviour(s|al)?\b/i,
                              /\bprogramme(s)?\b/i, /\bpractis(e|ed|es|ing)\b/i,
                              /\bcounselling\b/i, /\bcolour(s|ed)?\b/i, /\bemphasis(e|ed)\b/i]) {
                expect(re.test(t), `${p} British spelling ${re}`).toBe(false);
            }
            for (const re of [/\bnot just\b/i, /\bnot merely\b/i, /\bbut rather\b/i,
                              /\b(is|are) not\b[^.!?]{0,90}\.\s*(It|They|That|This)\s+(is|are)\s+(?![^.!?]{0,25}\bnot\b)/]) {
                const m = t.match(re);
                expect(m, `${p} contrast construction "${m && m[0]}"`).toBeNull();
            }
        }
    });
});

describe('the house style applies here too', () => {
    /* These rules lived inside tests/learnGuides.test.js and so covered the
       six guides and nothing else. The Research Lab is member-facing prose
       written to the same standard and was covered by neither.

       That was not theoretical. A review of these two pages found "a single
       centre" on the landing page and "respectable looking neighbour" on the
       topic page, both in published copy, after an ad-hoc grep that was
       meant to catch them and did not. The rules now live in tests/prose.js
       and both suites read the same list.

       prose() strips the shared nav and stylesheet blocks first, so a
       spelling inside tools/site-nav.html is not this PR's problem and does
       not fail here. */

    test('AMERICAN ENGLISH, ON BOTH PAGES', () => {
        for (const p of PAGES) {
            const t = prose(read(p));
            for (const re of BRITISH_SPELLINGS) {
                const m = t.match(re);
                expect(m, m ? `${p} uses "${m[0]}": ${context(t, m[0])}` : '').toBeNull();
            }
        }
    });

    test('and no rhetorical contrast constructions', () => {
        for (const p of PAGES) {
            const t = prose(read(p));
            for (const re of CONTRAST_CONSTRUCTIONS) {
                const m = t.match(re);
                expect(m, m ? `${p} uses a contrast construction: ${context(t, m[0])}` : '')
                    .toBeNull();
            }
        }
    });

    test('no em dashes', () => {
        for (const p of PAGES) {
            expect(prose(read(p)).includes('\u2014'), `${p} has an em dash`).toBe(false);
        }
    });
});
