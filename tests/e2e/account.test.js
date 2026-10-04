import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The existing-member name prompt and the Account surface, Phase 2B.3.4.
 *
 * Every current paying member has no name and, before this, no way to set
 * one. The prompt is offered once in a member's life and is the lowest
 * value message in the app. The surface is the smallest thing that lets
 * someone manage what they are called, reach the notification settings that
 * already exist, and sign out.
 */

const EVERY_DAY = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];

/** An onboarded member with no name, on an ordinary day. */
const setup = (page, { name = null, onboarded = true, clearAsked = true, patch = {} } = {}) =>
    page.evaluate(({ name, onboarded, clearAsked, patch, EVERY_DAY }) => {
        currentUser = { ...currentUser, user_metadata: name ? { preferred_name: name } : {} };
        window.__authUser = { id: currentUser.id, email: currentUser.email,
                              user_metadata: name ? { preferred_name: name } : {} };
        window.__updateUserFails = false;
        _persistedLoaded = true; _storageFull = false;
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.pelvicScreenDate = '2025-01-01';
        persisted.schedule = [...EVERY_DAY];
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', duration: 30 }];
        persisted.progressionLedger = [];
        Object.assign(persisted, patch);
        try {
            if (onboarded) localStorage.setItem('bp_onboarded_' + currentUser.id, '1');
            else localStorage.removeItem('bp_onboarded_' + currentUser.id);
            if (clearAsked) Object.keys(localStorage).filter(k => k.startsWith('bp_name_asked_')).forEach(k => localStorage.removeItem(k));
            localStorage.removeItem(getTodaySorenessKey());
            localStorage.removeItem('bp_session_draft_' + currentUser.id);
        } catch (e) {}
        renderDashboard();
        const el = document.getElementById('hq-name-prompt');
        return {
            promptShown: !el.classList.contains('hidden'),
            state: window.BP.nextBestAction(buildResolverInput()).state,
            liveness: document.getElementById('today-liveness').dataset.liveness || null,
        };
    }, { name, onboarded, clearAsked, patch, EVERY_DAY });

const accountState = (page) => page.evaluate(() => ({
    open: !document.getElementById('account-modal').classList.contains('hidden'),
    value: document.getElementById('account-name-value').textContent.trim(),
    editorOpen: !document.getElementById('account-name-editor').classList.contains('hidden'),
    error: document.getElementById('account-name-error').classList.contains('hidden')
        ? null : document.getElementById('account-name-error').textContent.trim(),
    input: document.getElementById('account-name-input').value,
    name: preferredName(),
    stored: window.__authUser ? window.__authUser.user_metadata.preferred_name : undefined,
}));

