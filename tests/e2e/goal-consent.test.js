/**
 * What a man is told about the week before he agrees to it (#184 P0).
 *
 * THE DEFECT THIS CLOSES. selectGoal() gated its confirmation on
 * `!untouched`, and `untouched` is true for anyone with no sessions, no log
 * and a default schedule. So the one surface that disclosed anything was
 * skipped for precisely the man who had just paid: he tapped Erection
 * quality, the plan applied the same day, and the only sentence he got read
 * "Weekly schedule set for erection quality" above a card saying LENGTH DAY.
 * Driven and recorded on #188; the issue body for #184 now carries it.
 *
 * WHAT THIS IS NOT. No prescription changes. GOALS.eq still schedules a
 * length day, and that is #177's and #185's to resolve. This only makes the
 * week visible, and refusable, before it is written. Disclosure is not
 * alignment and the EQ-specific website CTA stays held.
 *
 * WHY selectGoal() STILL COMMITS. Five browser suites and PR #187 drive it
 * directly. A consent fix that forced all of them to be rewritten would be a
 * worse change than the one it fixes, so the gate is on the UI path:
 * chooseGoal() discloses, Start commits. The wiring itself is pinned below,
 * because reverting one word there is how this would quietly vanish.
 */
import { describe, test, expect } from 'vitest';
import { openApp, signIn } from './harness.js';

const TUESDAY = new Date('2026-03-17T12:00:00Z');

/** A brand-new paid account: nothing logged, default schedule. */
async function newBuyer(id) {
    /* acceptDialogs:false because this file OWNS the dialog.
       The harness installs `page.on('dialog', d => d.accept())` by default
       (tests/e2e/harness.js:525). Adding a second accepting listener meant
       both fired, the second threw "Cannot accept dialog which is already
       handled", and because nothing awaited it, Vitest reported an unhandled
       rejection and failed the browser job even though all 1459 tests passed.
       One owner, so the recording listener is also the accepting one. */
    const app = await openApp({ clock: TUESDAY, timezoneId: 'UTC', acceptDialogs: false });
    app.dialogs = [];
    app.page.on('dialog', d => { app.dialogs.push(d.message()); d.accept(); });
    await signIn(app.page, { id });
    await app.page.evaluate(() => { goToStep(0); hideOnboarding(); dismissUpdateNotice(); });
    await openPicker(app);
    return app;
}

/** The picker as a member reaches it: Account, Change goal, overlay shown. */
async function openPicker(app) {
    await app.page.evaluate(() => { closeAccount(); openGoalPicker(); });
    await app.page.waitForFunction(
        () => document.getElementById('onboarding-overlay').classList.contains('show'));
    await app.page.waitForSelector('#goal-options .goal-opt[data-goal="eq"]', { state: 'visible' });
}

/** An established member, so the change path is exercised too. */
async function establishedMember(id) {
    const app = await newBuyer(id);
    await app.page.evaluate(() => {
        /* null first, so load-time classification runs against the size
           week set below. Without it the member is never recognised as being
           ON the size programme and the cancel-a-queued-change path cannot
           be reached at all. */
        persisted.programme = null;
        persisted.primaryGoal = 'size';
        persisted.schedule = GOALS.size.schedule.slice();
        persisted.allTimeSessionCount = 12;
        persisted.totalXp = 1234;
        persisted.sessionLog = [{ date: '2026-03-16T12:00:00Z', routineType: 'length', duration: 20 }];
        persisted.measurements = [{ date: '2026-03-15', bpel: 6, mseg: 5 }];
        renderDashboard();
    });
    await openPicker(app);
    return app;
}

const everything = page => page.evaluate(() => JSON.stringify({
    goal: persisted.primaryGoal, programme: persisted.programme,
    schedule: persisted.schedule, dayPlans: persisted.dayPlans,
    sessions: persisted.sessionLog,
    routineTypes: (persisted.sessionLog || []).map(s => s.routineType),
    xp: persisted.totalXp, count: persisted.allTimeSessionCount,
    measurements: persisted.measurements, milestones: persisted.seenMilestones,
    ledger: persisted.progressionLedger, completedDays: persisted.completedDays,
    difficulty: persisted.difficulty, notify: persisted.notify,
    start: persisted.programmeStartDate, passes: persisted.streakPasses,
}));

