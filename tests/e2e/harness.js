/**
 * Shared setup for the end-to-end suites.
 *
 * The app is a single ~5,000 line index.html with no build step, so these tests
 * drive the real page in a real browser rather than importing modules. Every
 * suite needs the same four things, which is what this file provides:
 *
 *   1. a static server for the repo, on an ephemeral port
 *   2. a Chromium page at phone size
 *   3. the external CDNs blocked and a Supabase stub in their place
 *   4. a way to reach the HQ without going through the real auth flow
 *
 * See README.md in this directory for the constraints worth knowing before
 * writing new assertions.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const SHIM_CSS = path.join(HERE, 'tw-shim.css');

/** Phone viewport. The app is a mobile PWA; desktop is not the target. */
export const VIEWPORT = { width: 390, height: 844 };

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/**
 * Serve the repo on a random free port. Ephemeral rather than fixed so parallel
 * or repeated runs cannot collide, and so nobody has to remember to start a
 * server by hand before running the tests.
 */
export async function startServer() {
    const server = createServer(async (req, res) => {
        try {
            const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
            const file = path.join(REPO_ROOT, rel);
            // Never serve outside the repo.
            if (!file.startsWith(REPO_ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
            const body = await readFile(file);
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(body);
        } catch { res.writeHead(500); res.end('error'); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    return { server, origin: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) };
}

/**
 * Playwright's bundled Chromium is not always where it expects. Allow an
 * override so the same suites run in a sandbox with a preinstalled browser and
 * on a normal machine with no configuration.
 */
function launchOptions() {
    const explicit = process.env.PW_CHROMIUM_PATH;
    if (explicit && existsSync(explicit)) return { executablePath: explicit };
    for (const candidate of [
        '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        '/opt/pw-browsers/chromium/chrome-linux/chrome',
    ]) if (existsSync(candidate)) return { executablePath: candidate };
    return {}; // fall back to Playwright's own download
}

/**
 * Supabase stub. Three shapes cover everything the suites need:
 *   row      — the user_data row a read should return (null = no row)
 *   hangRead — never resolve the read, to exercise the 8s timeout path
 *   rejectColumns — reject any upsert containing these columns, to simulate a
 *                   table that has not had its ALTER TABLE run yet
 * Every upsert is recorded on window.__writes so tests can assert what would
 * have reached the database.
 */
function installSupabaseStub(cfg) {
    window.__writes = [];
    window.__row = cfg.row;
    window.__files = cfg.files;
    const noRow = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    const readResult = () => (window.__row ? { data: window.__row, error: null } : noRow);
    const makeQuery = () => {
        const q = {};
        ['select', 'eq', 'order', 'limit', 'insert', 'delete', 'update'].forEach(m => { q[m] = () => q; });
        q.single = () => (cfg.hangRead ? new Promise(() => {}) : Promise.resolve(readResult()));
        q.then = (res) => (cfg.hangRead ? new Promise(() => {}) : Promise.resolve(readResult()).then(res));
        q.upsert = (payload) => {
            const bad = cfg.rejectColumns.find(c => c in payload);
            if (bad) return Promise.resolve({ error: { code: 'PGRST204', message: `Could not find the '${bad}' column of 'user_data' in the schema cache` } });
            window.__writes.push(payload);
            return Promise.resolve({ error: null });
        };
        return q;
    };
    window.supabase = {
        createClient: () => ({
            from: makeQuery,
            auth: {
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
                getSession: () => Promise.resolve({ data: { session: null } }),
                signOut: () => Promise.resolve({}),
                signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
                signUp: () => Promise.resolve({ data: {}, error: null }),
            },
            storage: {
                from: () => ({
                    list: () => Promise.resolve({ data: window.__files, error: null }),
                    createSignedUrls: (paths) => Promise.resolve({ data: paths.map(() => ({ signedUrl: cfg.pngDataUri })) }),
                    upload: () => Promise.resolve({ data: { path: 'x' }, error: null }),
                    remove: () => Promise.resolve({ error: null }),
                }),
            },
        }),
    };
}

/** 1x1 transparent PNG, so photo suites never need a network fetch. */
export const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Open the app with everything stubbed. Returns the page plus an `errors`
 * array that accumulates page errors, so a suite can assert a clean run.
 */
export async function openApp(opts = {}) {
    const { row = null, hangRead = false, rejectColumns = [], files = [], acceptDialogs = true } = opts;
    const srv = await startServer();
    const browser = await chromium.launch(launchOptions());
    const page = await browser.newPage({ viewport: VIEWPORT });

    const errors = [];
    page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
    if (acceptDialogs) page.on('dialog', d => d.accept());

    for (const pattern of ['**://unpkg.com/**', '**://cdn.tailwindcss.com/**', '**://cdnjs.cloudflare.com/**']) {
        await page.route(pattern, r => r.abort());
    }
    await page.addInitScript(installSupabaseStub, { row, hangRead, rejectColumns, files, pngDataUri: PNG_1PX });

    await page.goto(`${srv.origin}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ path: SHIM_CSS });
    await page.waitForTimeout(900); // let the inline script finish wiring

    const close = async () => { await browser.close(); await srv.close(); };
    return { page, errors, browser, server: srv, close };
}

/**
 * Reach the HQ without the real auth path.
 *
 * Note the bare `currentUser = ...` assignment rather than `window.currentUser`:
 * the app declares it with `let` at script top level, which creates a binding in
 * the global lexical environment and is NOT the same as a window property.
 * Assigning to window would leave the app's own `currentUser` null.
 */
export async function signIn(page, { id = 'testuser', email = 'test@example.com', persisted = {}, loaded = true } = {}) {
    await page.evaluate(({ id, email, patch, loaded }) => {
        // Bare assignment on purpose: these are top-level `let` bindings in the
        // app's script, which live in the global lexical environment and are not
        // window properties. `window.currentUser = ...` would not be seen.
        currentUser = { id, email };
        if (loaded) _persistedLoaded = true;
        if (patch) Object.assign(persisted, patch);
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('auth-screen').classList.add('hidden');
    }, { id, email, patch: persisted, loaded });
}

/** Which `.step-content` is currently visible, by id. */
export async function visibleStep(page) {
    return page.evaluate(() => {
        const el = [...document.querySelectorAll('.step-content')].find(e => !e.classList.contains('hidden-step'));
        return el ? el.id : 'none';
    });
}

/**
 * Build a session-log entry `daysAgo` in the past.
 *
 * Deliberately NOT called `session`: inside page.evaluate the bundler rewrites
 * any identifier that matches an import, so a helper named `session` would
 * shadow the app's own global `session` object and blow up at runtime.
 */
export function sessionEntry(daysAgo, { type = 'length', eq = 7, rpe = 5, xp = 15 } = {}) {
    return { date: new Date(Date.now() - daysAgo * 864e5).toISOString(), routineType: type, eq, rpe, xpEarned: xp, note: '' };
}
