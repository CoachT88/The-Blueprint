/**
 * Shared setup for the end-to-end suites.
 *
 * The app is a single ~5,000 line app/index.html with no build step (the sales
 * page took the site root), so these tests
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
 *
 * ── TEST POLICY, locked in Phase 2B.1 ──────────────────────────────────────
 *
 * Critical integration and browser tests must exercise the REAL production
 * orchestration path. Do not recreate business logic inside a test helper
 * when the production function can be called.
 *
 *   GOOD   invoke finishSession(), then assert the resulting state
 *   BAD    push a fake sessionLog entry, call a progression helper by hand,
 *          and claim the completion flow was tested
 *
 * Pure unit tests may call the pure modules in src/ directly. Integration
 * tests have to verify the actual wiring.
 *
 * This is not a style preference. An earlier version of the Phase 2B.1
 * helper reimplemented the programme-start and reconcile calls itself, and
 * every mutation of the real call sites in app/index.html then passed,
 * because nothing in the suite ever reached them. Seeding STATE is fine and
 * often unavoidable in a browser suite that cannot move the clock. Seeding
 * the ANSWER is not.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
/* Phase 3B: the real, committed stylesheet. Until now this was a 59-line
   hand-written approximation, because the CDNs are blocked in CI and the app
   had no CSS of its own. Now app/vendor/tw.css ships with the app, so the
   suites render what production renders and geometry assertions mean
   something. tw-shim.css is gone. */

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
 * Every ACCEPTED upsert is recorded on window.__writes so tests can assert
 * what would have reached the database, and every ATTEMPT is recorded on
 * window.__attempts, accepted or not. The two differ only when a fallback is
 * running, and the number of attempts is the only way to see which tier of
 * the schema fallback answered: a rejected payload never reaches __writes.
 *
 * Phase 2B.3.5 added a real session lifecycle on top, because until then
 * signOut() was a no-op, getSession() was hardcoded to null and the
 * onAuthStateChange subscription was never fired. The consequence was that
 * handleLogout(), the SIGNED_OUT branch and onUserSignedIn() had never been
 * executed by a test, and every "account switch" in the suite was a
 * reassignment of currentUser with persisted hand-seeded beside it. Those
 * remain useful as targeted isolation tests; they just do not prove the
 * lifecycle. See authSignIn() / authSignOut().
 */
