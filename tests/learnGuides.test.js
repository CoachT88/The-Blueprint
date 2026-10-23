import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE LEARNING CENTRE CONTENT STANDARD, ENFORCED.
 *
 * docs/learning-centre-content-standard.md is the prose version. This file
 * is the half of it a machine can hold. Add a guide to GUIDES below and the
 * whole standard applies to it: shape, principles, free action plan,
 * references, claims, price, language, metadata, page mechanics.
 *
 * These are health pages that carry a price tag at the bottom, which is the
 * combination that goes wrong quietly. The failures this file exists to
 * catch, none of which throws in a browser:
 *
 *   1. a hub links a guide that does not exist, or still claims every guide
 *      is pending while several are published;
 *   2. a page loses the two statements that must travel with this subject
 *      matter: that the app does not diagnose or treat, and that persistent
 *      difficulty belongs with a clinician;
 *   3. the free exercise quietly starts requiring the app, which turns the
 *      one section a non-buyer can use into another advertisement;
 *   4. a reference rots, or cites a domain nobody should take medical
 *      claims from, or stops saying which claim it supports;
 *   5. structured data starts asserting things that are not true, such as a
 *      named medical reviewer nobody reviewed anything;
 *   6. the price drifts, and now it lives in seven files.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Government health bodies, national health services, medical schools and
 *  major clinical nonprofits. Adding one is a deliberate edit here, not
 *  something a new guide does on its way past. */
const CREDIBLE_DOMAINS = [
    'www.niddk.nih.gov', 'www.nhs.uk', 'www.mayoclinic.org', 'www.heart.org',
    'my.clevelandclinic.org', 'orthoinfo.aaos.org', 'www.plymouthhospitals.nhs.uk',
    'www.urologyhealth.org',
    'medlineplus.gov', 'www.ncbi.nlm.nih.gov', 'www.cdc.gov',
];

/** Member-facing language banned across the product, including here.
 *  Mirrors tests/exerciseCopy.test.js. */
const BANNED_PHRASES = [
    'bear down', 'bearing down', 'neural reset', 'rewire your nervous system',
    'rewires your nervous system', 'pelvic down-training', 'down-training',
];

/**
 * British spellings, which the guides must not use. The site writes practical
 * American English and these drifted in across five articles written in one
 * sitting, which is exactly the kind of thing nobody catches by reading.
 *
 * Each pattern is anchored and inflection-specific so it cannot flag a word
 * that is correct in American English: "analysis", "emphasis" and "realistic"
 * are all spelled the same on both sides and must not trip this.
 */
const BRITISH_SPELLINGS = [
    /\brecognis(e|ed|es|ing|able)\b/i, /\bbehaviour(s|al|ally)?\b/i,
    /\bcolour(s|ed|ing|less)?\b/i, /\banalys(e|ed|es|ing)\b/i,
    /\bsummaris(e|ed|es|ing)\b/i, /\bemphasis(e|ed|es|ing)\b/i,
    /\b(individual|personal|normal|prioriti|special|minimi|maximi|organi|real|apologi)s(e|ed|es|ing|ation)\b/i,
    /\bcharacteris(e|ed|es|ing|ation)\b/i, /\bpractis(e|ed|es|ing)\b/i,
    /\bprogramme(s)?\b/i, /\bwhilst\b/i, /\blitre(s)?\b/i, /\bmetre(s)?\b/i,
    /\bfibre(s)?\b/i, /\bdefence\b/i, /\blicence\b/i, /\btravelling\b/i,
    /\blabell(ed|ing)\b/i, /\bcounselling\b/i, /\bjudgement\b/i, /\bageing\b/i,
    /\bgrey\b/i, /\bcentre(s)?\b/i, /\bfavour(s|ed|ite)?\b/i, /\bhonour(s|ed)?\b/i,
    /\bhumour\b/i, /\bneighbour(s|hood)?\b/i, /\bmodelling\b/i, /\benquir(e|ed|y|ies)\b/i,
];

/**
 * Rhetorical contrast constructions, which the house style does not use.
 *
 * The first version of this list caught the obvious forms and missed the
 * one the guides were actually full of: define a thing by denying
 * something first, then assert the real answer. "Stamina is not endurance.
 * It is the ability to notice where your arousal is." Three article
 * openings were built that way and the guard said nothing.
 *
 * The negation patterns below require a POSITIVE assertion to follow,
 * which is what makes the construction rhetorical. A run of plain
 * negations that limits a claim, such as "it is not a treatment, it is not
 * a strengthening program", is a scope statement and is often medically
 * required, so the lookahead lets it through.
 */
