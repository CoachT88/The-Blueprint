import { describe, test, expect } from 'vitest';
import {
    classifyLegacySchedule, migrationProgramme, mayGenerateOver,
    PROGRAMME_SOURCE, CLASSIFY_REASON, PROGRAMME_VERSION,
} from '../src/programmeMigration.js';

/**
 * The classifier decides whether generation may touch a member's week, so
 * every test here is ultimately one question: can a week somebody arranged
 * themselves ever come back as attributable?
 *
 * The matrix at the bottom is exhaustive on purpose. A spot check would have
 * missed the collision that shapes the whole table, which is that the `size`
 * preset is byte-identical to the factory default.
 */

/* The real arrays, copied from app/index.html GOALS and DEFAULT_PERSISTED.
   A browser test asserts the page passes these exact values, so a drift
   between the page and this file fails there rather than silently making
   these tests meaningless. */
const PRESETS = {
    size:    ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
    stamina: ['stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest', 'rest'],
    eq:      ['stamina', 'rest', 'length', 'rest', 'stamina', 'rest', 'rest'],
    all:     ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'],
};
const DEFAULT_WEEK = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

/** A week no preset produces. Three days of girth is nobody's preset. */
const HANDMADE = ['girth', 'girth', 'rest', 'girth', 'rest', 'stamina', 'rest'];

/** Only the three types the original app could assign, which is a real shape. */
const OLD_HANDMADE = ['length', 'rest', 'girth', 'rest', 'length', 'girth', 'rest'];

const classify = (over = {}) => classifyLegacySchedule({
    schedule: DEFAULT_WEEK,
    scheduleRepaired: false,
    primaryGoal: '',
    presets: PRESETS,
    defaultSchedule: DEFAULT_WEEK,
    ...over,
});

describe('the collision the table is built around', () => {
    test('the size preset really is the factory default, byte for byte', () => {
        /* If this ever stops being true, rules 4, 5 and 6 need rereading:
           the default week would no longer be a preset week and the
           "contradicts stated goal" case changes shape. */
        expect(PRESETS.size).toEqual(DEFAULT_WEEK);
    });

    test('no other preset collides with the default or with another preset', () => {
        const serialised = Object.entries(PRESETS).map(([k, v]) => [k, JSON.stringify(v)]);
        const dupes = serialised.filter(([, v], i) =>
            serialised.findIndex(([, w]) => w === v) !== i);
        expect(dupes.map(([k]) => k)).toEqual([]);
    });
});

