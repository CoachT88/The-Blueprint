import { describe, test, expect } from 'vitest';
import {
    returnContext, daysSinceLastMechanical, missedWeekReentry, livenessContext,
    RETURN_CONTEXT, LIVENESS,
} from '../src/liveness.js';
import { WEEK_VERDICT } from '../src/progressionLedger.js';
import { PROGRESSION_POLICY, withPolicy } from '../src/progressionPolicy.js';

/**
 * Liveness is what the app SAYS about recent behaviour. Every assertion here
 * is about a sentence, never about a prescription, because this layer is
 * forbidden from touching one.
 */

const DAY = 86400000;
const NOW = new Date(2025, 5, 15, 12, 0, 0);          // Sunday 15 June 2025
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const S = (d, routineType = 'length') => ({ date: ago(d), routineType });

describe('return context', () => {
    test('a member who trained recently is not returning', () => {
        for (const d of [0, 1, 3, 6]) {
            expect(returnContext([S(d)], { now: NOW })).toBeNull();
        }
    });

    test('seven days away is returning, and so is twenty seven', () => {
        expect(returnContext([S(7)], { now: NOW })).toBe(RETURN_CONTEXT.RETURNING);
        expect(returnContext([S(27)], { now: NOW })).toBe(RETURN_CONTEXT.RETURNING);
    });

    test('twenty eight days away is an extended return', () => {
        expect(returnContext([S(28)], { now: NOW })).toBe(RETURN_CONTEXT.EXTENDED);
        expect(returnContext([S(200)], { now: NOW })).toBe(RETURN_CONTEXT.EXTENDED);
    });

    test('the boundaries are exact', () => {
        expect(returnContext([S(6)], { now: NOW })).toBeNull();
        expect(returnContext([S(7)], { now: NOW })).toBe(RETURN_CONTEXT.RETURNING);
        expect(returnContext([S(27)], { now: NOW })).toBe(RETURN_CONTEXT.RETURNING);
        expect(returnContext([S(28)], { now: NOW })).toBe(RETURN_CONTEXT.EXTENDED);
    });

    test('REGRESSION: a member who has never trained is not returning', () => {
        // Someone who has not started has not come back, and saying "you're
        // back" to them would be the app inventing a past for them.
        expect(returnContext([], { now: NOW })).toBeNull();
        expect(returnContext(null, { now: NOW })).toBeNull();
    });

    test('REGRESSION: Recovery does not reset the clock on an absence', () => {
        // Measured from qualifying MECHANICAL work. A recovery session is
        // worth doing and is not a return to training.
        const log = [S(40), S(2, 'recovery')];
        expect(returnContext(log, { now: NOW })).toBe(RETURN_CONTEXT.EXTENDED);
    });

    test('the most recent mechanical day is the one that counts', () => {
        expect(returnContext([S(40), S(30), S(2)], { now: NOW })).toBeNull();
    });

    test('both thresholds are policy-controlled', () => {
        const p = withPolicy({ returningAfterDays: 3, extendedReturnAfterDays: 10 });
        expect(returnContext([S(4)], { now: NOW })).toBeNull();
        expect(returnContext([S(4)], { now: NOW, policy: p })).toBe(RETURN_CONTEXT.RETURNING);
        expect(returnContext([S(12)], { now: NOW, policy: p })).toBe(RETURN_CONTEXT.EXTENDED);
    });

    test('the thresholds are the ones the product locked', () => {
        expect(PROGRESSION_POLICY.returningAfterDays).toBe(7);
        expect(PROGRESSION_POLICY.extendedReturnAfterDays).toBe(28);
    });

    test('junk input does not throw', () => {
        expect(() => returnContext([{ date: 'nonsense' }, null], { now: NOW })).not.toThrow();
        expect(returnContext(undefined)).toBeNull();
    });
});

describe('days since the last mechanical day', () => {
    test('counts whole days back', () => {
        expect(daysSinceLastMechanical([S(9)], NOW)).toBe(9);
        expect(daysSinceLastMechanical([S(0)], NOW)).toBe(0);
    });
    test('no history is null, not zero', () => {
        expect(daysSinceLastMechanical([], NOW)).toBeNull();
    });
});

