import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The whole personalization hierarchy, asserted in one place. Phase 2B.3.5.
 *
 * Each rule below is already enforced somewhere, and most are covered by the
 * suite that introduced them. What was missing is a single statement of the
 * ORDER, so that a later change which quietly promotes the greeting above a
 * safety state, or the name prompt above real news, fails here rather than
 * in whichever file happens to notice.
 *
 *   critical / safety  →  Today  →  liveness  →  selective personalization
 *   →  ordinary greeting  →  low-priority name acquisition
 *
 * No new precedence engine. These drive the real renderDashboard() and read
 * what the existing NUDGE_BAND and livenessContext() machinery decided.
 *
 * The second half is the restraint audit: how often the member's own name is
 * actually on screen across a representative day.
 */

const NAME = 'Marcus';
const EVERY_DAY = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();

/** A named, onboarded member on an ordinary training day. */
const base = (page, patch = {}, opts = {}) => page.evaluate(({ patch, opts, EVERY_DAY, NAME }) => {
    currentUser = { ...currentUser, user_metadata: { preferred_name: NAME } };
    window.__authUser = { id: currentUser.id, email: currentUser.email,
                          user_metadata: { preferred_name: NAME } };
    _persistedLoaded = true; _storageFull = false;
    persisted.primaryGoal = 'all';
    persisted.pelvicProfile = 'standard';
    persisted.pelvicScreenDate = '2025-01-01';
    persisted.schedule = [...EVERY_DAY];
    persisted.completedDays = [false, false, false, false, false, false, false];
    persisted.sessionLog = [{ date: new Date(Date.now() - 2 * 86400000).toISOString(),
                              routineType: 'length', duration: 30 }];
    persisted.progressionLedger = [];
    persisted.streakPasses = 0;
    Object.assign(persisted, patch);
    try {
        localStorage.setItem('bp_onboarded_' + currentUser.id, '1');
        localStorage.removeItem(getTodaySorenessKey());
        localStorage.removeItem(getTodaySleepKey());
        localStorage.removeItem('bp_session_draft_' + currentUser.id);
        Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k));
        if (opts.clearAsked) Object.keys(localStorage).filter(k => k.startsWith('bp_name_asked_')).forEach(k => localStorage.removeItem(k));
        if (opts.noName) { currentUser = { ...currentUser, user_metadata: {} };
                           window.__authUser.user_metadata = {}; }
        if (opts.soreness) localStorage.setItem(getTodaySorenessKey(), opts.soreness);
    } catch (e) {}
    /* The HQ must be the live step or every height is 0 and the geometry
       assertions below mean nothing. goToStep(0) renders once on its own,
       which spends today's greeting, so the gate is cleared AFTER it and
       before the render this helper reports on. */
    goToStep(0);
    try { Object.keys(localStorage).filter(k => k.startsWith('bp_greeted_')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    renderDashboard();
    const vis = (id) => { const e = document.getElementById(id);
                          return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; };
    return {
        state: window.BP.nextBestAction(buildResolverInput()).state,
        liveness: document.getElementById('today-liveness').dataset.liveness || null,
        greeting: vis('hq-greeting'),
        prompt: vis('hq-name-prompt'),
        pelvic: vis('hq-pelvic-prompt'),
        headline: document.getElementById('today-headline').textContent.trim(),
    };
}, { patch, opts, EVERY_DAY, NAME });

