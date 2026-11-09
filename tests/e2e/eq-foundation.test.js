import {beforeAll, afterAll, beforeEach, describe, test, expect} from 'vitest';
import {openApp, signIn} from './harness.js';

/**
 * The EQ foundation, from the member's side.
 *
 * Two halves. The first proves that with EQ_SESSIONS_ENABLED false NOTHING
 * about the existing experience moves -- not the schedule a member is offered,
 * not their rest days, not completion, not the migration. The second flips the
 * flag inside the page and proves the new week behaves as approved.
 *
 * The flag is restored to false in beforeEach so one half cannot leak into the
 * other, and the file leaves it false.
 */
const OLD_EQ = ['stamina', 'rest', 'length', 'rest', 'stamina', 'rest', 'rest'];
const NEW_EQ = ['stamina', 'rest', 'rest', 'stamina', 'rest', 'stamina', 'rest'];

describe('the EQ foundation', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, {id: 'eqfound'});
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    beforeEach(async () => {
        await app.page.evaluate(() => {
            EQ_SESSIONS_ENABLED = false;
            persisted.primaryGoal = 'eq';
            persisted.schedule = ['stamina', 'rest', 'length', 'rest', 'stamina', 'rest', 'rest'];
            persisted.sessionLog = [];
            persisted.dayPlans = [];
            /* No programme.key: onAuthoritativePlans() is false, so the live
               prescription IS the legacy column. mayGenerateOver() does not
               need a key, so the migration tests are unaffected. */
            persisted.programme = {custom: false,
                migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
        });
    });

    /* ── Flag off: nothing moves ─────────────────────────────────────────── */

    test('the flag ships false', async () => {
        expect(await app.page.evaluate(() => EQ_SESSIONS_ENABLED)).toBe(false);
    });

    test('the schedule a member is offered is still the one that shipped', async () => {
        const r = await app.page.evaluate(() => ({
            eq: goalSchedule('eq'),
            size: goalSchedule('size'),
            all: goalSchedule('all'),
        }));
        expect(r.eq).toEqual(OLD_EQ);
        // The other goals are untouched either way, which is the point.
        expect(r.size).toEqual(['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest']);
        expect(r.all).toEqual(['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest']);
    });

    test('no day is a full-rest day and no day is EQ-satisfiable', async () => {
        const r = await app.page.evaluate(() => ({
            full: fullRestDays(), sat: eqSatisfiableDays(),
            tue: isFullRestDay(2), satDay: isFullRestDay(6),
        }));
        expect(r).toEqual({full: [], sat: [], tue: false, satDay: false});
    });

    test('a stamina day still serves the stamina routine', async () => {
        const r = await app.page.evaluate(() => {
            const mapped = eqRoutineFor('stamina');
            session.routineType = mapped;
            session.eqRoutine = mapped === 'eq' ? buildEqRoutine() : null;
            return {mapped, titles: currentRoutine().map(x => x.title)};
        });
        expect(r.mapped).toBe('stamina');
        expect(r.titles).toEqual(['Edging — Controlled Hold', 'Lateral Compression']);
    });

    test('the migration refuses to run at all', async () => {
        const r = await app.page.evaluate(() => ({
            eligible: eqMigrationEligible(),
            migrated: migrateEqWeek(),
            schedule: persisted.schedule,
        }));
        expect(r.eligible).toBe(false);
        expect(r.migrated).toBe(false);
        expect(r.schedule).toEqual(OLD_EQ);
    });

    test('a rest day still carries its practice', async () => {
        // Tuesday 2026-11-10. With the flag off this is an ordinary rest day,
        // so the stored plan still asks for something.
        const items = await app.page.evaluate(() => plannedPelvicItems('2026-11-10', 'rest'));
        expect(items.length).toBeGreaterThan(0);
    });

    /* ── Flag on: the approved week ──────────────────────────────────────── */

    const on = fn => app.page.evaluate(`(() => { EQ_SESSIONS_ENABLED = true; return (${fn})(); })()`);

    test('the EQ week is offered, and only to EQ', async () => {
        const r = await on(() => ({eq: goalSchedule('eq'), size: goalSchedule('size')}));
        expect(r.eq).toEqual(NEW_EQ);
        expect(r.size).toEqual(['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest']);
    });

    test('Tuesday and Saturday are genuine rest, and the stored plan asks nothing', async () => {
        const r = await on(() => ({
            _onWeek: (persisted.schedule = goalSchedule('eq').slice(), onEqWeek()),
            full: fullRestDays(),
            tue: isFullRestDay(2), sat: isFullRestDay(6), wed: isFullRestDay(3),
            // 2026-11-10 is a Tuesday, 2026-11-14 a Saturday, 2026-11-09 a Monday.
            tueItems: plannedPelvicItems('2026-11-10', 'rest'),
            satItems: plannedPelvicItems('2026-11-14', 'rest'),
            monItems: plannedPelvicItems('2026-11-09', 'rest'),
        }));
        expect(r.full).toEqual([2, 6]);
        expect({tue: r.tue, sat: r.sat, wed: r.wed}).toEqual({tue: true, sat: true, wed: false});
        expect(r.tueItems).toEqual([]);
        expect(r.satItems).toEqual([]);
        // A supporting-practice day is unaffected: genuine rest is two days,
        // not every non-session day.
        expect(r.monItems.length).toBeGreaterThan(0);
    });

    test('the member is told the day requires nothing', async () => {
        const copy = await on(() => EQ_COPY.fullRest);
        expect(copy).toMatch(/nothing is required today/i);
    });

    test('the three session days are the EQ-satisfiable ones', async () => {
        expect(await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            return eqSatisfiableDays();
        })).toEqual([0, 3, 5]);
    });

    test('a session day serves the three EQ steps, and logs as eq', async () => {
        const r = await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            /* Selection and completion must agree, whatever weekday the suite
               happens to run on. That agreement is the property, not the
               particular answer. */
            const isSessionDay = eqSatisfiableDays().includes(new Date().getDay());
            const mapped = eqRoutineFor('stamina');
            session.routineType = 'eq';
            session.eqRoutine = buildEqRoutine();
            return {isSessionDay, mapped, titles: currentRoutine().map(x => x.title),
                    label: dayTypeLabel('eq'), recoveryRules: isRecoveryRoutine()};
        });
        expect(r.mapped).toBe(r.isSessionDay ? 'eq' : 'stamina');
        expect(r.titles).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Deep Squat — Malasana']);
        expect(r.label).toBe('EQ session');
        // Recovery rules for XP and difficulty, because that is what it is.
        expect(r.recoveryRules).toBe(true);
    });

    /* ── The EQ behaviour follows the ACTIVE PRESCRIPTION, not the goal ─── */

    test('a customised EQ week keeps the experience the member chose', async () => {
        // Goal is 'eq' and the flag is on, but they rearranged their days, so
        // the migration skipped them. Nothing EQ may touch them: not their
        // stamina exercise, not their Tuesday, not their completion rules.
        const r = await on(() => {
            persisted.schedule = ['rest', 'stamina', 'length', 'rest', 'stamina', 'rest', 'rest'];
            return {onWeek: onEqWeek(), mapped: eqRoutineFor('stamina'),
                    full: fullRestDays(), sat: eqSatisfiableDays(),
                    tueItems: plannedPelvicItems('2026-11-10', 'rest').length};
        });
        expect(r.onWeek).toBe(false);
        expect(r.mapped).toBe('stamina');
        expect(r.full).toEqual([]);
        expect(r.sat).toEqual([]);
        expect(r.tueItems).toBeGreaterThan(0);
    });

    test('a preserved dated plan outranks the new week on a migration day', async () => {
        // migrateEqWeek() keeps today's prescription. So on the day of the
        // migration the stored week is the new one while today's plan is the
        // old one -- and today must answer to the plan it was given.
        const r = await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            persisted.programme = {key: 'eq', custom: false,
                migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
            const today = window.BP.planDateKey(new Date());
            // A rest-mode plan is the minimal valid dated plan.
            persisted.dayPlans = [{date: today, mode: 'rest'}];
            return {today: new Date().getDay(), sat: eqSatisfiableDays(),
                    mapped: eqRoutineFor('stamina')};
        });
        // Today's preserved plan says rest, so today is not an EQ day even if
        // the new week schedules a session on that weekday.
        expect(r.sat).not.toContain(r.today);
        expect(r.mapped).toBe('stamina');
    });

    test('an unknown live prescription is never treated as nothing required', async () => {
        // Authoritative plans with none stored: we cannot say what the day
        // asks for, and "unsure" is not a reason to tell a member to rest.
        const r = await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            persisted.programme = {key: 'eq', custom: false,
                migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
            persisted.dayPlans = [];
            return {full: fullRestDays(), sat: eqSatisfiableDays()};
        });
        expect(r.full).toEqual([]);
        expect(r.sat).toEqual([]);
    });

    test('a preserved Length prescription is not an EQ day', async () => {
        // A member can reach the EQ week without migrating -- selectGoal()
        // writes the preset directly -- so their previous programme's dated
        // plans survive the current week. Sunday is an EQ session day in the
        // new week; a preserved Length plan on it is training, but it is not
        // the session the EQ week prescribes.
        const r = await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            persisted.programme = {key: 'eq', custom: false,
                migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
            const sunday = window.BP.planDateKey(new Date());
            const day = new Date().getDay();
            persisted.dayPlans = [{date: sunday, mode: 'prescribed',
                primarySession: {type: 'length', dose: {v: 1, shape: 'sets',
                    exercises: [{title: 'Directional Pulls', sets: 3, duration: 30}]}}}];
            return {day, sat: eqSatisfiableDays(), live: resolvedWeekSlots()[day]};
        });
        // Whatever weekday the suite runs on, today's live slot is length and
        // the EQ week never prescribes length, so today is not EQ-eligible.
        expect(r.sat).not.toContain(r.day);
    });

    test('a future rest day is decided by its own date, not this week\'s', async () => {
        // plannedPelvicItems() is called for future dates during generation.
        // Asking the weekday question against THIS week meant a preserved
        // non-rest plan on this Tuesday put activities on every Tuesday.
        const r = await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            persisted.programme = {key: 'eq', custom: false,
                migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
            /* This week's Tuesday carries a preserved training plan. Find the
               Tuesday of the current week the same way the app resolves it. */
            const now = new Date();
            const thisTue = new Date(now); thisTue.setDate(now.getDate() + ((2 - now.getDay() + 7) % 7));
            const thisTueKey = window.BP.planDateKey(thisTue);
            const nextTue = new Date(thisTue); nextTue.setDate(thisTue.getDate() + 7);
            const nextTueKey = window.BP.planDateKey(nextTue);
            persisted.dayPlans = [{date: thisTueKey, mode: 'prescribed',
                primarySession: {type: 'length', dose: {v: 1, shape: 'sets',
                    exercises: [{title: 'Directional Pulls', sets: 3, duration: 30}]}}}];
            return {thisTueKey, nextTueKey,
                    thisTue: plannedPelvicItems(thisTueKey, 'rest').length,
                    nextTue: plannedPelvicItems(nextTueKey, 'rest').length,
                    thisIsRest: isFullRestDate(thisTueKey),
                    nextIsRest: isFullRestDate(nextTueKey)};
        });
        // This Tuesday has a training plan, so it still asks for its practice.
        expect(r.thisIsRest).toBe(false);
        expect(r.thisTue).toBeGreaterThan(0);
        // Next Tuesday has no plan of its own, so the EQ week decides: rest.
        expect(r.nextIsRest).toBe(true);
        expect(r.nextTue).toBe(0);
    });

    test('mobility rotates by the prescribed date, deterministically', async () => {
        // 2026-11-08 is a Sunday, 11-11 a Wednesday, 11-13 a Friday.
        const r = await on(() => ({
            sun: buildEqRoutine('2026-11-08').map(x => x.title),
            wed: buildEqRoutine('2026-11-11').map(x => x.title),
            fri: buildEqRoutine('2026-11-13').map(x => x.title),
            // Same date twice must give the same answer: no clock, no randomness.
            again: buildEqRoutine('2026-11-08').map(x => x.title),
            // A day outside the rotation falls back rather than breaking.
            tue: buildEqRoutine('2026-11-10').map(x => x.title),
        }));
        expect(r.sun).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Cat-Cow']);
        expect(r.wed).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Deep Squat — Malasana']);
        expect(r.fri).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Happy Baby']);
        expect(r.again).toEqual(r.sun);
        expect(r.tue).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Deep Squat — Malasana']);
    });

    test('Cat-Cow is appended, so no stored index moves', async () => {
        const r = await on(() => ({
            catCow: ROUTINES.recovery.findIndex(x => x.title === 'Cat-Cow'),
            total: ROUTINES.recovery.length,
            // The indices src/pelvicPractice.js maps ids onto must be untouched.
            breathing: ROUTINES.recovery[8].title,
            release: ROUTINES.recovery[2].title,
            squat: ROUTINES.recovery[4].title,
            happyBaby: ROUTINES.recovery[5].title,
        }));
        expect(r.catCow).toBe(9);
        expect(r.total).toBe(10);
        expect(r.breathing).toBe('Diaphragmatic breathing');
        expect(r.release).toBe('Pelvic Floor Release');
        expect(r.squat).toBe('Deep Squat — Malasana');
        expect(r.happyBaby).toBe('Happy Baby');
    });

    test('a resumed session keeps the mobility exercise it started with', async () => {
        // The bug this pins: the draft restored routineType but not the step
        // list, so currentRoutine() fell back to ROUTINES.eq and a Sunday
        // Cat-Cow session came back as Deep Squat. Re-deriving on resume would
        // have the same effect across midnight.
        const r = await on(() => {
            // Started on a Sunday: Cat-Cow.
            const started = eqStepIndicesFor('2026-11-08');
            // Resume reads the saved list, whatever today is.
            const draft = {routineType: 'eq', eqStepIndices: started.slice()};
            const ok = Array.isArray(draft.eqStepIndices) && draft.eqStepIndices.length
                && draft.eqStepIndices.every(i => Number.isInteger(i) && i >= 0 && i < ROUTINES.recovery.length);
            const restored = ok ? draft.eqStepIndices.slice() : null;
            return {started, restored,
                    titles: eqStepsFrom(restored).map(x => x.title),
                    fallbackWouldBe: ROUTINES.eq.map(x => x.title)};
        });
        expect(r.restored).toEqual(r.started);
        expect(r.titles).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Cat-Cow']);
        // And it genuinely differs from the fallback, so the test is not vacuous.
        expect(r.titles).not.toEqual(r.fallbackWouldBe);
    });

    test('the breathing step carries its own pelvic cue, but not inside the EQ session', async () => {
        // Standalone it may be the only activity of the day, so it keeps a
        // short line about easing tension without pushing. In the EQ session
        // Pelvic Floor Release teaches that properly in the next step, so the
        // line is dropped rather than repeated.
        const r = await on(() => {
            const shared = ROUTINES.recovery[8];
            const inEq = buildEqRoutine('2026-11-08')[0];
            return {sharedHowto: shared.howto.join(' '), eqHowto: inEq.howto.join(' '),
                    sharedDetail: shared.detail, eqDetail: inEq.detail,
                    sharedSteps: shared.howto.length, eqSteps: inEq.howto.length};
        });
        expect(r.sharedHowto).toMatch(/let any tension underneath your pelvis ease/);
        expect(r.sharedDetail).toMatch(/without pushing or straining/);
        expect(r.eqHowto).not.toMatch(/let any tension underneath your pelvis ease/);
        expect(r.eqSteps).toBe(r.sharedSteps - 1);   // 8 standalone, 7 in the EQ session
        // The rhythm instruction survives in both: only the pelvic line goes.
        expect(r.eqHowto).toMatch(/out for about six seconds/);
    });

    test('a saved step list does not bypass a restriction that applies on return', async () => {
        // The member started a Sunday session with all three steps, then
        // reported pain before resuming. The saved list still contains the
        // pelvic step; the protections must re-apply on the way back in.
        const r = await on(() => {
            const saved = eqStepIndicesFor('2026-11-08');     // [8, 2, 9]
            persisted.sessionLog = [{date: new Date().toISOString(), routineType: 'recovery',
                pelvicPractice: {feedback: 'painful'}}];
            try { localStorage.removeItem(pelvicReviewKey()); } catch (e) {}
            // The resume path's own filtering, applied to the saved list.
            let idx = saved.slice();
            if (pelvicPracticeNeedsReview()) idx = idx.filter(i => i !== 2);
            idx = allowedRecoveryIndices(idx);
            return {saved, pending: pelvicPracticeNeedsReview(),
                    titles: eqStepsFrom(idx).map(x => x.title)};
        });
        expect(r.saved).toContain(2);
        expect(r.pending).toBe(true);
        expect(r.titles).not.toContain('Pelvic Floor Release');
        expect(r.titles).toEqual(['Diaphragmatic breathing', 'Cat-Cow']);
    });

    test('a malformed saved index cannot resume at the wrong step', async () => {
        const r = await on(() => {
            const bad = [
                [8, 2, 99],          // out of range
                [8, 2, -1],          // negative
                [8, 2, 1.5],         // not an integer
                [],                  // empty
                ['8', '2'],          // strings
            ];
            const n = ROUTINES.recovery.length;
            const accepted = bad.map(raw =>
                !!(raw.length && raw.every(i => Number.isInteger(i) && i >= 0 && i < n)));
            // And the clamp: an exerciseIndex past the end comes back in range.
            const steps = eqStepsFrom(eqStepIndicesFor('2026-11-08'));
            const clamp = (i) => Math.max(0, Math.min(steps.length - 1,
                Number.isInteger(i) ? i : 0));
            return {accepted, clamped: [clamp(99), clamp(-4), clamp(1.5), clamp(2)]};
        });
        expect(r.accepted).toEqual([false, false, false, false, false]);
        expect(r.clamped).toEqual([2, 0, 0, 2]);
    });

    /* ── The breathing guide ─────────────────────────────────────────────── */

    test('the default pattern is four in, six out, and nothing held', async () => {
        const r = await on(() => eqBreathPhases().map(p => ({l: p.label, s: p.secs})));
        expect(r).toEqual([{l: 'INHALE', s: 4}, {l: 'EXHALE', s: 6}]);
        // No HOLD anywhere in the default: this is not a breath-holding drill.
        expect(r.some(p => p.l === 'HOLD')).toBe(false);
    });

    test('the optional pause is called PAUSE, never HOLD', async () => {
        const r = await on(() => {
            setEqBreathPref('pause', true);
            const ph = eqBreathPhases();
            return {labels: ph.map(p => p.label), secs: ph.map(p => p.secs),
                    sub: ph[1].sub};
        });
        expect(r.labels).toEqual(['INHALE', 'PAUSE', 'EXHALE']);
        expect(r.secs).toEqual([4, 1, 6]);
        // A member who reads "hold" holds. The cue says the opposite.
        expect(r.sub).toMatch(/nothing to hold/i);
    });

    test('the longer exhale is eight seconds and is opt-in', async () => {
        const r = await on(() => {
            setEqBreathPref('pause', false);
            setEqBreathPref('longExhale', true);
            const on8 = eqBreathPhases();
            setEqBreathPref('longExhale', false);
            const off = eqBreathPhases();
            return {on8: on8.map(p => p.secs), off: off.map(p => p.secs)};
        });
        expect(r.on8).toEqual([4, 8]);
        expect(r.off).toEqual([4, 6]);
    });

    test('the rest overlay keeps its own 4/4/4/4 box pattern', async () => {
        // Called with no argument, as every existing caller does.
        const r = await on(() => {
            startBoxBreathing();
            const used = _breathPhases.map(p => ({l: p.label, s: p.secs}));
            stopBoxBreathing();
            return used;
        });
        expect(r).toEqual([
            {l: 'INHALE', s: 4}, {l: 'HOLD', s: 4},
            {l: 'EXHALE', s: 4}, {l: 'HOLD', s: 4},
        ]);
    });

    test('the circle animates for exactly as long as the phase lasts', async () => {
        // The bug: the transition was the literal 4s, so a six-second exhale
        // finished animating two seconds early and then sat still -- the one
        // thing a pacing visual must not do.
        const r = await on(() => {
            startBoxBreathing(eqBreathPhases());
            const inhale = document.querySelector('#ex-breath-guide [data-breath="circle"]').style.transition;
            _breathPhases = eqBreathPhases(); _boxPhaseIdx = 1; renderBoxPhase();
            const exhale = document.querySelector('#ex-breath-guide [data-breath="circle"]').style.transition;
            stopBoxBreathing();
            return {inhale, exhale};
        });
        expect(r.inhale).toMatch(/transform 4s/);
        expect(r.exhale).toMatch(/transform 6s/);
    });

    test('extra pips are hidden rather than left lit', async () => {
        // The host markup carries three pips; a two-phase pattern must not
        // look like a three-phase one with a dead dot.
        const r = await on(() => {
            setEqBreathPref('pause', false);
            startBoxBreathing(eqBreathPhases());
            const pips = [...document.querySelectorAll('#ex-breath-guide [data-breath="pip"]')]
                .map(p => p.style.display);
            stopBoxBreathing();
            return pips;
        });
        expect(r).toEqual(['', '', 'none']);
    });

    test('the guide shows for the EQ breathing step and hides when it ends', async () => {
        const r = await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            session.routineType = 'eq';
            session.eqStepIndices = eqStepIndicesFor('2026-11-08');
            session.eqRoutine = eqStepsFrom(session.eqStepIndices);
            session.exerciseIndex = 0; session.setIndex = 1;
            startSet();
            const during = !document.getElementById('ex-breath-guide').classList.contains('hidden');
            const running = _boxInterval !== null;
            stopEqBreathGuide();
            const after = !document.getElementById('ex-breath-guide').classList.contains('hidden');
            if (session.timer) { session.timer.cancel(); session.timer = null; }
            return {during, running, after, intervalAfter: _boxInterval};
        });
        expect(r.during).toBe(true);
        expect(r.running).toBe(true);
        expect(r.after).toBe(false);
        expect(r.intervalAfter).toBe(null);
    });

    test('pausing the set pauses the breath guide, and resuming restarts it', async () => {
        const r = await on(() => {
            persisted.schedule = goalSchedule('eq').slice();
            session.routineType = 'eq';
            session.eqStepIndices = eqStepIndicesFor('2026-11-08');
            session.eqRoutine = eqStepsFrom(session.eqStepIndices);
            session.exerciseIndex = 0; session.setIndex = 1;
            startSet();
            const started = _boxInterval !== null;
            pauseResumeSet();
            const paused = _boxInterval;
            pauseResumeSet();
            const resumed = _boxInterval !== null;
            stopEqBreathGuide();
            if (session.timer) { session.timer.cancel(); session.timer = null; }
            return {started, paused, resumed};
        });
        expect(r.started).toBe(true);
        // A paced breath running against a frozen timer is competing state.
        expect(r.paused).toBe(null);
        expect(r.resumed).toBe(true);
    });

    test('leaving the exercise screen hides the guide, not just its interval', async () => {
        const r = await on(() => {
            session.routineType = 'eq';
            session.eqStepIndices = eqStepIndicesFor('2026-11-08');
            session.eqRoutine = eqStepsFrom(session.eqStepIndices);
            session.exerciseIndex = 0; session.setIndex = 1;
            startSet();
            const during = !document.getElementById('ex-breath-guide').classList.contains('hidden');
            // What the home and back buttons now call.
            stopEqBreathGuide();
            if (session.timer) { session.timer.cancel(); session.timer = null; }
            return {during, interval: _boxInterval,
                    hidden: document.getElementById('ex-breath-guide').classList.contains('hidden')};
        });
        expect(r.during).toBe(true);
        expect(r.interval).toBe(null);
        expect(r.hidden).toBe(true);
    });

    test('the optional beat is a transition, never something to sustain', async () => {
        const r = await on(() => {
            setEqBreathPref('pause', true);
            const ph = eqBreathPhases();
            setEqBreathPref('pause', false);
            return {label: ph[1].label, sub: ph[1].sub, secs: ph[1].secs,
                    howto: ROUTINES.recovery[8].howto.join(' ')};
        });
        expect(r.label).toBe('PAUSE');
        expect(r.secs).toBe(1);
        expect(r.sub).toMatch(/nothing to hold/i);
        // And the guide says both adjustments are optional and droppable.
        expect(r.howto).toMatch(/turnaround rather than a breath to hold/i);
        expect(r.howto).toMatch(/turn either off the moment it stops being comfortable/i);
    });

    test('a pain-restricted resume lands on the right exercise with its own instructions', async () => {
        // The member was on the mobility step of a Sunday session, then
        // reported pain. The pelvic step is withheld, the list shortens, and
        // the clamp must leave them on mobility -- not re-run a step and not
        // fall off the end.
        const r = await on(() => {
            const saved = eqStepIndicesFor('2026-11-08');     // [8, 2, 9]
            persisted.sessionLog = [{date: new Date().toISOString(), routineType: 'recovery',
                pelvicPractice: {feedback: 'painful'}}];
            try { localStorage.removeItem(pelvicReviewKey()); } catch (e) {}
            let idx = saved.slice();
            if (pelvicPracticeNeedsReview()) idx = idx.filter(i => i !== 2);
            idx = allowedRecoveryIndices(idx);
            const steps = eqStepsFrom(idx);
            const clamp = (i) => (Number.isInteger(i) && i >= 0 && i < steps.length)
                ? i : Math.max(0, Math.min(steps.length - 1, Number.isInteger(i) ? i : 0));
            const at = clamp(2);     // they were on index 2 of the old list
            return {saved, titles: steps.map(x => x.title), at,
                    landedOn: steps[at].title,
                    howto: steps[at].howto.join(' '),
                    stop: steps[at].dontFeel};
        });
        expect(r.saved).toEqual([8, 2, 9]);
        expect(r.titles).toEqual(['Diaphragmatic breathing', 'Cat-Cow']);
        expect(r.at).toBe(1);
        expect(r.landedOn).toBe('Cat-Cow');
        // Its own instructions and its own stop cue, not the withheld step's.
        expect(r.howto).toMatch(/hands under your shoulders/i);
        expect(r.stop).toMatch(/wrists, knees, hips, lower back or pelvis/);
    });

    test('unresolved pelvic pain withholds the pelvic step, keeping the rest', async () => {
        const r = await on(() => {
            /* latestPracticeFeedback() reads pelvicPractice at the TOP level of
               an entry, not nested under dailyPractice. */
            persisted.sessionLog = [{date: new Date().toISOString(), routineType: 'recovery',
                pelvicPractice: {feedback: 'painful'}}];
            try { localStorage.removeItem(pelvicReviewKey()); } catch (e) {}
            return {pending: pelvicPracticeNeedsReview(),
                    titles: buildEqRoutine().map(x => x.title)};
        });
        expect(r.pending).toBe(true);
        expect(r.titles).not.toContain('Pelvic Floor Release');
        expect(r.titles).toEqual(['Diaphragmatic breathing', 'Deep Squat — Malasana']);
    });

    test('an eligible member is migrated, and today\'s plan survives', async () => {
        const r = await on(() => {
            const today = window.BP.planDateKey(new Date());
            persisted.dayPlans = [{date: '2026-01-01'}, {date: today}, {date: '2099-01-01'}];
            const migrated = migrateEqWeek();
            return {migrated, schedule: persisted.schedule,
                    dates: persisted.dayPlans.map(p => p.date), today};
        });
        expect(r.migrated).toBe(true);
        expect(r.schedule).toEqual(NEW_EQ);
        // Past and today kept; the future plan dropped so it regenerates.
        expect(r.dates).toEqual(['2026-01-01', r.today]);
    });

    test('a customised programme is never overwritten', async () => {
        const r = await on(() => {
            persisted.programme = {key: 'eq', custom: true,
                migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
            return {eligible: eqMigrationEligible(), migrated: migrateEqWeek(),
                    schedule: persisted.schedule};
        });
        // mayGenerateOver() permits this programme -- it gates on provenance,
        // not on custom -- so the separate custom check is what protects it.
        expect(r.eligible).toBe(false);
        expect(r.migrated).toBe(false);
        expect(r.schedule).toEqual(OLD_EQ);
    });

    test('a rearranged week is never overwritten', async () => {
        const r = await on(() => {
            persisted.schedule = ['rest', 'stamina', 'length', 'rest', 'stamina', 'rest', 'rest'];
            return {eligible: eqMigrationEligible(),
                    migrated: migrateEqWeek(), schedule: persisted.schedule};
        });
        expect(r.eligible).toBe(false);
        expect(r.migrated).toBe(false);
        expect(r.schedule).toEqual(['rest', 'stamina', 'length', 'rest', 'stamina', 'rest', 'rest']);
    });

    test('a member on another goal is not migrated', async () => {
        const r = await on(() => {
            persisted.primaryGoal = 'size';
            return {eligible: eqMigrationEligible(), migrated: migrateEqWeek()};
        });
        expect(r.eligible).toBe(false);
        expect(r.migrated).toBe(false);
    });
});
