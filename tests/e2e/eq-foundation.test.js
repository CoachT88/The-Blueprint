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
            persisted.programme = {key: 'eq', custom: false,
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
        expect(await on(() => eqSatisfiableDays())).toEqual([0, 3, 5]);
    });

    test('a session day serves the three EQ steps, and logs as eq', async () => {
        const r = await on(() => {
            const mapped = eqRoutineFor('stamina');
            session.routineType = mapped;
            session.eqRoutine = buildEqRoutine();
            return {mapped, titles: currentRoutine().map(x => x.title),
                    label: dayTypeLabel('eq'), recoveryRules: isRecoveryRoutine()};
        });
        expect(r.mapped).toBe('eq');
        expect(r.titles).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Deep Squat — Malasana']);
        expect(r.label).toBe('EQ session');
        // Recovery rules for XP and difficulty, because that is what it is.
        expect(r.recoveryRules).toBe(true);
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
