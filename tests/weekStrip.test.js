import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
    weekStripSlots, buildWeekStripModel,
    WEEK_STRIP_STATE, WEEK_STRIP_REFUSAL, WEEK_STRIP_DAYS,
} from '../src/weekStrip.js';
import { dateKeyForWeekday, localDateKeyForWeekday } from '../src/weekUtils.js';

/**
 * The strip answers where the member is in the week, and nothing else.
 *
 * Two properties carry most of the weight and both are asserted rather than
 * reasoned about:
 *
 *   Authoritative prescriptions are looked up by LOCAL date identity. The
 *   frozen legacy helper shifts a date at UTC+13 and UTC+14, and because a
 *   week recurs it would usually return a plausible type for the wrong day
 *   rather than nothing. The adjacent-day trap below is built so that kind of
 *   wrong cannot pass.
 *
 *   A cell can never contradict itself. No knowable prescription means no
 *   satisfied work, and rest is never satisfied, even if a caller hands the
 *   model a mismatched satisfied array.
 */

/* 2026-03-09 is a Monday. ISO week: Mon 03-09 .. Sun 03-15. */
const MON = 9;
const at = (offsetDays, h = 12) => new Date(2026, 2, MON + offsetDays, h);
const KEY = (offsetDays) => {
    const d = new Date(2026, 2, MON + offsetDays, 12);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const plan = (dateOffset, over = {}) => ({
    date: KEY(dateOffset),
    mode: 'prescribed',
    status: 'pending',
    primarySession: { type: 'length', tier: 'intermediate' },
    supportingWork: [],
    dailyPractice: [],
    generatedAt: '2026-03-09T12:00:00.000Z',
    generatedFrom: { programmeKey: 'size', version: 1 },
    ...over,
});
const restPlan = (dateOffset) => plan(dateOffset, { mode: 'rest', primarySession: null });

/* The size preset, Sunday-indexed, as persisted.schedule holds it. */
const LEGACY = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

const model = (over = {}) => buildWeekStripModel({
    now: at(3),                   // Thursday
    authoritative: true,
    dayPlans: [],
    legacySchedule: LEGACY,
    sessionLog: [],
    satisfied: [],
    ...over,
});
const byDay = (r) => Object.fromEntries(r.days.map(d => [d.weekday, d]));

describe('1. authoritative lookup uses local date identity', () => {
    test('a plan is found by its own local date key', () => {
        const r = weekStripSlots({
            now: at(3), authoritative: true,
            dayPlans: [plan(3, { primarySession: { type: 'girth', tier: 'elite' } })],
        });
        expect(r.ok).toBe(true);
        /* Thursday is getDay() 4, so slot 4 in the Sunday-indexed array. */
        expect(r.slots[4]).toBe('girth');
        expect(r.slots.filter(Boolean)).toHaveLength(1);
    });

    test('the lookup key is the local helper, not the legacy one', () => {
        /* In UTC the two agree, so this is a same-value check here and the
           zone test below is what separates them. Pinned so the relationship
           is stated rather than implied. */
        expect(localDateKeyForWeekday(at(3), 4)).toBe(KEY(3));
    });
});

describe('2. UTC+14 adjacent-day trap', () => {
    /* THE TEST THE MODULE EXISTS FOR. Adjacent days carry DIFFERENT
       prescriptions, so a lookup that reads the neighbouring day returns a
       valid-looking but wrong type rather than nothing. A recurring week
       would hide a same-type mistake; this cannot. */
    const probe = (tz) => {
        const script = `
            import { weekStripSlots } from '${process.cwd()}/src/weekStrip.js';
            import { dateKeyForWeekday, localDateKeyForWeekday } from '${process.cwd()}/src/weekUtils.js';
            const mk = (d, type, mode) => ({
                date: d, mode: mode || 'prescribed', status: 'pending',
                primarySession: mode === 'rest' ? null : { type, tier: 'intermediate' },
                supportingWork: [], dailyPractice: [],
                generatedAt: '2026-03-09T12:00:00.000Z',
                generatedFrom: { programmeKey: 'size', version: 1 },
            });
            /* Tuesday girth, Wednesday rest. Deliberately different. */
            const plans = [mk('2026-03-10', 'girth'), mk('2026-03-11', null, 'rest')];
            const now = new Date(2026, 2, 11, 12);        // Wednesday local noon
            const r = weekStripSlots({ now, authoritative: true, dayPlans: plans });
            console.log(JSON.stringify({
                weekday: now.getDay(),
                localKeyWed: localDateKeyForWeekday(now, 3),
                legacyKeyWed: dateKeyForWeekday(now, 3),
                tue: r.slots[2],
                wed: r.slots[3],
            }));
        `;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
            { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
        return JSON.parse(out.trim().split('\n').pop());
    };

    test('UTC+14: Wednesday resolves Wednesday, not the shifted Tuesday', () => {
        const r = probe('Pacific/Kiritimati');
        expect(r.weekday).toBe(3);                    // Wednesday locally
        expect(r.localKeyWed).toBe('2026-03-11');     // the corrected identity
        expect(r.legacyKeyWed).toBe('2026-03-10');    // the shift, still there
        /* If the lookup used the legacy key, Wednesday's slot would read
           'girth' (Tuesday's plan) instead of 'rest'. */
        expect(r.wed).toBe('rest');
        expect(r.tue).toBe('girth');
    }, 30_000);

    test('UTC and a zone behind UTC agree with the local calendar too', () => {
        ['UTC', 'America/New_York', 'Pacific/Apia'].forEach(tz => {
            const r = probe(tz);
            expect(r.wed, tz).toBe('rest');
            expect(r.tue, tz).toBe('girth');
        });
    }, 30_000);
});

describe('3. legacy and custom members use the supplied schedule', () => {
    test('the column passes through, Sunday-indexed', () => {
        const r = weekStripSlots({ now: at(3), authoritative: false, legacySchedule: LEGACY });
        expect(r.slots).toEqual(LEGACY);
    });

    test('day plans are ignored entirely for them', () => {
        const r = weekStripSlots({
            now: at(3), authoritative: false, legacySchedule: LEGACY,
            dayPlans: [plan(3, { primarySession: { type: 'stamina', tier: 'elite' } })],
        });
        expect(r.slots).toEqual(LEGACY);
    });

    test('a missing column yields no prescriptions rather than throwing', () => {
        const r = weekStripSlots({ now: at(3), authoritative: false });
        expect(r.ok).toBe(true);
        expect(r.slots.filter(s => s !== undefined)).toEqual([]);
    });

    test('anything but an explicit true is the legacy path', () => {
        [undefined, false, 'yes', 1, null].forEach(v => {
            const r = weekStripSlots({ now: at(3), authoritative: v, legacySchedule: LEGACY });
            expect(r.slots, String(v)).toEqual(LEGACY);
        });
    });
});

describe('4. presentation order is Monday to Sunday', () => {
    test('the labels and their weekday indices', () => {
        const r = model();
        expect(r.days.map(d => d.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        expect(r.days.map(d => d.weekdayIndex)).toEqual([1, 2, 3, 4, 5, 6, 0]);
        expect(WEEK_STRIP_DAYS[0]).toBe('Mon');
    });

    test('the dates ascend, so Sunday is last and not first', () => {
        const r = model();
        const dates = r.days.map(d => d.date);
        expect(dates).toEqual([...dates].sort());
        expect(dates[0]).toBe(KEY(0));     // Monday
        expect(dates[6]).toBe(KEY(6));     // Sunday, the END of the ISO week
    });

    test('today lands on its own cell by local date', () => {
        const r = model();
        const today = r.days.filter(d => d.isToday);
        expect(today).toHaveLength(1);
        expect(today[0].weekday).toBe('Thu');
        expect(today[0].date).toBe(KEY(3));
    });
});

describe('5 and 6. midweek cutover leaves earlier dates unknown', () => {
    /* A Thursday cutover: plans exist Thursday onward and nothing earlier. */
    const CUTOVER = [plan(3), restPlan(4), plan(5, { primarySession: { type: 'girth', tier: 'intermediate' } }), restPlan(6)];

    test('Monday, Tuesday and Wednesday are unknown', () => {
        const d = byDay(model({ dayPlans: CUTOVER }));
        ['Mon', 'Tue', 'Wed'].forEach(k => {
            expect(d[k].state, k).toBe(WEEK_STRIP_STATE.UNKNOWN);
            expect(d[k].prescriptionKnown, k).toBe(false);
            expect(d[k].prescriptionType, k).toBe(null);
            expect(d[k].isPast, k).toBe(true);
        });
    });

    test('Thursday onward is known', () => {
        const d = byDay(model({ dayPlans: CUTOVER }));
        expect(d.Thu.prescriptionType).toBe('length');
        expect(d.Fri.isRest).toBe(true);
        expect(d.Sat.prescriptionType).toBe('girth');
        expect(d.Sun.isRest).toBe(true);
    });

    test('the legacy projection cannot fill the missing history', () => {
        /* The column is supplied and says Monday is 'girth'. An authoritative
           member's Monday must stay unknown anyway: using the projection here
           would recreate at presentation time the backfill storage refused. */
        const d = byDay(model({ dayPlans: CUTOVER, legacySchedule: LEGACY }));
        expect(LEGACY[1]).toBe('girth');                   // the column does say so
        expect(d.Mon.prescriptionType).toBe(null);         // and it is still ignored
        expect(d.Mon.state).toBe(WEEK_STRIP_STATE.UNKNOWN);
    });

    test('the slot array leaves those days undefined for weekCompletion', () => {
        /* undefined is what keeps them out of the denominator, because
           weekCompletion already treats an undescribed day as no commitment. */
        const r = weekStripSlots({ now: at(3), authoritative: true, dayPlans: CUTOVER, legacySchedule: LEGACY });
        expect(r.slots[1]).toBeUndefined();   // Monday
        expect(r.slots[2]).toBeUndefined();   // Tuesday
        expect(r.slots[3]).toBeUndefined();   // Wednesday
        expect(r.slots[4]).toBe('length');    // Thursday
    });
});

describe('7. a known rest day can never be satisfied', () => {
    test('rest with satisfied true stays rest, not satisfied', () => {
        const d = byDay(model({
            dayPlans: [restPlan(3)],
            satisfied: [true, true, true, true, true, true, true],
        }));
        expect(d.Thu.isRest).toBe(true);
        expect(d.Thu.satisfied).toBe(false);
        expect(d.Thu.state).toBe(WEEK_STRIP_STATE.REST);
    });

    test('a legacy rest day is the same', () => {
        const d = byDay(model({
            authoritative: false, legacySchedule: LEGACY,
            satisfied: [true, true, true, true, true, true, true],
        }));
        /* THE SUNDAY-INDEXED TRAP, and the first draft of this test fell into
           it. LEGACY is the size preset indexed by Date#getDay(), so index 0
           is SUNDAY and it holds 'length': Sunday is a TRAINING day in that
           preset. Its rest days are index 2 (Tue), 5 (Fri) and 6 (Sat).
           Reading the array left to right as Mon..Sun is exactly the
           confusion the Monday-first presentation exists to remove. */
        expect(LEGACY[0]).toBe('length');
        ['Tue', 'Fri', 'Sat'].forEach(k => {
            expect(d[k].state, k).toBe(WEEK_STRIP_STATE.REST);
            expect(d[k].satisfied, k).toBe(false);
        });
        /* And Sunday, being training, is satisfied here rather than rest. */
        expect(d.Sun.prescriptionType).toBe('length');
        expect(d.Sun.state).toBe(WEEK_STRIP_STATE.SATISFIED);
    });
});

describe('8. an unknown prescription can never be satisfied', () => {
    test('even when the caller passes satisfied true for every day', () => {
        const d = byDay(model({
            dayPlans: [plan(3)],                       // Thursday only
            satisfied: [true, true, true, true, true, true, true],
        }));
        ['Mon', 'Tue', 'Wed', 'Fri', 'Sat', 'Sun'].forEach(k => {
            expect(d[k].prescriptionKnown, k).toBe(false);
            expect(d[k].satisfied, k).toBe(false);
            expect(d[k].state, k).toBe(WEEK_STRIP_STATE.UNKNOWN);
        });
        expect(d.Thu.satisfied).toBe(true);             // the one real day
    });

    test('the impossible combination is never emitted', () => {
        const r = model({ dayPlans: [plan(3)], satisfied: Array(7).fill(true) });
        r.days.forEach(day => {
            expect(day.prescriptionKnown || !day.satisfied, day.weekday).toBe(true);
            expect(!day.isRest || !day.satisfied, day.weekday).toBe(true);
        });
    });
});

describe('9. satisfied scheduled training', () => {
    test('a training day the canonical answer counts is satisfied', () => {
        const sat = Array(7).fill(false); sat[4] = true;        // Thursday
        const d = byDay(model({ dayPlans: [plan(3)], satisfied: sat }));
        expect(d.Thu.state).toBe(WEEK_STRIP_STATE.SATISFIED);
        expect(d.Thu.satisfied).toBe(true);
        expect(d.Thu.prescriptionType).toBe('length');
        expect(d.Thu.isRest).toBe(false);
    });
});

describe('10. past unsatisfied training is PENDING with isPast', () => {
    test('not a MISSED state, which the vocabulary deliberately lacks', () => {
        const d = byDay(model({ now: at(3), dayPlans: [plan(1)], satisfied: Array(7).fill(false) }));
        expect(d.Tue.state).toBe(WEEK_STRIP_STATE.PENDING);
        expect(d.Tue.isPast).toBe(true);
        expect(d.Tue.isFuture).toBe(false);
        expect(d.Tue.isToday).toBe(false);
        expect(Object.values(WEEK_STRIP_STATE)).not.toContain('missed');
        expect(Object.values(WEEK_STRIP_STATE)).toHaveLength(4);
    });
});

describe('11. future scheduled training is PENDING with isFuture', () => {
    test('the same state as a past unsatisfied day, distinguished by a modifier', () => {
        const d = byDay(model({ now: at(3), dayPlans: [plan(5)], satisfied: Array(7).fill(false) }));
        expect(d.Sat.state).toBe(WEEK_STRIP_STATE.PENDING);
        expect(d.Sat.isFuture).toBe(true);
        expect(d.Sat.isPast).toBe(false);
    });
});

describe('12. activity can exist with an unknown prescription', () => {
    test('a pre-cutover day shows what happened without claiming a prescription', () => {
        /* Exactly the midweek case: we know the member trained on Monday and
           we do not know what Monday asked for. */
        const d = byDay(model({
            dayPlans: [plan(3)],                      // Thursday onward only
            sessionLog: [{ date: new Date(2026, 2, MON, 12).toISOString(), routineType: 'girth' }],
        }));
        expect(d.Mon.prescriptionKnown).toBe(false);
        expect(d.Mon.state).toBe(WEEK_STRIP_STATE.UNKNOWN);
        expect(d.Mon.performedType).toBe('girth');     // activity known
        expect(d.Mon.satisfied).toBe(false);           // obligation unknowable
    });
});

describe('13. substitution is detail, not a fifth state', () => {
    test('a satisfied day with a substitution is simply satisfied', () => {
        const sat = Array(7).fill(false); sat[4] = true;
        const d = byDay(model({
            dayPlans: [plan(3)],                       // Thursday prescribes length
            satisfied: sat,
            sessionLog: [{ date: at(3).toISOString(), routineType: 'girth', manualOverride: true }],
        }));
        expect(d.Thu.state).toBe(WEEK_STRIP_STATE.SATISFIED);
        expect(d.Thu.substituted).toBe(true);
        expect(d.Thu.performedType).toBe('girth');
        expect(d.Thu.prescriptionType).toBe('length');
        /* No new state was introduced for it. */
        expect(Object.values(WEEK_STRIP_STATE)).toContain(d.Thu.state);
    });

    test('a substitution does not satisfy a day the canonical answer does not', () => {
        const d = byDay(model({
            dayPlans: [plan(3)],
            satisfied: Array(7).fill(false),
            sessionLog: [{ date: at(3).toISOString(), routineType: 'recovery', manualOverride: true }],
        }));
        expect(d.Thu.satisfied).toBe(false);
        expect(d.Thu.state).toBe(WEEK_STRIP_STATE.PENDING);
        expect(d.Thu.substituted).toBe(true);          // still recorded as detail
    });
});

describe('14. an unreadable plan becomes unknown', () => {
    test('a record normaliseDayPlan refuses is not repaired or guessed', () => {
        const d = byDay(model({
            dayPlans: [{ date: KEY(3), mode: 'invented', status: 'pending' }],
            satisfied: Array(7).fill(true),
        }));
        expect(d.Thu.prescriptionKnown).toBe(false);
        expect(d.Thu.prescriptionType).toBe(null);
        expect(d.Thu.state).toBe(WEEK_STRIP_STATE.UNKNOWN);
        expect(d.Thu.satisfied).toBe(false);
    });

    test('a plan with a type outside the legacy vocabulary is unknown too', () => {
        const d = byDay(model({
            dayPlans: [plan(3, { primarySession: { type: 'recovery', tier: 'intermediate' } })],
        }));
        expect(d.Thu.prescriptionKnown).toBe(false);
        expect(d.Thu.state).toBe(WEEK_STRIP_STATE.UNKNOWN);
    });
});

describe('15. a support-only plan becomes unknown in this phase', () => {
    test('no primary session means the legacy vocabulary has no word for it', () => {
        /* toLegacySchedule already refuses such a day. The strip reads it as
           unknown rather than inventing a fifth state or mapping it to rest,
           because rest is what suppresses the member's reminder. */
        const d = byDay(model({
            dayPlans: [plan(3, {
                primarySession: null,
                supportingWork: [{ type: 'pelvicFloor', category: 'strength' }],
            })],
        }));
        expect(d.Thu.prescriptionKnown).toBe(false);
        expect(d.Thu.isRest).toBe(false);              // not mapped to rest
        expect(d.Thu.state).toBe(WEEK_STRIP_STATE.UNKNOWN);
    });
});

describe('16. a missing or invalid now refuses', () => {
    const BAD = [undefined, null, 'nonsense', 0, 1773000000000, {}, [], new Date('nope')];

    test.each(BAD.map(v => [JSON.stringify(v) ?? String(v), v]))('weekStripSlots refuses %s', (_label, v) => {
        expect(weekStripSlots({ now: v, authoritative: true, dayPlans: [] }))
            .toEqual({ ok: false, reason: WEEK_STRIP_REFUSAL.NO_CLOCK });
    });

    test.each(BAD.map(v => [JSON.stringify(v) ?? String(v), v]))('buildWeekStripModel refuses %s', (_label, v) => {
        expect(buildWeekStripModel({ now: v, authoritative: true, dayPlans: [] }))
            .toEqual({ ok: false, reason: WEEK_STRIP_REFUSAL.NO_CLOCK });
    });

    test('no input at all refuses rather than reading the clock', () => {
        expect(weekStripSlots().reason).toBe(WEEK_STRIP_REFUSAL.NO_CLOCK);
        expect(buildWeekStripModel().reason).toBe(WEEK_STRIP_REFUSAL.NO_CLOCK);
        expect(weekStripSlots(null).reason).toBe(WEEK_STRIP_REFUSAL.NO_CLOCK);
    });

    test('the module source contains no clock read at all', () => {
        /* A refusal is only meaningful while there is no fallback hiding
           behind it. new Date() anywhere in here would make the contract a
           claim rather than a fact. */
        const src = execFileSync('cat', ['src/weekStrip.js'], { encoding: 'utf8' })
            .replace(/\/\*[\s\S]*?\*\//g, ' ');
        expect(src).not.toMatch(/new Date\(\)/);
        expect(src).not.toMatch(/Date\.now/);
    });
});

describe('17. inputs are not mutated', () => {
    test('both exported functions leave every input byte-identical', () => {
        const dayPlans = [plan(3), restPlan(4)];
        const legacySchedule = [...LEGACY];
        const sessionLog = [{ date: at(3).toISOString(), routineType: 'girth', manualOverride: true }];
        const satisfied = [false, false, false, false, true, false, false];
        const now = at(3);
        const input = { now, authoritative: true, dayPlans, legacySchedule, sessionLog, satisfied };

        const snapshot = JSON.stringify({ dayPlans, legacySchedule, sessionLog, satisfied });
        const inputSnapshot = JSON.stringify(input);
        const nowTime = now.getTime();

        weekStripSlots(input);
        buildWeekStripModel(input);

        expect(JSON.stringify({ dayPlans, legacySchedule, sessionLog, satisfied })).toBe(snapshot);
        expect(JSON.stringify(input)).toBe(inputSnapshot);
        expect(now.getTime()).toBe(nowTime);           // the clock object untouched
    });

    test('the same input gives the same answer twice', () => {
        const input = {
            now: at(3), authoritative: true, dayPlans: [plan(3)],
            satisfied: [false, false, false, false, true, false, false],
        };
        expect(JSON.stringify(buildWeekStripModel(input)))
            .toBe(JSON.stringify(buildWeekStripModel(input)));
    });
});

describe('the record shape is stable', () => {
    test('every day carries exactly the agreed fields', () => {
        const r = model({ dayPlans: [plan(3)] });
        r.days.forEach(d => {
            expect(Object.keys(d).sort()).toEqual([
                'date', 'isFuture', 'isPast', 'isRest', 'isToday', 'performedType',
                'prescriptionKnown', 'prescriptionType', 'satisfied', 'state',
                'substituted', 'weekday', 'weekdayIndex',
            ]);
        });
    });

    test('exactly one cell is today, and past plus future accounts for the rest', () => {
        const r = model({ dayPlans: [plan(3)] });
        expect(r.days.filter(d => d.isToday)).toHaveLength(1);
        expect(r.days.filter(d => d.isPast)).toHaveLength(3);      // Mon Tue Wed
        expect(r.days.filter(d => d.isFuture)).toHaveLength(3);    // Fri Sat Sun
    });

    test('the session-log cross-check stays on the legacy relationship', () => {
        /* Recorded rather than fixed. Session log dates are toISOString, and
           weekCompletion compares against dateKeyForWeekday, so performed
           lookup matches it on purpose. Carried _dayKey debt. */
        expect(dateKeyForWeekday(at(3), 4)).toBe(KEY(3));
    });
});
