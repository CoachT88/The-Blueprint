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
