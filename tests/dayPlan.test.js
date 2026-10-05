import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    DAY_MODE, PLAN_STATUS, WORK_KIND, VIOLATION,
    normaliseDayPlan, normaliseDayPlans, validateDayPlan, programmeWork,
    isDateKey, cloneResolved,
} from '../src/dayPlan.js';

/**
 * The day-plan model, alone. Nothing imports it yet.
 *
 * Two rulings shape most of what is asserted here.
 *
 * Mode describes what the programme prescribed. It never describes whether
 * we could read the record, so there is no fifth mode for corrupt data: an
 * unreadable plan is refused, and the reason is kept separately.
 *
 * A dose is a resolved snapshot. Not numbers only, because four programmes
 * will need variants and identifiers and cadence, but never a pointer that
 * has to be looked up in a policy table that may since have changed.
 */

const plan = (over = {}) => ({
    date: '2026-10-05', mode: DAY_MODE.PRESCRIBED,
    primarySession: { type: 'length', tier: 'intermediate', dose: { sets: 3, duration: 30 } },
    supportingWork: [], dailyPractice: [], status: PLAN_STATUS.PENDING, ...over,
});
const codes = (raw) => validateDayPlan(raw).violations.map(v => v.code);

// ── the three valid shapes ────────────────────────────────────────────────

describe('valid day plans', () => {
    test('a prescribed day with a primary session', () => {
        const p = normaliseDayPlan(plan());
        expect(p.mode).toBe('prescribed');
        expect(p.primarySession).toMatchObject({ type: 'length', tier: 'intermediate' });
        expect(p.primarySession.dose).toEqual({ sets: 3, duration: 30 });
        expect(validateDayPlan(plan()).ok).toBe(true);
    });

    test('a support-only day has no primary session', () => {
        const p = normaliseDayPlan(plan({
            primarySession: null,
            supportingWork: [{ type: 'pelvicRelaxation', category: 'Relaxation & Coordination',
                               dose: { sets: 3 }, required: false }],
        }));
        expect(p.primarySession).toBeNull();
        expect(p.supportingWork).toHaveLength(1);
        expect(p.supportingWork[0].category).toBe('Relaxation & Coordination');
    });

    test('a rest day may still carry a daily practice', () => {
        const p = normaliseDayPlan(plan({
            mode: DAY_MODE.REST, primarySession: null,
            dailyPractice: [{ type: 'calmArousalBreathing', dose: { breaths: 10 }, required: true }],
        }));
        expect(p.mode).toBe('rest');
        expect(p.primarySession).toBeNull();
        expect(p.supportingWork).toEqual([]);
        expect(p.dailyPractice).toHaveLength(1);   // the whole point of the third type
    });
});

// ── rest withholds two of the three ───────────────────────────────────────

describe('rest means no training', () => {
    test('a primary session on a rest day is stripped and reported', () => {
        const p = normaliseDayPlan(plan({ mode: DAY_MODE.REST }));
        expect(p.primarySession).toBeNull();
        expect(codes(plan({ mode: DAY_MODE.REST }))).toContain(VIOLATION.REST_HAS_PRIMARY);
    });

    test('supporting work on a rest day is stripped and reported', () => {
        const raw = plan({ mode: DAY_MODE.REST, primarySession: null,
                           supportingWork: [{ type: 'mobility' }] });
        expect(normaliseDayPlan(raw).supportingWork).toEqual([]);
        expect(codes(raw)).toContain(VIOLATION.REST_HAS_SUPPORTING);
    });

    test('stripping a rest day does not touch its daily practice', () => {
        const p = normaliseDayPlan(plan({
            mode: DAY_MODE.REST,
            supportingWork: [{ type: 'mobility' }],
            dailyPractice: [{ type: 'calmArousalBreathing' }],
        }));
        expect(p.supportingWork).toEqual([]);
        expect(p.dailyPractice).toHaveLength(1);
    });
});

// ── ruling 1: integrity is not a programme state ──────────────────────────