const CONTRAST_CONSTRUCTIONS = [
    /\bnot just\b/i, /\bnot merely\b/i, /\bnot simply\b/i, /\bisn'?t just\b/i,
    /\bbut rather\b/i, /\bnot only\b[^.]{0,60}\bbut\b/i,
    /\b(is|are|was|were) not\b[^.!?]{0,90}\.\s*(It|They|That|This|What)\s+(is|are)\s+(?!not\b)/,
    /\b(is|are) not\b[^.!?]{0,70},\s*(it|they|that)\s+(is|are)\s+(?!not\b)/i,
    /\bdifferent claim from\b/i,
    /\bwhere most\b[^.!?]{0,50}\bgoes wrong\b/i,
    /\bis the whole (article|guide|point|story)\b/i,
    /\bnot the first place\b/i,
    /\bnot a matter of\b/i,
];

/**
 * Claims no guide may make, as a category rather than a sentence.
 *
 * Every one of these read as reasonable prose when it was written, and each
 * had to be corrected in review. The failure mode is quiet: an observation
 * gets described as a measurement, or a single test gets described as
 * answering a question it cannot answer, and nothing in the page looks
 * wrong. These are the shapes to refuse.
 */
const OVERCLAIMS = [
    /\bmeasurement of (your )?(circulation|arousal|blood flow)\b/i,
    /\b(is|are) a measurement of\b/i,
    /\btells you why your erections?\b/i,
    /* "tells you that your muscles are too tight" is left to the pelvic
       guide's own mustSay, because the sentence that belongs there is the
       negated form of it and a pattern here would fire on the correct
       copy. A guard that flags the right answer is worse than no guard. */
    /\bconfirms? (that )?you have\b/i,
    /\bthis (test|check|list|plan|routine) (proves|shows you|diagnoses)\b/i,
];

const FEATURES = [
    'Guided sessions focused on sexual stamina and pelvic floor awareness.',
    'Erection quality and progress tracking.',
    'Breathing and recovery exercises.',
    'Goal-based scheduling.',
    'In-app guidance from Coach Tee.',
];

const GUIDES = [
    {
        name: 'performance anxiety',
        slug: '/performance-anxiety-erections/',
        hub: 'stronger-erections/index.html',
        hubQuestion: 'Why can I get hard alone but lose it during sex?',
        title: 'Why Can I Get Hard Alone but Lose It During Sex?',
        plan: '7. Try This: Your 7-Day Erection Consistency Check',
        mustSay: ['Checking whether you are still hard spends the attention'],
        planKind: 'check',
        sections: 11,
    },
    {
        name: 'blood sugar',
        slug: '/blood-sugar-erections/',
        hub: 'stronger-erections/index.html',
        hubQuestion: 'Can high blood sugar affect erections?',
        title: 'Can High Blood Sugar Affect Erections?',
        plan: '6. Try This: Your 7-Day Metabolic Habits Check',
        mustSay: [
            'An erection is not a measurement',
            'It cannot tell you why your erections have changed.',
            'ask whether an A1C test is appropriate',
        ],
        planKind: 'check',
        sections: 10,
    },
    {
        name: 'hydration',
        slug: '/hydration-erections/',
        hub: 'stronger-erections/index.html',
        hubQuestion: 'Does hydration affect erection quality?',
        title: 'Does Hydration Affect Erection Quality?',
        plan: '6. Try This: Your Daily Hydration Check',
        mustSay: [
            'has not been established as a treatment for erection problems',
            'follow that individual advice',
        ],
        planKind: 'check',
        sections: 10,
    },
    {
        name: 'pelvic floor',
        slug: '/pelvic-floor-premature-ejaculation/',
        hub: 'last-longer/index.html',
        hubQuestion: 'Can pelvic floor tension affect ejaculation timing?',
        title: 'Can a Tight Pelvic Floor Affect Sexual Performance?',
        plan: '6. Try This: A Five-Minute Pelvic Relaxation Routine',
        mustSay: [
            /* The breathing cue, and the two warnings that travel with it.
               The do-not-actually warning belongs both where the cue is
               explained and in the step that uses it, so it is required
               twice. */
            ['Do not actually urinate or pass gas', 2],
            'Do not squeeze it back',
            'lengthens and relaxes',
            /* Symptoms cannot establish muscle tone. */
            'Nothing on this list tells you that your muscles are too tight.',
            'Kegel exercises can make symptoms worse',
            /* The routine's own scope line. A mutation written as a control,
               to prove the contrast guard does not fire on a limiting
               negation, instead replaced this with "It is a treatment
               program" and survived. A relaxation routine described as a
               treatment is the exact claim this guide must not make. */
            'It is not a treatment, it is not a strengthening program',
        ],
        planKind: 'steps',
        sections: 10,
    },
    {
        name: 'hip mobility',
        slug: '/hip-mobility-sexual-performance/',
        hub: 'better-sexual-performance/index.html',
        hubQuestion: 'How does hip mobility affect comfort during sex?',
        title: 'How Does Hip Mobility Affect Sexual Performance?',
        plan: '6. Try This: A Beginner Hip Routine, 10 to 15 Minutes',
        mustSay: [
            /* The whole time cost, and the AAOS warm-up it depends on. */
            '5 to 10 minutes of warm-up',
            '5 to 10 minutes of low impact activity',
            'this guide does not claim it',
        ],
        planKind: 'steps',
        sections: 10,
    },
    {
        name: 'sexual stamina',
        slug: '/improve-sexual-stamina/',
        hub: 'better-sexual-performance/index.html',
        hubQuestion: 'How can I improve sexual stamina?',
        title: 'How Can I Improve Sexual Stamina?',
        plan: '6. Try This: A 7-Day Arousal Awareness Plan',
        mustSay: [
            'subjective awareness exercise',
            'not a measurement of anything',
            'It should not be painful',
        ],
        planKind: 'steps',
        sections: 10,
    },
];
const file = (g) => g.slug.replace(/^\//, '') + 'index.html';

/** The page's own CSS, with the two synced blocks taken back out. */
function pageCss(src) {
    return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n')
        .replace(/\/\* SITE-NAV:START \*\/[\s\S]*?\/\* SITE-NAV:END \*\//, '');
}

/**
 * The guide's OWN visible prose: the synced header and guide stylesheet
 * removed first, because both have their own source file and neither is
 * reader-facing language this guide is responsible for.
 */
function ownProse(src) {
    return prose(src
        .replace(/\/\* GUIDE-CSS:START \*\/[\s\S]*?\/\* GUIDE-CSS:END \*\//, ' ')
        .replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, ' '));
}

/** Visible text: tags, scripts and the stylesheet removed. */
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
    return src.slice(src.lastIndexOf('<section', i), src.indexOf('</section>', i));
}

const headings = (src) => [...src.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]);

