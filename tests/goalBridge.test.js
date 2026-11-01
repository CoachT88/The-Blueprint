/**
 * Four goals, four pathways, and no claim the app cannot keep.
 *
 * The relevance gap this closes: a man read about his own concern on a hub
 * page and then met the same generic sentence everyone else met, leaving him
 * to work out for himself what $99 bought for the thing he came for.
 *
 * Two kinds of assertion here, and the second is the one that matters.
 * Structure, so a pathway cannot quietly break: four homepage choices, four
 * anchors that exist, four hubs that point at the right one. And TRUTH, so a
 * pathway cannot quietly start selling something that is not there. Each
 * bridge has to carry a limitation, the erection section has to keep saying
 * there is no erection quality session, and the whole page is checked against
 * the capability claims that are forbidden while #177 and #180 are open.
 *
 * Every capability sentence in those sections was verified against
 * app/index.html before it was written:
 *
 *   EQ rating 1 to 10, optional        app/index.html eq-checkin-btns
 *   EQ chart and weekly trend note     eq-chart, the EQ trend line
 *   pelvic screening gates contraction PELVIC_SCREEN_QUESTIONS, tight profile
 *   stop and start stamina session     ROUTINES.stamina Edging, Controlled Hold
 *   manual length and girth routines   ROUTINES.length, ROUTINES.girth
 *   BPEL and MSEG with charts          input-bpel, input-mseg, bpel-chart
 *   a combined week with rest in it    GOALS.all.schedule
 *   the week calendar is editable      the weekly editor on the HQ
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const home = readFileSync('index.html', 'utf8');
const product = readFileSync('whats-inside/index.html', 'utf8');
const productMain = product.slice(product.indexOf('<main class="wrap">'), product.indexOf('</main>'));

const why = home.slice(home.indexOf('<section id="why">'),
                       home.indexOf('</section>', home.indexOf('<section id="why">')));

/** One bridge block, by anchor id. */
const bridge = id => {
    const start = productMain.indexOf(`<div class="goal-bridge" id="${id}">`);
    expect(start, `#${id} must exist`).toBeGreaterThanOrEqual(0);
    return productMain.slice(start, productMain.indexOf('</div>', start));
};

const visible = html => html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/* intent -> the hub a man reads for free, and the anchor he lands on. */
const PATHS = [
    { goal: 'erections', hub: 'stronger-erections/index.html', anchor: 'for-erections' },
    { goal: 'stamina',   hub: 'last-longer/index.html',        anchor: 'for-stamina' },
    { goal: 'size',      hub: 'size-enhancement/index.html',   anchor: 'for-size' },
    { goal: 'combined',  hub: 'better-sexual-performance/index.html', anchor: 'for-multiple-goals' },
];

describe('the homepage offers the four goals the app actually has', () => {
    test('four choices, and the fourth is multiple goals rather than a conditioning hub', () => {
        expect((why.match(/class="card goal"/g) || [])).toHaveLength(4);
        expect(why).toContain('href="/last-longer/"');
        expect(why).toContain('href="/stronger-erections/"');
        expect(why).toContain('href="/size-enhancement/"');
        expect(why).toContain('href="/whats-inside/#for-multiple-goals"');
        expect(visible(why)).toContain('Multiple Goals');
        /* The old card's intent is gone from the grid and the hub is NOT:
           the issue keeps that page and its route, and the homepage keeps a
           way in to it. */
        const grid = why.slice(why.indexOf('<div class="grid four">'), why.indexOf('</div>', why.indexOf('<div class="grid four">')));
        expect(grid).not.toContain('href="/better-sexual-performance/"');
        expect(why).toContain('href="/better-sexual-performance/"');
    });

    test('the lede names the four, and still sends the undecided to the free assessment', () => {
        const lede = visible(why.slice(why.indexOf('class="lede"'), why.indexOf('</p>', why.indexOf('class="lede"'))));
        expect(lede).toMatch(/Lasting longer/i);
        expect(lede).toMatch(/erections/i);
        expect(lede).toMatch(/length or girth/i);
        expect(lede).toMatch(/more than one/i);
        expect(why).toContain('href="/assessment/"');
        expect(visible(why)).toMatch(/free information/);
    });
});