describe('an unreadable plan is refused, not relabelled', () => {
    test('there is no fifth mode', () => {
        expect(Object.values(DAY_MODE)).toEqual(['prescribed', 'modified', 'protective', 'rest']);
        expect(Object.values(DAY_MODE)).not.toContain('unresolved');
    });

    test.each([
        ['an unknown mode', 'unresolved'], ['a mangled mode', 'REST'],
        ['an empty mode', ''], ['a non-string mode', 3], ['a missing mode', undefined],
    ])('%s makes the plan null', (_label, mode) => {
        expect(normaliseDayPlan(plan({ mode }))).toBeNull();
    });

    test('an invalid mode never becomes rest, and never becomes prescribed', () => {
        // The two silent failures that would matter: one cancels training the
        // programme may have asked for, the other invents training.
        const p = normaliseDayPlan(plan({ mode: 'garbage' }));
        expect(p).toBeNull();
        expect(p?.mode).not.toBe('rest');
        expect(p?.mode).not.toBe('prescribed');
    });

    test('validateDayPlan reports invalid_mode and keeps the value', () => {
        const r = validateDayPlan(plan({ mode: 'garbage' }));
        expect(r.ok).toBe(false);
        expect(r.violations).toContainEqual({ code: VIOLATION.INVALID_MODE, detail: { got: 'garbage' } });
    });

    test.each([
        ['a weekday index', 3], ['a weekday index as a string', '3'],
        ['an unpadded date', '2026-2-3'], ['a date that does not exist', '2026-02-30'],
        ['a timestamp', '2026-10-05T00:00:00.000Z'], ['a Date', new Date()],
        ['nothing at all', undefined],
    ])('%s makes the plan null', (_label, date) => {
        expect(normaliseDayPlan(plan({ date }))).toBeNull();
    });

    test('validateDayPlan reports invalid_date', () => {
        expect(codes(plan({ date: 3 }))).toContain(VIOLATION.INVALID_DATE);
    });

    test('one report explains everything wrong with a record', () => {
        const c = codes({ date: 'nope', mode: 'nope', status: 'nope' });
        expect(c).toEqual(expect.arrayContaining([
            VIOLATION.INVALID_DATE, VIOLATION.INVALID_MODE, VIOLATION.INVALID_STATUS,
        ]));
    });

    test('a non-object is refused rather than throwing', () => {
        for (const junk of [null, undefined, 'x', 7, [], new Date()]) {
            expect(normaliseDayPlan(junk)).toBeNull();
        }
        expect(validateDayPlan(null).violations[0].code).toBe(VIOLATION.NOT_AN_OBJECT);
    });
});

// ── subordinate content fails safe inside a readable plan ─────────────────

describe('malformed content inside an identifiable plan', () => {
    test('an invalid status becomes pending, which claims nothing', () => {
        const p = normaliseDayPlan(plan({ status: 'brilliant' }));
        expect(p.status).toBe(PLAN_STATUS.PENDING);     // not completed, not missed
        expect(codes(plan({ status: 'brilliant' }))).toContain(VIOLATION.INVALID_STATUS);
    });

    test.each([['a string', 'nope'], ['an object', {}], ['a number', 4]])
    ('supportingWork as %s becomes an empty array', (_l, v) => {
        const p = normaliseDayPlan(plan({ supportingWork: v }));
        expect(p.supportingWork).toEqual([]);
        expect(codes(plan({ supportingWork: v }))).toContain(VIOLATION.MALFORMED_ARRAY);
    });

    test('an item with no usable type is dropped, the rest survive', () => {
        const p = normaliseDayPlan(plan({
            supportingWork: [{ type: 'mobility' }, { type: '  ' }, null, 7, { nope: 1 }, { type: 'x' }],
        }));
        expect(p.supportingWork.map(i => i.type)).toEqual(['mobility', 'x']);
    });

    test('an array of primary sessions yields null and a violation', () => {
        const raw = plan({ primarySession: [{ type: 'length' }, { type: 'girth' }] });
        expect(normaliseDayPlan(raw).primarySession).toBeNull();
        expect(codes(raw)).toContain(VIOLATION.PRIMARY_NOT_SINGULAR);
    });

    test('kind-specific fields do not cross between work types', () => {
        const p = normaliseDayPlan(plan({
            primarySession: { type: 'length', tier: 'elite', category: 'nope', required: true },
            supportingWork: [{ type: 'mobility', tier: 'nope', category: 'Mobility' }],
            dailyPractice: [{ type: 'breathing', tier: 'nope', category: 'nope', required: true }],
        }));
        expect(p.primarySession).not.toHaveProperty('category');
        expect(p.supportingWork[0]).not.toHaveProperty('tier');
        expect(p.dailyPractice[0]).not.toHaveProperty('category');
        expect(p.dailyPractice[0].required).toBe(true);
    });

    test('a non-boolean required is dropped rather than coerced', () => {
        const p = normaliseDayPlan(plan({ supportingWork: [{ type: 'x', required: 'yes' }] }));
        expect(p.supportingWork[0]).not.toHaveProperty('required');
    });
});

