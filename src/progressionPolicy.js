/**
 * Every tunable number in the progression system, in one place.
 *
 * These are PRODUCT POLICY DEFAULTS. Not one of them is a medical constant,
 * a physiological threshold, or a finding from any literature. They are
 * starting values chosen to be conservative and explainable, and they are
 * expected to be tuned once there is real adherence data to tune them
 * against.
 *
 * Nothing downstream may hard-code any of these. A number that appears in a
 * rule and not here is a bug, and tests assert that.
 *
 * Why one object rather than named exports: a single frozen object can be
 * shallow-overridden in a test or a future remote-config read without
 * touching a call site, and it makes "what are all the knobs" answerable by
 * reading twenty lines.
 */
export const PROGRESSION_POLICY = Object.freeze({
    /* ── Adherence gate ───────────────────────────────────────────────────
       How much work earns the right to be offered more work. */

    /** Qualifying weeks needed before advancement is offered. */
    qualifyingWeeksRequired: 4,

    /** The rolling window those weeks are counted over. Not consecutive. */
    qualifyingWindowWeeks: 8,

    /**
     * A qualifying week: miss at most this many scheduled mechanical
     * sessions. One, so "miss at most one" is the whole rule.
     *
     * Deliberately an absolute allowance rather than a percentage. At the
     * real schedule sizes a percentage misbehaves: 75% of a 3-session week
     * rounds to 3, which demands perfection, while 75% of a 4-session week
     * asks for 3. The same sentence should not mean two different standards.
     */
    qualifyingWeekMaxMissed: 1,

    /** And complete at least this many, whatever the target was. */
    qualifyingWeekMinSessions: 2,

    /* ── Tolerance hold ───────────────────────────────────────────────────
       Signals that say "hold at this workload" rather than "go up". */

    /** How many recent qualifying sessions the RPE hold looks at. */
    rpeWindowSessions: 5,

    /** Mean RPE at or above this within that window holds advancement. */
    rpeHoldThreshold: 8,

    /**
     * How many of those sessions must actually carry an RPE before any RPE
     * conclusion may be drawn.
     *
     * RPE is optional at the success screen, so absence is common and means
     * nothing. Three of five is the agreed floor: enough that one unusual
     * session cannot carry the mean on its own. Below it the answer is
     * UNKNOWN, never CLEAR, because missing data must not read as evidence
     * of tolerance. UNKNOWN is also not a hold, so a member who never fills
     * the field in is not blocked forever.
     */
    rpeMinSamples: 3,

    /* ── Safety hold ──────────────────────────────────────────────────────
       Recent recovery usage suggests holding the current workload.

       Counts COMPLETED recovery sessions, because RECOVER routing is not
       persisted anywhere. See the Gate 0 report. */

    /** The window completed recovery sessions are counted over. */
    recoverySafetyWindowDays: 14,

    /** This many completed recovery sessions in that window holds advancement. */
    recoveryCompletedHoldCount: 3,

    /* ── Deload ───────────────────────────────────────────────────────────
       Exposure-driven, not calendar-driven. */

    /** Cycle length in weeks: N-1 banked qualifying weeks, then the deload
     *  week. At 5 that is four qualifying weeks followed by one calendar
     *  week which is reduced from its first session to its last, whatever
     *  happens inside it. That week discharges the cycle as it elapses, so
     *  two deload weeks never run back to back. */
    deloadEveryQualifyingWeeks: 5,

    /**
     * Zero qualifying mechanical work for this long resets accumulated
     * deload progress.
     *
     * Not a claim that fatigue clears in this time. It exists so a member
     * who stops at four accumulated weeks and returns months later is not
     * met with a deload before they have trained.
     */
    deloadStaleResetDays: 28,

    /* ── Weekly progression ledger ────────────────────────────────────────
       How many weeks of ledger history to retain. */

    /**
     * Retained ledger weeks. The rolling window is 8; this keeps roughly six
     * months so the record is useful beyond the gate without growing without
     * bound. At about 90 bytes an entry that is a couple of kilobytes.
     *
     * Pruning cannot lose the deload count, because each entry carries the
     * running cumulative total rather than it being recomputed from the
     * surviving rows.
     */
    ledgerMaxWeeks: 26,
});

/** Shallow override, for tests and any future remote configuration. */
export function withPolicy(overrides) {
    return Object.freeze({ ...PROGRESSION_POLICY, ...(overrides || {}) });
}
