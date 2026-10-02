# Phase 2A.1 — consolidated implementation packet

PR #76 · branch `claude/deploy-edge-function-U4G2J` · commits `d15c693`, `056d427` · base `main` @ `2160d67`

Raw source of everything added or changed, for independent review without repository access.

---

# 1. FULL `src/nextBestAction.js`

```js
/**
 * One question, answered once, in one place: what should this member do now?
 *
 * Today that decision is spread across renderMissionGuidance(), isBlackoutDay(),
 * the soreness modal, the recovery picker and the deload banner. Each reads
 * globals and writes innerHTML, none of them can be called by anything else,
 * and none of them can be tested. The member sees four equal buttons and is
 * asked to work out the answer themselves.
 *
 * This file is the decision, extracted. It is pure: every input is an argument,
 * including the clock, so every case is reproducible and the precedence is
 * something a test can assert rather than something a reviewer has to trust.
 *
 * It resolves the CURRENT BEST ACTION. It never manufactures work to fill a
 * screen. When there is nothing required, that is the answer, and the absence
 * of another task is part of the reward.
 *
 * Nothing in index.html calls this yet. Wiring is Phase 2A.2 onward; the shape
 * is deliberately presentation-free so that wiring is a thin adapter.
 */
import { getISOWeek } from './weekUtils.js';

/** The seven states. OPTIONAL is not one of them: see `optional` on the result. */
export const STATES = ['PREPARE', 'RESUME', 'TRAIN', 'MODIFIED', 'RECOVER', 'REST', 'COMPLETE'];

/** Missions that are mechanical training. */
export const TRAINING_MISSIONS = ['length', 'girth', 'stamina'];

/** Why a PREPARE was returned. The UI must be able to explain which gate it hit. */
export const PREPARE_REASONS = ['loading', 'goal', 'pelvic-screen'];

/** Weeks of history before deload applies, mirroring isDeloadWeek(). */
const DELOAD_MIN_WEEKS = 4;

/**
 * Deload week, mirrored from isDeloadWeek() in index.html with the clock
 * passed in. Every fourth ISO week, but not until the member has four weeks
 * of history, so a new member does not deload in their first month.
 */
export function isDeloadWeek(firstSessionDate, now) {
    if (!firstSessionDate) return false;
    const started = new Date(firstSessionDate).getTime();
    if (!Number.isFinite(started)) return false;
    const weeks = Math.floor((now.getTime() - started) / (7 * 24 * 60 * 60 * 1000));
    if (weeks < DELOAD_MIN_WEEKS) return false;
    return getISOWeek(now) % 4 === 0;
}

/** A screener answer we recognise. Anything else means not screened. */
export function hasPelvicScreen(profile) {
    return profile === 'tight' || profile === 'standard';
}

/**
 * Does this prescription involve pelvic floor specific work?
 *
 * Only Recovery contains contraction exercises today, so a scheduled Length,
 * Girth or Stamina day is never pelvic specific. The check is written against
 * the exercise indices rather than the mission name so that it stays correct
 * when the library changes.
 */
export function isPelvicSpecific(mission, recoveryIndices, contractionIndices) {
    if (mission !== 'recovery') return false;
    const plan = Array.isArray(recoveryIndices) ? recoveryIndices : [];
    const contraction = Array.isArray(contractionIndices) ? contractionIndices : [];
    return plan.some(i => contraction.includes(i));
}

/**
 * The recovery exercises this member can actually be given.
 *
 * Mirrors isExerciseBlocked(): contraction work is withheld from a tight floor
 * and from a floor nobody has screened. Returned on the result rather than
 * applied invisibly, so the UI can say which exercises are missing and why.
 */
export function allowedRecoveryPlan(recoveryIndices, contractionIndices, { screened, tightFloor }) {
    const plan = Array.isArray(recoveryIndices) ? recoveryIndices : [];
    const contraction = Array.isArray(contractionIndices) ? contractionIndices : [];
    if (screened && !tightFloor) return plan;
    return plan.filter(i => !contraction.includes(i));
}

/* ── Reasons ───────────────────────────────────────────────────────────────
   One sentence each, member facing, no em dashes. These say what and why.
   They never quantify the evidence behind a programming choice, because the
   choices below are product heuristics and not clinical protocols. */
const REASONS = {
    loading: 'Loading your training data.',
    goal: 'Pick your primary goal so today can be prescribed around it.',
    pelvicScreen: 'Before we prescribe pelvic floor work, we need to know whether your floor tends to stay tight.',
    resume: 'You left a session unfinished.',
    complete: 'Today is done.',
    highSoreness: 'Mechanical training is on hold today because you reported high muscle soreness.',
    rest: 'Rest is on the schedule today, and it is part of the programme.',
    moderateSoreness: 'Reduced today because you reported moderate muscle soreness.',
    unscheduled: 'Nothing is scheduled for today, so this follows your goal.',
};

const CHANGES = {
    deload: 'This is a deload week, so the volume is lower than usual.',
    tightFloor: 'Contraction work is left out because your screener flagged a tight floor.',
    moderateSoreness: 'One set fewer and shorter holds than a normal session.',
    pelvicScreenRequired: 'Take the pelvic floor check to unlock contraction work.',
};

/**
 * nextBestAction(input) -> the prescription.
 *
 * INPUT. Everything the decision depends on, and nothing else.
 *
 *   dataLoaded        has persisted state actually loaded (not merely defaulted)
 *   now               Date. Required; there is no implicit clock.
 *   goals             the GOALS table, passed in so there is no second copy
 *   goalKey           persisted.primaryGoal
 *   schedule          persisted.schedule, seven entries by Date#getDay()
 *   completedDays     persisted.completedDays, seven booleans
 *   sessionDraft      the unfinished session, or null
 *   soreness          '' | 'none' | 'mild' | 'moderate' | 'high'
 *   pelvicProfile     '' | 'tight' | 'standard'
 *   firstSessionDate  for the deload rule
 *   dayTypes          the DAY_TYPES table, for labels inside reasons
 *   recoveryPlan      recovery exercise indices a Recovery prescription would use
 *   contractionIndices  CONTRACTION_RECOVERY_IDX
 *   estimateMinutes   optional (mission, opts) => number, usually sessionDuration's
 *
 * OUTPUT. Enough for the UI to say what to do, why, how long, what changed and
 * whether an override exists, without reverse engineering any of it.
 *
 *   state             one of STATES
 *   mission           what to actually run, or null
 *   reason            one sentence, member facing
 *   duration          minutes, or null when the prescription is not a session
 *   modifiers         { deload, tightFloor, moderateSoreness, pelvicScreenRequired }
 *   overrideAllowed   may the UI offer a path that departs from this prescription
 *   optional          a quiet secondary offer, or null
 *   changes           short sentences naming what is different from a normal day
 *   prepare           which gate a PREPARE hit, else null
 *   intendedMission   what was going to be prescribed before a gate intervened
 */
export function nextBestAction(input) {
    const i = input || {};
    const now = i.now instanceof Date ? i.now : new Date(0);
    const goals = i.goals || {};
    const goal = goals[i.goalKey];
    const soreness = i.soreness || '';
    const schedule = Array.isArray(i.schedule) ? i.schedule : [];
    const completedDays = Array.isArray(i.completedDays) ? i.completedDays : [];
    const today = now.getDay();
    const scheduled = schedule[today];
    const screened = hasPelvicScreen(i.pelvicProfile);
    const estimate = typeof i.estimateMinutes === 'function' ? i.estimateMinutes : null;

    const modifiers = {
        deload: isDeloadWeek(i.firstSessionDate, now),
        tightFloor: i.pelvicProfile === 'tight',
        moderateSoreness: false,
        pelvicScreenRequired: false,
    };

    /* Narrowed once, up front, because both the duration and the gate below
       depend on which recovery exercises this member can actually be given. */
    const recoveryPlan = allowedRecoveryPlan(i.recoveryPlan, i.contractionIndices,
        { screened, tightFloor: modifiers.tightFloor });

    const minutes = (mission, extra) => {
        if (!estimate || !mission) return null;
        const n = estimate(mission, {
            deload: modifiers.deload,
            moderateSoreness: !!(extra && extra.moderateSoreness),
            recoveryIndices: recoveryPlan,
        });
        return typeof n === 'number' && n > 0 ? n : null;
    };

    /* ── Precedence. First match wins. ─────────────────────────────────────
       The order is the product decision, so it is written as one visible
       ladder rather than nested conditions. Safety sits above programming,
       programming above preference, and nothing below an unanswered question
       the app needs the answer to.

         1  no data            we do not know anything yet, so prescribe nothing
         2  unfinished session finishing it beats starting something else
         3  no goal            every prescription below depends on this
         4  already complete   never manufacture a second task
         5  high soreness      withheld, and not overridable
         6  scheduled rest     rest is a prescription, not an absence of one
         7  moderate soreness  reduced, still trained
         8  scheduled mission  the ordinary case
         9  no usable schedule fall back to the goal rather than to nothing      */

    let state, mission = null, reason = '', prepare = null, intendedMission = null;

    if (!i.dataLoaded) {
        state = 'PREPARE'; prepare = 'loading'; reason = REASONS.loading;
    } else if (i.sessionDraft) {
        state = 'RESUME';
        mission = i.sessionDraft.routineType || null;
        reason = REASONS.resume;
    } else if (!goal) {
        state = 'PREPARE'; prepare = 'goal'; reason = REASONS.goal;
    } else if (completedDays[today] === true) {
        state = 'COMPLETE'; reason = REASONS.complete;
    } else if (soreness === 'high') {
        state = 'RECOVER'; mission = 'recovery'; reason = REASONS.highSoreness;
    } else if (scheduled === 'rest') {
        state = 'REST'; reason = REASONS.rest;
    } else if (soreness === 'moderate') {
        state = 'MODIFIED';
        mission = TRAINING_MISSIONS.includes(scheduled) ? scheduled : goal.mission;
        modifiers.moderateSoreness = true;
        reason = REASONS.moderateSoreness;
    } else if (TRAINING_MISSIONS.includes(scheduled)) {
        state = 'TRAIN'; mission = scheduled;
        reason = `Today is a ${labelFor(scheduled)} day on your schedule.`;
    } else {
        /* Unrecognised or missing. getScheduledType() treats this as a rest
           day, which quietly turns a corrupt array into a week off. Falling
           back to the goal's own mission keeps the member training while the
           schedule is repaired. */
        state = 'TRAIN'; mission = goal.mission;
        reason = REASONS.unscheduled;
    }

    /* ── The pelvic screener gate ──────────────────────────────────────────
       Applied after the ladder rather than inside it, because what it does
       depends on what was prescribed.

       On a training prescription it is a PREPARE: six questions stand between
       the member and work that could be wrong for them.

       On RECOVER or REST it is not a state but a flag plus a narrowed plan.
       Those two are where a sore or resting member lands, and putting a
       questionnaire in front of someone who has just reported high soreness
       answers a safety signal with paperwork. Instead the contraction work
       comes out of `recoveryPlan`, `pelvicScreenRequired` goes true and
       `changes` names the screener, so the removal is visible and reversible
       rather than silent, and the member still has something to do today.

       Flagged for reviewer sign off before 2A.2. */
    /* REST and COMPLETE prescribe no mission of their own, but both offer
       Active Recovery, and that offer is where contraction work would appear.
       So the gate is evaluated against what is on the screen, not only
       against `mission`. */
    const pelvicCandidate = mission || ((state === 'REST' || state === 'COMPLETE') ? 'recovery' : null);
    const prescriptionIsPelvic = isPelvicSpecific(pelvicCandidate, i.recoveryPlan, i.contractionIndices);
    if (!screened && prescriptionIsPelvic) {
        modifiers.pelvicScreenRequired = true;
        if (state === 'TRAIN' || state === 'MODIFIED') {
            intendedMission = mission;
            state = 'PREPARE'; prepare = 'pelvic-screen'; mission = null;
            reason = REASONS.pelvicScreen;
            modifiers.moderateSoreness = false;
        }
    }

    const changes = [];
    if (modifiers.moderateSoreness) changes.push(CHANGES.moderateSoreness);
    if (modifiers.deload && mission && mission !== 'recovery') changes.push(CHANGES.deload);
    if (modifiers.tightFloor && pelvicCandidate === 'recovery') changes.push(CHANGES.tightFloor);
    if (modifiers.pelvicScreenRequired && state !== 'PREPARE') changes.push(CHANGES.pelvicScreenRequired);

    return {
        state,
        mission,
        reason,
        duration: minutes(mission, { moderateSoreness: modifiers.moderateSoreness }),
        modifiers,
        /* Which recovery exercises this prescription may actually use. Null
           when nothing recovery shaped is on offer. Narrowed rather than
           silently filtered downstream, so the UI can name what is missing. */
        recoveryPlan: (mission === 'recovery' || state === 'REST' || state === 'COMPLETE')
            ? recoveryPlan : null,
        /* High soreness is the one prescription with no way around it. Making
           a safety recommendation and then offering a prominent button to
           ignore it is not a recommendation. PREPARE has no override either:
           the gate is the point. */
        overrideAllowed: !(state === 'RECOVER' && soreness === 'high') && state !== 'PREPARE' && state !== 'REST',
        /* Quiet, never a second dominant call to action. Rest days and
           finished days both stay finished; this is an offer, not a task, and
           taking it changes neither side of the weekly count. */
        optional: optionalFor(state, minutes, recoveryPlan, Array.isArray(i.recoveryPlan)),
        changes,
        prepare,
        intendedMission,
    };

    /** Mirrors dayTypeLabel(), with the table passed in rather than global. */
    function labelFor(type) {
        const dayTypes = i.dayTypes || {};
        return (dayTypes[type] && dayTypes[type].label) || DEFAULT_MISSION_LABELS[type] || type;
    }
}

/** Display names for the three training missions, used only inside reasons. */
const DEFAULT_MISSION_LABELS = { length: 'Length', girth: 'Girth', stamina: 'Stamina' };

/**
 * The secondary offer, on the days where there is no required work.
 *
 * Called Active Recovery, never "Bonus Work": a rest day followed as written
 * is the programme being followed, and labelling extra work as a bonus makes
 * the correct choice look like the lesser one.
 */
function optionalFor(state, minutes, plan, planWasGiven) {
    if (state !== 'REST' && state !== 'COMPLETE') return null;
    // A plan that narrowed to nothing is not an offer. A plan the caller never
    // supplied is unknown, which is not the same as empty.
    if (planWasGiven && plan.length === 0) return null;
    return {
        mission: 'recovery',
        label: 'Active Recovery',
        duration: minutes('recovery', {}),
        exercises: planWasGiven ? plan : null,
        countsTowardWeek: false,
    };
}
```

