/**
 * The member's preferred name.
 *
 * Optional forever. The whole product works without it, the majority of
 * existing members will never set one, and no-name is a permanent first
 * class state rather than a gap waiting to be filled.
 *
 * WHERE IT LIVES. Supabase auth user_metadata, nowhere else. It arrives with
 * the session, so it is readable before any data load; it crosses devices
 * because it belongs to the auth user rather than to a device; and it needs
 * no migration. It is deliberately NOT in user_data, which is written by one
 * debounced whole-row upsert and is not resolved at the moment a greeting
 * would render, and deliberately NOT in localStorage, which does not cross
 * devices and has already caused trouble elsewhere in this app.
 *
 * WHAT IT MUST NEVER BE. Never guessed from the email local part. Never
 * inferred from anything else the app knows. Never written into training
 * state, analytics, push payloads or logs. A name is more identifying than
 * anything else this app stores, and the member gave it for one purpose.
 *
 * Pure: no DOM, no globals, no network.
 */

/** Maximum length, in Unicode code points rather than UTF-16 units. */
export const PREFERRED_NAME_MAX = 40;

/**
 * Count code points, so a name made of astral characters is measured the way
 * a person would count it rather than by how JavaScript happens to store it.
 * "😀" is one here and two under .length.
 */
export function nameLength(value) {
    return [...String(value)].length;
}

/**
 * The single entry point for turning member input into something storable.
 *
 * One function rather than a normaliser plus a separate validator, because
 * two functions can be called separately and a caller that forgets the
 * second one saves an invalid value. There is no way to get a value out of
 * this without also being told whether it is acceptable.
 *
 *   trimmed, non-empty, within the limit   { ok: true,  value: '<name>' }
 *   empty, whitespace only, not a string   { ok: true,  value: null }
 *   longer than the limit                  { ok: false, reason: 'too-long' }
 *
 * Over-length is a REFUSAL, never a silent truncation. Quietly storing the
 * first forty characters of someone's name and showing it back to them is
 * worse than asking them to shorten it themselves.
 *
 * Anything that is not a string is treated as absent rather than coerced,
 * so a stray object or number from a corrupted metadata blob cannot become
 * the string "[object Object]" on someone's home screen.
 */
export function validatePreferredName(raw) {
    if (typeof raw !== 'string') return { ok: true, value: null };
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: null };
    const length = nameLength(trimmed);
    if (length > PREFERRED_NAME_MAX) {
        return { ok: false, reason: 'too-long', length, max: PREFERRED_NAME_MAX };
    }
    return { ok: true, value: trimmed };
}

/**
 * The one read path, from the auth user and only from the auth user.
 *
 * Anything stored that does not survive validation reads as no name. A value
 * that was somehow written over-length, or as the wrong type, must not
 * reappear on a screen just because it reached the database.
 */
export function readPreferredName(user) {
    const raw = user && user.user_metadata ? user.user_metadata.preferred_name : null;
    const out = validatePreferredName(raw);
    return out.ok ? out.value : null;
}

/** Does this member have a name set? Sugar, so callers read as prose. */
export function hasPreferredName(user) {
    return readPreferredName(user) !== null;
}
