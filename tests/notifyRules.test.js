import { describe, test, expect } from 'vitest';
import {
    STREAK_WARN_MIN, MESSAGES,
    localHourFor, localDateFor, localWeekdayFor,
    utcDayKey, trainedOn, currentStreak, reminderHour, decideNotification,
} from '../supabase/functions/_shared/notifyRules.js';

/**
 * The settings screen promises a daily reminder at a chosen time and a warning
 * before a streak breaks. These tests are the definition of that promise.
 *
 * Most of them assert that nothing is sent. That is the hard part: a reminder
 * that fires when it should not is the failure members actually notice, and it
 * is how an app ends up muted.
 */

/** A session on the given UTC day. */
const at = (dayKey) => ({ date: `${dayKey}T12:00:00.000Z`, routineType: 'length', eq: 7, rpe: 5, xpEarned: 15 });
/** N consecutive days ending on `end`, most recent last. */
const runEnding = (end, n) => Array.from({ length: n }, (_, i) => {
    const d = new Date(end + 'T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return at(d.toISOString().split('T')[0]);
});

// ---------------------------------------------------------------------------
// Reading the clock in someone else's timezone
// ---------------------------------------------------------------------------
describe('localHourFor', () => {
    test('UTC is the identity case', () => {
        expect(localHourFor(new Date('2025-06-15T19:30:00Z'), 'UTC')).toBe(19);
    });

    test('a western offset moves the hour back', () => {
        // 19:30 UTC in June is 12:30 in Los Angeles (PDT, -7).
        expect(localHourFor(new Date('2025-06-15T19:30:00Z'), 'America/Los_Angeles')).toBe(12);
    });

    test('a half-hour offset lands on the right hour', () => {
        // Kolkata is +5:30. This is the case the old toLocaleString round-trip
        // got wrong, because a 30-minute offset does not survive it.
        expect(localHourFor(new Date('2025-06-15T13:45:00Z'), 'Asia/Kolkata')).toBe(19);
    });

    test('a 45-minute offset too', () => {
        // Kathmandu is +5:45.
        expect(localHourFor(new Date('2025-06-15T13:20:00Z'), 'Asia/Kathmandu')).toBe(19);
    });

    test('the hour is correct on both sides of a DST changeover', () => {
        // US DST began 2025-03-09. 19:00 UTC is 12:00 PDT after, 11:00 PST before.
        expect(localHourFor(new Date('2025-03-08T19:00:00Z'), 'America/Los_Angeles')).toBe(11);
        expect(localHourFor(new Date('2025-03-10T19:00:00Z'), 'America/Los_Angeles')).toBe(12);
    });

    test('midnight reads as 0, never 24', () => {
        expect(localHourFor(new Date('2025-06-15T00:30:00Z'), 'UTC')).toBe(0);
    });

    test('a nonsense timezone falls back to UTC instead of throwing', () => {
        expect(() => localHourFor(new Date('2025-06-15T19:00:00Z'), 'Not/AZone')).not.toThrow();
        expect(localHourFor(new Date('2025-06-15T19:00:00Z'), 'Not/AZone')).toBe(19);
    });
});

describe('localDateFor', () => {
    test('the local date can be the day before the UTC date', () => {
        // 02:00 UTC on the 16th is still the 15th in Los Angeles.
        expect(localDateFor(new Date('2025-06-16T02:00:00Z'), 'America/Los_Angeles')).toBe('2025-06-15');
        expect(localDateFor(new Date('2025-06-16T02:00:00Z'), 'UTC')).toBe('2025-06-16');
    });

    test('and the day after, going the other way', () => {
        expect(localDateFor(new Date('2025-06-15T22:00:00Z'), 'Asia/Tokyo')).toBe('2025-06-16');
    });
});

describe('localWeekdayFor', () => {
    test('Sunday is 0, matching schedule[]', () => {
        expect(localWeekdayFor(new Date('2025-06-15T12:00:00Z'), 'UTC')).toBe(0); // a Sunday
        expect(localWeekdayFor(new Date('2025-06-16T12:00:00Z'), 'UTC')).toBe(1);
        expect(localWeekdayFor(new Date('2025-06-21T12:00:00Z'), 'UTC')).toBe(6);
    });

    test('the weekday follows the member, not the server', () => {
        // Monday 00:30 UTC is still Sunday evening in Los Angeles.
        expect(localWeekdayFor(new Date('2025-06-16T00:30:00Z'), 'UTC')).toBe(1);
        expect(localWeekdayFor(new Date('2025-06-16T00:30:00Z'), 'America/Los_Angeles')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Session bookkeeping
// ---------------------------------------------------------------------------
describe('trainedOn', () => {
    test('finds a session on the day', () => {
        expect(trainedOn([at('2025-06-15')], '2025-06-15')).toBe(true);
    });
    test('and reports nothing on an untouched day', () => {
        expect(trainedOn([at('2025-06-14')], '2025-06-15')).toBe(false);
    });
    test('survives a malformed entry rather than throwing', () => {
        expect(() => trainedOn([null, {}, { date: 5 }, at('2025-06-15')], '2025-06-15')).not.toThrow();
        expect(trainedOn([null, {}, { date: 5 }, at('2025-06-15')], '2025-06-15')).toBe(true);
    });
    test('an empty log is not a training day', () => {
        expect(trainedOn([], '2025-06-15')).toBe(false);
        expect(trainedOn(null, '2025-06-15')).toBe(false);
    });
});

describe('currentStreak', () => {
    const now = new Date('2025-06-15T12:00:00Z');

    test('no sessions is no streak', () => {
        expect(currentStreak([], [], now)).toBe(0);
    });

    test('counts back from today when today is trained', () => {
        expect(currentStreak(runEnding('2025-06-15', 4), [], now)).toBe(4);
    });

    test('today not yet trained does not break the streak', () => {
        // The member still has the rest of the day. This is the case the
        // warning exists for.
        expect(currentStreak(runEnding('2025-06-14', 3), [], now)).toBe(3);
    });

    test('a gap ends the streak', () => {
        const log = [...runEnding('2025-06-10', 5), at('2025-06-14')];
        expect(currentStreak(log, [], now)).toBe(1);
    });

    test('a Recovery Pass holds the streak across a missed day', () => {
        const log = [at('2025-06-11'), at('2025-06-12'), at('2025-06-14')];
        expect(currentStreak(log, [], now)).toBe(1);           // 13th missing
        expect(currentStreak(log, ['2025-06-13'], now)).toBe(4); // pass covers it
    });

    test('two days missing needs two passes', () => {
        const log = [at('2025-06-11'), at('2025-06-14')];
        expect(currentStreak(log, ['2025-06-13'], now)).toBe(2);
        expect(currentStreak(log, ['2025-06-12', '2025-06-13'], now)).toBe(4);
    });
});

describe('reminderHour', () => {
    test('reads the hour the member picked', () => {
        expect(reminderHour('07:00')).toBe(7);
        expect(reminderHour('19:30')).toBe(19);
        expect(reminderHour('00:00')).toBe(0);
    });
    test('falls back to the app default rather than sending at midnight', () => {
        expect(reminderHour('')).toBe(19);
        expect(reminderHour(null)).toBe(19);
        expect(reminderHour('nonsense')).toBe(19);
        expect(reminderHour('99:00')).toBe(19);
    });
});

// ---------------------------------------------------------------------------
// The decision itself
// ---------------------------------------------------------------------------
describe('decideNotification', () => {
    // 19:00 in Los Angeles on a Monday.
    const base = {
        now: new Date('2025-06-17T02:00:00Z'),
        timezone: 'America/Los_Angeles',
        reminderTime: '19:00',
        schedule: ['length', 'girth', 'length', 'girth', 'length', 'girth', 'rest'],
        sessionLog: [],
        passProtectedDates: [],
        streakWarn: true,
        lastNotifiedDate: null,
    };
    const decide = (over = {}) => decideNotification({ ...base, ...over });

    test('sends the reminder at the chosen hour', () => {
        const r = decide();
        expect(r).not.toBeNull();
        expect(r.kind).toBe('daily_reminder');
        expect(r.title).toBe('The Blueprint');
    });

    test('says nothing at any other hour', () => {
        for (const h of ['08:00', '12:00', '20:00', '23:00']) {
            expect(decide({ reminderTime: h })).toBeNull();
        }
    });

    test('says nothing twice in one local day', () => {
        expect(decide({ lastNotifiedDate: '2025-06-16' })).toBeNull();   // local date, not UTC
    });

    test('a stamp from a previous day does not suppress today', () => {
        expect(decide({ lastNotifiedDate: '2025-06-15' })).not.toBeNull();
    });

    test('a full timestamp in the stamp column still matches', () => {
        expect(decide({ lastNotifiedDate: '2025-06-16T09:12:00.000Z' })).toBeNull();
    });

    test('says nothing to someone who already trained', () => {
        const today = utcDayKey(base.now);
        expect(decide({ sessionLog: [at(today)] })).toBeNull();
    });

    test('says nothing when a Recovery Pass is covering today', () => {
        const today = utcDayKey(base.now);
        expect(decide({ passProtectedDates: [today], sessionLog: runEnding('2025-06-16', 5) })).toBeNull();
    });

    test('says nothing on a scheduled rest day', () => {
        // Saturday is index 6, the rest day in the fixture. 02:00Z Sunday is
        // Saturday evening in Los Angeles, which is the point: the rest day is
        // read in the member's timezone, not the server's.
        const saturdayEveningLA = new Date('2025-06-15T02:00:00Z'); // Sat 19:00 PDT
        expect(localWeekdayFor(saturdayEveningLA, 'America/Los_Angeles')).toBe(6);
        expect(localWeekdayFor(saturdayEveningLA, 'UTC')).toBe(0);   // server disagrees
        expect(decide({ now: saturdayEveningLA })).toBeNull();
    });

    test('a missing or malformed schedule does not suppress the reminder', () => {
        expect(decide({ schedule: null })).not.toBeNull();
        expect(decide({ schedule: ['rest'] })).not.toBeNull();
    });

    test('warns instead when a streak worth keeping is at risk', () => {
        const r = decide({ sessionLog: runEnding('2025-06-16', STREAK_WARN_MIN) });
        expect(r.kind).toBe('streak_warning');
        expect(r.body).toMatch(/3 day streak/);
    });

    test('a shorter run is not worth interrupting someone about', () => {
        const r = decide({ sessionLog: runEnding('2025-06-16', STREAK_WARN_MIN - 1) });
        expect(r.kind).toBe('daily_reminder');
    });

    test('turning streak warnings off leaves the daily reminder alone', () => {
        const r = decide({ sessionLog: runEnding('2025-06-16', 10), streakWarn: false });
        expect(r).not.toBeNull();
        expect(r.kind).toBe('daily_reminder');
    });

    test('the streak in the message matches the streak that is at risk', () => {
        const r = decide({ sessionLog: runEnding('2025-06-16', 9) });
        expect(r.body).toContain('9 day streak');
    });

    test('never fires in the middle of the night, even if asked to', () => {
        // 03:00 local: inside the picked hour, outside the allowed window.
        expect(decide({ reminderTime: '03:00', now: new Date('2025-06-17T10:00:00Z') })).toBeNull();
    });

    test('called with nothing at all, it does not throw', () => {
        expect(() => decideNotification()).not.toThrow();
        expect(() => decideNotification({})).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Discretion
// ---------------------------------------------------------------------------
describe('what a lock screen reveals', () => {
    // The app is about a subject members do not want to explain to whoever
    // picks up their phone. Everything below has to stay sayable in public.
    const FORBIDDEN = /erection|erectile|\beq\b|pelvic|kegel|penis|girth|length|semen|ejacul|arousal|orgasm|sexual/i;

    const everyMessage = [
        MESSAGES.daily_reminder(),
        ...[1, 3, 10, 100].map(n => MESSAGES.streak_warning(n)),
    ];

    test('no message names the subject matter', () => {
        for (const m of everyMessage) {
            expect(m.body).not.toMatch(FORBIDDEN);
            expect(m.title).not.toMatch(FORBIDDEN);
        }
    });

    test('the title is just the app name', () => {
        for (const m of everyMessage) expect(m.title).toBe('The Blueprint');
    });

    test('and nothing the decision returns leaks either', () => {
        const r = decideNotification({
            now: new Date('2025-06-17T02:00:00Z'),
            timezone: 'America/Los_Angeles',
            sessionLog: runEnding('2025-06-16', 5),
        });
        expect(JSON.stringify(r)).not.toMatch(FORBIDDEN);
    });

    test('no em dashes, per the house style', () => {
        for (const m of everyMessage) expect(m.body).not.toContain('—');
    });
});
