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
/* The refusal vocabulary, imported rather than restated, so the one place
   that distinguishes a legacy unreadable slot from an authoritative
   unreadable plan cannot drift from the adapter that produces it. */
import { PRESCRIPTION_REFUSAL as PRESCRIPTION_UNAVAILABLE_REASONS } from './todayPrescription.js';

/** The seven states. OPTIONAL is not one of them: see `optional` on the result. */
export const STATES = ['PREPARE', 'RESUME', 'TRAIN', 'MODIFIED', 'RECOVER', 'REST',
                       'SUPPORT_ONLY', 'COMPLETE'];

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

/**
 * An AUTHORITATIVE member's dated prescription for today could not be read.
 *
 * Deliberately not SCHEDULE_UNRESOLVED. That one offers the day picker as a
 * repair, which is the right affordance for a member whose column IS their
 * programme and the wrong one here: a missing or corrupt dated plan is not
 * something the member can fix by assigning a type, and offering it would
 * invite an edit the next load overwrites.
 */
export const PRESCRIPTION_UNAVAILABLE = 'prescription-unavailable';

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
    prescriptionUnavailable: "We couldn't read today's session from your programme.",
    /* A VALID programme state, so the copy carries no hint of breakage and
       offers nothing to fix. Deliberately silent about the supporting work on
       the day, because that surface does not exist yet; saying the day is
       empty would be the lie, and saying it is rest would be a worse one. */
    supportOnly: "There's no primary training session scheduled for today.",
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
 *   todayPrescription one truthful Today prescription from the page adapter:
 *                     { ok, source, date, dayKind, primaryType, planMode, dose }
 *                     or { ok: false, source, date, reason }. See
 *                     src/todayPrescription.js. This replaced a seven-slot
 *                     compatibility projection, which this function used to
 *                     index itself: for an authoritative member that array is
 *                     derived OUTPUT, so reading it here let a projection
 *                     decide what the member trained.
 *   primarySatisfied  boolean, has today's prescribed PRIMARY work been done.
 *                     Resolved by the adapter according to authority, because
 *                     the dated answer and the legacy seven-boolean answer are
 *                     different questions and this function must not pick.
 *   sessionDraft      the unfinished session, or null
 *   soreness          '' | 'none' | 'mild' | 'moderate' | 'high'
 *   pelvicProfile     '' | 'tight' | 'standard'
 *   deload            boolean, the authoritative deload answer from the caller
 *   weekComplete      boolean, every scheduled session of this week is done
 *   returnContext     null | 'returning' | 'extended-return', from the caller
 *   dayTypes          the DAY_TYPES table, for labels inside reasons
 *   recoveryPlan      recovery exercise indices a Recovery prescription would use
 *   contractionIndices  CONTRACTION_RECOVERY_IDX
 *   trainingMissions  no longer read. The vocabulary question moved to the
 *                     adapter, which is where the two cohorts' prescriptions
 *                     are interpreted. TRAINING_MISSIONS is still exported
 *                     because callers use it.
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
 *   weekComplete      echoed back, so the UI reads one object
 *   returnContext     echoed back, same reason
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
    /* A refusal shape when the caller supplied nothing, so every read below
       is uniform and an absent adapter answer cannot read as a prescription. */
    const pres = (i.todayPrescription && typeof i.todayPrescription === 'object')
        ? i.todayPrescription
        : { ok: false, source: null, date: null, reason: PRESCRIPTION_UNAVAILABLE };
    const primaryDone = i.primarySatisfied === true;
    const scheduled = (pres.ok === true && pres.dayKind === 'primary')
        ? pres.primaryType : null;
    const screened = hasPelvicScreen(i.pelvicProfile);
    const estimate = typeof i.estimateMinutes === 'function' ? i.estimateMinutes : null;

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
         4  primary satisfied   never manufacture a second task. ONLY from a
                                Primary prescription; see below
         5  cannot read today   we do not know what was prescribed
         6  prescribed rest     rest is a prescription, not an absence of one
         7  support only        valid, non-launching, and not rest
         8  high soreness       withheld, and not overridable
         9  moderate soreness   reduced, still trained
        10  prescribed mission  the ordinary case

       WHY DAY IDENTITY SITS ABOVE READINESS, as of Phase 3C.4.

       High soreness used to sit at rung 5, above rest, above support only and
       above an unreadable prescription. That let a live readiness answer
       replace the programme's day identity: a sore member on a prescribed
       rest day was given a Recovery day the programme never prescribed, and a
       sore member whose dated plan was corrupt was given one too, which hid a
       data-integrity failure behind a safety state.

       Soreness WITHHOLDS mechanical work. It can only withhold work that was
       prescribed, so it now sits below the three rungs that decide whether
       any was. Rungs 6, 7 and 8 are therefore mutually exclusive by
       construction and rung 8 is reachable only on a Primary day.

       Two consequences for the legacy cohort, both deliberate and both
       pinned by name in the tests: a rest day with high soreness now reads
       REST rather than RECOVER, and a rest day with the compatibility
       completion tick set now reads REST rather than COMPLETE.

       Rules 8 and 2 are the one place where "first match wins" is not the
       whole story. High soreness has no override, so letting an unfinished
       mechanical session resume above it would route straight around the only
       rule in the ladder that cannot be argued with. The guard lives on rule 2
       rather than moving rule 8 up, because moving it would also put soreness
       above a finished day and above a missing goal, neither of which was the
       problem.

       Rule 5 sits above everything that prescribes, on purpose: once it has
       passed, the prescription is known-good, so nothing below it has to
       guess and no branch invents a mission. An unreadable prescription
       produces no required work at all.                                     */

    let state, mission = null, reason = '', prepare = null, intendedMission = null;

    if (!i.dataLoaded) {
        state = 'PREPARE'; prepare = 'loading'; reason = REASONS.loading;
    } else if (i.sessionDraft && !resumeBlockedBySoreness) {
        state = 'RESUME';
        mission = draftMission;
        reason = REASONS.resume;
    } else if (!goal) {
        state = 'PREPARE'; prepare = 'goal'; reason = REASONS.goal;
    } else if (pres.ok === true && pres.dayKind === 'primary' && primaryDone) {
        /* COMPLETE is reachable ONLY from a Primary prescription. A rest day
           and a support-only day both have a today and neither has a Primary
           to satisfy, so letting either reach COMPLETE would collapse three
           different completion concepts into one. */
        state = 'COMPLETE'; reason = REASONS.complete;
    } else if (pres.ok !== true) {
        /* We could not read what today is, so we prescribe nothing. The old
           reader returned 'rest' here, which turned broken state into a week
           off, and an older version fell back to the goal's mission, which
           invented required training. For an authoritative member the column
           is derived OUTPUT and reading it here would manufacture a
           prescription from a projection. Neither is honest.

           ABOVE high soreness, deliberately. Readiness must not mask a
           data-integrity failure: a sore member with an unreadable plan has
           an unreadable plan, and answering that with a Recovery day hides
           the condition somebody needs to see. */
        state = 'PREPARE';
        prepare = pres.reason === PRESCRIPTION_UNAVAILABLE_REASONS.SLOT_UNRESOLVED
            ? SCHEDULE_UNRESOLVED : PRESCRIPTION_UNAVAILABLE;
        reason = prepare === SCHEDULE_UNRESOLVED
            ? REASONS.scheduleUnresolved : REASONS.prescriptionUnavailable;
    } else if (pres.dayKind === 'rest') {
        /* ABOVE high soreness. Rest is a prescription and there is no Primary
           to withhold, so answering it with RECOVER would manufacture a
           Recovery day the programme never prescribed. */
        state = 'REST'; reason = REASONS.rest;
    } else if (pres.dayKind === 'support-only') {
        /* ABOVE high soreness, same reasoning. A valid programme state with
           no Primary to withhold. Non-launching until Supporting Work has a
           surface of its own, and never described as rest or as broken. */
        state = 'SUPPORT_ONLY'; reason = REASONS.supportOnly;
    } else if (soreness === 'high') {
        /* Only reachable on a PRIMARY prescription now, which is the point:
           high soreness WITHHOLDS mechanical work, and it can only withhold
           work that was prescribed. */
        state = 'RECOVER'; mission = 'recovery'; reason = REASONS.highSoreness;
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
        /* Liveness context, Phase 2B.2. Both are INPUTS, computed by the
           caller from the authoritative sources and echoed here so the UI
           reads one object. Neither has touched state, mission, duration or
           any modifier above: this phase is communication only, and the
           tests assert that the prescription is identical with and without
           them. */
        weekComplete: !!i.weekComplete,
        returnContext: i.returnContext || null,
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

