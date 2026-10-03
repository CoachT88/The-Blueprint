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
/** The seven states. OPTIONAL is not one of them: see `optional` on the result. */
export const STATES = ['PREPARE', 'RESUME', 'TRAIN', 'MODIFIED', 'RECOVER', 'REST', 'COMPLETE'];

/** Missions that are mechanical training. Overridable per call via `trainingMissions`. */
export const TRAINING_MISSIONS = ['length', 'girth', 'stamina'];

/**
 * Missions that prescribe pelvic floor specific work, and so sit behind the
 * screener. Overridable per call via `pelvicMissions`.
 *
 * Only Recovery contains contraction exercises today. Phase 2B adds pelvic
 * specific training days, and this is the single place that has to know.
 */
export const PELVIC_MISSIONS = ['recovery'];

/**
 * The schedule could not be read.
 *
 * Expressed as a PREPARE reason rather than an eighth top-level state. PREPARE
 * already means "something has to be answered before anything can be
 * prescribed", already returns a null mission and a null duration, and already
 * refuses an override. An unreadable schedule is exactly that, and the locked
 * state list is seven. Promoting it to its own state is a one-line change if
 * the reviewer prefers it; see the correction report.
 */
export const SCHEDULE_UNRESOLVED = 'schedule-unresolved';

/** Why a PREPARE was returned. The UI must be able to explain which gate it hit. */
export const PREPARE_REASONS = ['loading', 'goal', 'pelvic-screen', SCHEDULE_UNRESOLVED];

/* This module used to carry its own isDeloadWeek(firstSessionDate, now),
   a copy of the old `getISOWeek(now) % 4 === 0` rule. When the real deload
   moved to accumulated qualifying work, that copy stayed behind and kept
   deciding what the Today card SAID while the ledger decided what the
   session actually did. The two disagreed most weeks.

   There is now one source. `deload` is an input: the caller passes the
   authoritative answer in, exactly as it passes the schedule and the
   soreness in, and this module never computes it. See deloadState() in
   src/progressionLedger.js. */

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
export function isPelvicSpecific(mission, recoveryIndices, contractionIndices, pelvicMissions) {
    const pelvic = Array.isArray(pelvicMissions) ? pelvicMissions : PELVIC_MISSIONS;
    if (!pelvic.includes(mission)) return false;
    /* Recovery is only pelvic specific when the plan actually reaches the
       contraction exercises; a morning hip set is not. A dedicated pelvic
       mission, which is what 2B adds, is pelvic specific by definition. */
    if (mission !== 'recovery') return true;
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
    scheduleUnresolved: "We couldn't determine today's session from your current schedule.",
};

