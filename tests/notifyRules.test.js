import { describe, test, expect } from 'vitest';
import {
    MESSAGES,
    localHourFor, localMinuteOfDay, localDateFor, localWeekdayFor,
    utcDayKey, trainedOn, trainedOnLocalDay, reminderHour, reminderMinuteOfDay, decideNotification,
} from '../supabase/functions/_shared/notifyRules.js';

/**
 * The settings screen offers AM/PM check-ins, an extra time, and completion
 * praise. These tests define their timing and suppression rules.
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

describe('reminder minutes in the member timezone', () => {
    test.each(['America/Los_Angeles', 'Asia/Kolkata', 'Asia/Kathmandu'])(
        'reads 19:10 accurately in %s', timezone => {
            const utc = {
                'America/Los_Angeles': '2026-10-13T02:10:00Z',
                'Asia/Kolkata': '2026-10-12T13:40:00Z',
                'Asia/Kathmandu': '2026-10-12T13:25:00Z',
            };
            expect(localMinuteOfDay(new Date(utc[timezone]), timezone)).toBe(19 * 60 + 10);
            expect(decideNotification({ now:new Date(utc[timezone]), timezone, reminderTime:'19:10' })).not.toBeNull();
        }
    );

    test.each(['', null, '19:99', '24:00', '-1:10', 'wrong'])(
        'an invalid time %s falls back to 19:00', time => {
            expect(reminderMinuteOfDay(time)).toBe(19 * 60);
        }
    );

    test('preserves valid minute and day boundaries', () => {
        expect(reminderMinuteOfDay('00:00')).toBe(0);
        expect(reminderMinuteOfDay('7:10')).toBe(7 * 60 + 10);
        expect(reminderMinuteOfDay('23:59')).toBe(1439);
    });

    test.each(['2026-10-13T02:01:00Z', '2026-10-13T02:09:59Z', '2026-10-13T02:11:00Z'])(
        'a 19:10 reminder does not send at %s', utc => {
            expect(decideNotification({ now:new Date(utc), timezone:'America/Los_Angeles', reminderTime:'19:10' })).toBeNull();
        }
    );

    test('dispatches within the selected minute, then suppresses another send that day', () => {
        const input = { now:new Date('2026-10-13T02:10:37Z'), timezone:'America/Los_Angeles', reminderTime:'19:10' };
        expect(decideNotification(input)).not.toBeNull();
        expect(decideNotification({ ...input, deliveredEventKeys:['reminder:2026-10-12:19:10'] })).toBeNull();
    });

    test.each(['2026-03-07T03:10:00Z', '2026-03-10T02:10:00Z'])(
        'keeps 19:10 local across daylight-saving offsets at %s', utc => {
            expect(decideNotification({ now:new Date(utc), timezone:'America/Los_Angeles', reminderTime:'19:10' })).not.toBeNull();
        }
    );
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
        lastNotifiedDate: null,
    };
    const decide = (over = {}) => decideNotification({ ...base, ...over });

    test('sends the reminder at the chosen minute', () => {
        const r = decide();
        expect(r).not.toBeNull();
        expect(r.kind).toBe('daily_reminder');
        expect(r.title).toBe('The Blueprint');
    });

    test('says nothing outside the default or selected minute', () => {
        for (const h of [10,12,20,23]) {
            expect(decide({ now:new Date(`2025-06-16T${String(h).padStart(2,'0')}:01:00-07:00`) })).toBeNull();
        }
    });

    test('says nothing twice for the same local reminder slot', () => {
        expect(decide({ deliveredEventKeys:['reminder:2025-06-16:19:00'] })).toBeNull();
    });

    test('a delivery from a previous day does not suppress today', () => {
        expect(decide({ deliveredEventKeys:['reminder:2025-06-15:19:00'] })).not.toBeNull();
    });

    test('an AM delivery or the legacy daily stamp does not block PM', () => {
        expect(decide({ deliveredEventKeys:['reminder:2025-06-16:09:00'], lastNotifiedDate:'2025-06-16' })).not.toBeNull();
    });

    test('says nothing to someone who already trained', () => {
        expect(decide({ sessionLog:[{date:'2025-06-16T20:00:00Z'}] })).toBeNull();
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

    test('REGRESSION: a long run of training days still sends the plain reminder', () => {
        // This used to become a streak warning naming the number of days.
        // Phase 2B.2 retired the streak, so there is exactly one message and
        // nothing on a lock screen refers to a count the member cannot see.
        for (const n of [2, 3, 9, 30]) {
            const r = decide({ sessionLog: runEnding('2025-06-15', n) });
            expect(r.kind).toBe('daily_reminder');
            expect(r.body).not.toMatch(/streak|day run|\bdays\b/i);
        }
    });

    test('REGRESSION: a streakWarn flag left in a caller changes nothing', () => {
        // The column still exists for backward compatibility. An old caller
        // still passing it must not resurrect the behaviour.
        expect(decide({ sessionLog: runEnding('2025-06-15', 10), streakWarn: true }).kind)
            .toBe('daily_reminder');
        expect(decide({ sessionLog: runEnding('2025-06-15', 10), streakWarn: false }).kind)
            .toBe('daily_reminder');
    });

    test('only the check-in and completion messages are sent', () => {
        expect(Object.keys(MESSAGES)).toEqual(['daily_reminder','completion_praise']);
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

    const everyMessage = Object.values(MESSAGES).map(m => m());

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

describe('scheduled goal changes while the app is closed', () => {
    const schedule = ['length','girth','rest','length','girth','rest','rest'];
    const next = ['stamina','rest','stamina','rest','stamina','rest','rest'];
    const programme = {pendingChange:{effectiveDate:'2026-03-16',schedule:next}};
    test('uses this week before the start date and next week after it', () => {
        expect(decideNotification({schedule,programme,timezone:'UTC',now:new Date('2026-03-09T19:00:00Z')})).not.toBeNull();
        expect(decideNotification({schedule,programme,timezone:'UTC',now:new Date('2026-03-16T19:00:00Z')})).toBeNull();
        expect(decideNotification({schedule,programme,timezone:'UTC',now:new Date('2026-03-17T19:00:00Z')})).not.toBeNull();
    });
    test('ignores malformed pending schedules', () => {
        expect(decideNotification({schedule,timezone:'UTC',now:new Date('2026-03-16T19:00:00Z'),
            programme:{pendingChange:{effectiveDate:'2026-03-16',schedule:['rest']}}})).not.toBeNull();
    });
});


describe('AM/PM, custom check-ins and completion follow-ups', () => {
    const decide = (localTime, extras = {}) => decideNotification({
        now:new Date('2026-10-12T'+localTime+'-07:00'), timezone:'America/Los_Angeles',
        customEnabled:false, ...extras,
    });
    test('defaults to morning and evening without a custom time', () => {
        expect(decide('09:00:00')?.body).toBe('Make sure you show up for training today.');
        expect(decide('19:00:00')?.kind).toBe('daily_reminder');
        expect(decide('12:00:00')).toBeNull();
    });
    test('morning cannot block evening, and either cannot block an optional extra', () => {
        const am=decide('09:00:00');
        const pm=decide('19:00:00',{deliveredEventKeys:[am.eventKey]});
        const custom=decide('21:31:00',{customEnabled:true,reminderTime:'21:31',deliveredEventKeys:[am.eventKey,pm.eventKey]});
        expect(custom?.kind).toBe('daily_reminder');
        expect(new Set([am.eventKey,pm.eventKey,custom.eventKey]).size).toBe(3);
        expect(new Set([am.tag,pm.tag,custom.tag]).size).toBe(3);
    });
    test('an extra is off unless enabled, and matching a default never doubles it', () => {
        expect(decide('21:31:00',{reminderTime:'21:31'})).toBeNull();
        const am=decide('09:00:00',{customEnabled:true,reminderTime:'09:00'});
        expect(decide('09:00:00',{customEnabled:true,reminderTime:'09:00',deliveredEventKeys:[am.eventKey]})).toBeNull();
    });
    test('changing an extra time permits a new chosen-time event', () => {
        const first=decide('20:00:00',{customEnabled:true,reminderTime:'20:00'});
        expect(decide('21:31:00',{customEnabled:true,reminderTime:'21:31',deliveredEventKeys:[first.eventKey]})).not.toBeNull();
    });
    test('a completed local-day session suppresses PM and custom across the UTC day boundary', () => {
        const log=[{date:'2026-10-12T23:50:00Z'}]; // 4:50 PM PDT
        expect(decide('19:00:00',{sessionLog:log})).toBeNull();
        expect(decide('21:31:00',{sessionLog:log,customEnabled:true,reminderTime:'21:31'})).toBeNull();
        expect(trainedOnLocalDay(log,'2026-10-12','America/Los_Angeles')).toBe(true);
    });
    test('yesterday evening does not suppress the next morning even on the same UTC date', () => {
        const input={now:new Date('2026-10-13T16:00:00Z'),timezone:'America/Los_Angeles',customEnabled:false,
            sessionLog:[{date:'2026-10-13T06:50:00Z'}]};
        expect(decideNotification(input)?.kind).toBe('daily_reminder');
    });
    test('praise waits twenty minutes and is sent once per actual completion', () => {
        const sessionLog=[{date:'2026-10-13T01:00:00Z'}]; // 6 PM PDT
        expect(decide('18:19:59',{sessionLog})).toBeNull();
        const praise=decide('18:20:00',{sessionLog});
        expect(praise?.kind).toBe('completion_praise');
        expect(praise?.body).toBe('Good job for showing up today.');
        expect(decide('18:21:00',{sessionLog,deliveredEventKeys:[praise.eventKey]})).toBeNull();
    });
    test('praise remains due after a small scheduler delay, without praising old or future sessions', () => {
        expect(decide('18:25:00',{sessionLog:[{date:'2026-10-13T01:00:00Z'}]})?.kind).toBe('completion_praise');
        for(const date of ['2026-10-13T00:00:00Z','2026-10-13T02:00:00Z','2026-10-12','invalid'])
            expect(decide('18:25:00',{sessionLog:[{date}]})).toBeNull();
    });
    test('completing the scheduled work still receives praise on a rest or Pass day', () => {
        expect(decide('18:20:00',{sessionLog:[{date:'2026-10-13T01:00:00Z'}],schedule:Array(7).fill('rest'),passProtectedDates:['2026-10-13']})?.kind).toBe('completion_praise');
    });
    test('a completion follow-up can cross midnight without falsely saying today', () => {
        const r=decideNotification({now:new Date('2026-10-13T07:10:00Z'),timezone:'America/Los_Angeles',
            sessionLog:[{date:'2026-10-13T06:50:00Z'}]});
        expect(r?.kind).toBe('completion_praise');
        expect(r?.body).toBe('Good job for showing up.');
    });
    test('each completion is distinct and equivalent timestamp spellings deduplicate', () => {
        const sessionLog=[{date:'2026-10-13T01:00:00Z'},{date:'2026-10-12T18:05:00-07:00'}];
        const first=decide('18:25:00',{sessionLog});
        const second=decide('18:25:00',{sessionLog,deliveredEventKeys:[first.eventKey]});
        expect(second?.eventKey).not.toBe(first.eventKey);
        expect(decide('18:25:00',{sessionLog,deliveredEventKeys:[first.eventKey,second.eventKey]})).toBeNull();
    });
});

describe('daily practice remains separate from training notifications',()=>{
 test('a completed practice does not suppress a still-due training reminder',()=>{
  const r=decideNotification({now:new Date('2026-10-13T19:00:00Z'),timezone:'UTC',schedule:Array(7).fill('length'),sessionLog:[{date:'2026-10-13T18:30:00Z',workKind:'dailyPractice'}]});
  expect(r?.kind).toBe('daily_reminder');
 });
 test('a practice alone does not fabricate completion praise',()=>{
  expect(decideNotification({now:new Date('2026-10-13T18:50:00Z'),timezone:'UTC',sessionLog:[{date:'2026-10-13T18:30:00Z',workKind:'dailyPractice'}]})).toBeNull();
 });
});

 test('a completed minimum on a held recovery day suppresses training prompts without claiming primary work',()=>{
  const log=[{date:'2026-10-13T18:30:00Z',workKind:'dailyPractice',trainingRestSatisfied:true}];
  expect(decideNotification({now:new Date('2026-10-13T19:00:00Z'),timezone:'UTC',schedule:Array(7).fill('length'),sessionLog:log})).toBeNull();
 });
