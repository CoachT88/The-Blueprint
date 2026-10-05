/**
 * May we generate over this member's week, or is it theirs?
 *
 * That is the only question this module answers. Not what their programme
 * should be, not what any day should contain, not whether they progress, not
 * what to do about the answer. Generation belongs to a later phase and none
 * of it is here.
 *
 * WHY A CLASSIFIER EXISTS AT ALL
 *
 * The programme is currently seven strings indexed by Date#getDay(). Three
 * different things can have put them there and the stored value does not say
 * which: the factory default, a goal preset applied in one go, or the member
 * tapping days one at a time. Day-plan generation has to project back onto
 * that column, and a projection over a week somebody arranged themselves is
 * not a migration, it is data loss with a progress bar.
 *
 * So before anything generates, every account gets classified once, and the
 * classification decides whether generation may touch them.
 *
 * THE STANDARD OF PROOF
 *
 * Prefer a false negative over overwriting member intent. A schedule is
 * attributable to a preset only when the stored state positively supports
 * that conclusion; the absence of evidence to the contrary is not support.
 * The same bar programmeStartBackfill holds itself to in src/progression.js,
 * for the same reason: the cost of a wrong confident answer falls entirely on
 * the member.
 *
 * Six of the eight exits below are CUSTOM. That is the design working, not a
 * classifier that failed to decide.
 *
 * WHAT IS DELIBERATELY NOT AN INPUT
 *
 * Session count, session log, first-session date, ledger, difficulty, start
 * date. None of them says anything about whether a week was edited.
 * assignDay() has existed since the first commit in this repository, before
 * sessions could be logged and before goals existed, so a member with zero
 * sessions has had every opportunity to arrange their own week.
 * `allTimeSessionCount === 0` is not proof of an untouched schedule and is
 * not consulted.
 *
 * WHAT THIS MODULE REFUSES TO RECONSTRUCT
 *
 * If this build had to repair the stored schedule before reading it, the
 * verdict is CUSTOM and no attempt is made to work out what the broken value
 * meant. A truncated week repaired into something that happens to equal a
 * preset must never become auto-migratable.
 *
 * THE INVARIANT THIS HANDS TO GENERATION
 *
 * While programme.custom === true and programme.adopted !== true, the legacy
 * schedule remains authoritative and projection must not overwrite it.
 * Explicit adoption is what permits the authority transition, and replacing
 * the legacy week is then an intended consequence of that adoption rather
 * than a migration side effect.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs. The presets and
 * the default are injected rather than imported, because they live in the
 * page and a second copy here is exactly how two definitions drift apart.
 */

import { classifySlot, SLOT_CLASS } from './scheduleSlot.js';

/** What a stored legacy schedule turned out to be. */
export const PROGRAMME_SOURCE = Object.freeze({
    DEFAULT: 'default',
    PRESET:  'preset',
    CUSTOM:  'custom',
});

/**
 * Why the classifier reached its verdict.
 *
 * Carried into the stored programme so a support question has an answer
 * years later, and so a test can assert the route taken rather than only the
 * destination. Two inputs can both be CUSTOM for quite different reasons and
 * the product consequence differs.
 */
export const CLASSIFY_REASON = Object.freeze({
    /** Not seven slots, or a slot outside the closed legacy vocabulary. */
    UNREADABLE_SHAPE: 'unreadable_shape',
    /** This build had to repair it before reading, so provenance is unknowable. */
    REPAIRED: 'repaired_before_classification',
    /** A stored goal from a vocabulary this build does not know. */
    UNKNOWN_GOAL: 'unrecognised_goal_vocabulary',
    /** The week matches the preset for the goal the member stated. */
    PRESET_MATCHES_GOAL: 'preset_shape_matches_stated_goal',
    /** The factory default, on an account that has never stated a goal. */
    DEFAULT_NO_GOAL: 'default_shape_no_goal_ever_answered',
    /** The factory default, on an account whose stated goal wants another week. */
    DEFAULT_CONTRADICTS_GOAL: 'default_shape_contradicts_stated_goal',
    /** A preset week, but not the one the stated goal would have applied. */
    PRESET_WITHOUT_GOAL: 'preset_shape_without_matching_goal',
    /** A week this member arranged themselves. */
    NO_RECOGNISED_SHAPE: 'no_recognised_shape',
});

/** The programme model version this module writes. */
export const PROGRAMME_VERSION = 1;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sameWeek = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length
        && a.every((v, i) => v === b[i]);

/**
 * Is this seven slots this build can read?
 *
 * Length and vocabulary, nothing else. classifySlot() owns what a slot may
 * be, with no options passed, so the closed legacy vocabulary is the only
 * one accepted and a caller cannot widen it to make a custom week look
 * recognised.
 */
function readableWeek(schedule) {
    if (!Array.isArray(schedule) || schedule.length !== 7) return false;
    return schedule.every(s => classifySlot(s) !== SLOT_CLASS.UNRESOLVED);
}

/**
 * Classify a stored legacy schedule.
 *
 * Returns { verdict, reason, presetKey }. presetKey is non-null only for a
 * PRESET verdict, and it names which preset the EXISTING week is attributable
 * to. It is not a decision about what to generate.
 *
 * `schedule` is the value as loaded, which in the application means after
 * normaliseSchedule() has run, hence `scheduleRepaired`. The function does
 * not assume its caller repaired anything: a readable week is a precondition
 * it checks rather than inherits.
 */