---

# 2. FULL `src/sessionDuration.js`

```js
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
```

---

# 3. FULL `src/weekCompletion.js`

```js
/**
 * How much of this week's programme is done.
 *
 * The denominator is scheduled non-rest sessions, not seven days. A rest day
 * is part of the programme, so it is not a gap in the week and must never read
 * as a failure. Four scheduled sessions with two logged is "2 of 4 this week",
 * and the member is on track.
 *
 * Extra activity does not move either number. A recovery session on a rest day
 * is worth doing, but it is not one of the four, and inflating the numerator
 * for it would turn a fixed target into a moving one.
 *
 * KNOWN LIMITATION, documented rather than solved in Phase 2A:
 * completedDays is one boolean per weekday index. Two sessions on the same day
 * collapse into one, and a session logged on a scheduled rest day cannot be
 * counted at all. Fixing it means changing the persisted shape, which is a
 * migration and a separate decision.
 *
 * Pure: no DOM, no globals, no clock.
 */

/** Day types that are not a session. */
export const REST_TYPES = ['rest'];

function isScheduledSession(type, restTypes) {
    return typeof type === 'string' && type !== '' && !restTypes.includes(type);
}

/**
 * weekCompletion(schedule, completedDays) -> { completed, target, remaining, allDone, label }
 *
 * schedule      persisted.schedule, seven entries indexed by Date#getDay()
 * completedDays persisted.completedDays, seven booleans, same indexing
 *
 * Both are tolerated as missing or short. A slot the schedule does not
 * describe is not counted in either number, because an undescribed day is not
 * a commitment the member made.
 */
export function weekCompletion(schedule, completedDays, options) {
    const restTypes = (options && options.restTypes) || REST_TYPES;
    const sched = Array.isArray(schedule) ? schedule : [];
    const done = Array.isArray(completedDays) ? completedDays : [];

    const target = sched.filter(t => isScheduledSession(t, restTypes)).length;
    const completed = sched.filter((t, i) => isScheduledSession(t, restTypes) && done[i] === true).length;

    return {
        completed,
        target,
        remaining: Math.max(0, target - completed),
        allDone: target > 0 && completed >= target,
        label: target > 0 ? `${completed} of ${target} this week` : 'No sessions scheduled this week',
    };
}
```

---

# 4. FULL `tests/nextBestAction.test.js`

