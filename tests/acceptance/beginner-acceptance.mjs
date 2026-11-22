// FOCUSED BEGINNER ACCEPTANCE: the app in this checkout, driven in a real browser against a Supabase
// STAGING project, while the column default for user_data.difficulty is still 'intermediate'.
//
// Test tooling. It is not part of `npm test` or `npm run test:e2e`, because it needs a staging project.
// How to set one up and run this: tests/acceptance/README.md.
//
// WHAT IT ANSWERS
//   1. A fresh signup-state row starts at Beginner (the app layer alone: the database still says Intermediate).
//   2. The first mechanical session uses Beginner dosing and awards 10 XP.
//   3. Explicitly selecting Intermediate still works, and a stale device cannot overwrite it.
//   4. Membership claiming, progress persistence and cross-device recovery stay correct, on the REAL
//      revision guard.
//
// SAFETY MODEL
//   * The app has its production Supabase URL compiled in. Every request to that host is intercepted and
//     ANSWERED FROM STAGING by this process; none is ever forwarded to production. The script refuses to
//     start if STAGING_URL names that same host. Any other host the page asks for is blocked.
//   * Auth writes (sign-out, token refresh, user update) are answered LOCALLY, so the run cannot revoke the
//     test account's sessions or change its profile.
//   * NOTHING IS SYNTHESISED: the membership answer is whatever staging's claim_membership() returns.
//   * The page is served EXACTLY as it is on disk: EQ stays off, no flag is flipped. The working tree must be
//     clean, so every result traces to one commit, and the app file is compared with what the live site serves.
//   * The run REFUSES to start unless the token belongs to STAGING_USER_ID and that member's row is a
//     signup-state row with the OLD default.
//
// CONFIGURATION (environment variables; nothing identifying lives in this file)
//   STAGING_URL           https://<project-ref>.supabase.co   the staging project            (required)
//   STAGING_ANON_KEY      the staging anon / publishable key                                  (required)
//   STAGING_USER_ID       the throwaway test member's uuid                                    (required)
//   STAGING_USER_JWT      that member's access token; held in memory, never printed or saved  (required)
//   EXPECT_SHA            stop unless HEAD is this commit                                     (optional)
//   LIVE_SITE             site whose bytes the app file is compared with; default
//                         https://theblueprint.site; "off" skips the comparison               (optional)
//   SUPABASE_JS_UMD_FILE  a local copy of the supabase-js bundle the app loads; fetched
//                         from the URL the app itself names when this is not set              (optional)
//   ACCEPTANCE_OUT_DIR    where the result JSON goes; default a new private temp directory   (optional)
//   PW_CHROMIUM_PATH      a Chromium binary (see tests/e2e/harness.js)                        (optional)
//   NODE_USE_ENV_PROXY=1  only when this machine reaches the network through an HTTPS_PROXY
//
// MODES
//   staging (default):  node tests/acceptance/beginner-acceptance.mjs
//   script check:       FAKE=1 node tests/acceptance/beginner-acceptance.mjs
//                       a local stand-in server (fake-supabase.mjs); validates THIS SCRIPT only and is
//                       never an acceptance result
//
// EXIT CODES
//   0 every check passed          1 a check failed, or the run stopped part-way
//   2 missing configuration       3 the token was rejected
//   4 the row is not a signup-state row with the old default
//   5 the token is not STAGING_USER_ID's
//   6 HEAD is not EXPECT_SHA      7 the working tree is not clean
//   8 STAGING_URL is the app's production host
//
// KNOWN BEHAVIOUR (issue 214): on real staging the app also saves when a device only signs in or reloads,
// which advances the revision and makes another open device's next save be refused once. The checks below
// therefore accept refusals of stale writes, and require that nothing else is refused. When 214 is fixed,
// tighten them: expect no refusal before device B's stale save, and no write on a reload.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, launchOptions } from '../e2e/harness.js';
import { isUntouchedSignupRow, MARKER_COLUMNS } from '../../src/startingTier.js';
import { startFake } from './fake-supabase.mjs';

const FAKE = process.env.FAKE === '1';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_FILE = path.join(REPO, 'app', 'index.html');
const APP_SRC = readFileSync(APP_FILE, 'utf8');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const mask = (id) => (id ? `${String(id).slice(0, 4)}…${String(id).slice(-4)}` : String(id));   // ids never appear in full in the output
const die = (code, msg) => { console.error(msg); process.exit(code); };

// What the app under test talks to, read from the app itself so that this file never names a project.
const APP_SUPABASE_URL = /const SUPABASE_URL\s*=\s*'(https:\/\/[^']+)'/.exec(APP_SRC)?.[1];
const UMD_URL = /<script src="(https:\/\/unpkg\.com\/@supabase\/supabase-js@[^"]+)"/.exec(APP_SRC)?.[1];
if (!APP_SUPABASE_URL || !UMD_URL) die(2, 'app/index.html no longer declares SUPABASE_URL or the supabase-js <script> in the form this script reads. Update the two patterns at the top of this file.');
const PROD_HOST = new URL(APP_SUPABASE_URL).hostname;

