import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    WARMUP_SECONDS, DELOAD_SHAPE, MODERATE_SORENESS_SHAPE,
    applyShape, restSecondsFor, exerciseSeconds, girthCircuitSeconds,
    estimateSessionSeconds, estimateSessionMinutes,
} from '../src/sessionDuration.js';

/**
 * An estimate that does not match the clock is worse than no estimate, so
 * these use the real shipped numbers rather than convenient ones, and the
 * last block asserts those numbers are still what index.html contains.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const html = readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');

const DIFFICULTIES = [
    { id: 'beginner', durationMult: 0.5, setsOffset: -1 },
    { id: 'intermediate', durationMult: 1.0, setsOffset: 0 },
    { id: 'advanced', durationMult: 1.5, setsOffset: +1 },
    { id: 'elite', durationMult: 2.0, setsOffset: +2 },
];
const GIRTH_CIRCUIT = {
    beginner: { rounds: 3, jelqDur: 60, uliDur: 30, restDur: 30 },
    intermediate: { rounds: 4, jelqDur: 120, uliDur: 45, restDur: 45 },
    advanced: { rounds: 5, jelqDur: 150, uliDur: 60, restDur: 60 },
    elite: { rounds: 5, jelqDur: 180, uliDur: 60, restDur: 60 },
};
const ROUTINES = {
    length: [
        { title: 'Directional Pulls', sets: 3, duration: 30 },
        { title: 'V-Stretch', sets: 3, duration: 30 },
    ],
    girth: [
        { title: 'Wet Jelq', sets: 1, duration: 120 },
        { title: 'Uli — Manual Clamp', sets: 1, duration: 45 },
    ],
    stamina: [
        { title: 'Edging — Controlled Hold', sets: 3, duration: 120 },
        { title: 'Lateral Compression', sets: 3, duration: 15, restDur: 30 },
    ],
    recovery: [
        { title: 'Kegel Contractions', sets: 3, duration: 60 },
        { title: 'Reverse Kegel Stretch', sets: 3, duration: 45 },
        { title: 'Pelvic Floor Release', sets: 3, duration: 45 },
        { title: 'Pelvic Floor Endurance Hold', sets: 3, duration: 60 },
        { title: 'Deep Squat — Malasana', sets: 2, duration: 60 },
        { title: 'Happy Baby', sets: 2, duration: 45 },
        { title: 'Pigeon Pose', sets: 2, duration: 60 },
        { title: 'Butterfly Stretch', sets: 2, duration: 45 },
    ],
};
const base = { routines: ROUTINES, difficulties: DIFFICULTIES, girthCircuit: GIRTH_CIRCUIT };
const at = (difficulty, extra) => ({ ...base, difficulty, ...extra });

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------
describe('applyShape', () => {
    test('mirrors applyDifficulty for each tier', () => {
        const ex = { sets: 3, duration: 30 };
        expect(applyShape(ex, { setsOffset: -1, durationMult: 0.5 })).toMatchObject({ sets: 2, duration: 15 });
        expect(applyShape(ex, { setsOffset: 0, durationMult: 1.0 })).toMatchObject({ sets: 3, duration: 30 });
        expect(applyShape(ex, { setsOffset: +2, durationMult: 2.0 })).toMatchObject({ sets: 5, duration: 60 });
    });

    test('sets never fall below one, so a shape cannot delete an exercise', () => {
        expect(applyShape({ sets: 1, duration: 60 }, { setsOffset: -3 }).sets).toBe(1);
    });

    test('deload and moderate soreness are the same shape', () => {
        expect(MODERATE_SORENESS_SHAPE).toEqual(DELOAD_SHAPE);
    });
});

describe('restSecondsFor', () => {
    test('an explicit restDur wins', () => {
        expect(restSecondsFor({ duration: 15, restDur: 30 })).toBe(30);
    });
    test('otherwise a third of the set, floored at 20', () => {
        expect(restSecondsFor({ duration: 30 })).toBe(20);   // 10 -> 20
        expect(restSecondsFor({ duration: 120 })).toBe(40);
    });
    test('capped at 90', () => {
        expect(restSecondsFor({ duration: 600 })).toBe(90);  // 200 -> 90
    });
});

describe('exerciseSeconds', () => {
    test('rests between sets, not after the last one', () => {
        // 3 x 30s work, two 20s rests. Not three.
        expect(exerciseSeconds({ sets: 3, duration: 30 })).toBe(90 + 40);
    });
    test('a single set has no rest at all', () => {
        expect(exerciseSeconds({ sets: 1, duration: 120 })).toBe(120);
    });
});

describe('girthCircuitSeconds', () => {
    test('rounds of jelq plus uli, with rest between rounds only', () => {
        // 4 x (120 + 45) + 3 x 45
        expect(girthCircuitSeconds(GIRTH_CIRCUIT.intermediate, [])).toBe(660 + 135);
    });
    test('deload shortens the work but not the inter-round rest', () => {
        // 4 x (72 + 27) + 3 x 45
        expect(girthCircuitSeconds(GIRTH_CIRCUIT.intermediate, [DELOAD_SHAPE])).toBe(396 + 135);
    });
});

// ---------------------------------------------------------------------------
// Whole sessions, at each difficulty
// ---------------------------------------------------------------------------
describe('estimateSessionSeconds', () => {
    test('length at intermediate, with the warmup', () => {
        // two exercises x (3 x 30 + 2 x 20), plus the 10 minute warmup
        expect(estimateSessionSeconds('length', at('intermediate'))).toBe(260 + WARMUP_SECONDS);
    });

    test('length at beginner is shorter in both sets and holds', () => {
        // two exercises x (2 x 15 + 1 x 20)
        expect(estimateSessionSeconds('length', at('beginner'))).toBe(100 + WARMUP_SECONDS);
    });

    test('length at elite is longer', () => {
        // sets 5, duration 60, rest 20 -> 5 x 60 + 4 x 20
        expect(estimateSessionSeconds('length', at('elite'))).toBe(2 * 380 + WARMUP_SECONDS);
    });

    test('girth uses the circuit table, not the difficulty table', () => {
        expect(estimateSessionSeconds('girth', at('intermediate'))).toBe(795 + WARMUP_SECONDS);
        expect(estimateSessionSeconds('girth', at('beginner'))).toBe(3 * 90 + 2 * 30 + WARMUP_SECONDS);
    });

    test('stamina runs with no warmup', () => {
        // 3x120 + 2x40, then 3x15 + 2x30
        expect(estimateSessionSeconds('stamina', at('intermediate'))).toBe(440 + 105);
    });

    test('recovery runs with no warmup, no difficulty and no deload', () => {
        const all = estimateSessionSeconds('recovery', at('intermediate'));
        expect(all).toBe(1290);
        // Difficulty must not move it: getCurEx() returns recovery as written.
        expect(estimateSessionSeconds('recovery', at('elite'))).toBe(all);
        expect(estimateSessionSeconds('recovery', at('elite', { deload: true }))).toBe(all);
    });

    test('recovery counts only the selected exercises', () => {
        // The night set: the four pelvic floor exercises.
        expect(estimateSessionSeconds('recovery', at('intermediate', { recoveryIndices: [0, 1, 2, 3] }))).toBe(790);
    });

    test('an empty recovery selection is zero, not the whole library', () => {
        expect(estimateSessionSeconds('recovery', at('intermediate', { recoveryIndices: [] }))).toBe(0);
    });

    test('deload shortens a training session', () => {
        const normal = estimateSessionSeconds('length', at('intermediate'));
        const deloaded = estimateSessionSeconds('length', at('intermediate', { deload: true }));
        expect(deloaded).toBeLessThan(normal);
        // 2 x (2 sets x 18s) with one 20s rest
        expect(deloaded).toBe(2 * (36 + 20) + WARMUP_SECONDS);
    });

    test('moderate soreness shortens it the same way deload does', () => {
        expect(estimateSessionSeconds('length', at('intermediate', { moderateSoreness: true })))
            .toBe(estimateSessionSeconds('length', at('intermediate', { deload: true })));
    });

    test('deload and moderate soreness stack', () => {
        const both = estimateSessionSeconds('length', at('intermediate', { deload: true, moderateSoreness: true }));
        expect(both).toBeLessThan(estimateSessionSeconds('length', at('intermediate', { deload: true })));
    });

    test('includeWarmup can be overridden either way', () => {
        expect(estimateSessionSeconds('length', at('intermediate', { includeWarmup: false }))).toBe(260);
        expect(estimateSessionSeconds('stamina', at('intermediate', { includeWarmup: true }))).toBe(545 + WARMUP_SECONDS);
    });

    test('an unknown mission is zero rather than a throw', () => {
        expect(estimateSessionSeconds('banana', at('intermediate'))).toBe(0);
        expect(estimateSessionSeconds(undefined, at('intermediate'))).toBe(0);
    });

    test('missing tables do not throw', () => {
        expect(estimateSessionSeconds('length', {})).toBe(WARMUP_SECONDS);
        expect(estimateSessionSeconds('girth', { routines: {} })).toBe(WARMUP_SECONDS);
        expect(estimateSessionMinutes('recovery', {})).toBe(0);
    });

    test('an unknown difficulty falls back the way the app does', () => {
        // getCurEx() falls back to GIRTH_CIRCUIT.intermediate for girth.
        expect(estimateSessionSeconds('girth', at('nonsense')))
            .toBe(estimateSessionSeconds('girth', at('intermediate')));
        // Length has no fallback tier: no shape is applied, so the base numbers stand.
        expect(estimateSessionSeconds('length', at('nonsense'))).toBe(260 + WARMUP_SECONDS);
    });
});

describe('estimateSessionMinutes', () => {
    test('the numbers the UI will actually show', () => {
        expect(estimateSessionMinutes('length', at('intermediate'))).toBe(14);
        expect(estimateSessionMinutes('girth', at('intermediate'))).toBe(23);
        expect(estimateSessionMinutes('stamina', at('intermediate'))).toBe(9);
        expect(estimateSessionMinutes('recovery', at('intermediate', { recoveryIndices: [0, 1, 2, 3] }))).toBe(13);
    });

    test('zero stays zero rather than rounding up to a minute', () => {
        expect(estimateSessionMinutes('recovery', at('intermediate', { recoveryIndices: [] }))).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Drift guard
//
// The fixtures above are a copy of what index.html ships. A copy is only safe
// while it is still true, so assert the originals have not moved. If one of
// these fails, the fixtures are stale and every number above is lying.
// ---------------------------------------------------------------------------
describe('fixtures still match app/index.html', () => {
    test('the difficulty multipliers', () => {
        expect(html).toContain("id:'beginner',     label:'Beginner',     durationMult:.5,  setsOffset:-1");
        expect(html).toContain("id:'intermediate', label:'Intermediate', durationMult:1.0, setsOffset: 0");
        expect(html).toContain("id:'advanced',     label:'Advanced',     durationMult:1.5, setsOffset:+1");
        expect(html).toContain("id:'elite',        label:'Elite',        durationMult:2.0, setsOffset:+2");
    });

    test('the girth circuit table', () => {
        expect(html).toContain('beginner:     {rounds:3, jelqDur:60,  uliDur:30, restDur:30}');
        expect(html).toContain('intermediate: {rounds:4, jelqDur:120, uliDur:45, restDur:45}');
        expect(html).toContain('advanced:     {rounds:5, jelqDur:150, uliDur:60, restDur:60}');
        expect(html).toContain('elite:        {rounds:5, jelqDur:180, uliDur:60, restDur:60}');
    });

    test('the rest formula', () => {
        expect(html).toContain('const restDur=ex.restDur||Math.min(90,Math.max(20,Math.round(ex.duration/3)));');
    });

    test('rest runs only between sets', () => {
        expect(html).toContain('if(session.setIndex<ex.sets)startRest();else advanceEx()');
    });

    test('recovery takes neither difficulty nor deload, girth takes deload only', () => {
        expect(html).toContain('if(ex.isRecovery) return ex;');
        expect(html).toContain('return applyDeload({...ex, sets:1, duration:dur});');
        expect(html).toContain('return applyDeload(applyDifficulty(ex));');
    });

    test('the per-exercise sets and durations', () => {
        for (const [title, sets, duration] of [
            ['Kegel Contractions', 3, 60], ['Reverse Kegel Stretch', 3, 45],
            ['Pelvic Floor Release', 3, 45], ['Pelvic Floor Endurance Hold', 3, 60],
            ['Deep Squat — Malasana', 2, 60], ['Happy Baby', 2, 45],
            ['Pigeon Pose', 2, 60], ['Butterfly Stretch', 2, 45],
        ]) {
            const i = html.indexOf(`title:'${title}'`);
            expect(i, `${title} is no longer in ROUTINES`).toBeGreaterThan(-1);
            expect(html.slice(i, i + 900)).toContain(`sets:${sets}, duration:${duration}`);
        }
        // These two are written without the space after the comma.
        expect(html).toContain("{title:'Directional Pulls',sets:3,duration:30");
        expect(html).toContain("{title:'V-Stretch',sets:3,duration:30");
    });

    test('the stamina exercises', () => {
        expect(html).toContain('sets:3, duration:120,');
        expect(html).toContain('sets:3, duration:15, restDur:30,');
    });

    test('the warmup is ten minutes', () => {
        expect(html).toContain("document.getElementById('warmup-timer').innerText='10:00'");
        expect(WARMUP_SECONDS).toBe(600);
    });
});
