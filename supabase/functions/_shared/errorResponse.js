/**
 * What a caller is told, and what the log is told.
 *
 * These are two different audiences and they were briefly conflated. A
 * previous version returned the Postgres code, message, details, hint and
 * relation in the HTTP response, on the grounds that the caller holds
 * CRON_SECRET. The detail was what made the failure diagnosable, but a
 * response body is the wrong place for it: it describes the schema to whoever
 * is on the other end of the connection, and "they are authenticated" is a
 * weaker guarantee than "we never said it".
 *
 * So the detail goes to the log and the caller gets a label.
 *
 * The split is enforced by shape rather than by discipline. safeErrorBody has
 * no parameter through which a message could arrive, so a call site cannot
 * leak one through it even by accident. The other two exist only to be handed
 * to console.error.
 *
 * No imports, so vitest executes these directly. Same reasoning as
 * _shared/cronAuth.js and _shared/serviceKey.js.
 */

/**
 * The response body. A stable machine-readable label, plus whatever counters
 * the caller is entitled to, and nothing else.
 *
 * Counters are copied by name rather than spread wholesale, so widening the
 * object later cannot quietly widen what is returned.
 */
export function safeErrorBody(code, counters) {
    const body = { error: String(code) };
    if (counters) {
        for (const name of ['checked', 'sent', 'dropped', 'rejected']) {
            if (typeof counters[name] === 'number') body[name] = counters[name];
        }
    }
    return body;
}

/**
 * Database failure, for the log only.
 *
 * The Postgres code is the fastest way to tell these apart:
 *   42P01  the table does not exist
 *   42703  a column does not exist
 *   42501  the credential lacks privilege, so it is not a secret key
 *   PGRST* PostgREST could not build or run the request
 *
 * None of this is a secret. It is schema and status, and it belongs in a log
 * where the owner can read it and a caller cannot.
 */
export function dbErrorDetail(error, relation) {
    const e = error || {};
    return {
        relation: relation || null,
        code: e.code || null,
        message: e.message || null,
        details: e.details || null,
        hint: e.hint || null,
    };
}

/**
 * Push failure, for the log only.
 *
 * Deliberately three fields rather than the error object. A WebPushError
 * carries `endpoint` and the push service's response `body`, and an endpoint
 * identifies a member's device: it is exactly the kind of thing that should
 * not accumulate in a log. statusCode is what actually matters here, since it
 * decides whether the subscription is dead.
 */
export function pushErrorDetail(err) {
    const e = err || {};
    return {
        name: e.name || null,
        statusCode: typeof e.statusCode === 'number' ? e.statusCode : null,
        message: e.message || null,
    };
}