const FAKE_UID = '00000000-0000-4000-8000-000000000001';           // the stand-in's member: not a real account
const missing = (FAKE ? [] : ['STAGING_URL', 'STAGING_ANON_KEY', 'STAGING_USER_ID', 'STAGING_USER_JWT']).filter(k => !process.env[k]);
if (missing.length) die(2, 'Missing environment: ' + missing.join(', ') + '. See tests/acceptance/README.md.');
const ANON = FAKE ? 'stand-in' : process.env.STAGING_ANON_KEY;
const JWT = FAKE ? 'stand-in' : process.env.STAGING_USER_JWT;
const EXPECTED_UID = FAKE ? FAKE_UID : process.env.STAGING_USER_ID;
const LIVE_RAW = process.env.LIVE_SITE ?? 'https://theblueprint.site';
const LIVE_SITE = LIVE_RAW === 'off' ? '' : LIVE_RAW.replace(/\/+$/, '');
if (!FAKE) {
    let host = null;
    try { host = new URL(process.env.STAGING_URL).hostname; } catch (e) { die(2, 'STAGING_URL is not a URL.'); }
    if (host === PROD_HOST) die(8, 'Refusing: STAGING_URL is the production host this app has compiled in. The script writes to one member\'s row and must only ever see staging.');
}

let UMD;
if (process.env.SUPABASE_JS_UMD_FILE) UMD = readFileSync(process.env.SUPABASE_JS_UMD_FILE);
else {
    try {
        const r = await fetch(UMD_URL);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        UMD = Buffer.from(await r.arrayBuffer());
    } catch (e) { die(2, `Could not fetch ${UMD_URL} (${e.message}). Set SUPABASE_JS_UMD_FILE to a local copy of that version (npm pack it; the file is package/dist/umd/supabase.js).`); }
}

const fake = FAKE ? await startFake({ uid: EXPECTED_UID, email: 'tester@example.invalid' }) : null;
const STG = FAKE ? fake.url : process.env.STAGING_URL.replace(/\/+$/, '');
const stg = (p, init = {}) => fetch(STG + p, { ...init, headers: { apikey: ANON, Authorization: 'Bearer ' + JWT, ...(init.headers || {}) } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SCRIPT_START = Date.now();

// ── reporting ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0, section = '';
const failures = [], observations = [], bySection = new Map();
const sec = (s) => { section = s; bySection.set(s, { pass: 0, fail: 0 }); console.log(`\n── ${s}`); };
const tally = (ok, name) => { const t = bySection.get(section); ok ? (pass++, t.pass++) : (fail++, t.fail++, failures.push(`${section} › ${name}`)); };
const chk = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want); tally(ok, name);
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        expected ${JSON.stringify(want)}\n        got      ${JSON.stringify(got)}`));
};
const yes = (name, cond, detail = '') => { tally(!!cond, name); console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : (detail ? `\n        ${detail}` : ''))); };
const note = (s) => { observations.push(`${section}: ${s}`); console.log('      · ' + s); };

// ── who is the test member, and is the row a signup-state row with the OLD default? ──
const me = await (await stg('/auth/v1/user')).json();
if (!me.id) { console.error('Token rejected: ' + (me.msg || me.message || JSON.stringify(me))); process.exit(3); }
const UID = me.id, EMAIL = me.email;
if (UID !== EXPECTED_UID) die(5, `The token belongs to ${mask(UID)}, not to STAGING_USER_ID (${mask(EXPECTED_UID)}). Stopping.`);
const readRow = async () => (await stg(`/rest/v1/user_data?id=eq.${UID}&select=*`, { headers: { Accept: 'application/vnd.pgrst.object+json' } })).json();
const row0 = await readRow();
const signupState = !!row0 && row0.id === UID && (row0.rev || 0) === 0 && row0.difficulty === 'intermediate' && isUntouchedSignupRow(row0);
console.log(`${FAKE ? 'LOCAL FAKE (script check only, NOT an acceptance run)' : 'STAGING'} member ${mask(UID)}. row: rev ${row0 && row0.rev}, difficulty ${JSON.stringify(row0 && row0.difficulty)}, sessions ${row0 && row0.all_time_session_count}, xp ${row0 && row0.total_xp}, untouched by the app's rule: ${row0 ? isUntouchedSignupRow(row0) : 'no row'}`);
if (!signupState) { console.error('The member row is not a fresh signup-state row with the OLD default (rev 0, difficulty intermediate, every marker blank). Reset the staging account first. Stopping.'); process.exit(4); }
const COMMIT = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD']).toString().trim();
const DIRTY_TREE = execFileSync('git', ['-C', REPO, 'status', '--porcelain']).toString().trim();
console.log(`app under test: ${COMMIT}${DIRTY_TREE ? '  (WORKING TREE HAS UNCOMMITTED CHANGES)' : ''}`);
if (process.env.EXPECT_SHA && process.env.EXPECT_SHA !== COMMIT) { console.error(`Expected ${process.env.EXPECT_SHA}, have ${COMMIT}. Stopping.`); process.exit(6); }
if (DIRTY_TREE) { console.error('The working tree has uncommitted changes, so the page under test is not one recorded commit. Stopping.'); process.exit(7); }

// ── the bridge ─────────────────────────────────────────────────────────────
const stats = { bridged: 0, blocked: new Set(), claims: [], nonOk: [], conflicts: 0, authIntercepted: [], userDataWrites: [] };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*', 'access-control-max-age': '600' };
const DROP = new Set(['host', 'origin', 'referer', 'authorization', 'apikey', 'content-length', 'connection', 'accept-encoding', 'user-agent']);
async function bridge(route) {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.hostname === '127.0.0.1') return route.continue();             // the page, exactly as it is on disk
    if (req.url() === UMD_URL)
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: UMD });
    if (u.hostname !== PROD_HOST) { stats.blocked.add(u.hostname); return route.abort(); }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    // Auth WRITES never leave this process: a sign-out would revoke the test account's real sessions.
    if (u.pathname.startsWith('/auth/v1/') && !(u.pathname === '/auth/v1/user' && method === 'GET')) {
        stats.authIntercepted.push(`${method} ${u.pathname}`);
        if (u.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: CORS });
        if (u.pathname === '/auth/v1/user') return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(me) });
        return route.fulfill({ status: 400, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: 'intercepted by the test bridge' }) });
    }
    const h = {};
    for (const [k, v] of Object.entries(req.headers())) { const kl = k.toLowerCase(); if (!DROP.has(kl) && !kl.startsWith('sec-')) h[kl] = v; }
    h.apikey = ANON; h.authorization = 'Bearer ' + JWT;
    const body = req.postDataBuffer();
    let written = null;
    if (u.pathname === '/rest/v1/user_data' && ['POST', 'PATCH', 'PUT'].includes(method) && body) {
        try { const p = JSON.parse(body.toString()); const o = Array.isArray(p) ? p[0] : p; written = { method, difficulty: o.difficulty, base_rev: o.base_rev, sessions: Array.isArray(o.session_log) ? o.session_log.length : null }; } catch (e) { written = { method, unreadable: true }; }
    }
    const r = await fetch(STG + u.pathname + u.search, { method, headers: h, body: body && !['GET', 'HEAD'].includes(method) ? body : undefined });
    const buf = Buffer.from(await r.arrayBuffer());
    stats.bridged++;
    if (written) stats.userDataWrites.push({ ...written, status: r.status });
    if (u.pathname.endsWith('/rpc/claim_membership')) stats.claims.push({ status: r.status, body: buf.toString().trim() });
    if (r.status >= 400) {
        stats.nonOk.push(`${method} ${u.pathname} -> ${r.status} ${buf.toString().slice(0, 120)}`);
        if (r.status === 409) stats.conflicts++;
    }
    const rh = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) rh[k] = v; });
    return route.fulfill({ status: r.status, headers: { ...rh, ...CORS }, body: buf });
}

