import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { nextTrainingDay, NEXT_UP_REFUSAL, NEXT_UP_HORIZON_DAYS } from '../src/nextUp.js';

/**
 * "Next up" after a finished session.
 *
 * The defect this module exists to remove is subtle and it is worth stating
 * once: the surface it replaces walked the seven-slot recurring column and
 * wrapped. Asked on a Sunday it read index 0 again and announced whatever
 * that recurring week prescribed. For a member on dated plans that answer is
 * manufactured, and because a week repeats it almost always sounds right.
 *
 * So the tests below care much more about what it REFUSES to say than about
 * what it says. The Sunday pair is the heart of the file: the same Sunday
 * answers Monday when next week was really generated and answers nothing when
 * it was not, and nothing in between.
 */

/* Noon, so none of these fixtures sit on a daylight-saving boundary. */
const at = (y, m, d) => new Date(y, m, d, 12, 0, 0);

const train = (date, type) => ({
    date, mode: 'prescribed', primarySession: { type, title: `${type} work`, durationSec: 600 },
});
const rest = (date) => ({ date, mode: 'rest' });

describe('the clock is required, not guessed', () => {
    test('a missing clock is a refusal', () => {
        const r = nextTrainingDay({ dayPlans: [train('2026-03-13', 'girth')] });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(NEXT_UP_REFUSAL.NO_CLOCK);
    });

    test('an unreadable clock is the same refusal', () => {
        expect(nextTrainingDay({ now: new Date('nonsense') }).reason).toBe(NEXT_UP_REFUSAL.NO_CLOCK);
        expect(nextTrainingDay({ now: '2026-03-12' }).reason).toBe(NEXT_UP_REFUSAL.NO_CLOCK);
        expect(nextTrainingDay(null).reason).toBe(NEXT_UP_REFUSAL.NO_CLOCK);
    });

    test('a refusal carries no answer at all', () => {
        /* No `found`, no `date`. A caller that forgets to check ok must not
           be able to read a plausible-looking blank off the result. */
        const r = nextTrainingDay({});
        expect(r.found).toBeUndefined();
        expect(r.date).toBeUndefined();
    });
});

describe('it reads forward through real dates', () => {
    /* 2026-03-12 is a Thursday. */
    const THU = at(2026, 2, 12);

    test('tomorrow, when tomorrow trains', () => {
        const r = nextTrainingDay({ now: THU, dayPlans: [train('2026-03-13', 'girth')] });
        expect(r).toEqual({ ok: true, found: true, date: '2026-03-13',
            type: 'girth', weekdayIndex: 5, daysAway: 1 });
    });

    test('today is never the answer, even when today has a plan', () => {
        /* Asked at the end of today's session, so today is behind them. */
        const r = nextTrainingDay({ now: THU,
            dayPlans: [train('2026-03-12', 'length'), train('2026-03-15', 'girth')] });
        expect(r.date).toBe('2026-03-15');
        expect(r.daysAway).toBe(3);
    });

    test('rest days are skipped, because the question is about training', () => {
        const r = nextTrainingDay({ now: THU, dayPlans: [
            rest('2026-03-13'), rest('2026-03-14'), train('2026-03-15', 'length')] });
        expect(r.date).toBe('2026-03-15');
        expect(r.type).toBe('length');
        expect(r.daysAway).toBe(3);
    });

    test('a date with no plan is skipped rather than filled in', () => {
        const r = nextTrainingDay({ now: THU, dayPlans: [train('2026-03-16', 'stamina')] });
        expect(r.date).toBe('2026-03-16');
        expect(r.daysAway).toBe(4);
    });

    test('an unreadable plan is skipped and never repaired', () => {
        /* A dated record that cannot be interpreted is a data-integrity
           condition, not a session to announce. normaliseDayPlan refuses a
           bad mode, and this agrees with it rather than guessing. */
        const r = nextTrainingDay({ now: THU, dayPlans: [
            { date: '2026-03-13', mode: 'whatever', primarySession: { type: 'girth' } },
            train('2026-03-14', 'length')] });
        expect(r.date).toBe('2026-03-14');
        expect(r.type).toBe('length');
    });

    test('a support-only day is skipped: scheduled, but not a session', () => {
        const r = nextTrainingDay({ now: THU, dayPlans: [
            { date: '2026-03-13', mode: 'prescribed',
              supportingWork: [{ type: 'mobility', title: 'Stretch', durationSec: 300 }] },
            train('2026-03-14', 'girth')] });
        expect(r.date).toBe('2026-03-14');
    });

    test('nothing in the horizon is nothing, not a placeholder', () => {
        const r = nextTrainingDay({ now: THU, dayPlans: [rest('2026-03-13')] });
        expect(r).toEqual({ ok: true, found: false });
    });

    test('plans in the past cannot answer a question about the future', () => {
        const r = nextTrainingDay({ now: THU, dayPlans: [
            train('2026-03-09', 'length'), train('2026-03-11', 'girth')] });
        expect(r.found).toBe(false);
    });
});

