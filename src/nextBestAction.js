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
