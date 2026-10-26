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

describe('Stripe is the only purchase path', () => {
    const s = () => read('index.html');

    test('hidden purchase buttons never render as empty blue buttons', () => {
        /* The button carries no label in the markup, so it must stay hidden
           until the script gives it one. */
        expect(s()).toMatch(/\.btn\[hidden\]\{display:none!important\}/);
        expect(s()).toMatch(/<button class="btn" id="buy-onsite" type="button" hidden><\/button>/);
    });

    test('THE CHECKOUT IS LIVE', () => {
        expect(s()).toMatch(/var ON = true;/);
    });

    test('and the publishable key is present', () => {
        /* A publishable key is public by design. `enabled` also requires it,
           so an empty one would gate checkout even with ON true. */
        expect(s()).toMatch(/var PUBLISHABLE = 'pk_live_[A-Za-z0-9]+'/);
    });

    test('NO KO-FI PURCHASE PATH REMAINS ANYWHERE', () => {
        /* The reason this is absolute: after the price sweep the Ko-fi
           button read $99 and the Ko-fi product charges $49. A surviving
           link would sell the old price from a page advertising the new one. */
        for (const f of ['index.html', 'how-it-works/index.html', 'whats-inside/index.html',
            'faq/index.html', 'support/index.html', 'app/index.html']) {
            expect(read(f), `${f} still links a Ko-fi product`)
                .not.toMatch(/ko-fi\.com\/s\//);
        }
        expect(s(), 'the Ko-fi button is still in the markup')
            .not.toMatch(/id="buy-kofi"/);
    });

    test('THE IN-APP PURCHASE LINK POINTS AT THIS SITE', () => {
        /* app/index.html shows a buy link to a signed-in non-member. It used
           to point at the Ko-fi product. */
        const app = read('app/index.html');
        expect(app).toMatch(/const BUY_URL='https:\/\/theblueprint\.site\/#get'/);
        expect(app, 'KOFI_URL survives in the app').not.toMatch(/KOFI_URL/);
    });

    test('A FAILED CHECKOUT GIVES A SUPPORT PATH, NOT A WRONG PRICE', () => {
        const fn = s().slice(s().indexOf('function fail(e)'), s().indexOf('var loading'));
        expect(fn, 'the failure path reveals Ko-fi again').not.toMatch(/kofi/i);
        expect(fn).toMatch(/errEl\.hidden = false/);
        /* The button becomes retryable rather than vanishing. */
        expect(fn).toMatch(/Try again/);
        const copy = visible(s());
        expect(copy).toMatch(/you have not been charged/);
        expect(copy).toMatch(/Therealcoachtee@gmail\.com/);
    });

    test('failed checkout displays an actionable, sanitized diagnostic', () => {
        const fn = s().slice(s().indexOf('function fail(e)'), s().indexOf('var loading'));
        for (const m of ['Checkout server returned HTTP', 'Stripe payment script could not load',
            'did not initialize', 'incomplete session']) {
            expect(fn, `no diagnostic for: ${m}`).toContain(m);
        }
        expect(fn, 'a raw error body could reach the page').not.toMatch(/JSON\.stringify/);
    });

    test('A DISABLED OR UNCONFIGURED CHECKOUT IS NOT A SILENT DEAD END', () => {
        /* Ko-fi was the fallback, so a disabled flag used to leave a working
           button. With Ko-fi gone, nothing would be shown at all. */
        const src = s();
        expect(src).toMatch(/if \(!enabled\) \{/);
        expect(src).toMatch(/Checkout is switched off right now/);
        expect(src).toMatch(/Checkout is not configured right now/);
    });

    test('and a visitor without JavaScript is given a route', () => {
        expect(s()).toMatch(/<noscript>/);
        expect(visible(s())).toMatch(/Checkout needs JavaScript/);
    });

    test('THE PRICE IS $99 EVERYWHERE IT APPEARS', () => {
        const figs = [...s().matchAll(/class="fig"[^>]*>([^<]+)</g)].map(m => m[1].trim());
        expect(figs).toEqual(['$99']);
        /* Asserted on what a visitor reads. The source still says $49 in a
           comment explaining what the retired Ko-fi product charges, and
           that sentence is the reason the link had to go. */
        const copy = visible(s());
        expect(copy, 'an old price is shown to a visitor').not.toMatch(/\$49/);
        const ctas = [...copy.matchAll(/Start The Blueprint, (\$\d+)/g)].map(m => m[1]);
        for (const c of ctas) expect(c).toBe('$99');
    });

    test('THE BUTTON TAKES ITS PRICE FROM ONE SOURCE', () => {
        const src = s();
        expect(src).toMatch(/var PRICE_LABEL = '\$99';/);
        expect(src).toMatch(/var BUY_TEXT = 'Start The Blueprint, ' \+ PRICE_LABEL;/);
        const sets = [...src.matchAll(/onsite\.textContent = ([^;]+);/g)].map(m => m[1].trim());
        expect(sets.length).toBeGreaterThanOrEqual(2);
        for (const v of sets) {
            expect(v, `a price is written straight into the button: ${v}`)
                .not.toMatch(/\$\d/);
        }
    });

    test('and the four-way amount coupling is written down', () => {
        expect(s()).toMatch(/STRIPE_PRICE_CENTS/);
        expect(s()).toMatch(/FOUR THINGS THAT MUST AGREE/);
    });

    test('NO STALE CLAIM THAT KO-FI IS THE LIVE PATH', () => {
        /* The price sweep turned one comment into "Ko-fi is the live offer at
           $99", which was never true of a product charging $49. A file that
           lies about its own state is how the next person gets it wrong. */
        const src = s();
        expect(src).not.toMatch(/Ko-fi stands/);
        expect(src).not.toMatch(/Ko-fi is the live/);
        expect(src).not.toMatch(/Ko-fi stays the live purchase path/);
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

    test('AN UNVERIFIED RETURN PAGE MAKES NO PAYMENT OR ACCESS CLAIM', () => {
        const src = s();
        const html = visible(src);
        expect(html).toMatch(/Checking your payment/);
        expect(html).not.toMatch(/Payment received|Your payment is recorded/);
        expect(src).not.toMatch(/localStorage\.(getItem|key|length)/);
        expect(src).not.toMatch(/js\.stripe\.com|api\.stripe\.com/);
    });

    test('IT CHECKS SERVER-VERIFIED PAYMENT AND LEDGER BEFORE DISPLAYING SUCCESS', () => {
        const src = s();
        expect(src).toContain('/api/checkout-status?session_id=');
        expect(src).toContain("state==='verified'");
        expect(src).toContain('Payment verified.');
        expect(src).toContain('Payment not confirmed.');
        expect(src).toContain('Payment verification pending.');
        expect(src).toMatch(/fetch\('\/api\/checkout-status/);
        expect(src).not.toMatch(/Everything is unlocked|you now have access/i);
    });

    test('IT PROVIDES A SUPPORT PATH FOR INCOMPLETE OR DISPUTED PURCHASES', () => {
        const src = s();
        expect(src).toContain('do not pay again');
        expect(src).toContain('/support/');
        expect(src).toContain('/#get');
        expect(src).toContain('no-referrer');
    });

});
