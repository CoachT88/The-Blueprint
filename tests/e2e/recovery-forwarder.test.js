import { describe, test, expect } from 'vitest';
import { openApp } from './harness.js';

/**
 * The root page must not swallow a password reset link.
 *
 * THE REPORTED DEFECT. On iPhone, tapping the reset link in the email lands
 * the member on the sales page at `/`, not on `/app/`. The sales page has no
 * recovery handling of any kind, so the member is shown the product they
 * already own and has no way to set a password. On desktop the same link
 * reaches `/app/` and works.
 *
 * WHY THE PLATFORMS DIFFER IS NOT ESTABLISHED, and these tests do not claim
 * to establish it. `_appUrl()` asks for `origin + '/app/'` on every platform,
 * which the recovery suite pins, so the divergence is downstream of our
 * client: a Supabase Site URL fallback when the redirect is not allow-listed,
 * or an iOS mail client rewriting the link. The forwarder is correct under
 * either, because in both cases the member arrives at `/` still holding the
 * token.
 *
 * WHAT THESE TESTS COVER, which the recovery suite cannot: the navigation
 * itself. Every case here starts at `/` and asserts where the browser ends
 * up, with the credential carried across intact. Two of them follow it all
 * the way through to the screen the member needs, so the forward is proven to
 * arrive somewhere useful rather than merely to happen.
 *
 * The negative cases matter as much as the positive ones. A forwarder that
 * fires on an ordinary marketing link would push prospects off the page that
 * sells to them, which is a worse bug than the one being fixed.
 */

const SALES = 'The Blueprint: your sexual performance can be trained';
const APP = 'THE BLUEPRINT | Session Pilot';

/** Land at `entry`, let any client-side forward settle, report where we are. */
async function landing(entry, after) {
    const app = await openApp({ entry });
    try {
        const o = await app.page.evaluate(() => ({
            path: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash,
            title: document.title,
        }));
        return after ? { ...o, ...(await after(app)) } : o;
    } finally {
        await app.close();
    }
}

describe('a recovery link that arrives at the root is forwarded', () => {
    test('A LEGACY FRAGMENT LINK REACHES THE SET NEW PASSWORD SCREEN', async () => {
        /* The whole defect, end to end: start where the iPhone member starts,
           and finish on the form. Nothing in this test touches the recovery
           code directly; the app boots from the forwarded URL on its own. */
        const o = await landing('/#access_token=abc123&refresh_token=r1&type=recovery',
            async (app) => await app.page.evaluate(() => ({
                modal: document.getElementById('password-reset-modal').classList.contains('show'),
                recovery: _recoveryMode,
            })));
        expect(o.path).toBe('/app/');
        expect(o.title).toBe(APP);
        /* The token survived the hop. Dropping the fragment would forward the
           member to an app that cannot help them, which looks fixed and is
           not. */
        expect(o.hash).toContain('access_token=abc123');
        expect(o.hash).toContain('type=recovery');
        expect(o.modal).toBe(true);
        expect(o.recovery).toBe(true);
    }, 120_000);

    test('AN EXPIRED LINK REACHES THE MESSAGE THAT SAYS SO', async () => {
        /* A dead link must say it is dead. Before the forwarder this member
           saw the sales page and had no idea why nothing happened. */
        const o = await landing(
            '/?error_code=otp_expired&error=access_denied&error_description=Email+link+is+invalid+or+has+expired',
            async (app) => await app.page.evaluate(() => ({
                authVisible: !document.getElementById('auth-screen').classList.contains('hidden'),
                authErr: document.getElementById('auth-error').textContent,
                modal: document.getElementById('password-reset-modal').classList.contains('show'),
            })));
        expect(o.path).toBe('/app/');
        expect(o.authVisible).toBe(true);
        expect(o.authErr).toContain('expired');
        /* No form, because there is no session to change a password with. */
        expect(o.modal).toBe(false);
    }, 120_000);

    test('a PKCE code in the query is forwarded, query intact', async () => {
        /* The modern flow puts a code in the query rather than a token in the
           fragment. supabase-js on /app/ exchanges it; the root page only has
           to deliver it. */
        const o = await landing('/?code=pkce-abc-123');
        expect(o.path).toBe('/app/');
        expect(o.search).toBe('?code=pkce-abc-123');
    }, 120_000);

    test('query AND fragment both survive, in the right order', async () => {
        const o = await landing('/?code=pkce-1#access_token=tok&type=recovery');
        expect(o.path).toBe('/app/');
        expect(o.search).toBe('?code=pkce-1');
        expect(o.hash).toContain('access_token=tok');
    }, 120_000);

    test('the forward REPLACES, so Back cannot strand the member', async () => {
        /* With a push instead of a replace, Back returns to a sales page that
           immediately forwards again: a loop the member cannot escape. With a
           replace there is no '/' entry in history at all, so Back leaves the
           site rather than bouncing. */
        const o = await landing('/#access_token=abc&type=recovery', async (app) => {
            await app.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await app.page.waitForTimeout(400);
            return { backUrl: app.page.url() };
        });
        expect(o.path).toBe('/app/');
        /* The sales page is not behind the app. What is behind it is the tab's
           own blank start page, which is to say nothing. */
        expect(o.backUrl).not.toMatch(/\/$|\/index\.html$/);
        expect(o.backUrl).not.toContain('access_token');
    }, 120_000);
});

describe('ordinary navigation to the sales page is untouched', () => {
    test('A PLAIN VISIT STAYS ON THE SALES PAGE', async () => {
        const o = await landing('/');
        expect(o.path).toBe('/');
        expect(o.title).toBe(SALES);
    }, 120_000);

    test('A MARKETING LINK WITH A DISCOUNT CODE STAYS PUT', async () => {
        /* The reason the match is anchored to a parameter boundary instead of
           being a substring search for 'code='. A prospect sent off the sales
           page and into an app they cannot sign into is a worse outcome than
           the defect this change fixes. */
        const o = await landing('/?discount_code=LAUNCH20');
        expect(o.path).toBe('/');
        expect(o.title).toBe(SALES);
    }, 120_000);

    test('campaign parameters stay put', async () => {
        const o = await landing('/?utm_source=ig&utm_campaign=spring&ref=partner');
        expect(o.path).toBe('/');
        expect(o.title).toBe(SALES);
    }, 120_000);

    test('an in-page anchor stays put', async () => {
        const o = await landing('/#pricing');
        expect(o.path).toBe('/');
        expect(o.title).toBe(SALES);
        expect(o.hash).toBe('#pricing');
    }, 120_000);
});