// ── browser: one CONTEXT per device ────────────────────────────────────────
const { origin, close } = await startServer();
const browser = await chromium.launch(launchOptions());
const errors = [], dialogs = [];
const farFuture = Math.floor(new Date('2027-06-01T00:00:00Z').getTime() / 1000);
async function newDevice(label, startISO, { returning = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'UTC' });
    const flags = returning ? [`bp_welcomed_${UID}`, `bp_onboarded_${UID}`] : [];   // a device that has been through the welcome screen and intro before
    await context.addInitScript(({ key, session, flags }) => {
        try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session)); for (const f of flags) if (!localStorage.getItem(f)) localStorage.setItem(f, '1'); } catch (e) {}
    }, {
        key: `sb-${PROD_HOST.split('.')[0]}-auth-token`, flags,
        session: { access_token: 'placeholder-replaced-by-the-bridge', token_type: 'bearer', expires_in: 86400, expires_at: farFuture, refresh_token: 'unused',
            user: { id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL, email_confirmed_at: '2026-01-01T00:00:00.000Z',
                    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' } },
    });
    await context.route('**/*', bridge);
    await context.clock.setFixedTime(new Date(startISO));
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('dialog', d => { dialogs.push(d.message().replace(/\s+/g, ' ').slice(0, 160)); d.accept(); });
    return { label, context, page };
}
async function booted(page, timeout = 45_000) {
    await page.waitForFunction(() => document.getElementById('auth-screen')?.classList.contains('hidden')
        && document.getElementById('loading-screen')?.classList.contains('hidden')
        && typeof _persistedLoaded !== 'undefined' && _persistedLoaded === true, null, { timeout });
}
async function openApp(dev) {
    await dev.page.goto(origin + '/app/index.html');
    try { await booted(dev.page); return { ok: true }; }
    catch (e) {
        const auth = await dev.page.evaluate(() => (document.getElementById('auth-error') || {}).textContent || '').catch(() => '');
        return { ok: false, authError: auth.trim().slice(0, 200) };
    }
}
const settle = async (page) => {
    await sleep(1600);                                 // the app's own 800ms save debounce, with margin
    await page.waitForFunction(() => _unsaved === false && Object.keys(localStorage).every(k => !k.startsWith('bp_pending_')), null, { timeout: 30_000 });
};
const click = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); if (!e) return 'missing'; e.click(); return 'ok'; }, id);

