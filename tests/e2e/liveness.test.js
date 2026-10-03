import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Phase 2B.2 liveness, in the real page.
 *
 * The rules have their own unit tests. What this covers is that the app
 * feeds them the right state, shows one message, and above all that none of
 * it touches the prescription. Everything here goes through renderDashboard()
 * and, where a session is involved, the real finishSession().
 */

const UID = 'lv';
const EVERY_DAY = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
const FOUR = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];

/** Monday of the current ISO week, noon, as the page computes it. */
const mondaySetup = `
    const mondayOf = (d) => { const x = new Date(d); x.setHours(12,0,0,0); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x; };
`;

/** Reset to a known member, optionally seed a log, then render. */
const setup = (page, { schedule = FOUR, log = [], done = null, ledger = [], patch = {} } = {}) =>
    page.evaluate(({ schedule, log, done, ledger, patch }) => {
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.schedule = [...schedule];
        persisted.completedDays = done || [false, false, false, false, false, false, false];
        persisted.sessionLog = log.map(e => {
            const d = new Date(); d.setDate(d.getDate() - e.daysAgo); d.setHours(12, 0, 0, 0);
            return { date: d.toISOString(), routineType: e.type || 'length', duration: 30, eq: 8, rpe: 5 };
        });
        persisted.progressionLedger = ledger;
        persisted.difficulty = 'intermediate';
        Object.assign(persisted, patch);
        try { localStorage.removeItem('bp_session_draft_' + (currentUser?.id || '')); } catch (e) {}
        renderDashboard();
        const r = window.BP.nextBestAction(buildResolverInput());
        const live = document.getElementById('today-liveness');
        return {
            state: r.state,
            mission: r.mission,
            duration: r.duration,
            modifiers: r.modifiers,
            weekComplete: r.weekComplete,
            returnContext: r.returnContext,
            liveness: live.dataset.liveness || null,
            livenessText: live.classList.contains('hidden') ? null : live.textContent.trim(),
            weekLabel: document.getElementById('hq-week-label').textContent.trim(),
            launch: document.getElementById('launch-btn').classList.contains('hidden')
                ? null : document.getElementById('launch-btn').textContent.trim(),
            optional: document.getElementById('today-optional-btn').classList.contains('hidden')
                ? null : document.getElementById('today-optional-btn').textContent.trim(),
        };
    }, { schedule, log, done, ledger, patch });

/** Complete today through the real production path. */
const finish = (page, routineType = 'length') => page.evaluate((routineType) => {
    session.routineType = routineType;
    _sessionStartTime = Date.now() - 30 * 60000;
    selectedEQ = 8; selectedRPE = 5;
    document.getElementById('input-bpel').value = '';
    document.getElementById('input-mseg').value = '';
    document.getElementById('session-note-input').value = '';
    finishSession();
    closeSessionSummary();
    renderDashboard();
    const live = document.getElementById('today-liveness');
    return {
        state: document.getElementById('hq-today-card').dataset.state,
        weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete,
        liveness: live.dataset.liveness || null,
        livenessText: live.classList.contains('hidden') ? null : live.textContent.trim(),
        weekLabel: document.getElementById('hq-week-label').textContent.trim(),
        optional: document.getElementById('today-optional-btn').classList.contains('hidden') ? null : 'shown',
        launch: document.getElementById('launch-btn').classList.contains('hidden') ? null : 'shown',
    };
}, routineType);

/** Days of the current ISO week that have already elapsed, today included. */
const elapsed = () => ((new Date().getDay() + 6) % 7) + 1;