/* ──────────────────────────────────────────────────────────── per guide ── */

for (const g of GUIDES) {
    const src = read(file(g));
    const text = prose(src);

    describe(`${g.name}: the hub and the guide agree`, () => {
        test('THE HUB LINKS THE GUIDE, AT ITS REAL URL', () => {
            const list = read(g.hub).match(/<ul class="guide-list">([\s\S]*?)<\/ul>/)[1];
            const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
            const mine = items.find(i => i.includes(`href="${g.slug}"`));
            expect(mine, `${g.hub} does not link ${g.slug}`).toBeDefined();
            expect(mine).toContain(g.hubQuestion);
            expect(existsSync(path.join(ROOT, file(g)))).toBe(true);
        });

        test('the breadcrumb goes back to Learn and to the hub', () => {
            const crumb = src.match(/<p class="crumb">([\s\S]*?)<\/p>/);
            expect(crumb, 'no breadcrumb').not.toBeNull();
            expect(crumb[1]).toContain('href="/learn/"');
            expect(crumb[1]).toContain(`href="/${g.hub.replace('/index.html', '')}/"`);
        });

        test('/learn/ lists it as published', () => {
            expect(read('learn/index.html')).toContain(`href="${g.slug}"`);
        });

        test('the sitemap carries it', () => {
            expect(read('sitemap.xml')).toContain(`<loc>https://theblueprint.site${g.slug}</loc>`);
        });
    });

    describe(`${g.name}: the shape the standard requires`, () => {
        test('IT ANSWERS THE QUESTION BEFORE IT EXPLAINS ANYTHING', () => {
            /* The lead paragraph is the direct answer. A guide whose first
               paragraph promises an answer further down has failed the
               searcher who only reads one screen. */
            const lead = src.match(/<p class="lead">([\s\S]*?)<\/p>/);
            expect(lead, 'no lead paragraph').not.toBeNull();
            expect(lead[1].replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(80);
            /* And it comes before the first numbered section. */
            expect(src.indexOf('<p class="lead">')).toBeLessThan(src.indexOf('<h2>1.'));
        });

        test('the numbered sections run in order with no gaps', () => {
            const nums = headings(src)
                .map(h => parseInt(h, 10)).filter(n => !Number.isNaN(n));
            expect(nums).toEqual([...Array(g.sections)].map((_, i) => i + 1));
        });

        test('the required stages are all present', () => {
            const h = headings(src).join(' | ');
            for (const [label, re] of [
                ['principles', /\d\. Three principles worth keeping/],
                ['free action plan', /\d\. Try This:/],
                ['when medical evaluation matters', /\d\. When /],
                ['references', /\d\. Where this information comes from/],
                ['related guides', /\d\. Related guides/],
                ['Blueprint next step', /\d\. Your next step/],
            ]) expect(re.test(h), `missing stage: ${label} (${h})`).toBe(true);
        });

        test('THE FREE PLAN COMES BEFORE THE MEDICAL SECTION, AND BOTH BEFORE THE SALE', () => {
            /* Order is the point. A free plan printed after "see a doctor"
               is a plan nobody reaches, and a Blueprint section before the
               references is a sale before the evidence. */
            const at = (re) => src.indexOf(`<h2>${headings(src).find(h => re.test(h))}</h2>`);
            expect(at(/Try This:/)).toBeLessThan(at(/\d\. When /));
            expect(at(/\d\. When /)).toBeLessThan(at(/Where this information comes from/));
            expect(at(/Where this information comes from/)).toBeLessThan(at(/Your next step/));
        });

        test('the medical section names specific circumstances, not a disclaimer', () => {
            const s = section(src, headings(src).find(h => /\d\. When /.test(h)));
            expect(s).not.toBeNull();
            expect([...s.matchAll(/<li>([^<]*)<\/li>/g)].length).toBeGreaterThanOrEqual(4);
        });
    });

    describe(`${g.name}: the principles teach something`, () => {
        const cards = [...src.matchAll(/<div class="principle">([\s\S]*?)<\/div>/g)].map(m => m[1]);

        test('AT LEAST THREE PRINCIPLES, EACH WITH ALL FOUR PARTS', () => {
            expect(cards.length, 'fewer than three principles').toBeGreaterThanOrEqual(3);
            for (const c of cards) {
                const dts = [...c.matchAll(/<dt>([^<]*)<\/dt>/g)].map(m => m[1]);
                expect(dts, 'a principle is missing its four parts')
                    .toEqual(['Why it matters', 'Practical example', 'Apply it']);
                const h3 = c.match(/<h3>([^<]*)<\/h3>/);
                expect(h3, 'a principle has no statement').not.toBeNull();
                expect(h3[1].length).toBeGreaterThan(25);
                const dds = [...c.matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map(m => m[1]);
                for (const d of dds) expect(d.replace(/<[^>]+>/g, '').trim().length)
                    .toBeGreaterThan(60);
            }
        });

        test('no principle simply restates the headline', () => {
            /* "Blood sugar affects erections" under the heading "Can high
               blood sugar affect erections?" teaches nobody anything. */
            const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/)
                .filter(w => w.length > 3);
            const title = new Set(norm(g.title));
            for (const c of cards) {
                const words = norm(c.match(/<h3>([^<]*)<\/h3>/)[1]);
                const overlap = words.filter(w => title.has(w)).length / words.length;
                expect(overlap, `principle restates the title: ${words.join(' ')}`)
                    .toBeLessThan(0.6);
            }
        });

        test('and the strongest one is repeated as a takeaway near the end', () => {
            const t = src.match(/<div class="takeaway">([\s\S]*?)<\/div>/);
            expect(t, 'no takeaway').not.toBeNull();
            expect(t[1]).toContain('The one to remember');
            expect(prose(t[1]).trim().length).toBeGreaterThan(70);
        });
    });

    describe(`${g.name}: the free resource works without buying anything`, () => {
        const plan = section(src, g.plan);
        const planText = prose(plan || '');

        test('THE EXERCISE NEEDS NO PURCHASE, NO ACCOUNT AND NO PERSONAL DATA', () => {
            expect(plan, `the action plan section "${g.plan}" is missing`).not.toBeNull();
            expect(planText).toMatch(/nothing to buy/i);
            expect(planText).toMatch(/nothing to sign up for/i);
            expect(planText).toMatch(/no personal information/i);
            /* And it must not route the reader into the funnel to use it. */
            expect(plan, 'the free exercise links into the funnel')
                .not.toMatch(/href="\/(whats-inside|how-it-works|app)\/"/);
            expect(plan).not.toMatch(/class="cta"/);
            expect([...plan.matchAll(/<a /g)].length, 'the free exercise links out').toBe(0);
        });

        test('it is a real set of instructions, not a gesture', () => {
            const items = [...plan.matchAll(/<li>(?:<strong>)?([^<]*)/g)].map(m => m[1]);
            expect(items.length, 'too few steps to follow').toBeGreaterThanOrEqual(4);
            const cls = g.planKind === 'steps' ? 'steps' : 'check';
            expect(plan, `expected a .${cls} list`).toContain(`class="${cls}"`);
            if (g.planKind === 'steps') {
                /* Every step states its own dosage: a duration, a count, or
                   the day it belongs to. Checking the section as a whole let
                   one step lose its "30 seconds each side" while the other
                   steps carried the match, which a mutation found. */
                const labels = [...plan.matchAll(/<li><strong>([^<]*)<\/strong>/g)].map(m => m[1]);
                expect(labels.length, 'steps without labels').toBeGreaterThanOrEqual(4);
                for (const l of labels) {
                    expect(/\d/.test(l), `step states no duration, count or day: "${l}"`).toBe(true);
                }
            }
        });

        test('IT STATES WHAT IT CANNOT TELL THE READER', () => {
            expect(plan, 'no limits block').toContain('class="limits"');
            expect(planText).toMatch(/cannot (diagnose|tell you)/i);
            expect(planText, 'a clean week must not read as reassurance')
                .toMatch(/not a (test|reason to delay|substitute|prescription)/i);
        });

        test('a physical routine carries stop-if-this-happens guidance', () => {
            if (g.planKind !== 'steps') return;
            expect(plan, 'a physical routine with no safety block').toContain('class="safety"');
            const safety = plan.match(/<div class="safety">([\s\S]*?)<\/div>/)[1];
            expect(prose(safety)).toMatch(/pain|stop/i);
            expect([...safety.matchAll(/<li>/g)].length).toBeGreaterThanOrEqual(3);
        });
    });

    describe(`${g.name}: the references hold up the health claims`, () => {
        const refs = section(src, headings(src).find(h => /Where this information comes from/.test(h)));

        test('EVERY REFERENCE IS A CREDIBLE MEDICAL SOURCE OVER HTTPS', () => {
            expect(refs, 'no references section').not.toBeNull();
            const links = [...refs.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
            expect(links.length, 'too few sources for a health article')
                .toBeGreaterThanOrEqual(4);
            for (const u of links) {
                expect(u.startsWith('https://'), `${u} is not https`).toBe(true);
                expect(CREDIBLE_DOMAINS, `${new URL(u).host} is not an approved source`)
                    .toContain(new URL(u).host);
            }
        });

        test('each one names the claim it supports', () => {
            for (const r of [...refs.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1])) {
                expect(r, 'a reference with no link').toMatch(/<a href="https:\/\//);
                const why = r.match(/<\/a><span>([^<]+)<\/span>/);
                expect(why, `reference has no supporting statement: ${r.slice(0, 70)}`).not.toBeNull();
                expect(why[1]).toMatch(/^Supports /);
                expect(why[1].length).toBeGreaterThan(50);
            }
        });

        test('they leak neither referrer nor window, and announce the new tab', () => {
            const anchors = [...refs.matchAll(/<a href="https:\/\/[^"]+"([^>]*)>/g)].map(m => m[1]);
            for (const a of anchors) {
                expect(a, `missing rel: ${a}`).toContain('rel="noopener noreferrer"');
                expect(a).toContain('target="_blank"');
            }
            expect((refs.match(/class="sr-only"> \(opens in a new tab\)</g) || []).length)
                .toBe(anchors.length);
        });

        test('the page cites no source it does not list', () => {
            const body = src.replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, '');
            const external = [...body.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
            const listed = [...refs.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
            expect([...new Set(external)].sort()).toEqual([...new Set(listed)].sort());
        });

        test('and the structured data cites the same sources the page shows', () => {
            const ld = JSON.parse(src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
            const article = ld['@graph'].find(n => n['@type'] === 'Article');
            const listed = new Set([...refs.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map(m => m[1]));
            for (const c of article.citation) {
                expect(listed, `structured data cites ${c}, which the page does not list`)
                    .toContain(c);
            }
        });
    });

    describe(`${g.name}: what it is allowed to claim`, () => {
        test('IT CARRIES THE MEDICAL NOTE AND THE NOT-A-TREATMENT STATEMENT', () => {
            expect(text).toMatch(/It does not diagnose or treat/);
            expect(text).toMatch(/evaluated by a qualified healthcare professional/);
            expect(src, 'the medical note is not visually set apart').toMatch(/class="note[^"]*"/);
        });

        test('it promises no outcome', () => {
            for (const banned of [/\bwill cure\b/i, /\bguaranteed\b/i, /\bfix your ED\b/i,
                                  /\bcures? (erectile dysfunction|diabetes)\b/i,
                                  /\bproven to (cure|fix|treat)\b/i, /\bclinically proven\b/i]) {
                expect(banned.test(text), `${banned} appears`).toBe(false);
            }
        });

        test('it uses none of the banned member-facing phrases', () => {
            for (const phrase of BANNED_PHRASES) {
                expect(text.toLowerCase().includes(phrase), `"${phrase}" appears`).toBe(false);
            }
        });

        test('IT IS WRITTEN IN AMERICAN ENGLISH', () => {
            /* Prose only. The synced header and stylesheet have their own
               sources, and a code comment is not reader-facing language. */
            for (const re of BRITISH_SPELLINGS) {
                const m = ownProse(src).match(re);
                expect(m, `British spelling "${m && m[0]}" appears`).toBeNull();
            }
        });

        test('IT STILL CARRIES THE STATEMENTS REVIEW PUT THERE', () => {
            /* Safety cues and scope limits are the first thing a rewrite
               loses, because they read as throat-clearing. Each guide names
               its own, so deleting or inverting one fails here. */
            for (const entry of (g.mustSay || [])) {
                /* An entry may demand a minimum count. Some warnings belong
                   in two places, once where the mechanism is explained and
                   once in the step that performs it, and a presence check
                   alone passes while one of the two is deleted. A mutation
                   found exactly that. */
                const [phrase, times] = Array.isArray(entry) ? entry : [entry, 1];
                const n = text.split(phrase).length - 1;
                expect(n, `required statement "${phrase}" appears ${n} times, needs ${times}`)
                    .toBeGreaterThanOrEqual(times);
            }
        });

        test('AND IT MAKES NONE OF THE CLAIMS REVIEW REJECTED', () => {
            for (const re of OVERCLAIMS) {
                const m = ownProse(src).match(re);
                expect(m, `overclaim "${m && m[0]}" appears`).toBeNull();
            }
        });

        test('and it avoids rhetorical contrast constructions', () => {
            for (const re of CONTRAST_CONSTRUCTIONS) {
                const m = ownProse(src).match(re);
                expect(m, `contrast construction "${m && m[0]}" appears`).toBeNull();
            }
        });

        test('and it uses no em dashes', () => {
            for (const ch of ['—', '–', '⸺', '⸻']) {
                expect(src.includes(ch), `${JSON.stringify(ch)} appears`).toBe(false);
            }
        });
    });

    describe(`${g.name}: the price and the actions`, () => {
        test('THE PRICE IS $49 ONE-TIME, STATED ONCE', () => {
            expect(text).toContain('$49 one-time access.');
            expect((text.match(/\$49/g) || []).length, 'the price is repeated').toBe(1);
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

        test('the sale comes with the contextual heading, after the education', () => {
            const offer = src.match(/<div class="offer">([\s\S]*?)<\/div>\s*<p class="price">/)[1];
            expect(offer).toContain('Build a plan around your goals');
            expect(offer).toContain('guided sessions, recovery activities and progress tracking');
            expect([...offer.matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1]), 'invented feature')
                .toEqual(FEATURES);
        });

        test('related guides point at guides that exist', () => {
            const rel = section(src, headings(src).find(h => /Related guides/.test(h)));
            expect(rel).not.toBeNull();
            const hrefs = [...rel.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
            expect(hrefs.length).toBeGreaterThanOrEqual(2);
            for (const h of hrefs) {
                expect(h, 'a guide links to itself').not.toBe(g.slug);
                expect(GUIDES.map(x => x.slug), `${h} is not a published guide`).toContain(h);
            }
        });
    });

    describe(`${g.name}: metadata and page mechanics`, () => {
        test('one inline stylesheet, no external one, no font CDN', () => {
            /* Paired blocks, not opening tags: the shared header's own
               comment contains the literal text "<style>". */
            expect([...src.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].length).toBe(1);
            expect(/<link[^>]+rel=["']?stylesheet/i.test(src)).toBe(false);
            expect(/fonts\.googleapis|fonts\.gstatic|cdnjs|unpkg/i.test(src)).toBe(false);
        });

        test('IT CARRIES THE SHARED GUIDE STYLESHEET, BYTE FOR BYTE', () => {
            const want = read('tools/guide.css').trim();
            const got = src.match(/\/\* GUIDE-CSS:START \*\/([\s\S]*?)\/\* GUIDE-CSS:END \*\//);
            expect(got, 'no guide stylesheet block').not.toBeNull();
            expect(got[1].trim(), 'the guide stylesheet has drifted').toBe(want);
        });

        test('canonical, title, one h1, and a usable description', () => {
            expect(src).toContain(`<link rel="canonical" href="https://theblueprint.site${g.slug}">`);
            expect(src).toContain(`<title>${g.title} | The Blueprint</title>`);
            expect([...src.matchAll(/<h1[\s>]/g)].length).toBe(1);
            expect(src).toContain(`<h1>${g.title}</h1>`);
            const d = src.match(/<meta name="description" content="([^"]+)"/);
            expect(d[1].length).toBeGreaterThan(70);
            expect(d[1].length).toBeLessThan(200);
        });

        test('Open Graph is accurate and points at its own URL', () => {
            const og = Object.fromEntries([...src.matchAll(
                /<meta property="og:([a-z_:]+)" content="([^"]*)"/g)].map(m => [m[1], m[2]]));
            expect(og.type).toBe('article');
            expect(og.site_name).toBe('The Blueprint');
            expect(og.title).toBe(g.title);
            expect(og.url).toBe(`https://theblueprint.site${g.slug}`);
            expect(og.description.length).toBeGreaterThan(50);
            expect(existsSync(path.join(ROOT, 'img/og-card.jpg')), 'og image missing').toBe(true);
            expect(og.image).toBe('https://theblueprint.site/img/og-card.jpg');
        });

        test('THE STRUCTURED DATA CLAIMS NOTHING UNTRUE', () => {
            const ld = JSON.parse(src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
            const article = ld['@graph'].find(n => n['@type'] === 'Article');
            const crumbs = ld['@graph'].find(n => n['@type'] === 'BreadcrumbList');
            expect(article.headline).toBe(g.title);
            expect(article.mainEntityOfPage['@id']).toBe(`https://theblueprint.site${g.slug}`);
            expect(article.isAccessibleForFree).toBe(true);
            /* No invented human author, and no reviewer. Nobody with medical
               credentials has reviewed these pages, so nothing may say so. */
            expect(article.author['@type']).toBe('Organization');
            expect(article.author.name).toBe('The Blueprint');
            expect(article).not.toHaveProperty('reviewedBy');
            expect(JSON.stringify(ld)).not.toMatch(/\b(MD|M\.D\.|reviewedBy|medicalAudience|Physician)\b/);
            /* Dates must be real, not in the future. */
            for (const d of [article.datePublished, article.dateModified]) {
                expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                expect(new Date(d).getTime()).toBeLessThanOrEqual(Date.now());
            }
            expect(crumbs.itemListElement.map(i => i.item)).toEqual([
                'https://theblueprint.site/learn/',
                `https://theblueprint.site/${g.hub.replace('/index.html', '')}/`,
                `https://theblueprint.site${g.slug}`,
            ]);
        });

        test('it is in the sync list, so it cannot ship bare', () => {
            expect(read('tools/sync-site-nav.mjs')).toContain(`'${file(g)}'`);
            expect(read('tests/siteNav.test.js')).toContain(`'${file(g)}'`);
            expect(read('tests/e2e/site-nav.test.js')).toContain(`'/${file(g)}'`);
        });

        test('no tracker, and no script of its own beyond the shared header', () => {
            /* Free exercises must work without collecting anything. The only
               script on a guide is the header's drawer, plus structured
               data, which is not executable. */
            const body = src.replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, '');
            const scripts = [...body.matchAll(/<script([^>]*)>/g)].map(m => m[1]);
            for (const s of scripts) {
                expect(s, `unexpected script: ${s}`).toContain('application/ld+json');
            }
            expect(/gtag|googletagmanager|analytics|fbq|hotjar|mixpanel|segment/i.test(body),
                'a tracker appears on a sexual health page').toBe(false);
            expect(/localStorage|sessionStorage|document\.cookie/.test(body),
                'the guide stores reader input').toBe(false);
        });
    });
}

/* ───────────────────────────────────────────────────────── across guides ── */

describe('the guides are one set, not six pages', () => {
    test('EVERY GUIDE USES THE SAME STYLESHEET SOURCE', () => {
        const want = read('tools/guide.css').trim();
        for (const g of GUIDES) {
            const got = read(file(g)).match(/\/\* GUIDE-CSS:START \*\/([\s\S]*?)\/\* GUIDE-CSS:END \*\//);
            expect(got[1].trim(), `${file(g)} has drifted`).toBe(want);
        }
    });

    test('the stylesheet declares every property it uses and uses every one it declares', () => {
        const css = read('tools/guide.css');
        const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1].toLowerCase()));
        const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map(m => m[1].toLowerCase());
        expect(used.length).toBeGreaterThan(15);
        expect([...new Set(used.filter(v => !declared.has(v)))]).toEqual([]);
        expect([...declared].filter(v => !used.includes(v))).toEqual([]);
    });

    test('no guide carries page CSS of its own that could fork the design', () => {
        for (const g of GUIDES) {
            const own = pageCss(read(file(g)))
                .replace(/\/\* GUIDE-CSS:START \*\/[\s\S]*?\/\* GUIDE-CSS:END \*\//, '').trim();
            expect(own, `${file(g)} has its own CSS: ${own.slice(0, 120)}`).toBe('');
        }
    });

    test('related links form a connected set rather than a ring of one', () => {
        /* Every guide is reachable from at least one other guide. */
        const inbound = new Map(GUIDES.map(g => [g.slug, 0]));
        for (const g of GUIDES) {
            const body = read(file(g)).replace(/<!-- SITE-NAV:START -->[\s\S]*?<!-- SITE-NAV:END -->/, '');
            for (const other of GUIDES) {
                if (other.slug !== g.slug && body.includes(`href="${other.slug}"`)) {
                    inbound.set(other.slug, inbound.get(other.slug) + 1);
                }
            }
        }
        for (const [slug, n] of inbound) {
            expect(n, `${slug} is an orphan, nothing links to it`).toBeGreaterThanOrEqual(1);
        }
    });

    test('the hubs describe their unpublished questions honestly', () => {
        for (const hub of [...new Set(GUIDES.map(g => g.hub))]) {
            const s = read(hub);
            expect(s, 'the blanket pending claim is now false')
                .not.toContain('Detailed educational guides are being prepared for these topics.');
            expect(s).toContain('Guides for the remaining topics are being prepared.');
            const list = s.match(/<ul class="guide-list">([\s\S]*?)<\/ul>/)[1];
            const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
            /* Published first, then pending. A visitor should see what
               exists before what does not. */
            const linked = items.map(i => i.includes('href='));
            expect(linked.slice().sort((a, b) => Number(b) - Number(a)),
                `${hub} interleaves published and pending`).toEqual(linked);
            /* Every link in a hub list is a guide that exists. */
            for (const h of [...list.matchAll(/href="([^"]+)"/g)].map(m => m[1])) {
                expect(existsSync(path.join(ROOT, h.replace(/^\//, ''), 'index.html')),
                    `${hub} links ${h}, which does not exist`).toBe(true);
            }
        }
    });

    test('the sitemap covers every public page and nothing behind sign-in', () => {
        const xml = read('sitemap.xml');
        const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
        for (const g of GUIDES) {
            expect(locs, `sitemap missing ${g.slug}`).toContain(`https://theblueprint.site${g.slug}`);
        }
        for (const hub of ['/learn/', '/stronger-erections/', '/last-longer/',
                           '/better-sexual-performance/', '/faq/', '/support/', '/safety/']) {
            expect(locs).toContain(`https://theblueprint.site${hub}`);
        }
        expect(locs.some(l => l.includes('/app/')), 'the app is in the sitemap').toBe(false);
        expect(new Set(locs).size, 'duplicate URLs in the sitemap').toBe(locs.length);
        expect(read('robots.txt')).toContain('Sitemap: https://theblueprint.site/sitemap.xml');
        expect(read('robots.txt')).toContain('Disallow: /app/');
    });
});

describe('the standard itself is written down', () => {
    const doc = read('docs/learning-centre-content-standard.md');

    test('THE DOCUMENT NAMES EVERY STAGE THE TESTS ENFORCE', () => {
        for (const stage of ['Direct answer', 'Possible causes', 'What to check',
                             'Practical instructions', 'Free action plan',
                             'When medical evaluation matters', 'Credible references',
                             'Relevant Blueprint next step']) {
            expect(doc, `the standard omits "${stage}"`).toContain(stage);
        }
    });

    test('it keeps a section for every rule family this file enforces', () => {
        /* Without this the Principles section could be deleted from the
           standard and nothing would fail, which a mutation found. */
        for (const h of ['## Principles', '## The free action plan', '## Metadata',
                         '## Privacy', '## Sources', '## Claims', '## Language',
                         '## Page mechanics', '## Adding a guide']) {
            expect(doc, `the standard has lost "${h}"`).toContain(h);
        }
        for (const part of ['Why it matters', 'Practical example', 'Apply it']) {
            expect(doc, `the standard omits the principle part "${part}"`).toContain(part);
        }
    });

    test('it records the rules this file enforces, so the two cannot drift apart', () => {
        expect(doc).toContain('CREDIBLE_DOMAINS');
        expect(doc).toContain('BRITISH_SPELLINGS');
        expect(doc).toContain('CONTRAST_CONSTRUCTIONS');
        expect(doc).toContain('tools/sync-site-nav.mjs');
        expect(doc).toContain('$49 one-time access.');
        expect(doc).toMatch(/No em dashes/);
    });

    test('and it does not itself use an em dash', () => {
        for (const ch of ['⸺', '⸻']) expect(doc.includes(ch)).toBe(false);
        expect(doc.replace(/`[^`]*`/g, '').includes('—')).toBe(false);
    });
});
