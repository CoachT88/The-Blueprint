/**
 * What does the programme prescribe today, and has it been satisfied?
 *
 * Two values, one place, and nothing else. Not whether to train, not what the
 * session contains, not how readiness changes it. This is the adapter that
 * turns a member's authority into one truthful Today prescription so the
 * resolver can stop reading a seven-day compatibility projection to answer a
 * question about one day.
 *
 * AUTHORITY IS SUPPLIED, NEVER DECIDED HERE
 *
 * `authoritative` arrives as a boolean, exactly as weekStrip.js takes it.
 * mayGenerateOver(), programme.key, migration.source and adoptedAt are
 * interpreted in exactly one place in the application and this is not it. A
 * second module that re-derives authority is a second authority.
 *
 * WHY A RECORD AND NOT A TYPE STRING
 *
 * getScheduledType() returned a legacy type string and that is precisely why
 * it could not be handed to the resolver. It collapsed three different
 * conditions onto 'rest': a prescribed rest day, a support-only day, and a
 * primary session with no readable type. A support-only day became a rest day
 * by contract rather than by accident, and a missing plan became a mechanical
 * session from the projection.
 *
 * So the answer carries a KIND. Rest is rest, support-only is itself, and a
 * missing or unreadable plan is a refusal rather than a prescription.
 *
 * FAIL CLOSED FOR AN AUTHORITATIVE MEMBER
 *
 * The old reader reported a day-plan integrity failure and then quietly read
 * the compatibility column anyway, so the programme said "dated plans are
 * authoritative", the plan was missing, and the member was prescribed
 * mechanical work from a recurring projection. That is the authority leak
 * this module exists to close. When we do not know, we do not invent.
 *
 * planMode AND dose RIDE ALONG UNREAD
 *
 * Both are carried so the next phase has a seam instead of a rewrite, and
 * NEITHER changes behaviour in this one. `planMode` is deliberately not
 * called `mode`: the resolver has a state called MODIFIED which means a live
 * moderate-soreness response, and a stored planMode of 'modified' is an
 * unrelated concept. They currently share a word and nothing reconciles them.
 * Keeping the names apart is the whole reason the field is spelled this way.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs, no writes.
 */

import { localDateKey, dateKeyForWeekday } from './weekUtils.js';
import { normaliseDayPlan, isDateKey } from './dayPlan.js';
import { classifySlot, SLOT_CLASS, LEGACY_PRIMARY_TYPES, LEGACY_REST } from './scheduleSlot.js';
import { performedByAttribution } from './sessionAttribution.js';

/** What kind of day the programme prescribed. Three answers, all valid. */
export const DAY_KIND = Object.freeze({
    /** A Primary Training Session. The only kind that can be launched. */
    PRIMARY:      'primary',
    /** Supporting work and no Primary. Valid, and not rest. */
    SUPPORT_ONLY: 'support-only',
    /** Prescribed rest. No Primary, no Supporting Work. */
    REST:         'rest',
});

/** Why there is no prescription to report. None of these is a prescription. */
export const PRESCRIPTION_REFUSAL = Object.freeze({
    /** `now` was missing or unreadable. The caller must supply it. */
    NO_CLOCK:         'no_clock',
    /** Authoritative member, no dated plan for today at all. */
    PLAN_MISSING:     'plan_missing',
    /** Authoritative member, today's dated record cannot be interpreted. */
    PLAN_UNREADABLE:  'plan_unreadable',
    /** A prescribed type outside the vocabulary this build can run. */
    SLOT_UNRESOLVED:  'slot_unresolved',
});

export const PRESCRIPTION_SOURCE = Object.freeze({
    DATED_PLAN: 'dated-plan',
    LEGACY:     'legacy',
});

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const validDate = (v) => v instanceof Date && !isNaN(v.getTime());

/** The mechanical missions. One definition, shared with weekCompletion. */
export const MECHANICAL_TYPES = Object.freeze(['length', 'girth', 'stamina']);

/**
 * Today's prescription identity.
 *
 * Returns, on success:
 *   { ok: true, source, date, dayKind, primaryType, planMode, dose }
 * and on a refusal:
 *   { ok: false, source, date, reason }
 *
 * `date` is present on a refusal too, because "which day could we not read"
 * is the first thing anybody debugging one needs, and it is knowable even
 * when the plan is not.
 */