describe('the personalization hierarchy, all of it', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'pp1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: an ordinary day is where the greeting is allowed to live', async () => {
        const r = await base(app.page);
        expect(r.state).toBe('TRAIN');
        expect(r.liveness).toBeNull();
        expect(r.greeting).toBe(true);     // the baseline the rest contrast with
    }, 30_000);

    test('ACCEPTANCE: RECOVER suppresses the ordinary greeting', async () => {
        const r = await base(app.page, {}, { soreness: 'high' });
        expect(r.state).toBe('RECOVER');
        expect(r.greeting).toBe(false);
        expect(r.headline).not.toContain(NAME);   // safety copy stays impersonal
    }, 30_000);

    test('ACCEPTANCE: PREPARE suppresses it too', async () => {
        const r = await base(app.page, { primaryGoal: '' });
        expect(r.state).toBe('PREPARE');
        expect(r.greeting).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: an extended return suppresses the greeting and keeps the name', async () => {
        const r = await base(app.page, { sessionLog: [{ date: ago(30), routineType: 'length', duration: 30 }] });
        expect(r.liveness).toBe('extended-return');
        expect(r.greeting).toBe(false);           // liveness outranks the greeting
        const text = await app.page.evaluate(() => document.getElementById('today-liveness').textContent);
        expect(text).toContain(`Welcome back, ${NAME}.`);
    }, 30_000);

    test('ACCEPTANCE: a plain return suppresses it', async () => {
        const r = await base(app.page, { sessionLog: [{ date: ago(8), routineType: 'length', duration: 30 }] });
        expect(r.liveness).toBe('returning');
        expect(r.greeting).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: missed-week re-entry suppresses it', async () => {
        // A recent session on purpose: a return outranks a missed week, and
        // leaving the previous test's eight-day-old log in place would test
        // the wrong rule.
        const prev = await app.page.evaluate(() => window.BP.weekKey(new Date(Date.now() - 7 * 86400000)));
        const r = await base(app.page, {
            sessionLog: [{ date: ago(1), routineType: 'length', duration: 30 }],
            progressionLedger: [{ weekKey: prev, targetSessions: 4, qualifyingSessions: 0, verdict: 'missed' }],
        });
        expect(r.liveness).toBe('missed-week');
        expect(r.greeting).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: Week Complete suppresses the first-session acknowledgment', async () => {
        // One scheduled day, and this completion both starts the programme
        // and finishes the week. Only one line may come out of that.
        const r = await app.page.evaluate(() => {
            const today = new Date().getDay();
            _persistedLoaded = true;
            persisted.primaryGoal = 'all'; persisted.pelvicProfile = 'standard';
            persisted.schedule = Array.from({ length: 7 }, (_, i) => i === today ? 'length' : 'rest');
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = []; persisted.progressionLedger = [];
            persisted.programmeStartDate = null; persisted.allTimeSessionCount = 0;
            persisted.firstSessionDate = '';
            session.routineType = 'length';
            _sessionStartTime = Date.now() - 30 * 60000;
            selectedEQ = 8; selectedRPE = 5;
            ['input-bpel', 'input-mseg', 'session-note-input'].forEach(id => { document.getElementById(id).value = ''; });
            finishSession();
            const out = { records: document.getElementById('summary-records').textContent,
                          started: _programmeStartedThisSession,
                          weekComplete: currentWeekComplete() };
            closeSessionSummary();
            renderDashboard();
            out.liveness = document.getElementById('today-liveness').dataset.liveness || null;
            return out;
        });
        expect(r.started).toBe(true);
        expect(r.weekComplete).toBe(true);
        expect(r.records).not.toContain('officially underway');
        expect(r.liveness).toBe('week-complete');
    }, 30_000);

    test('ACCEPTANCE: a useful nudge outranks the name prompt', async () => {
        // The pelvic screener is safety relevant and the name is not, so an
        // unanswered screener takes the one band slot.
        const r = await base(app.page, { pelvicProfile: '', pelvicScreenDate: '' },
                             { noName: true, clearAsked: true });
        expect(r.pelvic).toBe(true);
        expect(r.prompt).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: with nothing more useful to say, the prompt is allowed', async () => {
        const r = await base(app.page, {}, { noName: true, clearAsked: true });
        expect(r.pelvic).toBe(false);
        expect(r.prompt).toBe(true);
    }, 30_000);

    test('ACCEPTANCE: the name prompt never replaces Today', async () => {
        const r = await app.page.evaluate(() => {
            const card = document.getElementById('hq-today-card');
            const prompt = document.getElementById('hq-name-prompt');
            const cr = card.getBoundingClientRect(), pr = prompt.getBoundingClientRect();
            return { cardVisible: !card.classList.contains('hidden') && cr.height > 0,
                     headline: document.getElementById('today-headline').textContent.trim(),
                     cta: document.getElementById('launch-btn').textContent.trim(),
                     promptBelow: pr.top >= cr.bottom };
        });
        expect(r.cardVisible).toBe(true);
        expect(r.headline.length).toBeGreaterThan(0);
        expect(r.cta.length).toBeGreaterThan(0);
        expect(r.promptBelow).toBe(true);        // structurally underneath it
    }, 30_000);

    test('ACCEPTANCE: a live attention band suppresses the name prompt', async () => {
        /* The only attention-band case the account suite exercised was
           _persistedLoaded = false, which is ALSO nameNudgeEligible()'s very
           first guard, so removing the band check passed every test. The
           storage-full banner is an independent trigger: data is loaded, the
           member is fine, and something critical is still on screen. */
        const r = await base(app.page, {}, { noName: true, clearAsked: true });
        expect(r.prompt).toBe(true);                   // eligible before the band
        const during = await app.page.evaluate(() => {
            _storageFull = true;
            renderDashboard();
            const vis = (i) => { const e = document.getElementById(i);
                                 return !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; };
            const out = { band: _attentionBandLive(), loaded: _persistedLoaded,
                          banner: vis('hq-storage-full-banner'),
                          prompt: vis('hq-name-prompt'), nudgeLive: _nameNudgeLive };
            _storageFull = false;
            return out;
        });
        expect(during.loaded).toBe(true);              // the other guard is NOT doing the work
        expect(during.band).toBe(true);
        expect(during.banner).toBe(true);
        expect(during.nudgeLive).toBe(false);
        expect(during.prompt).toBe(false);
    }, 30_000);

    test('ACCEPTANCE: no analytics event ever carries a name or an email', async () => {
        /* track()'s _cleanProps keeps any string of 40 characters or fewer,
           so nothing structural stops a name being passed. The guarantee is
           that no call site does, and that is worth asserting over the whole
           buffer after the identity flows have actually run. */
        const r = await app.page.evaluate(async () => {
            currentUser = { ...currentUser, email: 'marcus.kane@example.com', user_metadata: {} };
            window.__authUser = { id: currentUser.id, email: currentUser.email, user_metadata: {} };
            try { _analyticsBuffer.length = 0; } catch (e) {}
            Object.keys(localStorage).filter(k => k.startsWith('bp_name_asked_')).forEach(k => localStorage.removeItem(k));
            renderDashboard();
            document.getElementById('hq-name-prompt-add').click();   // name_prompt_accepted
            document.getElementById('account-name-input').value = 'Marcus';
            await saveAccountName();
            await clearAccountName();
            closeAccount();
            Object.keys(localStorage).filter(k => k.startsWith('bp_name_asked_')).forEach(k => localStorage.removeItem(k));
            renderDashboard();
            document.getElementById('hq-name-prompt-dismiss').click(); // name_prompt_dismissed
            openAccount(); closeAccount();                             // account_opened
            return { events: _analyticsBuffer.map(e => ({ event: e.event, props: e.props })),
                     raw: JSON.stringify(_analyticsBuffer) };
        });
        expect(r.events.length).toBeGreaterThan(0);
        expect(r.events.map(e => e.event)).toContain('name_prompt_accepted');
        expect(r.raw).not.toContain('Marcus');
        expect(r.raw).not.toContain('marcus.kane');
        expect(r.raw).not.toContain('@example.com');
        for (const e of r.events) {
            for (const v of Object.values(e.props || {})) {
                expect(String(v)).not.toContain('@');
                expect(String(v)).not.toMatch(/Marcus/i);
            }
        }
    }, 30_000);

    test('ACCEPTANCE: no Account action moves the prescription', async () => {
        const r = await app.page.evaluate(async () => {
            const snap = () => { const x = window.BP.nextBestAction(buildResolverInput());
                                 return JSON.stringify({ state: x.state, mission: x.mission,
                                                         duration: x.duration, deload: x.deload }); };
            const before = snap();
            openAccount(); openAccountEditor();
            document.getElementById('account-name-input').value = 'Bruno';
            await saveAccountName();
            const afterSave = snap();
            await clearAccountName();
            const afterClear = snap();
            closeAccount();
            return { before, afterSave, afterClear, difficulty: persisted.difficulty };
        });
        expect(r.afterSave).toBe(r.before);
        expect(r.afterClear).toBe(r.before);
    }, 30_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});

