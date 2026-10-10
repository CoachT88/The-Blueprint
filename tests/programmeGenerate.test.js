import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
    programmeKeyFor, weekShapeFor, horizonFor, resolveDose,
    generatePlans, retainPlans, cutoverPlan,
    PROGRAMME_KEY, PROGRAMME_CONTENT_VERSION, GENERATE_REFUSAL,
} from '../src/programmeGenerate.js';
import { normaliseDayPlan } from '../src/dayPlan.js';

/**
 * The authority transition, decided purely.
 *
 * Two properties carry most of the weight here and both are asserted rather
 * than reasoned about:
 *
 *   Generation never walks backwards. A member who cuts over on a Thursday
 *   gets no Monday, Tuesday or Wednesday plan, because for a date before day
 *   plans existed the honest value is absent. The first draft of this phase
 *   generated the whole current week and would have written three dates that
 *   had already passed.
 *
 *   In version 1 the projection is a no-op on the compatibility column. The
 *   generated week IS the member's existing week, so the seven slots written
 *   back are the seven slots already there, which is why the server-side
 *   notification contract cannot break for the migrated cohort.
 */

/* The real tables, copied from app/index.html. A browser test asserts the
   page passes these exact values, so a drift between the page and this file
   fails there rather than quietly making these tests meaningless. */
const PRESETS = {
    size:    ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
    stamina: ['stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest', 'rest'],
    eq:      ['stamina', 'rest', 'length', 'rest', 'stamina', 'rest', 'rest'],
    all:     ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'],
};
const ULI = 'Uli — Manual Clamp';          // the real title, em dash included
const TABLES = {
    routines: {
        length: [
            { title: 'Directional Pulls', sets: 3, duration: 30, isDirectional: true },
            { title: 'V-Stretch', sets: 3, duration: 30 },
        ],
        girth: [
            { title: 'Wet Jelq', sets: 1, duration: 120, isGirthCircuit: true },
            { title: ULI, sets: 1, duration: 45, isGirthCircuit: true },
        ],
        stamina: [
            { title: 'Edging — Controlled Hold', sets: 3, duration: 120 },
            { title: 'Lateral Compression', sets: 3, duration: 15, restDur: 30 },
        ],
        recovery: [{ title: 'Kegel Contractions', sets: 3, duration: 60, isRecovery: true }],
    },
    difficulties: [
        { id: 'beginner', durationMult: 0.5, setsOffset: -1 },
        { id: 'intermediate', durationMult: 1.0, setsOffset: 0 },
        { id: 'advanced', durationMult: 1.5, setsOffset: 1 },
        { id: 'elite', durationMult: 2.0, setsOffset: 2 },
    ],
    girthCircuit: {
        beginner:     { rounds: 3, jelqDur: 60,  uliDur: 30, restDur: 30 },
        intermediate: { rounds: 4, jelqDur: 120, uliDur: 45, restDur: 45 },
        advanced:     { rounds: 5, jelqDur: 150, uliDur: 60, restDur: 60 },
        elite:        { rounds: 5, jelqDur: 180, uliDur: 60, restDur: 60 },
    },
    directionals: ['OUT', 'UP', 'DOWN', 'LEFT', 'RIGHT'],
    exExperience: {},
};

const MONDAY = (h = 12) => new Date(2026, 2, 9, h);     // 2026-03-09 is a Monday
const at = (offsetDays, h = 12) => new Date(2026, 2, 9 + offsetDays, h);
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const programme = (over = {}) => ({
    key: null, version: 1, adoptedAt: null, custom: false, cyclePosition: null,
    migration: {
        source: 'preset', presetKey: 'size',
        reason: 'preset_shape_matches_stated_goal', classifiedAt: '2026-03-01',
    },
    ...over,
});

const cutover = (over = {}) => cutoverPlan({
    permitted: true,
    programme: programme(),
    existingPlans: [],
    presets: PRESETS,
    tables: TABLES,
    tier: 'intermediate',
    now: at(3),                 // Thursday
    ...over,
});