function installSupabaseStub(cfg) {
    window.__writes = [];
    window.__attempts = [];
    window.__row = cfg.row;
    window.__files = cfg.files;
    /* Phase 2B.3.5. The session lifecycle, so the real auth path can run.
       All three default to empty, which reproduces the old behaviour exactly:
       no session, a subscription nobody fires, and a members table nobody
       asks about. A suite opts in by calling authSignIn(). */
    window.__session = null;          // what getSession() returns
    window.__authSubs = [];           // onAuthStateChange callbacks
    window.__members = [];            // emails the members table knows
    window.__rowsByUser = {};         // per-account user_data, keyed by id
    window.__authEvents = [];         // every event fired, for assertions

    const noRow = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    /* A per-account row wins when one is registered, so two accounts in one
       browser can hold genuinely different data. Otherwise the single __row
       every existing suite uses. */
    const readResult = () => {
        const uid = window.__session && window.__session.user && window.__session.user.id;
        const scoped = uid && Object.prototype.hasOwnProperty.call(window.__rowsByUser, uid)
            ? window.__rowsByUser[uid] : undefined;
        const row = scoped !== undefined ? scoped : window.__row;
        return row ? { data: row, error: null } : noRow;
    };
    /* The members lookup is a different question from the user_data read, and
       answering it with __row would sign every test member straight back out:
       checkMembership() treats PGRST116 as "not a member". */
    const membersResult = (email) => {
        const hit = (window.__members || []).some(m => String(m).toLowerCase() === String(email).toLowerCase());
        return hit ? { data: { email }, error: null } : noRow;
    };
    const makeQuery = (table) => {
        const q = {};
        let askedEmail = null;
        ['select', 'order', 'limit', 'insert', 'delete', 'update'].forEach(m => { q[m] = () => q; });
        q.eq = (col, val) => { if (col === 'email') askedEmail = val; return q; };
        const result = () => (table === 'members' ? membersResult(askedEmail) : readResult());
        q.single = () => (cfg.hangRead && table !== 'members' ? new Promise(() => {}) : Promise.resolve(result()));
        q.then = (res) => (cfg.hangRead && table !== 'members' ? new Promise(() => {}) : Promise.resolve(result()).then(res));
        q.upsert = (payload) => {
            window.__attempts.push(payload);
            const bad = cfg.rejectColumns.find(c => c in payload);
            if (bad) return Promise.resolve({ error: { code: 'PGRST204', message: `Could not find the '${bad}' column of 'user_data' in the schema cache` } });
            /* A runtime failure switch, settable mid-test, for proving that a
               save failure retries the SAME row rather than appending a
               second completion. Simulates the network, not an answer. */
            if (window.__failUpsert) {
                return Promise.resolve({ error: { code: '503', message: 'simulated upload failure' } });
            }
            /* NEVER SETTLES, for the write deadline. Distinct from __failUpsert
               because a hang is not a failure: the server may have committed
               and only the response is lost, which is exactly the case the
               deadline has to treat as unknown rather than failed.
               __hangUpsertCommits records the payload anyway, modelling a
               remote success whose answer never came back. */
            if (window.__hangUpsert) {
                if (window.__hangUpsertCommits) window.__writes.push(payload);
                return new Promise(() => {});
            }
            /* Throws rather than resolving with an error, for the path where
               the client library itself blows up. */
            if (window.__throwUpsert) {
                return Promise.reject(new Error('simulated client throw'));
            }
            window.__writes.push(payload);
            return Promise.resolve({ error: null });
        };
        return q;
    };
    /* Fire the way Supabase does: every registered listener, in order. The
       app registers exactly one (app/index.html onAuthStateChange). */
    window.__fireAuth = (event, session) => {
        window.__authEvents.push(event);
        window.__session = session;
        (window.__authSubs || []).forEach(cb => { try { cb(event, session); } catch (e) {} });
    };
    window.supabase = {
        createClient: () => ({
            from: makeQuery,
            auth: {
                onAuthStateChange: (cb) => {
                    window.__authSubs.push(cb);
                    return { data: { subscription: { unsubscribe() {
                        window.__authSubs = window.__authSubs.filter(x => x !== cb);
                    } } } };
                },
                getSession: () => Promise.resolve({ data: { session: window.__session } }),
                /* A real sign-out drops the session and tells the app. Without
                   this the SIGNED_OUT branch had never once executed.
                   The event is deferred to a macrotask on purpose: the real
                   one arrives after a network round trip, so handleLogout()'s
                   own cleanup and the SIGNED_OUT branch's cleanup are
                   separated in time. Firing it synchronously made each one
                   cover for the other, and a mutation removing either went
                   unnoticed. */
                signOut: () => {
                    window.__authUser = null;
                    setTimeout(() => window.__fireAuth('SIGNED_OUT', null), 0);
                    return Promise.resolve({});
                },
                signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
                /* Never stubbed until the hardening pass, which means the
                   one-time 401 refresh-and-retry in fetchClaude had never
                   once been executed by a test: refreshSession was undefined,
                   so the call threw and the retry was skipped silently.
                   __refreshFails makes the refresh itself fail, and
                   __hangRefresh makes it hang, for the two paths where the
                   member must still get their controls back. */
                refreshSession: () => {
                    window.__refreshCalls = (window.__refreshCalls || 0) + 1;
                    if (window.__hangRefresh) return new Promise(() => {});
                    if (window.__refreshFails) return Promise.resolve({ data: { session: null }, error: { message: 'refresh failed' } });
                    const u = window.__authUser || { id: 'stub', email: 'stub@example.com' };
                    const session = { user: u, access_token: 'refreshed-token' };
                    window.__session = session;
                    return Promise.resolve({ data: { session }, error: null });
                },
                signUp: () => Promise.resolve({ data: {}, error: null }),
                /* Phase 2B.3.1. Preferred name lives in auth user_metadata,
                   so the stub has to model it. window.__authUser is the
                   stand-in for the session user; window.__updateUserFails
                   lets a suite make the write fail the way the network can. */
                updateUser: ({ data }) => {
                    if (window.__updateUserFails) {
                        return Promise.resolve({ data: null, error: { message: 'stubbed failure' } });
                    }
                    window.__authUser = window.__authUser || { id: 'stub', email: 'stub@example.com', user_metadata: {} };
                    window.__authUser.user_metadata = { ...(window.__authUser.user_metadata || {}), ...data };
                    window.__updateUserCalls = (window.__updateUserCalls || 0) + 1;
                    return Promise.resolve({ data: { user: JSON.parse(JSON.stringify(window.__authUser)) }, error: null });
                },
            },
            /* Storage, with the same three injection shapes as the table
               stub. __uploads records every attempted path, which is how a
               test proves a retry reused the SAME path instead of minting a
               second object. __storageExisting holds paths the bucket is
               pretending to already have, so upsert:false can answer with a
               real conflict. */
            storage: {
                from: () => ({
                    list: () => (window.__hangStorage
                        ? new Promise(() => {})
                        : Promise.resolve({ data: window.__files, error: null })),
                    createSignedUrls: (paths) => (window.__hangSignedUrls
                        ? new Promise(() => {})
                        : Promise.resolve({ data: paths.map(() => ({ signedUrl: cfg.pngDataUri })) })),
                    upload: (path) => {
                        window.__uploads = window.__uploads || [];
                        window.__uploads.push(path);
                        if (window.__hangUpload) {
                            if (window.__hangUploadCommits) {
                                window.__storageExisting = window.__storageExisting || [];
                                window.__storageExisting.push(path);
                            }
                            return new Promise(() => {});
                        }
                        if ((window.__storageExisting || []).includes(path)) {
                            return Promise.resolve({ data: null, error:
                                { statusCode: '409', message: 'The resource already exists' } });
                        }
                        if (window.__failUpload) {
                            return Promise.resolve({ data: null, error: { message: 'simulated storage failure' } });
                        }
                        window.__storageExisting = window.__storageExisting || [];
                        window.__storageExisting.push(path);
                        return Promise.resolve({ data: { path }, error: null });
                    },
                    remove: () => (window.__hangRemove
                        ? new Promise(() => {})
                        : Promise.resolve({ error: null })),
                }),
            },
        }),
    };
}

