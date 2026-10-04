import { describe, test, expect } from 'vitest';
import { weekCompletion } from '../src/weekCompletion.js';

/**
 * The denominator is the whole point. A week counted out of seven makes a
 * correctly followed rest day look like a miss, which is the opposite of what
 * the programme says.
 */

// Sunday-indexed, matching Date#getDay(). This is the 'all' goal's schedule.
const ALL = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const NONE = [false, false, false, false, false, false, false];
const done = (...days) => NONE.map((_, i) => days.includes(i));

describe('weekCompletion', () => {
    test('counts scheduled non-rest sessions as the target', () => {
        const r = weekCompletion(ALL, NONE);
        expect(r.target).toBe(4);
        expect(r.completed).toBe(0);
    });

    test('a finished session counts', () => {
        expect(weekCompletion(ALL, done(0, 1)).completed).toBe(2);
    });

    test('renders as "2 of 4 this week"', () => {
        expect(weekCompletion(ALL, done(0, 1)).label).toBe('2 of 4 this week');
    });

    test('rest days are not failures and are not in the target', () => {
        // Nothing done, but the two rest days are not counted against them.
        expect(weekCompletion(ALL, NONE).target).toBe(4);
        expect(weekCompletion(ALL, NONE).remaining).toBe(4);
    });

    test('a flag set on a rest day does not inflate the numerator', () => {
        // Index 2 and 5 are rest. Active Recovery there must not count.
        const r = weekCompletion(ALL, done(2, 5));
        expect(r.completed).toBe(0);
        expect(r.target).toBe(4);
    });

    test('allDone only once every scheduled session is logged', () => {
        expect(weekCompletion(ALL, done(0, 1, 3)).allDone).toBe(false);
        expect(weekCompletion(ALL, done(0, 1, 3, 4)).allDone).toBe(true);
    });

    test('an all-rest week has no target and is not "all done"', () => {
        const r = weekCompletion(['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'], NONE);
        expect(r.target).toBe(0);
        expect(r.allDone).toBe(false);
        expect(r.label).toBe('No sessions scheduled this week');
    });

    test('missing or malformed inputs do not throw', () => {
        expect(weekCompletion(null, null).target).toBe(0);
        expect(weekCompletion(undefined, undefined).completed).toBe(0);
        expect(weekCompletion('length', 'true').target).toBe(0);
    });

    test('a slot the schedule does not describe is in neither number', () => {
        const sparse = ['length', undefined, null, '', 'girth'];
        const r = weekCompletion(sparse, done(0, 1, 2, 3, 4));
        expect(r.target).toBe(2);
        expect(r.completed).toBe(2);
    });

    test('only an exact true counts, not a truthy value', () => {
        // completed_days arrives from PostgREST and has been seen as strings.
        expect(weekCompletion(ALL, ['yes', 1, false, false, false, false, false]).completed).toBe(0);
    });

    test('a short completedDays array does not throw', () => {
        expect(weekCompletion(ALL, [true]).completed).toBe(1);
    });

    test('unknown day types count as sessions, not as rest', () => {
        // A stale cached shell can hold a type this build does not know. The
        // safe reading is "something was scheduled", not "the week was empty".
        const r = weekCompletion(['mystery', 'rest'], [true, false]);
        expect(r.target).toBe(1);
        expect(r.completed).toBe(1);
    });
});

/**
 * Phase 2B.2. completedDays cannot answer "was the scheduled MECHANICAL work
 * done", because finishSession() sets it for any session including Recovery.
 * With Week Complete built on this number, the log settles it.
 */
describe('the session log settles what a scheduled day actually was', () => {
    const MON = new Date(2025, 5, 9, 12, 0, 0);          // Monday 9 June 2025
    const SCHEDULE = ['rest', 'length', 'girth', 'rest', 'stamina', 'length', 'rest'];
    const ALL = [true, true, true, true, true, true, true];
    const NONE = [false, false, false, false, false, false, false];
    // Monday is getDay 1; the ISO week runs Mon 9 to Sun 15 June.
    const on = (day, routineType) => ({ date: `2025-06-${String(day).padStart(2, '0')}T12:00:00.000Z`, routineType });
    const run = (sessionLog, done = ALL) =>
        weekCompletion(SCHEDULE, done, { sessionLog, now: MON });

    test('the schedule still sets the denominator', () => {
        expect(run([]).target).toBe(4);
    });

    test('a mechanical session on a scheduled day counts', () => {
        expect(run([on(9, 'length')], NONE).completed).toBe(1);
    });

    test('a substituted mission still counts', () => {
        // Girth done on the day Length was scheduled. Mechanical is
        // mechanical; the locked substitution rule is untouched.
        expect(run([on(9, 'girth')], NONE).completed).toBe(1);
    });

    test('REGRESSION: Recovery on a scheduled day does not count', () => {
        // completedDays is true for it, and that is exactly the lie this
        // cross-check exists to stop.
        expect(run([on(9, 'recovery')], NONE).completed).toBe(0);
    });

    test('REGRESSION: a Recovery-only week cannot complete', () => {
        const log = [on(9, 'recovery'), on(10, 'recovery'), on(12, 'recovery'), on(13, 'recovery')];
        const w = run(log);
        expect(w.completed).toBe(0);
        expect(w.allDone).toBe(false);
    });

    test('Recovery alongside mechanical work on the same day still counts', () => {
        expect(run([on(9, 'recovery'), on(9, 'length')], NONE).completed).toBe(1);
    });

    test('a manual tick with nothing logged that day still counts', () => {
        // The member telling us about work the app did not time. Preserved.
        expect(run([]).completed).toBe(4);
    });

    test('a manual tick does not override a day that only had Recovery', () => {
        expect(run([on(9, 'recovery')]).completed).toBe(3);
    });

    test('a full mechanical week is allDone', () => {
        const log = [on(9, 'length'), on(10, 'girth'), on(12, 'stamina'), on(13, 'length')];
        const w = run(log, NONE);
        expect(w.completed).toBe(4);
        expect(w.allDone).toBe(true);
        expect(w.remaining).toBe(0);
    });

    test('a scheduled rest day is never part of the target', () => {
        // Mechanical work on Sunday, which is a rest day. It is worth doing
        // and it is not one of the four.
        const log = [on(15, 'length')];
        const w = run(log, NONE);
        expect(w.target).toBe(4);
        expect(w.completed).toBe(0);
    });

    test('target 0 is never allDone', () => {
        const rest = ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'];
        const w = weekCompletion(rest, ALL, { sessionLog: [on(9, 'length')], now: MON });
        expect(w.target).toBe(0);
        expect(w.allDone).toBe(false);
    });

    test('without a log it falls back to completedDays alone', () => {
        // So a caller that has not been updated keeps its old answer rather
        // than silently reading zero.
        expect(weekCompletion(SCHEDULE, ALL).completed).toBe(4);
        expect(weekCompletion(SCHEDULE, ALL, { now: MON }).completed).toBe(4);
    });

    test('junk in the log does not throw', () => {
        expect(() => run([null, 'junk', { date: 5 }, {}])).not.toThrow();
    });
});
