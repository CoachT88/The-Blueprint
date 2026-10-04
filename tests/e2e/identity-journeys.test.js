import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, authSignIn, authSignOut } from './harness.js';

/**
 * The whole 2B.3 identity system as one product. Phase 2B.3.5.
 *
 * Every slice of 2B.3 was verified on its own and every slice was green.
 * None of that proved they cohere, and none of it ran the real auth
 * lifecycle: until this phase the harness had signOut() as a no-op and an
 * onAuthStateChange nobody ever fired, so handleLogout() and onUserSignedIn()
 * had never executed in a test. These journeys go through authSignIn() and
 * authSignOut(), which drive the production path.
 *
 * Nothing here is a new feature. It is integration truth, and the two defects
 * it found are fixed in app/index.html rather than worked around here.
 */

const EVERY_DAY = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];

/** A user_data row for a member with history, so they are not "brand new". */
const established = (over = {}) => ({
    id: 'x',
    schedule: [...EVERY_DAY],
    completed_days: [false, false, false, false, false, false, false],
    session_log: [{ date: new Date(Date.now() - 2 * 86400000).toISOString(), routineType: 'length', duration: 30 }],
    all_time_session_count: 40,
    first_session_date: '2025-01-01T00:00:00.000Z',
    primary_goal: 'all',
    pelvic_profile: 'standard',
    pelvic_screen_date: '2025-01-01',
    progression_ledger: [],
    ...over,
});

/** Mark the member as past the welcome gate and onboarding, as a real one is. */
const settled = (page, uid) => page.evaluate((uid) => {
    localStorage.setItem('bp_welcomed_' + uid, '1');
    localStorage.setItem('bp_onboarded_' + uid, '1');
}, uid);

/** Everything the identity system is currently saying, in one read. */
const identity = (page) => page.evaluate(() => {
    const vis = (id) => {
        const el = document.getElementById(id);
        return !!el && !el.classList.contains('hidden') && el.getBoundingClientRect().height > 0;
    };
    return {
        user: currentUser && currentUser.id,
        name: preferredName(),
        greeting: vis('hq-greeting') ? document.getElementById('hq-greeting').textContent : null,
        prompt: vis('hq-name-prompt'),
        liveness: document.getElementById('today-liveness').dataset.liveness || null,
        livenessText: document.getElementById('today-liveness').textContent,
        accountOpen: vis('account-modal'),
        accountValue: document.getElementById('account-name-value').textContent.trim(),
        coach: _coachContext(),
        // innerText, not textContent: the HQ carries hidden nodes such as
        // #hq-user-email, and the question here is what a member can SEE.
        hq: document.getElementById('step-0').innerText,
    };
});

/** Clear the welcome gate the way a member does, events and all. */
const passWelcomeGate = async (page) => {
    await page.evaluate(() => {
        const fire = (id) => { const el = document.getElementById(id);
                               el.checked = true; el.dispatchEvent(new Event('change')); };
        fire('check-liability'); fire('check-pain');
        document.getElementById('init-btn').click();
    });
    // The intro is deferred by 600ms so it does not race the step change.
    await page.waitForFunction(
        () => document.getElementById('onboarding-overlay').classList.contains('show'),
        null, { timeout: 10_000 });
};

/**
 * Record every value an identity element takes, with whether it was on
 * screen at the time.
 *
 * Reading after the fact cannot see a flash. The observer is installed
 * before the account is signed in, so the whole sequence is captured and the
 * assertion can be about the ORDER of what a member actually saw, not about
 * wherever the DOM happened to settle.
 */
const watchIdentity = (page) => page.evaluate(() => {
    window.__idFrames = [];
    const shown = (el) => !el.classList.contains('hidden') && el.getBoundingClientRect().height > 0;
    ['account-name-value', 'hq-greeting', 'today-liveness'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const record = () => window.__idFrames.push({ id, text: el.textContent.trim(), visible: shown(el) });
        record();
        new MutationObserver(record).observe(el, { childList: true, characterData: true,
                                                   subtree: true, attributes: true, attributeFilter: ['class'] });
    });
});
const idFrames = (page, id) => page.evaluate((id) =>
    window.__idFrames.filter(f => f.id === id), id);

