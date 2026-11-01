/**
 * What a member is told when the programme pipeline REFUSES.
 *
 * Phase 1 of the supporting-work architecture (#180). The question is not
 * whether the refusals are correct, it is whether they are HONEST: a member
 * must never be shown a programme he is not on, nor a start date that has
 * already passed, and a refusal must never cost him data.
 *
 * WHAT IS ALREADY COVERED ELSEWHERE, and is deliberately not repeated here:
 *
 *   tests/e2e/prescription-authority.test.js
 *     F.      the legacy cohort is untouched            (#180 case A)
 *     D and E a missing or corrupt plan fails closed    (#180 case B)
 *     C.      a dated support-only day is its own state, not fabricated
 *             into Girth, and says there is no main session
 *   tests/e2e/goal-change.test.js
 *     the accepted goal change, and adoption on the Monday it is due
 *   tests/programmeGenerate.test.js, tests/scheduleSlot.test.js
 *     projection_failed as a pure result
 *
 * So this file is the three app-level paths nothing asserted: a REFUSED
 * explicit goal change, a REFUSED automatic cutover, and a migrated account
 * with no goal.
 *
 * THE REFUSALS ARE DRIVEN AT THE SEAM, AND THAT IS REPORTED RATHER THAN
 * HIDDEN. On main, `projection_failed` is not reachable by any member action:
 * retainPlans() discards every stored plan after today ("the generator owns
 * these"), so an imported or corrupted future plan cannot reach the
 * projection, and the generator only ever emits the closed legacy
 * vocabulary. The two refusals that ARE reachable, not_permitted and
 * no_programme_key, are the ordinary "not this member" answers and are
 * deliberately silent. Phase 2 changes that: the first support-only day is
 * the first plan the projection can legitimately refuse. These tests
 * therefore stub the seam to characterise behaviour that is latent today and
 * becomes live then, and each one says so where it does it.
 */
import { describe, test, expect } from 'vitest';
import { openApp, signIn } from './harness.js';

const THURSDAY = new Date('2026-03-12T12:00:00Z');
const DUE_MONDAY = '2026-03-16';

async function setup(opts = {}) {
    const app = await openApp({ clock: THURSDAY, timezoneId: 'UTC', ...opts });
    await signIn(app.page, { id: 'cutover-refusal' });
    await app.page.evaluate(() => {
        persisted.programme = null;
        persisted.primaryGoal = 'size';
        persisted.schedule = GOALS.size.schedule.slice();
        persisted.allTimeSessionCount = 12;
        persisted.totalXp = 1234;
        persisted.sessionLog = [{ date: '2026-03-11T12:00:00Z', routineType: 'length', duration: 20 }];
        persisted.measurements = [{ date: '2026-03-10', bpel: 6, mseg: 5 }];
        persisted.seenMilestones = ['first-session'];
        persisted.streakPasses = 2;
        goToStep(0); hideOnboarding(); dismissUpdateNotice();
        renderDashboard();
    });
    return app;
}

/* Everything a refusal must not touch. The issue names cash, login, history,
   saved goals, attendance, tier unlocks and notification preferences; the
   first two are not client state, and the rest are here. */
const invariants = page => page.evaluate(() => JSON.stringify({
    goal: persisted.primaryGoal,
    schedule: persisted.schedule,
    dayPlans: persisted.dayPlans,
    programme: persisted.programme,
    sessions: persisted.sessionLog,
    routineTypes: (persisted.sessionLog || []).map(s => s.routineType),
    xp: persisted.totalXp,
    count: persisted.allTimeSessionCount,
    measurements: persisted.measurements,
    milestones: persisted.seenMilestones,
    passes: persisted.streakPasses,
    ledger: persisted.progressionLedger,
    completedDays: persisted.completedDays,
    difficulty: persisted.difficulty,
    notify: persisted.notify,
    start: persisted.programmeStartDate,
}));

