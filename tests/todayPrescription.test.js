import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
    todayPrescription, primarySatisfied, launchSnapshotFrom, normaliseLaunchSnapshot,
    DAY_KIND, PRESCRIPTION_REFUSAL, PRESCRIPTION_SOURCE, SNAPSHOT_REFUSAL,
} from '../src/todayPrescription.js';

/**
 * One truthful Today prescription, per cohort.
 *
 * The defect this replaces: a reader that returned a legacy type string and
 * collapsed three different conditions onto 'rest'. A prescribed rest day, a
 * support-only day and a primary session with no readable type all came back
 * identical, and a missing or unreadable dated plan came back as whatever the
 * recurring projection said. So the tests below care as much about what is
 * REFUSED as about what is returned.
 */

const at = (y, m, d, h = 12) => new Date(y, m, d, h, 0, 0);
const THU = at(2026, 2, 12);            // 2026-03-12, a Thursday
const THU_KEY = '2026-03-12';
const SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

const plan = (over = {}) => ({ date: THU_KEY, mode: 'prescribed', ...over });
/**
 * A Primary plan in PRODUCTION shape, which as of Phase 3C.5 means it carries
 * a stored dose.
 *
 * It did not before: the dose was written by the generator and read by
 * nothing, so these fixtures could leave it out and still describe a valid
 * plan. It is now load bearing, and a Primary without one fails closed, so a
 * fixture without a dose would be describing a plan production never writes.
 * `doseFor` is the real generator's output shape for the tier.
 */
const doseFor = (type, tier = 'intermediate') => (type === 'girth'
    ? { v: 1, shape: 'circuit', tier, rounds: 4, restDur: 45,
        stations: [{ title: 'Wet Jelq', duration: 120 }, { title: 'Uli', duration: 45 }] }
    : { v: 1, shape: 'sets', tier,
        exercises: [{ title: `${type} A`, sets: 3, duration: 30 },
                    { title: `${type} B`, sets: 3, duration: 30 }] });
const primary = (type, over = {}) => plan({
    primarySession: { type, title: type, tier: 'intermediate', dose: doseFor(type), ...over },
});

describe('the clock is required, not guessed', () => {
    test('a missing or unreadable clock refuses', () => {
        for (const now of [undefined, null, 'today', new Date('nope'), 0]) {
            const r = todayPrescription({ now, authoritative: false, legacySchedule: SIZE });
            expect(r.ok, String(now)).toBe(false);
            expect(r.reason).toBe(PRESCRIPTION_REFUSAL.NO_CLOCK);
        }
    });

    test('a refusal carries no prescription fields to read by accident', () => {
        const r = todayPrescription({});
        expect(r.dayKind).toBeUndefined();
        expect(r.primaryType).toBeUndefined();
    });
});

