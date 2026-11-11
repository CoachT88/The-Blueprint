import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    SLOT_CLASS, LEGACY_PRIMARY_TYPES, LEGACY_REST, PROJECTION_REFUSAL,
    classifySlot, isScheduledPrimary, isRestSlot, isUnresolvedSlot,
    countScheduledPrimary, toLegacySlot, toLegacySchedule,
    LEGACY_SUPPORT, LEGACY_FULL_REST, NON_TRAINING_TYPES, SUPPORT_TYPES,
    isSupportSlot, isFullRestSlot, classifyDayPlan,
} from '../src/scheduleSlot.js';
import { weekCompletion } from '../src/weekCompletion.js';
import { reconcileLedger, normaliseLedger, WEEK_VERDICT } from '../src/progressionLedger.js';
import { nextBestAction, SCHEDULE_UNRESOLVED } from '../src/nextBestAction.js';
import { todayPrescription } from '../src/todayPrescription.js';

/**
 * One meaning for one slot.
 *
 * Three places used to decide independently whether a slot was scheduled
 * training, and they disagreed about the value that matters: one nobody can
 * interpret. Two counted it because it was truthy and not 'rest'; the
 * resolver refused to prescribe from it. So a member could be judged against
 * a session the app would not offer him.
 */

describe('classifySlot', () => {
    test.each(LEGACY_PRIMARY_TYPES)('%s is primary', (t) => {
        expect(classifySlot(t)).toBe(SLOT_CLASS.PRIMARY);
        expect(isScheduledPrimary(t)).toBe(true);
    });

    test('rest is rest', () => {
        expect(classifySlot(LEGACY_REST)).toBe(SLOT_CLASS.REST);
        expect(isRestSlot('rest')).toBe(true);
        expect(isScheduledPrimary('rest')).toBe(false);
    });

    test.each([
        ['an unknown type', 'mystery'], ['recovery, which is a routine not a day type', 'recovery'],
        ['the empty string', ''], ['whitespace', ' '], ['a number', 3],
        ['null', null], ['undefined', undefined], ['an object', {}], ['an array', []],
        ['a case variant', 'Length'], ['a padded value', ' length '],
    ])('%s is unresolved, not primary and not rest', (_l, v) => {
        expect(classifySlot(v)).toBe(SLOT_CLASS.UNRESOLVED);
        expect(isScheduledPrimary(v)).toBe(false);
        expect(isRestSlot(v)).toBe(false);
        expect(isUnresolvedSlot(v)).toBe(true);
    });

    test('membership of the known set is the rule, not truthiness', () => {
        // The old predicate. Kept here as the thing this module replaced.
        const oldRule = (t) => typeof t === 'string' && t !== '' && t !== 'rest';
        expect(oldRule('mystery')).toBe(true);
        expect(isScheduledPrimary('mystery')).toBe(false);
    });

    test('the vocabulary can be widened at the call site', () => {
        const opts = { primaryTypes: [...LEGACY_PRIMARY_TYPES, 'pelvic'] };
        expect(classifySlot('pelvic', opts)).toBe(SLOT_CLASS.PRIMARY);
        expect(classifySlot('pelvic')).toBe(SLOT_CLASS.UNRESOLVED);
    });

    test('rest wins even if a vocabulary wrongly lists it as primary', () => {
        // A rest day must never become training through a configuration slip.
        expect(classifySlot('rest', { primaryTypes: ['rest', 'length'] })).toBe(SLOT_CLASS.REST);
    });
});

describe('countScheduledPrimary', () => {
    test('counts only resolvable primary work', () => {
        expect(countScheduledPrimary(['length', 'rest', 'mystery', 'girth', '', null])).toBe(2);
    });
    test('a non-array is zero, not a throw', () => {
        for (const junk of [null, undefined, 'length', 7, {}]) {
            expect(countScheduledPrimary(junk)).toBe(0);
        }
    });
});

// ── the three call sites now agree ───────────────────────────────────────