```js
import { describe, test, expect } from 'vitest';
import {
    nextBestAction, isDeloadWeek, hasPelvicScreen, isPelvicSpecific, allowedRecoveryPlan,
    STATES, TRAINING_MISSIONS,
} from '../src/nextBestAction.js';
import { estimateSessionMinutes } from '../src/sessionDuration.js';

/**
 * The precedence IS the product decision, so most of this file is about which
 * rule wins when two of them could fire. Every adjacent pair in the ladder has
 * a test where both conditions hold.
 *
 * Dates are built from local components rather than parsed from strings, so
 * getDay() means the weekday the test name says it does regardless of where
 * this runs.
 */

const GOALS = {
    size: { label: 'Size', mission: 'length' },
    stamina: { label: 'Lasting longer', mission: 'stamina' },
    eq: { label: 'Erection quality', mission: 'stamina' },
    all: { label: 'All of it', mission: 'length' },
};
const DAY_TYPES = {
    length: { label: 'Length' }, girth: { label: 'Girth' },
    stamina: { label: 'Stamina' }, rest: { label: 'Rest' },
};
// The 'all' goal's schedule, Sunday indexed to match Date#getDay().
const SCHEDULE = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const NO_DAYS = [false, false, false, false, false, false, false];
const CONTRACTION = [0, 3];
const NIGHT_RECOVERY = [0, 1, 2, 3];     // includes both contraction exercises
const MORNING_RECOVERY = [4, 5];         // hip work only

const SUN = new Date(2025, 0, 5);        // schedule[0] length
const MON = new Date(2025, 0, 6);        // schedule[1] girth
const TUE = new Date(2025, 0, 7);        // schedule[2] rest
const WED = new Date(2025, 0, 8);        // schedule[3] stamina
const THU = new Date(2025, 0, 9);        // schedule[4] length
const DELOAD_MON = new Date(2025, 0, 20); // ISO week 4, still schedule[1] girth

const input = (over) => ({
    dataLoaded: true,
    now: MON,
    goals: GOALS,
    goalKey: 'all',
    dayTypes: DAY_TYPES,
    schedule: SCHEDULE,
    completedDays: NO_DAYS,
    sessionDraft: null,
    soreness: '',
    pelvicProfile: 'standard',
    firstSessionDate: '2024-09-01',
    recoveryPlan: NIGHT_RECOVERY,
    contractionIndices: CONTRACTION,
    ...over,
});

// ---------------------------------------------------------------------------
// The helpers the ladder is built from
// ---------------------------------------------------------------------------
describe('isDeloadWeek', () => {
    test('every fourth ISO week once there is enough history', () => {
        expect(isDeloadWeek('2024-09-01', DELOAD_MON)).toBe(true);   // ISO week 4
        expect(isDeloadWeek('2024-09-01', MON)).toBe(false);          // ISO week 2
    });
    test('a member with under four weeks of history never deloads', () => {
        expect(isDeloadWeek('2025-01-14', DELOAD_MON)).toBe(false);
    });
    test('no first session, no deload', () => {
        expect(isDeloadWeek(null, DELOAD_MON)).toBe(false);
        expect(isDeloadWeek('not a date', DELOAD_MON)).toBe(false);
    });
});

describe('hasPelvicScreen', () => {
    test('only the two supported profiles count as screened', () => {
        expect(hasPelvicScreen('tight')).toBe(true);
        expect(hasPelvicScreen('standard')).toBe(true);
        expect(hasPelvicScreen('')).toBe(false);
        // Profiles the screener does not support must never read as screened.
        expect(hasPelvicScreen('weak')).toBe(false);
        expect(hasPelvicScreen('balanced')).toBe(false);
    });
});

describe('isPelvicSpecific', () => {
    test('true only when the plan contains contraction work', () => {
        expect(isPelvicSpecific('recovery', NIGHT_RECOVERY, CONTRACTION)).toBe(true);
        expect(isPelvicSpecific('recovery', MORNING_RECOVERY, CONTRACTION)).toBe(false);
    });
    test('mechanical missions are never pelvic specific today', () => {
        for (const m of TRAINING_MISSIONS) {
            expect(isPelvicSpecific(m, NIGHT_RECOVERY, CONTRACTION)).toBe(false);
        }
    });
});

describe('allowedRecoveryPlan', () => {
    test('a screened, not-tight member gets everything', () => {
        expect(allowedRecoveryPlan(NIGHT_RECOVERY, CONTRACTION, { screened: true, tightFloor: false }))
            .toEqual(NIGHT_RECOVERY);
    });
    test('a tight floor loses contraction work', () => {
        expect(allowedRecoveryPlan(NIGHT_RECOVERY, CONTRACTION, { screened: true, tightFloor: true }))
            .toEqual([1, 2]);
    });
    test('an unscreened member loses it too', () => {
        expect(allowedRecoveryPlan(NIGHT_RECOVERY, CONTRACTION, { screened: false, tightFloor: false }))
            .toEqual([1, 2]);
    });
});

// ---------------------------------------------------------------------------
// The fifteen required cases
// ---------------------------------------------------------------------------
describe('nextBestAction: the required cases', () => {
    test('data unavailable', () => {
        const r = nextBestAction(input({ dataLoaded: false }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
        expect(r.mission).toBeNull();
        expect(r.overrideAllowed).toBe(false);
    });

    test('an unfinished session exists', () => {
        const r = nextBestAction(input({ sessionDraft: { routineType: 'girth', exerciseIndex: 1 } }));
        expect(r.state).toBe('RESUME');
        expect(r.mission).toBe('girth');
    });

    test('no goal', () => {
        const r = nextBestAction(input({ goalKey: '' }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('goal');
    });

    test('an unrecognised goal key is treated as no goal, not as a crash', () => {
        expect(nextBestAction(input({ goalKey: 'hypertrophy' })).prepare).toBe('goal');
    });

    test('pelvic specific prescription and an unscreened member', () => {
        // Reachable once a goal prescribes pelvic work directly. Today no
        // scheduled day does, so this uses a goal whose mission is recovery
        // and a day the schedule does not describe.
        const r = nextBestAction(input({
            goals: { ...GOALS, floor: { label: 'Pelvic health', mission: 'recovery' } },
            goalKey: 'floor',
            schedule: [],
            pelvicProfile: '',
        }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('pelvic-screen');
        expect(r.intendedMission).toBe('recovery');
        expect(r.modifiers.pelvicScreenRequired).toBe(true);
        expect(r.reason).toContain('whether your floor tends to stay tight');
        expect(r.overrideAllowed).toBe(false);
    });

    test('today is already complete', () => {
        const r = nextBestAction(input({ completedDays: [false, true, false, false, false, false, false] }));
        expect(r.state).toBe('COMPLETE');
        expect(r.mission).toBeNull();
        expect(r.reason).toBe('Today is done.');
        // Quiet secondary offer, never a second required task.
        expect(r.optional).toMatchObject({ mission: 'recovery', label: 'Active Recovery', countsTowardWeek: false });
    });

    test('scheduled rest', () => {
        const r = nextBestAction(input({ now: TUE }));
        expect(r.state).toBe('REST');
        expect(r.mission).toBeNull();
        expect(r.reason).toBe('Rest is on the schedule today, and it is part of the programme.');
        expect(r.reason).not.toMatch(/locked/i);
        expect(r.optional.label).toBe('Active Recovery');
        expect(r.optional.label).not.toMatch(/bonus/i);
        expect(r.optional.countsTowardWeek).toBe(false);
    });

    test('a normal scheduled length day', () => {
        const r = nextBestAction(input({ now: THU }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('length');
        expect(r.reason).toBe('Today is a Length day on your schedule.');
        expect(r.optional).toBeNull();
    });

    test('a normal scheduled girth day', () => {
        const r = nextBestAction(input({ now: MON }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('girth');
    });

    test('a normal scheduled stamina day', () => {
        const r = nextBestAction(input({ now: WED }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('stamina');
    });

    test('high soreness, after Ready has supplied it', () => {
        const r = nextBestAction(input({ now: THU, soreness: 'high' }));
        expect(r.state).toBe('RECOVER');
        expect(r.mission).toBe('recovery');
        expect(r.reason).toBe('Mechanical training is on hold today because you reported high muscle soreness.');
        // Not an injury claim, and not overridable.
        expect(r.reason).not.toMatch(/injur|damage|scar/i);
        expect(r.overrideAllowed).toBe(false);
    });

    test('moderate soreness', () => {
        const r = nextBestAction(input({ now: THU, soreness: 'moderate' }));
        expect(r.state).toBe('MODIFIED');
        expect(r.mission).toBe('length');
        expect(r.modifiers.moderateSoreness).toBe(true);
        expect(r.reason).toBe('Reduced today because you reported moderate muscle soreness.');
        // A product heuristic, never presented as a validated dose.
        expect(r.reason).not.toMatch(/research|study|clinical|60%/i);
        expect(r.overrideAllowed).toBe(true);
    });

    test('mild soreness changes nothing, matching current behaviour', () => {
        const r = nextBestAction(input({ now: THU, soreness: 'mild' }));
        expect(r.state).toBe('TRAIN');
        expect(r.modifiers.moderateSoreness).toBe(false);
    });

    test('a tight pelvic profile', () => {
        const r = nextBestAction(input({ now: TUE, pelvicProfile: 'tight' }));
        expect(r.modifiers.tightFloor).toBe(true);
        // Contraction work is withheld, and the result says so rather than
        // quietly shortening the list.
        expect(r.recoveryPlan).toEqual([1, 2]);
        expect(r.changes.join(' ')).toMatch(/tight floor/i);
        // A tight floor is not an unscreened member.
        expect(r.modifiers.pelvicScreenRequired).toBe(false);
    });

    test('a tight profile does not change a mechanical training day', () => {
        const r = nextBestAction(input({ now: THU, pelvicProfile: 'tight' }));
        expect(r.state).toBe('TRAIN');
        expect(r.mission).toBe('length');
    });

    test('the deload modifier', () => {
        const r = nextBestAction(input({ now: DELOAD_MON }));
        expect(r.state).toBe('TRAIN');
        expect(r.modifiers.deload).toBe(true);
        expect(r.changes.join(' ')).toMatch(/deload/i);
    });

    test('an unknown or malformed schedule falls back to the goal mission', () => {
        for (const schedule of [null, [], ['mystery'], [undefined], 'length']) {
            const r = nextBestAction(input({ now: SUN, schedule, goalKey: 'stamina' }));
            expect(r.state, JSON.stringify(schedule)).toBe('TRAIN');
            expect(r.mission).toBe('stamina');
            expect(r.reason).toBe('Nothing is scheduled for today, so this follows your goal.');
        }
    });

    test('an explicit rest is a rest, but an unreadable slot is not', () => {
        // getScheduledType() returns 'rest' for both, which turns a corrupt
        // array into a week off. Only the explicit value rests here.
        expect(nextBestAction(input({ now: TUE })).state).toBe('REST');
        expect(nextBestAction(input({ now: TUE, schedule: ['length', 'girth', 'mystery'] })).state).toBe('TRAIN');
    });
});

// ---------------------------------------------------------------------------
// Precedence: every adjacent pair, with both conditions true
// ---------------------------------------------------------------------------
describe('nextBestAction: precedence', () => {
    test('1 over 2: no data beats an unfinished session', () => {
        const r = nextBestAction(input({ dataLoaded: false, sessionDraft: { routineType: 'girth' } }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
    });

    test('2 over 3: an unfinished session beats a missing goal', () => {
        const r = nextBestAction(input({ sessionDraft: { routineType: 'girth' }, goalKey: '' }));
        expect(r.state).toBe('RESUME');
    });

    test('3 over 4: a missing goal beats a finished day', () => {
        const r = nextBestAction(input({ goalKey: '', completedDays: [false, true] }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('goal');
    });

    test('4 over 5: a finished day beats high soreness', () => {
        const r = nextBestAction(input({ completedDays: [false, true], soreness: 'high' }));
        expect(r.state).toBe('COMPLETE');
    });

    test('5 over 6: high soreness beats a scheduled rest day', () => {
        // Both point away from training, but the reason the member is shown
        // has to be the one that matters.
        const r = nextBestAction(input({ now: TUE, soreness: 'high' }));
        expect(r.state).toBe('RECOVER');
        expect(r.overrideAllowed).toBe(false);
    });

    test('6 over 7: a scheduled rest day beats moderate soreness', () => {
        const r = nextBestAction(input({ now: TUE, soreness: 'moderate' }));
        expect(r.state).toBe('REST');
        expect(r.modifiers.moderateSoreness).toBe(false);
    });

    test('7 over 8: moderate soreness beats a normal scheduled day', () => {
        const r = nextBestAction(input({ now: MON, soreness: 'moderate' }));
        expect(r.state).toBe('MODIFIED');
        expect(r.mission).toBe('girth');
    });

    test('8 over 9: a readable schedule beats the goal fallback', () => {
        // Scheduled girth, but the goal's mission is length.
        const r = nextBestAction(input({ now: MON, goalKey: 'size' }));
        expect(r.mission).toBe('girth');
    });

    test('moderate soreness still uses the goal when the schedule is unreadable', () => {
        const r = nextBestAction(input({ now: MON, schedule: ['x'], soreness: 'moderate', goalKey: 'stamina' }));
        expect(r.state).toBe('MODIFIED');
        expect(r.mission).toBe('stamina');
    });

    test('every condition at once resolves to the highest rule', () => {
        const r = nextBestAction(input({
            dataLoaded: false,
            sessionDraft: { routineType: 'length' },
            goalKey: '',
            completedDays: [true, true, true, true, true, true, true],
            soreness: 'high',
            now: TUE,
            pelvicProfile: '',
        }));
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
    });

    test('the result always carries a state the UI knows', () => {
        const cases = [
            input({ dataLoaded: false }), input({ sessionDraft: {} }), input({ goalKey: '' }),
            input({ completedDays: [false, true] }), input({ soreness: 'high' }),
            input({ now: TUE }), input({ soreness: 'moderate' }), input({}), input({ schedule: null }),
        ];
        for (const c of cases) expect(STATES).toContain(nextBestAction(c).state);
    });
});

// ---------------------------------------------------------------------------
// The pelvic gate, where it does not change the state
// ---------------------------------------------------------------------------
describe('nextBestAction: the pelvic screener gate', () => {
    test('an unscreened member routed to Recovery is not stopped by the screener', () => {
        // Answering a safety signal with a questionnaire would leave a sore
        // member with nothing to do.
        const r = nextBestAction(input({ soreness: 'high', pelvicProfile: '' }));
        expect(r.state).toBe('RECOVER');
        expect(r.mission).toBe('recovery');
        expect(r.modifiers.pelvicScreenRequired).toBe(true);
        expect(r.recoveryPlan).toEqual([1, 2]);
        expect(r.changes.join(' ')).toMatch(/pelvic floor check/i);
    });

    test('a rest day flags the screener for its optional recovery', () => {
        const r = nextBestAction(input({ now: TUE, pelvicProfile: '' }));
        expect(r.state).toBe('REST');
        expect(r.modifiers.pelvicScreenRequired).toBe(true);
        expect(r.optional.exercises).toEqual([1, 2]);
    });

    test('a plan with no contraction work does not raise the gate', () => {
        const r = nextBestAction(input({ soreness: 'high', pelvicProfile: '', recoveryPlan: MORNING_RECOVERY }));
        expect(r.modifiers.pelvicScreenRequired).toBe(false);
        expect(r.recoveryPlan).toEqual(MORNING_RECOVERY);
    });

    test('a screened member keeps the whole plan', () => {
        const r = nextBestAction(input({ soreness: 'high', pelvicProfile: 'standard' }));
        expect(r.modifiers.pelvicScreenRequired).toBe(false);
        expect(r.recoveryPlan).toEqual(NIGHT_RECOVERY);
    });

    test('an offer that narrows to nothing is not made', () => {
        const r = nextBestAction(input({ now: TUE, pelvicProfile: '', recoveryPlan: CONTRACTION }));
        expect(r.optional).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Duration, wired to the real estimator
// ---------------------------------------------------------------------------
describe('nextBestAction: duration', () => {
    const ROUTINES = {
        length: [{ sets: 3, duration: 30 }, { sets: 3, duration: 30 }],
        girth: [], stamina: [{ sets: 3, duration: 120 }, { sets: 3, duration: 15, restDur: 30 }],
        recovery: [
            { sets: 3, duration: 60 }, { sets: 3, duration: 45 }, { sets: 3, duration: 45 },
            { sets: 3, duration: 60 }, { sets: 2, duration: 60 }, { sets: 2, duration: 45 },
            { sets: 2, duration: 60 }, { sets: 2, duration: 45 },
        ],
    };
    const DIFFICULTIES = [{ id: 'intermediate', durationMult: 1.0, setsOffset: 0 }];
    const estimateMinutes = (mission, opts) => estimateSessionMinutes(mission, {
        routines: ROUTINES, difficulties: DIFFICULTIES, difficulty: 'intermediate', ...opts,
    });

    test('a training day reports its length', () => {
        const r = nextBestAction(input({ now: THU, estimateMinutes }));
        expect(r.duration).toBe(14);
    });

    test('moderate soreness shortens the reported length', () => {
        const normal = nextBestAction(input({ now: THU, estimateMinutes })).duration;
        const reduced = nextBestAction(input({ now: THU, soreness: 'moderate', estimateMinutes })).duration;
        expect(reduced).toBeLessThan(normal);
    });

    test('recovery is costed from the narrowed plan, not the requested one', () => {
        const screened = nextBestAction(input({ soreness: 'high', pelvicProfile: 'standard', estimateMinutes }));
        const unscreened = nextBestAction(input({ soreness: 'high', pelvicProfile: '', estimateMinutes }));
        expect(unscreened.duration).toBeLessThan(screened.duration);
    });

    test('without an estimator the duration is null rather than a guess', () => {
        expect(nextBestAction(input({ now: THU })).duration).toBeNull();
    });

    test('states that are not a session report no duration', () => {
        expect(nextBestAction(input({ now: TUE, estimateMinutes })).duration).toBeNull();
        expect(nextBestAction(input({ completedDays: [false, true], estimateMinutes })).duration).toBeNull();
        expect(nextBestAction(input({ dataLoaded: false, estimateMinutes })).duration).toBeNull();
    });

    test('the optional offer still carries its own duration', () => {
        const r = nextBestAction(input({ now: TUE, estimateMinutes }));
        expect(r.optional.duration).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Shape and hygiene
// ---------------------------------------------------------------------------
describe('nextBestAction: the returned object', () => {
    test('presentation never has to reverse engineer the decision', () => {
        const r = nextBestAction(input({ now: THU }));
        for (const key of ['state', 'mission', 'reason', 'duration', 'modifiers', 'overrideAllowed',
            'optional', 'changes', 'prepare', 'intendedMission', 'recoveryPlan']) {
            expect(Object.hasOwn(r, key), `missing ${key}`).toBe(true);
        }
        expect(Object.keys(r.modifiers).sort())
            .toEqual(['deload', 'moderateSoreness', 'pelvicScreenRequired', 'tightFloor']);
    });

    test('an empty input does not throw', () => {
        const r = nextBestAction({});
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('loading');
    });

    test('no reason uses an em dash', () => {
        const cases = [
            input({ dataLoaded: false }), input({ goalKey: '' }), input({ sessionDraft: {} }),
            input({ completedDays: [false, true] }), input({ soreness: 'high' }),
            input({ soreness: 'moderate' }), input({ now: TUE }), input({ now: THU }),
            input({ schedule: null }), input({ pelvicProfile: '', soreness: 'high' }),
        ];
        for (const c of cases) {
            const r = nextBestAction(c);
            expect(r.reason).not.toContain('—');
            for (const change of r.changes) expect(change).not.toContain('—');
        }
    });

    test('no reason implies that soreness is an injury', () => {
        for (const soreness of ['mild', 'moderate', 'high']) {
            const r = nextBestAction(input({ now: THU, soreness }));
            expect(r.reason).not.toMatch(/injur|damage|scar tissue|risk/i);
        }
    });

    test('the resolver is deterministic for the same input', () => {
        const a = nextBestAction(input({ now: THU }));
        const b = nextBestAction(input({ now: THU }));
        expect(a).toEqual(b);
    });

    test('it reads no clock of its own', () => {
        // Same state, two different days, two different answers.
        expect(nextBestAction(input({ now: MON })).mission).toBe('girth');
        expect(nextBestAction(input({ now: WED })).mission).toBe('stamina');
    });
});
```