describe('week complete', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /**
     * Every day is a training day, and all of this week's elapsed days bar
     * today are already done mechanically. Finishing today therefore
     * finishes the week, on whatever weekday the suite runs.
     */
    const onePending = (page) => page.evaluate(({ EVERY_DAY }) => {
        const n = ((new Date().getDay() + 6) % 7) + 1;
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.schedule = EVERY_DAY.slice(0, 7);
        persisted.schedule.length = 7;
        // Only the elapsed days are scheduled; the rest of the week is rest,
        // so the target is exactly the days that have happened.
        for (let i = 0; i < 7; i++) {
            const isoIdx = (i + 6) % 7;
            persisted.schedule[i] = isoIdx < n ? 'length' : 'rest';
        }
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [];
        persisted.progressionLedger = [];
        const monday = new Date(); monday.setHours(12, 0, 0, 0);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        for (let i = 0; i < n - 1; i++) {                 // every elapsed day but today
            const d = new Date(monday); d.setDate(d.getDate() + i);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length', duration: 30 });
            persisted.completedDays[d.getDay()] = true;
        }
        renderDashboard();
        return { target: window.BP.weekCompletion(persisted.schedule, persisted.completedDays,
            { sessionLog: persisted.sessionLog, now: new Date() }) };
    }, { EVERY_DAY });

    test('ACCEPTANCE: the final scheduled session completes the week', async () => {
        const before = await onePending(app.page);
        expect(before.target.allDone).toBe(false);
        const r = await finish(app.page);
        expect(r.weekComplete).toBe(true);
        expect(r.liveness).toBe('week-complete');
        expect(r.livenessText).toMatch(/week complete/i);
        expect(r.weekLabel).toMatch(/Week complete/i);
    }, 30_000);

    test('and it is calm closure: no CTA, no extra work offered', async () => {
        await onePending(app.page);
        const r = await finish(app.page);
        expect(r.state).toBe('COMPLETE');
        expect(r.launch).toBeNull();
        expect(r.optional).toBeNull();
        expect(r.livenessText).not.toMatch(/another|more|extra|bonus|keep going/i);
    }, 30_000);

    test('it survives closing and reopening the app in the same week', async () => {
        await onePending(app.page);
        await finish(app.page);
        // A fresh page, same stored state. Nothing about Week Complete is
        // held in memory, so it has to come back from what was persisted.
        const after = await app.page.evaluate(() => {
            goToStep(4); goToStep(0);              // leave the HQ and return
            renderDashboard();
            const live = document.getElementById('today-liveness');
            return { weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete,
                     liveness: live.dataset.liveness || null,
                     weekLabel: document.getElementById('hq-week-label').textContent.trim() };
        });
        expect(after.weekComplete).toBe(true);
        expect(after.liveness).toBe('week-complete');
        expect(after.weekLabel).toMatch(/Week complete/i);
    }, 30_000);

    test('it rolls off when the calendar week changes', async () => {
        // The week rollover clears completedDays, which is what the
        // treatment is derived from. Nothing extra has to be reset.
        await onePending(app.page);
        await finish(app.page);
        const after = await app.page.evaluate(() => {
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];              // last week's log, aged out
            renderDashboard();
            return { weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete,
                     label: document.getElementById('hq-week-label').textContent.trim() };
        });
        expect(after.weekComplete).toBe(false);
        expect(after.label).not.toMatch(/Week complete/i);
    }, 30_000);

    test('REGRESSION: Recovery cannot complete the week', async () => {
        // completedDays is still set for Recovery, deliberately. The week
        // headline must not move for it.
        await onePending(app.page);
        const r = await finish(app.page, 'recovery');
        expect(r.weekComplete).toBe(false);
        expect(r.liveness).not.toBe('week-complete');
        expect(r.weekLabel).not.toMatch(/Week complete/i);
    }, 30_000);

    test('a substituted mission does complete it', async () => {
        await onePending(app.page);
        const r = await finish(app.page, 'girth');
        expect(r.weekComplete).toBe(true);
    }, 30_000);

    test('REGRESSION: a week of nothing but rest never completes', async () => {
        const r = await setup(app.page, { schedule: ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'] });
        expect(r.weekComplete).toBe(false);
        expect(r.liveness).toBeNull();
    }, 30_000);

    test('REGRESSION: a partly done week is not complete', async () => {
        const r = await setup(app.page, { log: [{ daysAgo: 0 }] });
        expect(r.weekComplete).toBe(false);
    }, 30_000);
});

