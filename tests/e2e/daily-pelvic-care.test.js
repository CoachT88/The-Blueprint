import { beforeAll, afterAll, beforeEach, describe, test, expect } from 'vitest';
import { openApp, signIn } from './harness.js';

describe('daily pelvic-floor care in the real session engine', () => {
    let app;
    beforeAll(async () => { app=await openApp(); await signIn(app.page,{id:'daily-pelvic'}); },60000);
    afterAll(async () => { await app?.close(); });
    beforeEach(async () => {
        await app.page.evaluate(() => {
            _finishState='idle'; _launchedPrescription=null; _launchLegacyDraft=false;
            persisted.programme=window.__legacyProgramme(); persisted.dayPlans=[];
            persisted.primaryGoal='all'; persisted.pelvicProfile=''; persisted.sessionLog=[];
            persisted.completedDays=Array(7).fill(false);
            persisted.schedule=['rest','length','girth','stamina','rest','length','rest'];
            persisted.schedule[new Date().getDay()]='rest';
            localStorage.removeItem('bp_session_draft_'+currentUser.id);
            goToStep(0);
        });
    });

    test('rest days offer a visible two-minute release without unlocking contractions', async () => {
        await expect(app.page.locator('#daily-pelvic-start').isVisible()).resolves.toBe(true);
        await app.page.locator('#daily-pelvic-start').click();
        const r=await app.page.evaluate(() => ({ex:getCurEx(),blocked:isExerciseBlocked(0),kind:session.routineType}));
        expect(r.ex.title).toBe('Pelvic-floor reset'); expect(r.ex.duration).toBe(120);
        expect(r.ex.sets).toBe(1); expect(r.blocked).toBe(true); expect(r.kind).toBe('recovery');
        await app.page.evaluate(() => { onSetDone(); finishSession(); closeSessionSummary(); });
        const result=await app.page.evaluate(() => ({log:persisted.sessionLog.at(-1),done:dailyPelvicCareDone(),state:currentPrescription().state,week:currentWeekCompletion()}));
        expect(result.log.pelvicCare).toBe(true); expect(result.log.routineType).toBe('recovery');
        expect(result.done).toBe(true); expect(result.state).toBe('REST');
        expect(result.week.completed).toBe(0);
        await expect(app.page.locator('#daily-pelvic-start').isVisible()).resolves.toBe(false);
    });

    test.each(['length','girth','stamina'])('%s reaches release before success and retains its original identity',async mission => {
        const before=await app.page.evaluate(m => {
            persisted.pelvicProfile='tight'; persisted.difficulty='elite';
            persisted.schedule[new Date().getDay()]=m;
            startMission(m,'test'); goToStep(4);
            session.exerciseIndex=executableStepCount()-1;
            session.girthRound=session.girthTotalRounds;
            advanceEx();
            return {step:session.step,ex:getCurEx(),kind:session.routineType,tag:document.getElementById('ex-tag').textContent,button:document.getElementById('ex-btn').textContent};
        },mission);
        expect(before.step).toBe(4); expect(before.kind).toBe(mission);
        expect(before.ex.title).toBe('Pelvic-floor reset'); expect(before.ex.duration).toBe(120);
        expect(before.ex.sets).toBe(1); expect(before.tag).not.toMatch(/Round/); expect(before.button).toMatch(/2-MINUTE/);
        const after=await app.page.evaluate(() => { onSetDone(); finishSession(); return {step:session.step,log:persisted.sessionLog.at(-1)}; });
        expect(after.step).toBe(5); expect(after.log.routineType).toBe(mission); expect(after.log.pelvicCare).toBe(true);
    });

    test('a girth round before the final round does not add release',async () => {
        const r=await app.page.evaluate(() => {
            persisted.pelvicProfile='standard'; startMission('girth','test');goToStep(4);
            session.exerciseIndex=executableStepCount()-1;session.girthRound=1;advanceEx();
            const result={phase:session.dailyPelvicPhase,round:session.girthRound};
            session.timer?.cancel(); session.timer=null; return result;
        });
        expect(r.phase).toBe(false);expect(r.round).toBe(2);
    });

    test('recovery with release does not add a duplicate reset; mobility alone does', async () => {
        const r=await app.page.evaluate(() => {
            selectedRecoveryIndices=[2];startRecoverySession();
            session.setIndex=getCurEx().sets;onSetDone();
            const release={step:session.step,done:session.dailyPelvicDone};
            selectedRecoveryIndices=[5];startRecoverySession();
            session.setIndex=getCurEx().sets;onSetDone();
            return {release,mobility:getCurEx().title};
        });
        expect(r.release).toEqual({step:5,done:true});expect(r.mobility).toBe('Pelvic-floor reset');
    });

    test('leaving and resuming the reset preserves its phase and original mission', async () => {
        const r=await app.page.evaluate(() => {
            persisted.pelvicProfile='standard';startMission('stamina','test');goToStep(4);
            session.exerciseIndex=executableStepCount()-1;advanceEx();goToStep(0);
            const draft=JSON.parse(localStorage.getItem('bp_session_draft_'+currentUser.id));
            resumeSession();return {draft,ex:getCurEx(),kind:session.routineType};
        });
        expect(r.draft.dailyPelvicPhase).toBe(true);expect(r.ex.title).toBe('Pelvic-floor reset');expect(r.kind).toBe('stamina');
    });

    test('morning, afternoon and evening recovery recommendations include pelvic release', async () => {
        const times=await app.page.evaluate(() => RECOVERY_META[2].tod);
        expect(times).toEqual(['morning','afternoon','night']);
    });

    test('a failed account load never offers practice from defaults', async () => {
        await app.page.evaluate(() => { _persistedLoaded=false;renderToday(); });
        await expect(app.page.locator('#daily-pelvic-card').isVisible()).resolves.toBe(false);
        await app.page.evaluate(() => { _persistedLoaded=true; });
        expect(app.errors).toEqual([]);
    });
});