describe('which programme a member is on', () => {
    test('each legacy preset maps to its own programme key', () => {
        const got = ['size', 'stamina', 'eq', 'all'].map(presetKey =>
            programmeKeyFor(programme({ migration: { source: 'preset', presetKey } })));
        expect(got).toEqual(['size', 'lastLonger', 'erectionQuality', 'everything']);
    });

    test('the default cohort maps to Size, because its week already is Size', () => {
        /* Establishing a programme, NOT claiming the member chose Size as a
           goal. primaryGoal is not an input here and is never written. */
        expect(programmeKeyFor(programme({ migration: { source: 'default', presetKey: null } })))
            .toBe(PROGRAMME_KEY.SIZE);
    });

    test('a custom member has no preset to map, so there is no key', () => {
        /* A mapping returning null, not a second authority gate.
           mayGenerateOver decides permission. */
        expect(programmeKeyFor(programme({ custom: true, migration: { source: 'custom', presetKey: null } })))
            .toBe(null);
    });

    test('the mapping does NOT protect a contradictory programme, and must not', () => {
        /* custom true with preset provenance is contradictory, reachable from
           a hand-edited backup. The mapping happily names a programme for it,
           because naming which programme is not its job. Only
           mayGenerateOver() refuses this member, which is why bypassing that
           gate is a mutation the browser suite has to catch: here it would
           sail straight through.

           Written down so nobody "hardens" this function into a second gate
           and leaves the first one untested. */
        const contradictory = programme({ custom: true, migration: { source: 'preset', presetKey: 'eq' } });
        expect(programmeKeyFor(contradictory)).toBe('erectionQuality');
        expect(cutoverPlan({
            permitted: true, programme: contradictory, existingPlans: [],
            presets: PRESETS, tables: TABLES, tier: 'intermediate', now: at(3),
        }).ok).toBe(true);        // permission was granted, so it proceeds
    });

    test('an already-cut-over programme keeps the key it has', () => {
        const p = programme({ key: 'everything', migration: { source: 'preset', presetKey: 'size' } });
        expect(programmeKeyFor(p)).toBe('everything');
    });

    test('nothing mappable gives null rather than a guess', () => {
        expect(programmeKeyFor(null)).toBe(null);
        expect(programmeKeyFor({})).toBe(null);
        expect(programmeKeyFor(programme({ migration: null }))).toBe(null);
        expect(programmeKeyFor(programme({ migration: { source: 'preset', presetKey: 'invented' } }))).toBe(null);
    });

    test('an unrecognised stored key falls back to provenance rather than sticking', () => {
        /* `key` is the cutover marker only when it is a key this build knows.
           An unrecognised one can only come from a hand-edited backup, and
           provenance is the authority on WHICH programme, so re-deriving
           lands the member somewhere correct instead of stranding them. */
        expect(programmeKeyFor(programme({ key: 'size2' }))).toBe('size');
        expect(programmeKeyFor(programme({
            key: 'size2', migration: { source: 'custom', presetKey: null },
        }))).toBe(null);
    });

    test('every key maps back to a seven-slot weekly shape', () => {
        Object.values(PROGRAMME_KEY).forEach(k => {
            expect(weekShapeFor(k, PRESETS), k).toHaveLength(7);
        });
        expect(weekShapeFor('invented', PRESETS)).toBe(null);
        expect(weekShapeFor('size', {})).toBe(null);
        expect(weekShapeFor('size', { size: ['rest'] })).toBe(null);
    });
});

describe('the horizon never walks backwards', () => {
    /* THE CORRECTION THIS PHASE TURNS ON. Generating the whole current ISO
       week would backfill every date before cutover. */
    const EXPECTED = [14, 13, 12, 11, 10, 9, 8];

    test.each(DAY_NAMES.map((n, i) => [n, i]))('%s cutover generates the right dates', (name, i) => {
        const h = horizonFor(at(i));
        expect(h.dates).toHaveLength(EXPECTED[i]);
        expect(h.dates[0], `${name} must start at today`).toBe(h.today);
        expect(h.horizonEnd).toBe('2026-03-22');          // the Sunday ending next week
        expect(h.nextMonday.toISOString().slice(0, 10)).toBe('2026-03-16');
    });

    test('Thursday cutover writes no Monday, Tuesday or Wednesday', () => {
        const h = horizonFor(at(3));
        expect(h.today).toBe('2026-03-12');
        ['2026-03-09', '2026-03-10', '2026-03-11'].forEach(d =>
            expect(h.dates, d).not.toContain(d));
        expect(h.dates).toHaveLength(11);
    });

    test('the dates are contiguous with no gaps', () => {
        for (let i = 0; i < 7; i++) {
            const h = horizonFor(at(i));
            h.dates.forEach((d, n) => {
                if (n === 0) return;
                const prev = new Date(h.dates[n - 1] + 'T12:00:00');
                prev.setDate(prev.getDate() + 1);
                expect(d, `gap after ${h.dates[n - 1]}`).toBe(prev.toISOString().slice(0, 10));
            });
        }
    });

    test('the next complete week is always inside the horizon', () => {
        /* What makes the projection complete by construction rather than by
           luck. nextMonday is at least a day and at most a week away. */
        for (let i = 0; i < 7; i++) {
            const h = horizonFor(at(i));
            const mon = h.nextMonday.toISOString().slice(0, 10);
            expect(h.dates, DAY_NAMES[i]).toContain(mon);
            expect(h.dates[h.dates.length - 1] >= mon).toBe(true);
            expect(h.dates.filter(d => d >= mon)).toHaveLength(7);
        }
    });

    test('a missing or broken clock still produces a usable horizon', () => {
        expect(horizonFor(undefined).dates.length).toBeGreaterThanOrEqual(8);
        expect(horizonFor(new Date('nonsense')).dates.length).toBeGreaterThanOrEqual(8);
    });
});