// ── ruling 2: the dose is a resolved snapshot ─────────────────────────────

describe('dose is a resolved snapshot', () => {
    test('structured non-numeric prescription data is allowed', () => {
        // Four programmes will need variants, identifiers, direction, cadence.
        const dose = { cycles: 3, tool: 'tempo', pattern: { inhale: 3, exhale: 7 },
                       directions: ['out', 'up'], cue: 'stop completely', paced: true };
        const p = normaliseDayPlan(plan({ primarySession: { type: 'stamina', dose } }));
        expect(p.primarySession.dose).toEqual(dose);
    });

    test('a resolved dose is deep-cloned', () => {
        const dose = { pattern: { inhale: 3 }, directions: ['out'] };
        const p = normaliseDayPlan(plan({ primarySession: { type: 'x', dose } }));
        expect(p.primarySession.dose).not.toBe(dose);
        expect(p.primarySession.dose.pattern).not.toBe(dose.pattern);
        expect(p.primarySession.dose.directions).not.toBe(dose.directions);
    });

    test('mutating the caller input cannot change a normalised historical dose', () => {
        const dose = { cycles: 3, pattern: { inhale: 3 } };
        const raw = plan({ primarySession: { type: 'x', dose } });
        const p = normaliseDayPlan(raw);
        dose.cycles = 99; dose.pattern.inhale = 99; raw.supportingWork.push({ type: 'late' });
        expect(p.primarySession.dose).toEqual({ cycles: 3, pattern: { inhale: 3 } });
        expect(p.supportingWork).toEqual([]);
    });

    test('a pointer-only dose cannot masquerade as a resolved prescription', () => {
        for (const ptr of [{ policyKey: 'stage2-default' }, { templateKey: 't' },
                           { ref: 'x' }, { $ref: 'x' }, { policyRef: 'x', lookupKey: 'y' }]) {
            const raw = plan({ primarySession: { type: 'stamina', dose: ptr } });
            expect(normaliseDayPlan(raw).primarySession).not.toHaveProperty('dose');
            expect(codes(raw)).toContain(VIOLATION.UNRESOLVED_DOSE);
        }
    });

    test('a pointer alongside real resolved values is kept', () => {
        // Only an indirection-ONLY dose is refused. A snapshot that also
        // records where it came from is still a snapshot.
        const p = normaliseDayPlan(plan({
            primarySession: { type: 'x', dose: { cycles: 3, policyKey: 'stage2' } },
        }));
        expect(p.primarySession.dose).toEqual({ cycles: 3, policyKey: 'stage2' });
    });

    test('a non-serialisable dose is refused rather than silently flattened', () => {
        for (const bad of [{ fn: () => 1 }, { when: new Date() }, { n: NaN },
                           { n: Infinity }, { s: Symbol('x') }, { m: new Map() }]) {
            const raw = plan({ primarySession: { type: 'x', dose: bad } });
            expect(normaliseDayPlan(raw).primarySession).not.toHaveProperty('dose');
            expect(codes(raw)).toContain(VIOLATION.MALFORMED_DOSE);
        }
    });

    test('a circular dose is refused rather than hanging', () => {
        const d = { a: 1 }; d.self = d;
        const raw = plan({ primarySession: { type: 'x', dose: d } });
        expect(normaliseDayPlan(raw).primarySession).not.toHaveProperty('dose');
        expect(codes(raw)).toContain(VIOLATION.MALFORMED_DOSE);
    });

    test('a missing dose is never invented', () => {
        const p = normaliseDayPlan(plan({ primarySession: { type: 'length' } }));
        expect(p.primarySession).not.toHaveProperty('dose');
    });

    test('cloneResolved refuses what it cannot represent', () => {
        expect(cloneResolved({ a: [1, 'x', true, null] }).ok).toBe(true);
        expect(cloneResolved(undefined).ok).toBe(false);
        expect(cloneResolved(() => 1).ok).toBe(false);
        expect(cloneResolved(new Date()).ok).toBe(false);
    });
});

// ── forward compatibility, and what it does NOT guarantee ─────────────────