describe('one rule across all three consumers', () => {
    const SCHED = ['mystery', 'length', 'rest', 'rest', 'rest', 'rest', 'rest'];

    test('weekCompletion no longer counts an unresolved slot', () => {
        expect(weekCompletion(SCHED, [true, false, false, false, false, false, false]).target).toBe(1);
    });

    test('the ledger live target no longer counts an unresolved slot', () => {
        const now = new Date('2026-10-07T12:00:00Z');
        const out = reconcileLedger([], {
            weekKey: '2026_w41', schedule: SCHED,
            sessionLog: [{ date: '2026-10-05T12:00:00Z', routineType: 'length' }], now,
        });
        const live = out.find(r => r.weekKey === '2026_w41');
        expect(live.targetSessions).toBe(1);        // not 2
    });

    test('the resolver still calls an unresolved slot unresolved', () => {
        /* Phase 3C.4: the resolver no longer indexes a seven-slot array, so
           the slot is interpreted by the adapter and handed over as one
           prescription. The point of the test is unchanged and is in fact
           stronger: the same unreadable value still has to travel all the way
           to the same PREPARE reason, through one more boundary than before.

           The adapter is driven for a LEGACY member, because that is the only
           cohort whose prescription a seven-slot column still is. */
        const now = new Date('2026-10-04T12:00:00Z');                  // Sunday, index 0
        const prescription = todayPrescription({ now, authoritative: false, legacySchedule: SCHED });
        expect(prescription.ok).toBe(false);
        const r = nextBestAction({
            dataLoaded: true, now,
            goals: { all: { label: 'All' } }, goalKey: 'all',
            todayPrescription: prescription, primarySatisfied: false,
        });
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe(SCHEDULE_UNRESOLVED);
    });

    test('all three give the same answer for the same slot', () => {
        for (const v of ['mystery', '', 'recovery', 'Length']) {
            expect(isScheduledPrimary(v)).toBe(false);
            expect(weekCompletion([v], [false]).target).toBe(0);
            expect(countScheduledPrimary([v])).toBe(0);
        }
    });
});

// ── the historical rule, which is the thing most likely to break ─────────

describe('stored historical targets are never recomputed', () => {
    test('a retained past row keeps the target that was true at the time', () => {
        /* The row was recorded when the member had a four-session week, one
           slot of which this build can no longer read. The new predicate must
           not reach backwards and re-judge it. */
        const past = [{ weekKey: '2026_w38', targetSessions: 4, qualifyingSessions: 4,
                        verdict: WEEK_VERDICT.QUALIFIED }];
        const after = normaliseLedger(past);
        expect(after[0].targetSessions).toBe(4);
        expect(after[0].verdict).toBe(WEEK_VERDICT.QUALIFIED);
    });

    test('reconciling with a schedule full of unreadable slots leaves history alone', () => {
        const past = [{ weekKey: '2026_w38', targetSessions: 4, qualifyingSessions: 3,
                        verdict: WEEK_VERDICT.QUALIFIED }];
        const before = JSON.stringify(past[0]);
        const out = reconcileLedger(past, {
            weekKey: '2026_w41', schedule: ['mystery', 'mystery', 'mystery', 'rest', 'rest', 'rest', 'rest'],
            sessionLog: [{ date: '2026-09-15T12:00:00Z', routineType: 'length' }],
            now: new Date('2026-10-07T12:00:00Z'),
        });
        const kept = out.find(r => r.weekKey === '2026_w38');
        expect(JSON.stringify({ weekKey: kept.weekKey, targetSessions: kept.targetSessions,
                                qualifyingSessions: kept.qualifyingSessions, verdict: kept.verdict }))
            .toBe(before);
        // and the live week reflects the new rule
        expect(out.find(r => r.weekKey === '2026_w41').targetSessions).toBe(0);
    });
});

// ── the projection, and what it refuses ─────────────────────────────────

