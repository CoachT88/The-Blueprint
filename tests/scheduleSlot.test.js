import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    SLOT_CLASS, LEGACY_PRIMARY_TYPES, LEGACY_REST, PROJECTION_REFUSAL,
    classifySlot, isScheduledPrimary, isRestSlot, isUnresolvedSlot,
    countScheduledPrimary, toLegacySlot, toLegacySchedule,
} from '../src/scheduleSlot.js';
import { weekCompletion } from '../src/weekCompletion.js';
import { reconcileLedger, normaliseLedger, WEEK_VERDICT } from '../src/progressionLedger.js';
import { nextBestAction, SCHEDULE_UNRESOLVED } from '../src/nextBestAction.js';

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
        const r = nextBestAction({
            dataLoaded: true, now: new Date('2026-10-04T12:00:00Z'),   // Sunday, index 0
            goals: { all: { label: 'All' } }, goalKey: 'all',
            schedule: SCHED, completedDays: new Array(7).fill(false),
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

    test('a widened vocabulary lets a new primary type project', () => {
        const r = toLegacySlot(p({ primarySession: { type: 'pelvic' } }),
                               { primaryTypes: [...LEGACY_PRIMARY_TYPES, 'pelvic'] });
        expect(r).toEqual({ ok: true, slot: 'pelvic' });
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

describe('toLegacySchedule', () => {
    const weekOf = new Date('2026-10-07T12:00:00Z');   // Wednesday of ISO week 41
    const day = (date, over) => ({ date, mode: 'prescribed', primarySession: null,
                                   supportingWork: [], dailyPractice: [], ...over });

    test('always exactly 7 elements, whatever the input', () => {
        for (const plans of [[], null, undefined, 'x', 7, [day('2026-10-05', {})]]) {
            expect(toLegacySchedule(plans, weekOf).slots).toHaveLength(7);
        }
    });

    test('Sunday-indexed, matching the external contract', () => {
        // ISO week of 2026-10-07 runs Mon 10-05 to Sun 10-11.
        const r = toLegacySchedule([
            day('2026-10-05', { primarySession: { type: 'length' } }),   // Monday  -> index 1
            day('2026-10-11', { primarySession: { type: 'girth' } }),    // Sunday  -> index 0
        ], weekOf);
        expect(r.slots[1]).toBe('length');
        expect(r.slots[0]).toBe('girth');
    });

    test('rest projects, and a day with no plan is a named hole', () => {
        const r = toLegacySchedule([day('2026-10-05', { mode: 'rest' })], weekOf);
        expect(r.slots[1]).toBe('rest');
        expect(r.slots[2]).toBeNull();
        expect(r.unrepresentable.map(u => u.reason)).toContain('no_plan');
        expect(r.unrepresentable).toHaveLength(6);
    });

    test('a support-only day is a hole, named with its reason, never fabricated', () => {
        const r = toLegacySchedule([
            day('2026-10-05', { supportingWork: [{ type: 'mobility' }] }),
        ], weekOf);
        expect(r.slots[1]).toBeNull();                       // not 'rest', not a type
        const u = r.unrepresentable.find(x => x.index === 1);
        expect(u).toMatchObject({ date: '2026-10-05', reason: PROJECTION_REFUSAL.SUPPORT_ONLY });
    });

    test('no slot ever holds a value outside the legacy vocabulary', () => {
        const r = toLegacySchedule([
            day('2026-10-05', { primarySession: { type: 'stopAndRecover' } }),
            day('2026-10-06', { supportingWork: [{ type: 'mobility' }] }),
            day('2026-10-07', { primarySession: { type: 'girth' } }),
        ], weekOf);
        const allowed = new Set([...LEGACY_PRIMARY_TYPES, LEGACY_REST, null]);
        for (const s of r.slots) expect(allowed.has(s)).toBe(true);
    });

    test('the projection does not mutate its input', () => {
        const plans = [day('2026-10-05', { primarySession: { type: 'length' } })];
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
        expect(src).not.toMatch(/^import/m);                 // zero dependencies
    });
});
