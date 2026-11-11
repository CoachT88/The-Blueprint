import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Finishing an EQ session must not ask the member to repeat it.
 *
 * THE DEFECT. An EQ session is breathing, a pelvic floor release and one
 * mobility movement. The app also owes every member a short daily pelvic
 * practice: breathing plus a release exercise. advanceEx() recorded completed
 * practice steps only for the recovery routine and during the daily phase, so
 * an EQ session recorded none, the plan looked untouched, and the app ran the
 * daily practice again straight after the last EQ step: breathing twice and a
 * second release exercise. The member can only reach the summary, where the
 * completion is recorded, by going through that repeat.
 *
 * THE RULE. What an EQ session did counts toward the daily practice. Breathing
 * is breathing. The release exercises (Reverse Kegel Stretch and Pelvic Floor
 * Release) do the same job, and an EQ session always includes one, so either
 * satisfies the plan's release step. Anything the session did not cover is
 * still offered. Only the EQ routine is affected: Size, Stamina, All of It and
 * the recovery picker are asserted unchanged at the bottom.
 *
 * The flag is flipped inside the page only. The shipped value stays false.
 */
describe('an EQ session does not repeat the daily pelvic practice', () => {
    let app;
    beforeAll(async () => { app = await openApp({ clock: '2026-11-08T10:00:00' }); }, 60_000);   // a Sunday
    afterAll(async () => { await app?.close(); });
    beforeEach(async () => { await signIn(app.page, { id: 'eqdone' + Math.random().toString(36).slice(2, 7) }); });

    /** Put the member on the EQ week, with the given pelvic profile and an optional earlier comfort answer. */
    const setup = (profile = '', feedback = '') => app.page.evaluate(({ profile, feedback }) => {
        EQ_SESSIONS_ENABLED = true;
        persisted.primaryGoal = 'eq'; persisted.schedule = goalSchedule('eq').slice(); persisted.dayPlans = [];
        persisted.programme = { custom: false, migration: { source: 'preset' }, adoptedAt: '2026-01-01T00:00:00.000Z' };
        persisted.pelvicProfile = profile; persisted.totalXp = 0; persisted.allTimeSessionCount = 0;
        persisted.sessionLog = feedback ? [{ date: '2026-11-07T10:00:00.000Z', routineType: 'recovery', pelvicCare: true,
            pelvicPractice: { v: 1, date: '2026-11-07', mode: 'daily', completedIndices: [8, 1], feedback } }] : [];
        try { localStorage.clear(); } catch (e) {}
    }, { profile, feedback });

    /**
     * Do the work the way a member does: finish each set, skip the rests, and
     * stop at the first of (the summary screen, the daily practice starting).
     * `stopAfter` ends the run once that many EQ exercises are done.
     */
    const run = (opts = {}) => app.page.evaluate(({ stopAfter }) => {
        const trace = [];
        let done = 0, last = '';
        for (let i = 0; i < 60; i++) {
            const ex = getCurEx();
            const sig = `${session.dailyPelvicPhase ? 'DAILY' : 'EQ'}|${ex && ex.title}`;
            if (sig !== last) { trace.push(sig); last = sig; }
            if (session.timer) { session.timer.cancel(); session.timer = null; }
            const before = session.exerciseIndex + '|' + session.dailyPelvicPhase;
            onSetDone();
            if (!document.getElementById('rest-overlay').classList.contains('hidden')) skipRest();
            const s5 = document.getElementById('step-5');
            if (s5 && !s5.classList.contains('hidden-step')) { trace.push('SUMMARY'); break; }
            if (session.exerciseIndex + '|' + session.dailyPelvicPhase !== before && !session.dailyPelvicPhase) done++;
            if (stopAfter && done >= stopAfter) { trace.push('STOPPED'); break; }
        }
        return { trace, daily: session.dailyPelvicPhase, done: session.dailyPelvicDone, indices: [...session.practiceCompletedIndices] };
    }, { stopAfter: opts.stopAfter || 0 });
    const start = () => app.page.evaluate(() => { startMission('stamina', 'prescribed'); _sessionStartTime = Date.now() - 6e5; selectedEQ = 8; selectedRPE = 5; return session.routineType; });
    const finish = () => app.page.evaluate(() => { finishSession(); closeSessionSummary(); const e = persisted.sessionLog.at(-1); return { entry: e, n: persisted.sessionLog.length, xp: persisted.totalXp, count: persisted.allTimeSessionCount }; });

    // ── The member is not asked to repeat anything ─────────────────────────

    test.each([['no screened profile', ''], ['standard profile', 'standard'], ['tight profile', 'tight']])(
        'after the last EQ step the member reaches the summary (%s)', async (_n, profile) => {
            await setup(profile);
            expect(await start()).toBe('eq');
            const r = await run();
            expect(r.trace).toEqual(['EQ|Diaphragmatic breathing', 'EQ|Pelvic Floor Release', expect.stringMatching(/^EQ\|/), 'SUMMARY']);
            expect(r.trace.some(t => t.startsWith('DAILY')), 'the daily practice was repeated').toBe(false);
            expect(r.daily).toBe(false);
            expect(r.done, 'the daily practice must count as done').toBe(true);
            expect(r.indices).toEqual(expect.arrayContaining([8, 2]));    // what was actually performed
        });

    test('a foundation day (gentle breathing only) is satisfied by the EQ breathing', async () => {
        await setup('', 'tense');
        await start();
        const r = await run();
        expect(r.trace.some(t => t.startsWith('DAILY'))).toBe(false);
        expect(r.trace.at(-1)).toBe('SUMMARY');
        expect(r.done).toBe(true);
    });

    // ── One record, one reward, and an honest account of what was done ─────

    test('the finished session is one record: practice counted, XP and count once', async () => {
        await setup();
        await start(); await run();
        const f = await finish();
        expect(f.n, 'one completion, not two').toBe(1);
        expect(f.entry.routineType).toBe('eq');
        expect(f.entry.pelvicCare, 'today\'s daily practice is recorded as done').toBe(true);
        expect(f.entry.pelvicPractice.mode).toBe('daily');
        expect(f.entry.pelvicPractice.completedIndices, 'the practice actually performed, not a repeat').toEqual([8, 2]);
        expect(f.count).toBe(1);
        expect(f.xp, 'XP awarded once').toBe(f.entry.xpEarned);
        expect(await app.page.evaluate(() => dailyPelvicCareDone())).toBe(true);
    });

    // ── The comfort question and its safety behaviour are intact ───────────

    test('the comfort question is still asked, and "painful" still pauses the release', async () => {
        await setup();
        await start(); await run();
        expect(await app.page.evaluate(() => !document.getElementById('pelvic-comfort-card').classList.contains('hidden')
            || (renderPelvicComfort(), !document.getElementById('pelvic-comfort-card').classList.contains('hidden')))).toBe(true);
        await app.page.evaluate(() => recordPelvicComfort('painful'));
        const f = await finish();
        expect(f.entry.pelvicPractice.feedback).toBe('painful');
        const after = await app.page.evaluate(() => ({
            review: pelvicPracticeNeedsReview(),
            titles: buildEqRoutine('2026-11-15').map(x => x.title),
            plan: window.BP.buildPelvicPracticePlan({ date: '2026-11-15', dayKind: 'primary', profile: '', feedback: 'painful', painCleared: false }),
        }));
        expect(after.review).toBe(true);
        expect(after.titles).not.toContain('Pelvic Floor Release');
        expect(after.titles).toContain('Diaphragmatic breathing');
        expect(after.plan.mode).toBe('paused');
    });

    // ── Anything the EQ session did not cover is still offered ─────────────

    test('a daily step the EQ session did not cover is still offered, and only that step', async () => {
        await setup();
        await start();
        // A plan with a mobility step as well, which the builder only produces on a rest day. It makes the
        // point directly: breathing and release are covered; the squat is not.
        await app.page.evaluate(() => {
            session.pelvicPracticePlan = window.BP.normalisePelvicPracticePlan({ v: 1, date: '2026-11-08', mode: 'daily', steps: [
                { id: 'breathing', index: 8, sets: 1, duration: 120, restDur: 0 },
                { id: 'reverseRelease', index: 1, sets: 1, duration: 45, restDur: 0 },
                { id: 'squat', index: 4, sets: 2, duration: 45, restDur: 20 }] });
        });
        const r = await run();
        expect(r.trace.filter(t => t.startsWith('DAILY'))).toEqual(['DAILY|Deep Squat — Malasana']);
        expect(r.trace.at(-1)).toBe('SUMMARY');
        expect(r.indices).toEqual(expect.arrayContaining([8, 2, 4]));
    });

    // ── Refreshing, reopening ──────────────────────────────────────────────

    test('leaving mid-session and resuming keeps what was done: still no repeat', async () => {
        await setup();
        await start();
        const part = await run({ stopAfter: 2 });                       // breathing and release done
        expect(part.indices).toEqual(expect.arrayContaining([8, 2]));
        const saved = await app.page.evaluate(() => { session.step = 4; goToStep(0);
            return JSON.parse(localStorage.getItem('bp_session_draft_' + currentUser.id)); });
        expect(saved.practiceCompletedIndices, 'the draft carries what was done').toEqual(expect.arrayContaining([8, 2]));
        await app.page.evaluate(() => { resetSession(); resumeSession(); });
        const resumed = await app.page.evaluate(() => ({ routine: session.routineType, idx: [...session.practiceCompletedIndices] }));
        expect(resumed.routine).toBe('eq');
        expect(resumed.idx).toEqual(expect.arrayContaining([8, 2]));
        const rest = await run();
        expect(rest.trace.some(t => t.startsWith('DAILY')), 'repeated after resuming').toBe(false);
        expect(rest.trace.at(-1)).toBe('SUMMARY');
    });

    test('reopening the app after the session: today\'s daily practice is not offered again', async () => {
        await setup();
        await start(); await run(); await finish();
        const r = await app.page.evaluate(() => ({ done: dailyPelvicCareDone(), plan: session.pelvicPracticePlan, next: (resetSession(), session.pelvicPracticePlan) }));
        expect(r.done).toBe(true);
        expect(r.next, 'a fresh session after the EQ session must not owe the practice again').toBeNull();
    });

    // ── Nothing else moved ─────────────────────────────────────────────────

    /* The equivalence is for the EQ routine and nothing else. The same inputs, a plan of breathing plus Reverse Kegel
       Stretch and a member who has done breathing plus Pelvic Floor Release, give a different answer per routine. */
    const remaining = (routine) => app.page.evaluate((routine) => {
        resetSession(); session.routineType = routine;
        session.pelvicPracticePlan = window.BP.normalisePelvicPracticePlan({ v: 1, date: '2026-11-08', mode: 'daily', steps: [
            { id: 'breathing', index: 8, sets: 1, duration: 120, restDur: 0 },
            { id: 'reverseRelease', index: 1, sets: 1, duration: 45, restDur: 0 }] });
        session.practiceCompletedIndices = [8, 2];
        return { started: startRemainingPelvicPractice(), idx: session.pelvicPracticeIndex, done: session.dailyPelvicDone };
    }, routine);

    test('EQ: breathing plus Pelvic Floor Release satisfies breathing plus Reverse Kegel Stretch', async () => {
        await setup();
        expect(await remaining('eq')).toEqual({ started: false, idx: 0, done: true });
    });

    test.each([['length'], ['stamina'], ['girth'], ['recovery']])(
        '%s is unchanged: the two release exercises are NOT treated as equivalent, so the plan still asks for the missing step', async (routine) => {
            await setup();
            expect(await remaining(routine)).toEqual({ started: true, idx: 1, done: false });   // asks for the release step only
        });

    test.each([['length'], ['stamina'], ['girth']])('a %s session with nothing recorded still owes the whole daily practice', async (routine) => {
        await setup();
        const r = await app.page.evaluate((routine) => {
            resetSession(); session.routineType = routine;
            session.pelvicPracticePlan = window.BP.normalisePelvicPracticePlan({ v: 1, date: '2026-11-08', mode: 'daily', steps: [
                { id: 'breathing', index: 8, sets: 1, duration: 120, restDur: 0 },
                { id: 'reverseRelease', index: 1, sets: 1, duration: 45, restDur: 0 }] });
            return { started: startRemainingPelvicPractice(), idx: session.pelvicPracticeIndex };
        }, routine);
        expect(r).toEqual({ started: true, idx: 0 });
    });
});