const today = (page) => page.evaluate(() => {
    const t = (id) => { const e = document.getElementById(id); return e ? (e.textContent || '').trim().replace(/\s+/g, ' ') : null; };
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
    const card = document.getElementById('hq-today-card');
    let week = null, mission = null;
    try { const w = currentWeekCompletion(); week = { completed: w.completed, target: w.target }; } catch (e) { week = 'ERR ' + e.message; }
    try { mission = window.BP.nextBestAction(buildResolverInput()).mission; } catch (e) { mission = 'ERR ' + e.message; }
    return { state: card.dataset.state, headline: t('today-headline'), cta: t('launch-btn'), ctaShown: vis('launch-btn'), mission, week,
             date: window.BP.planDateKey(new Date()), day: new Date().getDay() };
});
const snap = (page) => page.evaluate(() => ({
    tier: getDiff().id, goal: persisted.primaryGoal, schedule: persisted.schedule.slice(), n: persisted.sessionLog.length,
    sids: persisted.sessionLog.map(e => e.sid).filter(Boolean), types: persisted.sessionLog.map(e => e.routineType),
    xps: persisted.sessionLog.map(e => e.xpEarned), xp: persisted.totalXp, count: persisted.allTimeSessionCount,
    completed: persisted.completedDays.slice(), ledger: (persisted.progressionLedger || []).length,
    records: JSON.stringify(persisted.records), firstSession: persisted.firstSessionDate, weekKey: persisted.weekKey,
    unlocked: JSON.stringify(persisted.diffUnlockedDate), plans: (persisted.dayPlans || []).length,
    unsaved: _unsaved, notice: _syncNotice || null,
    banner: !document.getElementById('hq-sync-notice-banner').classList.contains('hidden'),
    member: !!localStorage.getItem('bp_member_ok_' + currentUser.id), eqFlag: EQ_SESSIONS_ENABLED,
    selector: (() => { try { renderDifficultySelector(); } catch (e) {} const a = document.querySelector('.diff-btn.active-diff'); return a ? a.dataset.diff : null; })(),
}));
const rowView = (r) => ({
    rev: r.rev, n: (r.session_log || []).length, sids: (r.session_log || []).map(e => e.sid).filter(Boolean),
    xp: r.total_xp, count: r.all_time_session_count, goal: r.primary_goal, schedule: r.schedule,
    completed: r.completed_days, ledger: (r.progression_ledger || []).length,
});
/** Wait for the save, then compare what the browser holds with what the SERVER holds. */
async function agree(page, label) {
    await settle(page);
    const s = await snap(page), row = await readRow(), r = rowView(row);
    chk(`${label}: the server row equals the browser (log, ids, XP, count, goal, schedule, completed days, ledger)`,
        { n: r.n, sids: r.sids, xp: r.xp, count: r.count, goal: r.goal, schedule: r.schedule, completed: r.completed, ledger: r.ledger },
        { n: s.n, sids: s.sids, xp: s.xp, count: s.count, goal: s.goal, schedule: s.schedule, completed: s.completed, ledger: s.ledger });
    chk(`${label}: and the server holds the tier the browser shows`, row.difficulty, s.tier);
    return { s, r, row };
}
const openReady = (page) => page.evaluate(() => {
    document.getElementById('launch-btn').click();
    document.querySelector('#soreness-btns [data-soreness="none"]').click();
    document.querySelector('#sleep-btns [data-sleep="good"]').click();
    const t = (id) => (document.getElementById(id).textContent || '').trim().replace(/\s+/g, ' ');
    return { step: document.querySelector('.step-content.active-step')?.id, planned: t('ready-planned'), cta: t('ready-cta'), ctaDisabled: document.getElementById('ready-cta').disabled };
});
/** Press Start, read what the engine will RUN (rounds, seconds, tier), then perform it to the summary. */
const performRead = (page) => page.evaluate(() => {
    document.getElementById('ready-cta').click();
    _sessionStartTime = Date.now() - 6e5; selectedEQ = 8; selectedRPE = 5;
    const routine = session.routineType, durations = [], was = session.exerciseIndex;
    for (let i = 0; i < ROUTINES[routine].length; i++) { session.exerciseIndex = i; durations.push(getCurEx().duration); }
    session.exerciseIndex = was;
    const snapL = _launchedPrescription;
    const engine = { routine, rounds: session.girthTotalRounds, durations, xpTier: snapL ? snapL.xpTier : null,
                     prescribed: snapL && snapL.prescribedDose ? JSON.parse(JSON.stringify(snapL.prescribedDose)) : null };
    const titles = []; let last = '';
    for (let i = 0; i < 900; i++) {
        const ex = getCurEx(); const sig = ex && ex.title;
        if (sig !== last) { titles.push(sig); last = sig; }
        if (session.timer) { session.timer.cancel(); session.timer = null; }
        onSetDone();
        if (!document.getElementById('rest-overlay').classList.contains('hidden')) skipRest();
        const s5 = document.getElementById('step-5');
        if (s5 && !s5.classList.contains('hidden-step')) return { engine, titles, atSummary: true };
    }
    return { engine, titles, atSummary: false };
});
const finish = (page) => page.evaluate(() => {
    finishSession(); closeSessionSummary();
    const e = persisted.sessionLog.at(-1);
    return { routineType: e.routineType, sid: e.sid, date: e.date, xpEarned: e.xpEarned, scheduledType: e.scheduledType, prescriptionDate: e.prescriptionDate,
             executedDose: e.executedDose ? JSON.parse(JSON.stringify(e.executedDose)) : null, prescribedDose: e.prescribedDose ? JSON.parse(JSON.stringify(e.prescribedDose)) : null };
});
/** The dated plan the app stored for today: that stored dose is what will execute. */
const planToday = (page) => page.evaluate(() => {
    const key = window.BP.planDateKey(new Date());
    const p = persisted.dayPlans.find(x => x.date === key);
    return p && p.primarySession ? { date: key, type: p.primarySession.type, dose: JSON.parse(JSON.stringify(p.primarySession.dose)) } : { date: key, type: null, dose: null };
});

const D = { mon1: '2026-11-23T10:00:00Z', mon1b: '2026-11-23T11:00:00Z', wed1: '2026-11-25T10:00:00Z', fri1: '2026-11-27T10:00:00Z' };
const BEGINNER = { rounds: 3, durations: [60, 30], restDur: 30, xp: 10 };       // GIRTH_CIRCUIT.beginner, SESSION_XP.beginner
let lastRev = -1;
let conflictsAfterB = -1, conflictsBeforeB = -1;