---

# 5. FULL `tests/sessionDuration.test.js`

```js
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
```

---

# 6. FULL `tests/weekCompletion.test.js`

```js
import { describe, test, expect } from 'vitest';
import { weekCompletion } from '../src/weekCompletion.js';

/**
 * The denominator is the whole point. A week counted out of seven makes a
 * correctly followed rest day look like a miss, which is the opposite of what
 * the programme says.
 */

// Sunday-indexed, matching Date#getDay(). This is the 'all' goal's schedule.
const ALL = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const NONE = [false, false, false, false, false, false, false];
const done = (...days) => NONE.map((_, i) => days.includes(i));

describe('weekCompletion', () => {
    test('counts scheduled non-rest sessions as the target', () => {
        const r = weekCompletion(ALL, NONE);
        expect(r.target).toBe(4);
        expect(r.completed).toBe(0);
    });

    test('a finished session counts', () => {
        expect(weekCompletion(ALL, done(0, 1)).completed).toBe(2);
    });

    test('renders as "2 of 4 this week"', () => {
        expect(weekCompletion(ALL, done(0, 1)).label).toBe('2 of 4 this week');
    });

    test('rest days are not failures and are not in the target', () => {
        // Nothing done, but the two rest days are not counted against them.
        expect(weekCompletion(ALL, NONE).target).toBe(4);
        expect(weekCompletion(ALL, NONE).remaining).toBe(4);
    });

    test('a flag set on a rest day does not inflate the numerator', () => {
        // Index 2 and 5 are rest. Active Recovery there must not count.
        const r = weekCompletion(ALL, done(2, 5));
        expect(r.completed).toBe(0);
        expect(r.target).toBe(4);
    });

    test('allDone only once every scheduled session is logged', () => {
        expect(weekCompletion(ALL, done(0, 1, 3)).allDone).toBe(false);
        expect(weekCompletion(ALL, done(0, 1, 3, 4)).allDone).toBe(true);
    });

    test('an all-rest week has no target and is not "all done"', () => {
        const r = weekCompletion(['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'], NONE);
        expect(r.target).toBe(0);
        expect(r.allDone).toBe(false);
        expect(r.label).toBe('No sessions scheduled this week');
    });

    test('missing or malformed inputs do not throw', () => {
        expect(weekCompletion(null, null).target).toBe(0);
        expect(weekCompletion(undefined, undefined).completed).toBe(0);
        expect(weekCompletion('length', 'true').target).toBe(0);
    });

    test('a slot the schedule does not describe is in neither number', () => {
        const sparse = ['length', undefined, null, '', 'girth'];
        const r = weekCompletion(sparse, done(0, 1, 2, 3, 4));
        expect(r.target).toBe(2);
        expect(r.completed).toBe(2);
    });

    test('only an exact true counts, not a truthy value', () => {
        // completed_days arrives from PostgREST and has been seen as strings.
        expect(weekCompletion(ALL, ['yes', 1, false, false, false, false, false]).completed).toBe(0);
    });

    test('a short completedDays array does not throw', () => {
        expect(weekCompletion(ALL, [true]).completed).toBe(1);
    });

    test('unknown day types count as sessions, not as rest', () => {
        // A stale cached shell can hold a type this build does not know. The
        // safe reading is "something was scheduled", not "the week was empty".
        const r = weekCompletion(['mystery', 'rest'], [true, false]);
        expect(r.target).toBe(1);
        expect(r.completed).toBe(1);
    });
});
```

---

# 7. Exact claims changes in `app/index.html`

51 edits. Every one is a string literal or an HTML text node; no identifier, condition, numeric constant or DOM structure was touched. Verified by filtering the diff for non-string lines: empty result.

Summary by classification: 10 REMOVE, 29 SOFTEN, 4 KEEP (three of them strengthened rather than softened), 5 NEEDS SOURCE, 3 framing-only.

Summary by evidence tier of the resulting claim: 6 STRONG DIRECT, 4 MODERATE-EMERGING DIRECT, 23 SUPPORTIVE-MECHANISTIC, 15 INSUFFICIENT (removed or stripped of the unsupported part), 3 not a health claim.

### [1] Pre-Flight card

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** No threshold at which ordinary hydration becomes a tissue safety risk. Both the threshold framing and 'brittle' go.

BEFORE:
```
<i class="fas fa-droplet"></i> Minimum Hydration</p><p class="text-[13px] text-slate-300">FALLING BELOW <span class="text-blue-100 font-bold underline decoration-blue-500/50">3L DAILY</span> creates brittle, tear-prone tissue. Water is the fuel for expansion.</p>
```

AFTER:
```
<i class="fas fa-droplet"></i> Hydration</p><p class="text-[13px] text-slate-300">Train <span class="text-blue-100 font-bold underline decoration-blue-500/50">well hydrated</span>. Top up through the day rather than drinking a lot right before you start.</p>
```

### [2] Manual, Tips chapter

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** Same brittleness claim. 3L retained as a tracked target, explicitly not a safety line.

BEFORE:
```
<p>Water is the primary component of connective tissue. Dehydrated collagen is brittle and resistant to expansion. Hit 3L daily, spread throughout the day in sips — not chugged before training.</p>
```