// ───────────────────────────────────────────────────────────────────────────

describe('journey: a new member who gives a name', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: sign in, onboard, name, goal, HQ, greeting, Account, Coach Tee', async () => {
        await authSignIn(app.page, { id: 'j1', email: 'j1@example.com', row: null });

        // A genuinely new member lands on the welcome gate, not the HQ.
        const atWelcome = await app.page.evaluate(() =>
            [...document.querySelectorAll('.step-content')].find(e => !e.classList.contains('hidden-step'))?.id);
        expect(atWelcome).toBe('step-welcome');

        // Through the real liability gate into the real onboarding.
        await passWelcomeGate(app.page);
        expect(await app.page.evaluate(() => localStorage.getItem('bp_welcomed_j1'))).toBe('1');

        // Advance to the name slide through the real navigation.
        const onName = await app.page.evaluate(() => {
            while (_obSlide < OB_NAME_SLIDE) obNext();
            return { slide: _obSlide, hasInput: !!document.getElementById('ob-name-input') };
        });
        expect(onName.slide).toBe(3);

        const named = await app.page.evaluate(async () => {
            document.getElementById('ob-name-input').value = 'Marcus';
            obNext();                                   // commits the name
            await new Promise(r => setTimeout(r, 50));  // the write is fire and forget
            return { slide: _obSlide, name: preferredName(),
                     stored: window.__authUser.user_metadata.preferred_name };
        });
        expect(named.name).toBe('Marcus');
        expect(named.stored).toBe('Marcus');            // auth metadata, the only home

        // The goal slide is last. #goal-confirm is a note, not a button:
        // onboarding ends when obNext() runs on the final slide.
        const done = await app.page.evaluate(() => {
            document.querySelector('.goal-opt[data-goal="all"]').click();
            const last = _obSlide >= _obLastIdx();
            obNext();
            renderDashboard();
            return { last, onboarded: localStorage.getItem('bp_onboarded_j1'),
                     overlay: document.getElementById('onboarding-overlay').classList.contains('show'),
                     goal: persisted.primaryGoal };
        });
        expect(done.last).toBe(true);
        expect(done.overlay).toBe(false);
        expect(done.onboarded).toBe('1');
        expect(done.goal).toBe('all');

        /* The boot render already spent today's greeting, and 2B.3.2 shows it
           once per day rather than on every render, so the gate is cleared
           to ask the question this journey is actually about: does the name
           they just gave reach the greeting. */
        const id = await app.page.evaluate(() => {
            try { localStorage.removeItem(_greetedKey()); } catch (e) {}
            renderDashboard();
            return { name: preferredName(),
                     greeting: document.getElementById('hq-greeting').textContent,
                     shown: !document.getElementById('hq-greeting').classList.contains('hidden'),
                     prompt: !document.getElementById('hq-name-prompt').classList.contains('hidden'),
                     coach: _coachContext() };
        });
        expect(id.name).toBe('Marcus');
        expect(id.shown).toBe(true);
        expect(id.greeting).toMatch(/^Good (morning|afternoon|evening), Marcus\.$/);
        expect(id.prompt).toBe(false);                  // they just gave it
        expect(id.coach).toContain('Preferred name: Marcus');

        const acct = await app.page.evaluate(() => {
            openAccount();
            return document.getElementById('account-name-value').textContent.trim();
        });
        expect(acct).toBe('Marcus');                    // the same name in all three
    }, 90_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