const panel = page => page.evaluate(() => {
    const el = document.getElementById('goal-disclose');
    const vis = id => {
        const n = document.getElementById(id);
        return !!n && !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
    };
    return {
        open: !el.classList.contains('hidden'),
        gridHidden: document.getElementById('goal-options').classList.contains('hidden'),
        text: el.innerText,
        start: vis('goal-disclose-start'),
        back: vis('goal-disclose-back'),
        navVisible: vis('ob-nav'),
        focused: document.activeElement && document.activeElement.id,
    };
});

const tap = (page, goal) => page.click(`#goal-options .goal-opt[data-goal="${goal}"]`);

/* The real presets, so the expectations below are the app's own numbers. */
/* Manual work is listed FIRST, which is the order goalWeekSummary() builds
   and the order a man who did not ask for it needs. These expectations are
   the app's own numbers; if a preset changes, they fail and the disclosure
   has to be re-read rather than assumed. */
const GOAL_WEEKS = [
    { goal: 'eq',      label: 'Erection quality', week: /1 length session, 2 stamina sessions, 4 rest days/ },
    { goal: 'size',    label: 'Size',             week: /2 length sessions, 2 girth sessions, 3 rest days/ },
    { goal: 'stamina', label: 'Lasting longer',   week: /3 stamina sessions, 4 rest days/ },
    { goal: 'all',     label: 'All of it',        week: /2 length sessions, 1 girth session, 1 stamina session, 3 rest days/ },
];