AFTER:
```
<p>Water is a major component of connective tissue, and turning up well hydrated is part of turning up in good shape. Spread your intake across the day in sips rather than drinking a lot right before training. 3L is the daily target this app tracks, not a line you cross into danger.</p>
```

### [3] COACH_TIPS, hydration

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Hydration supporting circulation is mechanistic. '3L a day isn't optional' was the overreach.

BEFORE:
```
{ title: 'Hydration is vascular training.', body: 'Blood is mostly water. When you\'re dehydrated, it thickens, flow slows, and your EQ tanks. 3L a day isn\'t optional. It\'s maintenance for the system you\'re trying to develop.' },
```

AFTER:
```
{ title: 'Hydration is basic upkeep.', body: 'Blood is mostly water, and being properly hydrated supports normal circulation. 3L a day is the target this app tracks because it is a simple habit to hold, not because something goes wrong the moment you fall short.' },
```

### [4] COACH_TIPS, EQ and hydration

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Directly linked' asserted a causal chain to erection quality that is not demonstrated.

BEFORE:
```
{ title: 'EQ and hydration are directly linked.', body: 'Smooth muscle in your blood vessels requires adequate hydration to stay pliable. Dehydrated vessels are stiff, don\'t dilate as wide, and produce weaker engorgement. Drink before you feel thirsty.' },
```

AFTER:
```
{ title: 'Drink before you feel thirsty.', body: 'Blood vessels work in a body that is not running dry, so hydration is worth staying on top of. The link between day to day water intake and erection quality is mechanistic rather than demonstrated, so treat it as upkeep and not as a lever.' },
```

### [5] Guided tour, hydration stop

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** 'Dehydrated tissue does not respond' is an unsupported absolute.

BEFORE:
```
body:'Tap the amount as you drink. Hit 3L. Blood flow is the whole game and dehydrated tissue does not respond.'},
```

AFTER:
```
body:'Tap the amount as you drink. 3L is the daily target. Staying hydrated is basic upkeep for everything else here.'},
```

### [6] getHydrationWarning(), 2L branch

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** 'Dry tissue tears' is an injury claim with nothing behind it. Clause deleted, prompt kept.

BEFORE:
```
if(ml<1500) return `Only ${liters}L today. Aim for at least 2L before training — hydrated tissue expands, dry tissue tears.`;
```

AFTER:
```
if(ml<1500) return `Only ${liters}L today. Aim for at least 2L before training.`;
```

### [7] COACH_TIPS, posture

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** General circulation is SUPPORTIVE; the genital-specific 'direct vascular intervention' is INSUFFICIENT. Habit kept, causal claim removed and labelled as not established.

BEFORE:
```
{ title: 'Posture affects blood flow directly.', body: 'Slouching compresses the iliac arteries that run through your pelvis. Sitting tall is a direct vascular intervention. Your posture affects genital blood flow every minute of the day.' },
```

AFTER:
```
{ title: 'Sitting tall is worth the habit.', body: 'Hours slouched in a chair load the pelvis and hips in ways worth breaking up. Sitting upright and standing often is a cheap habit that supports general circulation. The direct effect on genital blood flow is not established, so do it for the hips and the back.' },
```

### [8] RECOVERY_META[4], Deep Squat

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** A stretch does not change pelvic bony anatomy. Now says so explicitly.

BEFORE:
```
benefit:'Opens the pelvic outlet. A deep squat physically widens the space your tissue hangs from. This is the mechanical foundation of length work.'
```

AFTER:
```
benefit:'A deep hip and groin stretch. It will not change your anatomy. What it does is loosen the muscles around the pelvis that get short from sitting.'
```

### [9] ROUTINES.recovery[4].detail

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** Same claim in the in-session exercise detail.

BEFORE:
```
Drop your butt toward the floor and use your elbows to nudge your knees outward. This physically opens the pelvic outlet — the foundation of a heavy hang.'
```

AFTER:
```
Drop your butt toward the floor and use your elbows to nudge your knees outward. This opens the hips and groin.'
```

### [10] Manual, Deep Squat bullet

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** Same claim, third location.

BEFORE:
```
<p class="mb-2"><strong class="text-slate-300">Deep Squat — Malasana</strong> — Opens the pelvic outlet. The mechanical foundation of length work. Feet flat, elbows nudging knees wide. 2 sets × 60s.</p>
```

AFTER:
```
<p class="mb-2"><strong class="text-slate-300">Deep Squat — Malasana</strong> — A deep hip and groin stretch for the muscles around the pelvis. Feet flat, elbows nudging knees wide. 2 sets × 60s.</p>
```

### [11] RECOVERY_META[1], Reverse Kegel

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Pelvic floor tension is a real clinical entity; 'caps your gains' is not a measured outcome.

BEFORE:
```
benefit:'Trains the antagonist to the kegel. A floor that can fully release expands more during training. Without this, tightness caps your gains.'
```

AFTER:
```
benefit:'Trains the antagonist to the kegel. The aim is a floor that can let go as well as squeeze. Persistent tightness is worth working on in its own right.'
```

### [12] Manual, Reverse Kegel bullet

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'A floor that cannot release cannot expand' restated as the training aim.

BEFORE:
```
<p class="mb-2"><strong class="text-slate-300">Reverse Kegel Stretch</strong> — The antagonist to the kegel. Trains the floor to fully release. A floor that cannot release cannot expand. 3 sets × 45s. Inhale deep, gently bear down.</p>
```

AFTER:
```
<p class="mb-2"><strong class="text-slate-300">Reverse Kegel Stretch</strong> — The antagonist to the kegel. Trains the floor to fully release. The aim is a floor that can let go as well as squeeze. 3 sets × 45s. Inhale deep, gently bear down.</p>
```

### [13] RECOVERY_META[3], Endurance Hold

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Translates directly to sustained EQ' downgraded to 'may help you hold position'.

BEFORE:
```
benefit:'Builds stamina without fatigue. Motor control at low intensity translates directly to sustained EQ during longer girth sessions.'
```

AFTER:
```
benefit:'Builds low intensity endurance rather than peak strength. Better motor control is the goal, and it may help you hold position through a longer session.'
```

### [14] RECOVERY_META[7], Butterfly

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Adductors are anatomically adjacent to the floor; the causal link is not established.

BEFORE:
```
benefit:'Releases the adductors — directly linked to pelvic floor tension. If these are tight, the hang always looks retracted. This is the unlock most guys miss.'
```

AFTER:
```
benefit:'Releases the adductors, which sit close to the pelvic floor and commonly get tight from sitting. The connection to floor tension is plausible rather than proven, and it is a comfortable stretch either way.'
```

### [15] Manual, Butterfly bullet

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Same claim.

BEFORE:
```
<p><strong class="text-slate-300">Butterfly Stretch</strong> — Releases the adductors (inner thighs) which are directly linked to pelvic floor tension. Soles together, knees out, hinge forward at the hips. 2 sets × 45s.</p>
```

AFTER:
```
<p><strong class="text-slate-300">Butterfly Stretch</strong> — Releases the adductors (inner thighs), which sit close to the pelvic floor and commonly get tight from sitting. Soles together, knees out, hinge forward at the hips. 2 sets × 45s.</p>
```

### [16] ROUTINES.recovery[7].detail

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Keep the pelvic floor retracted' was a mechanism claim; replaced with the observation.

BEFORE:
```
Hinge forward at the hips — not the lower back. Tight adductors (inner thighs) keep the pelvic floor retracted. Let these open fully.'
```

AFTER:
```
Hinge forward at the hips — not the lower back. Tight adductors (inner thighs) are common from sitting. Let these open fully.'
```

### [17] RECOVERY_META[5], Happy Baby

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Fastest way to turn off a tight pelvic floor' is an unmeasurable superlative.

BEFORE:
```
benefit:'Fastest way to turn off a tight pelvic floor. Resets hip flexor tension built up overnight or from sitting. Do this first thing if you wake up tight.'
```

AFTER:
```
benefit:'A quick way to take tension out of the hips and pelvic floor. Good first thing if you wake up tight, or after a long spell sitting.'
```

### [18] ROUTINES.recovery[5].detail

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Same superlative.

BEFORE:
```
Rock gently side to side. This is the fastest way to manually turn off a tight pelvic floor.'
```

AFTER:
```
Rock gently side to side. This is a quick way to take tension out of a tight pelvic floor.'
```

### [19] Manual, Happy Baby bullet

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Same superlative.

BEFORE:
```
<p class="mb-2"><strong class="text-slate-300">Happy Baby</strong> — Fastest way to turn off a tight pelvic floor. On your back, feet grabbed, knees toward armpits. Rock side to side. 2 sets × 45s.</p>
```

AFTER:
```
<p class="mb-2"><strong class="text-slate-300">Happy Baby</strong> — A quick way to take tension out of the hips and pelvic floor. On your back, feet grabbed, knees toward armpits. Rock side to side. 2 sets × 45s.</p>
```

### [20] RECOVERY_META[6], Pigeon

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Forward pelvic tilt restricts tissue mobility' was a downstream claim with nothing behind it.

BEFORE:
```
benefit:'Targets the glutes and piriformis — the muscles that pull on your pelvis when you sit. Tight hip rotators create a forward pelvic tilt that restricts tissue mobility.'
```

AFTER:
```
benefit:'Targets the glutes and deep hip rotators, the muscles that shorten from sitting. This is general hip care rather than a direct lever on anything else.'
```

### [21] RECOVERY_META[2], Pelvic Floor Release

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Better overnight adaptation' is mechanistic speculation.

BEFORE:
```
benefit:'Decompresses accumulated tension from training. Collagen remodels during rest — a released floor means better overnight adaptation.'
```

AFTER:
```
benefit:'Passive decompression using breath and gravity. Recovery is when adaptation happens, and this is a low cost way to finish the day less tense.'
```

### [22] RECOVERY_META[0], Kegels

**CLASSIFICATION:** KEEP  
**EVIDENCE TIER:** STRONG DIRECT  
**Why:** STRENGTHENED, not softened. Pelvic floor muscle training has direct trial evidence in ED and PE. Previously written as a vague blood-flow claim; now states the evidence and the hypertonic caveat.

BEFORE:
```
benefit:'Builds voluntary pelvic floor control. Stronger contractions = better blood flow, better EQ, and stronger tissue response during training.'
```

AFTER:
```
benefit:'Builds voluntary pelvic floor control. Pelvic floor muscle training has reasonable evidence behind it for erectile function and ejaculatory control, provided the floor is not already holding too much tension.'
```

### [23] Manual, Kegel Contractions bullet

**CLASSIFICATION:** KEEP  
**EVIDENCE TIER:** STRONG DIRECT  
**Why:** Same, second location.

