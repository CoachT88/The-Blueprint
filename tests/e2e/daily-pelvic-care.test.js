import {beforeAll,afterAll,beforeEach,describe,test,expect} from 'vitest';
import {openApp,signIn} from './harness.js';

describe('prescribed pelvic practice in the real app',()=>{
 let app;
 beforeAll(async()=>{app=await openApp();await signIn(app.page,{id:'daily-pelvic'});},60000);
 afterAll(async()=>{await app?.close();});
 beforeEach(async()=>{await app.page.evaluate(()=>{
  _finishState='idle';_launchedPrescription=null;_launchLegacyDraft=false;
  persisted.programme=window.__legacyProgramme();persisted.dayPlans=[];persisted.primaryGoal='all';persisted.pelvicProfile='';persisted.sessionLog=[];
  persisted.completedDays=Array(7).fill(false);persisted.schedule=['rest','length','girth','stamina','rest','length','rest'];persisted.schedule[new Date().getDay()]='rest';
  localStorage.removeItem('bp_session_draft_'+currentUser.id);goToStep(0);
 });});
 const finishPractice=()=>app.page.evaluate(()=>{
  const titles=[];let guard=0;
  while(session.dailyPelvicPhase&&guard++<10){titles.push(getCurEx().title);session.setIndex=getCurEx().sets;onSetDone();}
  return {titles,step:session.step};
 });
 test('rest days assign breathing, release and one mobility exercise, with separate completion',async()=>{
  await app.page.locator('#daily-pelvic-start').click();
  expect(await app.page.evaluate(()=>getCurEx().title)).toBe('Diaphragmatic breathing');
  const r=await finishPractice();expect(r.step).toBe(5);expect(r.titles).toHaveLength(3);expect(r.titles[1]).toBe('Reverse Kegel Stretch');
  await app.page.evaluate(()=>{recordPelvicComfort('comfortable');finishSession();closeSessionSummary();});
  const out=await app.page.evaluate(()=>({log:persisted.sessionLog.at(-1),done:dailyPelvicCareDone(),state:currentPrescription().state,week:currentWeekCompletion()}));
  expect(out.log.workKind).toBe('dailyPractice');expect(out.log.pelvicPractice.feedback).toBe('comfortable');expect(out.done).toBe(true);expect(out.state).toBe('REST');expect(out.week.completed).toBe(0);
  await expect(app.page.locator('#daily-pelvic-start').isVisible()).resolves.toBe(false);
 });
 test.each(['length','girth','stamina'])('%s keeps its mission and gets a short breathing/release tail',async mission=>{
  const r=await app.page.evaluate(m=>{persisted.pelvicProfile='tight';persisted.difficulty='elite';persisted.schedule[new Date().getDay()]=m;startMission(m,'test');goToStep(4);session.exerciseIndex=executableStepCount()-1;session.girthRound=session.girthTotalRounds;advanceEx();return {step:session.step,ex:getCurEx(),kind:session.routineType};},mission);
  expect(r.step).toBe(4);expect(r.kind).toBe(mission);expect(r.ex.duration).toBe(120);expect(r.ex.sets).toBe(1);
  expect((await finishPractice()).titles).toEqual(['Diaphragmatic breathing','Reverse Kegel Stretch']);
  await app.page.evaluate(()=>finishSession());const log=await app.page.evaluate(()=>persisted.sessionLog.at(-1));expect(log.routineType).toBe(mission);expect(log.pelvicCare).toBe(true);expect(log.workKind).toBeUndefined();
 });
 test('a two-minute practice before training leaves the primary task due and is not repeated after training',async()=>{
  await app.page.evaluate(()=>{persisted.pelvicProfile='standard';persisted.schedule[new Date().getDay()]='length';renderDashboard();});
  await app.page.locator('#daily-pelvic-busy').click();expect((await finishPractice()).titles).toEqual(['Diaphragmatic breathing']);
  await app.page.evaluate(()=>{finishSession();closeSessionSummary();});
  expect(await app.page.evaluate(()=>persisted.sessionLog.at(-1).manualOverride)).toBe(false);
  expect(await app.page.evaluate(()=>currentPrescription().state)).toBe('TRAIN');expect(await app.page.evaluate(()=>currentWeekCompletion().completed)).toBe(0);
  const r=await app.page.evaluate(()=>{startMission('length','test');goToStep(4);session.exerciseIndex=executableStepCount()-1;advanceEx();return {phase:session.dailyPelvicPhase,step:session.step};});expect(r).toEqual({phase:false,step:5});
 });
 test('a completed foundation on a recovery day does not invite the same practice again',async()=>{
  await app.page.evaluate(()=>{persisted.schedule[new Date().getDay()]='length';localStorage.setItem(getTodaySorenessKey(),'high');renderDashboard();});
  await app.page.locator('#daily-pelvic-busy').click();await finishPractice();await app.page.evaluate(()=>{finishSession();closeSessionSummary();});
  await expect(app.page.locator('#launch-btn').isVisible()).resolves.toBe(false);
  expect(await app.page.locator('#today-headline').textContent()).toBe('Recovery Practice Complete');
  expect(await app.page.evaluate(()=>currentWeekCompletion().completed)).toBe(0);
  await app.page.evaluate(()=>localStorage.removeItem(getTodaySorenessKey()));
 });
 test('a girth round before the final round never adds daily practice',async()=>{
  const r=await app.page.evaluate(()=>{persisted.pelvicProfile='standard';startMission('girth','test');goToStep(4);session.exerciseIndex=executableStepCount()-1;session.girthRound=1;advanceEx();const r={phase:session.dailyPelvicPhase,round:session.girthRound};session.timer?.cancel();session.timer=null;return r;});expect(r.phase).toBe(false);expect(r.round).toBe(2);
 });
 test('a recovery session that already includes breathing and release receives only remaining daily work',async()=>{
  const r=await app.page.evaluate(()=>{persisted.schedule[new Date().getDay()]='length';selectedRecoveryIndices=[8,1];startRecoverySession();session.setIndex=getCurEx().sets;onSetDone();session.setIndex=getCurEx().sets;onSetDone();return {step:session.step,done:session.dailyPelvicDone,covered:session.practiceCompletedIndices};});expect(r.step).toBe(5);expect(r.done).toBe(true);expect(r.covered).toEqual([8,1]);
 });
 test('leaving and resuming preserves the practice plan and current position',async()=>{
  const r=await app.page.evaluate(()=>{persisted.pelvicProfile='standard';startDailyPelvicCare(false);onSetDone();const before=getCurEx().title;goToStep(0);const draft=JSON.parse(localStorage.getItem('bp_session_draft_'+currentUser.id));resumeSession();return {before,after:getCurEx().title,draft,kind:session.routineType};});expect(r.before).toBe('Pelvic Floor Release');expect(r.after).toBe(r.before);expect(r.draft.pelvicPracticeIndex).toBe(1);expect(r.kind).toBe('recovery');
 });
 test('increased tension reduces the next assignment without increasing strength volume',async()=>{
  await app.page.locator('#daily-pelvic-busy').click();await finishPractice();await app.page.evaluate(()=>{recordPelvicComfort('tense');finishSession();closeSessionSummary();});
  const r=await app.page.evaluate(()=>({plan:currentPelvicPracticePlan(),strengthBlocked:isExerciseBlocked(0)}));expect(r.plan.mode).toBe('foundation');expect(r.plan.steps).toHaveLength(1);expect(r.strengthBlocked).toBe(true);
 });
 test('pain feedback holds primary training and resumes gentle breathing only after symptoms settle',async()=>{
  await app.page.evaluate(()=>{persisted.pelvicProfile='standard';persisted.schedule[new Date().getDay()]='length';renderDashboard();});
  await app.page.locator('#daily-pelvic-busy').click();await finishPractice();await app.page.evaluate(()=>{recordPelvicComfort('painful');finishSession();closeSessionSummary();});
  expect(await app.page.evaluate(()=>currentPrescription().prepare)).toBe('pelvic-pain');
  await app.page.locator('#daily-pelvic-review').click();const r=await app.page.evaluate(()=>currentPelvicPracticePlan());expect(r.mode).toBe('foundation');expect(r.steps.map(x=>x.id)).toEqual(['breathing']);
 });
 test('contraction blocks alternate short lifts and full release rather than a minute-long hold',async()=>{
  const r=await app.page.evaluate(()=>({start:pelvicRhythmCue(ROUTINES.recovery[3],60),release:pelvicRhythmCue(ROUTINES.recovery[3],55),next:pelvicRhythmCue(ROUTINES.recovery[3],50),sets:ROUTINES.recovery[3].sets}));expect(r.start).toMatch(/lift/i);expect(r.release).toMatch(/release/i);expect(r.next).toMatch(/lift/i);expect(r.sets).toBe(1);
 });
 test('failed account loading cannot launch practice',async()=>{
  await app.page.evaluate(()=>{_persistedLoaded=false;renderToday();startDailyPelvicCare();});await expect(app.page.locator('#daily-pelvic-card').isVisible()).resolves.toBe(false);await app.page.evaluate(()=>{_persistedLoaded=true;});expect(app.errors).toEqual([]);
 });
});