const CHANGES = {
    deload: 'This is a deload week, so the volume is lower than usual.',
    tightFloor: 'Contraction work is left out because your screener flagged a tight floor.',
    moderateSoreness: 'One set fewer and shorter holds than a normal session.',
    pelvicScreenRequired: 'Take the pelvic floor check to unlock contraction work.',
    withheldSession: 'Your unfinished session is on hold while you are reporting high muscle soreness.',
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
 *   deload            boolean, the authoritative deload answer from the caller
 *   dayTypes          the DAY_TYPES table, for labels inside reasons
 *   recoveryPlan      recovery exercise indices a Recovery prescription would use
 *   contractionIndices  CONTRACTION_RECOVERY_IDX
 *   trainingMissions  optional, defaults to TRAINING_MISSIONS
 *   pelvicMissions    optional, defaults to PELVIC_MISSIONS
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
 *   withheldSession   an unfinished session deliberately not offered, else null
 *   recoveryPlan      the recovery indices this prescription may actually use
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
    const trainingMissions = Array.isArray(i.trainingMissions) ? i.trainingMissions : TRAINING_MISSIONS;

    /* An unfinished session is normally the best thing to do next. It is not,
       when it is mechanical work and the member has just reported high
       soreness: resuming would walk straight through the one rule that has no
       override. A draft whose type we cannot read counts as mechanical, so an
       unreadable draft is withheld rather than waved through. */
    const draftMission = i.sessionDraft ? (i.sessionDraft.routineType || null) : null;
    const draftIsMechanical = !!i.sessionDraft && draftMission !== 'recovery';
    const resumeBlockedBySoreness = draftIsMechanical && soreness === 'high';

    const modifiers = {
        deload: !!i.deload,
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

         1  no data             we do not know anything yet, so prescribe nothing
         2  unfinished session  finishing it beats starting something else,
                                UNLESS it is mechanical and soreness is high
         3  no goal             every prescription below depends on this
         4  already complete    never manufacture a second task
         5  high soreness       withheld, and not overridable
         6  scheduled rest      rest is a prescription, not an absence of one
         7  unreadable schedule we cannot know what today is, so prescribe nothing
         8  moderate soreness   reduced, still trained
         9  scheduled mission   the ordinary case

       Rules 5 and 2 are the one place where "first match wins" is not the
       whole story. High soreness has no override, so letting an unfinished
       mechanical session resume above it would route straight around the only
       rule in the ladder that cannot be argued with. The guard lives on rule 2
       rather than moving rule 5 up, because moving it would also put soreness
       above a finished day and above a missing goal, neither of which was the
       problem.

       Rule 7 sits above moderate soreness and above the ordinary case on
       purpose: once it has passed, `scheduled` is a known-good mission, so
       nothing below it has to guess, and no branch invents a mission from the
       goal. A corrupt schedule produces no required work at all.            */

    let state, mission = null, reason = '', prepare = null, intendedMission = null;

    if (!i.dataLoaded) {
        state = 'PREPARE'; prepare = 'loading'; reason = REASONS.loading;
    } else if (i.sessionDraft && !resumeBlockedBySoreness) {
        state = 'RESUME';
        mission = draftMission;
        reason = REASONS.resume;
    } else if (!goal) {
        state = 'PREPARE'; prepare = 'goal'; reason = REASONS.goal;
    } else if (completedDays[today] === true) {
        state = 'COMPLETE'; reason = REASONS.complete;
    } else if (soreness === 'high') {
        state = 'RECOVER'; mission = 'recovery'; reason = REASONS.highSoreness;
    } else if (scheduled === 'rest') {
        state = 'REST'; reason = REASONS.rest;
    } else if (!trainingMissions.includes(scheduled)) {
        /* Missing, empty or unrecognised. getScheduledType() returns 'rest'
           here, which quietly turns a corrupt array into a week off; the
           earlier version of this file fell back to the goal's mission, which
           invented required training out of broken state. Neither is honest.
           Say the schedule could not be read and let the UI offer a repair. */
        state = 'PREPARE'; prepare = SCHEDULE_UNRESOLVED; reason = REASONS.scheduleUnresolved;
    } else if (soreness === 'moderate') {
        state = 'MODIFIED'; mission = scheduled;
        modifiers.moderateSoreness = true;
        reason = REASONS.moderateSoreness;
    } else {
        state = 'TRAIN'; mission = scheduled;
        reason = `Today is a ${labelFor(scheduled)} day on your schedule.`;
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
    /* Against the actual prescription, and nothing else. REST and COMPLETE
       prescribe no work at all now, so there is nothing for the screener to
       gate on those days and no reason to raise it. */
    const prescriptionIsPelvic = isPelvicSpecific(
        mission, i.recoveryPlan, i.contractionIndices, i.pelvicMissions);
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
    if (resumeBlockedBySoreness) changes.push(CHANGES.withheldSession);
    if (modifiers.moderateSoreness) changes.push(CHANGES.moderateSoreness);
    if (modifiers.deload && mission && mission !== 'recovery') changes.push(CHANGES.deload);
    if (modifiers.tightFloor && mission === 'recovery') changes.push(CHANGES.tightFloor);
    if (modifiers.pelvicScreenRequired && state !== 'PREPARE') changes.push(CHANGES.pelvicScreenRequired);

    return {
        state,
        mission,
        reason,
        /* RESUME knows the mission but not how much of it is left. The draft
           carries exerciseIndex and setIndex, so a remaining-time estimate is
           possible, and until it exists a whole-session number would overstate
           what is in front of the member. Null is the honest answer. */
        duration: state === 'RESUME'
            ? null
            : minutes(mission, { moderateSoreness: modifiers.moderateSoreness }),
        modifiers,
        /* The unfinished session we are deliberately not offering, so the UI
           can say it exists and why it is on hold rather than losing it. */
        withheldSession: resumeBlockedBySoreness
            ? { mission: draftMission, why: 'high-soreness' }
            : null,
        /* Which recovery exercises this prescription may actually use. Null
           when nothing recovery shaped is on offer. Narrowed rather than
           silently filtered downstream, so the UI can name what is missing. */
        recoveryPlan: mission === 'recovery' ? recoveryPlan : null,
        /* High soreness is the one prescription with no way around it. Making
           a safety recommendation and then offering a prominent button to
           ignore it is not a recommendation. PREPARE has no override either:
           the gate is the point.
           The last clause closes the back door: if a mechanical session is
           being withheld, no override may be offered from any state, because
           the only thing an override could mean here is resuming it. */
        overrideAllowed: !(state === 'RECOVER' && soreness === 'high')
            && state !== 'PREPARE' && state !== 'REST' && !resumeBlockedBySoreness,
        /* Always null, deliberately.
           REST and COMPLETE were the only two states that offered Active
           Recovery, and in both the offer worked against the thing the state
           exists to say. "Today is done" followed by a suggestion is not
           done. "Rest is the prescription" followed by four minutes of work
           teaches that rest is the lesser option and that following the
           programme is never quite enough.
           The field stays on the result because the shape is part of the
           API, and because a later state may legitimately carry a quiet
           secondary offer. Neither of these two does. */
        optional: null,
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

