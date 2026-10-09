import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, authSignIn } from './harness.js';

/**
 * The preferred name, when the network is slow but working.
 *
 * Two requirements that are easy to conflate, and the whole point of this
 * file is that they are different:
 *
 *   A FAILED optional write must never trap anyone in onboarding. That is
 *   already true and deliberate: commitPreferredName fires and forgets.
 *
 *   A SUCCESSFUL write must not be treated as though the name were lost
 *   merely because the promise has not settled. Onboarding advances in
 *   milliseconds and finishOnboarding starts the tour 450ms later, so every
 *   immediate consumer can read currentUser before updateUser resolves.
 *
 * The second is what this file measures.
 */

const NAME = 'Marcus';

/* Read every surface that answers "do we know his name". */
const nameState = (page) => page.evaluate(() => ({
    fromHelper: (typeof preferredName === 'function') ? preferredName() : null,
    fromUser: (currentUser && currentUser.user_metadata)
        ? (currentUser.user_metadata.preferred_name || null) : null,
    authStoreValue: (window.__authUser && window.__authUser.user_metadata)
        ? (window.__authUser.user_metadata.preferred_name || null) : null,
}));

describe('a slow but successful name write', () => {
    let app, immediately, afterSettle;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => { window.__members = ['new@example.com']; });
        await authSignIn(app.page, { id: 'NAME1', email: 'new@example.com', row: null });

        immediately = await app.page.evaluate(async (NAME) => {
            /* updateUser SUCCEEDS, but slowly. This is the case the fire and
               forget call was never measured against. */
            window.__nameWriteDelayMs = 400;
            const realUpdate = sb.auth.updateUser;
            sb.auth.updateUser = (payload) => new Promise(res => setTimeout(
                () => res(realUpdate(payload)), window.__nameWriteDelayMs));
            window.__restoreUpdate = () => { sb.auth.updateUser = realUpdate; };

            const input = document.getElementById('ob-name-input');
            input.value = NAME;
            const advanced = commitPreferredName();     // the real Next handler
            /* A thumb moves faster than a slow round trip. No await here on
               purpose: this is the window the race lives in. */
            return {
                advanced,
                name: (currentUser && currentUser.user_metadata)
                    ? (currentUser.user_metadata.preferred_name || null) : null,
                helper: (typeof preferredName === 'function') ? preferredName() : null,
            };
        }, NAME);

        afterSettle = await app.page.evaluate(async () => {
            await new Promise(r => setTimeout(r, 900));  // let the write land
            window.__restoreUpdate && window.__restoreUpdate();
            return {
                name: (currentUser && currentUser.user_metadata)
                    ? (currentUser.user_metadata.preferred_name || null) : null,
                helper: (typeof preferredName === 'function') ? preferredName() : null,
                stored: (window.__authUser && window.__authUser.user_metadata)
                    ? (window.__authUser.user_metadata.preferred_name || null) : null,
            };
        });
    }, 180_000);
    afterAll(async () => { await app?.close(); });

    test('ONBOARDING IS NOT BLOCKED BY THE SLOW WRITE', () => {
        /* The requirement that already held, and must keep holding. */
        expect(immediately.advanced).toBe(true);
    });

    test('AND THE NAME IS KNOWN IMMEDIATELY, NOT ONLY AFTER THE ROUND TRIP', () => {
        /* THE RACE. Before the fix this was null for the whole 400ms, so the
           greeting and the tour could render as though a man who had just
           typed his name had never given one. */
        expect(immediately.name).toBe(NAME);
        expect(immediately.helper).toBe(NAME);
    });

    test('and once the write resolves, it is the CONFIRMED metadata', () => {
        expect(afterSettle.name).toBe(NAME);
        expect(afterSettle.helper).toBe(NAME);
        /* The auth store really received it, so this is not just a local
           optimistic value that would vanish on reload. */
        expect(afterSettle.stored).toBe(NAME);
    });

    test('A REFRESH STILL READS THE STORED NAME', async () => {
        const o = await app.page.evaluate(async () => {
            /* Drop the in-memory user and re-read the session the way a fresh
               load does. */
            currentUser = null;
            const { data: { session } } = await sb.auth.getSession();
            currentUser = session ? session.user : null;
            return {
                name: (currentUser && currentUser.user_metadata)
                    ? (currentUser.user_metadata.preferred_name || null) : null,
            };
        });
        expect(o.name).toBe(NAME);
    }, 60_000);
});

describe('a failing name write still never traps anyone', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => { window.__members = ['new2@example.com']; });
        await authSignIn(app.page, { id: 'NAME2', email: 'new2@example.com', row: null });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('the slide advances even though the write fails', async () => {
        const o = await app.page.evaluate(async (NAME) => {
            window.__updateUserFails = true;
            document.getElementById('ob-name-input').value = NAME;
            const advanced = commitPreferredName();
            await new Promise(r => setTimeout(r, 300));
            window.__updateUserFails = false;
            return { advanced, errHidden: document.getElementById('ob-name-error').classList.contains('hidden') };
        }, NAME);
        expect(o.advanced).toBe(true);        // never trapped
        expect(o.errHidden).toBe(true);       // and not shouted at
    }, 60_000);

    test('an over-length name is refused and KEEPS the member on the slide', async () => {
        const o = await app.page.evaluate(async () => {
            document.getElementById('ob-name-input').value = 'x'.repeat(200);
            const advanced = commitPreferredName();
            return { advanced,
                     err: document.getElementById('ob-name-error').textContent,
                     shown: !document.getElementById('ob-name-error').classList.contains('hidden') };
        });
        expect(o.advanced).toBe(false);       // the one case that must not advance
        expect(o.shown).toBe(true);
        expect(o.err).toMatch(/characters/i);
    }, 60_000);
});
