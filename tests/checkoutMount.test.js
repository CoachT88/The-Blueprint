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

    test('NO PUBLISHABLE KEY IS COMMITTED, WHICH ALSO KEEPS IT OFF', () => {
        /* enabled requires PUBLISHABLE to be truthy, so an empty key is a
           second independent reason nothing changes. */
        expect(s()).toMatch(/var PUBLISHABLE = '';/);
        expect(s()).not.toMatch(/pk_live_[A-Za-z0-9]/);
        expect(s()).not.toMatch(/pk_test_[A-Za-z0-9]{10}/);
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

    test('both buttons quote the same price, so the flag cannot change it', () => {
        const prices = [...s().matchAll(/Start The Blueprint, (\$\d+)/g)].map(m => m[1]);
        expect(prices.length).toBeGreaterThanOrEqual(2);
        expect(new Set(prices).size, `buttons disagree: ${prices.join(', ')}`).toBe(1);
    });

    test('THE DISPLAYED PRICE IS UNCHANGED AT $49', () => {
        /* Pricing is not approved to change. tests/siteNav.test.js locks the
           headline figure; this locks the buttons alongside it. */
        const figs = [...s().matchAll(/class="fig"[^>]*>([^<]+)</g)].map(m => m[1].trim());
        expect(figs).toEqual(['$49']);
        /* The page carries more than two of these: the hero CTA as well as
           the pair in the price block. Every one of them must say $49. */
        const ctas = [...s().matchAll(/Start The Blueprint, (\$\d+)/g)].map(m => m[1]);
        expect(ctas.length).toBeGreaterThanOrEqual(2);
        expect([...new Set(ctas)], `CTAs disagree: ${ctas.join(', ')}`).toEqual(['$49']);
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