describe('the authoritative cohort: the dated plan decides', () => {
    const auth = (dayPlans) => todayPrescription({
        now: THU, authoritative: true, dayPlans, legacySchedule: SIZE,
    });

    test('a prescribed Primary is the Primary, not the column', () => {
        /* The column says girth for a Thursday in the size week, so the two
           sources are made to DISAGREE: if the answer were the projection it
           would be girth, and it is length. */
        const r = auth([primary('length')]);
        expect(r).toEqual({
            ok: true, source: PRESCRIPTION_SOURCE.DATED_PLAN, date: THU_KEY,
            dayKind: DAY_KIND.PRIMARY, primaryType: 'length',
            planMode: 'prescribed', tier: 'intermediate', programmeKey: null,
            dose: doseFor('length'), doseWarnings: [],
        });
        expect(SIZE[THU.getDay()]).toBe('girth');       // the answer NOT given
    });

    test('a prescribed Rest is rest, whatever the column says', () => {
        const r = auth([plan({ mode: 'rest' })]);
        expect(r.ok).toBe(true);
        expect(r.dayKind).toBe(DAY_KIND.REST);
        expect(r.primaryType).toBeNull();
    });

    test('SUPPORT ONLY is itself: not rest, not primary, not a refusal', () => {
        /* The condition the old reader destroyed. It has real work on it, so
           it is not rest, and no Primary, so it is not training. Calling it
           rest would suppress a reminder for a day that has work; calling it
           primary would claim training nobody prescribed. */
        const r = auth([plan({ supportingWork: [{ type: 'mobility', title: 'Hips' }] })]);
        expect(r.ok).toBe(true);
        expect(r.dayKind).toBe(DAY_KIND.SUPPORT_ONLY);
        expect(r.primaryType).toBeNull();
        expect(r.dayKind).not.toBe(DAY_KIND.REST);
    });

    test('a MISSING plan refuses, and never reads the column', () => {
        const r = auth([primary('length', {})].filter(p => p.date !== THU_KEY));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(PRESCRIPTION_REFUSAL.PLAN_MISSING);
        expect(r.date).toBe(THU_KEY);
        expect(r.source).toBe(PRESCRIPTION_SOURCE.DATED_PLAN);
    });

    test('an UNREADABLE plan refuses, and is not repaired', () => {
        const r = auth([{ date: THU_KEY, mode: 'invented' }]);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(PRESCRIPTION_REFUSAL.PLAN_UNREADABLE);
    });

    test('a Primary type this build cannot run refuses rather than guessing', () => {
        const r = auth([primary('telekinesis')]);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(PRESCRIPTION_REFUSAL.SLOT_UNRESOLVED);
    });

    test('REFUSALS ARE NOT THE COLUMN, which is the whole point of the phase', () => {
        /* Three ways to fail, and not one of them may answer with the
           projection's mission. The column here would say girth every time. */
        for (const plans of [[], [{ date: THU_KEY, mode: 'nope' }], [primary('telekinesis')]]) {
            const r = auth(plans);
            expect(r.ok).toBe(false);
            expect(r.primaryType).toBeUndefined();
        }
    });

    test('a prescribed Primary carries its validated baseline dose', () => {
        /* The dose was carried unread until 3C.5. It is now the execution
           baseline, normalised and frozen by the validator rather than handed
           on as the raw stored object, so every reader downstream sees one
           shape. */
        const r = auth([primary('girth')]);
        expect(r.dose).toEqual(doseFor('girth'));
        expect(Object.isFrozen(r.dose)).toBe(true);
        expect(r.tier).toBe('intermediate');
        expect(r.planMode).toBe('prescribed');
    });

    test.each([['modified'], ['protective']])(
        'a stored planMode of %s FAILS CLOSED rather than reading as prescribed', (mode) => {
            /* Decision D1. Both are valid persisted vocabulary that the
               generator has never emitted and nothing has ever interpreted.
               Treating them as ordinary training would be inventing a meaning
               for a value we cannot explain; their semantics belong to
               programme-content work. Note this is deliberately NOT the
               resolver's MODIFIED state, which is a live soreness response and
               an unrelated concept that happens to share a word. */
            const r = auth([plan({ mode,
                primarySession: { type: 'girth', tier: 'intermediate', dose: doseFor('girth') } })]);
            expect(r.ok).toBe(false);
            expect(r.reason).toBe(PRESCRIPTION_REFUSAL.MODE_NOT_EXECUTABLE);
            expect(r.detail.planMode).toBe(mode);
            expect(r.primaryType).toBeUndefined();
        });

    test('a Primary with NO stored dose fails closed, never rebuilt from tables', () => {
        const r = auth([plan({ primarySession: { type: 'girth', tier: 'intermediate' } })]);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(PRESCRIPTION_REFUSAL.DOSE_MISSING);
    });

    test('a Primary with an INVALID stored dose fails closed too', () => {
        const r = auth([plan({ primarySession: { type: 'girth', tier: 'intermediate',
            dose: { v: 1, shape: 'sets', exercises: [] } } })]);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(PRESCRIPTION_REFUSAL.DOSE_INVALID);
        expect(r.detail.code).toBe('empty_items');
    });

    test('an unsupported dose version fails closed', () => {
        const r = auth([plan({ primarySession: { type: 'girth', tier: 'intermediate',
            dose: { ...doseFor('girth'), v: 99 } } })]);
        expect(r.ok).toBe(false);
        expect(r.detail.code).toBe('unsupported_version');
    });

    test('an unresolvable exercise title fails closed', () => {
        /* A renamed or deleted exercise. The join is on the title, exactly,
           so a rename is loud rather than silently rescued. */
        const r = todayPrescription({ now: THU, authoritative: true,
            dayPlans: [primary('girth')], titles: ['Something Else'] });
        expect(r.ok).toBe(false);
        expect(r.detail.code).toBe('title_unresolved');
    });

    test('programme provenance must agree with the current programme', () => {
        /* generatedFrom.programmeKey is stamped on every generated plan, so a
           disagreement is inconsistent authoritative data rather than a
           transition we can interpret. */
        const stamped = plan({ generatedFrom: { programmeKey: 'size', version: 1 },
            primarySession: { type: 'girth', tier: 'intermediate', dose: doseFor('girth') } });
        const same = todayPrescription({ now: THU, authoritative: true,
            dayPlans: [stamped], programmeKey: 'size' });
        expect(same.ok).toBe(true);
        expect(same.programmeKey).toBe('size');
        const differs = todayPrescription({ now: THU, authoritative: true,
            dayPlans: [stamped], programmeKey: 'lastLonger' });
        expect(differs.ok).toBe(false);
        expect(differs.reason).toBe(PRESCRIPTION_REFUSAL.PROGRAMME_MISMATCH);
        expect(differs.detail).toEqual({ stamped: 'size', current: 'lastLonger' });
    });

    test('a plan with no provenance is not evidence of a mismatch', () => {
        const r = todayPrescription({ now: THU, authoritative: true,
            dayPlans: [primary('girth')], programmeKey: 'size' });
        expect(r.ok).toBe(true);
        expect(r.programmeKey).toBeNull();
    });

    test('a plan for another date is not today\'s plan', () => {
        const r = auth([primary('length'), { date: '2026-03-13', mode: 'rest' }]);
        expect(r.primaryType).toBe('length');
    });
});

