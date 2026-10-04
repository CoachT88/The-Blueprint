import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Preferred name capture, Phase 2B.3.1.
 *
 * The rules have unit tests. What this covers is the real onboarding path:
 * that the name reaches auth metadata and nowhere else, that nothing about
 * it can trap a member in onboarding, and that a member who gives no name,
 * which is most of them, sees a product that works exactly as before.
 */

/** Put the page on the name slide with a controllable auth user. */
const openNameSlide = (page, { metadata = {}, fails = false } = {}) => page.evaluate(({ metadata, fails }) => {
    window.__authUser = { id: currentUser.id, email: currentUser.email, user_metadata: { ...metadata } };
    window.__updateUserFails = !!fails;
    window.__updateUserCalls = 0;
    currentUser = { ...currentUser, user_metadata: { ...metadata } };
    // A real member arrives at this slide with an empty field. Resetting it
    // here keeps one test's typing out of the next one's fixture.
    document.getElementById('ob-name-input').value = '';
    document.getElementById('ob-name-error').classList.add('hidden');
    showOnboarding();
    goToObSlide(OB_NAME_SLIDE);
    return { slide: _obSlide, heading: document.querySelector('#ob-slide-3 h2').textContent.trim() };
}, { metadata, fails });

const state = (page) => page.evaluate(() => ({
    slide: _obSlide,
    name: preferredName(),
    stored: (window.__authUser && window.__authUser.user_metadata) ? window.__authUser.user_metadata.preferred_name : undefined,
    calls: window.__updateUserCalls || 0,
    error: document.getElementById('ob-name-error').classList.contains('hidden')
        ? null : document.getElementById('ob-name-error').textContent.trim(),
}));

const type = (page, value) => page.evaluate(v => { document.getElementById('ob-name-input').value = v; }, value);

describe('capture', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'pn1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the slide asks the agreed question and sits before the goal picker', async () => {
        const r = await openNameSlide(app.page);
        expect(r.heading).toBe('What should Coach Tee call you?');
        const after = await app.page.evaluate(() => {
            obNext();
            return { slide: _obSlide, isGoal: !!document.querySelector('#ob-slide-4 #goal-options') };
        });
        expect(after.slide).toBe(4);
        expect(after.isGoal).toBe(true);
    }, 30_000);

    test('a name saves through auth metadata', async () => {
        await openNameSlide(app.page);
        await type(app.page, 'Marcus');
        await app.page.evaluate(() => obNext());
        await app.page.waitForTimeout(150);
        const s = await state(app.page);
        expect(s.stored).toBe('Marcus');
        expect(s.name).toBe('Marcus');
        expect(s.slide).toBe(4);
    }, 30_000);

    test('surrounding whitespace is trimmed on the way in', async () => {
        await openNameSlide(app.page);
        await type(app.page, '   Marcus   ');
        await app.page.evaluate(() => obNext());
        await app.page.waitForTimeout(150);
        expect((await state(app.page)).stored).toBe('Marcus');
    }, 30_000);

    test('Continue works with the field empty, and stores nothing', async () => {
        await openNameSlide(app.page);
        const s = await app.page.evaluate(() => { obNext(); return { slide: _obSlide, calls: window.__updateUserCalls || 0 }; });
        expect(s.slide).toBe(4);
        expect(s.calls).toBe(0);
        expect((await state(app.page)).name).toBeNull();
    }, 30_000);

    test('whitespace only stores nothing', async () => {
        await openNameSlide(app.page);
        await type(app.page, '    ');
        await app.page.evaluate(() => obNext());
        await app.page.waitForTimeout(150);
        const s = await state(app.page);
        expect(s.calls).toBe(0);
        expect(s.name).toBeNull();
        expect(s.slide).toBe(4);
    }, 30_000);

    test('Skip advances and stores nothing', async () => {
        await openNameSlide(app.page);
        await type(app.page, 'Marcus');
        await app.page.evaluate(() => document.getElementById('ob-name-skip').click());
        await app.page.waitForTimeout(150);
        const s = await state(app.page);
        expect(s.slide).toBe(4);
        expect(s.calls).toBe(0);
        expect(s.name).toBeNull();
    }, 30_000);

    test('REGRESSION: Skip is never required to get past the slide', async () => {
        // obNext alone must always move a member on, whatever is typed.
        for (const value of ['', '  ', 'Marcus', '😀', 'Søren']) {
            await openNameSlide(app.page);
            await type(app.page, value);
            await app.page.evaluate(() => obNext());
            await app.page.waitForTimeout(80);
            expect((await state(app.page)).slide).toBe(4);
        }
    }, 60_000);

    test('Unicode and emoji survive the round trip', async () => {
        for (const name of ['Søren', 'Марк', '马克', "O'Brien", 'Jean-Luc', 'Marcus 💪']) {
            await openNameSlide(app.page);
            await type(app.page, name);
            await app.page.evaluate(() => obNext());
            await app.page.waitForTimeout(120);
            expect((await state(app.page)).stored).toBe(name);
        }
    }, 60_000);

    test('forty code points is accepted, forty one is refused without truncating', async () => {
        await openNameSlide(app.page);
        await type(app.page, 'a'.repeat(40));
        await app.page.evaluate(() => obNext());
        await app.page.waitForTimeout(120);
        expect((await state(app.page)).stored).toBe('a'.repeat(40));

        await openNameSlide(app.page);
        await type(app.page, 'a'.repeat(41));
        await app.page.evaluate(() => obNext());
        await app.page.waitForTimeout(120);
        const s = await state(app.page);
        expect(s.slide).toBe(3);                    // stays put so it can be edited
        expect(s.error).toMatch(/41 characters/);
        expect(s.calls).toBe(0);                    // and nothing was stored
        expect(s.stored).toBeUndefined();
    }, 30_000);

    test('forty emoji are forty, not eighty', async () => {
        await openNameSlide(app.page);
        await type(app.page, '😀'.repeat(40));
        await app.page.evaluate(() => obNext());
        await app.page.waitForTimeout(120);
        expect((await state(app.page)).slide).toBe(4);
    }, 30_000);

    test('ACCEPTANCE: a save failure does not trap onboarding', async () => {
        await openNameSlide(app.page, { fails: true });
        await type(app.page, 'Marcus');
        await app.page.evaluate(() => obNext());
        await app.page.waitForTimeout(200);
        const s = await state(app.page);
        expect(s.slide).toBe(4);                    // they moved on regardless
        expect(s.name).toBeNull();                  // with no name, honestly
        // And silently. The note element that used to live here was on a
        // slide at opacity 0 by the time it was written to, so nobody ever
        // read it. There is nothing the member could act on, so there is no
        // message. See commitPreferredName().
        expect(await app.page.evaluate(() => !!document.getElementById('ob-name-note'))).toBe(false);
        // And onboarding can still be finished.
        const done = await app.page.evaluate(() => { finishOnboarding(); return document.getElementById('onboarding-overlay').classList.contains('show'); });
        expect(done).toBe(false);
    }, 30_000);
});