describe('unknown fields', () => {
    test('are preserved at plan and item level', () => {
        const p = normaliseDayPlan(plan({
            futureField: { nested: true },
            primarySession: { type: 'length', futureItemField: 7 },
        }));
        expect(p.futureField).toEqual({ nested: true });
        expect(p.primarySession.futureItemField).toBe(7);
    });

    test('never rescue a known field we recognise and reject', () => {
        const p = normaliseDayPlan(plan({ status: 'brilliant' }));
        expect(p.status).toBe('pending');
    });

    test('a pointer field OUTSIDE dose survives the spread, by design', () => {
        /* Stated honestly rather than claimed away. The snapshot guarantee is
           a rule about where prescription truth lives, not a filter that can
           catch every future field name: consumers must never reconstruct a
           historical dose from a policy reference. This test exists so that
           the limitation is documented rather than discovered. */
        const p = normaliseDayPlan(plan({
            primarySession: { type: 'x', policyKey: 'stage2-default', dose: { cycles: 3 } },
        }));
        expect(p.primarySession.policyKey).toBe('stage2-default');
        expect(p.primarySession.dose).toEqual({ cycles: 3 });
    });
});

// ── provenance ────────────────────────────────────────────────────────────

describe('provenance is recorded, never invented', () => {
    test('a missing generatedAt stays missing', () => {
        expect(normaliseDayPlan(plan())).not.toHaveProperty('generatedAt');
    });

    test('a present generatedAt survives', () => {
        const p = normaliseDayPlan(plan({ generatedAt: '2026-10-01T00:00:00.000Z' }));
        expect(p.generatedAt).toBe('2026-10-01T00:00:00.000Z');
    });

    test('a valid generatedFrom survives', () => {
        const from = { programmeKey: 'lastLonger', version: 1 };
        expect(normaliseDayPlan(plan({ generatedFrom: from })).generatedFrom).toEqual(from);
        expect(validateDayPlan(plan({ generatedFrom: from })).ok).toBe(true);
    });

    test('a valid generatedFrom is deep-cloned', () => {
        const from = { programmeKey: 'lastLonger', version: 1, cycle: { position: 2 } };
        const p = normaliseDayPlan(plan({ generatedFrom: from }));
        expect(p.generatedFrom).not.toBe(from);
        expect(p.generatedFrom.cycle).not.toBe(from.cycle);
        from.version = 99; from.cycle.position = 99;
        expect(p.generatedFrom).toEqual({ programmeKey: 'lastLonger', version: 1, cycle: { position: 2 } });
    });

    test('extra provenance fields survive for forward compatibility', () => {
        const p = normaliseDayPlan(plan({
            generatedFrom: { programmeKey: 'size', version: 2, futureField: true },
        }));
        expect(p.generatedFrom).toEqual({ programmeKey: 'size', version: 2, futureField: true });
    });

    test('a missing generatedFrom becomes null rather than invented', () => {
        expect(normaliseDayPlan(plan()).generatedFrom).toBeNull();
        expect(normaliseDayPlan(plan({ generatedFrom: null })).generatedFrom).toBeNull();
        expect(validateDayPlan(plan()).ok).toBe(true);        // absent is not a violation
    });

    test.each([
        ['an empty object', {}],
        ['an unrelated object', { foo: 'bar' }],
        ['an empty programmeKey', { programmeKey: '', version: 1 }],
        ['a whitespace programmeKey', { programmeKey: '   ', version: 1 }],
        ['a non-string programmeKey', { programmeKey: 7, version: 1 }],
        ['no version at all', { programmeKey: 'lastLonger' }],
        ['a NaN version', { programmeKey: 'lastLonger', version: NaN }],
        ['a fractional version', { programmeKey: 'lastLonger', version: 1.5 }],
        ['a string version', { programmeKey: 'lastLonger', version: '1' }],
        ['an Infinity version', { programmeKey: 'lastLonger', version: Infinity }],
        ['not an object at all', 'lastLonger'],
    ])('%s makes generatedFrom null, and is reported', (_label, generatedFrom) => {
        // A known field must not be validated more loosely than the shape it
        // promises: downstream code reads the promise, not the implementation.
        const p = normaliseDayPlan(plan({ generatedFrom }));
        expect(p.generatedFrom).toBeNull();
        expect(p).not.toBeNull();                              // the PLAN is still readable
        expect(codes(plan({ generatedFrom }))).toContain(VIOLATION.INVALID_GENERATED_FROM);
    });

    test('a programme key is never invented and nothing is looked up', () => {
        // An unrecognised key still survives: whether a programme exists is a
        // later phase's question, and answering it here would make old
        // records unreadable the day a programme is renamed.
        const p = normaliseDayPlan(plan({
            generatedFrom: { programmeKey: 'aProgrammeThatDoesNotExistYet', version: 1 },
        }));
        expect(p.generatedFrom.programmeKey).toBe('aProgrammeThatDoesNotExistYet');
        expect(validateDayPlan(plan({ generatedFrom: { programmeKey: 'x', version: 0 } })).ok).toBe(true);
    });
});