describe('toLegacySlot', () => {
    const p = (over) => ({ date: '2026-10-05', mode: 'prescribed', primarySession: null,
                           supportingWork: [], dailyPractice: [], ...over });

    test('a primary session projects to its type', () => {
        expect(toLegacySlot(p({ primarySession: { type: 'length' } })))
            .toEqual({ ok: true, slot: 'length' });
    });

    test('a rest day projects to rest', () => {
        expect(toLegacySlot(p({ mode: 'rest' }))).toEqual({ ok: true, slot: 'rest' });
    });

    test('a support-only day is REFUSED, not turned into rest', () => {
        /* The decisive case. 'rest' would suppress a notification for a day
           that has work; a mechanical type would claim primary training that
           was not prescribed; a new sentinel would widen a vocabulary other
           consumers also read. So it is refused and named. */
        const r = toLegacySlot(p({ supportingWork: [{ type: 'pelvicRelaxation' }] }));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(PROJECTION_REFUSAL.SUPPORT_ONLY);
        expect(r.slot).toBeUndefined();
    });

    test('a primary type outside the legacy vocabulary is refused', () => {
        // It would survive one save and then be repaired away by
        // normaliseSchedule, rendering as unknown in the meantime.
        const r = toLegacySlot(p({ primarySession: { type: 'stopAndRecover' } }));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(PROJECTION_REFUSAL.UNKNOWN_TYPE);
        expect(r.detail).toBe('stopAndRecover');
    });

    test('the projection vocabulary is CLOSED and cannot be widened by a caller', () => {
        /* classifySlot takes an explicit known set, because the resolver
           passes its own missions and a future programme will widen what
           counts as training. The projection takes no options at all: the
           persisted vocabulary is a contract, and a caller must not be able
           to reintroduce through configuration the sentinel we rejected. */
        expect(toLegacySlot.length).toBe(1);                 // (plan) only
        expect(toLegacySchedule.length).toBe(2);             // (plans, weekOf) only
        for (const opts of [{ primaryTypes: [...LEGACY_PRIMARY_TYPES, 'pelvic'] },
                            { primaryTypes: ['support'] }]) {
            const r = toLegacySlot(p({ primarySession: { type: 'pelvic' } }), opts);
            expect(r.ok).toBe(false);
            expect(r.reason).toBe(PROJECTION_REFUSAL.UNKNOWN_TYPE);
        }
    });

    test('junk is refused rather than throwing', () => {
        for (const junk of [null, undefined, 'x', 7, []]) {
            expect(toLegacySlot(junk)).toEqual({ ok: false, reason: PROJECTION_REFUSAL.NOT_A_PLAN });
        }
    });

    test('there is no support sentinel anywhere in the vocabulary', () => {
        expect(LEGACY_PRIMARY_TYPES).toEqual(['length', 'girth', 'stamina']);
        expect(LEGACY_PRIMARY_TYPES).not.toContain('support');
    });
});