describe('the existing-member prompt', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'ac1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: an onboarded member with no name is offered it', async () => {
        const r = await setup(app.page);
        expect(r.promptShown).toBe(true);
    }, 30_000);

    test('a member still in onboarding is not', async () => {
        const r = await setup(app.page, { onboarded: false });
        expect(r.promptShown).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: a member who already has a name is not', async () => {
        const r = await setup(app.page, { name: 'Marcus' });
        expect(r.promptShown).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: nor once today\'s greeting is already spent', async () => {
        /* The case above is suppressed TWICE over: having a name is a
           reason not to ask, and having a name also makes the greeting
           eligible, which is a liveness message and a separate reason.
           Spending the greeting first strips the second guard away, so
           only "they already have a name" is left holding the prompt
           back. Without this, removing that check passes every other
           test in the file. */
        const r = await app.page.evaluate(() => {
            renderDashboard();                 // consumes today's greeting
            renderDashboard();                 // now nothing else has anything to say
            return { greeted: _greetedToday(),
                     liveness: document.getElementById('today-liveness').dataset.liveness || null,
                     greetingShown: !document.getElementById('hq-greeting').classList.contains('hidden'),
                     nudgeLive: _nameNudgeLive,
                     promptShown: !document.getElementById('hq-name-prompt').classList.contains('hidden') };
        });
        expect(r.greeted).toBe(true);
        expect(r.liveness).toBeNull();         // no week, return or missed-week message
        expect(r.greetingShown).toBe(false);   // and the greeting is spent
        expect(r.nudgeLive).toBe(false);
        expect(r.promptShown).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: dismissing it once retires it for good', async () => {
        await setup(app.page);
        const after = await app.page.evaluate(() => {
            document.getElementById('hq-name-prompt-dismiss').click();
            return !document.getElementById('hq-name-prompt').classList.contains('hidden');
        });
        expect(after).toBe(false);
        // And it does not come back on a later render, or a later day.
        const again = await setup(app.page, { clearAsked: false });
        expect(again.promptShown).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: tapping Add also retires it', async () => {
        await setup(app.page);
        await app.page.evaluate(() => document.getElementById('hq-name-prompt-add').click());
        await app.page.evaluate(() => closeAccount());
        const again = await setup(app.page, { clearAsked: false });
        expect(again.promptShown).toBe(false);
    }, 30_000);

    test('the resolution key is user scoped and holds no name', async () => {
        await setup(app.page);
        const r = await app.page.evaluate(() => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Zebediah' } };
            document.getElementById('hq-name-prompt-dismiss').click();
            const keys = Object.keys(localStorage).filter(k => k.startsWith('bp_name_asked_'));
            return { keys, values: keys.map(k => localStorage.getItem(k)) };
        });
        expect(r.keys).toHaveLength(1);
        expect(r.keys[0]).toBe('bp_name_asked_ac1');
        expect(r.keys[0]).not.toContain('Zebediah');
        expect(r.values[0]).toBe('1');
    }, 30_000);

    test.each([
        ['the critical band', '_persistedLoaded = false;'],
        ['RECOVER', "localStorage.setItem(getTodaySorenessKey(), 'high');"],
        ['RESUME', "localStorage.setItem('bp_session_draft_'+currentUser.id, JSON.stringify({savedAt:Date.now(),exerciseIndex:0,setIndex:1,routineType:'length'}));"],
        ['PREPARE', "persisted.primaryGoal = '';"],
        ['a return', "const d=new Date(); d.setDate(d.getDate()-10); persisted.sessionLog=[{date:d.toISOString(),routineType:'length',duration:30}];"],
        ['an unanswered pelvic screener', "persisted.pelvicProfile=''; persisted.pelvicScreenDate='';"],
    ])('ACCEPTANCE: %s suppresses it', async (_label, condition) => {
        await setup(app.page);
        const shown = await app.page.evaluate((condition) => {
            // eslint-disable-next-line no-eval
            eval(condition);
            renderDashboard();
            const out = !document.getElementById('hq-name-prompt').classList.contains('hidden');
            _persistedLoaded = true;
            try { localStorage.removeItem(getTodaySorenessKey());
                  localStorage.removeItem('bp_session_draft_' + currentUser.id); } catch (e) {}
            return out;
        }, condition);
        expect(shown).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: it changes nothing about the prescription', async () => {
        const withPrompt = await setup(app.page);
        const r = await app.page.evaluate(() => {
            const a = window.BP.nextBestAction(buildResolverInput());
            document.getElementById('hq-name-prompt-dismiss').click();
            const b = window.BP.nextBestAction(buildResolverInput());
            return { same: JSON.stringify(a) === JSON.stringify(b), headline: document.getElementById('today-headline').textContent.trim() };
        });
        expect(withPrompt.promptShown).toBe(true);
        expect(r.same).toBe(true);
        expect(r.headline.length).toBeGreaterThan(0);
    }, 30_000);

    test('it never blocks: no modal opens by itself and the app stays usable', async () => {
        await setup(app.page);
        const r = await app.page.evaluate(() => {
            const anyModal = ['account-modal', 'notif-modal', 'pass-info-modal']
                .filter(id => !document.getElementById(id).classList.contains('hidden'));
            goToStep(4); const moved = session.step; goToStep(0);
            return { anyModal, moved };
        });
        expect(r.anyModal).toEqual([]);
        expect(r.moved).toBe(4);
    }, 30_000);
});

