import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { openApp, signIn, authSignIn } from './harness.js';

/**
 * The Erection Quality website copy, checked against the RUNNING programme.
 *
 * tools/launch/eq-bridge.live.html is the copy that replaces the current
 * #for-erections section when EQ is switched on. It describes a week and the
 * activities in it. This file derives that week and those activities from the
 * actual implementation (the schedule, the routine builder and the daily
 * practice) with the flag flipped inside the page only, and fails when the copy
 * says something the programme does not do. tests/goalBridge.test.js holds the
 * schedule and the gate; this holds the activities.
 */
const LIVE = readFileSync('tools/launch/eq-bridge.live.html', 'utf8')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* The phrase the copy uses for each exercise the programme can show. A title
   with no entry here means the programme gained an exercise the copy does not
   mention: update the copy and this table together. */
const COPY_PHRASE = {
    'Diaphragmatic breathing': /easy breathing at a slow pace/i,
    'Pelvic Floor Release': /pelvic floor release exercise/i,
    'Cat-Cow': /Cat-Cow/,
    'Deep Squat — Malasana': /deep squat/i,
    'Happy Baby': /Happy Baby/,
};

describe('the activation copy describes what the EQ programme actually does', () => {
    let app, facts;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'eqcopy' });
        facts = await app.page.evaluate(() => {
            EQ_SESSIONS_ENABLED = true;                      // in this page only, never persisted
            persisted.primaryGoal = 'eq'; persisted.schedule = goalSchedule('eq').slice();
            persisted.dayPlans = []; persisted.sessionLog = [];
            persisted.programme = {custom: false, migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
            const sunday = new Date(2026, 10, 8);
            const key = (d, weeks = 0) => { const dt = new Date(sunday); dt.setDate(sunday.getDate() + d + 7 * weeks); return window.BP.planDateKey(dt); };
            const week = [];
            for (let d = 0; d < 7; d++) {
                const slot = goalSchedule('eq')[d];
                const isSession = eqSatisfiableDays().includes(d);
                week.push({
                    d, slot, fullRest: isFullRestDate(key(d)), isSession,
                    steps: isSession ? buildEqRoutine(key(d)).map(x => ({title: x.title, sets: x.sets, duration: x.duration})) : null,
                    nextWeekSteps: isSession ? buildEqRoutine(key(d, 1)).map(x => ({title: x.title, sets: x.sets, duration: x.duration})) : null,
                    practice: plannedPelvicItems(key(d), slot).length,
                });
            }
            return {week};
        });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('each session day is breathing, a release exercise and one mobility movement, and the copy names all of them', () => {
        const sessions = facts.week.filter(w => w.isSession);
        expect(sessions.length, 'the copy says three sessions').toBe(3);
        const mobility = new Set();
        for (const s of sessions) {
            expect(s.steps.map(x => x.title).slice(0, 2), 'every session opens with breathing, then release')
                .toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release']);
            expect(s.steps, 'and ends with exactly one mobility movement').toHaveLength(3);
            mobility.add(s.steps[2].title);
            for (const x of s.steps) {
                expect(COPY_PHRASE[x.title], `the programme shows "${x.title}" but the copy does not name it`).toBeDefined();
                expect(LIVE, `the copy no longer names "${x.title}"`).toMatch(COPY_PHRASE[x.title]);
            }
        }
        expect(mobility.size, 'the copy says the movement changes through the week').toBe(3);
    });

    test('the copy says the sessions stay the same from week to week, and they do', () => {
        for (const s of facts.week.filter(w => w.isSession)) expect(s.nextWeekSteps).toEqual(s.steps);
        expect(LIVE).toMatch(/stay the same from week to week/i);
    });

    test('supporting days ask for a practice and full-rest days ask for nothing, as the copy says', () => {
        for (const w of facts.week) {
            if (w.fullRest) expect(w.practice, `day ${w.d} is full rest but asks for something`).toBe(0);
            else if (!w.isSession) expect(w.practice, `day ${w.d} is a supporting day but asks for nothing`).toBeGreaterThan(0);
        }
        expect(facts.week.filter(w => w.fullRest).map(w => w.d)).toEqual([2, 6]);
        expect(LIVE).toMatch(/full rest with nothing asked of you/i);
    });

});