describe('return context', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('under a week away says nothing', async () => {
        const r = await setup(app.page, { schedule: EVERY_DAY, log: [{ daysAgo: 3 }] });
        expect(r.returnContext).toBeNull();
        expect(r.liveness).toBeNull();
    }, 30_000);

    test('seven to twenty seven days away is a return', async () => {
        for (const daysAgo of [7, 20, 27]) {
            const r = await setup(app.page, { schedule: EVERY_DAY, log: [{ daysAgo }] });
            expect(r.returnContext).toBe('returning');
            expect(r.liveness).toBe('returning');
            expect(r.livenessText).toMatch(/you're back/i);
        }
    }, 60_000);

    test('twenty eight days or more is an extended return', async () => {
        for (const daysAgo of [28, 90]) {
            const r = await setup(app.page, { schedule: EVERY_DAY, log: [{ daysAgo }] });
            expect(r.returnContext).toBe('extended-return');
            expect(r.liveness).toBe('extended-return');
            expect(r.livenessText).toMatch(/a while away/i);
        }
    }, 60_000);

    test('ACCEPTANCE: return context changes nothing about the prescription', async () => {
        const away = await setup(app.page, { schedule: EVERY_DAY, log: [{ daysAgo: 40 }] });
        const fresh = await setup(app.page, { schedule: EVERY_DAY, log: [{ daysAgo: 1 }] });
        expect(away.returnContext).toBe('extended-return');
        expect(fresh.returnContext).toBeNull();
        // Same mission, same state, same duration, same modifiers.
        expect(away.state).toBe(fresh.state);
        expect(away.mission).toBe(fresh.mission);
        expect(away.duration).toBe(fresh.duration);
        expect(away.modifiers).toEqual(fresh.modifiers);
        expect(away.launch).toBe(fresh.launch);
    }, 60_000);

    test('REGRESSION: it does not reduce volume or move the tier', async () => {
        const r = await app.page.evaluate(() => {
            const d = new Date(); d.setDate(d.getDate() - 60);
            persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length' }];
            persisted.difficulty = 'intermediate';
            renderDashboard();
            return {
                ctx: window.BP.nextBestAction(buildResolverInput()).returnContext,
                tier: persisted.difficulty,
                prescription: applyDifficulty({ sets: 4, duration: 60 }),
                deload: isDeloadWeek(),
            };
        });
        expect(r.ctx).toBe('extended-return');
        expect(r.tier).toBe('intermediate');
        expect(r.deload).toBe(false);
        expect(r.prescription.sets).toBe(4);
    }, 30_000);

    test('a member who has never trained is not greeted as returning', async () => {
        const r = await setup(app.page, { schedule: EVERY_DAY, log: [] });
        expect(r.returnContext).toBeNull();
        expect(r.liveness).toBeNull();
    }, 30_000);

    test('REGRESSION: Recovery does not hide an absence from training', async () => {
        const r = await setup(app.page, {
            schedule: EVERY_DAY,
            log: [{ daysAgo: 50 }, { daysAgo: 2, type: 'recovery' }],
        });
        expect(r.returnContext).toBe('extended-return');
    }, 30_000);
});

describe('missed week re-entry', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** A ledger whose previous finished week carries `verdict`. */
    const withLastWeek = (page, verdict) => page.evaluate(({ verdict, FOUR }) => {
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.schedule = [...FOUR];
        persisted.completedDays = [false, false, false, false, false, false, false];
        const d = new Date(); d.setDate(d.getDate() - 2);
        persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
        const lastWeek = window.BP.weekKey(new Date(Date.now() - 7 * 86400000));
        persisted.progressionLedger = [
            { weekKey: lastWeek, targetSessions: verdict === 'neutral' ? 0 : 4,
              qualifyingSessions: verdict === 'qualified' ? 4 : 0, verdict },
            { weekKey: getCurrentWeekKey(), targetSessions: 4, qualifyingSessions: 0, verdict: 'missed' },
        ];
        renderDashboard();
        const live = document.getElementById('today-liveness');
        return { liveness: live.dataset.liveness || null,
                 text: live.classList.contains('hidden') ? null : live.textContent.trim() };
    }, { verdict, FOUR });

    test('a finished week that fell short gets re-entry context', async () => {
        const r = await withLastWeek(app.page, 'missed');
        expect(r.liveness).toBe('missed-week');
        expect(r.text).toMatch(/last week did not go to plan/i);
        expect(r.text).toMatch(/start again from today/i);
    }, 30_000);

    test('and it is re-entry, not judgment', async () => {
        const r = await withLastWeek(app.page, 'missed');
        expect(r.text).not.toMatch(/fail|failed|fell off|behind|should have|lost|penalt/i);
    }, 30_000);

    test.each(['unknown', 'neutral', 'qualified'])
    ('a %s previous week says nothing', async (verdict) => {
        const r = await withLastWeek(app.page, verdict);
        expect(r.liveness).not.toBe('missed-week');
    }, 30_000);

    test('REGRESSION: the week in progress is never called missed', async () => {
        const r = await app.page.evaluate(({ FOUR }) => {
            persisted.primaryGoal = 'all';
            persisted.schedule = [...FOUR];
            persisted.completedDays = [false, false, false, false, false, false, false];
            const d = new Date(); d.setDate(d.getDate() - 1);
            persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
            // Only the live week exists, and it reads as missed to the gate.
            persisted.progressionLedger = [
                { weekKey: getCurrentWeekKey(), targetSessions: 4, qualifyingSessions: 0, verdict: 'missed' },
            ];
            renderDashboard();
            const live = document.getElementById('today-liveness');
            return live.dataset.liveness || null;
        }, { FOUR });
        expect(r).not.toBe('missed-week');
    }, 30_000);

    test('no day is ever named', async () => {
        const r = await withLastWeek(app.page, 'missed');
        expect(r.text).not.toMatch(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i);
    }, 30_000);
});

