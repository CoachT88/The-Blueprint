import {beforeAll,afterAll,beforeEach,describe,test,expect} from 'vitest';
import {openApp,signIn} from './harness.js';

describe('the guided session uses real execution and completion',()=>{
 let app;
 beforeAll(async()=>{
  app=await openApp();await signIn(app.page,{id:'guided'});
  await app.page.evaluate(()=>{
   window.__spoken=[];window.__cancels=0;
   Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
   Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speak:u=>window.__spoken.push(u),cancel:()=>window.__cancels++}});
  });
 },60000);
 afterAll(async()=>{await app?.close();});
 beforeEach(async()=>{await app.page.evaluate(()=>{
  session._aborting=true;goToStep(0);session._aborting=false;
  _finishState='idle';_launchedPrescription=null;_launchLegacyDraft=false;
  _guideSpeech=null;_guideAudioUser=null;_guideActive=false;window.__spoken=[];window.__cancels=0;
  window.speechSynthesis.speak=u=>window.__spoken.push(u);
  localStorage.removeItem('bp_guide_audio_'+currentUser.id);
  localStorage.removeItem('bp_session_draft_'+currentUser.id);localStorage.removeItem(getTodaySorenessKey());
  persisted.programme=window.__legacyProgramme();persisted.dayPlans=[];persisted.primaryGoal='all';persisted.pelvicProfile='';persisted.sessionLog=[];
  persisted.schedule=Array(7).fill('rest');persisted.completedDays=Array(7).fill(false);
  persisted.seenMilestones=MILESTONES.map(x=>x.id);localStorage.setItem('bp_push_prompted_'+currentUser.id,'1');
  document.getElementById('milestone-modal').classList.remove('show');document.getElementById('session-summary-modal').classList.remove('show');
  goToStep(0);startDailyPelvicCare(true);
 });});
 test('the prescribed practice opens with a setup cue, visible controls, and audio off',async()=>{
  expect(await app.page.locator('#ex-cue-text').textContent()).toMatch(/comfortable position/i);
  expect(await app.page.locator('#guide-technique').getAttribute('open')).toBeNull();
  expect(await app.page.locator('#guide-audio-btn').getAttribute('aria-pressed')).toBe('false');
  await app.page.locator('#ex-btn').click();
  const r=await app.page.evaluate(()=>({running:session.timer.isRunning(),duration:getCurEx().duration,sets:getCurEx().sets,spoken:window.__spoken.length}));
  expect(r).toEqual({running:true,duration:120,sets:1,spoken:0});
 });
 test('audio requires a tap, does not repeat on every tick, and cancels when paused or left',async()=>{
  await app.page.locator('#guide-audio-btn').click();await app.page.locator('#ex-btn').click();
  const before=await app.page.evaluate(()=>window.__spoken.length);expect(before).toBeGreaterThan(0);
  await app.page.evaluate(()=>{for(let i=0;i<20;i++)updateActiveCue(document.getElementById('ex-cue-text').textContent);});
  expect(await app.page.evaluate(()=>window.__spoken.length)).toBe(before);
  await app.page.locator('#ex-pause-btn').click();
  const paused=await app.page.evaluate(()=>({running:session.timer.isRunning(),cancels:window.__cancels}));
  expect(paused.running).toBe(false);expect(paused.cancels).toBeGreaterThan(0);
  await app.page.evaluate(()=>updateActiveCue('Do not speak while paused.'));
  expect(await app.page.evaluate(()=>window.__spoken.length)).toBe(before);
  await app.page.locator('#ex-pause-btn').click();expect(await app.page.evaluate(()=>session.timer.isRunning())).toBe(true);
  const cancels=await app.page.evaluate(()=>window.__cancels);await app.page.locator('#ex-home-btn').click();
  expect(await app.page.evaluate(()=>window.__cancels)).toBeGreaterThan(cancels);
  expect(await app.page.evaluate(()=>session.step)).toBe(0);
 });
 test('an unavailable voice cannot block the timer or on-screen instruction',async()=>{
  await app.page.evaluate(()=>{window.speechSynthesis.speak=()=>{throw Error('voice unavailable')};});
  await app.page.locator('#guide-audio-btn').click();await app.page.locator('#ex-btn').click();
  expect(await app.page.evaluate(()=>session.timer.isRunning())).toBe(true);
  expect(await app.page.locator('#guide-status').textContent()).toMatch(/unavailable/i);
  expect(await app.page.locator('#guide-audio-btn').getAttribute('aria-pressed')).toBe('false');
  expect((await app.page.locator('#ex-cue-text').textContent()).length).toBeGreaterThan(5);
 });
 test('technique can be opened during a set without stopping or changing its dose',async()=>{
  await app.page.locator('#ex-btn').click();await app.page.locator('#ex-info-btn').click();
  expect(await app.page.locator('#guide-technique').getAttribute('open')).not.toBeNull();
  await expect.poll(()=>app.page.locator('#ex-info-panels').isVisible()).toBe(true);
  expect(await app.page.evaluate(()=>({running:session.timer.isRunning(),duration:getCurEx().duration}))).toEqual({running:true,duration:120});
 });
 test('completion saves once with optional details collapsed and keeps daily practice separate',async()=>{
  await app.page.evaluate(()=>{session.setIndex=getCurEx().sets;onSetDone();});
  expect(await app.page.locator('#guided-success-title').textContent()).toBe('Practice finished');
  expect(await app.page.locator('#session-extra-details').getAttribute('open')).toBeNull();
  expect(await app.page.locator('#finish-session-btn').isVisible()).toBe(true);
  await app.page.locator('[data-pelvic-comfort="comfortable"]').click();await app.page.locator('#finish-session-btn').click();
  const r=await app.page.evaluate(()=>{finishSession();return {count:persisted.sessionLog.length,log:persisted.sessionLog[0],week:currentWeekCompletion().completed};});
  expect(r.count).toBe(1);expect(r.log.workKind).toBe('dailyPractice');expect(r.log.pelvicPractice.feedback).toBe('comfortable');expect(r.week).toBe(0);
 });
 test('optional notes remain available before saving',async()=>{
  await app.page.evaluate(()=>{session.setIndex=getCurEx().sets;onSetDone();});
  await app.page.locator('#session-extra-details summary').click();
  await app.page.locator('#session-note-input').fill('Breathing felt comfortable.');
  await app.page.locator('#finish-session-btn').click();
  expect(await app.page.evaluate(()=>persisted.sessionLog[0].note)).toBe('Breathing felt comfortable.');
 });
});
