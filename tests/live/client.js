/**
 * A deliberately thin Supabase client for the live security suite.
 *
 * WHY NOT supabase-js. These tests ask what the SERVER permits. A client
 * library sits between the question and the answer: it reshapes errors,
 * applies its own defaults, and can make a denial look like an empty result
 * or the reverse. Raw fetch against the REST and Storage endpoints is the
 * same surface an attacker would use, and the status code it returns is the
 * server's own. It also keeps the dependency list at vitest and playwright.
 *
 * WHY THE PROJECT URL IS PARSED FROM app/index.html RATHER THAN CONFIGURED.
 * A security test that runs against the wrong project proves nothing and
 * reads as proof. Reading the constants out of the file that ships means the
 * suite necessarily targets the same project the deployed app talks to. The
 * anon key is public by design and already in the client source, so nothing
 * is exposed by reading it here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fromAppSource() {
    const src = readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
    const url = src.match(/const SUPABASE_URL\s*=\s*'([^']+)'/);
    const key = src.match(/const SUPABASE_ANON\s*=\s*'([^']+)'/);
    if (!url || !key) {
        throw new Error(
            'Could not read SUPABASE_URL / SUPABASE_ANON out of app/index.html. '
            + 'If those constants were renamed, update tests/live/client.js so this '
            + 'suite keeps targeting the project the app actually uses.');
    }
    return { url: url[1].replace(/\/$/, ''), anon: key[1] };
}

export const { url: SUPABASE_URL, anon: ANON_KEY } = fromAppSource();

/** The credentials this suite needs, and which only a human can provision. */
export const REQUIRED_ENV = [
    'BP_TEST_A_EMAIL', 'BP_TEST_A_PASSWORD',
    'BP_TEST_B_EMAIL', 'BP_TEST_B_PASSWORD',
];

export function missingEnv() {
    return REQUIRED_ENV.filter(k => !process.env[k]);
}

/**
 * Exchange a password for a session, exactly as the sign-in form does.
 * Returns the access token and the user id the server assigned.
 */
export async function signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.access_token) {
        throw new Error(
            `sign-in failed for ${email}: HTTP ${r.status} `
            + `${body.error_description || body.msg || body.error || 'no token returned'}. `
            + 'Confirm the account exists and its email is confirmed.');
    }
    return { token: body.access_token, uid: body.user.id, email };
}

/** A caller with no session at all: the anonymous role. */
export const ANON = { token: null, uid: null, email: '(anonymous)' };

const authHeader = (who) => `Bearer ${who && who.token ? who.token : ANON_KEY}`;

/**
 * A PostgREST call. Returns the status and the parsed body rather than
 * throwing, because the status IS the finding in most of these tests.
 */
export async function rest(who, pathAndQuery, { method = 'GET', body, prefer } = {}) {
    const headers = {
        apikey: ANON_KEY,
        Authorization: authHeader(who),
        'content-type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: r.status, ok: r.ok, body: parsed };
}

/** An RPC call, which is a POST to /rest/v1/rpc/<name>. */
export const rpc = (who, name, args) =>
    rest(who, `rpc/${name}`, { method: 'POST', body: args || {} });

/** A Storage call. `sub` is the path after /storage/v1/. */
export async function storage(who, sub, { method = 'GET', body, raw, contentType } = {}) {
    const headers = { apikey: ANON_KEY, Authorization: authHeader(who) };
    if (contentType) headers['content-type'] = contentType;
    else if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${SUPABASE_URL}/storage/v1/${sub}`, {
        method,
        headers,
        body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: r.status, ok: r.ok, body: parsed };
}

/**
 * List the objects directly under a prefix in progress-photos.
 * Returns the array the server gave, which is [] when RLS filters it all.
 */
export async function listFolder(who, prefix) {
    const r = await storage(who, 'object/list/progress-photos', {
        method: 'POST',
        body: { prefix, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } },
    });
    return { ...r, names: Array.isArray(r.body) ? r.body.map(o => o.name) : [] };
}

/**
 * Every object this suite creates carries this prefix.
 *
 * It is asserted on before any write and before any delete, so an edit that
 * repointed a destructive step at a member's own photo would fail the
 * assertion rather than run. This bucket holds member progress photographs,
 * which are not recoverable if a test removes one.
 */
export const PROBE_PREFIX = '__rls-probe-';

export const probeName = () => `${PROBE_PREFIX}${Date.now()}.jpg`;

/** A one-pixel JPEG, so an upload is a real image rather than a text blob. */
export const JPEG_1PX = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
    + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzMv/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIy'
    + 'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB'
    + 'AxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAA'
    + 'AAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
    'base64');