/**
 * THE PAIN SENTENCE, CHECKED AGAINST WHAT THE MEMBER EXPERIENCES.
 *
 * The first version of this copy said that on a pain report the app "pauses the
 * pelvic floor release and keeps the breathing and the movement". It was derived
 * from the routine builder, which does drop the release while pain is
 * unresolved. But the builder is never reached: the moment a member reports
 * pain, Today reads "Pause Training", offers no session of any kind, and the
 * only way forward is the member's own "Symptoms have settled". Running the real
 * buyer journey on staging showed the copy promising more than the app does, so
 * these tests walk the journey a member walks, with the real onboarding, the
 * real comfort question, the real Today card and the real controls, and hold the
 * sentence to what they find.
 *
 * Nothing here relaxes the safety behaviour; it pins it. A change that let a
 * member train through an unresolved pain report fails these.
 */
const SUN = new Date('2026-11-22T10:00:00Z');       // an EQ session day, nothing logged
const WED = new Date('2026-11-25T10:00:00Z');       // the next session day
const PAUSED_SENTENCE = /If you tell the app something hurt, it pauses your training until you tell it your symptoms have settled\./;

async function newEqMember(app) {
    await app.page.evaluate(() => { window.__members = ['new@example.com']; });
    await authSignIn(app.page, { id: 'NEW1', email: 'new@example.com', row: null });
    await app.page.evaluate(async () => {
        EQ_SESSIONS_ENABLED = true;                 // this page only, never persisted
        selectGoal('eq'); finishOnboarding();
        await new Promise(r => setTimeout(r, 1200));
    });
}
/** The first session, finished with the comfort question answered "painful". */
const sessionReportingPain = (page) => page.evaluate(() => {
    document.getElementById('launch-btn').click();
    document.querySelector('#soreness-btns [data-soreness="none"]').click();
    document.querySelector('#sleep-btns [data-sleep="good"]').click();
    document.getElementById('ready-cta').click();
    _sessionStartTime = Date.now() - 6e5; selectedEQ = 8; selectedRPE = 5;
    for (let i = 0; i < 900; i++) {
        if (session.timer) { session.timer.cancel(); session.timer = null; }
        onSetDone();
        if (!document.getElementById('rest-overlay').classList.contains('hidden')) skipRest();
        const s5 = document.getElementById('step-5');
        if (s5 && !s5.classList.contains('hidden-step')) break;
    }
    renderPelvicComfort();
    const asked = !document.getElementById('pelvic-comfort-card').classList.contains('hidden');
    recordPelvicComfort('painful');
    finishSession(); closeSessionSummary();
    return { asked, feedback: persisted.sessionLog.at(-1).pelvicPractice.feedback };
});
/** What Today offers, and what happens when the member tries to start anyway. */
const painExperience = (page) => page.evaluate(() => {
    const shown = (id) => !document.getElementById(id).classList.contains('hidden');
    const txt = (id) => (document.getElementById(id).textContent || '').trim().replace(/\s+/g, ' ');
    const offered = { state: document.getElementById('hq-today-card').dataset.state, headline: txt('today-headline'),
        start: shown('launch-btn'), prepare: shown('today-prepare-btn'), practice: shown('daily-pelvic-start'),
        review: shown('daily-pelvic-review'), reviewLabel: txt('daily-pelvic-review'), note: txt('daily-pelvic-note') };
    goToStep(0);
    startMission('stamina', 'prescribed');
    const afterMission = { step: session.step, routine: session.routineType };
    goToStep(0);
    startDailyPelvicCare(false);
    const afterPractice = { step: session.step };
    goToStep(0);
    return { offered, afterMission, afterPractice };
});