describe('the legacy cohort: the column IS the programme', () => {
    const legacy = (schedule) => todayPrescription({
        now: THU, authoritative: false, legacySchedule: schedule, dayPlans: [primary('length')],
    });

    test('a training slot is a Primary, and dated plans are ignored entirely', () => {
        const r = legacy(SIZE);
        expect(r).toEqual({
            ok: true, source: PRESCRIPTION_SOURCE.LEGACY, date: THU_KEY,
            dayKind: DAY_KIND.PRIMARY, primaryType: 'girth', planMode: null, dose: null,
        });
    });

    test('a rest slot is rest', () => {
        const w = [...SIZE]; w[THU.getDay()] = 'rest';
        expect(legacy(w).dayKind).toBe(DAY_KIND.REST);
    });

    test('an unreadable slot refuses with the reason their repair CTA knows', () => {
        for (const bad of ['mystery', '', undefined, null, 7]) {
            const w = [...SIZE]; w[THU.getDay()] = bad;
            const r = legacy(w);
            expect(r.ok, String(bad)).toBe(false);
            expect(r.reason).toBe(PRESCRIPTION_REFUSAL.SLOT_UNRESOLVED);
        }
    });

    test('planMode and dose are null, which is truthful rather than empty', () => {
        /* The column cannot express either. Reporting null says so; inventing
           'prescribed' would claim a stored mode that does not exist. */
        const r = legacy(SIZE);
        expect(r.planMode).toBeNull();
        expect(r.dose).toBeNull();
    });

    test('the known set is configurable, so a future pelvic day is reachable', () => {
        const w = [...SIZE]; w[THU.getDay()] = 'pelvic';
        expect(legacy(w).ok).toBe(false);
        const r = todayPrescription({ now: THU, authoritative: false, legacySchedule: w,
            primaryTypes: ['length', 'girth', 'stamina', 'pelvic'] });
        expect(r.dayKind).toBe(DAY_KIND.PRIMARY);
        expect(r.primaryType).toBe('pelvic');
    });
});