describe('the dose is resolved, never a reference', () => {
    const INDIRECTION = ['ref', '$ref', 'lookupKey', 'doseRef', 'policyKey'];
    const deepKeys = (v, out = []) => {
        if (Array.isArray(v)) v.forEach(x => deepKeys(x, out));
        else if (v && typeof v === 'object') {
            Object.keys(v).forEach(k => { out.push(k); deepKeys(v[k], out); });
        }
        return out;
    };

    test('set-based work carries post-tier numbers', () => {
        expect(resolveDose('length', 'intermediate', TABLES)).toEqual({
            /* The dose SCHEMA version, stamped as of Phase 3C.5 so execution
               can refuse a shape it does not understand instead of guessing.
               Separate from PROGRAMME_CONTENT_VERSION, which versions a
               programme's content rather than this object's shape. */
            v: 1,
            shape: 'sets', tier: 'intermediate',
            exercises: [
                { title: 'Directional Pulls', sets: 3, duration: 30, directions: 5 },
                { title: 'V-Stretch', sets: 3, duration: 30 },
            ],
        });
    });

    test('the tier actually changes the numbers', () => {
        const b = resolveDose('length', 'beginner', TABLES).exercises[1];
        const e = resolveDose('length', 'elite', TABLES).exercises[1];
        expect(b).toEqual({ title: 'V-Stretch', sets: 2, duration: 15 });   // max(1,3-1), 30*0.5
        expect(e).toEqual({ title: 'V-Stretch', sets: 5, duration: 60 });   // 3+2, 30*2
    });

    test('sets never fall below one, matching applyDifficulty', () => {
        const tables = { ...TABLES, routines: { ...TABLES.routines, length: [{ title: 'X', sets: 1, duration: 10 }] } };
        expect(resolveDose('length', 'beginner', tables).exercises[0].sets).toBe(1);
    });

    test('directions is a resolved count, present only where it applies', () => {
        const d = resolveDose('length', 'intermediate', TABLES);
        expect(d.exercises[0].directions).toBe(5);
        expect('directions' in d.exercises[1]).toBe(false);
    });

    test('restDur appears only where the exercise has one', () => {
        const d = resolveDose('stamina', 'intermediate', TABLES);
        expect('restDur' in d.exercises[0]).toBe(false);
        expect(d.exercises[1].restDur).toBe(30);
    });

    test('a per-exercise override wins, and elite reads the advanced override', () => {
        /* EX_EXPERIENCE is empty in the page today, so this path is only
           reachable by passing a table. Mirroring it keeps the generator from
           diverging from getCurEx the day somebody populates it. */
        const tables = { ...TABLES, exExperience: { 'V-Stretch': { advanced: { sets: 9, duration: 99 } } } };
        expect(resolveDose('length', 'advanced', tables).exercises[1])
            .toEqual({ title: 'V-Stretch', sets: 9, duration: 99 });
        expect(resolveDose('length', 'elite', tables).exercises[1])
            .toEqual({ title: 'V-Stretch', sets: 9, duration: 99 });
    });

    test('girth is the circuit table, not the tier offsets', () => {
        expect(resolveDose('girth', 'advanced', TABLES)).toEqual({
            v: 1,
            shape: 'circuit', tier: 'advanced', rounds: 5, restDur: 60,
            stations: [
                { title: 'Wet Jelq', duration: 150 },
                { title: ULI, duration: 60 },
            ],
        });
    });

    test('the girth station titles are the discriminator getCurEx uses', () => {
        /* Both girth exercises carry isGirthCircuit, so the flag cannot tell
           them apart and the title is the only discriminator in production.
           If a title changes, this says so before the dose silently swaps. */
        expect(TABLES.routines.girth.map(e => e.title)).toEqual(['Wet Jelq', ULI]);
    });

    test('no indirection key at any depth, in any programme or tier', () => {
        ['length', 'girth', 'stamina'].forEach(type => {
            ['beginner', 'intermediate', 'advanced', 'elite'].forEach(tier => {
                const keys = deepKeys(resolveDose(type, tier, TABLES));
                INDIRECTION.forEach(bad => expect(keys, `${type}/${tier}`).not.toContain(bad));
            });
        });
    });

    test('no instructional content is copied in to freeze the dose', () => {
        const rich = {
            ...TABLES,
            routines: {
                ...TABLES.routines,
                length: [{
                    title: 'X', sets: 2, duration: 20,
                    howto: ['a', 'b'], cues: [{ time: 1, text: 'c' }],
                    feel: 'f', dontFeel: 'd', eq: '3-4 EQ', icon: 'fa-x',
                }],
            },
        };
        const keys = deepKeys(resolveDose('length', 'intermediate', rich));
        ['howto', 'cues', 'feel', 'dontFeel', 'eq', 'icon'].forEach(k =>
            expect(keys).not.toContain(k));
    });

    test('an unknown type or a missing table resolves to nothing, not to a guess', () => {
        expect(resolveDose('recovery', 'intermediate', { routines: {} })).toBe(null);
        expect(resolveDose('length', 'intermediate', {})).toBe(null);
        expect(resolveDose('girth', 'intermediate', { routines: TABLES.routines })).toBe(null);
    });
});