BEFORE:
```
<p class="mb-2"><strong class="text-slate-300">Kegel Contractions</strong> — Trains voluntary contraction, which means better blood flow and better EQ — but only if your floor is not already too tight.
```

AFTER:
```
<p class="mb-2"><strong class="text-slate-300">Kegel Contractions</strong> — Trains voluntary contraction. Pelvic floor muscle training has reasonable evidence behind it for erectile function and ejaculatory control, but only if your floor is not already too tight.
```

### [24] COACH_TIPS, cardio

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** STRONG DIRECT  
**Why:** Old claim ('directly improves performance') was overreach. Replaced with the locked wording verbatim, plus an explicit group-level caveat.

BEFORE:
```
{ title: 'Sexual stamina is cardiovascular.', body: 'Heart rate, oxygen delivery, and blood pressure management during sex are entirely dependent on your cardiovascular fitness. 20 minutes of cardio 3x per week directly improves performance.' },
```

AFTER:
```
{ title: 'Aerobic fitness is worth training.', body: 'Regular aerobic exercise has been shown to improve erectile function, particularly in men experiencing erectile difficulties. That is a finding across groups rather than a promise to any one man, but it is among the better supported habits here.' },
```

### [25] COACH_TIPS, walking

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** STRONG DIRECT  
**Why:** Old pudendal-artery mechanism was INSUFFICIENT. Rewritten to point at the same aerobic evidence instead of inventing its own.

BEFORE:
```
{ title: 'Walking is vascular training.', body: 'A 10-minute walk activates femoral and pudendal artery circulation. That\'s the same arterial network that supplies your erections. Walk daily. It compounds.' },
```

AFTER:
```
{ title: 'Walking counts.', body: 'A daily walk is the lowest friction way to get regular aerobic activity, and regular aerobic exercise is one of the better supported habits for erectile function. It does not have to be hard to count.' },
```

### [26] COACH_TIPS, nitric oxide

**CLASSIFICATION:** NEEDS SOURCE  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'About 10% per decade after 30' had no source. Figure removed; the direction of travel retained.

BEFORE:
```
{ title: 'Nitric oxide drops with age.', body: 'NO production declines about 10% per decade after 30. Regular exercise, quality sleep, and a diet rich in leafy greens and beets can significantly offset this. Cardiovascular health is sexual health.' },
```

AFTER:
```
{ title: 'Vascular health changes with age.', body: 'Nitric oxide availability tends to fall as men get older, which is part of why erections change. Regular exercise, decent sleep and a diet with plenty of leafy greens and beets all support vascular health, which is the system underneath all of this.' },
```

### [27] COACH_TIPS, breathing

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** MODERATE-EMERGING DIRECT  
**Why:** Reclassified per decision 12. Emerging direct as part of combined PE rehabilitation; SUPPORTIVE for relaxation. Not a standalone treatment, and the 'diaphragm as a pelvic circulation pump' mechanism is dropped.

BEFORE:
```
{ title: 'Deep breathing activates blood flow.', body: 'The diaphragm acts as a pump for pelvic circulation. Shallow chest breathing restricts it. 10 slow belly breaths before a session opens up blood flow before you even start.' },
```

AFTER:
```
{ title: 'Slow breathing helps you down-regulate.', body: 'Diaphragmatic breathing is a dependable way to drop tension before a session, and there is emerging evidence for it as one part of combined rehabilitation for premature ejaculation. On its own, treat it as a relaxation tool rather than a treatment.' },
```

### [28] COACH_TIPS, inflammation

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** MODERATE-EMERGING DIRECT  
**Why:** The diet/vascular association holds; 'directly impairs' as a same-day mechanism does not.

BEFORE:
```
{ title: 'Inflammation slows everything.', body: 'A high-sugar, processed-food diet drives systemic inflammation, which directly impairs vascular function and testosterone production. What you eat affects what you build.' },
```

AFTER:
```
{ title: 'Diet shows up over months.', body: 'A diet heavy in sugar and processed food is associated with worse vascular and metabolic health over time. The effect is cumulative rather than same day, so judge it across months, not across sessions.' },
```

### [29] COACH_TIPS, zinc

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Most men are chronically low' is not true of men eating a typical Western diet. Claim dropped; added that supplementing a non-deficient person is not known to help.

BEFORE:
```
{ title: 'Zinc protects testosterone.', body: 'Zinc is required for testosterone synthesis. Even mild deficiency lowers T levels. Red meat, pumpkin seeds, and shellfish are dense sources. Most men are chronically low.' },
```

AFTER:
```
{ title: 'Zinc is worth getting from food.', body: 'Zinc is required for testosterone synthesis, and deficiency is associated with lower levels. Red meat, pumpkin seeds and shellfish are dense sources. Topping up when you are not deficient is not known to do anything.' },
```

### [30] COACH_TIPS, magnesium

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Most men are deficient' replaced with the defensible 'intake below the recommended amount is common'.

BEFORE:
```
{ title: 'Magnesium relaxes smooth muscle.', body: 'Magnesium helps relax the smooth muscle in arterial walls, allowing greater vasodilation. Most men are deficient. Dark leafy greens, nuts, and dark chocolate are good sources.' },
```

AFTER:
```
{ title: 'Magnesium is easy to get from food.', body: 'Magnesium is involved in smooth muscle relaxation, including in arterial walls. Intake below the recommended amount is common. Dark leafy greens, nuts and dark chocolate are good sources.' },
```

### [31] COACH_TIPS, L-citrulline

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Factual correction: beets and leafy greens supply nitrate, not citrulline. Two routes now named separately.

BEFORE:
```
{ title: 'L-citrulline supports nitric oxide.', body: 'Nitric oxide is what tells blood vessels to relax and open. L-citrulline converts to L-arginine and supports NO production. Watermelon, spinach, and beets contain it naturally.' },
```

AFTER:
```
{ title: 'L-citrulline supports nitric oxide.', body: 'Nitric oxide is what tells blood vessels to relax and open. L-citrulline converts to L-arginine and supports its production. Watermelon is the main food source; leafy greens and beets supply nitrates, which feed the same pathway by a different route.' },
```

### [32] COACH_TIPS, testosterone and sleep

**CLASSIFICATION:** KEEP  
**EVIDENCE TIER:** STRONG DIRECT  
**Why:** Controlled sleep-restriction evidence supports roughly 10 to 15 percent. Kept and now attributed rather than asserted.

BEFORE:
```
{ title: 'Testosterone is made during sleep.', body: 'The majority of your daily testosterone is produced during deep sleep. Less than 6 hours cuts production by up to 15%. Sleep is part of the protocol.' },
```

AFTER:
```
{ title: 'Testosterone is made during sleep.', body: 'Testosterone release is tied to sleep, and in controlled studies a week of short sleep lowered daytime levels in healthy young men by roughly 10 to 15 percent. Sleep is part of the protocol.' },
```

### [33] COACH_TIPS, collagen at night

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Reduce collagen synthesis and slow your progress' is mechanistic, not measured. Now says so.

BEFORE:
```
{ title: 'Collagen remodels at night.', body: 'Tissue adaptation happens during sleep when growth hormone peaks. Going to bed late, drinking alcohol, or sleeping fewer than 7 hours all reduce collagen synthesis and slow your progress.' },
```

AFTER:
```
{ title: 'You adapt while you sleep.', body: 'Growth hormone peaks in deep sleep, and tissue repair runs while you are out. Late nights and alcohol cut into that window. The link to how fast you progress is mechanistic rather than measured, but the sleep itself is not optional.' },
```

### [34] COACH_TIPS, stress

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** STRONG DIRECT  
**Why:** The stress/ED-PE association is well established, so the claim was strengthened. 'One stressful week can set back weeks of progress' was INSUFFICIENT and is gone.

BEFORE:
```
{ title: 'Stress kills erections.', body: 'Cortisol constricts blood vessels and suppresses testosterone simultaneously. One stressful week can set back weeks of progress. Managing stress is not optional. It\'s recovery.' },
```

AFTER:
```
{ title: 'Stress works against erections.', body: 'The stress response constricts blood vessels and, sustained, suppresses testosterone. Psychological stress and anxiety are well established contributors to erectile and ejaculatory difficulty. Managing it is recovery, not a side quest.' },
```

### [35] COACH_TIPS, cold and heat

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** No evidence that contrast exposure produces lasting change in erection quality. Now states that outright.

BEFORE:
```
{ title: 'Cold and heat train your vessels.', body: 'Alternating cold and warm water forces vasoconstriction and vasodilation. That cycling trains your arterial walls to open wider on demand. The mechanism behind stronger EQ.' },
```

AFTER:
```
{ title: 'Cold and heat move your vessels.', body: 'Alternating cold and warm water drives vasoconstriction and vasodilation. Whether that cycling produces any lasting change in erection quality has not been shown, so file it under pleasant rather than proven.' },
```

### [36] COACH_TIPS, sitting

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** Perineal and pudendal loading from prolonged sitting is reasonable. 'Protects more than most supplements' was rhetoric; replaced with a true, lower-key comparison.

BEFORE:
```
{ title: 'Sitting is the enemy of blood flow.', body: 'Sitting for hours compresses the pudendal artery, the main blood supply to the penis. Get up and walk for 5 minutes every hour. That one habit protects more than most supplements.' },
```

AFTER:
```
{ title: 'Break up long spells of sitting.', body: 'Prolonged sitting loads the perineum and the pudendal nerve and artery that run through it. Getting up and walking for five minutes every hour is a cheap habit, and it is better evidenced than most supplements.' },
```

### [37] COACH_TIPS, rest days

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Upregulating hormone receptors, improving vascular tone' was invented specificity.

BEFORE:
```
{ title: 'Rest days are training days.', body: 'On rest days your body is repairing connective tissue, upregulating hormone receptors, and improving vascular tone. Rest is active recovery. Skipping it doesn\'t make you more dedicated. It makes you slower.' },
```

AFTER:
```
{ title: 'Rest days are training days.', body: 'Adaptation happens between sessions, not during them. A rest day taken as written is the programme being followed. Skipping it does not make you more dedicated.' },
```

### [38] COACH_TIPS, morning EQ

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** MODERATE-EMERGING DIRECT  
**Why:** Nocturnal tumescence is a recognised clinical signal, but 'your arteries are healthy and dilating properly' overstates a rough screen. Now points at a doctor.

BEFORE:
```
{ title: 'Morning EQ is your health report.', body: 'Nocturnal and morning erections are your body\'s vascular self-test. If they\'re strong and consistent, your arteries are healthy and dilating properly. If they\'re weak, something needs attention.' },
```

AFTER:
```
{ title: 'Morning EQ is worth watching.', body: 'Nocturnal and morning erections are a rough read on vascular and nerve function, which is why clinicians ask about them. A clear change over weeks is worth raising with a doctor rather than training around.' },
```