describe('primarySatisfied: only a Primary can be satisfied', () => {
    const mech = (d, type = 'girth') => ({ date: `${d}T19:00:00.000Z`, prescriptionDate: d, routineType: type });
    const recov = (d) => ({ date: `${d}T19:00:00.000Z`, prescriptionDate: d, routineType: 'recovery' });
    const authP = (plans) => todayPrescription({ now: THU, authoritative: true, dayPlans: plans });

    test('a mechanical session on the prescription date satisfies it', () => {
        const p = authP([primary('girth')]);
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [mech(THU_KEY)] })).toBe(true);
    });

    test('Recovery alone does not', () => {
        const p = authP([primary('girth')]);
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [recov(THU_KEY)] })).toBe(false);
    });

    test('a substitution does, because the member trained', () => {
        const p = authP([primary('girth')]);
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [mech(THU_KEY, 'length')] })).toBe(true);
    });

    test('a REST day is never satisfied, even with a session logged against it', () => {
        /* Which is what keeps COMPLETE out of the rest state. There was no
           Primary to satisfy, so there is nothing for the session to have
           completed. */
        const p = authP([plan({ mode: 'rest' })]);
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [mech(THU_KEY)] })).toBe(false);
    });

    test('a SUPPORT ONLY day is never satisfied either', () => {
        const p = authP([plan({ supportingWork: [{ type: 'mobility', title: 'Hips' }] })]);
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [mech(THU_KEY)] })).toBe(false);
    });

    test('a refused prescription is never satisfied', () => {
        for (const plans of [[], [{ date: THU_KEY, mode: 'nope' }]]) {
            const p = authP(plans);
            expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [mech(THU_KEY)] })).toBe(false);
        }
    });

    test('THE MIDNIGHT CASE: a session finished after midnight still satisfies its own day', () => {
        const p = authP([primary('girth')]);
        const afterMidnight = { date: '2026-03-13T00:10:00.000Z',
                                prescriptionDate: THU_KEY, routineType: 'girth' };
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [afterMidnight] })).toBe(true);
    });

    test('and an unprovable identity does NOT satisfy, same day or not', () => {
        const p = authP([primary('girth')]);
        const sameDay = { date: `${THU_KEY}T20:00:00.000Z`, prescriptionDate: null, routineType: 'girth' };
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [sameDay] })).toBe(false);
    });

    test('a pre-3C.4 entry still satisfies through the historical fallback', () => {
        /* Upgrade safety. These entries have no prescriptionDate and there
           are years of them.

           The timestamp is DERIVED from the clock rather than hand written,
           which matters at the extremes. A pre-3C.4 completion stored
           new Date().toISOString(), so its date part is a UTC date, and the
           fallback compares against the same UTC-shifted relationship those
           records were written under. At UTC+14 that is the previous
           calendar day, so a hard-coded '2026-03-12T19:00Z' lines up near
           UTC and nowhere near the date line. Deriving it keeps the test
           about the fallback instead of about the host timezone. The shift
           itself is the carried _dayKey() debt and is not repaired here. */
        const p = authP([primary('girth')]);
        const old = { date: THU.toISOString(), routineType: 'girth' };
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [old] })).toBe(true);
    });

    test('the legacy cohort keeps the seven-boolean answer, untouched', () => {
        const p = todayPrescription({ now: THU, authoritative: false, legacySchedule: SIZE });
        const done = [false, false, false, false, true, false, false];   // index 4, Thursday
        expect(primarySatisfied({ prescription: p, now: THU, completedDays: done })).toBe(true);
        expect(primarySatisfied({ prescription: p, now: THU, completedDays: [] })).toBe(false);
        /* And their answer does NOT come from the log, so a dated entry
           cannot satisfy them and nothing about their model is redesigned. */
        expect(primarySatisfied({ prescription: p, now: THU, sessionLog: [mech(THU_KEY)] })).toBe(false);
    });

    test('a legacy REST day is not satisfied by the tick either', () => {
        /* The second recorded legacy-visible change of this phase: COMPLETE
           now requires a Primary, so a ticked rest day reads REST. */
        const w = [...SIZE]; w[THU.getDay()] = 'rest';
        const p = todayPrescription({ now: THU, authoritative: false, legacySchedule: w });
        const done = [true, true, true, true, true, true, true];
        expect(primarySatisfied({ prescription: p, now: THU, completedDays: done })).toBe(false);
    });

    test('a missing clock cannot satisfy anything', () => {
        const p = authP([primary('girth')]);
        expect(primarySatisfied({ prescription: p, sessionLog: [mech(THU_KEY)] })).toBe(false);
    });
});