/**
 * A member whose seven-slot column is still their programme.
 *
 * THE DISTINCTION THAT MATTERS, and the one this helper exists to stop
 * anybody getting wrong again:
 *
 *   programme = null      UNCLASSIFIED. production will classify this
 *                         account on the next syncProgression and, if its
 *                         week is attributable, CUT IT OVER. Use this only
 *                         when the test is exercising classification itself.
 *
 *   legacyProgramme()     CLASSIFIED CUSTOM. mayGenerateOver() refuses,
 *                         nothing is generated, and the legacy schedule
 *                         remains authoritative. Use this whenever a test
 *                         seeds persisted.schedule and expects it to survive
 *                         a render.
 *
 * Eleven fixtures used `null` meaning the second thing. It worked only
 * because syncProgression used to run after the render surfaces, so a seeded
 * column rendered before being replaced. Once the authority transition moved
 * to the top of renderDashboard, which is where it belongs, those fixtures
 * started measuring a cut-over member instead.
 */
export const legacyProgramme = () => ({
    key: null,
    version: 1,
    adoptedAt: null,
    custom: true,
    cyclePosition: null,
    migration: {
        source: 'custom', presetKey: null,
        reason: 'no_recognised_shape', classifiedAt: '2026-01-01',
    },
});

/**
 * A reader for the WeekStrip, injected so suites can ask what rendered.
 *
 * A READER, not a fixture. It reports what the production renderer actually
 * put in the DOM and computes nothing about the week: no state is derived
 * here, no prescription is looked up, no completion is decided. Every field
 * is a value read straight off a cell. Seeding state is fine and seeding the
 * answer is not, and this seeds neither.
 *
 * It exists because the alternative is nine files each re-deriving "which
 * cell is Wednesday" from a Monday-first list, which is exactly the kind of
 * index arithmetic that already produced one wrong assertion in this phase.
 * `bySunday` is keyed by Date#getDay(), because every other week structure in
 * the app is, so a test can say "Wednesday" without counting cells.
 */
function installWeekStripReader() {
    window.__weekStrip = () => {
        const strip = document.getElementById('hq-week-strip');
        const label = document.getElementById('hq-week-label');
        const card = document.getElementById('hq-week-card');
        const cells = strip ? [...strip.children] : [];
        const read = (c) => ({
            weekday: Number(c.dataset.weekday),
            name: (c.querySelector('span') || {}).textContent || '',
            state: c.dataset.state,
            date: c.dataset.date,
            today: c.dataset.today === '1',
            past: c.dataset.past === '1',
            substituted: c.dataset.substituted === '1',
            title: c.title || '',
            aria: c.getAttribute('aria-label'),
            role: c.getAttribute('role'),
            tabbable: c.tabIndex === 0,
            cls: c.className,
            icon: ((c.querySelector('i') || {}).className || ''),
        });
        const days = cells.map(read);
        return {
            exists: !!strip,
            authority: strip ? strip.dataset.authority : null,
            label: label ? label.textContent : null,
            complete: !!(card && card.classList.contains('week-complete')),
            order: days.map(d => d.name),
            days,
            satisfied: days.filter(d => d.state === 'satisfied').length,
            bySunday: Object.fromEntries(days.map(d => [d.weekday, d.state])),
        };
    };
}

/** 1x1 transparent PNG, so photo suites never need a network fetch. */
export const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Open the app with everything stubbed. Returns the page plus an `errors`
 * array that accumulates page errors, so a suite can assert a clean run.
 */