describe('journey: a new member who skips the name', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: no greeting, Not set, and no Coach Tee name line', async () => {
        await authSignIn(app.page, { id: 'j2', email: 'j2@example.com', row: null });
        await passWelcomeGate(app.page);
        await app.page.evaluate(() => { while (_obSlide < OB_NAME_SLIDE) obNext(); });
        // Skip is a visible button, not a hidden escape behind the field.
        const skipped = await app.page.evaluate(async () => {
            document.getElementById('ob-name-skip').click();
            await new Promise(r => setTimeout(r, 50));
            return { slide: _obSlide, name: preferredName(),
                     stored: window.__authUser && window.__authUser.user_metadata.preferred_name };
        });
        expect(skipped.slide).toBe(4);                  // it advanced
        expect(skipped.name).toBeNull();
        expect(skipped.stored).toBeUndefined();         // nothing was written

        await app.page.evaluate(() => {
            document.querySelector('.goal-opt[data-goal="all"]').click();
            obNext();                       // the last slide: this finishes onboarding
            renderDashboard();
        });
        const id = await identity(app.page);
        expect(id.greeting).toBeNull();                 // no personalized greeting
        expect(id.coach).not.toContain('Preferred name');
        // Nor the email local part standing in for a name anywhere visible.
        // #hq-user-email holds it but carries `hidden`, so innerText is the
        // honest test and textContent would fail on a node nobody can read.
        expect(id.hq).not.toContain('j2@example.com');
        expect(id.hq).not.toMatch(/\bj2\b/);

        const acct = await app.page.evaluate(() => {
            openAccount();
            return document.getElementById('account-name-value').textContent.trim();
        });
        expect(acct).toBe('Not set');
    }, 90_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

describe('journey: an existing member adds a name from the nudge', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: prompt, add, saved, retired, greeting, Coach Tee', async () => {
        await app.page.evaluate(() => { localStorage.setItem('bp_welcomed_j3', '1');
                                        localStorage.setItem('bp_onboarded_j3', '1'); });
        await authSignIn(app.page, { id: 'j3', email: 'j3@example.com', row: established() });

        const before = await app.page.evaluate(() => {
            renderDashboard();
            return { name: preferredName(),
                     prompt: !document.getElementById('hq-name-prompt').classList.contains('hidden'),
                     asked: localStorage.getItem('bp_name_asked_j3') };
        });
        expect(before.name).toBeNull();
        expect(before.prompt).toBe(true);               // the one-time offer
        expect(before.asked).toBeNull();

        // Add opens the Account sheet with the editor already open.
        const opened = await app.page.evaluate(() => {
            document.getElementById('hq-name-prompt-add').click();
            return { asked: localStorage.getItem('bp_name_asked_j3'),
                     sheet: !document.getElementById('account-modal').classList.contains('hidden'),
                     editor: !document.getElementById('account-name-editor').classList.contains('hidden') };
        });
        expect(opened.asked).toBe('1');
        expect(opened.sheet).toBe(true);
        expect(opened.editor).toBe(true);

        const saved = await app.page.evaluate(async () => {
            document.getElementById('account-name-input').value = 'Bruno';
            const ok = await saveAccountName();
            closeAccount();
            renderDashboard();
            return { ok, name: preferredName(),
                     stored: window.__authUser.user_metadata.preferred_name,
                     prompt: !document.getElementById('hq-name-prompt').classList.contains('hidden') };
        });
        expect(saved.ok).toBe(true);
        expect(saved.name).toBe('Bruno');
        expect(saved.stored).toBe('Bruno');
        expect(saved.prompt).toBe(false);               // retired

        // A later eligible opening can greet them, and Coach Tee is current.
        const later = await app.page.evaluate(() => {
            try { localStorage.removeItem(_greetedKey()); } catch (e) {}
            renderDashboard();
            return { greeting: document.getElementById('hq-greeting').textContent,
                     shown: !document.getElementById('hq-greeting').classList.contains('hidden'),
                     coach: _coachContext() };
        });
        expect(later.shown).toBe(true);
        expect(later.greeting).toContain('Bruno');
        expect(later.coach).toContain('Preferred name: Bruno');
    }, 90_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