describe('zero-target and no-Primary weeks', () => {
    test('an all-rest authoritative week has no Primary on any day', () => {
        for (let d = 9; d <= 15; d++) {
            const key = `2026-03-${String(d).padStart(2, '0')}`;
            const r = todayPrescription({ now: at(2026, 2, d), authoritative: true,
                dayPlans: [{ date: key, mode: 'rest' }] });
            expect(r.dayKind, key).toBe(DAY_KIND.REST);
            expect(primarySatisfied({ prescription: r, now: at(2026, 2, d),
                sessionLog: [{ date: `${key}T19:00:00Z`, prescriptionDate: key, routineType: 'girth' }] }))
                .toBe(false);
        }
    });

    test('an all-rest legacy week is the same answer', () => {
        const allRest = new Array(7).fill('rest');
        const r = todayPrescription({ now: THU, authoritative: false, legacySchedule: allRest });
        expect(r.dayKind).toBe(DAY_KIND.REST);
        expect(primarySatisfied({ prescription: r, now: THU,
            completedDays: new Array(7).fill(true) })).toBe(false);
    });

    test('a support-only week never reaches a satisfied Primary', () => {
        const r = todayPrescription({ now: THU, authoritative: true,
            dayPlans: [plan({ supportingWork: [{ type: 'mobility', title: 'Hips' }] })] });
        expect(r.dayKind).toBe(DAY_KIND.SUPPORT_ONLY);
        expect(primarySatisfied({ prescription: r, now: THU,
            sessionLog: [{ date: `${THU_KEY}T19:00:00Z`, prescriptionDate: THU_KEY, routineType: 'girth' }] }))
            .toBe(false);
    });
});

describe('the launch snapshot', () => {
    test('a Primary is captured as its type', () => {
        const p = todayPrescription({ now: THU, authoritative: true, dayPlans: [primary('girth')] });
        const s = launchSnapshotFrom(p, THU);
        /* The 3C.4 identity fields are unchanged; 3C.5 adds the execution
           half, which is null here because no execution candidate was passed. */
        expect(s).toMatchObject({ source: 'dated-plan', prescriptionDate: THU_KEY,
                                  scheduledType: 'girth', capturedAt: THU.toISOString(),
                                  performedType: 'girth', planMode: 'prescribed',
                                  prescribedDose: null, executionDose: null,
                                  appliedModifiers: [], doseVersion: null });
        expect(Object.isFrozen(s)).toBe(true);
    });

    test('a REST day is captured too, as rest', () => {
        /* The prescription is perfectly well known on a rest day, and a
           member who launches Recovery anyway has departed from it.
           Discarding the identity would record that departure as compliance
           with nothing. */
        const p = todayPrescription({ now: THU, authoritative: true, dayPlans: [plan({ mode: 'rest' })] });
        expect(launchSnapshotFrom(p, THU).scheduledType).toBe('rest');
    });

    test('a support-only day captures nothing, because there is no word for it', () => {
        const p = todayPrescription({ now: THU, authoritative: true,
            dayPlans: [plan({ supportingWork: [{ type: 'mobility', title: 'Hips' }] })] });
        expect(launchSnapshotFrom(p, THU)).toBeNull();
    });

    test('a refusal captures nothing', () => {
        const p = todayPrescription({ now: THU, authoritative: true, dayPlans: [] });
        expect(launchSnapshotFrom(p, THU)).toBeNull();
    });

    test('a legacy member is captured with their own source', () => {
        const p = todayPrescription({ now: THU, authoritative: false, legacySchedule: SIZE });
        expect(launchSnapshotFrom(p, THU)).toMatchObject({ source: 'legacy', scheduledType: 'girth' });
    });
});