// ── the status domain ─────────────────────────────────────────────────────

describe('programmeWork is the status domain', () => {
    test('it returns primary and supporting work', () => {
        const p = normaliseDayPlan(plan({ supportingWork: [{ type: 'mobility' }, { type: 'pelvic' }] }));
        expect(programmeWork(p).map(i => i.type)).toEqual(['length', 'mobility', 'pelvic']);
    });

    test('it never returns a daily practice item', () => {
        // The structural reason a missed breathing practice cannot mark a
        // rest day as a missed programme day.
        const p = normaliseDayPlan(plan({
            mode: DAY_MODE.REST, primarySession: null,
            dailyPractice: [{ type: 'calmArousalBreathing' }, { type: 'other' }],
        }));
        expect(programmeWork(p)).toEqual([]);
    });

    test('a rest day with practice has an empty status domain', () => {
        const p = normaliseDayPlan(plan({ mode: DAY_MODE.REST, primarySession: null,
                                          dailyPractice: [{ type: 'breathing' }] }));
        expect(programmeWork(p)).toHaveLength(0);
        expect(p.dailyPractice).toHaveLength(1);
    });

    test('junk in gives an empty domain, not a throw', () => {
        for (const junk of [null, undefined, 'x', 7, []]) expect(programmeWork(junk)).toEqual([]);
    });
});

// ── determinism and purity ────────────────────────────────────────────────

describe('determinism and purity', () => {
    test('the same input normalises identically every time', () => {
        const raw = plan({ supportingWork: [{ type: 'a' }], dailyPractice: [{ type: 'b' }] });
        expect(normaliseDayPlan(raw)).toEqual(normaliseDayPlan(raw));
        expect(JSON.stringify(normaliseDayPlan(raw))).toBe(JSON.stringify(normaliseDayPlan(raw)));
    });

    test('the caller input is not mutated', () => {
        const raw = plan({ mode: DAY_MODE.REST, supportingWork: [{ type: 'mobility' }], status: 'brilliant' });
        const before = JSON.stringify(raw);
        normaliseDayPlan(raw);
        validateDayPlan(raw);
        expect(JSON.stringify(raw)).toBe(before);   // rest-stripping did not reach in
    });

    test('normalisation performs no policy lookup and reads no clock', () => {
        const src = readFileSync(new URL('../src/dayPlan.js', import.meta.url), 'utf8');
        expect(src).not.toMatch(/new Date\(\)/);
        expect(src).not.toMatch(/Date\.now/);
        expect(src).not.toMatch(/PROGRESSION_POLICY|policyFor|lookupPolicy/);
        expect(src).not.toMatch(/\bimport\b[^\n]*from/);   // no dependencies at all
    });
});

// ── lists ─────────────────────────────────────────────────────────────────

describe('normaliseDayPlans', () => {
    test('unreadable plans are dropped without disturbing the rest', () => {
        const out = normaliseDayPlans([
            plan({ date: '2026-10-03' }), { date: 'nope', mode: 'rest' },
            plan({ date: '2026-10-04', mode: 'garbage' }), plan({ date: '2026-10-05' }), null, 7,
        ]);
        expect(out.map(p => p.date)).toEqual(['2026-10-03', '2026-10-05']);
    });

    test('plans are date-sorted and one per date, last write winning', () => {
        const out = normaliseDayPlans([
            plan({ date: '2026-10-07', status: 'missed' }),
            plan({ date: '2026-10-05' }),
            plan({ date: '2026-10-07', status: 'completed' }),
        ]);
        expect(out.map(p => p.date)).toEqual(['2026-10-05', '2026-10-07']);
        expect(out[1].status).toBe('completed');
    });

    test('a non-array is an empty list, not a throw', () => {
        for (const junk of [null, undefined, 'x', 7, {}]) expect(normaliseDayPlans(junk)).toEqual([]);
    });
});

// ── the date key ──────────────────────────────────────────────────────────

describe('isDateKey', () => {
    test('accepts real ISO local dates including leap days', () => {
        for (const d of ['2026-10-05', '2024-02-29', '2026-01-01', '2026-12-31']) {
            expect(isDateKey(d)).toBe(true);
        }
    });
    test('rejects everything else', () => {
        for (const d of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-10-32',
                         '2026-2-3', '26-10-05', '2026-10-05T00:00:00Z', 3, '3', '', null,
                         undefined, new Date(), {}]) {
            expect(isDateKey(d)).toBe(false);
        }
    });
});
