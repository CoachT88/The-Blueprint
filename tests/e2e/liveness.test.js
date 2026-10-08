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

/**
 * The calendar tick, Phase 2B.2.
 *
 * It means exactly one thing: the scheduled mechanical work for that day was
 * satisfied. It reads the per-day array returned by the same
 * currentWeekCompletion() call the weekly headline uses, so the two cannot
 * disagree about a day. completedDays is still written as before and is
 * simply no longer what the member is shown.
 */
describe('the calendar tick', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'cal' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Length scheduled on every elapsed day, nothing done yet. */
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
    });

    /** What the member can actually see on today's WeekStrip cell. */
    const todayCell = (page) => page.evaluate(() => {
        renderDashboard();
        const i = new Date().getDay();
        /* The strip is Monday-first, so the cell is found by its Sunday
           weekday index rather than by position. Counting cells is how the
           first version of a 3C.3 assertion got the wrong day. */
        const cell = window.__weekStrip().days.find(d => d.weekday === i);
        const w = currentWeekCompletion();
        return {
            ticked: cell.state === 'satisfied',
            rawCompletedDays: persisted.completedDays[i] === true,
            satisfied: w.satisfied[i],
            weekCompleted: w.completed,
            // No Recovery-specific icon was introduced in this phase.
            icon: cell.icon,
        };
    });

    test('1. a mechanical completion ticks the day', async () => {
        await blankWeek(app.page);
        await finish(app.page, 'length');
        const c = await todayCell(app.page);
        expect(c.ticked).toBe(true);
        expect(c.satisfied).toBe(true);
    }, 30_000);

    test('2. a manual mechanical substitution ticks the day', async () => {
        await blankWeek(app.page);
        await finish(app.page, 'girth');
        expect((await todayCell(app.page)).ticked).toBe(true);
    }, 30_000);

    test('3. a MODIFIED mechanical session ticks the day', async () => {
        await blankWeek(app.page);
        const state = await app.page.evaluate(() => {
            localStorage.setItem(getTodaySorenessKey(), 'moderate');
            renderDashboard();
            return window.BP.nextBestAction(buildResolverInput()).state;
        });
        expect(state).toBe('MODIFIED');
        await finish(app.page, 'length');
        const c = await todayCell(app.page);
        await app.page.evaluate(() => { localStorage.removeItem(getTodaySorenessKey()); renderDashboard(); });
        expect(c.ticked).toBe(true);
    }, 30_000);

    test('4. Recovery on a scheduled mechanical day draws no tick', async () => {
        await blankWeek(app.page);
        await finish(app.page, 'recovery');
        const c = await todayCell(app.page);
        expect(c.ticked).toBe(false);
        expect(c.satisfied).toBe(false);
        expect(c.weekCompleted).toBe(0);
    }, 30_000);

    test('5. and completedDays stays true underneath it, unchanged', async () => {
        // The writer is untouched by design. The debt is still there; it is
        // just no longer rendered as mechanical completion.
        await blankWeek(app.page);
        await finish(app.page, 'recovery');
        const c = await todayCell(app.page);
        expect(c.rawCompletedDays).toBe(true);        // still written
        expect(c.ticked).toBe(false);                 // and no longer shown
    }, 30_000);

    test('6. a manual tick with nothing logged ticks the day', async () => {
        await blankWeek(app.page);
        await app.page.evaluate(() => {
            session.selectedDayIdx = new Date().getDay();
            toggleDayCompletion();
        });
        const c = await todayCell(app.page);
        expect(c.ticked).toBe(true);
        expect(c.satisfied).toBe(true);
    }, 30_000);

    test('7. the calendar and the weekly headline read one truth', async () => {
        // Not "they agree on this fixture" but "they come from the same
        // array", asserted across a week of mixed shapes.
        const r = await app.page.evaluate(() => {
            const monday = new Date(); monday.setHours(12, 0, 0, 0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            persisted.primaryGoal = 'all';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < 4 ? 'length' : 'rest');
            persisted.completedDays = [true, true, true, true, true, true, true];
            persisted.sessionLog = [];
            ['length', 'recovery', 'girth'].forEach((type, i) => {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: type, duration: 30 });
            });
            renderDashboard();
            const w = currentWeekCompletion();
            const seen = window.__weekStrip().bySunday;
            return {
                /* Sunday-indexed, so it lines up element for element with
                   weekCompletion()'s own array. */
                ticks: Array.from({ length: 7 }, (_, i) => seen[i] === 'satisfied'),
                satisfied: w.satisfied,
                completed: w.completed,
                strip: document.getElementById('hq-week-label').textContent.trim(),
            };
        });
        // Every tick is exactly the shared array, element for element.
        expect(r.ticks).toEqual(r.satisfied);
        // And the headline is that array's count.
        expect(r.ticks.filter(Boolean).length).toBe(r.completed);
        // Mon mechanical, Tue Recovery, Wed substitution, Thu hand-ticked.
        expect(r.completed).toBe(3);
        expect(r.strip).toContain('3 of 4');
    }, 30_000);

    test('a scheduled rest day never ticks, even when trained on', async () => {
        // There is no scheduled mechanical work to satisfy, which is the
        // same reason a rest day is in neither side of the fraction.
        const r = await app.page.evaluate(() => {
            const monday = new Date(); monday.setHours(12, 0, 0, 0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            persisted.schedule = ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'];
            persisted.completedDays = [true, true, true, true, true, true, true];
            persisted.sessionLog = [{ date: monday.toISOString(), routineType: 'length', duration: 30 }];
            renderDashboard();
            const seen = window.__weekStrip().bySunday;
            return Array.from({ length: 7 }, (_, i) => seen[i] === 'satisfied');
        });
        expect(r.every(t => t === false)).toBe(true);
    }, 30_000);

    test('no Recovery-specific icon was introduced', async () => {
        await blankWeek(app.page);
        await finish(app.page, 'recovery');
        const c = await todayCell(app.page);
        // The cell still shows the SCHEDULED mission's icon, not a new one.
        expect(c.icon).toContain(await app.page.evaluate(() => dayTypeIcon('length')));
        expect(c.icon).not.toMatch(/recovery|heart|leaf|spa/i);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});

/**
 * TODAY COMPLETE and WEEKLY MECHANICAL COMPLETION are different questions,
 * and the app now answers each one honestly without the other.
 *
 * A prescribed Recovery session completes the DAY. It must not be answered
 * with another mechanical CTA, because that would undercut the safety
 * hierarchy that prescribed Recovery. It also must not be worded as though
 * the scheduled session happened.
 */
describe('today complete versus weekly mechanical completion', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'tc' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

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
    });

    /** Everything the member can see after today is finished. */
    const card = (page) => page.evaluate(() => {
        renderDashboard();
        const i = new Date().getDay();
        const shown = id => !document.getElementById(id).classList.contains('hidden');
        const w = currentWeekCompletion();
        const r = window.BP.nextBestAction(buildResolverInput());
        return {
            state: r.state,
            headline: document.getElementById('today-headline').textContent.trim(),
            sub: shown('today-sub') ? document.getElementById('today-sub').textContent.trim() : '',
            why: shown('today-why') ? document.getElementById('today-why').textContent.trim() : '',
            summary: document.getElementById('today-complete-summary').textContent,
            launch: shown('launch-btn'),
            optional: shown('today-optional-btn'),
            alt: shown('today-alt-btn'),
            resume: shown('resume-btn'),
            ticked: window.__weekStrip().days.find(d => d.weekday === i).state === 'satisfied',
            weekCompleted: w.completed,
            weekComplete: r.weekComplete,
        };
    });

    test('1. scheduled Length completed: today done, tick, counter up', async () => {
        await blankWeek(app.page);
        await finish(app.page, 'length');
        const c = await card(app.page);
        expect(c.state).toBe('COMPLETE');
        expect(c.headline).toBe('Today Is Done');
        expect(c.ticked).toBe(true);
        expect(c.weekCompleted).toBe(1);
    }, 30_000);

    test('2. prescribed Recovery completed: today done, no tick, counter flat', async () => {
        await blankWeek(app.page);
        await app.page.evaluate(() => {
            // High soreness, so Recovery is what the app itself prescribed.
            localStorage.setItem(getTodaySorenessKey(), 'high');
            renderDashboard();
        });
        const prescribed = await app.page.evaluate(() =>
            window.BP.nextBestAction(buildResolverInput()).state);
        expect(prescribed).toBe('RECOVER');
        await finish(app.page, 'recovery');
        const c = await card(app.page);
        await app.page.evaluate(() => { localStorage.removeItem(getTodaySorenessKey()); renderDashboard(); });
        expect(c.state).toBe('COMPLETE');          // the DAY is complete
        expect(c.ticked).toBe(false);              // the mechanical day is not
        expect(c.weekCompleted).toBe(0);
        expect(c.weekComplete).toBe(false);
    }, 30_000);

    test('3. the copy names Recovery and closes the day', async () => {
        await blankWeek(app.page);
        await finish(app.page, 'recovery');
        const c = await card(app.page);
        expect(c.headline).toBe('Recovery Complete');
        expect(`${c.sub} ${c.why}`).toMatch(/done for today/i);
        expect(c.summary).toMatch(/Recovery/);     // the chip says what it was
    }, 30_000);

    test('4. and it offers no further mechanical work that day', async () => {
        // Answering a prescribed Recovery with another START button would
        // undercut the hierarchy that prescribed it.
        await blankWeek(app.page);
        await finish(app.page, 'recovery');
        const c = await card(app.page);
        expect(c.launch).toBe(false);
        expect(c.optional).toBe(false);
        expect(c.alt).toBe(false);
        expect(c.resume).toBe(false);
    }, 30_000);

    test('5. Week Complete stays false until the mechanical target is met', async () => {
        const r = await app.page.evaluate(() => {
            const monday = new Date(); monday.setHours(12, 0, 0, 0);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            persisted.primaryGoal = 'all';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => ((i + 6) % 7) < 4 ? 'length' : 'rest');
            persisted.completedDays = [true, true, true, true, true, true, true];
            persisted.sessionLog = [];
            // Four Recovery sessions: every day "complete", no mechanical work.
            [0, 1, 2, 3].forEach(i => {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: 'recovery', duration: 20 });
            });
            renderDashboard();
            return { weekComplete: window.BP.nextBestAction(buildResolverInput()).weekComplete,
                     strip: document.getElementById('hq-week-label').textContent.trim() };
        });
        expect(r.weekComplete).toBe(false);
        expect(r.strip).toContain('0 of 4');
    }, 30_000);

    test('6. REGRESSION: mechanical wording cannot render after Recovery only', async () => {
        await blankWeek(app.page);
        await finish(app.page, 'recovery');
        const c = await card(app.page);
        const all = `${c.headline} ${c.sub} ${c.why}`;
        // The generic mechanical headline must not be what a Recovery day
        // shows, and nothing on the card may claim the week moved.
        expect(c.headline).not.toBe('Today Is Done');
        expect(all).not.toMatch(/session complete|scheduled session|target met|week complete/i);
        expect(all).not.toMatch(/\b(length|girth|stamina)\b/i);
        expect(c.summary).not.toMatch(/Unset/);
    }, 30_000);

    test('a hand-ticked day with nothing logged keeps the neutral wording', async () => {
        await blankWeek(app.page);
        await app.page.evaluate(() => {
            session.selectedDayIdx = new Date().getDay();
            toggleDayCompletion();
        });
        const c = await card(app.page);
        expect(c.state).toBe('COMPLETE');
        expect(c.headline).toBe('Today Is Done');
        expect(c.ticked).toBe(true);               // the approved self-report
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});