describe('reading a stored snapshot back', () => {
    const good = { source: 'dated-plan', prescriptionDate: THU_KEY, scheduledType: 'girth' };

    test('a valid snapshot restores exactly, and frozen', () => {
        const r = normaliseLaunchSnapshot(good);
        expect(r.ok).toBe(true);
        expect(r.value).toMatchObject({ ...good, capturedAt: null });
        /* No frozen dose in this fixture, so it resumes on the documented
           pre-3C.5 compatibility path rather than claiming one. */
        expect(r.value.executionDose).toBeNull();
        expect(Object.isFrozen(r.value)).toBe(true);
    });

    test('THREE answers: absent, unknown and malformed are all different', () => {
        /* These were two in the first draft of this phase, with null folded
           into ABSENT on the grounds that null is our own write. That was
           wrong, and in exactly the direction that costs a member something:
           ABSENT is the only reason allowed to use the pre-3C.4
           compatibility path, so folding null into it would have let the
           strict attribution rule be bypassed, while folding ABSENT into
           null took programme credit away from a session that happened to be
           in flight across the upgrade.

           no key   historical absence. May fall back.
           null     a deliberate 3C.4 statement. Strict, and not an integrity
                    failure, so it is not reported.
           invalid  evidence of a bad write. Strict, and reported. */
        expect(normaliseLaunchSnapshot(undefined).reason).toBe(SNAPSHOT_REFUSAL.ABSENT);
        expect(normaliseLaunchSnapshot(null).reason).toBe(SNAPSHOT_REFUSAL.UNKNOWN);
        expect(normaliseLaunchSnapshot({}).reason).toBe(SNAPSHOT_REFUSAL.MALFORMED);
        const all = [SNAPSHOT_REFUSAL.ABSENT, SNAPSHOT_REFUSAL.UNKNOWN, SNAPSHOT_REFUSAL.MALFORMED];
        expect(new Set(all).size).toBe(3);
    });

    test('neither UNKNOWN nor MALFORMED may be mistaken for ABSENT', () => {
        /* The guard on the compatibility door. Only ABSENT opens it. */
        for (const raw of [null, {}, 'x', 7, [], { source: 'legacy' }]) {
            expect(normaliseLaunchSnapshot(raw).reason, JSON.stringify(raw) ?? String(raw))
                .not.toBe(SNAPSHOT_REFUSAL.ABSENT);
        }
    });

    const MALFORMED = [
        ['empty object', {}],
        ['partial', { source: 'dated-plan' }],
        ['missing date', { source: 'legacy', scheduledType: 'girth' }],
        ['missing type', { source: 'legacy', prescriptionDate: THU_KEY }],
        ['bad source', { source: 'projection', prescriptionDate: THU_KEY, scheduledType: 'girth' }],
        ['source whitespace', { source: 'legacy ', prescriptionDate: THU_KEY, scheduledType: 'girth' }],
        ['bad type', { source: 'legacy', prescriptionDate: THU_KEY, scheduledType: 'recovery' }],
        ['loose date', { source: 'legacy', prescriptionDate: '2026-3-12', scheduledType: 'girth' }],
        ['impossible date', { source: 'legacy', prescriptionDate: '2026-02-31', scheduledType: 'girth' }],
        ['timestamp not key', { source: 'legacy', prescriptionDate: '2026-03-12T00:00:00Z', scheduledType: 'girth' }],
        ['a string', 'girth'],
        ['a number', 7],
        ['a boolean', true],
        ['an array', []],
        ['a Date', new Date()],
    ];

    test.each(MALFORMED)('%s is MALFORMED, never demoted to absent', (_label, raw) => {
        const r = normaliseLaunchSnapshot(raw);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(SNAPSHOT_REFUSAL.MALFORMED);
    });

    test('malformed and unknown are different answers, deliberately', () => {
        /* Both are strict, so they agree about attribution, and they differ
           about whether anybody should be told: a null is our own correct
           write and a malformed value is evidence something wrote badly. */
        expect(normaliseLaunchSnapshot({}).reason)
            .not.toBe(normaliseLaunchSnapshot(null).reason);
    });

    test('nothing is coerced or partially repaired', () => {
        const r = normaliseLaunchSnapshot({ source: 'legacy', prescriptionDate: '2026-3-12',
                                            scheduledType: 'girth' });
        expect(r.value).toBeUndefined();
    });

    test('a rest snapshot round trips, and a wider vocabulary is accepted on request', () => {
        expect(normaliseLaunchSnapshot({ ...good, scheduledType: 'rest' }).ok).toBe(true);
        expect(normaliseLaunchSnapshot({ ...good, scheduledType: 'pelvic' }).ok).toBe(false);
        expect(normaliseLaunchSnapshot({ ...good, scheduledType: 'pelvic' },
            { primaryTypes: ['pelvic'] }).ok).toBe(true);
    });
});

