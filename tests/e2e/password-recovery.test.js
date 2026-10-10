import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Password recovery, both link shapes.
 *
 * THE LOCKOUT THIS COVERS. Recovery used to be detected only from a URL
 * fragment (#access_token=...&type=recovery). supabase-js consumes the modern
 * link before any app code runs, so there is no fragment left to find and the
 * only signal is a PASSWORD_RECOVERY event. A member on a current project
 * therefore landed on /app/ fully signed in and was never offered a password
 * form. Both shapes are covered here, and neither is allowed to regress.
 *
 * What these tests cannot cover: whether Supabase sends the member to the
 * right origin in the first place. The redirect target is dashboard
 * configuration, not app code, and `_appUrl()` already asks for the current
 * origin. See the report.
 */

const row = () => ({
    id: 'rec', total_xp: 0, difficulty: 'beginner',
    schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
    completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 0, xp_migrated: true, week_key: '',
    primary_goal: 'size', programme: null, day_plans: [], pelvic_profile: 'standard',
    updated_at: '2026-03-12T00:00:00.000Z',
});

/** Is the Set New Password modal the thing on screen? */
const state = (page) => page.evaluate(() => ({
    modal:   document.getElementById('password-reset-modal').classList.contains('show'),
    loading: !document.getElementById('loading-screen').classList.contains('hidden'),
    auth:    !document.getElementById('auth-screen').classList.contains('hidden'),
    recovery: _recoveryMode,
    err:  document.getElementById('pwd-reset-error').innerText,
    ok:   document.getElementById('pwd-reset-success').innerText,
    authErr: document.getElementById('auth-error').textContent,
    hash: window.location.hash,
    passwordUpdates: window.__passwordUpdates || [],
}));

/** Type a pair of passwords and tap the real button. */
const submit = (page, pwd, conf) => page.evaluate(({ pwd, conf }) => {
    document.getElementById('new-password-input').value = pwd;
    document.getElementById('new-password-confirm').value = conf === undefined ? pwd : conf;
    document.getElementById('pwd-reset-submit-btn').click();
    return new Promise(r => setTimeout(r, 120));
}, { pwd, conf });

describe('the supported PASSWORD_RECOVERY event', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({});
        await app.page.evaluate((r) => { window.__rowsByUser = { rec: r }; }, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('THE EVENT ALONE OPENS THE SET NEW PASSWORD SCREEN', async () => {
        /* No fragment anywhere: this is exactly the modern link, already
           consumed by supabase-js. Before the fix nothing happened here. */
        await app.page.evaluate(() => {
            window.__authUser = { id: 'rec', email: 'rec@example.com', user_metadata: {} };
            window.__fireAuth('PASSWORD_RECOVERY',
                { user: window.__authUser, access_token: 'recovery' });
        });
        const s = await state(app.page);
        expect(s.modal).toBe(true);
        expect(s.recovery).toBe(true);
        /* And it is actually visible: a recovery event can arrive while the
           loading screen is still up. */
        expect(s.loading).toBe(false);
        expect(s.auth).toBe(false);
    }, 60_000);

    test('a signed-in callback during recovery cannot bury the modal', async () => {
        /* A recovery session IS a session, so SIGNED_IN and the initial
           session callback both arrive. Booting the app underneath is what
           used to hide the form.

           This fixture has no members row, which is not incidental: the man
           most likely to be resetting his password is the man who cannot get
           in. Letting the normal signed-in path run during recovery sends him
           through checkMembership, which signs him out and raises the auth
           screen over the form at z-99999, so the one thing he came for
           disappears. */
        await app.page.evaluate(async () => {
            window.__fireAuth('SIGNED_IN', { user: window.__authUser, access_token: 'recovery' });
            await new Promise(r => setTimeout(r, 400));
        });
        const s = await state(app.page);
        expect(s.modal).toBe(true);
        expect(s.recovery).toBe(true);
        /* "Not buried" means not covered. Asserting the class alone passes
           even while the auth screen sits on top of it, which is what a
           mutation of the recovery re-assert proved. */
        expect(s.auth).toBe(false);
        expect(s.loading).toBe(false);
    }, 60_000);

    test('a password under 6 characters is refused locally', async () => {
        await submit(app.page, 'abc');
        const s = await state(app.page);
        expect(s.err).toContain('at least 6');
        expect(s.passwordUpdates).toEqual([]);      // nothing was sent
        expect(s.modal).toBe(true);
    }, 60_000);

    test('mismatched passwords are refused locally', async () => {
        await submit(app.page, 'longenough1', 'longenough2');
        const s = await state(app.page);
        expect(s.err).toContain('do not match');
        expect(s.passwordUpdates).toEqual([]);
    }, 60_000);

    test('a server refusal keeps the member on the form, able to retry', async () => {
        await app.page.evaluate(() => { window.__passwordUpdateFails = true; });
        await submit(app.page, 'goodpassword1');
        const s = await state(app.page);
        expect(s.err).toContain('different from the old password');
        expect(s.modal).toBe(true);
        expect(s.recovery).toBe(true);
        const btn = await app.page.evaluate(() =>
            ({ disabled: document.getElementById('pwd-reset-submit-btn').disabled,
               label: document.getElementById('pwd-reset-submit-btn').textContent }));
        expect(btn.disabled).toBe(false);            // recovered, not stranded
        expect(btn.label).toBe('UPDATE PASSWORD');
    }, 60_000);

    test('a HUNG update ends at the deadline and frees the button', async () => {
        /* Found by this suite: a hung updateUser left the in-flight guard set
           forever, because a `finally` on a promise that never settles never
           runs, so the member could never retry the one action standing
           between them and their account. */
        const o = await app.page.evaluate(async () => {
            window.__passwordUpdateFails = false;
            window.__hangPasswordUpdate = true;
            PASSWORD_UPDATE_DEADLINE_MS = 80;
            document.getElementById('new-password-input').value = 'goodpassword1';
            document.getElementById('new-password-confirm').value = 'goodpassword1';
            document.getElementById('pwd-reset-submit-btn').click();
            await new Promise(r => setTimeout(r, 400));
            window.__hangPasswordUpdate = false;
            const b = document.getElementById('pwd-reset-submit-btn');
            return { disabled: b.disabled, label: b.textContent,
                     err: document.getElementById('pwd-reset-error').innerText,
                     recovery: _recoveryMode };
        });
        expect(o.disabled).toBe(false);
        expect(o.label).toBe('UPDATE PASSWORD');
        expect(o.err).toContain('taking too long');
        expect(o.recovery).toBe(true);        // still recoverable
    }, 60_000);

    test('A DOUBLE TAP SENDS ONE REQUEST', async () => {
        /* The old code wired the click listener inside the entry point, so a
           second call attached a second listener and one tap ran updateUser
           twice. */
        await app.page.evaluate(() => {
            window.__passwordUpdateFails = false;
            window.__passwordUpdates = [];
            window.__hangPasswordUpdate = true;      // keep it in flight
            document.getElementById('new-password-input').value = 'goodpassword1';
            document.getElementById('new-password-confirm').value = 'goodpassword1';
            const b = document.getElementById('pwd-reset-submit-btn');
            b.click(); b.click(); b.click();
        });
        const s = await state(app.page);
        expect(s.passwordUpdates.length).toBe(1);
        /* Let the deliberately hung request reach its deadline before the
           next test, so the in-flight guard is released. Leaving it set
           would make the following test fail for the right reason at the
           wrong time. */
        await app.page.evaluate(async () => {
            window.__hangPasswordUpdate = false;
            await new Promise(r => setTimeout(r, 400));
        });
    }, 60_000);

    test('AND A SUCCESSFUL RESET CANNOT REOPEN ON REFRESH', async () => {
        const o = await app.page.evaluate(async () => {
            window.__hangPasswordUpdate = false;
            window.__passwordUpdates = [];
            /* Both halves of a real recovery URL, because the old code set
               location.hash='' and that leaves a bare '#' behind while doing
               nothing at all about a query string. Starting from a clean URL
               cannot tell the two apart. */
            history.replaceState(null, '', window.location.pathname
                + '?code=pkce-1#access_token=tok&type=recovery');
            document.getElementById('new-password-input').value = 'brandnewpass1';
            document.getElementById('new-password-confirm').value = 'brandnewpass1';
            document.getElementById('pwd-reset-submit-btn').click();
            await new Promise(r => setTimeout(r, 200));
            const mid = { ok: document.getElementById('pwd-reset-success').innerText,
                          recovery: _recoveryMode,
                          hash: window.location.hash, search: window.location.search,
                          /* href, not just hash: `location.hash` reads as ''
                             for a bare '#', so only the full URL shows
                             whether the single-use token is still sitting in
                             the address bar. */
                          href: window.location.href };
            /* What a refresh would find. The old code set location.hash='',
               which leaves a bare '#' and does nothing about a query. */
            const reopened = await handlePasswordReset();
            return { mid, reopened };
        });
        expect(o.mid.ok).toContain('Password updated');
        expect(o.mid.recovery).toBe(false);          // recovery is over
        expect(o.mid.hash).toBe('');
        expect(o.mid.search).toBe('');
        /* Nothing left over at all. The token is single use and has no
           business lingering where it can be shared or restored. */
        expect(o.mid.href).not.toContain('#');
        expect(o.mid.href).not.toContain('?');
        expect(o.mid.href).not.toContain('access_token');
        expect(o.reopened).toBe(false);              // a refresh finds nothing
    }, 60_000);
});

describe('the legacy fragment link', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); }, 90_000);
    afterAll(async () => { await app?.close(); });

    const withHash = (hash, inject) => app.page.evaluate(async ({ hash, inject }) => {
        Object.assign(window, inject || {});
        window.__authUser = { id: 'rec', email: 'rec@example.com', user_metadata: {} };
        history.replaceState(null, '', window.location.pathname + hash);
        _recoveryMode = false;
        document.getElementById('password-reset-modal').classList.remove('show');
        document.getElementById('auth-error').textContent = '';
        const handled = await handlePasswordReset();
        return { handled,
                 modal: document.getElementById('password-reset-modal').classList.contains('show'),
                 recovery: _recoveryMode,
                 authErr: document.getElementById('auth-error').textContent,
                 setSessionCalls: window.__setSessionCalls || 0 };
    }, { hash, inject });

    test('A VALID FRAGMENT LINK STILL WORKS', async () => {
        const o = await withHash('#access_token=abc123&refresh_token=r1&type=recovery',
                                 { __setSessionFails: false, __setSessionCalls: 0 });
        expect(o.handled).toBe(true);
        expect(o.modal).toBe(true);
        expect(o.recovery).toBe(true);
        expect(o.setSessionCalls).toBe(1);
    }, 60_000);

    test('an EXPIRED link says so instead of opening a form that cannot submit', async () => {
        const o = await withHash('#access_token=expired&refresh_token=r1&type=recovery',
                                 { __setSessionFails: true, __setSessionCalls: 0 });
        expect(o.handled).toBe(true);
        expect(o.modal).toBe(false);
        expect(o.recovery).toBe(false);
        expect(o.authErr).toContain('expired');
    }, 60_000);

    test('A SPENT LINK REPORTS ITSELF FROM THE FRAGMENT', async () => {
        /* THE LIVE PRODUCTION SYMPTOM, and the case the first version of this
           fix still got wrong.

           We call createClient with no options, so supabase-js runs on its
           default implicit flow and reports a spent or expired link in the
           FRAGMENT, not the query. On that path it throws, drops any stored
           session, fires no auth event at all, and does NOT clear the
           fragment: it only clears on success. So nothing wakes the app, and
           reading only location.search found nothing, which is precisely how
           a member ends up looking at a bare sign-in screen with no idea why.

           Reading the fragment is safe for exactly that reason: the one path
           that clears it is the path where the event fires instead. */
        const o = await withHash('#error=access_denied&error_code=otp_expired'
                               + '&error_description=Email+link+is+invalid+or+has+expired',
                                 { __setSessionCalls: 0 });
        expect(o.handled).toBe(true);
        expect(o.authErr).toContain('expired');
        expect(o.modal).toBe(false);
        expect(o.recovery).toBe(false);
        /* No token to adopt, so nothing should have been attempted. */
        expect(o.setSessionCalls).toBe(0);
    }, 60_000);

    test('an unrecognised fragment error still offers a way back', async () => {
        /* Not every refusal says "expired". The member must still be told the
           link is dead and to ask for another, rather than being left on a
           sign-in screen that explains nothing. */
        const o = await withHash('#error=server_error&error_code=unexpected_failure'
                               + '&error_description=Something+went+wrong',
                                 { __setSessionCalls: 0 });
        expect(o.handled).toBe(true);
        expect(o.authErr).toContain('no longer valid');
        expect(o.authErr).toContain('Request a new one');
        expect(o.modal).toBe(false);
    }, 60_000);

    test('a recovery fragment with NO token is not treated as recovery', async () => {
        const o = await withHash('#type=recovery', { __setSessionCalls: 0 });
        expect(o.handled).toBe(false);
        expect(o.modal).toBe(false);
        expect(o.setSessionCalls).toBe(0);
    }, 60_000);

    test('an ordinary load is not recovery', async () => {
        const o = await withHash('', { __setSessionCalls: 0 });
        expect(o.handled).toBe(false);
        expect(o.modal).toBe(false);
        expect(o.recovery).toBe(false);
    }, 60_000);
});

