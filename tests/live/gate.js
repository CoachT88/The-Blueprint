/**
 * The decision about whether a run may write to its target, as a pure
 * function, so it can be tested rather than merely read.
 *
 * It lives in its own module with no imports and no side effects because
 * the ordinary unit suite needs to call it, and importing client.js would
 * drag in reading app/index.html and resolving the project from the
 * environment, neither of which belongs in a unit run.
 *
 * A mutation run is the reason this exists. The guard on the gate used to
 * assert that the words BP_ALLOW_PRODUCTION_WRITES appeared in the suite,
 * which stayed true when the gate was changed to `const blockedByTarget =
 * false`. Text matching cannot catch that. A pure function can.
 */

/**
 * @param isProduction whether the resolved target is the production project
 * @param allowEnv     the raw value of BP_ALLOW_PRODUCTION_WRITES
 * @returns true when the run must refuse rather than write
 */
export function writesBlockedFor({ isProduction, allowEnv } = {}) {
    return Boolean(isProduction) && allowEnv !== '1';
}
