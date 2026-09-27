/**
 * Where the backend admin key comes from.
 *
 * This used to be one line:
 *
 *     Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
 *
 * On a project using the newer API key system that variable is not injected
 * into hosted edge functions, and the reserved `SUPABASE_` prefix means it
 * cannot be set by hand either. `createClient` was handed undefined, every
 * request went out unauthenticated, row level security refused the read, and
 * the function reported `read_failed`. That error points at the database,
 * which is the one place the problem was not.
 *
 * Supabase injects `SUPABASE_SECRET_KEYS` instead, a JSON map of named keys.
 * This reads that first and falls back to the legacy variable, which is still
 * the right answer locally, self-hosted, and on older projects.
 *
 * Written without access to Supabase's documentation, because outbound network
 * was blocked in the environment this was built in. The shape of
 * `SUPABASE_SECRET_KEYS` comes from the project owner's description rather than
 * a captured value, so the parsing below is deliberately tolerant and every
 * failure logs the shape it saw. Names and types, never values. If the
 * assumption is wrong, that log line is what will say so.
 *
 * No imports, so vitest executes this directly rather than reading the calling
 * function's source. Same reasoning as _shared/cronAuth.js.
 */

/** Which entry of the map to use when nothing says otherwise. */
export const DEFAULT_KEY_NAME = 'default';

/**
 * Describe a value without revealing it. Used only in logs, and only on the
 * paths where something has already gone wrong.
 */
function shapeOf(raw) {
    if (raw === undefined) return 'absent';
    if (typeof raw !== 'string') return `not a string (${typeof raw})`;
    if (raw === '') return 'empty string';
    const trimmed = raw.trim();
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return (trimmed.startsWith('{') || trimmed.startsWith('['))
            ? `${raw.length} characters, starts like JSON but is not JSON`
            : `${raw.length} characters, not JSON and not key-shaped`;
    }
    if (parsed === null) return 'JSON null';
    if (Array.isArray(parsed)) return `JSON array of ${parsed.length}`;
    if (typeof parsed !== 'object') return `JSON ${typeof parsed}`;
    const names = Object.keys(parsed);
    return names.length
        ? `JSON object with keys: ${names.join(', ')}`
        : 'JSON object with no keys';
}

/**
 * Pull a usable key out of the parsed `SUPABASE_SECRET_KEYS` value.
 * Returns the key string, or null.
 */
function fromSecretKeys(raw, name, notes) {
    if (typeof raw !== 'string' || raw === '') return null;

    const trimmed = raw.trim();
    /* Something starting with { or [ was meant to be JSON. If it will not
       parse, that is a broken value, not a key: using it would send the
       literal text as a credential and turn a configuration error into a
       confusing auth failure one layer further away. A string that never
       looked like JSON is a bare key, which is unambiguous and fine. */
    const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');

    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return looksLikeJson ? null : (trimmed || null);
    }

    if (typeof parsed === 'string') return parsed.trim() || null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const wanted = parsed[name];
    if (typeof wanted === 'string' && wanted.trim()) return wanted.trim();

    /* The requested name is not there. If the map holds exactly one key there
       is no ambiguity about which was meant, so take it and say so: a project
       whose key is named something else should work, not fail silently. */
    const usable = Object.entries(parsed)
        .filter(([, v]) => typeof v === 'string' && v.trim());
    if (usable.length === 1) {
        notes.push(`SUPABASE_SECRET_KEYS has no "${name}", using its only key "${usable[0][0]}"`);
        return usable[0][1].trim();
    }
    return null;
}

/**
 * Resolve the key this function should talk to Supabase with.
 *
 * Returns `{ key, source, notes }` when one was found, or
 * `{ key: null, why, notes }` when none was. `why` and `notes` are safe to
 * log; neither ever contains a key.
 *
 * Modern source first, as the platform's own direction of travel.
 */
export function resolveServiceKey(env, { name } = {}) {
    const e = env || {};
    const notes = [];
    const wanted = name || e.SUPABASE_SECRET_KEY_NAME || DEFAULT_KEY_NAME;

    const modern = fromSecretKeys(e.SUPABASE_SECRET_KEYS, wanted, notes);
    if (modern) return { key: modern, source: 'SUPABASE_SECRET_KEYS', notes };

    const legacy = e.SUPABASE_SERVICE_ROLE_KEY;
    if (typeof legacy === 'string' && legacy.trim()) {
        return { key: legacy.trim(), source: 'SUPABASE_SERVICE_ROLE_KEY', notes };
    }

    /* Nothing usable. Say what was actually in the environment, in shape only,
       because the next person debugging this needs to know whether the
       variable was absent, empty, or present in a form this did not expect. */
    notes.push(`SUPABASE_SECRET_KEYS: ${shapeOf(e.SUPABASE_SECRET_KEYS)}`);
    notes.push(`SUPABASE_SERVICE_ROLE_KEY: ${shapeOf(legacy)}`);
    notes.push(`looked for the key named "${wanted}"`);
    return { key: null, why: 'service-key-not-configured', notes };
}