describe('journey: an existing member dismisses the prompt', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: dismissed, never returns, Account still works', async () => {
        await app.page.evaluate(() => { localStorage.setItem('bp_welcomed_j4', '1');
                                        localStorage.setItem('bp_onboarded_j4', '1'); });
        await authSignIn(app.page, { id: 'j4', email: 'j4@example.com', row: established() });

        const dismissed = await app.page.evaluate(() => {
            renderDashboard();
            const shown = !document.getElementById('hq-name-prompt').classList.contains('hidden');
            document.getElementById('hq-name-prompt-dismiss').click();
            renderDashboard();
            return { shown, after: !document.getElementById('hq-name-prompt').classList.contains('hidden'),
                     asked: localStorage.getItem('bp_name_asked_j4') };
        });
        expect(dismissed.shown).toBe(true);
        expect(dismissed.after).toBe(false);
        expect(dismissed.asked).toBe('1');

        // Not even across a full sign-out and back in: the key is persistent
        // and user scoped, so this is the real "never again" check.
        await authSignOut(app.page);
        await authSignIn(app.page, { id: 'j4', email: 'j4@example.com', row: established() });
        const returned = await app.page.evaluate(() => {
            renderDashboard();
            return !document.getElementById('hq-name-prompt').classList.contains('hidden');
        });
        expect(returned).toBe(false);

        // And they can still add one by hand whenever they like.
        const manual = await app.page.evaluate(async () => {
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Marcus';
            const ok = await saveAccountName();
            return { ok, name: preferredName(),
                     value: document.getElementById('account-name-value').textContent.trim() };
        });
        expect(manual.ok).toBe(true);
        expect(manual.name).toBe('Marcus');
        expect(manual.value).toBe('Marcus');
    }, 90_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

describe('journey: clearing a name', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: every surface returns to no-name, and the prompt stays retired', async () => {
        await app.page.evaluate(() => { localStorage.setItem('bp_welcomed_j5', '1');
                                        localStorage.setItem('bp_onboarded_j5', '1');
                                        localStorage.setItem('bp_name_asked_j5', '1'); });
        // Away long enough for the extended-return line, which is the one
        // piece of liveness copy that uses the name.
        const old = new Date(Date.now() - 30 * 86400000).toISOString();
        await authSignIn(app.page, { id: 'j5', email: 'j5@example.com',
                                     user_metadata: { preferred_name: 'Marcus' },
                                     row: established({ session_log: [{ date: old, routineType: 'length', duration: 30 }] }) });

        const before = await app.page.evaluate(() => {
            renderDashboard();
            return { name: preferredName(),
                     liveness: document.getElementById('today-liveness').dataset.liveness,
                     text: document.getElementById('today-liveness').textContent,
                     coach: _coachContext() };
        });
        expect(before.name).toBe('Marcus');
        expect(before.liveness).toBe('extended-return');
        expect(before.text).toContain('Welcome back, Marcus.');
        expect(before.coach).toContain('Preferred name: Marcus');

        const after = await app.page.evaluate(async () => {
            openAccount();
            const ok = await clearAccountName();
            try { localStorage.removeItem(_greetedKey()); } catch (e) {}
            renderDashboard();
            return { ok, name: preferredName(),
                     value: document.getElementById('account-name-value').textContent.trim(),
                     greeting: !document.getElementById('hq-greeting').classList.contains('hidden'),
                     liveness: document.getElementById('today-liveness').dataset.liveness,
                     text: document.getElementById('today-liveness').textContent,
                     coach: _coachContext(),
                     hq: document.getElementById('step-0').textContent,
                     asked: localStorage.getItem('bp_name_asked_j5'),
                     prompt: !document.getElementById('hq-name-prompt').classList.contains('hidden') };
        });
        expect(after.ok).toBe(true);
        expect(after.name).toBeNull();
        expect(after.value).toBe('Not set');
        expect(after.greeting).toBe(false);                      // no name, no greeting
        expect(after.liveness).toBe('extended-return');          // still the same state
        expect(after.text).toBe("You're back after a while away. Today's session is the only thing to think about.");
        expect(after.coach).not.toContain('Preferred name');
        expect(after.hq).not.toContain('Marcus');
        expect(after.asked).toBe('1');                           // the clear did not un-resolve
        expect(after.prompt).toBe(false);                        // so no nagging
    }, 90_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

// ───────────────────────────────────────────────────────────────────────────

