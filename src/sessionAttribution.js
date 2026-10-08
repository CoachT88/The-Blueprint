/**
 * Which prescription did this completed session satisfy?
 *
 * One question, one answer, one definition. This module exists because five
 * consumers need it and the moment two of them reimplement the fallback they
 * will disagree about a day: primarySatisfied, weekCompletion, the WeekStrip,
 * the Weekly Report's canonical count, and the mutation gate that proves all
 * four agree.
 *
 * THREE SHAPES, AND THE THIRD IS THE POINT
 *
 *   prescriptionDate VALID      the launch snapshot was readable. The session
 *                               is attributed to that dated prescription and
 *                               may satisfy it.
 *
 *   prescriptionDate ABSENT     a record written before Phase 3C.4 existed.
 *                               Attributed by its completion date, which is
 *                               the relationship every reader already used.
 *                               Preserved so upgrading does not retroactively
 *                               unsatisfy a member's history or their current
 *                               week.
 *
 *   prescriptionDate NULL       a 3C.4-era completion whose launch identity
 *                               could not be proven. The performed work is
 *                               known; the prescription it satisfied is not.
 *
 * The third case is a deliberate conservative rule and not data loss. The
 * session stays in history and still counts as performed volume. What it may
 * not do is satisfy a dated Primary, because the only thing left to attribute
 * it by would be the completion date, and a Thursday session resumed after
 * midnight would then silently satisfy Friday's prescription even though
 * Friday was never launched. Accepting that a corrupted snapshot costs the
 * member that day's programme credit is the cheaper mistake:
 *
 *     We may preserve performed work without claiming which prescription it
 *     satisfied.
 *
 * That is exactly why NULL has to stay distinguishable from an absent field.
 * `undefined` would vanish through JSON into the jsonb column and the two
 * cases would become one.
 *
 * MALFORMED IS QUARANTINED, NEVER DEMOTED TO ABSENT
 *
 * A present-but-invalid prescriptionDate ('2026-2-9', '2026-02-31', 7, {})
 * is treated as UNKNOWN, not as absent. Demoting it would let a typo or a bad
 * write regain legacy completion-date fallback by accident, which is the one
 * way the conservative rule could be routed around.
 *
 * TWO DATE RELATIONSHIPS, AND THE SEAM IS RECORDED
 *
 * A dated identity is a LOCAL calendar day, because that is the day the
 * member lived through and the identity a day plan carries. The legacy
 * fallback key stays the UTC-shifted date part of the stored timestamp,
 * because that is what weekCompletion and the WeekStrip already compare
 * against and matching it is what keeps those readers self-consistent. It is
 * the carried _dayKey() debt, it is not repaired here, and the repair has to
 * move session_log, pass dates, messaging and the notification consumers
 * together.
 *
 * Pure: no DOM, no clock, no globals, no mutation of inputs, no writes.
 */

import { isDateKey } from './dayPlan.js';

/** How a completed session's prescription was identified. */
export const ATTRIBUTION = Object.freeze({
    /** A readable launch snapshot. May satisfy the dated prescription. */
    DATED:       'dated',
    /** Pre-3C.4 record. May satisfy via its completion date. */
    LEGACY_DATE: 'legacy-date',
    /** Identity unprovable. Performed work only; satisfies nothing dated. */
    UNKNOWN:     'unknown',
});

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * How one session-log entry is attributed.
 *
 * Returns { kind, key }. `key` is a 'YYYY-MM-DD' for DATED and LEGACY_DATE,
 * and null for UNKNOWN. The two keys are NOT interchangeable: a DATED key is
 * a local calendar day and a LEGACY_DATE key is the UTC date part of the
 * stored timestamp. Callers must compare each against its own relationship.
 */
export function attributeEntry(entry) {
    if (!isPlainObject(entry)) return { kind: ATTRIBUTION.UNKNOWN, key: null };

    if ('prescriptionDate' in entry) {
        const p = entry.prescriptionDate;
        if (isDateKey(p)) return { kind: ATTRIBUTION.DATED, key: p };
        /* Explicit unknown, and anything malformed, both land here. A
           malformed value is quarantined rather than demoted to absent. */
        return { kind: ATTRIBUTION.UNKNOWN, key: null };
    }

    /* Absent. A record from before this field existed. */
    if (typeof entry.date !== 'string' || !entry.date) {
        return { kind: ATTRIBUTION.UNKNOWN, key: null };
    }
    const key = entry.date.split('T')[0];
    if (!isDateKey(key)) return { kind: ATTRIBUTION.UNKNOWN, key: null };
    return { kind: ATTRIBUTION.LEGACY_DATE, key };
}

/** Can this entry ever satisfy a prescription? False for UNKNOWN. */
export function canAttribute(entry) {
    return attributeEntry(entry).kind !== ATTRIBUTION.UNKNOWN;
}

/**
 * What was performed on each attributable day, for a satisfaction lookup.
 *
 * Two maps, because the two key relationships are not interchangeable and
 * merging them is how a day gets credited twice or not at all. Each value is
 * { any, mechanical }, OR-accumulated so the answer cannot depend on the
 * order entries happen to sit in the log: a Recovery entry logged after a
 * mechanical one must not erase it, and a Recovery entry alone must not
 * satisfy anything.
 *
 * UNKNOWN entries appear in NEITHER map. They are performed work with no
 * prescription attribution, so they are invisible to satisfaction and remain
 * entirely visible to history.
 */
export function performedByAttribution(sessionLog, mechanicalTypes) {
    const mech = Array.isArray(mechanicalTypes) ? mechanicalTypes : [];
    const dated = new Map();
    const legacy = new Map();
    for (const e of (Array.isArray(sessionLog) ? sessionLog : [])) {
        const a = attributeEntry(e);
        if (a.kind === ATTRIBUTION.UNKNOWN) continue;
        const into = a.kind === ATTRIBUTION.DATED ? dated : legacy;
        const prev = into.get(a.key) || { any: false, mechanical: false };
        into.set(a.key, {
            any: true,
            mechanical: prev.mechanical || mech.includes(e.routineType),
        });
    }
    return { dated, legacy };
}
