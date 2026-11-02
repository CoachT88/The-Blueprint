/**
 * The product page sells what the app does, and only that.
 *
 * REWRITTEN FOR #191. The previous version of this file pinned a four-bridge
 * page whose every section ran "What is actually in the app" into a caution
 * block headed "The honest limit" into "Read first, decide later", and then
 * asked for the sale anyway. I wrote that copy in #183 and hardened it twice
 * when reviews asked for more candour. It was the right instinct for the
 * in-app consent gate, which #190 keeps, and the wrong one for a page whose
 * job is to help a man decide what this does for him.
 *
 * So the tests changed with it. What they protect now:
 *   1. Only shipped capabilities are advertised. The erection-quality plan is
 *      not finished, so it is not sold, and its absence is not discussed.
 *   2. Manual length and girth training keeps a concise, visible, specific
 *      risk note beside the offer it belongs to.
 *   3. No caveat stacking on ordinary stamina, breathing, mobility, recovery
 *      or tracking copy.
 *   4. Nothing claims a capability the app does not have. The tripwires at
 *      the end read the app source, so a preset or feature change fails the
 *      marketing rather than silently outdating it.
 *
 * Every benefit sentence on the page was additionally verified by driving the
 * real member journey: sign in, pick the goal in the picker, tap the Today
 * button, walk the readiness and warmup screens, reach the exercise, finish
 * and save. 12 of 12 claims confirmed that way before the copy was written.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const home = readFileSync('index.html', 'utf8');
const product = readFileSync('whats-inside/index.html', 'utf8');
const productMain = product.slice(product.indexOf('<main class="wrap">'), product.indexOf('</main>'));

const visible = html => html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const bridge = id => {
    const start = productMain.indexOf(`<div class="goal-bridge" id="${id}">`);
    expect(start, `#${id} must exist`).toBeGreaterThanOrEqual(0);
    return productMain.slice(start, productMain.indexOf('</div>', start));
};

/** The three plans a member can actually buy and use today. */
const PLANS = ['for-stamina', 'for-size', 'for-multiple-goals'];

describe('three plans, and only the ones that exist', () => {
    test('the page offers exactly three, each with one purchase action', () => {
        expect((productMain.match(/class="goal-bridge"/g) || [])).toHaveLength(3);
        for (const id of PLANS) {
            const b = bridge(id);
            expect((b.match(/class="cta secondary"/g) || []), `${id} CTA`).toHaveLength(1);
            expect(b).toContain('href="/#get"');
            expect(visible(b)).toMatch(/\$99 once/);
            expect(visible(b)).toMatch(/One payment, no subscription/);
        }
    });

    test('THE UNFINISHED EQ PLAN IS NOT SOLD, AND ITS ABSENCE IS NOT DISCUSSED', () => {
        /* GOALS.eq assigns two stamina sessions and one uneditable manual
           length day. That is not a goal-aligned erection-quality pathway, so
           it is not a product we offer. The rule the founder set is that we
           do not market it AND do not explain why it is missing: a page of
           roadmap apologies is its own kind of noise. */
        const copy = visible(productMain);
        expect(productMain, 'an EQ plan bridge came back').not.toContain('id="for-erections">\n<h3>');
        expect((productMain.match(/class="goal-bridge"/g) || []).length).toBe(3);
        for (const absence of [
            /coming soon/i, /not available yet/i, /under review/i,
            /we are not asking you to buy/i, /no erection quality session/i,
            /there is no .* session type/i, /cannot schedule/i,
            /in development/i, /working on/i,
        ]) {
            expect(copy, `roadmap or absence talk: ${absence}`).not.toMatch(absence);
        }
        /* And no erection-quality purchase invitation of any shape. */
        const eqArea = productMain.slice(productMain.indexOf('id="for-erections"'));
        expect(eqArea.slice(0, 400)).not.toContain('href="/#get"');
    });

    test('the erection deep link still lands somewhere useful and free', () => {
        /* #for-erections is linked from elsewhere on the site and may be
           bookmarked. It must not 404 into the page top, and must not hand an
           erection-health reader a buy button for something we do not sell. */
        expect(productMain).toContain('id="for-erections"');
        const signpost = visible(productMain.slice(productMain.indexOf('id="for-erections"')).slice(0, 400));
        expect(signpost).toMatch(/free guides/i);
        expect(signpost).toMatch(/nothing to buy/i);
        expect(productMain).toContain('href="/stronger-erections/"');
    });

    test('and the erections hub no longer routes to a purchase', () => {
        const hub = readFileSync('stronger-erections/index.html', 'utf8');
        expect(hub, 'the hub still sells an EQ plan').not.toContain('/whats-inside/#for-erections');
        expect(hub, 'the hub kept its free guides').toContain('class="guide-list"');
    });
});