try {
    // ═══ 0. THE RESET, AND THE PAGE UNDER TEST ══════════════════════════════
    sec('0. The reset is verified, and the page under test is what production serves');
    chk('the row is a signup-state row: revision 0, no sessions, no XP, no goal, no programme',
        { rev: row0.rev, n: (row0.session_log || []).length, xp: row0.total_xp, count: row0.all_time_session_count, goal: row0.primary_goal, programme: row0.programme },
        { rev: 0, n: 0, xp: 0, count: 0, goal: '', programme: null });
    chk('and the column still holds the OLD default: the database says Intermediate', row0.difficulty, 'intermediate');
    yes('the app\'s own rule reads this real staging row as a never-begun account (all 17 markers blank)', isUntouchedSignupRow(row0));
    note(`the real signup row's markers: ${MARKER_COLUMNS.map(c => `${c}=${JSON.stringify(row0[c])}`).join('; ')}`);
    note(`app commit ${COMMIT}`);
    let live = LIVE_SITE ? null : { skipped: true };
    if (LIVE_SITE) {
        try {
            const [la, lm] = await Promise.all(['/app/', '/src/startingTier.js'].map(async p => { const r = await fetch(LIVE_SITE + p); return { status: r.status, sha: sha(Buffer.from(await r.arrayBuffer())) }; }));
            live = { app: la, module: lm };
        } catch (e) { live = { error: String(e.message || e) }; }
    }
    if (live.skipped) note('the comparison with the live site was skipped (LIVE_SITE=off)');
    else if (live.error) note(`could not read ${LIVE_SITE} to compare bytes (${live.error})`);
    else {
        chk('the page under test is byte-identical to the app the live site serves now', [live.app.status, live.app.sha], [200, sha(readFileSync(APP_FILE))]);
        chk('and so is the Beginner module', [live.module.status, live.module.sha], [200, sha(readFileSync(path.join(REPO, 'src', 'startingTier.js')))]);
    }

    const A = await newDevice('device-A', D.mon1);

    // ═══ 1. MEMBERSHIP: the real claim, first sign-in ═══════════════════════
    sec('1. Membership: the first sign-in runs the real claim_membership()');
    const boot = await openApp(A);
    yes('the app signs the member in (no denial screen)', boot.ok, JSON.stringify(boot));
    if (!boot.ok) throw new Error('access denied or boot failed: ' + JSON.stringify(boot) + ' claims=' + JSON.stringify(stats.claims));
    chk('the claim answered 200 true, by the database', stats.claims.slice(0, 1), [{ status: 200, body: 'true' }]);
    let s = await snap(A.page);
    yes('the device remembers the verified member only after a true claim', s.member === true);
    chk('the page is the shipped build: EQ is off', s.eqFlag, false);
    const welcome = await A.page.evaluate(() => {
        const w = document.getElementById('step-welcome');
        return { shown: w.classList.contains('active-step') && !w.classList.contains('hidden-step'), initDisabled: document.getElementById('init-btn').disabled,
                 boxes: !!document.getElementById('check-liability') && !!document.getElementById('check-pain') };
    });
    yes('a first sign-in lands on the welcome screen with its liability gate', welcome.shown && welcome.boxes && welcome.initDisabled, JSON.stringify(welcome));

    // ═══ 2. A FRESH SIGNUP-STATE ROW STARTS AT BEGINNER ═════════════════════
    sec('2. A fresh signup-state row starts at Beginner (the database still says Intermediate)');
    chk('the app reads the account at Beginner on its first load', s.tier, 'beginner');
    chk('and the tier selector shows Beginner as the active one', s.selector, 'beginner');
    const first = await agree(A.page, 'after the first load');
    chk('the first save wrote Beginner into the row, and the row is no longer a signup row', [first.row.difficulty, isUntouchedSignupRow(first.row)], ['beginner', false]);
    yes('the app\'s first load recorded its markers: week_key and xp_migrated', !!first.row.week_key && first.row.xp_migrated === true, JSON.stringify({ w: first.row.week_key, x: first.row.xp_migrated }));
    yes('the revision moved off 0 on the new row, with no refusal', first.r.rev >= 1 && stats.conflicts === 0, `rev ${first.r.rev}, conflicts ${stats.conflicts}`);
    chk('Intermediate was never sent to the server', stats.userDataWrites.filter(w => w.difficulty !== 'beginner').length, 0);
    lastRev = first.r.rev;

    // ═══ 3. ONBOARDING (Size): the plan is made at Beginner ═════════════════
    sec('3. Onboarding: welcome, goal picker, Start my plan (Size, a Monday)');
    await A.page.evaluate(() => { for (const id of ['check-liability', 'check-pain']) { const c = document.getElementById(id); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } });
    await click(A.page, 'init-btn');
    await A.page.waitForFunction(() => document.getElementById('onboarding-overlay').classList.contains('show'), null, { timeout: 10_000 });
    const dlg0 = dialogs.length;
    await A.page.evaluate(() => document.querySelector('#goal-options .goal-opt[data-goal="size"]').click());
    await sleep(500);
    const picked = await A.page.evaluate(() => ({ goal: persisted.primaryGoal, plans: persisted.dayPlans.length, authoritative: onAuthoritativePlans(), tier: getDiff().id }));
    yes('a brand-new buyer\'s first pick applies at once, with no "starts next Monday" confirmation', picked.goal === 'size' && dialogs.length === dlg0 && picked.authoritative && picked.plans > 0, JSON.stringify({ picked, dialogs: dialogs.length - dlg0 }));
    chk('the tier is still Beginner after the goal is chosen', picked.tier, 'beginner');
    await click(A.page, 'ob-next-btn');
    await sleep(1200);
    let t = await today(A.page);
    chk('Today offers Monday\'s session: TRAIN, Girth Day, mission girth', [t.state, t.headline, t.mission], ['TRAIN', 'Girth Day', 'girth']);
    const plan = await planToday(A.page);
    chk('the plan stored for today is a girth circuit at Beginner dosing (3 rounds, 30 s rest)', [plan.type, plan.dose && plan.dose.shape, plan.dose && plan.dose.rounds, plan.dose && plan.dose.restDur], ['girth', 'circuit', BEGINNER.rounds, BEGINNER.restDur]);
    const onb = await agree(A.page, 'after onboarding');
    lastRev = onb.r.rev;

    // Device B opens now, as a returning device, and will go stale: it will not see what A does next.
    const B = await newDevice('device-B', D.mon1b, { returning: true });
    const bootB = await openApp(B);
    yes('device B signs in (a second device for the same member)', bootB.ok, JSON.stringify(bootB));
    const sB0 = await snap(B.page);
    chk('device B reads Beginner and the goal from what device A saved', [sB0.tier, sB0.goal, sB0.n], ['beginner', 'size', 0]);
    yes('and every claim so far was answered true by the database', stats.claims.length >= 2 && stats.claims.every(c => c.status === 200 && c.body === 'true'), JSON.stringify(stats.claims));

    // ═══ 4. THE FIRST MECHANICAL SESSION, ON DEVICE A ═══════════════════════
    sec('4. The first mechanical session: Beginner dosing, 10 XP');
    const ready = await openReady(A.page);
    chk('the Ready screen says Girth and is startable', [ready.step, ready.planned, ready.ctaDisabled], ['step-1', 'On the plan today: Girth.', false]);
    const before = await snap(A.page);
    const run = await performRead(A.page);
    yes('the guided engine reaches the summary', run.atSummary, JSON.stringify(run));
    chk('the engine runs 3 rounds of 60 s jelq and 30 s uli (Beginner), not Intermediate\'s 4 x 120 s / 45 s', { routine: run.engine.routine, rounds: run.engine.rounds, durations: run.engine.durations }, { routine: 'girth', rounds: BEGINNER.rounds, durations: BEGINNER.durations });
    chk('the session launched under the Beginner XP tier', run.engine.xpTier, 'beginner');
    chk('and the prescription it executes is the Beginner circuit', [run.engine.prescribed && run.engine.prescribed.rounds, run.engine.prescribed && run.engine.prescribed.restDur], [BEGINNER.rounds, BEGINNER.restDur]);
    const f = await finish(A.page);
    const after = await snap(A.page);
    t = await today(A.page);
    chk('the session awarded 10 XP', f.xpEarned, BEGINNER.xp);
    chk('XP is awarded once: the total is 10, the count 1, the best-session record 10', [after.xp, after.count, JSON.parse(after.records).bestSessionXp], [BEGINNER.xp, 1, BEGINNER.xp]);
    chk('the entry is a girth session for the day it was prescribed', [f.routineType, f.scheduledType, f.prescriptionDate === t.date], ['girth', 'girth', true]);
    chk('and the saved record carries the Beginner dose it executed', [f.executedDose && f.executedDose.rounds, f.prescribedDose && f.prescribedDose.rounds], [BEGINNER.rounds, BEGINNER.rounds]);
    chk('Today reads COMPLETE, with no Start', [t.state, t.headline, t.ctaShown], ['COMPLETE', 'Today Is Done', false]);
    // Issue 214: device B's sign-in saved too, which made device A stale once; the guard refused that save and the app recovered it.
    const sess = await agree(A.page, 'after the first session');
    yes('the server revision advanced and no sync notice is showing (device B opening the app made device A stale once; the guard refused that save and the app recovered it)', sess.r.rev > lastRev && !sess.s.notice && !sess.s.banner, `rev ${sess.r.rev} (was ${lastRev}) conflicts ${stats.conflicts} notice ${JSON.stringify(sess.s.notice)}`);
    chk('the server row holds the session, 10 XP and Beginner', [sess.row.session_log.length, sess.row.total_xp, sess.row.difficulty], [1, BEGINNER.xp, 'beginner']);
    chk('Intermediate has still never been sent to the server', stats.userDataWrites.filter(w => w.difficulty !== 'beginner').length, 0);
    lastRev = sess.r.rev;

    // ═══ 5. EXPLICITLY SELECTING INTERMEDIATE ═══════════════════════════════
    sec('5. Explicitly selecting Intermediate still works');
    const conflictsBeforeChoice = stats.conflicts;
    const choice = await A.page.evaluate(() => {
        goToStep(3);
        const b = document.querySelector('.diff-btn[data-diff="intermediate"]');
        if (!b) return { missing: true };
        if (b.dataset.locked === 'true') return { locked: true };
        b.click(); const tier = getDiff().id; goToStep(0);
        return { tier, unlocked: !!(persisted.diffUnlockedDate && persisted.diffUnlockedDate.intermediate), first: !!persisted.firstSessionDate };
    });
    chk('the member taps Mid in the real selector and the app holds Intermediate, with the choice recorded', choice, { tier: 'intermediate', unlocked: true, first: true });
    const chosen = await agree(A.page, 'after choosing Intermediate');
    chk('the choice reached the server, with its marks', [chosen.row.difficulty, !!(chosen.row.diff_unlocked_date && chosen.row.diff_unlocked_date.intermediate), !!chosen.row.first_session_date], ['intermediate', true, true]);
    yes('the revision advanced and this step met no new refusal', chosen.r.rev > lastRev && stats.conflicts === conflictsBeforeChoice, `rev ${chosen.r.rev} (was ${lastRev}) conflicts ${conflictsBeforeChoice} -> ${stats.conflicts}`);
    lastRev = chosen.r.rev;
    await A.page.reload(); await booted(A.page); await sleep(900);
    const reloaded = await snap(A.page);
    chk('reopening the app keeps Intermediate: an explicit choice is never decided again', [reloaded.tier, reloaded.selector, reloaded.n, reloaded.xp], ['intermediate', 'intermediate', 1, BEGINNER.xp]);
    const rowAfterReload = await readRow();
    chk('and the reload overwrote nothing: the row still holds Intermediate, the one session and its 10 XP', [rowAfterReload.difficulty, (rowAfterReload.session_log || []).length, rowAfterReload.total_xp], ['intermediate', 1, BEGINNER.xp]);
    lastRev = rowAfterReload.rev;
    note('a tier change after plans exist keeps their stored dose while XP follows the live tier: issue 211, existing behaviour, not asserted here');

    // ═══ 6. CROSS-DEVICE RECOVERY, ON THE REAL REVISION GUARD ═══════════════
    sec('6. Cross-device: a stale device is refused, recovers, and cannot overwrite the explicit choice');
    const staleB = await snap(B.page);
    chk('device B has not seen any of it: still Beginner, no sessions, no XP', [staleB.tier, staleB.n, staleB.xp], ['beginner', 0, 0]);
    await B.context.clock.setFixedTime(new Date(D.wed1));       // two days later, on a phone that never reopened
    await B.page.evaluate(() => renderDashboard());
    await sleep(700);
    const tB = await today(B.page);
    chk('on Wednesday device B offers its Size session: TRAIN, Length Day', [tB.state, tB.headline, tB.mission], ['TRAIN', 'Length Day', 'length']);
    await openReady(B.page);
    const conflictsBefore = stats.conflicts; conflictsBeforeB = conflictsBefore;
    const runB = await performRead(B.page);
    yes('device B\'s guided engine reaches the summary', runB.atSummary, JSON.stringify(runB));
    chk('device B ran the session under the Beginner XP tier it had', runB.engine.xpTier, 'beginner');
    const fB = await finish(B.page);
    chk('device B\'s session earned 10 XP and is a length session', [fB.routineType, fB.xpEarned], ['length', BEGINNER.xp]);
    await settle(B.page);
    const recovered = await agree(B.page, 'after device B recovered');
    yes('the real revision guard refused device B\'s stale write (HTTP 409) at least once', stats.conflicts > conflictsBefore, `conflicts ${conflictsBefore} -> ${stats.conflicts}`);
    note(`conflicts answered by the real database during device B's save: ${stats.conflicts - conflictsBefore}`);
    chk('after recovery the server holds both sessions, in order, once each, with the XP of both', { types: recovered.row.session_log.map(e => e.routineType), n: recovered.r.n, xp: recovered.r.xp, count: recovered.r.count, dup: new Set(recovered.r.sids).size === recovered.r.sids.length },
        { types: ['girth', 'length'], n: 2, xp: 2 * BEGINNER.xp, count: 2, dup: true });
    chk('the explicit Intermediate survived the stale device\'s write: on the server and on device B', [recovered.row.difficulty, recovered.s.tier], ['intermediate', 'intermediate']);
    yes('nothing was lost, so device B shows no sync notice', !recovered.s.notice && !recovered.s.banner, JSON.stringify({ n: recovered.s.notice, b: recovered.s.banner }));
    lastRev = recovered.r.rev;
    conflictsAfterB = stats.conflicts;

    // ═══ 7. A FRESH DEVICE, AND MEMBERSHIP AGAIN ════════════════════════════
    sec('7. A fresh device, and membership after signing out and back in');
    const C = await newDevice('device-C', D.fri1);
    const bootC = await openApp(C);
    yes('a fresh device signs in', bootC.ok, JSON.stringify(bootC));
    const sC = await snap(C.page);
    const cAfterC = stats.conflicts;
    chk('the fresh device sees the whole history, the goal and the explicit tier', { tier: sC.tier, goal: sC.goal, n: sC.n, sids: sC.sids, xp: sC.xp, count: sC.count }, { tier: 'intermediate', goal: 'size', n: 2, sids: recovered.s.sids, xp: 2 * BEGINNER.xp, count: 2 });
    await C.context.close();
    const claimsBefore = stats.claims.length;
    const preOut = await snap(A.page);
    await A.page.evaluate(() => handleLogout());
    await sleep(900);
    const outShown = await A.page.evaluate(() => !document.getElementById('auth-screen').classList.contains('hidden'));
    yes('signing out returns the member to the sign-in screen (the auth server was never told: answered locally)', outShown && stats.authIntercepted.some(x => /logout/.test(x)), JSON.stringify({ outShown, auth: stats.authIntercepted }));
    const cAfterOut = stats.conflicts;
    await A.page.reload(); await booted(A.page).catch(() => {}); await sleep(900);
    const cAfterIn = stats.conflicts;
    note(`handleLogout() always sends the outgoing account's whole row, so a tab that went stale (device A, after device B wrote) meets the guard on sign-out too; the guard refuses it and nothing is lost`);
    note(`revision refusals by step: device B's stale save ${conflictsAfterB}; fresh device C signing in ${cAfterC - conflictsAfterB}; device A signing out ${cAfterOut - cAfterC}; device A signing back in ${cAfterIn - cAfterOut}`);
    const back = await A.page.evaluate(() => ({ authHidden: document.getElementById('auth-screen').classList.contains('hidden') }));
    yes('signing back in is accepted: the claim answered true again, the membership is still the member\'s', back.authHidden && stats.claims.length > claimsBefore && stats.claims.at(-1).body === 'true', JSON.stringify({ back, claims: stats.claims.length - claimsBefore }));
    const postIn = await snap(A.page);
    chk('and the tier, every session, XP and total came back exactly as they were', { tier: postIn.tier, n: postIn.n, sids: postIn.sids, xp: postIn.xp, count: postIn.count, goal: postIn.goal }, { tier: 'intermediate', n: 2, sids: preOut.sids.length === 2 ? preOut.sids : recovered.s.sids, xp: 2 * BEGINNER.xp, count: 2, goal: 'size' });
    yes('every membership claim in the whole run was answered true by the database', stats.claims.length >= 4 && stats.claims.every(c => c.status === 200 && c.body === 'true'), JSON.stringify(stats.claims));
    const finalRow = await readRow();
    chk('the final server row: Intermediate (chosen), two sessions, 20 XP, count 2, the goal and plans', [finalRow.difficulty, (finalRow.session_log || []).length, finalRow.total_xp, finalRow.all_time_session_count, finalRow.primary_goal, (finalRow.day_plans || []).length > 0], ['intermediate', 2, 2 * BEGINNER.xp, 2, 'size', true]);

    // ═══ 8. HEALTH ══════════════════════════════════════════════════════════
    sec('8. Overall health of the run');
    chk('no uncaught page errors on any device', errors, []);
    const memberPaths = stats.nonOk.filter(x => /\/rest\/v1\/(user_data|rpc\/claim_membership)/.test(x));
    yes('every non-2xx answer on the member\'s data and membership was a revision refusal (409) of a stale write', stats.conflicts >= 1 && memberPaths.length === stats.conflicts && memberPaths.every(x => /^(POST|PATCH|PUT) \/rest\/v1\/user_data -> 409 /.test(x)) && memberPaths.every(x => { const m = /based on revision (\d+), current is (\d+)/.exec(x); return !m || +m[1] < +m[2]; }), JSON.stringify({ memberPaths, conflicts: stats.conflicts }));
    const accepted = (w) => w.status >= 200 && w.status < 300;
    const iFirstChoice = stats.userDataWrites.findIndex(w => w.difficulty === 'intermediate' && accepted(w));
    const lateBeginner = stats.userDataWrites.slice(iFirstChoice + 1).filter(w => w.difficulty === 'beginner');
    yes('after the explicit choice reached the server, every write that still carried Beginner was REFUSED: Beginner never landed over it', iFirstChoice > 0 && lateBeginner.length >= 1 && lateBeginner.every(w => w.status === 409), JSON.stringify({ iFirstChoice, lateBeginner }));
    yes('every write accepted before the explicit choice carried Beginner, and every write accepted after it carried Intermediate', stats.userDataWrites.every((w, i) => !accepted(w) || w.difficulty === (i < iFirstChoice ? 'beginner' : 'intermediate')), JSON.stringify(stats.userDataWrites.map(w => `${w.difficulty}:${w.status}`)));
    note(`other non-2xx answers (optional tables this project does not have): ${[...new Set(stats.nonOk.filter(x => !memberPaths.includes(x)).map(x => x.split(' -> ')[0]))].join(', ') || 'none'}`);
    chk('no request left the bridge for an unexpected host', [...stats.blocked].filter(h => !/unpkg|tailwind|cloudflare|googleapis|gstatic|fontawesome|jsdelivr|stripe|cdn/i.test(h)), []);
    chk('the app file on disk is unmodified, and the flag on disk is still false', [execFileSync('git', ['-C', REPO, 'status', '--porcelain']).toString().trim(), /let EQ_SESSIONS_ENABLED=false;/.test(readFileSync(APP_FILE, 'utf8'))], ['', true]);
} catch (e) {
    fail++; failures.push(`SCRIPT STOPPED: ${e.message}`);
    console.log('\nSTOPPED: ' + e.stack);
} finally {
    await browser.close(); await close(); if (fake) await fake.close();
}