describe('the Account surface', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'ac2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('it opens from the header icon', async () => {
        await setup(app.page);
        const r = await app.page.evaluate(() => {
            document.getElementById('account-btn').click();
            return !document.getElementById('account-modal').classList.contains('hidden');
        });
        expect(r).toBe(true);
    }, 30_000);

    test('no name reads as Not set', async () => {
        await setup(app.page);
        await app.page.evaluate(() => openAccount());
        expect((await accountState(app.page)).value).toBe('Not set');
    }, 30_000);

    test('a name is shown as given', async () => {
        await setup(app.page, { name: 'Søren' });
        await app.page.evaluate(() => openAccount());
        expect((await accountState(app.page)).value).toBe('Søren');
    }, 30_000);

    test('ACCEPTANCE: a valid edit saves through auth metadata', async () => {
        await setup(app.page);
        await app.page.evaluate(async () => {
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Marcus';
            await saveAccountName();
        });
        const s = await accountState(app.page);
        expect(s.stored).toBe('Marcus');
        expect(s.value).toBe('Marcus');
        expect(s.editorOpen).toBe(false);
        expect(s.error).toBeNull();
    }, 30_000);

    test('surrounding whitespace is trimmed', async () => {
        await setup(app.page);
        await app.page.evaluate(async () => {
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = '   Marcus   ';
            await saveAccountName();
        });
        expect((await accountState(app.page)).stored).toBe('Marcus');
    }, 30_000);

    test('whitespace only clears the name', async () => {
        await setup(app.page, { name: 'Marcus' });
        await app.page.evaluate(async () => {
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = '    ';
            await saveAccountName();
        });
        const s = await accountState(app.page);
        expect(s.stored).toBeNull();
        expect(s.value).toBe('Not set');
    }, 30_000);

    test('Unicode and emoji are accepted', async () => {
        for (const name of ['Søren', 'Марк', '马克', "O'Brien", 'Marcus 💪']) {
            await setup(app.page);
            await app.page.evaluate(async (n) => {
                openAccount(); openAccountEditor();
                document.getElementById('account-name-input').value = n;
                await saveAccountName();
            }, name);
            expect((await accountState(app.page)).stored).toBe(name);
        }
    }, 60_000);

    test('ACCEPTANCE: 41 code points is refused without truncating', async () => {
        await setup(app.page);
        await app.page.evaluate(async () => {
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'a'.repeat(41);
            await saveAccountName();
        });
        const s = await accountState(app.page);
        expect(s.error).toMatch(/41 characters/);
        expect(s.editorOpen).toBe(true);
        expect(s.value).toBe('Not set');
        expect(s.stored).toBeUndefined();
    }, 30_000);

    test('ACCEPTANCE: a failed save stays visibly unsaved', async () => {
        await setup(app.page, { name: 'Marcus' });
        await app.page.evaluate(async () => {
            window.__updateUserFails = true;
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Bruno';
            await saveAccountName();
        });
        const s = await accountState(app.page);
        expect(s.error).toMatch(/could not save/i);
        expect(s.editorOpen).toBe(true);        // not closed as if it worked
        expect(s.input).toBe('Bruno');          // what they typed is still there
        expect(s.value).toBe('Marcus');         // and nothing was shown as changed
        expect(s.name).toBe('Marcus');
        await app.page.evaluate(() => { window.__updateUserFails = false; });
    }, 30_000);

    test('ACCEPTANCE: a successful save updates the UI with no reload', async () => {
        await setup(app.page, { name: 'Marcus' });
        const r = await app.page.evaluate(async () => {
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Bruno';
            await saveAccountName();
            /* No cache to invalidate: savePreferredName() swaps currentUser
               for what auth returned, so every identity surface picks the
               new value up on its next call. */
            return { value: document.getElementById('account-name-value').textContent.trim(),
                     name: preferredName(),
                     coach: _coachContext(),
                     greeting: (() => { try { localStorage.removeItem(_greetedKey()); } catch (e) {}
                                        renderDashboard();
                                        return document.getElementById('hq-greeting').textContent; })() };
        });
        expect(r.value).toBe('Bruno');
        expect(r.name).toBe('Bruno');
        expect(r.coach).toContain('Preferred name: Bruno');
        expect(r.coach).not.toContain('Marcus');
        expect(r.greeting).toContain('Bruno');
    }, 30_000);

    test('ACCEPTANCE: clearing removes the name from every identity surface', async () => {
        await setup(app.page, { name: 'Marcus' });
        const r = await app.page.evaluate(async () => {
            openAccount();
            await clearAccountName();
            renderDashboard();
            const live = document.getElementById('today-liveness');
            return {
                value: document.getElementById('account-name-value').textContent.trim(),
                name: preferredName(),
                coach: _coachContext(),
                greetingShown: !document.getElementById('hq-greeting').classList.contains('hidden'),
                hq: document.getElementById('step-0').textContent,
                liveness: live.textContent,
            };
        });
        expect(r.value).toBe('Not set');
        expect(r.name).toBeNull();
        expect(r.coach).not.toContain('Preferred name');
        expect(r.greetingShown).toBe(false);
        expect(r.hq).not.toContain('Marcus');
        expect(r.liveness).not.toContain('Marcus');
    }, 30_000);

    test('ACCEPTANCE: clearing does not bring the prompt back', async () => {
        /* The full journey: offered, accepted, named, then cleared. A
           deliberate clear is a valid permanent state, not incomplete
           setup to nag about, so the resolution key survives it and the
           prompt stays retired. The asked state is established here
           rather than assumed, because a conditional assertion would
           quietly pass on a day the key happened to be missing. */
        await setup(app.page);
        const r = await app.page.evaluate(async () => {
            document.getElementById('hq-name-prompt-add').click();   // resolves the offer
            const asked = localStorage.getItem('bp_name_asked_ac2');
            openAccountEditor();
            document.getElementById('account-name-input').value = 'Marcus';
            await saveAccountName();
            await clearAccountName();
            closeAccount();
            renderDashboard();
            renderDashboard();                                       // past today's greeting
            return { asked,
                     stillAsked: localStorage.getItem('bp_name_asked_ac2'),
                     name: preferredName(),
                     nudgeLive: _nameNudgeLive,
                     shown: !document.getElementById('hq-name-prompt').classList.contains('hidden') };
        });
        expect(r.asked).toBe('1');
        expect(r.stillAsked).toBe('1');          // the clear did not un-resolve it
        expect(r.name).toBeNull();               // and they really have no name
        expect(r.nudgeLive).toBe(false);
        expect(r.shown).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: extended return falls back to the no-name copy after a clear', async () => {
        const r = await app.page.evaluate(async () => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Marcus' } };
            window.__authUser.user_metadata = { preferred_name: 'Marcus' };
            const d = new Date(); d.setDate(d.getDate() - 40); d.setHours(12, 0, 0, 0);
            persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
            renderDashboard();
            const named = document.getElementById('today-liveness').textContent.trim();
            await clearAccountName();
            return { named, after: document.getElementById('today-liveness').textContent.trim() };
        });
        expect(r.named).toContain('Marcus');
        expect(r.after).not.toContain('Marcus');
        expect(r.after).toContain("You're back after a while away");
    }, 30_000);

    test('the Notifications row opens the existing modal and nothing is duplicated', async () => {
        const r = await app.page.evaluate(() => {
            openAccount();
            document.getElementById('account-notif-open').click();
            return {
                accountOpen: !document.getElementById('account-modal').classList.contains('hidden'),
                notifOpen: !document.getElementById('notif-modal').classList.contains('hidden'),
                timePickers: document.querySelectorAll('#notif-time').length,
            };
        });
        expect(r.accountOpen).toBe(false);
        expect(r.notifOpen).toBe(true);
        expect(r.timePickers).toBe(1);
        await app.page.evaluate(() => closeNotifModal());
    }, 30_000);

    test('sign out lives here, and nothing else was added', async () => {
        const r = await app.page.evaluate(() => {
            const modal = document.getElementById('account-modal');
            return { hasLogout: !!modal.querySelector('#logout-btn'),
                     headerLogout: !!document.querySelector('#step-0 > div > div #logout-btn'),
                     text: modal.textContent };
        });
        expect(r.hasLogout).toBe(true);
        expect(r.text).not.toMatch(/avatar|photo|username|bio|badge|level|XP|measurement/i);
    }, 30_000);

    test('REGRESSION: a markup-like name stays inert here too', async () => {
        const r = await app.page.evaluate(async () => {
            window.__xss = 0;
            currentUser = { ...currentUser, user_metadata: { preferred_name: '<img src=x onerror="window.__xss=1">' } };
            openAccount();
            const el = document.getElementById('account-name-value');
            return { xss: window.__xss, imgs: el.querySelectorAll('img').length, html: el.innerHTML, text: el.textContent };
        });
        expect(r.xss).toBe(0);
        expect(r.imgs).toBe(0);
        expect(r.html).not.toContain('<img');
        expect(r.text).toContain('<img');
    }, 30_000);

    test('ACCEPTANCE: nothing is written to localStorage or user_data', async () => {
        const r = await app.page.evaluate(async () => {
            currentUser = { ...currentUser, user_metadata: {} };
            window.__authUser.user_metadata = {};
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Zebediah';
            await saveAccountName();
            return {
                saved: preferredName(),
                payload: JSON.stringify(_buildSavePayload()),
                persisted: JSON.stringify(persisted),
                local: Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('|'),
            };
        });
        expect(r.saved).toBe('Zebediah');       // it really did save
        for (const blob of [r.payload, r.persisted, r.local]) {
            expect(blob).not.toContain('Zebediah');
        }
    }, 30_000);
});

