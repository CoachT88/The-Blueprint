/**
 * How long is today's session, in minutes?
 *
 * The app has always been able to answer this, but only by running the
 * session: the number lived in the timers. Nothing could state it up front,
 * which is why Mission Select asks a member to choose between four things
 * without telling them what any of them costs.
 *
 * This file is that answer, computed the same way the session computes it.
 * It is deliberately a mirror rather than a new model: if these numbers do not
 * match the clock a member actually experiences, the estimate is worse than
 * no estimate at all. The mirrored behaviour is noted against each rule below,
 * with the line it mirrors in app/index.html.
 *
 * Pure: no DOM, no globals, no clock. Exercise data and the difficulty table
 * are passed in, so there is one definition of each and no second copy to
 * drift. Nothing in index.html calls this yet; wiring is Phase 2A.2.
 */

/**
 * The warmup phase, in seconds. Length and Girth run it before any work
 * because cold tissue does not stretch; Stamina and Recovery start straight
 * away (see the Manual, "After the pre-flight check you pick your mission").
 */
export const WARMUP_SECONDS = 600;

/** Missions that run the warmup phase. */
export const WARMUP_MISSIONS = ['length', 'girth'];

/**
 * Deload: an additional -1 set and x0.6 duration on top of difficulty.
 * Mirrors applyDeload() in index.html.
 */
export const DELOAD_SHAPE = { setsOffset: -1, durationMult: 0.6 };

/**
 * Moderate soreness reuses the deload shape.
 *
 * This is a conservative programming heuristic chosen for consistency with a
 * reduction the app already applies, and for simplicity. It is NOT a medically
 * established "moderate soreness protocol", and nothing in the product should
 * present the exact numbers as clinically validated. The member-facing reason
 * says only that the session was reduced because they reported moderate
 * muscle soreness.
 */
export const MODERATE_SORENESS_SHAPE = { setsOffset: -1, durationMult: 0.6 };

/**
 * Apply one volume shape to an exercise.
 *
 * Mirrors both applyDifficulty() and applyDeload(), which are the same
 * operation with different constants. Sets floor at 1: a shape can reduce a
 * session but never delete an exercise.
 */
export function applyShape(ex, shape) {
    const setsOffset = (shape && shape.setsOffset) || 0;
    const durationMult = shape && typeof shape.durationMult === 'number' ? shape.durationMult : 1;
    return {
        ...ex,
        sets: Math.max(1, (ex.sets || 1) + setsOffset),
        duration: Math.round((ex.duration || 0) * durationMult),
    };
}

/** Apply shapes left to right, skipping falsy entries so callers can inline conditionals. */
export function applyShapes(ex, shapes) {
    return (shapes || []).filter(Boolean).reduce((acc, s) => applyShape(acc, s), ex);
}

/**
 * Rest between two sets of the same exercise.
 *
 * Mirrors startRest(): an explicit restDur if the exercise declares one,
 * otherwise a third of the set length, clamped to 20-90s. Takes the shaped
 * exercise, because startRest() reads getCurEx(), which is already shaped.
 */
export function restSecondsFor(ex) {
    if (ex && typeof ex.restDur === 'number') return ex.restDur;
    const duration = (ex && ex.duration) || 0;
    return Math.min(90, Math.max(20, Math.round(duration / 3)));
}

/**
 * Work plus intra-exercise rest for one exercise.
 *
 * Rest runs between sets and not after the last one: the session calls
 * startRest() only while setIndex < sets, and otherwise advances. So
 * sets - 1 rests, never sets.
 */
export function exerciseSeconds(ex) {
    const sets = Math.max(1, (ex && ex.sets) || 1);
    const duration = (ex && ex.duration) || 0;
    return sets * duration + (sets - 1) * restSecondsFor(ex);
}

/**
 * Girth is a round-based circuit, not sets, so it does not go through the
 * difficulty table: GIRTH_CIRCUIT already carries a per-difficulty config.
 * Deload still applies (getCurEx wraps the circuit exercise in applyDeload).
 *
 * Within a round, Jelq runs straight into Uli with no rest. Rest happens
 * between rounds, and not after the final one, which goes straight to the
 * success screen.
 */
export function girthCircuitSeconds(cfg, shapes) {
    if (!cfg) return 0;
    const rounds = Math.max(1, cfg.rounds || 1);
    const jelq = applyShapes({ sets: 1, duration: cfg.jelqDur || 0 }, shapes);
    const uli = applyShapes({ sets: 1, duration: cfg.uliDur || 0 }, shapes);
    const work = rounds * (exerciseSeconds(jelq) + exerciseSeconds(uli));
    return work + (rounds - 1) * (cfg.restDur || 0);
}

/**
 * Seconds for a whole session.
 *
 * opts:
 *   routines          { length:[], girth:[], stamina:[], recovery:[] }  required
 *   difficulties      the DIFFICULTIES table                            required for length/stamina
 *   girthCircuit      the GIRTH_CIRCUIT table                           required for girth
 *   difficulty        'beginner' | 'intermediate' | 'advanced' | 'elite'
 *   deload            boolean
 *   moderateSoreness  boolean
 *   recoveryIndices   which recovery exercises are selected
 *   includeWarmup     defaults to true for length and girth
 *
 * Returns 0 for an unknown mission or missing data rather than throwing: a
 * duration estimate must never be the thing that breaks a prescription.
 */
export function estimateSessionSeconds(mission, opts) {
    const o = opts || {};
    const routines = o.routines || {};
    const deload = o.deload ? DELOAD_SHAPE : null;
    const sore = o.moderateSoreness ? MODERATE_SORENESS_SHAPE : null;

    const warmup = (o.includeWarmup === undefined ? WARMUP_MISSIONS.includes(mission) : !!o.includeWarmup)
        ? WARMUP_SECONDS : 0;

    if (mission === 'girth') {
        const table = o.girthCircuit || {};
        const cfg = table[o.difficulty] || table.intermediate;
        return warmup + girthCircuitSeconds(cfg, [deload, sore]);
    }

    if (mission === 'recovery') {
        // Recovery exercises are run exactly as written: getCurEx() returns
        // them before difficulty or deload is applied. The prescribed volume
        // is already low, and scaling it would mostly mean scaling it away.
        const list = routines.recovery || [];
        const picked = Array.isArray(o.recoveryIndices) ? o.recoveryIndices : list.map((_, i) => i);
        return warmup + picked.reduce((sum, i) => sum + (list[i] ? exerciseSeconds(list[i]) : 0), 0);
    }

    if (mission === 'length' || mission === 'stamina') {
        const diff = (o.difficulties || []).find(d => d.id === o.difficulty);
        const diffShape = diff ? { setsOffset: diff.setsOffset, durationMult: diff.durationMult } : null;
        const list = routines[mission] || [];
        return warmup + list.reduce(
            (sum, ex) => sum + exerciseSeconds(applyShapes(ex, [diffShape, deload, sore])), 0);
    }

    return 0;
}

/** The same number in whole minutes, which is the only unit the UI shows. */
export function estimateSessionMinutes(mission, opts) {
    const seconds = estimateSessionSeconds(mission, opts);
    return seconds > 0 ? Math.round(seconds / 60) : 0;
}