describe('the account switch, as one flow', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const A = { id: 'acct-a', email: 'a@example.com' };
    const B = { id: 'acct-b', email: 'b@example.com' };

    test('ACCEPTANCE: A signs in, is greeted, resolves the prompt, sets a reminder', async () => {
        await app.page.evaluate((a) => { localStorage.setItem('bp_welcomed_' + a.id, '1');
                                         localStorage.setItem('bp_onboarded_' + a.id, '1'); }, A);
        await authSignIn(app.page, { ...A, user_metadata: { preferred_name: 'Marcus' }, row: established() });
        const state = await app.page.evaluate(() => {
            // The boot render already greeted them; clear and re-render to
            // read the text, since 2B.3.2 shows it once per day by design.
            const greetedAtBoot = _greetedToday();
            try { localStorage.removeItem(_greetedKey()); } catch (e) {}
            renderDashboard();
            // A reminder preference, user scoped since 2B.3.1's storage patch.
            localStorage.setItem(_notifPrefsKey(), JSON.stringify({ time: '06:30' }));
            return { name: preferredName(), greetedAtBoot,
                     greeting: document.getElementById('hq-greeting').textContent,
                     greeted: _greetedToday(),
                     prompt: !document.getElementById('hq-name-prompt').classList.contains('hidden'),
                     prefsKey: _notifPrefsKey(), tzKey: _pushTzKey(),
                     tz: localStorage.getItem(_pushTzKey()) };
        });
        expect(state.name).toBe('Marcus');
        expect(state.greetedAtBoot).toBe(true);           // the real boot greeted them
        expect(state.greeting).toContain('Marcus');
        expect(state.greeted).toBe(true);                 // gate consumed again
        expect(state.prompt).toBe(false);                 // nothing to ask, they have a name
        expect(state.prefsKey).toBe('bp_notif_prefs_acct-a');
        expect(state.tzKey).toBe('bp_push_tz_acct-a');
        // _refreshPushTimezone() ran during the real sign-in and cached A's
        // own zone under A's own key. That it is scoped at all is the 2B.3.1
        // fix; the value itself is just the browser's zone.
        expect(state.tz).toBeTruthy();
    }, 90_000);

    test('ACCEPTANCE: B signs in to a clean identity, inheriting nothing of A', async () => {
        await watchIdentity(app.page);                    // before the switch, to catch a flash
        await app.page.evaluate(() => { openAccount(); }); // leave A's sheet open on purpose
        await authSignOut(app.page);
        await app.page.evaluate((b) => { localStorage.setItem('bp_welcomed_' + b.id, '1');
                                         localStorage.setItem('bp_onboarded_' + b.id, '1'); }, B);
        await authSignIn(app.page, { ...B, row: established() });

        const id = await app.page.evaluate(() => {
            renderDashboard();
            const vis = (i) => { const e = document.getElementById(i);
                                 return !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; };
            return { user: currentUser.id, name: preferredName(),
                     accountVisible: vis('account-modal'),
                     greeting: vis('hq-greeting') ? document.getElementById('hq-greeting').textContent : null,
                     greeted: _greetedToday(),
                     prompt: vis('hq-name-prompt'),
                     coach: _coachContext(),
                     hq: document.getElementById('step-0').textContent,
                     prefs: localStorage.getItem(_notifPrefsKey()),
                     prefsKey: _notifPrefsKey(),
                     aPrefs: localStorage.getItem('bp_notif_prefs_acct-a') };
        });
        expect(id.user).toBe('acct-b');
        expect(id.name).toBeNull();                       // A's name did not come with them
        /* REGRESSION. Before 2B.3.5 this was true: #account-modal is a
           body-level overlay, handleLogout() only hid .step-content, and
           nothing re-rendered the sheet, so B's HQ came up with A's sheet
           open reading "Marcus". */
        expect(id.accountVisible).toBe(false);
        expect(id.greeting).toBeNull();                   // no name, no greeting
        expect(id.greeted).toBe(false);                   // B's own gate, untouched by A's
        expect(id.prompt).toBe(true);                     // B gets their own offer
        expect(id.coach).not.toContain('Marcus');
        expect(id.hq).not.toContain('Marcus');
        /* The storage-isolation fix, through the real switch this time: the
           reminder key is B's own, B has no reminder, and A's 06:30 is still
           sitting under A's key rather than having become B's. */
        expect(id.prefsKey).toBe('bp_notif_prefs_acct-b');
        expect(id.prefs).toBeNull();
        expect(id.aPrefs).toBe(JSON.stringify({ time: '06:30' }));

        // Opening the sheet renders from currentUser, so it reads B's state.
        const sheet = await app.page.evaluate(() => {
            openAccount();
            return document.getElementById('account-name-value').textContent.trim();
        });
        expect(sheet).toBe('Not set');
    }, 90_000);

    test('ACCEPTANCE: no frame of the switch ever showed B a name belonging to A', async () => {
        const frames = await idFrames(app.page, 'account-name-value');
        const visible = frames.filter(f => f.visible).map(f => f.text);
        // Of everything the Account row displayed while on screen, nothing
        // after the sign-out may be A's name.
        const afterSignOut = visible.slice(visible.lastIndexOf('Marcus') + 1);
        expect(afterSignOut).not.toContain('Marcus');
        const greet = (await idFrames(app.page, 'hq-greeting')).filter(f => f.visible).map(f => f.text);
        expect(greet.filter(t => t.includes('Marcus') && greet.indexOf(t) > greet.length)).toEqual([]);
    }, 60_000);

    test('ACCEPTANCE: back to A restores A, from auth rather than from anything cached', async () => {
        await authSignOut(app.page);
        await authSignIn(app.page, { ...A, user_metadata: { preferred_name: 'Marcus' }, row: established() });
        const back = await app.page.evaluate(() => {
            renderDashboard();
            openAccount();
            return { user: currentUser.id, name: preferredName(),
                     value: document.getElementById('account-name-value').textContent.trim(),
                     greeted: _greetedToday(),
                     prompt: !document.getElementById('hq-name-prompt').classList.contains('hidden'),
                     prefs: localStorage.getItem(_notifPrefsKey()),
                     tzKey: _pushTzKey(),
                     coach: _coachContext() };
        });
        expect(back.user).toBe('acct-a');
        expect(back.name).toBe('Marcus');                 // auth-backed, restored
        expect(back.value).toBe('Marcus');
        expect(back.greeted).toBe(true);                  // A's own gate, still spent today
        expect(back.prompt).toBe(false);
        expect(back.prefs).toBe(JSON.stringify({ time: '06:30' }));   // A's reminder is back
        expect(back.tzKey).toBe('bp_push_tz_acct-a');     // and A's cache is A's again
        expect(back.coach).toContain('Preferred name: Marcus');
    }, 90_000);

    /* Two independent paths close the overlays, and either one on its own
       hides the defect: handleLogout() does it directly, and the SIGNED_OUT
       branch does it again a moment later when the stubbed signOut resolves.
       Removing just one therefore passes the switch test above. These two
       pin each path on its own, so a single-sided regression is caught. */
    test('ACCEPTANCE: handleLogout closes the sheet before any network call resolves', async () => {
        await authSignIn(app.page, { ...A, user_metadata: { preferred_name: 'Marcus' }, row: established() });
        const r = await app.page.evaluate(() => {
            openAccount(); openAccountEditor();
            const open = !document.getElementById('account-modal').classList.contains('hidden');
            // Not awaited on purpose: everything that matters is synchronous,
            // ahead of the await on sb.auth.signOut().
            handleLogout();
            return { open,
                     closedSynchronously: document.getElementById('account-modal').classList.contains('hidden'),
                     editorClosed: document.getElementById('account-name-editor').classList.contains('hidden') };
        });
        expect(r.open).toBe(true);
        expect(r.closedSynchronously).toBe(true);
        expect(r.editorClosed).toBe(true);
    }, 60_000);

    test('ACCEPTANCE: a sign-out from somewhere else closes them too', async () => {
        // Another tab, or an expired token. handleLogout() never runs, so the
        // SIGNED_OUT branch has to do it.
        await authSignIn(app.page, { ...A, user_metadata: { preferred_name: 'Marcus' }, row: established() });
        const r = await app.page.evaluate(async () => {
            openAccount();
            const open = !document.getElementById('account-modal').classList.contains('hidden');
            window.__fireAuth('SIGNED_OUT', null);
            await new Promise(r => setTimeout(r, 50));
            return { open, closed: document.getElementById('account-modal').classList.contains('hidden'),
                     user: currentUser, loaded: _persistedLoaded };
        });
        expect(r.open).toBe(true);
        expect(r.closed).toBe(true);
        expect(r.user).toBeNull();
        expect(r.loaded).toBe(false);
    }, 60_000);

    test('the page threw nothing throughout the switch', () => {
        expect(app.errors).toEqual([]);
    });
});