describe('a Sunday does not wrap, it reads the week that exists', () => {
    /* 2026-03-15 is a Sunday, the LAST day of its ISO week. This is the case
       the recurring column got wrong: index 0 came back round and named a day
       with no plan behind it. */
    const SUN = at(2026, 2, 15);
    const RECURRING_SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

    test('it finds Monday of the NEXT ISO week, because that Monday was generated', () => {
        const r = nextTrainingDay({ now: SUN, dayPlans: [
            train('2026-03-15', 'length'),      // today, behind them
            train('2026-03-16', 'girth'),       // Monday, next ISO week
        ] });
        expect(r.found).toBe(true);
        expect(r.date).toBe('2026-03-16');
        expect(r.weekdayIndex).toBe(1);          // Monday
        expect(r.daysAway).toBe(1);
    });

    test('THE REGRESSION: with no next week generated it says nothing', () => {
        /* The recurring column would have answered here. Walking it from
           Sunday reads index 0, 'length', and announces a Monday session
           that does not exist. Same member, same week shape, and the honest
           answer is silence. */
        const r = nextTrainingDay({ now: SUN, dayPlans: [train('2026-03-15', 'length')] });
        expect(r.found).toBe(false);
        /* And the shape it would have wrapped into is genuinely the one that
           looks plausible, which is why the old answer was dangerous. */
        expect(RECURRING_SIZE[0]).toBe('length');
    });

    test('a generated next week is read day by day, not as a repeat', () => {
        /* Next week deliberately does NOT match the recurring shape. If
           anything wrapped, the answer would be Monday 'length'. */
        const r = nextTrainingDay({ now: SUN, dayPlans: [
            rest('2026-03-16'), train('2026-03-17', 'stamina')] });
        expect(r.date).toBe('2026-03-17');
        expect(r.type).toBe('stamina');
        expect(r.weekdayIndex).toBe(2);
    });
});

describe('the horizon is the caller\'s, and it is honest about distance', () => {
    const THU = at(2026, 2, 12);

    test('the default reaches the end of what generation produces', () => {
        expect(NEXT_UP_HORIZON_DAYS).toBe(14);
        const r = nextTrainingDay({ now: THU, dayPlans: [train('2026-03-26', 'girth')] });
        expect(r.daysAway).toBe(14);
        expect(r.found).toBe(true);
    });

    test('one day past the horizon is out of view', () => {
        const r = nextTrainingDay({ now: THU, dayPlans: [train('2026-03-27', 'girth')] });
        expect(r.found).toBe(false);
    });

    test('a caller may look less far, and nothing silently widens it', () => {
        const plans = [train('2026-03-17', 'length')];
        expect(nextTrainingDay({ now: THU, dayPlans: plans, horizonDays: 5 }).found).toBe(true);
        expect(nextTrainingDay({ now: THU, dayPlans: plans, horizonDays: 4 }).found).toBe(false);
    });

    test('a nonsense horizon falls back to the default rather than returning nothing', () => {
        for (const bad of [0, -3, 2.5, 'seven', null, undefined]) {
            const r = nextTrainingDay({ now: THU, dayPlans: [train('2026-03-20', 'girth')], horizonDays: bad });
            expect(r.found, `horizonDays: ${String(bad)}`).toBe(true);
        }
    });

    test('daysAway is what lets a caller refuse an ambiguous weekday name', () => {
        /* Seven days out is the SAME weekday name as today, so "THU" stops
           being an answer. The module reports the distance and leaves that
           judgement to the caller instead of shortening its own horizon to
           make somebody else's label work. */
        const r = nextTrainingDay({ now: THU, dayPlans: [train('2026-03-19', 'girth')] });
        expect(r.daysAway).toBe(7);
        expect(r.weekdayIndex).toBe(THU.getDay());
    });
});

