import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOINDEX, PAGES, sitemap } from '../tools/sync-site-nav.mjs';

/**
 * THE ON-SITE CHECKOUT MOUNT, AND THE TWO PROPERTIES IT MUST NOT LOSE.
 *
 * 1. Ko-fi keeps working. The flag is off, so a visitor sees exactly what
 *    they saw before, and a broken checkout falls back rather than becoming
 *    a dead end for someone who wants to pay.
 *
 * 2. Stripe is contacted on click, never on page load. Every page here is
 *    self-contained on purpose, because a man reading about erectile
 *    function should not have the visit announced to a third party. A
 *    script tag for js.stripe.com in the markup would announce every
 *    home-page visit, including from people who never buy.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/**
 * Markup with HTML comments removed and inline script BODIES emptied, so
 * neither an HTML comment nor a URL written inside a JavaScript comment can
 * be mistaken for a real script tag. The opening tag is kept, so a genuine
 * src attribute is still found.
 *
 * Both of those caught me: the source explains the no-third-party rule in a
 * JS comment that necessarily contains the Stripe URL inside angle brackets.
 */
const markup = (html) => html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');

/** The words a visitor actually reads. */
const visible = (html) => html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('Stripe is contacted on click, never on page load', () => {
    test('NO SCRIPT TAG LOADS STRIPE.JS FROM THE MARKUP', () => {
        /* Checked on comment-stripped markup. The source explains the rule
           in a comment that necessarily contains the URL, and an earlier
           grep of mine matched that comment and looked like a violation. */
        const tags = [...markup(read('index.html'))
            .matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
        for (const src of tags) {
            expect(src, `a script tag loads ${src}`).not.toMatch(/stripe/i);
        }
    });

    test('and no page gains any third-party script tag', () => {
        for (const p of [...PAGES, ...NOINDEX]) {
            const tags = [...markup(read(p))
                .matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
            for (const src of tags) {
                expect(/^https?:\/\//i.test(src), `${p} loads ${src}`).toBe(false);
            }
        }
    });

    test('THE SCRIPT IS INJECTED BY THE CLICK HANDLER', () => {
        const s = read('index.html');
        /* The loader exists, is lazy, and is reached from the click. */
        expect(s).toMatch(/function loadStripe\(\)/);
        expect(s).toMatch(/createElement\('script'\)/);
        expect(s).toMatch(/js\.stripe\.com/);
        const click = s.slice(s.indexOf("onsite.addEventListener('click'"));
        expect(click, 'the click handler does not load Stripe').toMatch(/loadStripe\(\)/);
    });

    test('the loader is not called at startup', () => {
        const s = read('index.html');
        const iife = s.slice(s.indexOf('/* ON-SITE CHECKOUT, OFF BY DEFAULT.'));
        const body = iife.slice(0, iife.indexOf("onsite.addEventListener('click'"));
        expect(body, 'loadStripe runs before any click').not.toMatch(/loadStripe\(\);/);
    });
});

describe('Ko-fi keeps working', () => {
    const s = () => read('index.html');

    test('THE FLAG IS OFF, SO THE LIVE PAGE IS UNCHANGED', () => {
        expect(s()).toMatch(/var ON = false;/);
    });

    test('live publishable key is public, but Ko-fi remains the default path', () => {
        /* The public key is not a server credential. Only an explicit
           ?checkout=1 query opts into the Stripe UI while ON stays false. */
        expect(s()).toMatch(/var PUBLISHABLE = 'pk_live_[A-Za-z0-9]+'/);
        expect(s()).toMatch(/var ON = false;/);
        expect(s()).toContain("params.get('checkout') === '1'");
        expect(s()).toMatch(/var enabled = \(ON \|\| params\.get\('checkout'\) === '1'\) && PUBLISHABLE;/);
        expect(s()).not.toMatch(/sk_live_[A-Za-z0-9]{10}/);
        expect(s()).not.toMatch(/rk_live_[A-Za-z0-9]{10}/);
        expect(s()).not.toMatch(/whsec_[A-Za-z0-9]{10}/);
    });

    test('the Ko-fi link and its product code are still on the page', () => {
        expect(s()).toContain('https://ko-fi.com/s/75a70cb698');
    });

    test('A FAILED CHECKOUT RESTORES THE KO-FI PATH', () => {
        /* A broken checkout must not be a dead end for someone who wants to
           buy. */
        const fn = s().slice(s().indexOf('function fail()'), s().indexOf('var loading'));
        expect(fn).toMatch(/kofi\.hidden = false/);
        expect(fn).toMatch(/noteKofi\.hidden = false/);
    });

    test('THE LIVE KO-FI OFFER IS STILL $49 EVERYWHERE IT APPEARS', () => {
        /* Pricing is not approved to change. tests/siteNav.test.js locks the
           headline figure; this locks every price written in the markup
           alongside it. The on-site button carries no price in the markup at
           all, so it cannot appear here. */
        const figs = [...s().matchAll(/class="fig"[^>]*>([^<]+)</g)].map(m => m[1].trim());
        expect(figs).toEqual(['$49']);
        const written = [...s().matchAll(/Start The Blueprint, (\$\d+)/g)].map(m => m[1]);
        expect(written.length, 'no Ko-fi CTA carries a price').toBeGreaterThanOrEqual(1);
        expect([...new Set(written)], `markup prices disagree: ${written.join(', ')}`)
            .toEqual(['$49']);
    });

    test('THE ON-SITE BUTTON TAKES ITS PRICE FROM ONE SOURCE', () => {
        /* The Stripe price is $99 in test mode while Ko-fi stays $49. The
           button must therefore not carry a hardcoded figure, and must not
           carry the Ko-fi one. */
        const src = s();
        expect(src, 'the on-site button hardcodes a price in the markup')
            .toMatch(/<button class="btn" id="buy-onsite" type="button" hidden><\/button>/);
        expect(src).toMatch(/var PRICE_LABEL = '\$\d+';/);
        expect(src).toMatch(/var BUY_TEXT = 'Start The Blueprint, ' \+ PRICE_LABEL;/);
        /* Both the reveal and the failure reset read BUY_TEXT, so there is
           no second place a price can be typed. A transient label such as
           "Opening..." is fine; a price written inline is not. */
        const sets = [...src.matchAll(/onsite\.textContent = ([^;]+);/g)].map(m => m[1].trim());
        expect(sets.filter(v => v === 'BUY_TEXT').length,
            'the button label is not driven from BUY_TEXT in both places')
            .toBeGreaterThanOrEqual(2);
        for (const v of sets) {
            expect(v, `a price is written straight into the button: ${v}`)
                .not.toMatch(/\$\d/);
        }
    });

    test('THE ON-SITE PRICE IS THE STRIPE PRICE, NOT THE KO-FI PRICE', () => {
        const label = s().match(/var PRICE_LABEL = '(\$\d+)';/);
        expect(label).not.toBeNull();
        expect(label[1], 'PRICE_LABEL matches Ko-fi, so the Stripe price is wrong here')
            .toBe('$99');
    });

    test('and the four-way amount coupling is written down', () => {
        /* Page label, Stripe Price, STRIPE_PRICE_CENTS and the headline
           figure must agree or the webhook refuses the payment. A refusal is
           the safe failure and still a dead checkout, so the next person
           needs to know they move together. */
        const src = s();
        expect(src).toMatch(/STRIPE_PRICE_CENTS/);
        expect(src).toMatch(/FOUR THINGS THAT MUST AGREE/);
    });

    test('THE PAGE PROMISES TAX HANDLING ONLY IF THE CODE DOES IT', () => {
        /* The Price carries tax_behavior=exclusive, which means tax would be
           added on top of $99. But the session endpoint does not set
           automatic_tax, so no tax is calculated or collected, and a note
           saying tax "is shown before you confirm" was a promise the system
           does not keep.
           Asserted as a coupling rather than as fixed copy, so the two
           cannot drift apart: enable automatic_tax and the note must gain
           the sentence; leave it off and the note must not claim it. */
        const copy = visible(s());
        const endpoint = read('functions/api/create-checkout-session.js');
        const taxOn = /automatic_tax/.test(endpoint);
        const claimsTax = /\btax\b|\bVAT\b/i.test(copy);

        if (taxOn) {
            expect(claimsTax,
                'automatic_tax is enabled but the page tells nobody tax is added')
                .toBe(true);
        } else {
            expect(claimsTax,
                'the page promises tax handling while automatic_tax is off')
                .toBe(false);
        }

        /* Either way the button itself must not claim a total it cannot
           compute, since tax depends on the buyer's location. */
        expect(s(), 'the button text claims a tax-inclusive total')
            .not.toMatch(/BUY_TEXT[^;]*tax/i);
    });

    test('and the webhook compares the PRE-TAX amount', () => {
        /* tax_behavior=exclusive puts tax on top of the price, so
           amount_total exceeds it and comparing the total would refuse every
           taxed purchase the moment automatic_tax is switched on. */
        const hook = read('functions/api/stripe-webhook.js');
        expect(hook).toMatch(/session\.amount_subtotal/);
        expect(hook).toMatch(/amount_subtotal[\s\S]{0,80}amount_total/);
    });
});

describe('the uid is never taken from the page', () => {
    test('THE PAGE SENDS A TOKEN, NOT AN IDENTITY', () => {
        /* client_reference_id decides which account an entitlement attaches
           to. The endpoint derives it from a token Supabase verifies; the
           page must not be able to name it. */
        const s = read('index.html');
        const click = s.slice(s.indexOf("onsite.addEventListener('click'"));
        expect(click).toMatch(/Authorization/);
        expect(click, 'the page sends a uid in the request body')
            .not.toMatch(/client_reference_id|user_id|uid:/);
        /* A POST with no body at all is the strongest form of that. */
        expect(click).toMatch(/method: 'POST', headers: headers \}/);
    });
});

describe('the welcome page', () => {
    const s = () => read('welcome/index.html');

    test('IT IS NOINDEX, AND ABSENT FROM THE SITEMAP', () => {
        /* Its URL carries a Stripe session id and it only means anything to
           someone who just paid. */
        expect(s()).toMatch(/<meta name="robots" content="noindex, nofollow">/);
        expect(NOINDEX).toContain('welcome/index.html');
        expect(PAGES, 'welcome is in PAGES, so it would be in the sitemap')
            .not.toContain('welcome/index.html');
        expect(sitemap(), 'welcome reached the sitemap').not.toMatch(/welcome/);
    });

    test('it still carries the shared header and the design system', () => {
        expect(s()).toMatch(/<!-- SITE-NAV:START -->/);
        expect(s()).toMatch(/\/\* GUIDE-CSS:START \*\//);
        expect(s()).toMatch(/<link rel="canonical" href="https:\/\/theblueprint\.site\/welcome\/">/);
    });

    test('THE SESSION ID IN THE URL GRANTS NOTHING', () => {
        /* The webhook is the only thing that grants access. Trusting a query
           parameter would let anyone unlock the app by typing one. */
        const src = s();
        expect(src, 'the page reads session_id').not.toMatch(/get\(['"]session_id/);
        expect(src, 'the page uses the session id to decide something')
            .not.toMatch(/session_id/);
        /* Matched loosely because the sentence wraps across comment lines. */
        expect(src).toMatch(/is not read[\s\S]{0,60}used to decide anything/);
    });

    test('it contacts no payment processor', () => {
        expect(s()).not.toMatch(/js\.stripe\.com|api\.stripe\.com/);
    });

    test('a slow activation is not presented as an error', () => {
        /* The webhook is authoritative and has almost certainly already
           run. Saying something went wrong would be false and would
           frighten someone who has just paid. */
        const copy = visible(s());
        expect(copy).toMatch(/Your purchase is recorded/);
        expect(copy).toMatch(/Nothing is lost/);
        /* Asserted on the visible copy. The source comment explains the rule
           using the exact words the copy must avoid, so checking the source
           failed on the explanation rather than on the page. */
        expect(copy, 'the slow path claims a failure')
            .not.toMatch(/went wrong|something failed|error occurred/i);
    });

    test('and it names the different-address route without promising a typed claim', () => {
        const src = s();
        expect(src).toMatch(/Paid with a different email address/);
        expect(src).toMatch(/confirmed by email/);
    });
});