// ───────────────────────────────────────────────────────────────────────────

/**
 * Restraint. The name is allowed in three places and nowhere else: the
 * ordinary greeting, extended-return recognition, and the Coach Tee context.
 * Everything below counts what is actually on screen rather than trusting
 * that nobody added a second use.
 */
describe('how often the name is actually used', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'pp2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Visible occurrences of the name across the HQ and the other surfaces. */
    const census = (page) => page.evaluate((NAME) => {
        const count = (s) => (String(s || '').match(new RegExp(NAME, 'g')) || []).length;
        const seen = (id) => { const e = document.getElementById(id);
                               if (!e) return 0;
                               const hidden = e.classList.contains('hidden') || e.getBoundingClientRect().height === 0;
                               return hidden ? 0 : count(e.innerText); };
        return {
            hq: count(document.getElementById('step-0').innerText),
            greeting: seen('hq-greeting'),
            liveness: seen('today-liveness'),
            todayHeadline: count(document.getElementById('today-headline').innerText),
            todayCard: count(document.getElementById('hq-today-card').innerText),
            statChips: count(document.getElementById('hq-stat-chips').innerText),
            records: count(document.getElementById('hq-records-card').innerText),
            nudgeBand: count(document.getElementById('hq-nudge-band').innerText),
        };
    }, NAME);

    /** The modal and summary surfaces, opened for real. */
    const otherSurfaces = (page) => page.evaluate((NAME) => {
        const count = (s) => (String(s || '').match(new RegExp(NAME, 'g')) || []).length;
        const out = {};
        showWeeklyReport();
        out.weeklyReport = count(document.getElementById('weekly-report-modal').innerText);
        document.getElementById('weekly-report-modal').classList.remove('show');
        openManualAt('manual-top');
        out.manual = count(document.getElementById('manual-modal').innerText);
        closeManual();
        openPassInfo();
        out.recoveryPass = count(document.getElementById('pass-info-modal').innerText);
        closePassInfo();
        out.tierLock = count(document.getElementById('tier-lock-modal').innerText);
        out.milestone = count(document.getElementById('milestone-modal').innerText);
        return out;
    }, NAME);

    /** Finish a session for real and read the summary before closing it. */
    const summaryCensus = (page, routineType) => page.evaluate(({ NAME, routineType }) => {
        const count = (s) => (String(s || '').match(new RegExp(NAME, 'g')) || []).length;
        session.routineType = routineType;
        _sessionStartTime = Date.now() - 30 * 60000;
        selectedEQ = 8; selectedRPE = 5;
        ['input-bpel', 'input-mseg', 'session-note-input'].forEach(id => { document.getElementById(id).value = ''; });
        finishSession();
        const out = { summary: count(document.getElementById('step-4').innerText),
                      records: count(document.getElementById('summary-records').innerText) };
        closeSessionSummary();
        return out;
    }, { NAME, routineType });

    const DAYS = {
        A: { label: 'ordinary TRAIN day', patch: {} },
        B: { label: 'extended-return day', patch: { sessionLog: [{ date: ago(30), routineType: 'length', duration: 30 }] } },
        C: { label: 'Recovery day', patch: {}, soreness: 'high' },
        D: { label: 'Week Complete day', patch: { completedDays: [true, true, true, true, true, true, true] } },
    };

    const counts = {};

    for (const [key, cfg] of Object.entries(DAYS)) {
        test(`${key}. the ${cfg.label}`, async () => {
            await base(app.page, cfg.patch, cfg.soreness ? { soreness: cfg.soreness } : {});
            const hq = await census(app.page);
            const other = await otherSurfaces(app.page);
            counts[key] = { ...hq, ...other };
            // Allowed: the greeting and the extended-return line. Nothing else.
            expect(other.weeklyReport).toBe(0);
            expect(other.manual).toBe(0);
            expect(other.recoveryPass).toBe(0);
            expect(other.tierLock).toBe(0);
            expect(other.milestone).toBe(0);
            expect(hq.todayHeadline).toBe(0);
            expect(hq.statChips).toBe(0);
            expect(hq.records).toBe(0);
            expect(hq.nudgeBand).toBe(0);
            // The Today card may only carry it through the liveness line.
            expect(hq.todayCard).toBe(hq.liveness);
            // And the whole HQ is only ever the greeting plus that line.
            expect(hq.hq).toBe(hq.greeting + hq.liveness);
            expect(hq.hq).toBeLessThanOrEqual(1);   // never twice on one screen
        }, 60_000);
    }

    test('ACCEPTANCE: the session summary never uses it', async () => {
        await base(app.page);
        const mech = await summaryCensus(app.page, 'length');
        expect(mech.summary).toBe(0);
        expect(mech.records).toBe(0);
        await base(app.page);
        const rec = await summaryCensus(app.page, 'recovery');
        expect(rec.summary).toBe(0);      // Recovery Complete is impersonal too
        expect(rec.records).toBe(0);
    }, 60_000);

    test('REPORT: the per-day census', async () => {
        // Printed rather than only asserted, because the brief asks for the
        // actual numbers and a passing assertion does not show them.
        console.log('NAME CENSUS ' + JSON.stringify(counts, null, 1));
        expect(Object.keys(counts)).toHaveLength(4);
    }, 30_000);

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});