describe('the pain sentence in the activation copy is what a member actually experiences', () => {
    let app, asked, pain, settled, resumed;
    beforeAll(async () => {
        app = await openApp({ row: null, clock: SUN, timezoneId: 'UTC' });
        await newEqMember(app);
        asked = await sessionReportingPain(app.page);
        await app.page.clock.setFixedTime(WED);                  // the next session day
        await app.page.evaluate(() => { goToStep(0); renderDashboard(); });
        pain = await painExperience(app.page);
        // The member says their symptoms have settled.
        settled = await app.page.evaluate(() => {
            document.getElementById('daily-pelvic-review').click();
            const card = document.getElementById('hq-today-card');
            return { state: card.dataset.state, start: !document.getElementById('launch-btn').classList.contains('hidden') };
        });
        resumed = await app.page.evaluate(() => {
            document.getElementById('launch-btn').click();
            document.querySelector('#soreness-btns [data-soreness="none"]').click();
            document.querySelector('#sleep-btns [data-sleep="good"]').click();
            document.getElementById('ready-cta').click();
            const titles = []; let last = '';
            for (let i = 0; i < 300; i++) {
                const ex = getCurEx(); if (ex && ex.title !== last) { titles.push(ex.title); last = ex.title; }
                if (session.timer) { session.timer.cancel(); session.timer = null; }
                onSetDone();
                if (!document.getElementById('rest-overlay').classList.contains('hidden')) skipRest();
                const s5 = document.getElementById('step-5');
                if (s5 && !s5.classList.contains('hidden-step')) break;
            }
            return { routine: session.routineType, titles };
        });
    }, 150_000);
    afterAll(async () => { await app?.close(); });

    test('the comfort question is asked at the end of a session and "painful" is recorded', () => {
        expect(asked).toEqual({ asked: true, feedback: 'painful' });
    });

    test('on the next session day Today says "Pause Training" and offers nothing to start', () => {
        expect(pain.offered.state).toBe('PREPARE');
        expect(pain.offered.headline).toBe('Pause Training');
        expect(pain.offered.start, 'a Start button on a paused day').toBe(false);
        expect(pain.offered.practice, 'a daily practice button on a paused day').toBe(false);
        expect(pain.offered.note).toMatch(/^You reported pain\. Pause pelvic exercises\./);
        expect(pain.offered.note).toMatch(/pelvic-health clinician/);
    });

    test('nothing can be started, not the session, not even the breathing', () => {
        expect(pain.afterMission.step, 'startMission began a session through an unresolved pain report').toBe(0);
        expect(pain.afterPractice.step, 'the daily practice began through an unresolved pain report').toBe(0);
    });

    test('the only way forward is the member\'s own "Symptoms have settled"', () => {
        expect(pain.offered.review).toBe(true);
        expect(pain.offered.reviewLabel).toBe('Symptoms have settled');
        expect(settled).toEqual({ state: 'TRAIN', start: true });
    });

    test('once settled the full session returns, release included', () => {
        expect(resumed.routine).toBe('eq');
        expect(resumed.titles).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Deep Squat — Malasana']);
    });

    // ── The copy says exactly that, and no more ────────────────────────────

    test('the copy says the app pauses training until the member says symptoms have settled', () => {
        expect(LIVE).toMatch(PAUSED_SENTENCE);
        // Held to the app's own words: what Today says it is doing, and the control the member presses.
        expect(pain.offered.headline).toMatch(/pause training/i);
        expect(LIVE).toMatch(/pauses your training/);
        expect(LIVE.toLowerCase()).toContain(pain.offered.reviewLabel.toLowerCase());
    });

    test('and no longer claims the breathing and the movement carry on', () => {
        expect(LIVE).not.toMatch(/pauses the pelvic floor release/i);
        expect(LIVE).not.toMatch(/keeps the breathing/i);
        expect(LIVE).not.toMatch(/and the movement/i);
    });

    test('the safety guidance beside it is intact', () => {
        expect(LIVE).toMatch(/precaution built into the app, not a diagnosis/i);
        expect(LIVE).toMatch(/Persistent pain, urinary symptoms or erection changes need professional evaluation/i);
    });

    test('no uncaught page errors', () => { expect(app.errors).toEqual([]); });
});

describe('the pause is not lost by changing device', () => {
    test('a returning member on a new device is still paused until they say symptoms have settled', async () => {
        const first = await openApp({ row: null, clock: SUN, timezoneId: 'UTC' });
        let row;
        try {
            await newEqMember(first);
            await sessionReportingPain(first.page);
            row = await first.page.evaluate(() => { const p = _buildSavePayload(); p.sync_meta = p._sync_meta; delete p._sync_meta; return { id: 'NEW1', ...p }; });
        } finally { await first.close(); }
        const app = await openApp({ row: null, clock: WED, timezoneId: 'UTC' });
        try {
            await app.page.evaluate(() => {
                EQ_SESSIONS_ENABLED = true; window.__members = ['new@example.com'];
                localStorage.setItem('bp_welcomed_NEW1', '1'); localStorage.setItem('bp_onboarded_NEW1', '1');
            });
            await authSignIn(app.page, { id: 'NEW1', email: 'new@example.com', row });
            await app.page.waitForTimeout(600);
            const r = await painExperience(app.page);
            expect(r.offered.state).toBe('PREPARE');
            expect(r.offered.headline).toBe('Pause Training');
            expect(r.offered.review).toBe(true);
            expect(r.afterMission.step).toBe(0);
            expect(r.afterPractice.step).toBe(0);
        } finally { await app.close(); }
    }, 120_000);
});
