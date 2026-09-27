/**
 * Who is allowed to make the notification sender run.
 *
 * There are two independent gates on this endpoint and they are deliberately
 * kept apart:
 *
 *   1. Supabase's gateway checks `Authorization` for a valid project JWT.
 *      That is the platform's check, it runs before this function is invoked,
 *      and nothing in this repo implements it. `verify_jwt` stays on.
 *
 *   2. This module checks `x-cron-secret`. That is ours, and it is what
 *      actually authenticates the caller as our scheduled job.
 *
 * The split exists because they used to share the `Authorization` header.
 * CRON_SECRET is a random string rather than a JWT, so the gateway rejected it
 * with 401 and the function was never reached. One header, two consumers, and
 * the platform wins.
 *
 * The credential in `Authorization` is not what protects this endpoint. It only
 * satisfies the gateway, and the anon key is enough for that. `x-cron-secret`
 * is the secret that matters.
 *
 * Lives in _shared and takes no imports so vitest can execute it directly.
 * The rest of the sender can only be checked by reading its source, which is
 * tolerable for plumbing and not for an authentication decision.
 */

export const CRON_SECRET_HEADER = 'x-cron-secret';

/**
 * Compared in constant time so response latency cannot be used to recover the
 * secret one character at a time. Same shape as the Ko-fi webhook's check.
 */
export function secretsMatch(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length || a.length === 0) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Decide whether a request may run the sender.
 *
 * Returns one of:
 *   { ok: true }
 *   { ok: false, status: 401, why }   the caller did not present our secret
 *   { ok: false, status: 503, why }   we are not configured to check
 *
 * The 401/503 split is the same rule the Coach Tee endpoint follows: a deploy
 * fault must never be reported as a caller fault. An unset CRON_SECRET is not
 * the caller's problem and saying "unauthorized" would send whoever is
 * debugging it looking in exactly the wrong place.
 *
 * Neither secret is ever returned or logged, including in `why`.
 */
export function authoriseCron(request, env) {
    const expected = env && env.CRON_SECRET;
    if (typeof expected !== 'string' || expected === '') {
        return { ok: false, status: 503, why: 'cron-secret-not-configured' };
    }

    const provided = request && request.headers ? request.headers.get(CRON_SECRET_HEADER) : null;
    if (provided === null || provided === undefined || provided === '') {
        return { ok: false, status: 401, why: 'missing-cron-secret-header' };
    }
    if (!secretsMatch(provided, expected)) {
        return { ok: false, status: 401, why: 'cron-secret-mismatch' };
    }
    return { ok: true };
}