export async function openApp(opts = {}) {
    const { row = null, hangRead = false, rejectColumns = [], files = [], acceptDialogs = true,
            clock = null, timezoneId = null } = opts;
    const srv = await startServer();
    const browser = await chromium.launch(launchOptions());
    /* Phase 2B.3.5. `timezoneId` belongs to the context and `clock` has to be
       installed before the first navigation, so both are set up here rather
       than being something a test can reach for later. They are the whole of
       the clock control in this suite: Playwright's own API, used by the few
       tests that genuinely need an hour or a timezone, not a general
       injection facility. */
    const page = await browser.newPage(timezoneId ? { viewport: VIEWPORT, timezoneId } : { viewport: VIEWPORT });
    /* setFixedTime, deliberately, not install(). install() replaces the timer
       queue as well, so the app's own setTimeout work would never run and the
       page would come up half-wired. setFixedTime only pins what the clock
       READS, which is the entire question these tests ask. */
    if (clock) await page.clock.setFixedTime(clock);

    const errors = [];
    page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
    if (acceptDialogs) page.on('dialog', d => d.accept());

    /* unpkg still serves the Supabase client, which the stub replaces. The
       three styling CDNs are no longer referenced by the app at all; they
       stay blocked so a regression that reintroduces one fails loudly here
       rather than quietly depending on the network. */
    for (const pattern of ['**://unpkg.com/**', '**://cdn.tailwindcss.com/**',
                           '**://cdnjs.cloudflare.com/**', '**://fonts.googleapis.com/**']) {
        await page.route(pattern, r => r.abort());
    }
    await page.addInitScript(installSupabaseStub, { row, hangRead, rejectColumns, files, pngDataUri: PNG_1PX });
    /* The legacy-authority sentinel, reachable from inside page.evaluate.
       Fixtures run in the browser, so they cannot call the Node-side export
       directly. One definition, injected, rather than the literal repeated
       in nine files. */
    await page.addInitScript((p) => { window.__legacyProgramme = () => JSON.parse(JSON.stringify(p)); },
        legacyProgramme());
    await page.addInitScript(installWeekStripReader);

    // Generous timeout: e2e files run serially but each describe block opens its
    // own browser, so a loaded machine can push a cold navigation past the 30s
    // default. A flaky suite is worse than a slow one.
    await page.goto(`${srv.origin}/app/index.html`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
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
        /* Phase 3C.3. Start on the LEGACY authority path, where the
           seven-slot schedule IS the programme. Every suite that reaches the
           HQ this way and then seeds `persisted.schedule` directly is
           describing a member whose column is their programme.

           NOTE the sentinel, because the first version of this got it wrong:
           `null` is NOT legacy. See legacyProgramme() below. The injected
           copy, so the shape has exactly one definition. */
        persisted.programme = window.__legacyProgramme();
        persisted.dayPlans = [];
        if (patch) Object.assign(persisted, patch);
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('auth-screen').classList.add('hidden');
    }, { id, email, patch: persisted, loaded });
}

/**
 * Sign in the way production does, through onAuthStateChange.
 *
 * This is the real orchestration: the app's own handler runs
 * onUserSignedIn() → checkMembership() → loadPersisted() → hideAuthScreen(),
 * so anything that happens between the session arriving and the data landing
 * is observable. signIn() above skips all of that on purpose and stays the
 * right tool for a targeted invariant; this is the one to reach for when the
 * lifecycle itself is what is under test.
 *
 * `row` is the account's user_data (null = a brand-new member with no row).
 * The email is added to the stubbed members table, because checkMembership()
 * reads PGRST116 as "not a member" and would sign them straight back out.
 */
export async function authSignIn(page, { id = 'testuser', email = 'test@example.com',
                                         user_metadata = {}, row = null, member = true } = {}) {
    await page.evaluate(({ id, email, user_metadata, row, member }) => {
        const user = { id, email, user_metadata: { ...user_metadata } };
        window.__authUser = JSON.parse(JSON.stringify(user));
        window.__rowsByUser[id] = row;
        if (member && !window.__members.includes(email)) window.__members.push(email);
        window.__fireAuth('SIGNED_IN', { user, access_token: 'stub-token-' + id });
    }, { id, email, user_metadata, row, member });
    // onUserSignedIn awaits the membership lookup and the row read before it
    // hides the auth screen, so that is the honest signal that boot finished.
    await page.waitForFunction(
        () => document.getElementById('auth-screen').classList.contains('hidden')
              && document.getElementById('loading-screen').classList.contains('hidden'),
        null, { timeout: 15_000 });
}

/** Sign out the way the member does: the real handleLogout(). */
export async function authSignOut(page) {
    await page.evaluate(() => handleLogout());
    await page.waitForFunction(
        () => !document.getElementById('auth-screen').classList.contains('hidden'),
        null, { timeout: 15_000 });
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