describe('missed week re-entry', () => {
    const wk = (weekKey, verdict, extra = {}) => ({
        weekKey, targetSessions: 4, qualifyingSessions: 0, verdict, ...extra,
    });
    const CURRENT = '2025_w25';

    test('a finished week that fell short may be mentioned', () => {
        const out = missedWeekReentry([wk('2025_w24', WEEK_VERDICT.MISSED), wk(CURRENT, WEEK_VERDICT.MISSED)], CURRENT);
        expect(out).not.toBeNull();
        expect(out.weekKey).toBe('2025_w24');
    });

    test('REGRESSION: the week in progress is never called missed', () => {
        // It reads as missed from Monday until it qualifies. Correct for the
        // gate, and an accusation as copy.
        expect(missedWeekReentry([wk(CURRENT, WEEK_VERDICT.MISSED)], CURRENT)).toBeNull();
    });

    test('REGRESSION: a week we could not judge is never called missed', () => {
        expect(missedWeekReentry([wk('2025_w24', WEEK_VERDICT.UNKNOWN), wk(CURRENT, WEEK_VERDICT.MISSED)], CURRENT)).toBeNull();
    });

    test('REGRESSION: a week that asked for nothing is never called missed', () => {
        expect(missedWeekReentry([wk('2025_w24', WEEK_VERDICT.NEUTRAL), wk(CURRENT, WEEK_VERDICT.MISSED)], CURRENT)).toBeNull();
    });

    test('a qualified previous week is not mentioned', () => {
        expect(missedWeekReentry([wk('2025_w24', WEEK_VERDICT.QUALIFIED), wk(CURRENT, WEEK_VERDICT.MISSED)], CURRENT)).toBeNull();
    });

    test('only the PREVIOUS finished week, never an older one', () => {
        // Last week was fine; the week before was not. Reaching back past a
        // good week to find a bad one would be looking for something to say.
        const ledger = [
            wk('2025_w23', WEEK_VERDICT.MISSED),
            wk('2025_w24', WEEK_VERDICT.QUALIFIED),
            wk(CURRENT, WEEK_VERDICT.MISSED),
        ];
        expect(missedWeekReentry(ledger, CURRENT)).toBeNull();
    });

    test('an empty or junk ledger says nothing', () => {
        expect(missedWeekReentry([], CURRENT)).toBeNull();
        expect(missedWeekReentry(null, CURRENT)).toBeNull();
        expect(missedWeekReentry(['junk', null, {}], CURRENT)).toBeNull();
    });
});

describe('precedence: exactly one message', () => {
    const missed = { weekKey: '2025_w24', verdict: WEEK_VERDICT.MISSED };

    test('week complete outranks everything', () => {
        expect(livenessContext({
            weekComplete: true, returnContext: RETURN_CONTEXT.EXTENDED, missedWeek: missed,
        })).toBe(LIVENESS.WEEK_COMPLETE);
    });

    test('an extended return outranks a plain one and a missed week', () => {
        expect(livenessContext({ returnContext: RETURN_CONTEXT.EXTENDED, missedWeek: missed }))
            .toBe(LIVENESS.EXTENDED_RETURN);
    });

    test('returning outranks a missed week', () => {
        expect(livenessContext({ returnContext: RETURN_CONTEXT.RETURNING, missedWeek: missed }))
            .toBe(LIVENESS.RETURNING);
    });

    test('a missed week is the last thing said', () => {
        expect(livenessContext({ missedWeek: missed })).toBe(LIVENESS.MISSED_WEEK);
    });

    test('an ordinary day says nothing at all', () => {
        expect(livenessContext({})).toBeNull();
        expect(livenessContext()).toBeNull();
        expect(livenessContext({ weekComplete: false, returnContext: null, missedWeek: null })).toBeNull();
    });

    test('REGRESSION: never two messages', () => {
        // Every combination returns one key or none, never a list.
        for (const weekComplete of [true, false]) {
            for (const ret of [null, RETURN_CONTEXT.RETURNING, RETURN_CONTEXT.EXTENDED]) {
                for (const mw of [null, missed]) {
                    const out = livenessContext({ weekComplete, returnContext: ret, missedWeek: mw });
                    expect(out === null || typeof out === 'string').toBe(true);
                }
            }
        }
    });
});