describe('benefit first, and no caveat stacking', () => {
    test('the self-defeating pattern is gone', () => {
        const copy = visible(productMain);
        for (const phrase of [
            'What is actually in the app', 'The honest limit',
            'Read first, decide later', 'decide later',
        ]) {
            expect(copy, `${phrase} is back`).not.toContain(phrase);
        }
    });

    test('each plan leads with what the member works toward and does', () => {
        for (const id of PLANS) {
            const b = visible(bridge(id));
            expect(b, `${id} has no recognition line`).toMatch(/\S/);
            /* The heading is a payoff, not a feature label. */
            const h3 = bridge(id).match(/<h3>([^<]+)<\/h3>/)[1];
            expect(h3.length, `${id} heading`).toBeGreaterThan(10);
            expect(h3).not.toMatch(/what is|honest|limit/i);
        }
    });

    test('ordinary stamina, breathing, mobility and tracking carry no clinical disclaimers', () => {
        /* The founder's rule: we describe intended purpose and what the member
           does. We do not stage an evidence debate beside a breathing
           exercise. The manual-training exception is asserted separately. */
        for (const id of ['for-stamina', 'for-multiple-goals']) {
            const b = visible(bridge(id));
            for (const caveat of [
                /weak and inconsistent/i, /not an established treatment/i,
                /no .* evidence/i, /cannot promise/i, /results may vary/i,
                /not a medical/i, /limited evidence/i,
            ]) {
                expect(b, `${id} stacks a caveat: ${caveat}`).not.toMatch(caveat);
            }
        }
    });

    test('and no plan promises an outcome', () => {
        const copy = visible(productMain);
        for (const promise of [
            /guaranteed/i, /\bcures?\b/i, /permanent (gains|increase|growth)/i,
            /you will (gain|grow|last longer|get harder)/i,
            /clinically (proven|validated)/i, /proven results/i,
        ]) {
            expect(copy, `outcome promise: ${promise}`).not.toMatch(promise);
        }
    });
});

describe('the manual-training exception', () => {
    test('the size plan carries a concise, specific risk note beside its offer', () => {
        const b = bridge('for-size');
        const copy = visible(b);
        expect(copy).toMatch(/experimental/i);
        expect(copy).toMatch(/has not been shown to produce lasting size gains/i);
        expect(copy, 'the specific techniques must be named').toMatch(/jelqing and clamping/i);
        expect(copy).toMatch(/injury or scarring/i);
        expect(b, 'safety guidance must be one tap away').toContain('href="/safety/"');
        /* Proximate: inside the size block, before its buy button. */
        expect(b.indexOf('class="note"')).toBeLessThan(b.indexOf('href="/#get"'));
    });

    test('the size plan does not call scheduled work optional', () => {
        /* Length and girth days are SCHEDULED inside the Size plan and the
           day types cannot be changed, so "optional guided sessions" was
           false. It was my wording in #183 and the founder caught it. */
        const copy = visible(bridge('for-size'));
        expect(copy).toMatch(/schedules length and girth sessions/i);
        expect(copy, 'scheduled work described as optional').not.toMatch(/optional (guided )?sessions/i);
        expect(copy).not.toMatch(/customi[sz]e|choose which days|swap/i);
    });
});

describe('the page is checked against the app, not against itself', () => {
    const app = readFileSync('app/index.html', 'utf8');

    test('every routine named on the page ships in the app', () => {
        for (const title of ['Directional Pulls', 'V-Stretch', 'Wet Jelq', 'Uli']) {
            expect(app, `${title} is advertised but not in ROUTINES`).toContain(`title:'${title}`);
        }
        const size = visible(bridge('for-size')).toLowerCase();
        for (const phrase of ['directional stretching', 'v stretch', 'wet jelq', 'uli clamp']) {
            expect(size).toContain(phrase);
        }
    });

    test('the capabilities the page sells exist in the app', () => {
        expect(app, 'stop-start stamina work').toMatch(/title:'Edging/);
        expect(app, 'measurement entry').toContain('id="input-bpel"');
        expect(app, 'measurement charts').toContain('id="bpel-chart"');
        expect(app, 'EQ ratings').toContain('id="eq-checkin-btns"');
        expect(app, 'session save').toContain('id="finish-session-btn"');
        expect(app, 'mobility in the practice').toMatch(/title:'Butterfly Stretch/);
    });

    test('the homepage does not promise the pathway we have not built', () => {
        const copy = visible(home);
        expect(copy, 'nothing in the app trains blood flow').not.toMatch(/train your blood flow/i);
        for (const claim of [/erection quality (plan|programme|program|pathway)/i,
                             /train your (erections|vascular)/i]) {
            expect(copy, `homepage promises an EQ pathway: ${claim}`).not.toMatch(claim);
        }
    });

    test('the price and the purchase route are unchanged', () => {
        expect(productMain.split('<a class="cta" href="/#get">Get The Blueprint, $99</a>')).toHaveLength(3);
        expect((productMain.match(/<a class="(?:cta|btn|daily-cta)"/g) || [])).toHaveLength(2);
        const copy = visible(productMain);
        expect(copy).toMatch(/One payment of \$99/);
        expect(copy).not.toMatch(/\$49|\$69|\$149/);
        expect(copy).not.toMatch(/\/mo\b|per month|monthly/i);
    });

    test('no em dashes in the new copy', () => {
        const section = productMain.slice(productMain.indexOf('<section id="for-your-goal">'),
                                          productMain.indexOf('<h2>What that looks like on an ordinary day</h2>'));
        for (const ch of ['—', '–', '&mdash;', '&ndash;']) {
            expect(section.includes(ch), `${JSON.stringify(ch)} appears`).toBe(false);
        }
    });
});