describe('the generated plans', () => {
    test('every plan is valid by the module that owns validity', () => {
        const g = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES });
        expect(g.ok).toBe(true);
        g.plans.forEach(p => expect(normaliseDayPlan(p), p.date).not.toBe(null));
    });

    test('a slot becomes the primary session for that weekday', () => {
        const g = generatePlans({ key: 'size', now: MONDAY(), tier: 'intermediate', presets: PRESETS, tables: TABLES });
        const byDate = Object.fromEntries(g.plans.map(p => [p.date, p]));
        // 2026-03-09 Monday -> size[1] = girth; 2026-03-11 Wednesday -> size[3] = length
        expect(byDate['2026-03-09'].primarySession.type).toBe('girth');
        expect(byDate['2026-03-11'].primarySession.type).toBe('length');
        expect(byDate['2026-03-14'].mode).toBe('rest');          // Saturday -> size[6] = rest
        expect(byDate['2026-03-14'].primarySession).toBe(null);
    });

    test('a rest day carries no primary and no supporting work', () => {
        const g = generatePlans({ key: 'lastLonger', now: at(1), tier: 'intermediate', presets: PRESETS, tables: TABLES });
        g.plans.filter(p => p.mode === 'rest').forEach(p => {
            expect(p.primarySession).toBe(null);
            expect(p.supportingWork).toEqual([]);
        });
    });

    test('no plan carries supporting work or daily practice in this phase', () => {
        /* Which is why no day is support-only and the projection can never
           refuse on that ground here. The refusal is still covered, against
           a plan built by hand, below. */
        const g = generatePlans({ key: 'everything', now: at(2), tier: 'elite', presets: PRESETS, tables: TABLES });
        g.plans.forEach(p => {
            expect(p.supportingWork).toEqual([]);
            expect(p.dailyPractice).toEqual([]);
        });
    });

    test('every plan is pending, and nothing else', () => {
        const g = generatePlans({ key: 'erectionQuality', now: at(4), tier: 'beginner', presets: PRESETS, tables: TABLES });
        expect([...new Set(g.plans.map(p => p.status))]).toEqual(['pending']);
    });

    test('mode is only ever prescribed or rest', () => {
        /* modified and protective are readiness answers resolved at session
           time. Storing one at generation would freeze a deload into a
           future date. */
        Object.values(PROGRAMME_KEY).forEach(key => {
            const g = generatePlans({ key, now: MONDAY(), tier: 'intermediate', presets: PRESETS, tables: TABLES });
            g.plans.forEach(p => expect(['prescribed', 'rest'], `${key}/${p.date}`).toContain(p.mode));
        });
    });

    test('provenance names the programme and the content version', () => {
        const g = generatePlans({ key: 'lastLonger', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES });
        g.plans.forEach(p => expect(p.generatedFrom)
            .toEqual({ programmeKey: 'lastLonger', version: PROGRAMME_CONTENT_VERSION }));
        expect(typeof g.plans[0].generatedAt).toBe('string');
    });

    test('recovery can never be a primary session type', () => {
        /* recovery is in ROUTINES but not in the legacy vocabulary, so a
           recovery primary would make the projection refuse. No weekly shape
           can produce one. */
        Object.values(PROGRAMME_KEY).forEach(key => {
            const g = generatePlans({ key, now: MONDAY(), tier: 'intermediate', presets: PRESETS, tables: TABLES });
            g.plans.forEach(p => expect(p.primarySession && p.primarySession.type).not.toBe('recovery'));
        });
    });

    test('no weekly shape means no plans', () => {
        const g = generatePlans({ key: 'invented', now: MONDAY(), presets: PRESETS, tables: TABLES });
        expect(g).toEqual({ ok: false, reason: GENERATE_REFUSAL.NO_WEEK_SHAPE });
    });

    test('a LEGACY key is refused, even though one of them looks right', () => {
        /* The collision, caught here because it caught this very test file
           first: the three tests above were written with `stamina`, `eq` and
           `all`, which are preset keys, and only `size` silently worked
           because it is in both vocabularies. generatePlans takes PROGRAMME
           keys, and refusing the others is what makes the mistake loud. */
        ['stamina', 'eq', 'all'].forEach(legacy => {
            expect(generatePlans({ key: legacy, now: MONDAY(), presets: PRESETS, tables: TABLES }), legacy)
                .toEqual({ ok: false, reason: GENERATE_REFUSAL.NO_WEEK_SHAPE });
        });
        /* `size` is the one word in both, and it means Size either way, so it
           is accepted. That is the whole reason the two vocabularies are
           written out in both directions rather than derived. */
        expect(generatePlans({ key: 'size', now: MONDAY(), presets: PRESETS, tables: TABLES }).ok).toBe(true);
    });
});