describe('precedence: one message, and never over the prescription', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('only ever one liveness element, and it is one line', async () => {
        const r = await setup(app.page, { schedule: EVERY_DAY, log: [{ daysAgo: 40 }] });
        const count = await app.page.evaluate(() =>
            document.querySelectorAll('[data-liveness]:not([data-liveness=""])').length);
        expect(r.liveness).toBe('extended-return');
        expect(count).toBe(1);
    }, 30_000);

    test('ACCEPTANCE: returning plus TRAIN keeps the TRAIN prescription', async () => {
        const r = await setup(app.page, { schedule: EVERY_DAY, log: [{ daysAgo: 10 }] });
        expect(r.liveness).toBe('returning');
        expect(r.state).toBe('TRAIN');
        expect(r.launch).toMatch(/START/i);
        expect(r.mission).toBe('length');
    }, 30_000);

    test('ACCEPTANCE: returning plus RECOVER leaves RECOVER authoritative', async () => {
        const r = await app.page.evaluate(({ EVERY_DAY }) => {
            persisted.primaryGoal = 'all';
            persisted.pelvicProfile = 'standard';
            persisted.schedule = [...EVERY_DAY];
            persisted.completedDays = [false, false, false, false, false, false, false];
            const d = new Date(); d.setDate(d.getDate() - 30);
            persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length' }];
            localStorage.setItem(getTodaySorenessKey(), 'high');
            renderDashboard();
            const out = window.BP.nextBestAction(buildResolverInput());
            const live = document.getElementById('today-liveness');
            localStorage.removeItem(getTodaySorenessKey());
            return { state: out.state, mission: out.mission, overrideAllowed: out.overrideAllowed,
                     liveness: live.dataset.liveness || null };
        }, { EVERY_DAY });
        expect(r.state).toBe('RECOVER');
        expect(r.mission).toBe('recovery');
        expect(r.overrideAllowed).toBe(false);
        expect(r.liveness).toBe('extended-return');
    }, 30_000);

    test('week complete suppresses a missed week and a return', async () => {
        const r = await app.page.evaluate(() => {
            const n = ((new Date().getDay() + 6) % 7) + 1;
            persisted.primaryGoal = 'all';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < n ? 'length' : 'rest');
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            const monday = new Date(); monday.setHours(12, 0, 0, 0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            for (let i = 0; i < n; i++) {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length', duration: 30 });
                persisted.completedDays[d.getDay()] = true;
            }
            const lastWeek = window.BP.weekKey(new Date(Date.now() - 7 * 86400000));
            persisted.progressionLedger = [
                { weekKey: lastWeek, targetSessions: 4, qualifyingSessions: 0, verdict: 'missed' },
                { weekKey: getCurrentWeekKey(), targetSessions: n, qualifyingSessions: n, verdict: 'qualified' },
            ];
            renderDashboard();
            const live = document.getElementById('today-liveness');
            const out = window.BP.nextBestAction(buildResolverInput());
            return { weekComplete: out.weekComplete, liveness: live.dataset.liveness || null,
                     text: live.textContent.trim() };
        });
        expect(r.weekComplete).toBe(true);
        expect(r.liveness).toBe('week-complete');
        expect(r.text).not.toMatch(/last week/i);
        expect(r.text).not.toMatch(/you're back/i);
    }, 30_000);

    test('no liveness copy claims anything about the body', async () => {
        const all = await app.page.evaluate(() =>
            Object.values(LIVENESS_COPY).map(f => f({ target: 4, completed: 4 })).join(' | '));
        expect(all).not.toMatch(/adapt|vascular|hormon|tissue|recover(y|ed)|erection|EQ|blood flow|testosterone/i);
        expect(all).not.toMatch(/discipline|committed|consistent person|willpower|dedicated/i);
        expect(all).not.toMatch(/fell off|failed|lazy|excuse|slacking/i);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});

/**
 * The locked Week Complete source-of-truth rules, each driven through the
 * real finishSession().
 *
 *   1 mechanical logged                      counts
 *   2 safe manual mechanical substitution    counts
 *   3 MODIFIED mechanical                    counts
 *   4 Recovery logged                        does not, even with
 *                                            completedDays true
 *   5 nothing logged + manual tick           counts, self-reported
 *   6 nothing logged, no tick                does not
 *
 * sessionLog wins whenever a log exists for the day; the tick is only the
 * fallback when there is nothing logged at all.
 */
describe('what makes a scheduled day count', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'wc' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** A week scheduling Length on every elapsed day, nothing done yet. */
    const blankWeek = (page) => page.evaluate(() => {
        const n = ((new Date().getDay() + 6) % 7) + 1;
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < n ? 'length' : 'rest');
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.sessionLog = [];
        persisted.progressionLedger = [];
        try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
        renderDashboard();
        const w = currentWeekCompletion();
        return { target: w.target, completed: w.completed, elapsed: n };
    });

    /** Read the single derivation plus what the member actually sees. */
    const read = (page) => page.evaluate(() => {
        renderDashboard();
        const w = currentWeekCompletion();
        return {
            completed: w.completed, target: w.target, allDone: w.allDone,
            strip: document.getElementById('hq-week-label').textContent.trim(),
            weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete,
            tickedToday: persisted.completedDays[new Date().getDay()] === true,
        };
    });

    test('1. the scheduled mechanical session counts', async () => {
        const before = await blankWeek(app.page);
        await finish(app.page, 'length');
        const after = await read(app.page);
        expect(after.completed).toBe(before.completed + 1);
    }, 30_000);

    test('2. a safe manual mechanical substitution counts', async () => {
        // Girth completed on a day Length was scheduled. The rule must not
        // compare routineType to the scheduled type.
        const before = await blankWeek(app.page);
        await finish(app.page, 'girth');
        const after = await read(app.page);
        expect(after.completed).toBe(before.completed + 1);
    }, 30_000);

    test('3. a MODIFIED mechanical session counts', async () => {
        const before = await blankWeek(app.page);
        const state = await app.page.evaluate(() => {
            localStorage.setItem(getTodaySorenessKey(), 'moderate');
            renderDashboard();
            return window.BP.nextBestAction(buildResolverInput()).state;
        });
        expect(state).toBe('MODIFIED');          // genuinely in MODIFIED
        await finish(app.page, 'length');
        const after = await read(app.page);
        await app.page.evaluate(() => { localStorage.removeItem(getTodaySorenessKey()); renderDashboard(); });
        expect(after.completed).toBe(before.completed + 1);
    }, 30_000);

    test('4. Recovery does not count, though completedDays is true for it', async () => {
        // The accepted legacy debt, pinned: the boolean flips and changes
        // nothing about the mechanical target.
        const before = await blankWeek(app.page);
        await finish(app.page, 'recovery');
        const after = await read(app.page);
        expect(after.tickedToday).toBe(true);            // the debt is real
        expect(after.completed).toBe(before.completed);  // and it buys nothing
    }, 30_000);

    test('5. a manual tick with nothing logged counts', async () => {
        await blankWeek(app.page);
        const after = await app.page.evaluate(() => {
            // The member telling us about work the app did not time, through
            // the real toggleDayCompletion() path.
            session.selectedDayIdx = new Date().getDay();
            toggleDayCompletion();
            renderDashboard();
            const w = currentWeekCompletion();
            return { completed: w.completed, logged: persisted.sessionLog.length };
        });
        expect(after.logged).toBe(0);
        expect(after.completed).toBe(1);
    }, 30_000);

    test('REGRESSION: a Recovery log blocks the manual-tick fallback', async () => {
        await blankWeek(app.page);
        const after = await app.page.evaluate(async () => {
            session.routineType = 'recovery';
            _sessionStartTime = Date.now() - 20 * 60000;
            selectedEQ = null; selectedRPE = null;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            closeSessionSummary();
            // Now tick the same day by hand. The log already has an answer.
            persisted.completedDays[new Date().getDay()] = true;
            renderDashboard();
            return currentWeekCompletion().completed;
        });
        expect(after).toBe(0);
    }, 30_000);

    test('6. nothing logged and no tick does not count', async () => {
        const r = await blankWeek(app.page);
        expect(r.completed).toBe(0);
    }, 30_000);

    test('ACCEPTANCE: two mechanical and two Recovery on a four session week', async () => {
        const r = await app.page.evaluate(() => {
            // Mon to Thu scheduled, all four days already elapsed or not,
            // seeded directly so the shape is exact: two mechanical, two
            // Recovery, and every day ticked as finishSession() would.
            const monday = new Date(); monday.setHours(12, 0, 0, 0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            persisted.primaryGoal = 'all';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < 4 ? 'length' : 'rest');
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            ['length', 'length', 'recovery', 'recovery'].forEach((type, i) => {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: type, duration: 30 });
                persisted.completedDays[d.getDay()] = true;      // as the writer does
            });
            renderDashboard();
            const w = currentWeekCompletion();
            return { completed: w.completed, target: w.target, allDone: w.allDone,
                     strip: document.getElementById('hq-week-label').textContent.trim(),
                     weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete,
                     allTicked: persisted.completedDays.filter(Boolean).length };
        });
        expect(r.allTicked).toBe(4);             // every day ticked
        expect(r.completed).toBe(2);
        expect(r.target).toBe(4);
        expect(r.strip).toContain('2 of 4');
        expect(r.allDone).toBe(false);
        expect(r.weekComplete).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: three scheduled plus one substitution is a complete week', async () => {
        const r = await app.page.evaluate(() => {
            const monday = new Date(); monday.setHours(12, 0, 0, 0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            persisted.primaryGoal = 'all';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < 4 ? 'length' : 'rest');
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            ['length', 'length', 'length', 'girth'].forEach((type, i) => {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: type, duration: 30 });
                persisted.completedDays[d.getDay()] = true;
            });
            renderDashboard();
            const w = currentWeekCompletion();
            return { completed: w.completed, target: w.target, allDone: w.allDone,
                     strip: document.getElementById('hq-week-label').textContent.trim(),
                     weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete };
        });
        expect(r.completed).toBe(4);
        expect(r.target).toBe(4);
        expect(r.strip).toContain('4 of 4');
        expect(r.allDone).toBe(true);
        expect(r.weekComplete).toBe(true);
    }, 30_000);

    test('7. the strip and Week Complete can never disagree', async () => {
        // A property across fixtures rather than a single case, and the page
        // now has exactly one derivation for both, so it holds by
        // construction instead of by luck.
        const SHAPES = [
            [], ['length'], ['length', 'length'], ['length', 'recovery'],
            ['length', 'length', 'length'], ['length', 'length', 'length', 'girth'],
            ['recovery', 'recovery', 'recovery', 'recovery'],
        ];
        for (const shape of SHAPES) {
            const r = await app.page.evaluate((shape) => {
                const monday = new Date(); monday.setHours(12, 0, 0, 0);
                monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
                persisted.primaryGoal = 'all';
                persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < 4 ? 'length' : 'rest');
                persisted.completedDays = [false, false, false, false, false, false, false];
                persisted.sessionLog = [];
                shape.forEach((type, i) => {
                    const d = new Date(monday); d.setDate(d.getDate() + i);
                    persisted.sessionLog.push({ date: d.toISOString(), routineType: type, duration: 30 });
                    persisted.completedDays[d.getDay()] = true;
                });
                renderDashboard();
                return { strip: document.getElementById('hq-week-label').textContent.trim(),
                         weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete,
                         w: currentWeekCompletion() };
            }, shape);
            const complete = r.w.target > 0 && r.w.completed === r.w.target;
            expect(r.weekComplete).toBe(complete);
            expect(r.strip).toContain(complete ? 'Week complete' : `${r.w.completed} of ${r.w.target}`);
        }
    }, 60_000);

    test('8. a legacy fixture cannot move the week', async () => {
        // {type, durationSeconds} is not a payload finishSession() writes, so
        // it has no routineType and cannot be mechanical. The manual-tick
        // fallback must not rescue it either: something WAS logged that day.
        const r = await app.page.evaluate(() => {
            const monday = new Date(); monday.setHours(12, 0, 0, 0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            persisted.primaryGoal = 'all';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < 4 ? 'length' : 'rest');
            persisted.completedDays = [true, true, true, true, true, true, true];
            persisted.sessionLog = [0, 1, 2, 3].map(i => {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                return { date: d.toISOString(), type: 'length', durationSeconds: 2700 };
            });
            renderDashboard();
            const w = currentWeekCompletion();
            return { completed: w.completed, allDone: w.allDone,
                     weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete };
        });
        expect(r.completed).toBe(0);
        expect(r.allDone).toBe(false);
        expect(r.weekComplete).toBe(false);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
