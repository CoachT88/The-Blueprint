import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp } from './harness.js';

/**
 * checkMembership used to return true from its catch block, so any network
 * failure granted access to anyone. It now extends trust only to a device that
 * has already verified that user. A genuine denial must still refuse, clear any
 * cached pass, and point the person at where to buy.
 */
describe('membership denial', () => {
    let app, denied;
    beforeAll(async () => {
        app = await openApp({ row: null }); // no members row for this email
        denied = await app.page.evaluate(async () => {
            /* Membership authority is now the Supabase user UUID, and
               claim_membership() reads it from the session rather than from
               anything the caller passes. So a denial test has to establish a
               session: handing checkMembership an email proves nothing any
               more, which is the point of the cutover. This member has a
               session and no purchase row. */
            window.__members = [];
            window.__session = { user: { id: 'x', email: 'nobody@example.com' },
                                 access_token: 'stub' };
            const allowed = await checkMembership({ id: 'x', email: 'nobody@example.com' });
            const el = document.getElementById('auth-error');
            const a = el.querySelector('a');
            return {
                allowed,
                text: el.textContent,
                href: a ? a.getAttribute('href') : null,
                target: a ? a.getAttribute('target') : null,
                rel: a ? a.getAttribute('rel') : null,
                visible: el.classList.contains('show'),
            };
        });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('access is refused', () => {
        expect(denied.allowed).toBe(false);
        expect(denied.visible).toBe(true);
    });

    test('the message explains the email must match the purchase', () => {
        expect(denied.text).toMatch(/same email you purchased with/i);
        expect(denied.text).toMatch(/wait|minute/i);
    });

    test('it links to the storefront safely', () => {
        expect(denied.href).toBe('https://ko-fi.com/s/75a70cb698');
        expect(denied.target).toBe('_blank');
        expect(denied.rel).toMatch(/noopener/);
    });

    test('Whop is no longer named to new buyers', () => {
        expect(denied.text).not.toMatch(/whop/i);
        expect(app.errors).toEqual([]);
    });

    test('a denial clears any cached membership pass', async () => {
        const cached = await app.page.evaluate(() => localStorage.getItem('bp_member_ok_x'));
        expect(cached).toBeNull();
    });
});