export function todayPrescription(input) {
    const i = isPlainObject(input) ? input : {};
    if (!validDate(i.now)) {
        return { ok: false, source: null, date: null, reason: PRESCRIPTION_REFUSAL.NO_CLOCK };
    }
    const date = localDateKey(i.now);
    /* The known set is configurable, exactly as classifySlot's is and for the
       same reason: the resolver used to pass its own `trainingMissions` so a
       future pelvic training day was reachable and provable before it ships.
       That seam moved here with the vocabulary question. Note the asymmetry
       scheduleSlot.js documents: a READER may be told what counts, a
       PROJECTION may not, because the persisted column's vocabulary is
       closed. This is a reader. */
    const primaries = Array.isArray(i.primaryTypes) ? i.primaryTypes : LEGACY_PRIMARY_TYPES;

    if (i.authoritative !== true) {
        /* Legacy and custom members: the seven-slot column IS their
           programme, Sunday-indexed, and interpreting it belongs here rather
           than inside the resolver. */
        const src = PRESCRIPTION_SOURCE.LEGACY;
        const sched = Array.isArray(i.legacySchedule) ? i.legacySchedule : [];
        const slot = sched[i.now.getDay()];
        const cls = classifySlot(slot, { primaryTypes: primaries });
        if (cls === SLOT_CLASS.REST) {
            return { ok: true, source: src, date, dayKind: DAY_KIND.REST,
                     primaryType: null, planMode: null, dose: null };
        }
        if (cls === SLOT_CLASS.PRIMARY) {
            return { ok: true, source: src, date, dayKind: DAY_KIND.PRIMARY,
                     primaryType: slot, planMode: null, dose: null };
        }
        /* Missing, empty or unrecognised. The repair affordance this cohort
           already has is the day picker, so the reason stays the one the UI
           already knows how to offer. */
        return { ok: false, source: src, date, reason: PRESCRIPTION_REFUSAL.SLOT_UNRESOLVED };
    }

    const src = PRESCRIPTION_SOURCE.DATED_PLAN;
    const raw = (Array.isArray(i.dayPlans) ? i.dayPlans : [])
        .find(p => isPlainObject(p) && p.date === date);
    if (!raw) {
        return { ok: false, source: src, date, reason: PRESCRIPTION_REFUSAL.PLAN_MISSING };
    }
    const plan = normaliseDayPlan(raw);
    if (!plan) {
        /* A dated record that cannot be interpreted is a data-integrity
           condition, not a fifth kind of prescribed day. It is neither
           repaired nor replaced here; see retainPlans, which preserves a
           corrupt Today deliberately so the evidence survives. */
        return { ok: false, source: src, date, reason: PRESCRIPTION_REFUSAL.PLAN_UNREADABLE };
    }

    const base = { ok: true, source: src, date, planMode: plan.mode };

    if (plan.mode === 'rest') {
        return { ...base, dayKind: DAY_KIND.REST, primaryType: null, dose: null };
    }

    const primary = plan.primarySession;
    if (!primary || typeof primary.type !== 'string' || !primary.type) {
        /* Valid programme state: supporting work and no Primary. NOT rest,
           and NOT broken. Translating it to rest would suppress a reminder
           for a day that has work on it, and translating it to a mechanical
           type would claim training nobody prescribed. */
        return { ...base, dayKind: DAY_KIND.SUPPORT_ONLY, primaryType: null, dose: null };
    }
    if (!primaries.includes(primary.type)) {
        /* A type this build cannot run. A stale cached shell reaching a newer
           plan lands here, and prescribing nothing is the honest answer. */
        return { ok: false, source: src, date, reason: PRESCRIPTION_REFUSAL.SLOT_UNRESOLVED };
    }
    return {
        ...base,
        dayKind: DAY_KIND.PRIMARY,
        primaryType: primary.type,
        /* Carried, NOT consumed. Phase 3C.5 decides execution authority. */
        dose: primary.dose === undefined ? null : primary.dose,
    };
}

/**
 * Has today's prescribed PRIMARY work been satisfied?
 *
 * Named for the Primary deliberately. A rest day and a support-only day both
 * have a today and neither has a Primary to satisfy, so a boolean called
 * "todaySatisfied" would let three different completion concepts collapse
 * into one the moment Daily Practice arrives.
 *
 * Only a Primary prescription can be satisfied, which is what keeps COMPLETE
 * out of the rest and support-only states.
 *
 * Authoritative: a qualifying mechanical session attributed to today's
 * prescription date. A Recovery-only day does not satisfy it, and neither
 * does a session whose prescription identity could not be proven; see
 * sessionAttribution.js for why the second one is deliberate.
 *
 * Legacy: the seven-boolean compatibility array, exactly as before. That
 * cohort's completion model is not redesigned in this phase.
 */