console.log(`\n══ ${FAKE ? 'SCRIPT CHECK (fake server, not an acceptance result)' : 'FOCUSED BEGINNER ACCEPTANCE RESULT'}: ${pass} passed, ${fail} failed  (${Math.round((Date.now() - SCRIPT_START) / 1000)}s)`);
console.log(`app under test ${COMMIT}${DIRTY_TREE ? ' (uncommitted changes present)' : ''}`);
for (const [name, c] of bySection) console.log(`  ${c.fail ? 'FAIL' : 'ok  '}  ${name}  (${c.pass} passed${c.fail ? `, ${c.fail} failed` : ''})`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
console.log(`bridged requests: ${stats.bridged}; claim answers: ${stats.claims.length} (all true: ${stats.claims.every(c => c.status === 200 && c.body === 'true')}); revision refusals: ${stats.conflicts}; auth calls answered locally: ${JSON.stringify([...new Set(stats.authIntercepted)])}`);
console.log(`user_data writes seen: ${stats.userDataWrites.length}; tiers sent: ${JSON.stringify([...new Set(stats.userDataWrites.map(w => w.difficulty))])}`);
if (stats.nonOk.length) { console.log('non-2xx answers from the database:'); [...new Set(stats.nonOk)].slice(0, 25).forEach(x => console.log('  ' + x)); }
if (fake) console.log('fake server saw: ' + [...fake.state.seen].join(', ') + `; refused ${fake.state.refused}`);
console.log('dialogs: ' + JSON.stringify(dialogs));
if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
// The result file holds counts, check names, the write log and the first 120 characters of each non-2xx
// answer. Read it before sharing it, and never commit it.
const OUT_DIR = process.env.ACCEPTANCE_OUT_DIR || mkdtempSync(path.join(tmpdir(), 'beginner-acceptance-'));
mkdirSync(OUT_DIR, { recursive: true });
const OUT_FILE = path.join(OUT_DIR, FAKE ? 'beginner-acceptance.fake.result.json' : 'beginner-acceptance.result.json');
writeFileSync(OUT_FILE, JSON.stringify({ mode: FAKE ? 'fake' : 'staging', commit: COMMIT, pass, fail, failures, observations, claims: stats.claims, conflicts: stats.conflicts, userDataWrites: stats.userDataWrites, nonOk: stats.nonOk }, null, 2));
console.log('result file: ' + OUT_FILE);
process.exit(fail ? 1 : 0);