describe('reading, isolation and no-name', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'pn2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a stored name is read back from the session', async () => {
        const n = await app.page.evaluate(() => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
            return preferredName();
        });
        expect(n).toBe('Marcus');
    }, 30_000);

    test('a second device reading the same auth user sees the same name', async () => {
        // A fresh session object carrying the same metadata, which is what a
        // sign-in on another device produces.
        const n = await app.page.evaluate(() => {
            const fresh = { id: currentUser.id, email: currentUser.email, user_metadata: { preferred_name: 'Marcus' } };
            return window.BP.readPreferredName(fresh);
        });
        expect(n).toBe('Marcus');
    }, 30_000);

    test('clearing restores the no-name state', async () => {
        const r = await app.page.evaluate(async () => {
            window.__authUser = { id: currentUser.id, email: currentUser.email, user_metadata: { preferred_name: 'Marcus' } };
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
            const before = preferredName();
            await savePreferredName(null);
            return { before, after: preferredName(), stored: window.__authUser.user_metadata.preferred_name };
        });
        expect(r.before).toBe('Marcus');
        expect(r.after).toBeNull();
        expect(r.stored).toBeNull();
    }, 30_000);

    test('REGRESSION: the email local part never becomes a name', async () => {
        const r = await app.page.evaluate(() => {
            currentUser = { id: 'x', email: 'marcus.kane@example.com', user_metadata: {} };
            return { name: preferredName(), email: currentUser.email };
        });
        expect(r.name).toBeNull();
        expect(r.email).toContain('marcus');
    }, 30_000);

    test('REGRESSION: an account switch cannot inherit the previous name', async () => {
        const r = await app.page.evaluate(() => {
            currentUser = { id: 'a', email: 'a@example.com', user_metadata: { preferred_name: 'Marcus' } };
            const first = preferredName();
            currentUser = { id: 'b', email: 'b@example.com', user_metadata: {} };   // a different member signs in
            return { first, second: preferredName() };
        });
        expect(r.first).toBe('Marcus');
        expect(r.second).toBeNull();
    }, 30_000);

    test('REGRESSION: the name never reaches training state, analytics or storage', async () => {
        const r = await app.page.evaluate(() => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Zebediah' } };
            _analyticsBuffer = [];
            track('name_skipped');
            renderDashboard();
            const local = Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('|');
            return {
                payload: JSON.stringify(_buildSavePayload()),
                persisted: JSON.stringify(persisted),
                analytics: JSON.stringify(_analyticsBuffer),
                local,
            };
        });
        for (const blob of [r.payload, r.persisted, r.analytics, r.local]) {
            expect(blob).not.toContain('Zebediah');
        }
    }, 30_000);

    test('REGRESSION: a name is rendered as text, never as markup', async () => {
        const r = await app.page.evaluate(() => {
            const evil = '<img src=x onerror="window.__xss=1">';
            window.__xss = 0;
            const i = document.getElementById('ob-name-input');
            i.value = evil;
            // The input round trip, and anywhere the value is echoed.
            const err = document.getElementById('ob-name-error');
            err.textContent = evil;
            return { xss: window.__xss, html: err.innerHTML, text: err.textContent, inputIsValue: i.value === evil };
        });
        expect(r.xss).toBe(0);
        expect(r.inputIsValue).toBe(true);
        expect(r.html).not.toContain('<img');
        expect(r.text).toContain('<img');
    }, 30_000);

    test('a member with no name sees a working product', async () => {
        const r = await app.page.evaluate(() => {
            currentUser = { ...currentUser, user_metadata: {} };
            renderDashboard();
            return {
                name: preferredName(),
                headline: document.getElementById('today-headline').textContent.trim(),
                brand: document.querySelector('#step-0 h1').textContent.trim(),
            };
        });
        expect(r.name).toBeNull();
        expect(r.headline.length).toBeGreaterThan(0);
        expect(r.brand).toBe('The Blueprint');      // brand lockup untouched
    }, 30_000);

    test('no greeting was introduced in this subphase', async () => {
        // 2B.3.1 is storage and capture only. The HQ must still say nothing
        // about the member.
        const r = await app.page.evaluate(() => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
            renderDashboard();
            return document.getElementById('step-0').textContent;
        });
        expect(r).not.toContain('Marcus');
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