export function primarySatisfied(input) {
    const i = isPlainObject(input) ? input : {};
    const p = i.prescription;
    if (!isPlainObject(p) || p.ok !== true) return false;
    if (p.dayKind !== DAY_KIND.PRIMARY) return false;
    if (!validDate(i.now)) return false;

    if (p.source === PRESCRIPTION_SOURCE.LEGACY) {
        const done = Array.isArray(i.completedDays) ? i.completedDays : [];
        return done[i.now.getDay()] === true;
    }

    const mech = Array.isArray(i.mechanicalTypes) ? i.mechanicalTypes : MECHANICAL_TYPES;
    const { dated, legacy } = performedByAttribution(i.sessionLog, mech);
    /* The dated key is the plan's own local identity. The legacy key is the
       UTC date part of a pre-3C.4 timestamp, so it is looked up with the
       relationship those records were written under. Two keys, each compared
       against its own convention; see sessionAttribution.js. */
    const byPlan = dated.get(p.date);
    if (byPlan && byPlan.mechanical) return true;
    const byLegacy = legacy.get(dateKeyForWeekday(i.now, i.now.getDay()));
    return !!(byLegacy && byLegacy.mechanical);
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE LAUNCH IDENTITY SNAPSHOT

   Once a Primary session starts, the prescription it started under stops being
   a question anybody re-asks. A dashboard rerender, a Ready rerender, a
   soreness change, a midnight rollover, a week rollover and a regenerated plan
   must all leave an in-flight session's identity exactly as it was.

   It is a separate, frozen value rather than the render-time prescription
   because the render-time one is overwritten by every resolver call, and the
   audit that produced this phase found three such calls in a single journey.

   It is also PERSISTED, into the resumable session draft, which makes it
   untrusted input on the way back. A member can launch, close the browser,
   and resume tomorrow; if the draft carried only exercise position, resume
   would silently re-resolve the new day's prescription and attach the session
   to the wrong date and possibly the wrong type.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Why a stored launch snapshot was not adopted. */
export const SNAPSHOT_REFUSAL = Object.freeze({
    /** No snapshot at all. A pre-3C.4 draft, or a session with nothing to record. */
    ABSENT:    'absent',
    /** Present and unreadable. Never demoted to ABSENT; see below. */
    MALFORMED: 'malformed',
});

/**
 * Capture the launch identity from a prescription record.
 *
 * Returns a frozen snapshot, or null when there is no identity to capture.
 *
 * A REST day is captured too, as scheduledType 'rest'. The prescription is
 * perfectly well known on a rest day, and a member who launches Recovery
 * anyway has departed from it: discarding the identity would record that
 * departure as compliance with nothing. 'rest' is also what the previous
 * reader recorded there, so history stays continuous.
 *
 * A SUPPORT_ONLY day returns null. The legacy vocabulary has no word for it,
 * inventing one would widen a persisted enum other consumers read, and
 * nothing can launch from that day anyway: isBlackoutDay() blocks the
 * mechanical missions and there is no Primary to depart from.
 */
export function launchSnapshotFrom(prescription, now) {
    const p = prescription;
    if (!isPlainObject(p) || p.ok !== true) return null;
    if (!isDateKey(p.date)) return null;
    let scheduledType = null;
    if (p.dayKind === DAY_KIND.PRIMARY) {
        if (typeof p.primaryType !== 'string' || !p.primaryType) return null;
        scheduledType = p.primaryType;
    } else if (p.dayKind === DAY_KIND.REST) {
        scheduledType = LEGACY_REST;
    } else {
        return null;
    }
    return Object.freeze({
        source: p.source,
        prescriptionDate: p.date,
        scheduledType,
        capturedAt: validDate(now) ? now.toISOString() : null,
    });
}

/**
 * Read a stored launch snapshot back, or refuse it.
 *
 * ABSENT and MALFORMED are deliberately different answers.
 *
 *   no `prescription` key at all   a draft written before this field existed
 *   `prescription: null`           ABSENT too, because null is what THIS code
 *                                  writes when a session had no Primary
 *                                  identity to record. Calling our own
 *                                  correct write malformed would make the app
 *                                  raise an integrity failure against itself.
 *   `{}`, a partial object, a
 *   wrong-type value, a bad enum,
 *   a bad date key                 MALFORMED. Quarantined, never demoted to
 *                                  absent, because demoting it would let a
 *                                  typo or a bad write regain completion-date
 *                                  fallback by accident, which is the one way
 *                                  the conservative attribution rule could be
 *                                  routed around.
 *
 * A refusal is not an error. The caller finishes the session, records the
 * performed work, and records that the prescription identity is unknown.
 */
export function normaliseLaunchSnapshot(raw, opts) {
    if (raw === undefined || raw === null) {
        return { ok: false, reason: SNAPSHOT_REFUSAL.ABSENT };
    }
    const bad = { ok: false, reason: SNAPSHOT_REFUSAL.MALFORMED };
    if (!isPlainObject(raw)) return bad;
    if (raw.source !== PRESCRIPTION_SOURCE.DATED_PLAN && raw.source !== PRESCRIPTION_SOURCE.LEGACY) return bad;
    if (!isDateKey(raw.prescriptionDate)) return bad;
    const types = (opts && Array.isArray(opts.primaryTypes)) ? opts.primaryTypes : LEGACY_PRIMARY_TYPES;
    if (typeof raw.scheduledType !== 'string'
        || !(types.includes(raw.scheduledType) || raw.scheduledType === LEGACY_REST)) return bad;
    return {
        ok: true,
        value: Object.freeze({
            source: raw.source,
            prescriptionDate: raw.prescriptionDate,
            scheduledType: raw.scheduledType,
            capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : null,
        }),
    };
}