describe('it is pure', () => {
    test('the inputs come back untouched', () => {
        const plans = [rest('2026-03-13'), train('2026-03-14', 'girth')];
        const snapshot = JSON.stringify(plans);
        const now = at(2026, 2, 12);
        const stamp = now.getTime();
        nextTrainingDay({ now, dayPlans: plans });
        expect(JSON.stringify(plans)).toBe(snapshot);
        /* The forward walk uses a cursor Date. An earlier draft of that loop
           would have advanced the caller's own clock. */
        expect(now.getTime()).toBe(stamp);
    });

    test('junk in the plans list cannot throw', () => {
        const now = at(2026, 2, 12);
        for (const junk of [null, undefined, 7, 'x', [], {}, { date: 5 }]) {
            expect(() => nextTrainingDay({ now, dayPlans: [junk, train('2026-03-14', 'girth')] }))
                .not.toThrow();
        }
        expect(nextTrainingDay({ now, dayPlans: 'not an array' }).found).toBe(false);
    });

    test('the later record wins for a duplicated date, as the storage map does', () => {
        const now = at(2026, 2, 12);
        const r = nextTrainingDay({ now, dayPlans: [
            train('2026-03-13', 'length'), train('2026-03-13', 'stamina')] });
        expect(r.type).toBe('stamina');
    });
});

/**
 * The date identity, which is the whole reason PR C exists.
 *
 * A day plan's date is the day the member lived through. At UTC+14 local noon
 * is 22:00 UTC the previous day, so anything that formats through
 * toISOString() names yesterday. A "Next up" that reads one date early would
 * announce the wrong session and, because a week recurs, would usually name a
 * plausible type rather than nothing.
 *
 * Subprocess per zone, because TZ is read once per process.
 */
describe('it reads the member\'s own calendar dates', () => {
    const probe = (tz, dateArgs, plans) => {
        const script = `
            import { nextTrainingDay } from '${process.cwd()}/src/nextUp.js';
            const now = new Date(${dateArgs});
            console.log(JSON.stringify({
                weekday: now.getDay(),
                localDay: now.getDate(),
                utcIso: now.toISOString().split('T')[0],
                r: nextTrainingDay({ now, dayPlans: ${JSON.stringify(plans)} }),
            }));
        `;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
            { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
        return JSON.parse(out.trim().split('\n').pop());
    };

    test('UTC+14: tomorrow is the local tomorrow, not the UTC one', () => {
        /* Local Thursday 2026-03-12 noon is 2026-03-11T22:00Z. A UTC walk
           would start at the 12th and call it tomorrow. */
        const r = probe('Pacific/Kiritimati', '2026, 2, 12, 12',
            [train('2026-03-12', 'length'), train('2026-03-13', 'girth')]);
        expect(r.weekday).toBe(4);
        expect(r.localDay).toBe(12);
        expect(r.utcIso).toBe('2026-03-11');     // the shift, demonstrated
        expect(r.r.date).toBe('2026-03-13');     // the local tomorrow
        expect(r.r.type).toBe('girth');
        expect(r.r.daysAway).toBe(1);
    });

    test('UTC-11: the same, in the other direction', () => {
        const r = probe('Pacific/Niue', '2026, 2, 12, 12',
            [train('2026-03-12', 'length'), train('2026-03-13', 'girth')]);
        expect(r.localDay).toBe(12);
        expect(r.utcIso).toBe('2026-03-12');
        expect(r.r.date).toBe('2026-03-13');
        expect(r.r.daysAway).toBe(1);
    });

    test('UTC+14 on a Sunday still finds the next week rather than wrapping', () => {
        const r = probe('Pacific/Kiritimati', '2026, 2, 15, 12',
            [train('2026-03-15', 'length'), train('2026-03-16', 'girth')]);
        expect(r.weekday).toBe(0);               // Sunday, locally
        expect(r.r.date).toBe('2026-03-16');
        expect(r.r.weekdayIndex).toBe(1);        // Monday, locally
    });

    test('a spring-forward boundary does not lose a day', () => {
        /* 2026-03-08 is the US DST change. Walking by calendar date at noon
           has to survive the 23 hour day: an hour-arithmetic walk would land
           at 23:00 the previous date and read the wrong plan. */
        const r = probe('America/New_York', '2026, 2, 7, 12',
            [train('2026-03-08', 'girth'), train('2026-03-09', 'length')]);
        expect(r.localDay).toBe(7);
        expect(r.r.date).toBe('2026-03-08');
        expect(r.r.daysAway).toBe(1);
    });
});