describe('toLegacySchedule is all or nothing', () => {
    const weekOf = new Date('2026-10-07T12:00:00Z');   // Wednesday of ISO week 41
    const day = (date, over) => ({ date, mode: 'prescribed', primarySession: null,
                                   supportingWork: [], dailyPractice: [], ...over });
    /* ISO week of 2026-10-07 runs Mon 10-05 to Sun 10-11. */
    const fullWeek = (over = {}) => [
        day('2026-10-05', over['2026-10-05'] || { primarySession: { type: 'length' } }),
        day('2026-10-06', over['2026-10-06'] || { mode: 'rest' }),
        day('2026-10-07', over['2026-10-07'] || { primarySession: { type: 'girth' } }),
        day('2026-10-08', over['2026-10-08'] || { mode: 'rest' }),
        day('2026-10-09', over['2026-10-09'] || { primarySession: { type: 'stamina' } }),
        day('2026-10-10', over['2026-10-10'] || { mode: 'rest' }),
        day('2026-10-11', over['2026-10-11'] || { mode: 'rest' }),
    ];

    test('a fully representable week returns ok with exactly 7 slots', () => {
        const r = toLegacySchedule(fullWeek(), weekOf);
        expect(r.ok).toBe(true);
        expect(r.slots).toHaveLength(7);
        expect(r.unrepresentable).toBeUndefined();
    });

    test('slots are Sunday-indexed, matching the external contract', () => {
        const r = toLegacySchedule(fullWeek(), weekOf);
        expect(r.slots[1]).toBe('length');      // Monday  10-05
        expect(r.slots[3]).toBe('girth');       // Wednesday 10-07
        expect(r.slots[0]).toBe('rest');        // Sunday  10-11, the LAST ISO day
    });

    test('every slot holds a value from the closed legacy vocabulary', () => {
        const r = toLegacySchedule(fullWeek(), weekOf);
        const allowed = new Set([...LEGACY_PRIMARY_TYPES, LEGACY_REST]);
        for (const slot of r.slots) expect(allowed.has(slot)).toBe(true);
    });

    test('ONE support-only day refuses the WHOLE week, with no slots key', () => {
        /* The correction that matters. An earlier version returned a
           7-element array with holes left as null beside a list of what was
           missing, which reads like a valid projection and would be written
           by any caller that forgot to check. The legacy column is a
           persisted contract, so persisting an invalid one has to be
           impossible rather than merely inadvisable. */
        const r = toLegacySchedule(
            fullWeek({ '2026-10-06': { supportingWork: [{ type: 'mobility' }] } }), weekOf);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('unrepresentable_days');
        expect(r).not.toHaveProperty('slots');          // nothing writable escapes
        expect(r.unrepresentable).toEqual([
            { index: 2, date: '2026-10-06', reason: PROJECTION_REFUSAL.SUPPORT_ONLY },
        ]);
    });

    test('a primary type outside the vocabulary refuses the week and names the type', () => {
        const r = toLegacySchedule(
            fullWeek({ '2026-10-09': { primarySession: { type: 'stopAndRecover' } } }), weekOf);
        expect(r.ok).toBe(false);
        expect(r).not.toHaveProperty('slots');
        expect(r.unrepresentable[0]).toMatchObject({
            index: 5, date: '2026-10-09',
            reason: PROJECTION_REFUSAL.UNKNOWN_TYPE, detail: 'stopAndRecover',
        });
    });

    test('a missing day refuses the week and names the date', () => {
        const partial = fullWeek().filter(p => p.date !== '2026-10-08');
        const r = toLegacySchedule(partial, weekOf);
        expect(r.ok).toBe(false);
        expect(r).not.toHaveProperty('slots');
        expect(r.unrepresentable).toEqual([
            { index: 4, date: '2026-10-08', reason: PROJECTION_REFUSAL.NO_PLAN },
        ]);
    });

    test('every unrepresentable day is reported, not just the first', () => {
        const r = toLegacySchedule([day('2026-10-05', { primarySession: { type: 'length' } })], weekOf);
        expect(r.ok).toBe(false);
        expect(r.unrepresentable).toHaveLength(6);
        expect(r.unrepresentable.every(u => u.reason === PROJECTION_REFUSAL.NO_PLAN)).toBe(true);
    });

    test.each([['null', null], ['undefined', undefined], ['a string', 'x'],
               ['a number', 7], ['an object', {}]])
    ('%s as plans refuses rather than throwing', (_l, plans) => {
        const r = toLegacySchedule(plans, weekOf);
        expect(r.ok).toBe(false);
        expect(r).not.toHaveProperty('slots');
    });

    test('the projection does not mutate its input', () => {
        const plans = fullWeek();
        const before = JSON.stringify(plans);
        toLegacySchedule(plans, weekOf);
        expect(JSON.stringify(plans)).toBe(before);
    });
});

describe('purity', () => {
    test('scheduleSlot reads no clock of its own and has no policy dependency', () => {
        const src = readFileSync(new URL('../src/scheduleSlot.js', import.meta.url), 'utf8');
        expect(src).not.toMatch(/Date\.now/);
        expect(src).not.toMatch(/PROGRESSION_POLICY/);
        const imports = src.match(/^import .*$/gm) || [];
        /* The LOCAL sibling: a plan's date is the day the member lived
           through, and the projection has to look it up by the same identity
           the generator wrote. Still exactly one import, still nothing
           policy-shaped. */
        expect(imports).toEqual(["import { localDateKeyForWeekday } from './weekUtils.js';"]);
    });
});


/**
 * #186 PHASE 2: A SUPPORT DAY IS A KIND OF DAY, NOT A FAILURE TO READ ONE.
 *
 * classifySlot sent 'support' to UNRESOLVED, which means "the app cannot say
 * what today is". That is the right answer for a corrupt record and the wrong
 * one for a day the programme described perfectly well, and every consumer
 * branching on UNRESOLVED inherited the mistake.
 *
 * What must NOT change, and is pinned below: an unreadable value is still
 * UNRESOLVED, support still never counts as mechanical training, and the
 * legacy projection still refuses a support-only day.
 */