describe('every pathway reaches its own goal, for free first', () => {
    test.each(PATHS)('$goal: the hub points at its anchor and keeps its free guides', ({ hub, anchor }) => {
        const src = readFileSync(hub, 'utf8');
        expect(src, `${hub} must bridge to #${anchor}`).toContain(`href="/whats-inside/#${anchor}"`);
        /* The free reading is still reachable from the page itself, so the
           bridge is an offer and not a toll gate. */
        expect(src).toMatch(/href="\/[a-z0-9-]+\/"/);
        /* No answer, concern or intent is carried in a query string. */
        expect(src).not.toMatch(/href="\/whats-inside\/\?/);
    });

    test.each(PATHS)('$goal: its anchor exists on the product page', ({ anchor }) => {
        expect(productMain).toContain(`id="${anchor}"`);
    });

    test('the four anchors are the only goal bridges, and each is scrolled clear of the sticky header', () => {
        expect((productMain.match(/class="goal-bridge"/g) || [])).toHaveLength(4);
        expect(product).toContain('#for-your-goal,.goal-bridge{scroll-margin-top:76px}');
    });

    test('nothing in the pathway stores, sends or encodes what he chose', () => {
        /* The whole mechanism is anchors. If a future change reaches for
           localStorage, a query parameter or an analytics call to carry the
           intent, this fails and the privacy promise is re-examined first. */
        const added = productMain.slice(productMain.indexOf('<section id="for-your-goal">'),
                                        productMain.indexOf('<h2>Your training tools</h2>'));
        for (const forbidden of ['localStorage', 'sessionStorage', 'fetch(', 'gtag', 'dataLayer', '?goal=', 'onclick']) {
            expect(added, `${forbidden} has no place in a navigation choice`).not.toContain(forbidden);
        }
        expect(added).not.toContain('<script');
    });
});

describe('each bridge says what is there, then the most useful thing against it', () => {
    test.each(PATHS.map(p => p.anchor))('%s carries a recognition line, a limit and one way to buy', anchor => {
        const b = bridge(anchor);
        expect(b, 'his own words first').toContain('class="recognition"');
        expect(b, 'what is actually in the app').toContain('What is actually in the app');
        expect(b, 'the honest limit').toContain('The honest limit');
        /* Exactly one purchase action, pointed at the route that already
           exists. No second checkout, no competing offer.

           SECONDARY, deliberately. tests/pageTemplate.test.js caps a page at
           two primary actions, on the grounds that three is a page that has
           not decided what it wants, and four goal buttons plus the page's
           own two broke it. The rule was right and the fix is the honest one
           rather than a looser cap: inside a goal section the offer is an
           option beside the free reading, not the thrust of the page, which
           is also what the issue asked for by calling it optional. */
        expect((b.match(/class="cta"/g) || []), 'a bridge must not add a primary action').toHaveLength(0);
        expect((b.match(/class="cta secondary"/g) || [])).toHaveLength(1);
        expect(b).toContain('href="/#get"');
        expect(visible(b)).toContain('$99 once');
        expect(visible(b)).toMatch(/One payment, no subscription/);
        /* And the free route out, so reading is never the thing he pays for. */
        expect(b).toMatch(/Read first, decide later/);
    });

    test('the erection section tells a buyer the goal schedules a length session', () => {
        /* THE P0 FROM #177, AND THE PART THE FIRST DRAFT MISSED.
           GOALS.eq.schedule is ['stamina','rest','length','rest','stamina',
           'rest','rest']. Saying only that no erection-quality session
           exists left a man free to assume the goal therefore schedules
           nothing he did not ask for, and it schedules a length day. A
           purchase decision made without that is not an informed one, so the
           page states the actual mix and the way to change it. */
        const b = visible(bridge('for-erections'));
        expect(b).toMatch(/no erection quality session type/i);
        expect(b).toMatch(/two stamina sessions and one length session/i);
        expect(b).toMatch(/week calendar/i);
        expect(b).toMatch(/treats erectile dysfunction/i);
        expect(b).toMatch(/medical assessment/i);
        /* What it does claim is the tracking, which is real. */
        expect(b).toMatch(/1 to 10/);
        expect(b).toMatch(/charts/i);
    });

    test('the pelvic screener is described as a precaution, never a diagnosis', () => {
        /* Six yes/no questions and a 3-yes threshold cannot establish muscle
           tone, so the page may say what the check DOES, and may not say
           what the man's body IS. The earlier draft asserted that a tight
           pelvic floor is made worse by contraction work, which is a
           clinical claim applied to an individual the app has not examined. */
        const b = visible(bridge('for-erections'));
        expect(b).toMatch(/not a diagnosis/i);
        expect(b).toMatch(/professional evaluation/i);
        expect(b).toMatch(/helps the app decide/i);
        expect(b).not.toMatch(/made worse by/i);
        expect(b).not.toMatch(/\bdiagnoses\b|\bdetects\b|\bmeasures your (tone|muscle)/i);
    });

    test('the size section does not turn community reports into evidence', () => {
        const b = visible(bridge('for-size'));
        expect(b).toMatch(/No manual method has established evidence/i);
        expect(b).toMatch(/reports, not proof/i);
        expect(b).toMatch(/injury and scarring/i);
        /* An EVIDENCE limit, not a promise about how the app behaves. The
           first draft said the app would never tell you to use more force or
           train more often, which is not verifiable: difficulty tiers change
           sets and durations, and the manual instructions carry explicit
           force percentages such as "60-70% force at pubic bone ligament".
           What is true is that no force, frequency or dose is established. */
        expect(b).toMatch(/no established safe or effective force, frequency or dose/i);
        expect(b).toMatch(/more intensity is not evidence of a better result/i);
        expect(b).not.toMatch(/will not tell you to use more force/i);
        expect(b).not.toMatch(/\binches\b/i);
    });

    test('the stamina section promises practice, not a cure', () => {
        const b = visible(bridge('for-stamina'));
        expect(b).toMatch(/weak and inconsistent/i);
        expect(b).toMatch(/cannot promise/i);
        expect(b).toMatch(/clinician/i);
    });

    test('the combined section does not announce the unshipped schedule', () => {
        /* #180 and #177 are open. Five activity days, an independent EQ
           support day and a new validated week are not production
           capabilities, so none of them may be described here as if they
           were. */
        const b = visible(bridge('for-multiple-goals'));
        expect(b).toMatch(/not a fifth kind of training/i);
        expect(b).toMatch(/does not add a separate erection quality session/i);
        expect(b).toMatch(/recovery and realistic expectations/i);
        /* No prediction about how this customer will behave. The draft said
           it was the easiest goal to fall behind on, which is a guess about
           him rather than a fact about the app, and it argues against the
           thing it is describing. */
        expect(b).not.toMatch(/fall behind|most work of the four/i);
    });

    test('and no goal section predicts what the customer will do', () => {
        for (const p of PATHS) {
            const b = visible(bridge(p.anchor));
            expect(b, `${p.anchor} predicts behaviour`)
                .not.toMatch(/you will (probably|likely|struggle|give up|fail)/i);
        }
    });

    test('a direct visitor can skip to his own goal without scrolling all four', () => {
        /* Skimmability answered with four anchors that already exist, so no
           limitation is collapsed, shortened or put behind a click. */
        const jump = productMain.slice(productMain.indexOf('class="muted jump"'),
                                       productMain.indexOf('class="goal-bridge"'));
        for (const p of PATHS) expect(jump).toContain(`href="#${p.anchor}"`);
    });

    test('NO UNSHIPPED CAPABILITY IS CLAIMED ANYWHERE ON THE PAGE', () => {
        const copy = visible(productMain);
        for (const claim of [
            /five (meaningful )?activity days/i,
            /support[- ]only day/i,
            /daily (erection quality|EQ) (plan|schedule|programme|program)/i,
            /clinically (validated|reviewed|approved)/i,
            /doctor[- ]approved/i,
            /\bcures?\b/i,
            /permanent (gains|increase)/i,
            /* An AFFIRMATIVE guarantee only. The bare word is not the
               problem: the page already carries "No exercise or technique
               can guarantee changes", which is the sentence we want to keep,
               and a pattern that forbade the word would have deleted the
               disclaimer to satisfy the test. */
            /\b(we|it|the app|this) guarantees?\b/i,
            /\bguaranteed (results|gains|growth|outcome)/i,
        ]) {
            expect(copy, `forbidden claim ${claim}`).not.toMatch(claim);
        }
    });

    test('the price stays one price, and the existing purchase actions are untouched', () => {
        /* The bridge CTAs are deliberately labelled differently from the two
           established ones, so the existing coupling test keeps its exact
           count instead of being loosened to accommodate this work. */
        expect(productMain.split('<a class="cta" href="/#get">Get The Blueprint, $99</a>')).toHaveLength(3);
        expect((productMain.match(/href="\/#get"/g) || [])).toHaveLength(6);
        /* The page's two primary actions, and only two, which is the ceiling
           tests/pageTemplate.test.js enforces across every public page. */
        expect((productMain.match(/<a class="(?:cta|btn|daily-cta)"/g) || [])).toHaveLength(2);
        const copy = visible(productMain);
        expect(copy).not.toMatch(/\$49|\$69|\$149/);
        expect(copy).not.toMatch(/\/mo\b|per month|monthly|subscription fee/i);
    });

    test('no em dashes in the new copy', () => {
        const added = productMain.slice(productMain.indexOf('<section id="for-your-goal">'),
                                        productMain.indexOf('<h2>Your training tools</h2>'));
        for (const ch of ['—', '–', '⸺', '⸻', '&mdash;', '&ndash;']) {
            expect(added.includes(ch), `${JSON.stringify(ch)} appears`).toBe(false);
        }
    });
});

describe('direct entry to the product page still reads as one page', () => {
    test('the goal sections sit between the focus cards and the tools, not in front of the offer', () => {
        const focus = productMain.indexOf('<h2>Choose a training focus</h2>');
        const goals = productMain.indexOf('<section id="for-your-goal">');
        const tools = productMain.indexOf('<h2>Your training tools</h2>');
        const offer = productMain.indexOf('<h2>What you get for $99</h2>');
        expect(focus).toBeGreaterThan(0);
        expect(goals).toBeGreaterThan(focus);
        expect(tools).toBeGreaterThan(goals);
        expect(offer).toBeGreaterThan(tools);
    });

    test('a visitor who never followed a goal link is told what the section is for', () => {
        const intro = visible(productMain.slice(productMain.indexOf('<section id="for-your-goal">'),
                                                productMain.indexOf('class="goal-bridge"')));
        expect(intro).toMatch(/What this does for your goal/i);
        expect(intro).toMatch(/one per goal/i);
    });

    test('every original route survives', () => {
        for (const route of ['/last-longer/', '/stronger-erections/',
                             '/better-sexual-performance/', '/size-enhancement/',
                             '/assessment/', '/daily/', '/learn/']) {
            expect(home + product, `${route} must still be linked`).toContain(`href="${route}"`);
        }
    });
});