describe('retention and immutability', () => {
    const past = (date, type) => ({
        date, mode: 'prescribed', status: 'pending',
        primarySession: { type, tier: 'beginner' },
        supportingWork: [], dailyPractice: [],
        generatedAt: '2020-01-01T00:00:00.000Z',
        generatedFrom: { programmeKey: 'size', version: 1 },
    });

    test('a past plan is carried through byte-identical', () => {
        const stored = [past('2026-03-10', 'girth')];
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'elite', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans(stored, gen, { today: '2026-03-12' });
        const kept = merged.find(p => p.date === '2026-03-10');
        expect(kept).toEqual(stored[0]);
        expect(kept.primarySession.tier).toBe('beginner');   // not re-dosed at elite
    });

    /* The replaced test asserted "the generator owns today onward, so a tier
       change propagates forward", which is the opposite of the product rule.
       Once Today exists it is historical prescription truth. It is replaced
       rather than renamed, because its assertion was wrong and not just its
       name. */

    test('1. a first cutover with no Today creates Today', () => {
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans([], gen, { today: '2026-03-12' });
        const today = merged.find(p => p.date === '2026-03-12');
        expect(today).toBeDefined();
        expect(today.primarySession.tier).toBe('intermediate');
    });

    test('2. a stored valid Today survives a repeat load byte-identical', () => {
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const once = retainPlans([], gen, { today: '2026-03-12' });
        const later = generatePlans({ key: 'size', now: at(3, 20), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const twice = retainPlans(once, later, { today: '2026-03-12' });
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });

    test('3. a same-day tier change leaves Today untouched, dose and generatedAt', () => {
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const stored = retainPlans([], gen, { today: '2026-03-12' });
        const before = stored.find(p => p.date === '2026-03-12');

        const elite = generatePlans({ key: 'size', now: at(3, 20), tier: 'elite', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans(stored, elite, { today: '2026-03-12' });
        const after = merged.find(p => p.date === '2026-03-12');

        expect(JSON.stringify(after)).toBe(JSON.stringify(before));
        expect(after.primarySession.tier).toBe('intermediate');
        expect(after.primarySession.dose.tier).toBe('intermediate');
        expect(after.generatedAt).toBe(before.generatedAt);
    });

    test('4. tomorrow onward does pick up the new tier', () => {
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const stored = retainPlans([], gen, { today: '2026-03-12' });
        const elite = generatePlans({ key: 'size', now: at(3, 20), tier: 'elite', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans(stored, elite, { today: '2026-03-12' });
        merged.filter(p => p.date > '2026-03-12' && p.primarySession).forEach(p =>
            expect(p.primarySession.tier, p.date).toBe('elite'));
    });

    test('5. an existing past plan remains byte-identical', () => {
        const stored = [past('2026-03-10', 'girth'), past('2026-03-11', 'length')];
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'elite', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans(stored, gen, { today: '2026-03-12' });
        stored.forEach(s => expect(merged.find(p => p.date === s.date)).toEqual(s));
    });

    test('6. a CORRUPT stored Today is preserved, not replaced', () => {
        /* An unreadable plan is not trustworthy programme truth, but neither
           do we know what its original valid prescription was. Regenerating
           it from the member's current programme and tier would manufacture a
           replacement and destroy the evidence that the record became
           corrupt. Preserve the ambiguity; the reader reports it and falls
           back for the rest of the day. */
        const corrupt = { date: '2026-03-12', mode: 'invented', status: 'pending' };
        expect(normaliseDayPlan(corrupt)).toBe(null);          // genuinely unreadable
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans([corrupt], gen, { today: '2026-03-12' });
        const today = merged.filter(p => p.date === '2026-03-12');
        expect(today).toHaveLength(1);
        expect(today[0]).toEqual(corrupt);
    });

    test('7. a corrupt Today does not stop tomorrow being generated', () => {
        const corrupt = { date: '2026-03-12', mode: 'invented' };
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans([corrupt], gen, { today: '2026-03-12' });
        expect(merged.filter(p => p.date > '2026-03-12')).toHaveLength(gen.length - 1);
        merged.filter(p => p.date > '2026-03-12').forEach(p =>
            expect(normaliseDayPlan(p), p.date).not.toBe(null));
    });

    test('8. after the date rolls, the new Today is generated normally', () => {
        /* Yesterday's plan, valid or corrupt, is now past and frozen. The new
           local date has no stored plan, so it is created, at the current
           tier. */
        const corrupt = { date: '2026-03-12', mode: 'invented' };
        const day1 = retainPlans([corrupt],
            generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans,
            { today: '2026-03-12' });
        const day2 = retainPlans(day1,
            generatePlans({ key: 'size', now: at(4), tier: 'elite', presets: PRESETS, tables: TABLES }).plans,
            { today: '2026-03-13' });
        expect(day2.find(p => p.date === '2026-03-12')).toEqual(corrupt);   // frozen
        const newToday = day2.find(p => p.date === '2026-03-13');
        expect(normaliseDayPlan(newToday)).not.toBe(null);
        /* 2026-03-13 was generated on day 1, at intermediate, and is now
           Today, so it is frozen exactly as it was written. Asserted byte for
           byte rather than on the tier, because that Friday is a rest day in
           the Size preset and carries no primary session to read a tier
           from. */
        const asWritten = day1.find(p => p.date === '2026-03-13');
        expect(JSON.stringify(newToday)).toBe(JSON.stringify(asWritten));
        /* And the elite regeneration did reach the days beyond it. */
        day2.filter(p => p.date > '2026-03-13' && p.primarySession).forEach(p =>
            expect(p.primarySession.tier, p.date).toBe('elite'));
    });

    test('an unchanged regeneration keeps its original generatedAt', () => {
        const first = generatePlans({ key: 'size', now: at(3, 9), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const again = generatePlans({ key: 'size', now: at(3, 18), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        expect(again[0].generatedAt).not.toBe(first[0].generatedAt);   // a later clock
        const merged = retainPlans(first, again, { today: '2026-03-12' });
        expect(merged.map(p => p.generatedAt)).toEqual(first.map(p => p.generatedAt));
    });

    test('merging is idempotent for a repeat on the same date', () => {
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const once = retainPlans([], gen, { today: '2026-03-12' });
        const twice = retainPlans(once, gen, { today: '2026-03-12' });
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });

    test('plans older than the progression window are dropped, oldest first', () => {
        const old = ['2025-12-01', '2026-01-01', '2026-03-01'].map(d => past(d, 'length'));
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans(old, gen, { today: '2026-03-12', maxPastDays: 56 });
        const dates = merged.map(p => p.date);
        expect(dates).not.toContain('2025-12-01');
        expect(dates).not.toContain('2026-01-01');
        expect(dates).toContain('2026-03-01');               // 11 days ago, inside 8 weeks
    });

    test('the count bound trims the oldest and never a generated plan', () => {
        const many = Array.from({ length: 40 }, (_, i) => {
            const d = new Date(2026, 2, 12); d.setDate(d.getDate() - (i + 1));
            return past(d.toISOString().slice(0, 10), 'length');
        });
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans(many, gen, { today: '2026-03-12', maxPlans: 20, maxPastDays: 400 });
        expect(merged).toHaveLength(20);
        gen.forEach(g => expect(merged.map(p => p.date)).toContain(g.date));
        expect(merged.map(p => p.date)).toEqual([...merged.map(p => p.date)].sort());
    });

    test('the byte budget is a backstop and is deterministic', () => {
        const many = Array.from({ length: 60 }, (_, i) => {
            const d = new Date(2026, 2, 12); d.setDate(d.getDate() - (i + 1));
            return past(d.toISOString().slice(0, 10), 'length');
        });
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const opts = { today: '2026-03-12', maxPlans: 70, maxPastDays: 400, budget: 6000 };
        const a = retainPlans(many, gen, opts);
        const b = retainPlans(many, gen, opts);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(JSON.stringify(a).length).toBeLessThanOrEqual(6000);
    });

    test('seventy plans fit inside the real budget', () => {
        const many = Array.from({ length: 60 }, (_, i) => {
            const d = new Date(2026, 2, 12); d.setDate(d.getDate() - (i + 1));
            return past(d.toISOString().slice(0, 10), 'girth');
        });
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const merged = retainPlans(many, gen, { today: '2026-03-12', maxPastDays: 400 });
        expect(merged).toHaveLength(70);
        expect(JSON.stringify(merged).length).toBeLessThan(60000);
        expect(JSON.stringify(gen[0]).length).toBeLessThan(500);
    });

    test('it does not mutate what it was given', () => {
        const stored = [past('2026-03-10', 'girth')];
        const snap = JSON.stringify(stored);
        const gen = generatePlans({ key: 'size', now: at(3), tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
        const genSnap = JSON.stringify(gen);
        retainPlans(stored, gen, { today: '2026-03-12' });
        expect(JSON.stringify(stored)).toBe(snap);
        expect(JSON.stringify(gen)).toBe(genSnap);
    });
});

describe('the cutover', () => {
    test('it refuses unless permission was granted', () => {
        /* mayGenerateOver() is the only authority gate and lives outside this
           module. Passing anything but true is a refusal. */
        [false, undefined, 'yes', 1, null].forEach(v =>
            expect(cutoverPlan({ permitted: v, programme: programme() }))
                .toEqual({ ok: false, reason: GENERATE_REFUSAL.NOT_PERMITTED }));
    });

    test('a custom member produces nothing even if permission were granted', () => {
        const r = cutover({ programme: programme({ custom: true, migration: { source: 'custom', presetKey: null } }) });
        expect(r).toEqual({ ok: false, reason: GENERATE_REFUSAL.NO_PROGRAMME_KEY });
    });

    test('an unclassified or malformed programme produces nothing', () => {
        expect(cutover({ programme: null }).reason).toBe(GENERATE_REFUSAL.NO_PROGRAMME_KEY);
        expect(cutover({ programme: {} }).reason).toBe(GENERATE_REFUSAL.NO_PROGRAMME_KEY);
        /* The shape PR D replaced put source at the top level. */
        expect(cutover({ programme: { source: 'preset', presetKey: 'size', custom: false } }).reason)
            .toBe(GENERATE_REFUSAL.NO_PROGRAMME_KEY);
    });

    test('a Thursday cutover commits eleven plans, none of them historical', () => {
        const r = cutover();
        expect(r.ok).toBe(true);
        expect(r.dayPlans).toHaveLength(11);
        expect(r.dayPlans[0].date).toBe('2026-03-12');
        expect(r.dayPlans[r.dayPlans.length - 1].date).toBe('2026-03-22');
    });

    test('the projection is the next complete week, not the partial current one', () => {
        const r = cutover();
        const projected = r.dayPlans.filter(p => p.date >= '2026-03-16' && p.date <= '2026-03-22');
        expect(projected).toHaveLength(7);
        /* Sunday-indexed: index 0 is 2026-03-22, index 1 is 2026-03-16. */
        expect(r.schedule[0]).toBe(projected.find(p => p.date === '2026-03-22').primarySession === null
            ? 'rest' : projected.find(p => p.date === '2026-03-22').primarySession.type);
        expect(r.schedule[1]).toBe(projected.find(p => p.date === '2026-03-16').primarySession.type);
    });

    test('VERSION 1: the projection is a no-op on the compatibility column', () => {
        /* The generated week IS the member's existing week, so the seven
           slots written back are the seven already there. This is why the
           server-side notification contract cannot break for the migrated
           cohort. The day a programme varies week to week, this stops being
           true and the test says which assumption went. */
        const cases = [['size', 'size'], ['stamina', 'lastLonger'], ['eq', 'erectionQuality'], ['all', 'everything']];
        cases.forEach(([presetKey, key]) => {
            for (let i = 0; i < 7; i++) {
                const r = cutover({ programme: programme({ migration: { source: 'preset', presetKey } }), now: at(i) });
                expect(r.ok, `${key}/${DAY_NAMES[i]}`).toBe(true);
                expect(r.schedule, `${key}/${DAY_NAMES[i]}`).toEqual(PRESETS[presetKey]);
                expect(r.programme.key).toBe(key);
            }
        });
    });

    test('the default cohort projects the default week back unchanged', () => {
        const r = cutover({ programme: programme({ migration: { source: 'default', presetKey: null } }) });
        expect(r.schedule).toEqual(PRESETS.size);
        expect(r.programme.key).toBe('size');
    });

    test('the committed schedule is seven slots of legacy vocabulary', () => {
        const r = cutover();
        expect(r.schedule).toHaveLength(7);
        r.schedule.forEach(s => expect(['length', 'girth', 'stamina', 'rest']).toContain(s));
    });

    test('migration provenance survives the cutover byte-identical', () => {
        const p = programme();
        const before = JSON.stringify(p.migration);
        const r = cutover({ programme: p });
        expect(JSON.stringify(r.programme.migration)).toBe(before);
    });

    test('automatic migration is not adoption', () => {
        const r = cutover();
        expect(r.programme.adoptedAt).toBe(null);
        expect(r.programme.custom).toBe(false);
        expect(r.programme.cyclePosition).toBe(null);
        expect(r.programme.version).toBe(PROGRAMME_CONTENT_VERSION);
    });

    test('a projection refusal commits nothing at all', () => {
        /* THE REFUSAL PATH, reached the only way generation can reach it: a
           weekly shape naming a day type the legacy column has no word for.
           `recovery` is a real routine type and is deliberately NOT in the
           legacy vocabulary, so a preset table carrying it produces plans
           that are individually valid and a week that cannot be projected.

           An earlier version of this test fed a hand-made support-only plan
           in as existing history, which the generated plan for that date then
           replaced, so it asserted ok: true and proved nothing. A mutation
           that treated a refusal as success survived it. */
        const broken = { ...PRESETS, size: ['recovery', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'] };
        const r = cutoverPlan({
            permitted: true, programme: programme(), existingPlans: [],
            presets: broken, tables: TABLES, tier: 'intermediate', now: at(3),
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(GENERATE_REFUSAL.PROJECTION);
        expect(r.detail).toBe('unrepresentable_days');
        expect(r.unrepresentable[0].reason).toBe('primary_type_not_in_legacy_vocabulary');
        /* Nothing to commit: no plans, no schedule, no programme. */
        expect('dayPlans' in r).toBe(false);
        expect('schedule' in r).toBe(false);
        expect('programme' in r).toBe(false);
    });

    test('a refusal names every day it could not represent', () => {
        const allRecovery = { ...PRESETS, size: Array(7).fill('recovery') };
        const r = cutoverPlan({
            permitted: true, programme: programme(), existingPlans: [],
            presets: allRecovery, tables: TABLES, tier: 'intermediate', now: at(3),
        });
        expect(r.ok).toBe(false);
        expect(r.unrepresentable).toHaveLength(7);
        expect(r.unrepresentable.map(u => u.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    test('it does not mutate the programme it was given', () => {
        const p = programme();
        const snap = JSON.stringify(p);
        cutover({ programme: p });
        expect(JSON.stringify(p)).toBe(snap);
    });
});

describe('the projection still refuses what it always refused', () => {
    /* Generation cannot reach these in this phase, which is the point: the
       guard is covered anyway, so the day supporting work arrives the refusal
       is known to still work. */
    test('a support-only day is refused rather than mapped to rest', async () => {
        const { toLegacySchedule } = await import('../src/scheduleSlot.js');
        const week = ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22']
            .map(date => ({
                date, mode: 'prescribed', status: 'pending',
                primarySession: { type: 'length', tier: 'intermediate' },
                supportingWork: [], dailyPractice: [],
            }));
        week[0] = { ...week[0], primarySession: null, supportingWork: [{ type: 'pelvicFloor' }] };
        const r = toLegacySchedule(week, new Date(2026, 2, 16, 12));
        expect(r.ok).toBe(false);
        expect(r.unrepresentable[0].reason).toBe('support_only_not_representable');
        expect('slots' in r).toBe(false);
    });

    test('a missing day is refused', async () => {
        const { toLegacySchedule } = await import('../src/scheduleSlot.js');
        const r = toLegacySchedule([], new Date(2026, 2, 16, 12));
        expect(r.ok).toBe(false);
        expect(r.unrepresentable).toHaveLength(7);
    });
});

describe('authoritative dates are the member\'s own calendar dates', () => {
    /* THE CORRECTION THIS SUITE EXISTS FOR.
     *
     * The first version keyed plans with dateKeyForWeekday, the frozen legacy
     * helper, specifically so the keys would match what the projection looked
     * them up by. src/weekUtils.js documents that helper's local-noon to UTC
     * conversion as shifting a date at extreme positive offsets, and
     * tests/weekUtils.test.js pins the UTC+14 case, so every authoritative
     * plan identity inherited a known date bug in order to agree with the
     * thing it replaces.
     *
     * These run in a subprocess per zone, because TZ is read once per
     * process. */
    const probe = (tz, dateArgs) => {
        const script = `
            import { horizonFor, planDateKey, cutoverPlan } from '${process.cwd()}/src/programmeGenerate.js';
            import { dateKeyForWeekday, localDateKeyForWeekday } from '${process.cwd()}/src/weekUtils.js';
            const PRESETS = ${JSON.stringify(PRESETS)};
            const TABLES = ${JSON.stringify(TABLES)};
            const P = { key: null, version: 1, adoptedAt: null, custom: false, cyclePosition: null,
                migration: { source: 'preset', presetKey: 'size', reason: 'r', classifiedAt: '2026-01-01' } };
            const now = new Date(${dateArgs});
            const h = horizonFor(now);
            const r = cutoverPlan({ permitted: true, programme: P, existingPlans: [],
                presets: PRESETS, tables: TABLES, tier: 'intermediate', now });
            console.log(JSON.stringify({
                weekday: now.getDay(),
                localDay: now.getDate(),
                today: h.today,
                planKey: planDateKey(now),
                first: h.dates[0],
                count: h.dates.length,
                ok: r.ok,
                firstPlanDate: r.ok ? r.dayPlans[0].date : null,
                legacyKey: dateKeyForWeekday(now, now.getDay()),
                localKey: localDateKeyForWeekday(now, now.getDay()),
            }));
        `;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
            { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
        return JSON.parse(out.trim().split('\n').pop());
    };

    test('UTC+14: a Wednesday plan is keyed Wednesday, not Tuesday', () => {
        /* 2026-03-11 is a Wednesday. At UTC+14 local noon is 22:00 UTC the
           PREVIOUS day, so the legacy helper keys it Tuesday the 10th. */
        const r = probe('Pacific/Kiritimati', '2026, 2, 11, 12');
        expect(r.weekday).toBe(3);                 // Wednesday, locally
        expect(r.localDay).toBe(11);
        expect(r.localKey).toBe('2026-03-11');     // the corrected identity
        expect(r.legacyKey).toBe('2026-03-10');    // the shift, still there
        expect(r.today).toBe('2026-03-11');
        expect(r.planKey).toBe('2026-03-11');
        expect(r.first).toBe('2026-03-11');
        expect(r.firstPlanDate).toBe('2026-03-11');
        expect(r.count).toBe(12);                  // Wednesday cutover
        expect(r.ok).toBe(true);                   // and it still projects
    }, 30_000);

    test('UTC+14 at 23:30 and 00:30 keeps the local date', () => {
        const late = probe('Pacific/Kiritimati', '2026, 2, 11, 23, 30');
        const early = probe('Pacific/Kiritimati', '2026, 2, 11, 0, 30');
        [late, early].forEach(r => {
            expect(r.today).toBe('2026-03-11');
            expect(r.firstPlanDate).toBe('2026-03-11');
            expect(r.ok).toBe(true);
        });
    }, 30_000);

    test('UTC+13 and UTC-11 agree with the local calendar too', () => {
        const cases = [['Pacific/Apia', 3], ['Pacific/Pago_Pago', 3]];
        cases.forEach(([tz]) => {
            const r = probe(tz, '2026, 2, 11, 12');
            expect(r.today, tz).toBe('2026-03-11');
            expect(r.localKey, tz).toBe('2026-03-11');
            expect(r.firstPlanDate, tz).toBe('2026-03-11');
            expect(r.ok, tz).toBe(true);
        });
    }, 30_000);

    test('every generated plan is findable by the projection, in every zone', () => {
        /* The property that made the original mistake tempting, now held by
           one shared LOCAL helper instead of one shared legacy one. If
           generation and lookup ever drift apart, the projection refuses with
           no_plan and this fails. */
        ['UTC', 'Pacific/Kiritimati', 'Pacific/Apia', 'Pacific/Pago_Pago',
         'America/New_York', 'Asia/Kolkata'].forEach(tz => {
            for (let d = 9; d <= 15; d++) {
                const r = probe(tz, `2026, 2, ${d}, 12`);
                expect(r.ok, `${tz} day ${d}`).toBe(true);
                expect(r.firstPlanDate, `${tz} day ${d}`).toBe(r.today);
            }
        });
    }, 120_000);
});

describe('the retention cutoff is a local calendar date too', () => {
    /* THE LAST UTC LEAK. `today` is an authoritative local date key, and the
       cutoff compared against stored plan dates has to be one as well.
       Deriving it through toISOString() put it a day early at UTC+13 and
       UTC+14, which drops a plan sitting exactly on the boundary: the same
       shift generation had already shed, left behind in retention.
       Subprocess per zone, so the host timezone cannot decide the result. */
    const probe = (tz) => {
        const script = `
            import { retainPlans, generatePlans } from '${process.cwd()}/src/programmeGenerate.js';
            const PRESETS = ${JSON.stringify(PRESETS)};
            const TABLES = ${JSON.stringify(TABLES)};
            const TODAY = '2026-03-12';
            const back = (n) => {
                const d = new Date(TODAY + 'T12:00:00');
                d.setDate(d.getDate() - n);
                const p = (x) => String(x).padStart(2, '0');
                return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
            };
            const plan = (date) => ({
                date, mode: 'prescribed', status: 'pending',
                primarySession: { type: 'length', tier: 'beginner' },
                supportingWork: [], dailyPractice: [],
                generatedAt: '2020-01-01T00:00:00.000Z',
                generatedFrom: { programmeKey: 'size', version: 1 },
            });
            const onBoundary = back(56);
            const pastBoundary = back(57);
            const gen = generatePlans({ key: 'size', now: new Date(2026, 2, 12, 12),
                tier: 'intermediate', presets: PRESETS, tables: TABLES }).plans;
            const merged = retainPlans([plan(pastBoundary), plan(onBoundary)], gen,
                { today: TODAY, maxPastDays: 56, maxPlans: 999 });
            const dates = merged.map(p => p.date);
            console.log(JSON.stringify({
                onBoundary, pastBoundary,
                keptOnBoundary: dates.includes(onBoundary),
                keptPastBoundary: dates.includes(pastBoundary),
            }));
        `;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
            { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
        return JSON.parse(out.trim().split('\n').pop());
    };

    test.each([['UTC'], ['Pacific/Kiritimati']])('%s: exactly 56 days back is retained, 57 is dropped', (tz) => {
        const r = probe(tz);
        /* The dates themselves are local-calendar arithmetic from today, so
           they are the same strings in every zone. */
        expect(r.onBoundary).toBe('2026-01-15');
        expect(r.pastBoundary).toBe('2026-01-14');
        expect(r.keptOnBoundary, `${tz}: the boundary plan must survive`).toBe(true);
        expect(r.keptPastBoundary, `${tz}: a day past the boundary must go`).toBe(false);
    }, 30_000);

    test('UTC+13 and a zone behind UTC agree as well', () => {
        [['Pacific/Apia'], ['America/New_York']].forEach(([tz]) => {
            const r = probe(tz);
            expect(r.keptOnBoundary, tz).toBe(true);
            expect(r.keptPastBoundary, tz).toBe(false);
        });
    }, 30_000);
});

describe('local dates survive a timezone behind UTC', () => {
    /* The W2 lesson. Every date key comes from dateKeyForWeekday, the same
       helper the projection uses to look plans up, so the two agree by
       construction rather than by two formulas matching. This proves the
       whole chain in a zone where a naive UTC slice would shift the day. */
    test('a late-evening cutover in New York generates the same horizon', () => {
        const script = `
            import { horizonFor, cutoverPlan } from '${process.cwd()}/src/programmeGenerate.js';
            const PRESETS = ${JSON.stringify(PRESETS)};
            const TABLES = ${JSON.stringify(TABLES)};
            const P = { key: null, version: 1, adoptedAt: null, custom: false, cyclePosition: null,
                migration: { source: 'preset', presetKey: 'size', reason: 'r', classifiedAt: '2026-03-01' } };
            const now = new Date(2026, 2, 12, 23, 30);
            const h = horizonFor(now);
            const r = cutoverPlan({ permitted: true, programme: P, existingPlans: [],
                presets: PRESETS, tables: TABLES, tier: 'intermediate', now });
            console.log(JSON.stringify({ today: h.today, count: h.dates.length,
                first: h.dates[0], ok: r.ok, schedule: r.schedule }));
        `;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
            { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
        const got = JSON.parse(out.trim().split('\n').pop());
        expect(got.today).toBe('2026-03-12');
        expect(got.count).toBe(11);
        expect(got.first).toBe('2026-03-12');
        expect(got.ok).toBe(true);
        expect(got.schedule).toEqual(PRESETS.size);
    }, 30_000);
});
