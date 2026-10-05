import { describe, test, expect } from 'vitest';
import {
    returnContext, daysSinceLastMechanical, missedWeekReentry, livenessContext,
    greetingBand, localDayKey, RETURN_CONTEXT, LIVENESS, GREETING_BAND, GREETING_BANDS,
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

/**
 * The regression CI caught and the local run did not.
 *
 * returnContext compared noon on the last training day against the real
 * `now`, time of day included, so the band moved with the hour the member
 * opened the app. This suite's own NOW was noon, which aligned both sides
 * and hid it; the browser suite failed only because the runner happened to
 * execute before midday.
 *
 * Every assertion below is the same gap read at a different o'clock.
 */
describe('REGRESSION: the hour of the day cannot move the band', () => {
    const HOURS = [[0, 30], [6, 0], [9, 0], [11, 59], [12, 0], [15, 30], [18, 0], [23, 59]];
    const at = (h, m) => new Date(2025, 5, 15, h, m, 0);
    /** A session exactly `d` calendar days before 15 June, logged at 20:45. */
    const trainedDaysAgo = (d) => {
        const day = new Date(2025, 5, 15 - d, 20, 45, 0);
        return [{ date: day.toISOString(), routineType: 'length' }];
    };

    test.each(HOURS)('six days away says nothing, read at %i:%i', (h, m) => {
        expect(returnContext(trainedDaysAgo(6), { now: at(h, m) })).toBeNull();
    });

    test.each(HOURS)('seven days away is returning, read at %i:%i', (h, m) => {
        expect(returnContext(trainedDaysAgo(7), { now: at(h, m) })).toBe(RETURN_CONTEXT.RETURNING);
    });

    test.each(HOURS)('twenty seven days away is still returning, read at %i:%i', (h, m) => {
        expect(returnContext(trainedDaysAgo(27), { now: at(h, m) })).toBe(RETURN_CONTEXT.RETURNING);
    });

    test.each(HOURS)('twenty eight days away is an extended return, read at %i:%i', (h, m) => {
        expect(returnContext(trainedDaysAgo(28), { now: at(h, m) })).toBe(RETURN_CONTEXT.EXTENDED);
    });

    test.each(HOURS)('the day count itself is stable, read at %i:%i', (h, m) => {
        expect(daysSinceLastMechanical(trainedDaysAgo(7), at(h, m))).toBe(7);
        expect(daysSinceLastMechanical(trainedDaysAgo(28), at(h, m))).toBe(28);
    });

    test('and the session time of day does not move it either', () => {
        // Trained at 06:00 or at 23:30, seven calendar days ago, read at 09:00.
        for (const hour of [0, 6, 12, 18, 23]) {
            const day = new Date(2025, 5, 8, hour, 15, 0);
            const log = [{ date: day.toISOString(), routineType: 'length' }];
            expect(returnContext(log, { now: at(9, 0) })).toBe(RETURN_CONTEXT.RETURNING);
        }
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

/**
 * The greeting band, swept across every hour rather than pinned to one.
 *
 * Phase 2B.2 shipped a boundary defect that survived locally because its
 * fixture was fixed at noon and only CI happened to run in the morning.
 * Anything taking a clock is now tested against the whole clock.
 */
describe('greeting band', () => {
    const at = (h, m = 0) => new Date(2025, 5, 15, h, m, 0);

    test('the thresholds are the ones the product locked', () => {
        expect(GREETING_BANDS).toEqual({ morningFrom: 5, afternoonFrom: 12, eveningFrom: 17 });
    });

    test.each([5, 6, 7, 8, 9, 10, 11])('%i:00 is morning', (h) => {
        expect(greetingBand(at(h))).toBe(GREETING_BAND.MORNING);
    });

    test.each([12, 13, 14, 15, 16])('%i:00 is afternoon', (h) => {
        expect(greetingBand(at(h))).toBe(GREETING_BAND.AFTERNOON);
    });

    test.each([17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4])('%i:00 is evening', (h) => {
        expect(greetingBand(at(h))).toBe(GREETING_BAND.EVENING);
    });

    test('every hour of the day lands in exactly one band', () => {
        const seen = Array.from({ length: 24 }, (_, h) => greetingBand(at(h)));
        expect(seen.filter(b => b === undefined || b === null)).toHaveLength(0);
        expect(new Set(seen)).toEqual(new Set(['morning', 'afternoon', 'evening']));
    });

    test('the exact boundary minutes', () => {
        expect(greetingBand(at(4, 59))).toBe(GREETING_BAND.EVENING);
        expect(greetingBand(at(5, 0))).toBe(GREETING_BAND.MORNING);
        expect(greetingBand(at(11, 59))).toBe(GREETING_BAND.MORNING);
        expect(greetingBand(at(12, 0))).toBe(GREETING_BAND.AFTERNOON);
        expect(greetingBand(at(16, 59))).toBe(GREETING_BAND.AFTERNOON);
        expect(greetingBand(at(17, 0))).toBe(GREETING_BAND.EVENING);
        expect(greetingBand(at(23, 59))).toBe(GREETING_BAND.EVENING);
        expect(greetingBand(at(0, 0))).toBe(GREETING_BAND.EVENING);
    });

    test('midnight to five is evening, not morning', () => {
        for (const h of [0, 1, 2, 3, 4]) {
            expect(greetingBand(at(h))).not.toBe(GREETING_BAND.MORNING);
        }
    });

    test('the bands are overridable, so the thresholds stay in one place', () => {
        const b = { morningFrom: 4, afternoonFrom: 11, eveningFrom: 20 };
        expect(greetingBand(at(4), b)).toBe(GREETING_BAND.MORNING);
        expect(greetingBand(at(19), b)).toBe(GREETING_BAND.AFTERNOON);
        expect(greetingBand(at(20), b)).toBe(GREETING_BAND.EVENING);
    });

    test('junk falls back to now rather than throwing', () => {
        expect(() => greetingBand(new Date('nonsense'))).not.toThrow();
        expect(['morning', 'afternoon', 'evening']).toContain(greetingBand(undefined));
    });
});

describe('the local day key', () => {
    test('it is the local date, not the UTC one', () => {
        // 23:30 local on 15 June. In any timezone ahead of UTC this is
        // already 16 June in UTC, and the key must still say the 15th.
        const late = new Date(2025, 5, 15, 23, 30, 0);
        expect(localDayKey(late)).toBe('2025-06-15');
        const early = new Date(2025, 5, 15, 0, 30, 0);
        expect(localDayKey(early)).toBe('2025-06-15');
    });

    test('it is stable across every hour of one local day', () => {
        const keys = Array.from({ length: 24 }, (_, h) => localDayKey(new Date(2025, 5, 15, h, 0, 0)));
        expect(new Set(keys).size).toBe(1);
    });

    test('it changes at local midnight, not 24 hours after anything', () => {
        expect(localDayKey(new Date(2025, 5, 15, 23, 59, 59))).toBe('2025-06-15');
        expect(localDayKey(new Date(2025, 5, 16, 0, 0, 0))).toBe('2025-06-16');
    });

    test('months and days are zero padded', () => {
        expect(localDayKey(new Date(2025, 0, 5, 12, 0, 0))).toBe('2025-01-05');
    });

    test('junk falls back to now rather than throwing', () => {
        expect(localDayKey(new Date('nonsense'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('the greeting is last in precedence', () => {
    const missed = { weekKey: '2025_w24', verdict: 'missed' };

    test('it renders when nothing else has anything to say', () => {
        expect(livenessContext({ greeting: true })).toBe(LIVENESS.GREETING);
    });

    test.each([
        ['week complete', { weekComplete: true }],
        ['an extended return', { returnContext: RETURN_CONTEXT.EXTENDED }],
        ['a return', { returnContext: RETURN_CONTEXT.RETURNING }],
        ['a missed week', { missedWeek: missed }],
    ])('%s outranks it', (_label, over) => {
        const out = livenessContext({ ...over, greeting: true });
        expect(out).not.toBe(LIVENESS.GREETING);
        expect(out).not.toBeNull();
    });

    test('an ineligible greeting leaves nothing at all', () => {
        expect(livenessContext({ greeting: false })).toBeNull();
        expect(livenessContext({})).toBeNull();
    });

    test('REGRESSION: it never displaces a message about the training', () => {
        for (const weekComplete of [true, false]) {
            for (const ret of [null, RETURN_CONTEXT.RETURNING, RETURN_CONTEXT.EXTENDED]) {
                for (const mw of [null, missed]) {
                    const out = livenessContext({ weekComplete, returnContext: ret, missedWeek: mw, greeting: true });
                    const somethingElse = weekComplete || ret || mw;
                    if (somethingElse) expect(out).not.toBe(LIVENESS.GREETING);
                    else expect(out).toBe(LIVENESS.GREETING);
                }
            }
        }
    });
});