describe('a normal sign-in is never recovery', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('SIGNED_IN ALONE MUST NOT OPEN THE RESET MODAL', async () => {
        await signIn(app.page, { id: 'rec', loaded: false });
        const s = await state(app.page);
        expect(s.modal).toBe(false);
        expect(s.recovery).toBe(false);
    }, 90_000);

    test('and the reset request asks for the CURRENT origin', async () => {
        /* _appUrl() is what decides the redirect the client asks for. The
           stale pages.dev origin is not in the source: if it reaches a
           member, it came from dashboard configuration. This pins the client
           half so a regression here is distinguishable from that. */
        const o = await app.page.evaluate(async () => {
            window.__resetRequests = [];
            document.getElementById('auth-email').value = 'someone@example.com';
            await sb.auth.resetPasswordForEmail(
                'someone@example.com', { redirectTo: _appUrl() });
            return { reqs: window.__resetRequests, origin: window.location.origin };
        });
        expect(o.reqs.length).toBe(1);
        expect(o.reqs[0].redirectTo).toBe(o.origin + '/app/');
        expect(o.reqs[0].redirectTo).not.toContain('pages.dev');
    }, 60_000);

    test('and no stale origin appears in the app source or fixtures', async () => {
        const found = await app.page.evaluate(() =>
            document.documentElement.innerHTML.includes('pages.dev'));
        expect(found).toBe(false);
    }, 60_000);
});