describe('#186 phase 2: the support slot', () => {
    test('support classifies as support, and is not training, rest or unknown', () => {
        expect(classifySlot(LEGACY_SUPPORT)).toBe(SLOT_CLASS.SUPPORT);
        expect(isSupportSlot(LEGACY_SUPPORT)).toBe(true);
        expect(isScheduledPrimary(LEGACY_SUPPORT)).toBe(false);
        expect(isRestSlot(LEGACY_SUPPORT)).toBe(false);
        expect(isUnresolvedSlot(LEGACY_SUPPORT)).toBe(false);
    });

    test('A SUPPORT DAY IS NEVER IN THE MECHANICAL DENOMINATOR', () => {
        /* The single most important property of the whole phase. Supporting
           work must not earn mechanical credit, so it cannot enter the weekly
           target either: a target it inflated would be a commitment the
           member is judged against for work that cannot satisfy it. */
        const week = ['length', LEGACY_SUPPORT, LEGACY_SUPPORT, 'rest',
                      'girth', LEGACY_SUPPORT, 'rest'];
        expect(countScheduledPrimary(week)).toBe(2);
        const r = weekCompletion(week, Array(7).fill(true), { now: new Date('2026-03-18T12:00:00Z') });
        expect(r.target).toBe(2);
        expect(r.satisfied[1]).toBe(false);
        expect(r.satisfied[2]).toBe(false);
        expect(r.satisfied[5]).toBe(false);
    });

    test('full-rest classifies as rest, so every existing consumer is right about it', () => {
        /* Deliberately the SAME class as 'rest'. Not training, not a
           commitment, not a gap in the week: that is what every current
           consumer already does with a rest day and all of it is correct for
           a full-rest day too. */
        expect(classifySlot(LEGACY_FULL_REST)).toBe(SLOT_CLASS.REST);
        expect(isRestSlot(LEGACY_FULL_REST)).toBe(true);
        expect(isScheduledPrimary(LEGACY_FULL_REST)).toBe(false);
        expect(countScheduledPrimary(Array(7).fill(LEGACY_FULL_REST))).toBe(0);
    });

    test('but the two rests stay distinguishable where the difference matters', () => {
        /* A 'rest' day still asks for the daily practice; a 'full-rest' day
           asks for nothing. The counting does not care and the Today card
           does, so the distinction lives in its own predicate rather than in
           a class every consumer would have to learn. */
        expect(isFullRestSlot(LEGACY_FULL_REST)).toBe(true);
        expect(isFullRestSlot(LEGACY_REST)).toBe(false);
        expect(NON_TRAINING_TYPES).toEqual([LEGACY_REST, LEGACY_FULL_REST]);
        expect(SUPPORT_TYPES).toEqual([LEGACY_SUPPORT]);
        expect(Object.isFrozen(NON_TRAINING_TYPES)).toBe(true);
        expect(Object.isFrozen(SUPPORT_TYPES)).toBe(true);
    });

    test('UNRESOLVED STILL MEANS UNREADABLE, which is what was being protected', () => {
        for (const v of ['mystery', '', '  ', 'Support', 'SUPPORT', 'full rest',
                         'fullrest', 'recovery', null, undefined, 0, 7, {}, []]) {
            expect(classifySlot(v), JSON.stringify(v)).toBe(SLOT_CLASS.UNRESOLVED);
            expect(isScheduledPrimary(v), JSON.stringify(v)).toBe(false);
        }
    });

    test('a caller may still widen the vocabulary, and support is checked before primary', () => {
        /* Of the two ways a mistake can go, reading training as support
           understates the day and reading support as training prescribes
           manual work nobody assigned. A vocabulary that listed 'support' as
           a primary type still cannot make it training. */
        expect(classifySlot('support', { primaryTypes: ['support'] })).toBe(SLOT_CLASS.SUPPORT);
        expect(classifySlot('rest', { primaryTypes: ['rest'] })).toBe(SLOT_CLASS.REST);
        expect(classifySlot('move', { supportTypes: ['move'] })).toBe(SLOT_CLASS.SUPPORT);
    });
});

