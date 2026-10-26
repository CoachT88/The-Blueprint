import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE ADVERTISED PRICE AND THE PURCHASE PATH MUST AGREE.
 *
 * This file exists because of a specific, demonstrated failure mode, and it
 * is deliberately NOT part of the commit that switched the site to Stripe.
 *
 * The launch is two separable halves: fifteen commits that moved the price
 * copy from $49 to $99, and one commit that replaced Ko-fi with Stripe. The
 * only coherent rollback reverts the whole merge, which puts both halves
 * back together. Reverting the Stripe commit ALONE is silently green:
 *
 *     git revert 8efb474      # the switch commit, on its own
 *     grep -c ko-fi.com index.html   -> 1     the $49 product, back
 *     grep -c '\$99'        index.html   -> 7     the copy, untouched
 *     grep -c '\$49'        index.html   -> 0
 *     npx vitest run tests/checkoutMount.test.js  -> 30 passed
 *
 * Thirty tests pass on a home page that advertises $99 and sends the buyer
 * to a product charging $49. They pass because that revert takes the tests
 * with it: checkoutMount.test.js was rewritten in the same commit, so
 * undoing the commit restores the version that permitted Ko-fi. A test
 * cannot guard the commit it ships in.
 *
 * The price assertions in landingCss, siteNav, learnGuides and assessment
 * survive that revert, because they belong to the sweep commits. What does
 * not survive is any statement that Ko-fi is not a purchase path. So that
 * statement lives here, in its own commit after the switch, where a partial
 * revert leaves it standing and failing.
 *
 * A full revert of the merge removes this file along with the $99 copy, and
 * that is correct: $49 copy with a $49 Ko-fi button is coherent.
 *
 * docs/stripe-launch-rollback.md is the procedure.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.github', '.claude', 'tests', 'tools', 'docs']);

function publicPages(dir = ROOT, found = []) {
    for (const name of readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (SKIP.has(name)) continue;
        if (statSync(abs).isDirectory()) publicPages(abs, found);
        else if (name.endsWith('.html')) found.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
    return found;
}

describe('the advertised price and the purchase path agree', () => {
    const pages = publicPages();

    test('there are pages to check at all', () => {
        /* A broken walk would make every assertion below vacuous. */
        expect(pages).toContain('index.html');
        expect(pages).toContain('app/index.html');
        expect(pages.length).toBeGreaterThan(15);
    });

    test('NO PAGE SENDS A BUYER TO KO-FI', () => {
        /* Asserted on links, not on prose. The FAQ and the support page name
           Ko-fi on purpose, because a man who bought there before October
           2026 still signs in with that address and needs to read that his
           access carries over. Naming it is required; linking to it is the
           defect, because the product behind the link charges $49. */
        const linking = pages.filter((p) => {
            const html = readFileSync(path.join(ROOT, p), 'utf8');
            return /(?:href|src|window\.location|location\.href|BUY_URL)\s*=?\s*["'][^"']*ko-?fi\.com/i.test(html)
                || /<a[^>]+ko-?fi\.com/i.test(html);
        });
        expect(linking, `pages advertising $99 that link to the $49 Ko-fi product: ${linking.join(', ')}`)
            .toEqual([]);
    });

    test('and no page ships a Ko-fi widget or script', () => {
        /* The overlay widget is a purchase path too, and it does not look
           like an anchor. */
        const widget = pages.filter((p) => {
            const html = readFileSync(path.join(ROOT, p), 'utf8');
            return /kofiwidget|ko-?fi\.com\/(?:widgets|overlay)/i.test(html);
        });
        expect(widget, `pages with a Ko-fi widget: ${widget.join(', ')}`).toEqual([]);
    });

    test('the in-app buy link points at this site, not a processor', () => {
        /* app/index.html used to hold the Ko-fi URL directly, so an existing
           member upgrading from inside the app took a different path from a
           visitor on the home page, at a different price. There is one
           route now and it is the home page's own. */
        const app = readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
        const m = /const BUY_URL\s*=\s*'([^']+)'/.exec(app);
        expect(m, 'app/index.html no longer defines BUY_URL').not.toBeNull();
        expect(m[1]).toBe('https://theblueprint.site/#get');
    });
});