describe('a week this build cannot read is never attributable', () => {
    /* Rule 1. The module is tested directly, so a readable week is a
       precondition it checks rather than one it inherits from the page. */
    const unreadable = [
        ['a short array',            ['length', 'girth', 'rest']],
        ['a long array',             [...DEFAULT_WEEK, 'rest']],
        ['not an array',             'rest'],
        ['null',                     null],
        ['undefined',                undefined],
        ['an object',                { 0: 'length' }],
        ['a type outside the vocabulary', ['length', 'pump', 'rest', 'length', 'girth', 'rest', 'rest']],
        ['an empty slot',            ['length', '', 'rest', 'length', 'girth', 'rest', 'rest']],
        ['a non-string slot',        ['length', 3, 'rest', 'length', 'girth', 'rest', 'rest']],
        ['a hole',                   ['length', undefined, 'rest', 'length', 'girth', 'rest', 'rest']],
    ];

    test.each(unreadable)('%s is custom, with unreadable_shape', (_label, schedule) => {
        const r = classify({ schedule });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(r.reason).toBe(CLASSIFY_REASON.UNREADABLE_SHAPE);
        expect(r.presetKey).toBe(null);
    });

    test('no input at all is custom rather than a throw', () => {
        expect(classifyLegacySchedule().verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(classifyLegacySchedule(null).verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(classifyLegacySchedule('nonsense').verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
    });

    test('a caller cannot widen the vocabulary to make a strange week readable', () => {
        /* classifySlot is called with no options on purpose. If this module
           ever passed options through, a caller could declare 'pump' a
           primary type and a week holding it would classify as readable. */
        const r = classify({
            schedule: ['pump', 'pump', 'rest', 'pump', 'pump', 'rest', 'rest'],
            primaryTypes: ['pump'],
            restTypes: ['rest'],
        });
        expect(r.reason).toBe(CLASSIFY_REASON.UNREADABLE_SHAPE);
    });
});

describe('a repaired schedule is never attributable', () => {
    /* Rule 2, and the reason it sits ahead of every shape comparison: by the
       time anything reads persisted.schedule the repair has already happened
       and is invisible in the value. A truncated week repaired into something
       that happens to equal a preset must not become auto-migratable. */
    test('the default week, repaired, is custom and not default', () => {
        const r = classify({ scheduleRepaired: true });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(r.reason).toBe(CLASSIFY_REASON.REPAIRED);
    });

    test('a preset matching the stated goal, repaired, is still custom', () => {
        const r = classify({
            schedule: PRESETS.stamina, primaryGoal: 'stamina', scheduleRepaired: true,
        });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(r.reason).toBe(CLASSIFY_REASON.REPAIRED);
        expect(r.presetKey).toBe(null);
    });

    test('only an explicit true counts, so a missing signal is not a repair', () => {
        /* The page always supplies it. A caller that forgets must not have
           every member silently classified custom, which would look like the
           safe direction and would actually hide a wiring bug. */
        expect(classify({ scheduleRepaired: undefined }).verdict).toBe(PROGRAMME_SOURCE.DEFAULT);
        expect(classify({ scheduleRepaired: 'yes' }).verdict).toBe(PROGRAMME_SOURCE.DEFAULT);
        expect(classify({ scheduleRepaired: 1 }).verdict).toBe(PROGRAMME_SOURCE.DEFAULT);
    });
});

describe('a goal this build cannot interpret is never used to attribute a shape', () => {
    /* Rule 3. The goal vocabulary has never changed in production, so this is
       reached through an imported backup or a future vocabulary change. */
    test('an unknown goal makes an exact preset match custom anyway', () => {
        const r = classify({ schedule: PRESETS.stamina, primaryGoal: 'girth-focus' });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(r.reason).toBe(CLASSIFY_REASON.UNKNOWN_GOAL);
    });

    test('an unknown goal makes the default week custom too', () => {
        const r = classify({ primaryGoal: 'bulk' });
        expect(r.reason).toBe(CLASSIFY_REASON.UNKNOWN_GOAL);
    });

    test('a non-string goal is treated as never answered, not as unknown', () => {
        /* null and undefined are what an older row gives for a column that
           did not exist. That is "never answered", which rule 5 handles. */
        expect(classify({ primaryGoal: null }).reason).toBe(CLASSIFY_REASON.DEFAULT_NO_GOAL);
        expect(classify({ primaryGoal: undefined }).reason).toBe(CLASSIFY_REASON.DEFAULT_NO_GOAL);
    });

    test('a goal that only looks like a key is still unknown', () => {
        /* hasOwnProperty, not `in`, so an inherited name cannot pass. */
        expect(classify({ primaryGoal: 'toString' }).reason).toBe(CLASSIFY_REASON.UNKNOWN_GOAL);
        expect(classify({ primaryGoal: 'constructor' }).reason).toBe(CLASSIFY_REASON.UNKNOWN_GOAL);
    });
});

describe('the exhaustive matrix: every shape against every goal', () => {
    /* Six shapes by five goal values. Each cell states the verdict AND the
       reason, so a rule that produces the right answer by the wrong route
       fails here. */
    const SHAPES = {
        default:  DEFAULT_WEEK,
        size:     PRESETS.size,
        stamina:  PRESETS.stamina,
        eq:       PRESETS.eq,
        all:      PRESETS.all,
        handmade: HANDMADE,
    };
    const GOALS = ['', 'size', 'stamina', 'eq', 'all'];

    const D = PROGRAMME_SOURCE.DEFAULT;
    const P = PROGRAMME_SOURCE.PRESET;
    const C = PROGRAMME_SOURCE.CUSTOM;
    const R = CLASSIFY_REASON;

    /* shape -> goal -> [verdict, reason, presetKey]
       `default` and `size` are the same array, so their rows are identical
       by construction and both are written out rather than aliased. */
    const EXPECT = {
        default: {
            '':        [D, R.DEFAULT_NO_GOAL, null],
            size:      [P, R.PRESET_MATCHES_GOAL, 'size'],
            stamina:   [C, R.DEFAULT_CONTRADICTS_GOAL, null],
            eq:        [C, R.DEFAULT_CONTRADICTS_GOAL, null],
            all:       [C, R.DEFAULT_CONTRADICTS_GOAL, null],
        },
        size: {
            '':        [D, R.DEFAULT_NO_GOAL, null],
            size:      [P, R.PRESET_MATCHES_GOAL, 'size'],
            stamina:   [C, R.DEFAULT_CONTRADICTS_GOAL, null],
            eq:        [C, R.DEFAULT_CONTRADICTS_GOAL, null],
            all:       [C, R.DEFAULT_CONTRADICTS_GOAL, null],
        },
        stamina: {
            '':        [C, R.PRESET_WITHOUT_GOAL, null],
            size:      [C, R.PRESET_WITHOUT_GOAL, null],
            stamina:   [P, R.PRESET_MATCHES_GOAL, 'stamina'],
            eq:        [C, R.PRESET_WITHOUT_GOAL, null],
            all:       [C, R.PRESET_WITHOUT_GOAL, null],
        },
        eq: {
            '':        [C, R.PRESET_WITHOUT_GOAL, null],
            size:      [C, R.PRESET_WITHOUT_GOAL, null],
            stamina:   [C, R.PRESET_WITHOUT_GOAL, null],
            eq:        [P, R.PRESET_MATCHES_GOAL, 'eq'],
            all:       [C, R.PRESET_WITHOUT_GOAL, null],
        },
        all: {
            '':        [C, R.PRESET_WITHOUT_GOAL, null],
            size:      [C, R.PRESET_WITHOUT_GOAL, null],
            stamina:   [C, R.PRESET_WITHOUT_GOAL, null],
            eq:        [C, R.PRESET_WITHOUT_GOAL, null],
            all:       [P, R.PRESET_MATCHES_GOAL, 'all'],
        },
        handmade: {
            '':        [C, R.NO_RECOGNISED_SHAPE, null],
            size:      [C, R.NO_RECOGNISED_SHAPE, null],
            stamina:   [C, R.NO_RECOGNISED_SHAPE, null],
            eq:        [C, R.NO_RECOGNISED_SHAPE, null],
            all:       [C, R.NO_RECOGNISED_SHAPE, null],
        },
    };

    const cells = [];
    for (const shape of Object.keys(SHAPES)) {
        for (const goal of GOALS) cells.push([shape, goal || '(never answered)', goal]);
    }

    test('the matrix covers every combination', () => {
        expect(cells).toHaveLength(30);
    });

    test.each(cells)('%s week, goal %s', (shape, _label, goal) => {
        const [verdict, reason, presetKey] =
            EXPECT[shape][goal === '' ? '' : goal];
        const r = classify({ schedule: SHAPES[shape], primaryGoal: goal });
        expect(r).toEqual({ verdict, reason, presetKey });
    });

    test('23 of the 30 cells are custom, which is the design and not indecision', () => {
        /* 5 preset: the four goals matching their own shape, plus the second
           copy of that collision, since `default` and `size` are one array.
           2 default: those same two rows with no goal ever answered. */
        const all = cells.map(([shape, , goal]) =>
            classify({ schedule: SHAPES[shape], primaryGoal: goal }).verdict);
        expect(all.filter(v => v === PROGRAMME_SOURCE.CUSTOM)).toHaveLength(23);
        expect(all.filter(v => v === PROGRAMME_SOURCE.PRESET)).toHaveLength(5);
        expect(all.filter(v => v === PROGRAMME_SOURCE.DEFAULT)).toHaveLength(2);
    });

    test('repairing any cell turns it custom', () => {
        cells.forEach(([shape, , goal]) => {
            const r = classify({
                schedule: SHAPES[shape], primaryGoal: goal, scheduleRepaired: true,
            });
            expect(r.verdict, `${shape}/${goal}`).toBe(PROGRAMME_SOURCE.CUSTOM);
            expect(r.reason, `${shape}/${goal}`).toBe(CLASSIFY_REASON.REPAIRED);
        });
    });
});

describe('a week built with the original three day types', () => {
    /* The first version of the app could only assign length, girth and rest.
       A long-tenured hand-edited week may therefore contain no stamina at
       all, which is an ordinary custom shape and not a broken one. */
    test('it is readable, and custom', () => {
        const r = classify({ schedule: OLD_HANDMADE, primaryGoal: 'size' });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(r.reason).toBe(CLASSIFY_REASON.NO_RECOGNISED_SHAPE);
    });
});

describe('tenure is not evidence about editing', () => {
    /* The ruling this module was built around. assignDay() has existed since
       the first commit, before sessions could be logged, so zero sessions is
       not proof of an untouched schedule. The fields are not inputs, and
       these tests exist so that reintroducing one fails. */
    const BUSY = {
        allTimeSessionCount: 400,
        sessionLog: Array.from({ length: 50 }, (_, i) => ({ date: `2026-01-${i + 1}`, xp: 20 })),
        firstSessionDate: '2024-01-01',
        progressionLedger: [{ weekKey: '2026_w1', verdict: 'qualified' }],
        difficulty: 'elite',
        programmeStartDate: '2024-01-01',
    };
    const FRESH = {
        allTimeSessionCount: 0,
        sessionLog: [],
        firstSessionDate: '',
        progressionLedger: [],
        difficulty: 'beginner',
        programmeStartDate: null,
    };

    test('a veteran and a brand-new account classify identically', () => {
        expect(classify(BUSY)).toEqual(classify(FRESH));
        expect(classify({ ...BUSY, schedule: HANDMADE })).toEqual(classify({ ...FRESH, schedule: HANDMADE }));
        expect(classify({ ...BUSY, schedule: PRESETS.eq, primaryGoal: 'eq' }))
            .toEqual(classify({ ...FRESH, schedule: PRESETS.eq, primaryGoal: 'eq' }));
    });

    test('a zero-session account with a hand-made week is still custom', () => {
        const r = classify({ ...FRESH, schedule: HANDMADE });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
    });

    test('a zero-session account whose goal contradicts the default is still custom', () => {
        const r = classify({ ...FRESH, primaryGoal: 'stamina' });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(r.reason).toBe(CLASSIFY_REASON.DEFAULT_CONTRADICTS_GOAL);
    });
});

describe('pure', () => {
    test('it does not mutate its input', () => {
        const schedule = HANDMADE.slice();
        const presets = JSON.parse(JSON.stringify(PRESETS));
        const input = {
            schedule, scheduleRepaired: false, primaryGoal: 'size',
            presets, defaultSchedule: DEFAULT_WEEK.slice(),
        };
        const snapshot = JSON.stringify(input);
        classifyLegacySchedule(input);
        expect(JSON.stringify(input)).toBe(snapshot);
        expect(schedule).toEqual(HANDMADE);
    });

    test('the same input gives the same answer', () => {
        const input = { schedule: PRESETS.all, primaryGoal: 'all' };
        expect(classify(input)).toEqual(classify(input));
    });

    test('an empty preset table attributes nothing', () => {
        /* A caller that fails to pass the presets must not get a confident
           answer. With no table, nothing matches and the default week is
           still the default week only if defaultSchedule was supplied. */
        const r = classifyLegacySchedule({
            schedule: PRESETS.stamina, scheduleRepaired: false,
            primaryGoal: 'stamina', presets: {}, defaultSchedule: DEFAULT_WEEK,
        });
        expect(r.verdict).toBe(PROGRAMME_SOURCE.CUSTOM);
        expect(r.reason).toBe(CLASSIFY_REASON.UNKNOWN_GOAL);
    });
});

describe('the stored programme', () => {
    const NOW = new Date(2026, 9, 5, 23, 30);   // local, late evening

    test('a default classification', () => {
        const p = migrationProgramme(classify(), { now: NOW });
        expect(p).toEqual({
            version: PROGRAMME_VERSION,
            source: 'default',
            presetKey: null,
            custom: false,
            adopted: false,
            reason: CLASSIFY_REASON.DEFAULT_NO_GOAL,
            classifiedAt: '2026-10-05',
        });
    });

    test('a preset classification keeps the key', () => {
        const p = migrationProgramme(
            classify({ schedule: PRESETS.eq, primaryGoal: 'eq' }), { now: NOW });
        expect(p.source).toBe('preset');
        expect(p.presetKey).toBe('eq');
        expect(p.custom).toBe(false);
    });

    test('a custom classification sets custom and carries no key', () => {
        const p = migrationProgramme(classify({ schedule: HANDMADE }), { now: NOW });
        expect(p.source).toBe('custom');
        expect(p.custom).toBe(true);
        expect(p.presetKey).toBe(null);
        expect(p.reason).toBe(CLASSIFY_REASON.NO_RECOGNISED_SHAPE);
    });

    test('custom is true for exactly the custom verdict', () => {
        const shapes = [DEFAULT_WEEK, PRESETS.eq, HANDMADE];
        const goals = ['', 'eq', 'eq'];
        const got = shapes.map((s, i) =>
            migrationProgramme(classify({ schedule: s, primaryGoal: goals[i] }), { now: NOW }).custom);
        expect(got).toEqual([false, false, true]);
    });

    test('the date is the local calendar day, not UTC', () => {
        /* Late evening in a timezone behind UTC would be tomorrow in UTC.
           The date recorded is the one the member would have seen. */
        const p = migrationProgramme(classify(), { now: new Date(2026, 0, 1, 23, 59) });
        expect(p.classifiedAt).toBe('2026-01-01');
    });

    test('no snapshot of the legacy schedule is stored', () => {
        /* The schedule column is already the preserved copy. A second frozen
           representation here would be another lifecycle to keep correct. */
        const p = migrationProgramme(classify({ schedule: HANDMADE }), { now: NOW });
        expect(Object.keys(p).sort()).toEqual(
            ['adopted', 'classifiedAt', 'custom', 'presetKey', 'reason', 'source', 'version']);
    });

    test('a malformed classification stores as custom rather than throwing', () => {
        expect(migrationProgramme(null, { now: NOW }).custom).toBe(true);
        expect(migrationProgramme({ verdict: 'invented' }, { now: NOW }).source).toBe('custom');
        expect(migrationProgramme({}, { now: NOW }).reason).toBe(CLASSIFY_REASON.NO_RECOGNISED_SHAPE);
    });

    test('a presetKey on a non-preset verdict is dropped', () => {
        const p = migrationProgramme(
            { verdict: 'custom', reason: 'x', presetKey: 'stamina' }, { now: NOW });
        expect(p.presetKey).toBe(null);
    });

    test('a missing clock gives a null date rather than a wrong one', () => {
        expect(migrationProgramme(classify(), {}).classifiedAt).toBe(null);
        expect(migrationProgramme(classify()).classifiedAt).toBe(null);
    });
});

describe('may generation touch this member', () => {
    /* The invariant in one place, so no caller has to remember both fields. */
    test('an unadopted custom member is off limits', () => {
        expect(mayGenerateOver({ source: 'custom', custom: true, adopted: false })).toBe(false);
    });

    test('an adopted custom member is not', () => {
        expect(mayGenerateOver({ source: 'custom', custom: true, adopted: true })).toBe(true);
    });

    test('default and preset members are generatable', () => {
        expect(mayGenerateOver({ source: 'default', custom: false })).toBe(true);
        expect(mayGenerateOver({ source: 'preset', presetKey: 'eq', custom: false })).toBe(true);
    });

    test('no classification is not permission', () => {
        expect(mayGenerateOver(null)).toBe(false);
        expect(mayGenerateOver(undefined)).toBe(false);
        expect(mayGenerateOver({})).toBe(false);
        expect(mayGenerateOver({ source: 'invented' })).toBe(false);
    });

    test('custom is what gates, not the source string', () => {
        /* A programme whose source says preset but which is flagged custom is
           contradictory, and the safe reading of a contradiction is no. */
        expect(mayGenerateOver({ source: 'preset', custom: true, adopted: false })).toBe(false);
    });
});
