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
        expect(productMain).toContain('href="/stronger-erections/"');
    });

    test('and it does not argue against the sale on its way out', () => {
        /* REVIEW CORRECTION. The signpost used to end "Nothing to buy."
           That is the same self-discouraging move as the caution blocks this
           page removed, just shorter: it raises the question of buying in
           order to answer no. The signpost points at free reading and stops.
           It does not discuss what is or is not for sale. */
        const copy = visible(productMain);
        for (const selling of [/nothing to buy/i, /not for sale/i, /no plan to buy/i,
                               /we do not sell/i, /nothing on offer/i]) {
            expect(copy, `self-discouraging aside: ${selling}`).not.toMatch(selling);
        }
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
           exercise. The manual-training exception is asserted separately.

           for-multiple-goals is NOT in this list any more. It schedules the
           same manual length and girth work as the Size plan, so it carries
           the same risk note by design: see the manual-training exception
           below. The evidence-debate patterns are still forbidden there. */
        const b = visible(bridge('for-stamina'));
        for (const caveat of [
            /weak and inconsistent/i, /not an established treatment/i,
            /no .* evidence/i, /cannot promise/i, /results may vary/i,
            /not a medical/i, /limited evidence/i,
        ]) {
            expect(b, `for-stamina stacks a caveat: ${caveat}`).not.toMatch(caveat);
        }
    });

    test('no plan stages an evidence debate, including the combined one', () => {
        for (const id of PLANS) {
            const b = visible(bridge(id));
            for (const debate of [
                /weak and inconsistent/i, /not an established treatment/i,
                /limited evidence/i, /cannot promise/i, /results may vary/i,
            ]) {
                expect(b, `${id} stages an evidence debate: ${debate}`).not.toMatch(debate);
            }
        }
    });

    test('and nothing claims a general truth about what most men do', () => {
        /* REVIEW CORRECTION. Four lines asserted broad causal facts we cannot
           support: that most men never practise control, that trying harder
           "is why nothing changes", that reviewable practice is "the
           difference between people who improve and people who mean to", and
           that most men stall on forum routines. The payoff stays; the
           certainty about other people's outcomes goes. */
        const copy = visible(productMain);
        for (const claim of [
            /most men/i, /most of them/i, /why nothing changes/i,
            /people who mean to/i, /everyone else/i, /\bmost guys\b/i,
            /the difference between people who/i,
        ]) {
            expect(copy, `unsupported general claim: ${claim}`).not.toMatch(claim);
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

    test('THE COMBINED PLAN CARRIES IT TOO, BECAUSE IT SCHEDULES THE SAME WORK', () => {
        /* REVIEW CORRECTION. The combined plan schedules length and girth
           days and has its own buy button, so a reader who jumps straight to
           #for-multiple-goals was sold manual training with no risk note at
           all. Concise rather than a second long block: it points at the
           Size plan for the detail and carries the three material facts. */
        const b = bridge('for-multiple-goals');
        const copy = visible(b);
        expect(copy).toMatch(/manual length and girth/i);
        expect(copy).toMatch(/experimental/i);
        expect(copy).toMatch(/lasting size gains/i);
        expect(copy).toMatch(/injury or scarring/i);
        expect(b, 'safety guidance must be one tap away').toContain('href="/safety/"');
        expect(b.indexOf('class="note"')).toBeLessThan(b.indexOf('href="/#get"'));
        /* Concise: no longer than the Size note it refers to. Measure the
           note itself, not the rest of the block, or the CTA wording decides
           the result. */
        const noteOf = id => {
            const b = bridge(id);
            const start = b.indexOf('<p class="note">');
            return visible(b.slice(start, b.indexOf('</p>', start))).trim();
        };
        expect(noteOf('for-multiple-goals').length)
            .toBeLessThanOrEqual(noteOf('for-size').length);
    });

    test('every plan that schedules manual work discloses it, and only those', () => {
        /* The rule, rather than two hand-written cases: a plan that names
           length or girth work must carry the note; one that does not must
           not acquire it. */
        for (const id of PLANS) {
            const copy = visible(bridge(id));
            const schedulesManual = /length and girth/i.test(copy);
            expect(/experimental/i.test(copy),
                `${id}: schedulesManual=${schedulesManual} but note presence disagrees`)
                .toBe(schedulesManual);
        }
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

    test('NOWHERE ON THE SITE CALLS SCHEDULED MANUAL WORK OPTIONAL', () => {
        /* REVIEW CORRECTION, and it was in four more places than the one the
           review named. Length and girth days are scheduled on the Size and
           combined plans and the day types cannot be changed once a plan is
           running, so "optional" was false everywhere it appeared:

             whats-inside  the "read the longer version" link
             how-it-works  the page lead, and "Explore at your pace"
             index         the purchase-block aside, and the six-areas detail

           Checked across the pages that make the claim rather than only the
           one file under review, because a buyer follows the link. */
        const pages = {
            'whats-inside/index.html': product,
            'how-it-works/index.html': readFileSync('how-it-works/index.html', 'utf8'),
            'index.html': home,
        };
        for (const [name, html] of Object.entries(pages)) {
            const copy = visible(html);
            for (const lie of [
                /optional (guided )?(manual )?(length|girth)/i,
                /(length|girth)[^.]{0,30}\bare optional\b/i,
                /(length|girth)[^.]{0,30}\bis optional\b/i,
                /those sessions are optional/i,
                /optional guided manual sessions/i,
            ]) {
                expect(copy, `${name} calls scheduled manual work optional: ${lie}`)
                    .not.toMatch(lie);
            }
        }
    });

    test('and the longer-version link still goes somewhere that agrees with it', () => {
        /* The review asked me to check the destination, not just the link. */
        const hiw = visible(readFileSync('how-it-works/index.html', 'utf8'));
        expect(hiw).toMatch(/length and girth sessions are scheduled/i);
        expect(hiw, 'the destination sells an EQ choice we do not offer')
            .not.toMatch(/choices include[^.]*erection quality/i);
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
