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

/** The credentials the cross-account suite needs. Only a human can provision them. */
export const REQUIRED_ENV = [
    'BP_TEST_A_EMAIL', 'BP_TEST_A_PASSWORD',
    'BP_TEST_B_EMAIL', 'BP_TEST_B_PASSWORD',
];

/**
 * The claim suite additionally needs the service key, because it has to
 * create throwaway auth accounts and seed entitlement rows, and both of
 * those are service-role operations by design.
 */
export const REQUIRED_ADMIN_ENV = ['SUPABASE_SERVICE_ROLE_KEY'];

export const missingEnv = (keys = REQUIRED_ENV) => keys.filter(k => !process.env[k]);

/**
 * Every throwaway account and every seeded entitlement row this suite
 * creates carries this in its address.
 *
 * public.members holds real purchase records. The guard is asserted before
 * every insert and before every delete, so a row that was not created by
 * this suite cannot be removed by it even if an edit aimed a cleanup step at
 * one. A purchase record is not recoverable from a test run.
 */
export const PROBE_EMAIL = 'bp-claim-probe-';

export const probeEmail = () =>
    `${PROBE_EMAIL}${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export const isProbeEmail = (e) =>
    typeof e === 'string' && e.toLowerCase().trim().startsWith(PROBE_EMAIL);

const serviceKey = () => {
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return k;
};

/** A call made with the service role, which bypasses RLS entirely. */
export async function admin(sub, { method = 'GET', body, prefer, rest: isRest = false } = {}) {
    const key = serviceKey();
    const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(`${SUPABASE_URL}/${isRest ? 'rest' : 'auth'}/v1/${sub}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    /* The key is never echoed into the result, so a failing assertion can be
       pasted into a report without leaking it. */
    return { status: r.status, ok: r.ok, body: parsed };
}

export const adminRest = (sub, opts = {}) => admin(sub, { ...opts, rest: true });

/** Create a throwaway auth account. Refuses an address outside the probe space. */
export async function createUser(email, password, { confirmed = true } = {}) {
    if (!isProbeEmail(email)) {
        throw new Error(`refusing to create an account outside the probe space: ${email}`);
    }
    const r = await admin('admin/users', {
        method: 'POST',
        body: { email, password, email_confirm: confirmed },
    });
    if (!r.ok) throw new Error(`createUser failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    return { uid: r.body.id, email, password };
}

export async function setUserEmail(uid, email, { confirmed = true } = {}) {
    if (!isProbeEmail(email)) {
        throw new Error(`refusing to move an account outside the probe space: ${email}`);
    }
    return admin(`admin/users/${uid}`, {
        method: 'PUT', body: { email, email_confirm: confirmed },
    });
}

export const deleteUser = (uid) => admin(`admin/users/${uid}`, { method: 'DELETE' });

/** Seed an entitlement row. Refuses any address this suite did not mint. */
export async function seedMember(email, extra = {}) {
    if (!isProbeEmail(email)) {
        throw new Error(`refusing to write a members row for ${email}`);
    }
    const r = await adminRest('members', {
        method: 'POST',
        prefer: 'return=representation',
        body: { email, ...extra },
    });
    if (!r.ok) {
        throw new Error(
            `seedMember failed: HTTP ${r.status} ${JSON.stringify(r.body)}. `
            + 'If a NOT NULL column has no default, add it to the extra argument '
            + 'in tests/live/claimMembership.test.js.');
    }
    return Array.isArray(r.body) ? r.body[0] : r.body;
}

/** Read entitlement rows for one probe address. */
export async function readMembers(email) {
    if (!isProbeEmail(email)) throw new Error(`refusing to query members for ${email}`);
    const r = await adminRest(`members?email=eq.${encodeURIComponent(email)}&select=*`);
    return Array.isArray(r.body) ? r.body : [];
}

/** Remove entitlement rows for one probe address, and nothing else, ever. */
export async function deleteMembers(email) {
    if (!isProbeEmail(email)) {
        throw new Error(`REFUSING to delete members rows for ${email}`);
    }
    return adminRest(`members?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
}

/** How many entitlement rows exist in total. Used as a before-and-after guard. */
export async function countMembers() {
    const r = await adminRest('members?select=email', { prefer: 'count=exact' });
    return Array.isArray(r.body) ? r.body.length : -1;
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