describe('accounts and the greeting gate', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'ac3' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const become = (page, id, name) => page.evaluate(({ id, name }) => {
        currentUser = { id, email: id + '@example.com', user_metadata: name ? { preferred_name: name } : {} };
        window.__authUser = { id, email: id + '@example.com', user_metadata: name ? { preferred_name: name } : {} };
        _persistedLoaded = true;
        persisted.primaryGoal = 'all'; persisted.pelvicProfile = 'standard';
        persisted.schedule = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', duration: 30 }];
        persisted.progressionLedger = [];
        try { localStorage.setItem('bp_onboarded_' + id, '1'); } catch (e) {}
        renderDashboard();
        openAccount();
        return {
            accountValue: document.getElementById('account-name-value').textContent.trim(),
            coach: _coachContext(),
            hq: document.getElementById('step-0').textContent,
            promptShown: !document.getElementById('hq-name-prompt').classList.contains('hidden'),
        };
    }, { id, name });

    test("ACCEPTANCE: A's name never appears for B", async () => {
        const a = await become(app.page, 'acct-a', 'Marcus');
        expect(a.accountValue).toBe('Marcus');
        const b = await become(app.page, 'acct-b', null);
        expect(b.accountValue).toBe('Not set');
        expect(b.coach).not.toContain('Marcus');
        expect(b.hq).not.toContain('Marcus');
    }, 30_000);

    test("ACCEPTANCE: B's prompt state is independent of A's", async () => {
        await app.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bp_name_asked_')).forEach(k => localStorage.removeItem(k)));
        await become(app.page, 'acct-b', null);
        await app.page.evaluate(() => { closeAccount(); document.getElementById('hq-name-prompt-dismiss').click(); });
        const c = await become(app.page, 'acct-c', null);
        await app.page.evaluate(() => closeAccount());
        const stillShown = await app.page.evaluate(() => { renderDashboard(); return !document.getElementById('hq-name-prompt').classList.contains('hidden'); });
        expect(c.accountValue).toBe('Not set');
        expect(stillShown).toBe(true);           // C was never asked
    }, 30_000);

    test('ACCEPTANCE: switching back to A restores A', async () => {
        const a = await become(app.page, 'acct-a', 'Marcus');
        expect(a.accountValue).toBe('Marcus');
        expect(a.coach).toContain('Preferred name: Marcus');
    }, 30_000);

    test('ACCEPTANCE: editing a name does not reset the daily greeting gate', async () => {
        const r = await app.page.evaluate(async () => {
            const uid = 'acct-a';
            currentUser = { id: uid, email: 'a@example.com', user_metadata: { preferred_name: 'Marcus' } };
            window.__authUser = { id: uid, email: 'a@example.com', user_metadata: { preferred_name: 'Marcus' } };
            _persistedLoaded = true;
            const key = 'bp_greeted_' + uid + '_' + window.BP.localDayKey(new Date());
            localStorage.setItem(key, '1');                 // already greeted today
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Bruno';
            await saveAccountName();
            /* Read the moment the save returns. saveAccountName() renders
               the dashboard itself, so a gate cleared inside it would be
               spent again by that very render and read as '1' again a
               moment later: the replay has to be caught where it
               happens. */
            const afterSave = {
                gate: localStorage.getItem(key),
                greetingShown: !document.getElementById('hq-greeting').classList.contains('hidden'),
            };
            renderDashboard();
            return { ...afterSave,
                     gateLater: localStorage.getItem(key),
                     laterShown: !document.getElementById('hq-greeting').classList.contains('hidden') };
        });
        expect(r.gate).toBe('1');                // untouched
        expect(r.greetingShown).toBe(false);     // and not replayed by the save
        expect(r.gateLater).toBe('1');
        expect(r.laterShown).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: adding a first name does not inject a greeting into settings', async () => {
        const r = await app.page.evaluate(async () => {
            currentUser = { ...currentUser, user_metadata: {} };
            window.__authUser.user_metadata = {};
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Marcus';
            await saveAccountName();
            const modal = document.getElementById('account-modal');
            return { inSheet: modal.textContent, hasGreetingEl: !!modal.querySelector('#hq-greeting') };
        });
        expect(r.hasGreetingEl).toBe(false);
        expect(r.inSheet).not.toMatch(/Good (morning|afternoon|evening)/);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