describe('it is pure', () => {
    test('inputs come back untouched', () => {
        const plans = [primary('girth')];
        const sched = [...SIZE];
        const log = [{ date: `${THU_KEY}T19:00:00Z`, prescriptionDate: THU_KEY, routineType: 'girth' }];
        const snap = JSON.stringify({ plans, sched, log });
        const p = todayPrescription({ now: THU, authoritative: true, dayPlans: plans, legacySchedule: sched });
        primarySatisfied({ prescription: p, now: THU, sessionLog: log });
        launchSnapshotFrom(p, THU);
        expect(JSON.stringify({ plans, sched, log })).toBe(snap);
    });

    test('junk cannot throw', () => {
        for (const junk of [null, 7, 'x', [], true]) {
            expect(() => todayPrescription(junk)).not.toThrow();
            expect(() => primarySatisfied(junk)).not.toThrow();
            expect(() => launchSnapshotFrom(junk, THU)).not.toThrow();
            expect(() => normaliseLaunchSnapshot(junk)).not.toThrow();
        }
    });
});

/**
 * THE DATE RULE, confirmed rather than assumed.
 *
 * A prescription identity is a LOCAL calendar day: the day the member lived
 * through, which is the identity a day plan carries. At UTC+14 local noon is
 * 22:00 UTC the previous day, so anything formatting through toISOString()
 * names yesterday, and a prescription read one day early would silently be
 * the wrong prescription.
 *
 * The seam is recorded: a pre-3C.4 log entry has only its completion
 * timestamp, whose date part is a UTC date, and the fallback keeps that
 * relationship because it is the one those records were written under.
 * Unifying the two is the carried _dayKey() debt and is out of scope here.
 *
 * Subprocess per zone, because TZ is read once per process.
 */
describe('prescription identity is a local calendar day', () => {
    const probe = (tz, dateArgs) => {
        const script = `
            import { todayPrescription, primarySatisfied, launchSnapshotFrom }
                from '${process.cwd()}/src/todayPrescription.js';
            const now = new Date(${dateArgs});
            const plans = [{ date: '2026-03-12', mode: 'prescribed',
                             primarySession: { type: 'girth', title: 'Girth', tier: 'intermediate',
                                 dose: { v: 1, shape: 'circuit', tier: 'intermediate', rounds: 4,
                                         restDur: 45,
                                         stations: [{ title: 'Wet Jelq', duration: 120 }] } } }];
            const p = todayPrescription({ now, authoritative: true, dayPlans: plans });
            console.log(JSON.stringify({
                localDay: now.getDate(),
                utcIso: now.toISOString().split('T')[0],
                date: p.date, ok: p.ok, type: p.primaryType,
                snapDate: (launchSnapshotFrom(p, now) || {}).prescriptionDate || null,
                satisfiedByDated: primarySatisfied({ prescription: p, now, sessionLog: [
                    { date: '2026-03-12T23:00:00.000Z', prescriptionDate: '2026-03-12', routineType: 'girth' }] }),
            }));
        `;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
            { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
        return JSON.parse(out.trim().split('\n').pop());
    };

    test('UTC+14: the plan is found on the local Thursday, not the UTC Wednesday', () => {
        const r = probe('Pacific/Kiritimati', '2026, 2, 12, 12');
        expect(r.localDay).toBe(12);
        expect(r.utcIso).toBe('2026-03-11');          // the shift, demonstrated
        expect(r.date).toBe('2026-03-12');            // the corrected identity
        expect(r.ok).toBe(true);
        expect(r.type).toBe('girth');
        expect(r.snapDate).toBe('2026-03-12');
        expect(r.satisfiedByDated).toBe(true);
    });

    test('UTC-11: the same, in the other direction', () => {
        const r = probe('Pacific/Niue', '2026, 2, 12, 12');
        expect(r.localDay).toBe(12);
        expect(r.date).toBe('2026-03-12');
        expect(r.satisfiedByDated).toBe(true);
    });

    test('a spring-forward day does not shift the identity', () => {
        const r = probe('America/New_York', '2026, 2, 12, 12');
        expect(r.date).toBe('2026-03-12');
        expect(r.satisfiedByDated).toBe(true);
    });
});
