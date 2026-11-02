import { describe, test, expect } from 'vitest';
import {
    MESSAGES,
    localHourFor, localMinuteOfDay, localDateFor, localWeekdayFor,
    utcDayKey, trainedOn, trainedOnLocalDay, reminderHour, reminderMinuteOfDay, decideNotification,
    TRAINING_SLOTS, isTrainingSlot, PENDING_SLOT_VOCABULARY,
} from '../supabase/functions/_shared/notifyRules.js';
import { LEGACY_PRIMARY_TYPES, LEGACY_REST } from '../src/scheduleSlot.js';

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
        expect(r.title).toBe('Coach Tee');
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

    test('the sender title names Coach Tee without repeating the app name', () => {
        for (const m of everyMessage) expect(m.title).toBe('Coach Tee');
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

/**
 * WORKER TOLERANCE FOR THE SLOT VOCABULARY THAT IS COMING.
 *
 * #186 phase 1. The Worker deploys on its own lifecycle and must accept the
 * new values before any client can emit one, so this change ships first and
 * alone. Its whole claim is that it does nothing to anybody today.
 *
 * That claim is only worth making if it is proved rather than asserted, and
 * the owner was right to ask for the legacy cohorts specifically. The first
 * block below is characterization: every one of the four shipped programmes,
 * every weekday, pinned to the behaviour it has in production right now. If
 * the production change alters a single one of those 28 decisions it is not
 * a compatibility change and this suite says so.
 *
 * The second block is the cohorts that have no schedule to read. Inverting
 * the slot test naively would have read their silence as rest and stopped
 * their reminders. send-notifications/index.ts falls back to a select
 * WITHOUT the schedule column on an un-migrated project, so that is not a
 * hypothetical row, it is every row on a deployment that has not migrated.
 *
 * Only the third block describes new behaviour, and nothing the app can
 * currently write reaches it.
 */
describe('#186 phase 1: the Worker tolerates slot values it has never seen', () => {
    /* The four shipped presets, exactly as app/index.html GOALS holds them.
       Sunday-indexed, which is why the first entry is Sunday's. */
    const SHIPPED = {
        size:    ['length','girth','rest','length','girth','rest','rest'],
        stamina: ['stamina','rest','stamina','rest','stamina','rest','rest'],
        eq:      ['stamina','rest','length','rest','stamina','rest','rest'],
        all:     ['length','girth','rest','stamina','length','rest','rest'],
    };
    /* 2026-03-15 is a Sunday, so day index and offset agree. */
    const SUNDAY = '2026-03-15';
    const at = i => new Date(`2026-03-${15 + i}T19:00:00Z`);
    const decideOn = (schedule, i, over = {}) => decideNotification({
        schedule, timezone: 'UTC', now: at(i), ...over,
    });

    describe('characterization: no shipped programme changes on any weekday', () => {
        for (const [goal, schedule] of Object.entries(SHIPPED)) {
            test(`${goal} sends on its training days and stays silent on its rest days`, () => {
                const got = schedule.map((_, i) => decideOn(schedule, i) !== null);
                /* The expectation is derived from the slot, not copied from
                   the implementation, so the two cannot drift together. */
                const want = schedule.map(slot => slot !== 'rest');
                expect(got).toEqual(want);
            });
        }

        test('and the day index really is Sunday-first, not Monday-first', () => {
            /* If this ever flips, every row above silently tests the wrong
               day and still passes. Size trains on Sunday and rests on
               Tuesday, which is only true read Sunday-first. */
            expect(new Date(SUNDAY + 'T12:00:00Z').getUTCDay()).toBe(0);
            expect(decideOn(SHIPPED.size, 0)).not.toBeNull();
            expect(decideOn(SHIPPED.size, 2)).toBeNull();
        });
    });

    describe('accounts with no schedule to read keep their reminders', () => {
        /* THE REGRESSION THIS BLOCK EXISTS TO PREVENT. Absence of a schedule
           is not the presence of a rest day. Each of these members is sent a
           reminder today and must still be sent one. */
        test('a project that has not migrated the schedule column', () => {
            // readTrainingState() falls back to a select without `schedule`
            // and without `programme`, so every row arrives like this.
            expect(decideNotification({ schedule: null, programme: null,
                timezone: 'UTC', now: at(2) })).not.toBeNull();
        });

        test('the session_log-only fallback below even that', () => {
            expect(decideNotification({ sessionLog: [], timezone: 'UTC', now: at(2) }))
                .not.toBeNull();
        });

        test('a member who has never been given a programme', () => {
            expect(decideNotification({ timezone: 'UTC', now: at(2) })).not.toBeNull();
            expect(decideNotification({ schedule: undefined, timezone: 'UTC', now: at(2) }))
                .not.toBeNull();
        });

        test('a schedule of the wrong length is unreadable, not restful', () => {
            for (const bad of [[], ['rest'], Array(6).fill('rest'), Array(8).fill('rest'),
                               'rest', 42, {}]) {
                expect(decideNotification({ schedule: bad, timezone: 'UTC', now: at(2) }),
                    `schedule ${JSON.stringify(bad)} suppressed a reminder`).not.toBeNull();
            }
        });
    });

    describe('new vocabulary, which nothing can emit yet', () => {
        test('a support day does not announce itself as training', () => {
            /* A day carrying real supporting work but no mechanical primary
               session is not "time to train". Under the old rule it was
               anything-but-rest and therefore sent. */
            const week = ['rest','support','support','support','rest','support','support'];
            for (let i = 0; i < 7; i++) {
                expect(decideOn(week, i), `index ${i} sent a training push`).toBeNull();
            }
        });

        test('a genuinely empty day sends nothing either', () => {
            expect(decideOn(Array(7).fill('full-rest'), 3)).toBeNull();
        });

        test('an unrecognised value fails safe as not-training', () => {
            for (const slot of ['mystery','', 'Length','LENGTH',' length', null, 0, undefined]) {
                const week = Array(7).fill('rest'); week[3] = slot;
                expect(decideOn(week, 3), `${JSON.stringify(slot)} sent a push`).toBeNull();
            }
        });

        test('but a known training slot still sends, including beside new values', () => {
            const mixed = ['full-rest','length','support','stamina','full-rest','girth','support'];
            expect(mixed.map((_, i) => decideOn(mixed, i) !== null))
                .toEqual([false, true, false, true, false, true, false]);
        });

        test('isTrainingSlot is the single answer, and it is exact', () => {
            expect(TRAINING_SLOTS).toEqual(['length','girth','stamina']);
            for (const t of TRAINING_SLOTS) expect(isTrainingSlot(t)).toBe(true);
            for (const f of ['rest','support','full-rest','recovery','Length','',null,undefined,0])
                expect(isTrainingSlot(f), `${JSON.stringify(f)}`).toBe(false);
            /* Frozen, because a consumer that can push onto this list can
               make any day announce itself as training. */
            expect(Object.isFrozen(TRAINING_SLOTS)).toBe(true);
        });
    });

    describe('a queued goal change is no longer thrown away for naming something new', () => {
        const current = SHIPPED.size;
        const pending = eff => ({ pendingChange: { effectiveDate: eff, schedule:
            ['full-rest','length','support','support','full-rest','girth','support'] } });
        /* Same thing with the week varied instead of the date. */
        const pending2 = week => ({ pendingChange: { effectiveDate: '2026-03-15', schedule: week } });

        test('before it is due the current schedule still decides', () => {
            // Monday index 1 is girth under the current Size preset.
            expect(decideOn(current, 1, { programme: pending('2026-03-20') })).not.toBeNull();
        });

        test('once due it is honoured instead of the schedule it replaced', () => {
            /* THE HOLE THIS CLOSES. The old validator required every value to
               be one of four, so this pending change was discarded and the
               member silently ran on the preset they had already left.
               Wednesday index 3 is 'length' under the current Size preset and
               'support' under the queued one: the two disagree, which is what
               makes the assertion meaningful. */
            expect(current[3]).toBe('length');
            expect(decideOn(current, 3, { programme: pending('2026-03-15') })).toBeNull();
            // And Friday index 5 is 'rest' now but 'girth' after the change.
            expect(current[5]).toBe('rest');
            expect(decideOn(current, 5, { programme: pending('2026-03-15') })).not.toBeNull();
        });

        test('a pending change it cannot read is refused, not adopted', () => {
            /* EVERY CASE HERE MUST DISCRIMINATE. Wednesday index 3 is
               'length' under the current Size preset, so a fallback sends;
               each rejected schedule below holds a NON-training value at
               index 3, so wrongly adopting it would suppress. A case whose
               index 3 also happens to be non-training proves nothing, which
               is how the empty-string case first slipped through: mutating
               the `t.length > 0` guard away changed no observable outcome. */
            expect(current[3]).toBe('length');
            for (const bad of [['rest'], null, 'rest', [1,2,3,4,5,6,7],
                               ['support','support','support','support','support','support',''],
                               ['support','support','support','support','support','support',null],
                               Array(7).fill('support').concat('support')]) {
                expect(decideOn(current, 3,
                    { programme: { pendingChange: { effectiveDate: '2026-03-15', schedule: bad } } }),
                    `unreadable ${JSON.stringify(bad)} was adopted`).not.toBeNull();
            }
        });

        test('ONE UNKNOWN TOKEN REFUSES THE WHOLE QUEUED WEEK', () => {
            /* The review correction. Accepting any seven non-empty strings
               let a typo, a truncated write or a foreign record become the
               member's effective reminder schedule for every day of the week.

               Failing safe on one unreadable day we already hold is
               reasonable. Adopting an unreadable WEEK as an assertion about
               the future is not, and the two decisions must not be confused:
               today's slot is open at the bottom, a queued change is closed.

               Each mixed week below is otherwise perfectly well formed and
               differs from the current preset on Wednesday, so adopting it
               would suppress a reminder the fallback sends. That is what
               makes old and new behaviour distinguishable here. */
            expect(current[3]).toBe('length');
            const mixed = [
                ['full-rest','length','support','mystery','full-rest','girth','support'],
                ['full-rest','length','support','Support','full-rest','girth','support'],
                ['full-rest','length','support','FULL-REST','full-rest','girth','support'],
                ['full-rest','length','support','full rest','full-rest','girth','support'],
                ['full-rest','length','support','suport','full-rest','girth','support'],
                ['full-rest','length','support',' support','full-rest','girth','support'],
                ['full-rest','length','support','recovery','full-rest','girth','support'],
            ];
            for (const week of mixed) {
                expect(decideOn(current, 3, { programme: pending2(week) }),
                    `unknown token ${JSON.stringify(week[3])} was adopted`).not.toBeNull();
            }
        });

        test('while a fully recognised queued week is adopted on every day', () => {
            /* The counterpart, so the test above cannot pass by refusing
               everything. Same shape, every token in the vocabulary. */
            const week = ['full-rest','length','support','support','full-rest','girth','support'];
            expect(week.map((_, i) => decideOn(current, i, { programme: pending2(week) }) !== null))
                .toEqual([false, true, false, false, false, true, false]);
        });

        test('the pending vocabulary is closed, frozen and documented', () => {
            expect(PENDING_SLOT_VOCABULARY)
                .toEqual(['length','girth','stamina','rest','support','full-rest']);
            expect(Object.isFrozen(PENDING_SLOT_VOCABULARY)).toBe(true);
            /* It must contain every training slot, or a queued week naming
               real training would be refused. */
            for (const t of TRAINING_SLOTS) expect(PENDING_SLOT_VOCABULARY).toContain(t);
        });

        test('and a malformed effective date cannot bring a pending schedule forward', () => {
            for (const eff of ['not-a-date', '2026-3-15', 20260315, null]) {
                // Wednesday is 'length' now, so a fallback sends and an
                // incorrectly applied pending change would not.
                expect(decideOn(current, 3, { programme: { pendingChange: { effectiveDate: eff,
                    schedule: Array(7).fill('support') } } }), `${eff}`).not.toBeNull();
            }
        });
    });

    describe('the two sides of the wire cannot drift apart silently', () => {
        /* notifyRules.js deliberately has no imports, so the Deno edge
           function and vitest load it unchanged. That means it carries its
           own copy of the vocabulary, and a copy is a thing that goes stale.
           This test is the only place the two modules meet. If phase B
           renames a token or adds a mechanical type, this fails here rather
           than in production three weeks later. */
        test('the Worker agrees with src/scheduleSlot.js about what training is', () => {
            expect(TRAINING_SLOTS).toEqual([...LEGACY_PRIMARY_TYPES]);
        });

        test('and about what rest is called', () => {
            expect(PENDING_SLOT_VOCABULARY).toContain(LEGACY_REST);
            expect(isTrainingSlot(LEGACY_REST)).toBe(false);
        });

        test('every legacy primary type is training to the Worker', () => {
            for (const t of LEGACY_PRIMARY_TYPES) expect(isTrainingSlot(t)).toBe(true);
        });
    });
});