describe('#186 phase 2: classifyDayPlan is the one place a plan is read', () => {
    const base = { date: '2026-03-19', status: 'pending', supportingWork: [], dailyPractice: [] };
    const SUPPORT_ITEM = { type: 'pelvicFloor', category: 'strength' };

    test('a mechanical primary gives its own type, mixed or not', () => {
        const solo = classifyDayPlan({ ...base, mode: 'prescribed',
            primarySession: { type: 'length', tier: 'intermediate' } });
        expect(solo).toMatchObject({ class: SLOT_CLASS.PRIMARY, slot: 'length', mixed: false });

        /* ALL OF IT. Primary plus support on one date needs no slot value of
           its own: the day is a Length day that also carries support. */
        const mixed = classifyDayPlan({ ...base, mode: 'prescribed',
            primarySession: { type: 'length', tier: 'intermediate' },
            supportingWork: [SUPPORT_ITEM] });
        expect(mixed).toMatchObject({ class: SLOT_CLASS.PRIMARY, slot: 'length', mixed: true });
    });

    test('no primary plus real supporting work is a support day', () => {
        expect(classifyDayPlan({ ...base, mode: 'prescribed', primarySession: null,
            supportingWork: [SUPPORT_ITEM] }))
            .toMatchObject({ class: SLOT_CLASS.SUPPORT, slot: LEGACY_SUPPORT });
    });

    test('EVERY REST PLAN IS rest, AND FULL REST IS NOT INFERRED FROM AN ABSENCE', () => {
        /* I had this the other way round first: no daily practice meant
           genuine full rest. An empty dailyPractice also happens when
           buildPelvicPracticePlan returns mode 'paused' with no steps, which
           is what an unresolved PAIN REPORT produces. The rule would have
           relabelled a member's rest day as full rest because he reported
           pain, turning a safety state into a programme state.

           Full rest has to be marked by the generator. Until it is, nothing
           produces one, and that is the honest answer. */
        for (const practice of [[], [{ type: 'pelvic-practice', required: true }]]) {
            expect(classifyDayPlan({ ...base, mode: 'rest', primarySession: null,
                dailyPractice: practice }).slot).toBe(LEGACY_REST);
        }
    });

    test('a prescribed day with nothing on it says nothing, rather than rest', () => {
        /* Relabelling it rest would claim a prescription nobody made, and
           rest is what suppresses the member's reminder. */
        expect(classifyDayPlan({ ...base, mode: 'prescribed', primarySession: null }))
            .toMatchObject({ class: SLOT_CLASS.UNRESOLVED, slot: undefined });
    });

    test('a non-plan is unresolved and never throws', () => {
        for (const v of [null, undefined, 'rest', 42, [], [{}]]) {
            expect(classifyDayPlan(v), JSON.stringify(v))
                .toMatchObject({ class: SLOT_CLASS.UNRESOLVED, slot: undefined });
        }
    });

    test('an out-of-vocabulary primary type is unresolved, not training', () => {
        const r = classifyDayPlan({ ...base, mode: 'prescribed',
            primarySession: { type: 'recovery', tier: 'intermediate' } });
        expect(r.class).toBe(SLOT_CLASS.UNRESOLVED);
    });

    test('AND THE LEGACY PROJECTION IS UNCHANGED, which is the migration gate', () => {
        /* toLegacySlot still refuses a support-only day. An older cached
           client runs normaliseSchedule() on every load, replacing any slot
           outside DAY_TYPES with the default for that index, so a 'support'
           value in the persisted column would be rewritten to a MECHANICAL
           type and saved. The classifier may know about support long before
           the column is allowed to hold it. */
        const supportOnly = { ...base, mode: 'prescribed', primarySession: null,
            supportingWork: [SUPPORT_ITEM] };
        expect(classifyDayPlan(supportOnly).class).toBe(SLOT_CLASS.SUPPORT);
        expect(toLegacySlot(supportOnly))
            .toEqual({ ok: false, reason: PROJECTION_REFUSAL.SUPPORT_ONLY });
        expect(toLegacySchedule([supportOnly], new Date('2026-03-18T12:00:00Z')).ok).toBe(false);
    });
});