describe('the week is disclosed before it is committed', () => {
    test.each(GOAL_WEEKS)('$goal: tapping it shows the real composition and writes nothing', async ({ goal, label, week }) => {
        const app = await newBuyer(`consent-${goal}`);
        try {
            const before = await everything(app.page);
            await tap(app.page, goal);
            const p = await panel(app.page);
            expect(p.open, 'no disclosure appeared').toBe(true);
            expect(p.gridHidden).toBe(true);
            /* innerText reflects CSS, and the title is text-transform
               uppercase, so the label is compared case-insensitively rather
               than by lowering the heading to suit the test. */
            expect(p.text.toLowerCase()).toContain(label.toLowerCase());
            expect(p.text, 'the composition must come from the preset').toMatch(week);
            /* Both ways out are offered and reachable. */
            expect(p.start).toBe(true);
            expect(p.back).toBe(true);
            /* And they are the ONLY ways out. The onboarding nav's "Done" is
               a second primary button directly beneath them, so it stands
               down while a decision is pending. */
            expect(p.navVisible, 'a competing primary action is on screen').toBe(false);
            /* NOTHING is committed by looking. */
            expect(await everything(app.page), 'tapping a goal wrote state').toBe(before);
            expect(app.dialogs, 'a native dialog fired as well').toEqual([]);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    }, 60_000);

    test('THE FIRST-TIME BUYER IS NOW TOLD, which is the whole P0', async () => {
        const app = await newBuyer('consent-first-time');
        try {
            const immediate = await app.page.evaluate(() => goalAppliesImmediately());
            expect(immediate, 'fixture must be the untouched path').toBe(true);
            await tap(app.page, 'eq');
            const p = await panel(app.page);
            /* The three facts #188 approved for the EQ disclosure. */
            expect(p.text).toMatch(/1 length session, 2 stamina sessions/);
            /* SUBSTANCE, NOT WORDING. Two drafts of this panel explained the
               week by naming a capability the app lacks, and both were cut.
               What consent actually requires is pinned instead: the exact
               sessions, what the manual ones are, what they are NOT
               established to do, that the days are fixed, and a way out.
               Copy can keep improving; these four facts cannot quietly go. */
            expect(p.text).toMatch(/manual penile training/i);
            expect(p.text).toMatch(/no manual method is an established treatment for erection difficulties/i);
            expect(p.text).toMatch(/or a proven way to increase size/i);
            /* And the panel must not describe the product's gaps at all. */
            for (const gap of [/there is no .* session/i, /no session type named/i,
                               /the app (has no|does not have)/i, /cannot schedule/i]) {
                expect(p.text, `panel leads on a missing capability: ${gap}`).not.toMatch(gap);
            }
            expect(p.text).toMatch(/manual penile training/i);
            expect(p.text).toMatch(/Day types cannot be changed/i);
            expect(p.text).toMatch(/starts today/i);
            /* And no treatment claim rode in with it. */
            for (const bad of [/\bcure/i, /\btreats?\b/i, /clinically (validated|proven)/i, /guarantee/i]) {
                expect(p.text, `clinical claim ${bad}`).not.toMatch(bad);
            }
        } finally { await app.close(); }
    }, 60_000);

    test('the manual warning appears only where the week contains manual work', async () => {
        const app = await newBuyer('consent-manual-flag');
        try {
            const seen = {};
            for (const goal of ['stamina', 'eq', 'size', 'all']) {
                await tap(app.page, goal);
                seen[goal] = await app.page.evaluate(() =>
                    !document.getElementById('goal-disclose-manual').classList.contains('hidden'));
                await app.page.click('#goal-disclose-back');
            }
            expect(seen.stamina, 'no length or girth in the stamina week').toBe(false);
            expect(seen.eq).toBe(true);
            expect(seen.size).toBe(true);
            expect(seen.all).toBe(true);
        } finally { await app.close(); }
    }, 60_000);
});

describe('backing out costs nothing, confirming commits exactly once', () => {
    test('Choose another goal restores the grid and leaves the account byte-identical', async () => {
        const app = await establishedMember('consent-back-out');
        try {
            const before = await everything(app.page);
            await tap(app.page, 'eq');
            await app.page.click('#goal-disclose-back');
            const p = await panel(app.page);
            expect(p.open).toBe(false);
            expect(p.gridHidden).toBe(false);
            expect(p.navVisible, 'the onboarding nav must come back').toBe(true);
            expect(await everything(app.page), 'cancelling changed state').toBe(before);
            /* No queued change was left behind to apply itself later. */
            expect(await app.page.evaluate(
                () => window.BP.pendingProgrammeChange(persisted.programme))).toBeNull();
            /* And nothing was reported about a goal he did not take. */
            expect(await app.page.evaluate(
                () => (_analyticsBuffer || []).filter(e => e.event === 'goal_selected').length)).toBe(0);
            /* Focus goes back where he was, not to the top of the page. */
            expect(await app.page.evaluate(
                () => document.activeElement && document.activeElement.dataset.goal)).toBe('eq');
        } finally { await app.close(); }
    }, 60_000);

    test('Start applies the plan on the existing immediate rule, with no second prompt', async () => {
        const app = await newBuyer('consent-commit-now');
        try {
            await tap(app.page, 'eq');
            await app.page.click('#goal-disclose-start');
            const out = await app.page.evaluate(() => ({
                goal: persisted.primaryGoal,
                schedule: persisted.schedule.slice(),
                expected: GOALS.eq.schedule,
                pending: window.BP.pendingProgrammeChange(persisted.programme),
                note: document.getElementById('goal-confirm').textContent,
                panelOpen: !document.getElementById('goal-disclose').classList.contains('hidden'),
                events: (_analyticsBuffer || []).filter(e => e.event === 'goal_selected').length,
            }));
            expect(out.goal).toBe('eq');
            expect(out.schedule).toEqual(out.expected);
            expect(out.pending, 'untouched members apply immediately').toBeNull();
            expect(out.panelOpen, 'the panel stayed up after committing').toBe(false);
            expect(out.events, 'exactly one commit').toBe(1);
            /* NO NATIVE DIALOG. Asking twice is worse than not asking once. */
            expect(app.dialogs).toEqual([]);
        } finally { await app.close(); }
    }, 60_000);

    test('an established member commits on the next-Monday rule, also without a second prompt', async () => {
        const app = await establishedMember('consent-commit-monday');
        try {
            const before = await everything(app.page);
            await tap(app.page, 'stamina');
            const p = await panel(app.page);
            expect(p.text).toMatch(/Starts Monday, Mar 23/);
            expect(p.text).toMatch(/This week stays the same/);
            await app.page.click('#goal-disclose-start');
            const out = await app.page.evaluate(() => ({
                goal: persisted.primaryGoal,
                pending: window.BP.pendingProgrammeChange(persisted.programme),
                thisWeek: persisted.schedule.slice(),
                sizeWeek: GOALS.size.schedule,
                sessions: persisted.sessionLog.length,
                xp: persisted.totalXp,
            }));
            expect(out.goal).toBe('stamina');
            expect(out.pending).toMatchObject({ key: 'lastLonger', effectiveDate: '2026-03-23' });
            expect(out.thisWeek, 'this week must not change').toEqual(out.sizeWeek);
            expect(out.sessions).toBe(1);
            expect(out.xp).toBe(1234);
            expect(app.dialogs, 'the panel replaced the confirm, not added to it').toEqual([]);
            expect(before).not.toBe(await everything(app.page));   // it did commit
        } finally { await app.close(); }
    }, 60_000);
});

describe('the paths that must keep their old behaviour', () => {
    test('choosing the plan you are already on stays a no-op with no disclosure', async () => {
        const app = await newBuyer('consent-noop');
        try {
            await tap(app.page, 'eq');
            await app.page.click('#goal-disclose-start');
            const after = await everything(app.page);
            await tap(app.page, 'eq');
            const p = await panel(app.page);
            expect(p.open, 'disclosed a change that is not happening').toBe(false);
            expect(await everything(app.page)).toBe(after);
        } finally { await app.close(); }
    }, 60_000);

    test('cancelling a queued change keeps its own question and its own semantics', async () => {
        const app = await establishedMember('consent-cancel-queued');
        try {
            await tap(app.page, 'stamina');
            await app.page.click('#goal-disclose-start');
            expect(await app.page.evaluate(
                () => window.BP.pendingProgrammeChange(persisted.programme).key)).toBe('lastLonger');
            app.dialogs.length = 0;
            /* Re-choosing the programme he is actually on cancels the queue.
               That is a different question from "here is a new week", so it
               keeps the confirm it has always had rather than a disclosure. */
            await tap(app.page, 'size');
            const p = await panel(app.page);
            expect(p.open, 'the cancellation path grew a disclosure').toBe(false);
            expect(app.dialogs.join(' ')).toMatch(/cancel the scheduled goal change/i);
            expect(await app.page.evaluate(
                () => window.BP.pendingProgrammeChange(persisted.programme))).toBeNull();
        } finally { await app.close(); }
    }, 60_000);

    test('THE BUTTONS GO THROUGH THE GATE, which is the one line that could undo this', async () => {
        const app = await newBuyer('consent-wiring');
        try {
            const wired = await app.page.evaluate(() => {
                let direct = 0;
                const real = window.selectGoal;
                window.selectGoal = (...a) => { direct++; return real(...a); };
                document.querySelector('#goal-options .goal-opt[data-goal="size"]').click();
                const panelOpen = !document.getElementById('goal-disclose').classList.contains('hidden');
                window.selectGoal = real;
                return { direct, panelOpen };
            });
            /* A tap must reach the disclosure, and must NOT reach the commit
               on its way there. */
            expect(wired.panelOpen).toBe(true);
            expect(wired.direct, 'a goal button committed without disclosing').toBe(0);
        } finally { await app.close(); }
    }, 60_000);
});

describe('it reads on a phone', () => {
    test.each([320, 390])('%ipx: the disclosure fits with no sideways scroll', async width => {
        const app = await openApp({ clock: TUESDAY, timezoneId: 'UTC' });
        try {
            await app.page.setViewportSize({ width, height: 844 });
            await signIn(app.page, { id: `consent-${width}` });
            await app.page.evaluate(() => { goToStep(0); hideOnboarding(); dismissUpdateNotice(); });
            await openPicker(app);
            await tap(app.page, 'eq');
            const box = await app.page.evaluate(w => {
                const el = document.getElementById('goal-disclose');
                const r = el.getBoundingClientRect();
                const btn = document.getElementById('goal-disclose-start').getBoundingClientRect();
                const back = document.getElementById('goal-disclose-back').getBoundingClientRect();
                return {
                    left: Math.round(r.left), right: Math.round(r.right),
                    overflow: document.documentElement.scrollWidth - w,
                    start: Math.round(btn.height), back: Math.round(back.height),
                };
            }, width);
            expect(box.left).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(width);
            expect(box.overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
            expect(box.start, 'tap target').toBeGreaterThanOrEqual(44);
            expect(box.back, 'tap target').toBeGreaterThanOrEqual(44);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    }, 60_000);

    test('it is reachable and operable from the keyboard', async () => {
        const app = await newBuyer('consent-keyboard');
        try {
            const out = await app.page.evaluate(() => {
                const btn = document.querySelector('#goal-options .goal-opt[data-goal="eq"]');
                btn.focus();
                const focusedGoal = document.activeElement === btn;
                btn.click();
                const el = document.getElementById('goal-disclose');
                return {
                    focusedGoal,
                    /* Focus lands inside the panel, so a keyboard or screen
                       reader user is not left on a grid that just vanished. */
                    focusMoved: el.contains(document.activeElement),
                    focusedId: document.activeElement.id,
                    labelled: el.getAttribute('aria-labelledby'),
                    titleText: document.getElementById('goal-disclose-title').textContent,
                };
            });
            expect(out.focusedGoal).toBe(true);
            expect(out.focusMoved).toBe(true);
            expect(out.focusedId).toBe('goal-disclose-start');
            expect(out.labelled).toBe('goal-disclose-title');
            expect(out.titleText.toLowerCase()).toContain('erection quality');
        } finally { await app.close(); }
    }, 60_000);
});