### [39] COACH_TIPS, pelvic floor relaxation

**CLASSIFICATION:** KEEP  
**EVIDENCE TIER:** MODERATE-EMERGING DIRECT  
**Why:** Hypertonic floors in men with pelvic pain and PE are well described. 'Chokes off blood flow to the genitals' removed as unsupported.

BEFORE:
```
{ title: 'Your pelvic floor needs to relax.', body: 'Most men have a hypertonic pelvic floor from stress, sitting, and anxiety. A tight floor chokes off blood flow to the genitals. Learning to release it is just as important as strengthening it.' },
```

AFTER:
```
{ title: 'Your pelvic floor needs to relax.', body: 'A chronically tight pelvic floor is common in men dealing with stress, long hours sitting and pelvic pain, and squeezing it harder makes it worse. Learning to release is as much of the work as learning to contract.' },
```

### [40] WARMUP_TIPS, steam

**CLASSIFICATION:** NEEDS SOURCE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** 'Ligament elasticity by up to 40%' had no source. Figure removed; the moist-versus-dry-heat point survives without it.

BEFORE:
```
body:'The moisture in steam is what makes it superior. Water molecules carry thermal energy uniformly into the tissue — increasing ligament elasticity by up to 40% compared to surface-only dry heat.'}
```

AFTER:
```
body:'Moist heat carries thermal energy into tissue more evenly than dry heat, and warm connective tissue is more compliant than cold. That is the reason for the shower, rather than any particular number.'}
```

### [41] WARMUP_TIPS, vascular priming

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'This is why consistent warmers gain faster' is an outcome claim with no data.

BEFORE:
```
body:'Warm water vasodilates peripheral vessels, flooding the target tissue with nutrient-rich blood before any mechanical stress is applied. This is why consistent warmers gain faster.'}
```

AFTER:
```
body:'Warm water dilates peripheral vessels and brings blood to the tissue before any mechanical stress is applied. It is the cheapest thing you can do to arrive at a session prepared.'}
```

### [42] WARMUP_TIPS, injury prevention

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Micro-tears accumulate' asserted a mechanism; replaced with the practice-level reason.

BEFORE:
```
body:'The tunica albuginea behaves like a rubber band — warm it and it yields safely. Work it cold and micro-tears accumulate. There are no shortcuts around this biology.'}
```

AFTER:
```
body:'Connective tissue is more compliant warm than cold, which is why every other discipline warms up before it loads anything. Working cold is where avoidable strains come from.'}
```

### [43] WARMUP_TIPS, timing

**CLASSIFICATION:** NEEDS SOURCE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** '8 to 10 minutes to fully equilibrate', 'cold until minute 8' had no source. Ten minutes retained as this protocol's standard.

BEFORE:
```
body:'Core tissue temperature takes 8–10 minutes to fully equilibrate. Surface warmth sets in at 3 minutes, but the deep ligament structures stay cold until minute 8. Don\'t cut it short.'}
```

AFTER:
```
body:'Surface warmth arrives long before deep tissue does, so the first couple of minutes are not the warmup. Ten minutes is the standard this protocol uses. Do not cut it short.'}
```

### [44] WARMUP_TIPS, long-term returns

**CLASSIFICATION:** NEEDS SOURCE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** 'Plateau 3 to 4 times faster' and 'measurably better outcomes in length and girth' had no source.

BEFORE:
```
body:'Athletes who skip warmup plateau 3–4× faster. Over a 6-month program, consistent warmers see measurably better outcomes in both length and girth. This 10 minutes is not optional.'}
```

AFTER:
```
body:'Warming up before loading tissue is standard practice across every training discipline, and it costs ten minutes. Treat it as part of the session rather than a preamble to it.'}
```

### [45] Manual, warmup tip

**CLASSIFICATION:** NEEDS SOURCE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** Same 3 to 4 times figure, second location.

BEFORE:
```
<p>The 10-minute warmup phase is not optional before Length or Girth work. Collagen does not stretch when cold. Guys who skip warmup plateau 3–4 times faster than consistent warmers. Use a warm towel, warm shower, or the warmup timer in the app. Stamina and Recovery sessions do not need it.</p>
```

AFTER:
```
<p>The 10-minute warmup phase is not optional before Length or Girth work. Connective tissue is more compliant warm than cold, which is why every training discipline warms up before it loads anything. Use a warm towel, warm shower, or the warmup timer in the app. Stamina and Recovery sessions do not need it.</p>
```

### [46] Soreness modal, all three levels

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** 'Training today risks injury' implies soreness equals injury, which decision 3 forbids. 'Will accelerate healing' is unsupported. All three now say 'muscle soreness', and the high message states plainly that soreness is not an injury.

BEFORE:
```
mild:'Mild soreness detected. Your tissue is still recovering from the last session. Consider switching to Recovery Protocol today — The Big Four and pelvic work will support adaptation without adding stress.',
        moderate:'Moderate soreness means your tissue needs more time. Do not train today. Run the Recovery Protocol instead — pelvic floor work and hip stretches will accelerate healing.',
        high:'High soreness is a stop signal. Training today risks injury. Rest is mandatory. You can do gentle breathing and the Big Four stretches only. No mechanical work.'
```

AFTER:
```
mild:'Mild muscle soreness. You are probably still recovering from the last session. Recovery Protocol is a reasonable swap today: the Big Four and pelvic work, without the mechanical load.',
        moderate:'Moderate muscle soreness. Give it another day. Run the Recovery Protocol instead, which keeps you moving without adding mechanical stress.',
        high:'High muscle soreness. Mechanical training is on hold today. Gentle breathing and the Big Four stretches are fine. Soreness is not an injury, but it is a signal worth respecting.'
```

### [47] Manual, soreness check-in

**CLASSIFICATION:** REMOVE  
**EVIDENCE TIER:** INSUFFICIENT  
**Why:** 'It creates scar tissue that limits future adaptation' has nothing behind it. Also adds the new paragraph separating muscle soreness from sharp, electric, stinging, joint and nerve-like symptoms, with 'stop and get it looked at' as the only instruction.

BEFORE:
```
<p>Log your soreness daily on your home screen. The app will recommend Recovery Protocol if you report moderate or high soreness. Follow this recommendation. Training through soreness does not accelerate gains — it creates scar tissue that limits future adaptation.</p>
```

AFTER:
```
<p>Log your muscle soreness daily on your home screen. The app will recommend Recovery Protocol if you report moderate or high soreness. Take that recommendation. Training hard on top of real soreness does not speed anything up, and backing off for a day costs you very little.</p>
                    <p class="mt-2">The soreness scale is asking about muscle soreness, the dull ache that follows work. It is not asking about sharp pain, electric or stinging sensations, unusual joint pain or anything nerve-like. Those are not a volume problem. Stop the exercise, and get them looked at by a professional if they persist or recur.</p>
```

### [48] Manual, HQ chapter

**CLASSIFICATION:** SOFTEN  
**EVIDENCE TIER:** SUPPORTIVE-MECHANISTIC  
**Why:** 'Overtrained tissue does not adapt' restated as a programming rationale.

BEFORE:
```
<p>Log your sleep quality and soreness before every session. If you report moderate or high soreness, the app will recommend Recovery Protocol instead of training. This is not optional coaching — overtrained tissue does not adapt.</p>
```

AFTER:
```
<p>Log your sleep quality and muscle soreness before every session. If you report moderate or high soreness, the app will recommend Recovery Protocol instead of training. Take that recommendation. Hard training on top of real soreness is not where progress comes from.</p>
```

### [49] Rest-day CTA subtitle

**CLASSIFICATION:** FRAMING  
**EVIDENCE TIER:** n/a  
**Why:** Not a health claim. Decision 10: 'Training is locked today' removed.

BEFORE:
```
<p class="text-[10px] text-slate-400 mt-0.5">Training is locked today. This takes you to the Recovery Protocol, which is how you actually grow.</p>
```

AFTER:
```
<p class="text-[10px] text-slate-400 mt-0.5">Rest is on the schedule today. This takes you to the Recovery Protocol.</p>
```

### [50] Blackout screen

**CLASSIFICATION:** FRAMING  
**EVIDENCE TIER:** n/a  
**Why:** Not a health claim. Same line removed.

BEFORE:
```
<p class="text-slate-400 text-[11px] mt-0.5">Training is locked today. Access Recovery Protocol only — The Big Four and pelvic work.</p>
```

AFTER:
```
<p class="text-slate-400 text-[11px] mt-0.5">Rest day. Recovery Protocol is what is on offer: the Big Four and pelvic work.</p>
```

### [51] Manual, rest-day section

**CLASSIFICATION:** FRAMING  
**EVIDENCE TIER:** n/a  
**Why:** Not a health claim. Heading 'Rest Day Enforcement' to 'Rest days'; body now says rest is part of the programme, not a gap in it. The restriction itself is unchanged.

BEFORE:
```
<p class="text-red-300 font-bold text-xs mb-1">Rest Day Enforcement</p>
                        <p>On scheduled rest days, Length and Girth missions are locked. You can only access Recovery Protocol. This is intentional. The tissue needs full mechanical rest between sessions.</p>
```

AFTER:
```
<p class="text-red-300 font-bold text-xs mb-1">Rest days</p>
                        <p>On scheduled rest days, Length and Girth are not available and Recovery Protocol is. This is intentional. Rest is part of the programme, not a gap in it, and the tissue needs mechanical rest between sessions.</p>
```

---

# 8. PR #76 check status

Head commit `056d427`. All checks have now completed.

| Check | Conclusion |
|---|---|
| **Unit and syntax** | **success** (03:14:07) |
| **Browser suites** | **success** (03:17:50) |
| **Cloudflare Pages: theblueprintapp** | **success** |
| Vercel Preview Comments | success |
| Netlify: Pages changed / Header rules / Redirect rules | neutral (no-op, nothing for Netlify in this diff) |
| Workers Builds: the-blueprint | **failure** |
| Cloudflare Pages: samplechopper | **failure** |
| Cloudflare Pages: harmonymap | **failure** |

Local runs matched CI: `npm test` 343 passed across 11 files, `npm run test:e2e` 249 passed across 25 files.

## The three remaining failures

All three started and completed in the same second (`03:09:44`–`03:09:55`), which is the signature of an instant configuration-level failure rather than a build that ran against this diff.

`samplechopper` and `harmonymap` are unrelated Cloudflare Pages projects wired to this repository. They are not part of The Blueprint and their failures are pre-existing noise.

`Workers Builds: the-blueprint` is the one that matters, because the Worker is the authoritative deploy. What can be established from here:

- This diff touches no deploy configuration. Changed files are exactly: `app/index.html`, `docs/phase-2a1-report.md`, `src/nextBestAction.js`, `src/sessionDuration.js`, `src/weekCompletion.js` and the three test files. No `wrangler.jsonc`, no `src/worker.js`, no `package.json`, no `.github/workflows`, no `_headers`, no `_redirects`.
- `Cloudflare Pages: theblueprintapp` built the same commit successfully.
- The build completed in under one second, so it did not reach a compile step.

What cannot be established from here: I have no access to the Cloudflare dashboard, so I cannot read the build log and cannot prove the failure is pre-existing rather than caused by this PR. **This needs a human glance at the build log before merge.** I am not asserting it is safe to ignore.

---

# 9. Known logic concerns, with exact current behaviour

## Malformed schedule fallback

**Current behaviour in this PR.** `src/nextBestAction.js` rule 9:

```js
} else {
    state = 'TRAIN'; mission = goal.mission;
    reason = REASONS.unscheduled;
}
```

Reached when `schedule[today]` is `undefined`, `null`, `''`, or any string that is not `length`, `girth`, `stamina` or `rest`. Produces `state: 'TRAIN'`, `mission: GOALS[goalKey].mission`, reason `"Nothing is scheduled for today, so this follows your goal."`

**How this differs from shipped behaviour.** `getScheduledType()` in `app/index.html`:

```js
function getScheduledType(){ return (persisted.schedule||[])[new Date().getDay()]||'rest'; }
```

Today a missing or unreadable slot falls through to `'rest'`. So the shipped app reads a corrupt array as a week off; the resolver reads it as a goal-default training day. **This is a real behavioural change** and it is in the approved ladder.

Note that `'rest'` is handled by rule 6 and reaches `REST`; only unreadable values reach rule 9. A test asserts the two are distinguished.

**Not changed, per instruction.** The stated preference is a neutral `PREPARE` with a repair path. If the reviewer agrees that is: one branch in the ladder, a fourth value in `PREPARE_REASONS`, a reason string, and two existing tests invert (`"an unknown or malformed schedule falls back to the goal mission"` and `"an explicit rest is a rest, but an unreadable slot is not"`).

Blast radius is small in practice: `normaliseSchedule()` repairs bad slots on load, so the window is narrow.

## Pelvic screener gating

**Current behaviour.** Applied as a post-pass after the ladder, because the right action depends on what was prescribed.

```js
const pelvicCandidate = mission || ((state === 'REST' || state === 'COMPLETE') ? 'recovery' : null);
const prescriptionIsPelvic = isPelvicSpecific(pelvicCandidate, i.recoveryPlan, i.contractionIndices);
if (!screened && prescriptionIsPelvic) {
    modifiers.pelvicScreenRequired = true;
    if (state === 'TRAIN' || state === 'MODIFIED') {
        intendedMission = mission;
        state = 'PREPARE'; prepare = 'pelvic-screen'; mission = null;
        reason = REASONS.pelvicScreen;
        modifiers.moderateSoreness = false;
    }
}
```

`screened` is true only for `'tight'` or `'standard'`. No other profile is inferred. A prescription is pelvic specific only when the mission is `recovery` **and** the planned indices intersect `CONTRACTION_RECOVERY_IDX` (`[0, 3]`).

Outcomes:

- **`TRAIN` or `MODIFIED` that is pelvic specific** → `PREPARE`, `prepare: 'pelvic-screen'`, `mission: null`, `intendedMission` set to what was going to be prescribed, `overrideAllowed: false`, reason `"Before we prescribe pelvic floor work, we need to know whether your floor tends to stay tight."`
- **`RECOVER` or `REST`** → state unchanged. `recoveryPlan` narrows to the non-contraction subset, `modifiers.pelvicScreenRequired: true`, and `changes` gains `"Take the pelvic floor check to unlock contraction work."` Recovery is never blocked behind the screener.
- **Plan with no contraction work** → gate does not fire at all; the full plan is returned.

Narrowing mirrors the shipped `isExerciseBlocked()`, which already withholds contraction work from both tight-profile and unscreened members. The difference is that the resolver returns the narrowed list and a flag, so the UI can name what is missing instead of the list silently being shorter.

**Open item for the reviewer.** The `PREPARE` branch is currently unreachable with shipped data: no day type is pelvic specific, so it fires only for a goal whose `mission` is `recovery`, which no shipped goal has. It is fully tested and dormant, ready for 2B.

**Wording note.** Decision 1 asked the RECOVER/REST path to "explain that pelvic-specific personalization is limited until screening is complete". The implemented string names the concrete consequence instead: `"Take the pelvic floor check to unlock contraction work."` If the more general phrasing is wanted, it is one line in `CHANGES`.

## HIGH soreness

```js
} else if (soreness === 'high') {
    state = 'RECOVER'; mission = 'recovery'; reason = REASONS.highSoreness;
}
```

Rule 5. Beats scheduled rest (rule 6), beats moderate soreness (rule 7), beats any scheduled mission (rules 8 and 9). Loses to a finished day (rule 4), to a missing goal (rule 3), to an unfinished session (rule 2) and to unloaded data (rule 1).

- `mission: 'recovery'`. Mechanical training is withheld.
- `overrideAllowed: false`, by the explicit clause `!(state === 'RECOVER' && soreness === 'high')`. There is no "Train anyway".
- Reason: `"Mechanical training is on hold today because you reported high muscle soreness."` No injury language. A test asserts no reason matches `/injur|damage|scar tissue|risk/i` at any soreness level.
- `optional: null`. High soreness is not a day with a quiet secondary offer; Recovery is the prescription.

**Known mismatch, accepted as 2A.3 debt.** The shipped `showSorenessWarning()` modal still renders "Go to Recovery" **and** "Dismiss" after a high report. The copy no longer claims injury, but the structure is still a safety recommendation beside a button to disregard it. The resolver is correct; the modal does not read it yet.

## REST

```js
} else if (scheduled === 'rest') {
    state = 'REST'; reason = REASONS.rest;
}
```

Rule 6. Fires only on the exact string `'rest'`.

- `mission: null`. Rest is the prescription, not the absence of one.
- `reason`: `"Rest is on the schedule today, and it is part of the programme."` The phrase "Training is locked today" no longer appears anywhere in the product.
- `overrideAllowed: false`. **This is faithful to the shipped restriction, not a relaxation of it.** `isBlackoutDay()` still prevents Length and Girth on a scheduled rest day and is unchanged by this PR. The framing moved; the rule did not.
- `optional`: `{ mission: 'recovery', label: 'Active Recovery', duration, exercises, countsTowardWeek: false }`. Never "Bonus Work". If the narrowed plan is empty, `optional` is `null` rather than an offer with nothing in it.
- `recoveryPlan` is returned and narrowed, so the screener and tight-floor rules apply to the optional offer too.
- A rest day is not a failure and does not enter either side of the weekly count.

## COMPLETE

```js
} else if (completedDays[today] === true) {
    state = 'COMPLETE'; reason = REASONS.complete;
}
```

Rule 4. Requires an exact `true`; a truthy value does not count, because `completed_days` arrives from PostgREST and has been seen holding strings.

- `mission: null`, `duration: null`. No second task is manufactured.
- `reason`: `"Today is done."`
- `overrideAllowed: true`. A member may still train again; the UI should not make that a dominant call to action.
- `optional`: the same quiet Active Recovery offer as REST, `countsTowardWeek: false`.
- Beats high soreness (rule 5). A finished day stays finished.

**Known limitation.** `completedDays` is one boolean per weekday index, so a second session on the same day collapses into the first, and a session logged on a scheduled rest day cannot be counted at all. Documented in `src/weekCompletion.js`; solving it is a persisted-shape change and a migration, deliberately out of scope.

## RESUME

```js
} else if (i.sessionDraft) {
    state = 'RESUME';
    mission = i.sessionDraft.routineType || null;
    reason = REASONS.resume;
}
```

Rule 2. Any truthy `sessionDraft` triggers it; the draft is `bp_session_draft_<userId>` in localStorage.

- `mission` comes from the draft's own `routineType`, not from the schedule, so resuming returns to what was actually started.
- `reason`: `"You left a session unfinished."`
- `overrideAllowed: true`. The member can discard the draft and start something else.
- Beats a missing goal, a finished day, high soreness and everything below. **Only unloaded data outranks it**, because acting on a draft before state has loaded would be acting on nothing.
- `duration` is estimated for the draft's mission as a whole session; it does **not** subtract the exercises already completed. The draft stores `exerciseIndex` and `setIndex`, so a remaining-time estimate is possible but was not built, and a number that overstates what is left is worse than no number. Flagging as a 2A.2 decision.

---

# 10. Scope confirmation

| Area | Changed? | Evidence |
|---|---|---|
| Training protocols | **No** | `ROUTINES` sets, durations, cues, `howto` steps, `eq`, `feel` and `dontFeel` are untouched except for three `detail` strings whose only change was removing anatomical claims. A drift-guard test asserts every per-exercise `sets` and `duration` is unchanged. |
| Exercise volume | **No** | `DIFFICULTIES`, `GIRTH_CIRCUIT`, `applyDifficulty()`, `applyDeload()`, `isDeloadWeek()` untouched. Asserted by the drift-guard block in `tests/sessionDuration.test.js`. |
| Screener questions / scoring | **No** | `PELVIC_SCREEN_QUESTIONS`, `PELVIC_TIGHT_THRESHOLD` (3), `scorePelvicScreen()`, `submitPelvicScreen()` untouched. Profiles remain `tight` and `standard`; nothing infers weak, underactive or balanced. |
| Pricing | **No** | No pricing file or string in the diff. |
| Coach Tee behaviour | **No** | `functions/api/coach-tee.js` not in the diff. `SYSTEM_PROMPTS`, the live-data block and the suggested-question chips are untouched. |
| Auth / access | **No** | No change to `functions/api/`, `src/worker.js`, the Ko-fi webhook, JWT verification or membership checks. |
| Notifications | **No** | No change to `supabase/functions/`, `_shared/`, the SQL files, VAPID keys or the push subscription path. |
| Landing page | **No** | Root `index.html` not in the diff. |
| Session routing | **No** | `goToStep()`, `advanceEx()`, `startRest()`, `startGirthRoundRest()`, the Mission Select handlers and `isBlackoutDay()` are all unchanged. The new modules are inert; nothing in `app/index.html` imports or calls them. |

Full changed-file list, `git diff --name-only origin/main...HEAD`:

```
app/index.html
docs/phase-2a1-report.md
src/nextBestAction.js
src/sessionDuration.js
src/weekCompletion.js
tests/nextBestAction.test.js
tests/sessionDuration.test.js
tests/weekCompletion.test.js
```

Member data is unaffected: no persisted field was added, removed, renamed or written differently, and no migration is included.