export function classifyLegacySchedule(input) {
    const {
        schedule,
        scheduleRepaired,
        primaryGoal,
        presets,
        defaultSchedule,
    } = isPlainObject(input) ? input : {};

    const table = isPlainObject(presets) ? presets : {};
    const keys = Object.keys(table);
    const custom = (reason) => ({
        verdict: PROGRAMME_SOURCE.CUSTOM, reason, presetKey: null,
    });

    /* 1. Seven readable slots, or nothing can be said about it. */
    if (!readableWeek(schedule)) return custom(CLASSIFY_REASON.UNREADABLE_SHAPE);

    /* 2. Repair happened, so the stored value was not something this build
          could read, and nothing about it is attributable. Deliberately
          ahead of every shape comparison: a repaired week may now equal a
          preset exactly, and that coincidence is not evidence. */
    if (scheduleRepaired === true) return custom(CLASSIFY_REASON.REPAIRED);

    /* 3. A goal we cannot interpret is a goal we cannot attribute a shape
          with. The vocabulary has never changed in production, so this is
          reached through an imported backup or a future vocabulary change. */
    if (typeof primaryGoal === 'string' && primaryGoal !== ''
        && !Object.prototype.hasOwnProperty.call(table, primaryGoal)) {
        return custom(CLASSIFY_REASON.UNKNOWN_GOAL);
    }

    const goal = (typeof primaryGoal === 'string'
        && Object.prototype.hasOwnProperty.call(table, primaryGoal)) ? primaryGoal : '';
    const matched = keys.filter(k => sameWeek(schedule, table[k]));
    const isDefault = sameWeek(schedule, defaultSchedule);

    /* 4. The only positive attribution in the table. The stated goal and the
          stored week agree, and the one code path that writes a preset also
          writes that goal, so the two agreeing is evidence rather than
          coincidence. This is also the route for the preset whose array is
          byte-identical to the default: the distinction makes no observable
          difference to anything generated from it. */
    if (goal !== '' && matched.includes(goal)) {
        return {
            verdict: PROGRAMME_SOURCE.PRESET,
            reason: CLASSIFY_REASON.PRESET_MATCHES_GOAL,
            presetKey: goal,
        };
    }

    /* 5. The narrowest claim here, and the only non-custom verdict for an
          account with no stated goal. It does NOT prove no edit happened;
          assignDay predates everything and leaves no trace. It proves that no
          preset was ever applied, because the only code that applies one also
          records the goal, and that the stored week is byte-identical to the
          factory default. A member who edited away and back lands here and
          loses nothing by it: a programme generated from the default shape
          reproduces the exact week they already have. */
    if (goal === '' && isDefault) {
        return {
            verdict: PROGRAMME_SOURCE.DEFAULT,
            reason: CLASSIFY_REASON.DEFAULT_NO_GOAL,
            presetKey: null,
        };
    }

    /* 6. The default week on an account whose stated goal would have applied
          a different one. They declined the prompt or edited their way back,
          and we cannot tell which. Its own reason code because the support
          answer and the product consequence differ from rule 7. */
    if (isDefault) return custom(CLASSIFY_REASON.DEFAULT_CONTRADICTS_GOAL);

    /* 7. A preset week that is not the one their goal would have applied. */
    if (matched.length > 0) return custom(CLASSIFY_REASON.PRESET_WITHOUT_GOAL);

    /* 8. A week they arranged themselves. */
    return custom(CLASSIFY_REASON.NO_RECOGNISED_SHAPE);
}

/**
 * The programme object a classification is stored as.
 *
 * Separate from the verdict so the decision stays testable without a clock,
 * and so the stored shape can change without touching a single rule.
 *
 * `adopted` is written for every class and is only consulted when `custom` is
 * true. One stored shape is worth more than a field that is sometimes absent.
 *
 * There is deliberately no frozen copy of the legacy schedule in here. The
 * schedule column is already that copy, this phase does not write it, and
 * projection may not overwrite it while a custom member is unadopted. A
 * second representation would be another lifecycle to keep correct for no
 * additional safety.
 */
export function migrationProgramme(classification, opts) {
    const c = isPlainObject(classification) ? classification : {};
    const verdict = Object.values(PROGRAMME_SOURCE).includes(c.verdict)
        ? c.verdict : PROGRAMME_SOURCE.CUSTOM;
    const reason = typeof c.reason === 'string' && c.reason !== ''
        ? c.reason : CLASSIFY_REASON.NO_RECOGNISED_SHAPE;
    const custom = verdict === PROGRAMME_SOURCE.CUSTOM;
    return {
        version: PROGRAMME_VERSION,
        source: verdict,
        presetKey: (verdict === PROGRAMME_SOURCE.PRESET && typeof c.presetKey === 'string')
            ? c.presetKey : null,
        custom,
        adopted: false,
        reason,
        classifiedAt: dayKey(opts && opts.now),
    };
}

/**
 * Local calendar day, as a date key.
 *
 * Local rather than UTC, matching localDayKey in src/liveness.js: the date
 * recorded is the one the member would have seen on their own calendar.
 */
function dayKey(now) {
    const d = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(d.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * May generation touch this member's week?
 *
 * The invariant in one place, so no caller has to remember to check both
 * fields. A member with no classification yet is not generatable: absence of
 * a verdict is not permission.
 */
export function mayGenerateOver(programme) {
    if (!isPlainObject(programme)) return false;
    if (programme.custom === true) return programme.adopted === true;
    return Object.values(PROGRAMME_SOURCE).includes(programme.source);
}