/** Refuse at the seam, the way a support-only day will refuse in Phase 2. */
const refuseCutover = page => page.evaluate(() => {
    window.BP.cutoverPlan = () => ({
        ok: false,
        reason: window.BP.GENERATE_REFUSAL.PROJECTION,
        detail: 'support_only_not_representable',
        unrepresentable: [{ index: 3, date: '2026-03-18', reason: 'support_only_not_representable' }],
    });
});

describe('a refused explicit goal change', () => {
    test('C. IT SAYS SO, AND WRITES NOTHING AT ALL', async () => {
        const app = await setup();
        try {
            const before = await invariants(app.page);
            await app.page.evaluate(() => {
                window.BP.goalChangePlan = () => ({
                    ok: false,
                    reason: window.BP.GENERATE_REFUSAL.PROJECTION,
                    detail: 'support_only_not_representable',
                });
                selectGoal('stamina');
            });
            const seen = await app.page.evaluate(() => {
                const n = document.getElementById('goal-confirm');
                return {
                    text: n.textContent,
                    visible: !n.classList.contains('hidden'),
                    goalShown: document.getElementById('account-goal-value')?.textContent || '',
                };
            });
            /* The member is told, in words, that nothing happened. */
            expect(seen.visible).toBe(true);
            expect(seen.text).toMatch(/could not be changed/i);
            expect(seen.text).toMatch(/still saved/i);
            /* And nothing did. Not the goal, not the plans, not the week, not
               one session or one routineType. */
            expect(await invariants(app.page)).toBe(before);
            /* No queued change was left behind to apply itself later. */
            expect(await app.page.evaluate(
                () => window.BP.pendingProgrammeChange(persisted.programme))).toBeNull();
            /* And no success was reported to analytics. */
            expect(await app.page.evaluate(
                () => (_analyticsBuffer || []).filter(e => e.event === 'goal_selected').length)).toBe(0);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    });
});

describe('a refused automatic cutover', () => {
    test('D. NOTHING IS WRITTEN, AND NOTHING CLAIMS THE NEW PLAN IS RUNNING', async () => {
        const app = await setup();
        try {
            const before = await invariants(app.page);
            await refuseCutover(app.page);
            const after = await app.page.evaluate(() => {
                syncProgression('test');
                renderDashboard();
                return {
                    headline: document.getElementById('today-headline').textContent,
                    today: currentTodayPrescription(),
                    week: currentWeekCompletion(),
                    telemetry: (_analyticsBuffer || [])
                        .filter(e => e.event === 'cutover_refused').map(e => e.props),
                    screen: document.getElementById('step-0').innerText,
                };
            });
            /* The member keeps exactly the programme he had. */
            expect(await invariants(app.page)).toBe(before);
            /* Today is still answered from the plans he already has, so the
               refusal is not visible to him and does not need to be: nothing
               he was promised has failed. */
            expect(after.today.ok).toBe(true);
            expect(after.headline).not.toMatch(/unavailable/i);
            /* Nothing on screen claims a new or different programme. */
            expect(after.screen).not.toMatch(/new program/i);
            /* The condition is reported where engineers can see it, with the
               reason and the detail intact.

               ONCE PER SYNC, NOT ONCE PER CONDITION, which this asserts
               rather than wishes away: syncProgression() runs on every
               dashboard render, so two renders logged two events here. A
               refusal that persists therefore emits one console error and one
               analytics event per render for as long as it lasts. Harmless at
               today's reachability, which is none, and worth deciding about
               before Phase 2 makes a standing refusal possible, because a
               flood is also a way to lose a signal. */
            expect(after.telemetry.length).toBeGreaterThanOrEqual(1);
            expect(after.telemetry.every(p => p.reason === 'projection_failed')).toBe(true);
            expect(after.telemetry[0].detail).toBe('support_only_not_representable');
        } finally { await app.close(); }
    });

    test('D. A QUEUED CHANGE IS NOT LOST BY A REFUSAL', async () => {
        const app = await setup();
        try {
            await app.page.evaluate(() => selectGoal('stamina'));
            const queued = await app.page.evaluate(
                () => window.BP.pendingProgrammeChange(persisted.programme));
            expect(queued).toMatchObject({ key: 'lastLonger', effectiveDate: DUE_MONDAY });
            await refuseCutover(app.page);
            await app.page.clock.setFixedTime(new Date('2026-03-18T12:00:00Z'));
            const after = await app.page.evaluate(() => {
                syncProgression('test'); renderDashboard();
                return {
                    pending: window.BP.pendingProgrammeChange(persisted.programme),
                    key: persisted.programme.key,
                    schedule: persisted.schedule,
                    expected: GOALS.size.schedule,
                };
            });
            /* His choice survives, so a transient refusal does not silently
               cancel a decision he already made and was told about. */
            expect(after.pending).toMatchObject({ key: 'lastLonger', effectiveDate: DUE_MONDAY });
            /* And he is still on the programme he is actually running. */
            expect(after.key).toBe('size');
            expect(after.schedule).toEqual(after.expected);
        } finally { await app.close(); }
    });

    test('D. AND HE IS NEVER TOLD HIS NEW PROGRAM STARTS ON A DAY THAT HAS PASSED', async () => {
        /* THE ONE MEMBER-VISIBLE FALSE CLAIM THIS PHASE FOUND.
           pendingProgrammeChange() does not look at the date, and the Account
           sheet renders whatever it returns as "Your new program starts
           <weekday, month day>". Adoption normally clears the queued change on
           the first load at or after its date (cutoverPlan sets pendingChange
           null when due, which goal-change.test.js pins), so the sentence is
           true every time it is reachable TODAY.

           It stops being true the moment adoption can be blocked while the
           change stays queued, which is exactly what a support-only day does
           in Phase 2. The member would then read "Your new program starts
           Monday, Mar 16" on Wednesday the 18th, while running the old
           programme. */
        const app = await setup();
        try {
            await app.page.evaluate(() => selectGoal('stamina'));
            await refuseCutover(app.page);
            await app.page.clock.setFixedTime(new Date('2026-03-18T12:00:00Z'));
            const note = await app.page.evaluate(() => {
                syncProgression('test');
                renderAccount();
                const n = document.getElementById('account-goal-pending');
                return { text: n.textContent, hidden: n.classList.contains('hidden') };
            });
            /* Not a date in the past, under any wording. */
            expect(note.text).not.toMatch(/Mar 16/);
            expect(note.text).not.toMatch(/starts/i);
            /* And not silence either: the queued change still exists, so the
               member is owed an accurate account of it. */
            expect(note.hidden).toBe(false);
            expect(note.text).toMatch(/not been applied/i);
            expect(note.text).toMatch(/still active/i);
        } finally { await app.close(); }
    });

    test('D. a future queued change still reads as a future start', async () => {
        /* The control. The fix above must not flatten the ordinary case into
           the refusal wording. */
        const app = await setup();
        try {
            const note = await app.page.evaluate(() => {
                selectGoal('stamina');
                renderAccount();
                return document.getElementById('account-goal-pending').textContent;
            });
            expect(note).toMatch(/starts Monday, Mar 16/);
            expect(note).not.toMatch(/not been applied/i);
        } finally { await app.close(); }
    });
});

describe('the refusal wording on a phone', () => {
    /* The only rendered change in this PR is one sentence, and it is longer
       than the sentence it replaces, so it is measured at both widths the
       issue names rather than eyeballed. The harness runs everything else at
       390; 320 is set explicitly here. */
    test.each([320, 390])('it fits a %ipx screen without overflowing', async width => {
        const app = await setup();
        try {
            await app.page.setViewportSize({ width, height: 844 });
            await app.page.evaluate(() => selectGoal('stamina'));
            await refuseCutover(app.page);
            await app.page.clock.setFixedTime(new Date('2026-03-18T12:00:00Z'));
            const box = await app.page.evaluate(() => {
                syncProgression('test');
                openAccount();
                const n = document.getElementById('account-goal-pending');
                const r = n.getBoundingClientRect();
                return {
                    text: n.textContent,
                    left: r.left, right: r.right, height: r.height,
                    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    modalOverflow: n.closest('#account-modal').scrollWidth
                                 - n.closest('#account-modal').clientWidth,
                };
            });
            expect(box.text).toMatch(/not been applied/i);
            expect(box.height).toBeGreaterThan(0);          // it wraps, it does not collapse
            expect(box.left).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(width);
            expect(box.docOverflow).toBe(0);
            expect(box.modalOverflow).toBe(0);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    });
});

describe('a corrupted future plan cannot refuse the projection', () => {
    test('THE GENERATOR OWNS EVERY DATE AFTER TODAY, so an import is discarded', async () => {
        /* Why projection_failed is unreachable by member action on main, and
           the property Phase 2 must not quietly drop. An import writes
           persisted.dayPlans verbatim (adoptPersisted only checks it is an
           array), so a hand-edited backup is the one way a member can put an
           unrepresentable plan into his own state. retainPlans() drops it
           because its date is after today, the generator writes a fresh one,
           and the projection succeeds. If this ever fails, a corrupt backup
           can brick a programme. */
        const app = await setup();
        try {
            const poisoned = await app.page.evaluate(() => {
                const future = window.BP.planDateKey(
                    new Date(Date.now() + 6 * 24 * 60 * 60 * 1000));
                persisted.dayPlans = [
                    ...persisted.dayPlans.filter(p => p.date !== future),
                    /* Support-only: real work, no primary session. The exact
                       shape toLegacySlot() refuses by name. */
                    { date: future, mode: 'prescribed', status: 'pending',
                      primarySession: null, supportingWork: [{ kind: 'supporting', type: 'walk' }],
                      dailyPractice: [] },
                ];
                return future;
            });
            const out = await app.page.evaluate(f => {
                syncProgression('test'); renderDashboard();
                return {
                    plan: persisted.dayPlans.find(p => p.date === f),
                    schedule: persisted.schedule,
                    refused: (_analyticsBuffer || []).filter(e => e.event === 'cutover_refused').length,
                    today: currentTodayPrescription().ok,
                };
            }, poisoned);
            /* Replaced by a representable plan, not kept and not refused. */
            expect(out.refused).toBe(0);
            expect(out.plan.supportingWork).toEqual([]);
            expect(out.schedule).toHaveLength(7);
            expect(out.schedule.every(s => ['length', 'girth', 'stamina', 'rest'].includes(s))).toBe(true);
            expect(out.today).toBe(true);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    });
});

describe('a migrated account that never chose a goal', () => {
    test('E. IT IS NOT GIVEN ONE, AND NO TEMPLATE IS INFERRED', async () => {
        const app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        try {
            await signIn(app.page, { id: 'cutover-nogoal' });
            const out = await app.page.evaluate(() => {
                persisted.programme = null;
                persisted.primaryGoal = '';
                persisted.schedule = DEFAULT_PERSISTED.schedule.slice();
                persisted.sessionLog = [];
                persisted.allTimeSessionCount = 0;
                const scheduleBefore = persisted.schedule.slice();
                goToStep(0); hideOnboarding(); dismissUpdateNotice();
                syncProgression('test'); renderDashboard();
                return {
                    goal: persisted.primaryGoal,
                    scheduleBefore,
                    schedule: persisted.schedule,
                    source: persisted.programme?.migration?.source || null,
                    custom: persisted.programme?.custom ?? null,
                    adoptedAt: persisted.programme?.adoptedAt ?? null,
                    pending: window.BP.pendingProgrammeChange(persisted.programme),
                };
            });
            /* No goal is written on his behalf. */
            expect(out.goal).toBe('');
            /* The stored week is not swapped for a preset or a new template. */
            expect(out.schedule).toEqual(out.scheduleBefore);
            /* Classification is recorded, which is provenance, not a choice,
               and it does not adopt anything: adoption is a member action. */
            expect(out.source).not.toBeNull();
            expect(out.adoptedAt).toBeNull();
            expect(out.pending).toBeNull();
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    });
});