// ───────────────────────────────────────────────────────────────────────────

describe('the async identity audit', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: a known name never appears as Not set first', async () => {
        /* The flash this rules out: the Account row showing "Not set" and
           then correcting itself to a name that was in the authenticated
           session all along. There is structurally no cache to be stale,
           because renderAccount() reads currentUser at open time and
           onUserSignedIn() sets currentUser before its first await, but a
           claim like that is worth an observer rather than an argument. */
        await app.page.evaluate(() => { localStorage.setItem('bp_welcomed_f1', '1');
                                        localStorage.setItem('bp_onboarded_f1', '1'); });
        await watchIdentity(app.page);
        await authSignIn(app.page, { id: 'f1', email: 'f1@example.com',
                                     user_metadata: { preferred_name: 'Marcus' }, row: established() });
        await app.page.evaluate(() => { renderDashboard(); openAccount(); });
        const frames = (await idFrames(app.page, 'account-name-value')).filter(f => f.visible).map(f => f.text);
        // The row is only ever on screen with the sheet open, and by then the
        // name is known. "Not set" must never be one of those frames.
        expect(frames).not.toContain('Not set');
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[frames.length - 1]).toBe('Marcus');
    }, 90_000);

    test('ACCEPTANCE: identity is withheld, not guessed, while the row is loading', async () => {
        // The auth screen is only hidden after loadPersisted() resolves, so
        // nothing identity-bearing is on screen during the gap.
        const during = await app.page.evaluate(() => ({
            authHidden: document.getElementById('auth-screen').classList.contains('hidden'),
            loadingHidden: document.getElementById('loading-screen').classList.contains('hidden'),
            loaded: _persistedLoaded,
        }));
        expect(during.loaded).toBe(true);
        expect(during.authHidden).toBe(true);
        expect(during.loadingHidden).toBe(true);
    }, 60_000);

    test('ACCEPTANCE: a save and a clear move the row once, with no intermediate wrong value', async () => {
        await app.page.evaluate(() => { window.__idFrames.length = 0; });
        await app.page.evaluate(async () => {
            openAccountEditor();
            document.getElementById('account-name-input').value = 'Bruno';
            await saveAccountName();
        });
        const afterSave = (await idFrames(app.page, 'account-name-value')).filter(f => f.visible).map(f => f.text);
        expect(afterSave).not.toContain('Not set');          // never dips through empty
        expect(afterSave[afterSave.length - 1]).toBe('Bruno');

        await app.page.evaluate(() => { window.__idFrames.length = 0; });
        await app.page.evaluate(async () => { await clearAccountName(); });
        const afterClear = (await idFrames(app.page, 'account-name-value')).filter(f => f.visible).map(f => f.text);
        expect(afterClear[afterClear.length - 1]).toBe('Not set');
    }, 60_000);

    test('ACCEPTANCE: a failed save leaves the displayed value untouched', async () => {
        const r = await app.page.evaluate(async () => {
            openAccountEditor();
            document.getElementById('account-name-input').value = 'Marcus';
            await saveAccountName();                          // succeeds, sets a baseline
            // A successful save closes the editor, so reopen it the way the
            // member would before the attempt that is going to fail.
            openAccountEditor();
            window.__updateUserFails = true;
            document.getElementById('account-name-input').value = 'Bruno';
            window.__idFrames.length = 0;
            const ok = await saveAccountName();
            window.__updateUserFails = false;
            return { ok, value: document.getElementById('account-name-value').textContent.trim(),
                     name: preferredName(),
                     editorOpen: !document.getElementById('account-name-editor').classList.contains('hidden'),
                     input: document.getElementById('account-name-input').value,
                     error: !document.getElementById('account-name-error').classList.contains('hidden'),
                     frames: window.__idFrames.filter(f => f.id === 'account-name-value').map(f => f.text) };
        });
        expect(r.ok).toBe(false);
        expect(r.value).toBe('Marcus');       // nothing was mutated optimistically
        expect(r.name).toBe('Marcus');
        expect(r.editorOpen).toBe(true);      // and it is visibly unsaved
        expect(r.input).toBe('Bruno');
        expect(r.error).toBe(true);
        expect(r.frames).not.toContain('Bruno');
    }, 60_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});