/**
 * Selective personalization, Phase 2B.3.3.
 *
 * Extended return is the one other place the name is used, and it appears
 * once. Twenty eight days is product policy about when an acknowledgement is
 * useful, never a conclusion about anyone's body.
 */
describe('extended return, with and without a name', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'xr' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Away `daysAgo`, optionally named, then render. */
    const away = (page, daysAgo, name) => page.evaluate(({ daysAgo, name }) => {
        currentUser = { ...currentUser, user_metadata: name ? { preferred_name: name } : {} };
        _persistedLoaded = true;
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.schedule = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.progressionLedger = [];
        const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(12, 0, 0, 0);
        persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
        Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
        renderDashboard();
        const r = window.BP.nextBestAction(buildResolverInput());
        const live = document.getElementById('today-liveness');
        const greet = document.getElementById('hq-greeting');
        return {
            liveness: live.dataset.liveness || null,
            text: live.classList.contains('hidden') ? '' : live.textContent.trim(),
            greetingShown: !greet.classList.contains('hidden'),
            state: r.state, mission: r.mission, duration: r.duration, modifiers: r.modifiers,
            returnContext: r.returnContext,
            // Everything personalization is forbidden from touching.
            difficulty: persisted.difficulty, deload: isDeloadWeek(),
            weekComplete: r.weekComplete, prescription: applyDifficulty({ sets: 4, duration: 60 }),
        };
    }, { daysAgo, name });

    test('ACCEPTANCE: 28 days with a name is a restrained named welcome', async () => {
        const r = await away(app.page, 40, 'Marcus');
        expect(r.liveness).toBe('extended-return');
        expect(r.text).toBe("Welcome back, Marcus. Today's session is the only thing to think about.");
        // The name appears exactly once.
        expect(r.text.match(/Marcus/g)).toHaveLength(1);
    }, 30_000);

    test('ACCEPTANCE: 28 days with no name keeps the existing wording', async () => {
        const r = await away(app.page, 40, null);
        expect(r.liveness).toBe('extended-return');
        expect(r.text).toBe("You're back after a while away. Today's session is the only thing to think about.");
    }, 30_000);

    test('7 to 27 days does not gain the named treatment', async () => {
        for (const d of [7, 15, 27]) {
            const r = await away(app.page, d, 'Marcus');
            expect(r.liveness).toBe('returning');
            expect(r.text).toBe("You're back. Pick it up with today's session.");
            expect(r.text).not.toContain('Marcus');
        }
    }, 60_000);

    test('under 7 days says nothing at all', async () => {
        const r = await away(app.page, 3, 'Marcus');
        expect(r.liveness).toBe(null);
        expect(r.text).toBe('');
    }, 30_000);

    test('ACCEPTANCE: the ordinary greeting is suppressed that day', async () => {
        const r = await away(app.page, 40, 'Marcus');
        expect(r.greetingShown).toBe(false);
        // So the name is said once on the whole screen, not twice.
        const whole = await app.page.evaluate(() => document.getElementById('step-0').textContent);
        expect(whole.match(/Marcus/g)).toHaveLength(1);
    }, 30_000);

    test('ACCEPTANCE: it changes nothing about the prescription', async () => {
        const named = await away(app.page, 40, 'Marcus');
        const anon = await away(app.page, 40, null);
        expect(named.state).toBe(anon.state);
        expect(named.mission).toBe(anon.mission);
        expect(named.duration).toBe(anon.duration);
        expect(named.modifiers).toEqual(anon.modifiers);
        expect(named.returnContext).toBe(anon.returnContext);
        expect(named.difficulty).toBe(anon.difficulty);
        expect(named.deload).toBe(anon.deload);
        expect(named.weekComplete).toBe(anon.weekComplete);
        expect(named.prescription).toEqual(anon.prescription);
        // And the tier a named member lands on is the untouched default.
        expect(named.difficulty).toBe('intermediate');
    }, 30_000);

    test('REGRESSION: a markup-like name stays inert', async () => {
        const r = await app.page.evaluate(() => {
            window.__xss = 0;
            currentUser = { ...currentUser, user_metadata: { preferred_name: '<img src=x onerror="window.__xss=1">' } };
            _persistedLoaded = true;
            const d = new Date(); d.setDate(d.getDate() - 40); d.setHours(12, 0, 0, 0);
            persisted.sessionLog = [{ date: d.toISOString(), routineType: 'length', duration: 30 }];
            renderDashboard();
            const live = document.getElementById('today-liveness');
            return { xss: window.__xss, imgs: live.querySelectorAll('img').length, html: live.innerHTML, text: live.textContent };
        });
        expect(r.xss).toBe(0);
        expect(r.imgs).toBe(0);
        expect(r.html).not.toContain('<img');
        expect(r.text).toContain('<img');
    }, 30_000);

    test('no return copy claims anything about the body', async () => {
        const all = await app.page.evaluate(() =>
            ['returning', 'extended-return'].map(k => LIVENESS_COPY[k]({ target: 4 }, 'Marcus')).join(' | '));
        expect(all).not.toMatch(/lost progress|detrain|starting over|start over|tolerance|slipped back/i);
        expect(all).not.toMatch(/adapt|vascular|hormon|tissue|erection|blood flow|testosterone/i);
        expect(all).not.toMatch(/discipline|willpower|lazy|fell off/i);
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
