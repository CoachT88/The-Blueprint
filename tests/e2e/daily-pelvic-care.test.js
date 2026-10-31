import {beforeAll,afterAll,beforeEach,describe,test,expect} from 'vitest';
import {openApp,signIn} from './harness.js';

describe('prescribed pelvic practice in the real app',()=>{
 let app;
 beforeAll(async()=>{app=await openApp();await signIn(app.page,{id:'daily-pelvic'});},60000);
 afterAll(async()=>{await app?.close();});
 beforeEach(async()=>{await app.page.evaluate(()=>{
  session._aborting=true;goToStep(0);session._aborting=false;
  _finishState='idle';_launchedPrescription=null;_launchLegacyDraft=false;
  document.getElementById('milestone-modal').classList.remove('show');
  document.getElementById('session-summary-modal').classList.remove('show');
  document.getElementById('notif-modal').classList.add('hidden');
  persisted.seenMilestones=MILESTONES.map(m=>m.id);
  localStorage.setItem('bp_push_prompted_'+currentUser.id,'1');
  localStorage.removeItem(getTodaySorenessKey());
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
  expect(await app.page.evaluate(()=>persisted.sessionLog.at(-1).trainingRestSatisfied)).toBe(true);
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
 /* PAIN HAS TO BE LEGIBLE, AND THE BLOCK HAS TO HOLD.
    Two separate claims, because the first version of this block ran them
    together and got both wrong. What a member can actually reach is pinned
    by 'NO VISIBLE CONTROL REACHES MISSION SELECT' below; everything else
    here drives the guard directly and says so where it does. */
 const reportPain=()=>app.page.evaluate(()=>{
  persisted.pelvicProfile='standard';persisted.schedule[new Date().getDay()]='length';
  /* The legacy day flag too, or a test that finished a real session first
     leaves today satisfied and this returns COMPLETE instead of PREPARE. */
  persisted.completedDays=Array(7).fill(false);
  persisted.sessionLog=[{date:new Date().toISOString(),routineType:'recovery',pelvicPractice:{feedback:'painful'}}];
  try{localStorage.removeItem(pelvicReviewKey());}catch{}
  renderDashboard();
 });

 /* THE ORDINARY WAY A DAY ENDS IN PAIN, and the one the first version of
    this file never built. Train the session the schedule asked for, do the
    pelvic practice that is included in it, answer the comfort question with
    "painful", finish. That writes ONE log entry which both satisfies today's
    primary and leaves pain unresolved, so the resolver returns COMPLETE
    rather than PREPARE. Nothing is hand-written into sessionLog here: the
    member's own actions produce the state. */
 const finishPainfulLengthDay=()=>app.page.evaluate(()=>{
  persisted.pelvicProfile='tight';persisted.difficulty='elite';
  persisted.schedule[new Date().getDay()]='length';
  startMission('length','test');goToStep(4);
  session.exerciseIndex=executableStepCount()-1;session.girthRound=session.girthTotalRounds;advanceEx();
  let guard=0;while(session.dailyPelvicPhase&&guard++<10){session.setIndex=getCurEx().sets;onSetDone();}
  recordPelvicComfort('painful');
  finishSession();closeSessionSummary();
  session.timer?.cancel();session.timer=null;
 });
 const visible=()=>app.page.evaluate(()=>{
  const v=id=>{const el=document.getElementById(id);
   return el?!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length):'MISSING';};
  const r=currentPrescription();
  return {state:r.state,prepare:r.prepare,needsReview:pelvicPracticeNeedsReview(),
   card:v('daily-pelvic-card'),review:v('daily-pelvic-review'),
   start:v('daily-pelvic-start'),busy:v('daily-pelvic-busy'),
   alt:v('today-alt-btn'),warmupBack:v('warmup-back-btn'),
   recoveryBack:v('recovery-back-btn'),exBack:v('ex-back-btn'),
   launch:v('launch-btn'),resume:v('resume-btn'),
   note:document.getElementById('daily-pelvic-note').textContent,
   headline:document.getElementById('today-headline').textContent,
   text:document.getElementById('step-0').innerText,
   logs:(persisted.sessionLog||[]).length,
   draft:localStorage.getItem('bp_session_draft_'+currentUser.id)};
 });

 test('A DAY THAT ENDED IN PAIN STILL SAYS SO, AND STILL OFFERS THE WAY OUT',async()=>{
  await finishPainfulLengthDay();
  const r=await visible();
  /* The state really is the closed-day one, so this is not quietly testing
     the PREPARE path again. */
  expect(r.state).toBe('COMPLETE');
  expect(r.needsReview).toBe(true);
  expect(r.headline).toBe('Today Is Done');
  /* On screen, in words. The resolver state and a data attribute are not an
     explanation; this asserts what a member can read. */
  expect(r.card,'the pelvic card was suppressed on a finished day').toBe(true);
  expect(r.text).toMatch(/You reported pain/i);
  expect(r.text).toMatch(/pelvic-health clinician/i);
  expect(r.note).toMatch(/Pause pelvic exercises/i);
  /* The only action offered is the one that resolves it. Nothing startable
     appears, which is what keeps this a presentation change. */
  expect(r.review,'the self-clear control was unreachable').toBe(true);
  expect(r.start,'a practice was offered to a member in pain').toBe(false);
  expect(r.busy).toBe(false);
  expect(app.errors).toEqual([]);
 },60000);

 test('and a mechanical mission driven on that finished day starts nothing and changes nothing',async()=>{
  await finishPainfulLengthDay();
  const before=await visible();
  await app.page.evaluate(()=>{goToStep(3);startMission('length','test');});
  const r=await visible();
  expect(r.state).toBe('COMPLETE');
  expect(await app.page.evaluate(()=>session.step),'a session started').toBe(0);
  expect(r.logs,'member data was mutated').toBe(before.logs);
  expect(r.draft,'a draft was written').toBeNull();
  expect(r.text).toMatch(/You reported pain/i);
  expect(r.review).toBe(true);
  expect(app.errors).toEqual([]);
 },60000);

 test('NO VISIBLE CONTROL REACHES MISSION SELECT WHILE PAIN IS UNRESOLVED',async()=>{
  /* The claim the startMission() comment used to make the other way round.
     Mission Select has four entrances: "Something else", which renders only
     on TRAIN and MODIFIED, and the back buttons out of warmup, the exercise
     engine and the recovery picker, none of which a member in pain can be
     standing in because every start path refuses first. If a future change
     opens one of them, this fails and the guard behind it stops being
     theoretical. Both pain states are checked, because they present
     differently.

     IT MEASURES PIXELS, NOT CLASS NAMES, and mutation testing is why. On
     COMPLETE the action row is hidden twice: renderToday() withholds the
     class and a CSS rule on [data-state="COMPLETE"] sets display:none. A
     test reading the `hidden` class would have called the JS gate the only
     protection and failed to notice the second one; offering "Something
     else" on COMPLETE in the JS alone changes nothing a member can see, and
     this correctly stays green for it. Opening a state the CSS does not
     cover does turn it red. */
  await finishPainfulLengthDay();
  const done=await visible();
  expect(done.state).toBe('COMPLETE');
  await reportPain();
  const prep=await visible();
  expect(prep.prepare).toBe('pelvic-pain');
  for(const r of [done,prep]){
   expect(r.alt,'"Something else" reached Mission Select').toBe(false);
   expect(r.warmupBack).toBe(false);
   expect(r.recoveryBack).toBe(false);
   expect(r.exBack).toBe(false);
   expect(r.launch).toBe(false);
   expect(r.resume).toBe(false);
  }
 },60000);

 test('clearing symptoms on a finished day puts the card away again',async()=>{
  /* The other half of the render change. COMPLETE still closes the day: the
     card is shown BECAUSE pain is unresolved, not because the day is done,
     so resolving it restores the ordinary finished-day screen. */
  await finishPainfulLengthDay();
  await app.page.locator('#daily-pelvic-review').click();
  const r=await visible();
  expect(r.needsReview).toBe(false);
  expect(r.state).toBe('COMPLETE');
  expect(r.card,'the card stayed up after the member resolved it').toBe(false);
  expect(r.text).not.toMatch(/You reported pain/i);
 },60000);

 test('A BLOCKED MISSION TAP LANDS ON THE EXPLANATION INSTEAD OF DOING NOTHING',async()=>{
  await reportPain();
  const r=await app.page.evaluate(()=>{
   goToStep(3);                                   // driven, not reached: see the pin above
   const from=session.step;
   startMission('length','test');                 // the tap
   return {from,step:session.step,routineType:session.routineType,
           prepare:currentPrescription().prepare,
           draft:localStorage.getItem('bp_session_draft_'+currentUser.id),
           todayVisible:!document.getElementById('step-0').classList.contains('hidden-step')};
  });
  expect(r.from).toBe(3);
  expect(r.step,'a session started').toBe(0);
  expect(r.todayVisible).toBe(true);
  expect(r.prepare).toBe('pelvic-pain');
  expect(r.draft,'a draft was written').toBeNull();
  expect(app.errors).toEqual([]);
 });

 test('and the same tap starts the session normally once symptoms are cleared',async()=>{
  await reportPain();
  await app.page.evaluate(()=>{localStorage.setItem(pelvicReviewKey(),'settled');renderDashboard();});
  const r=await app.page.evaluate(()=>{
   goToStep(3);startMission('length','test');
   const out={step:session.step,routineType:session.routineType};
   session.timer?.cancel();session.timer=null;return out;
  });
  /* startMission() lands on the readiness step, not the running session;
     the other tests in this file reach step 4 with an explicit goToStep(4).
     What matters here is that the tap was accepted at all. */
  expect(r.step).toBe(2);
  expect(r.routineType).toBe('length');
 });

 test('a second device without the local self-clear key stays blocked',async()=>{
  /* pelvicPracticeNeedsReview() reads localStorage, which does not sync.
     Another device reads no key, which is not 'settled', so the gate stays
     on. It fails in the safe direction and this pins that. */
  await reportPain();
  await app.page.evaluate(()=>{localStorage.setItem(pelvicReviewKey(),'settled');renderDashboard();});
  expect(await app.page.evaluate(()=>currentPrescription().prepare)).toBeNull();
  const r=await app.page.evaluate(()=>{
   localStorage.removeItem(pelvicReviewKey());    // the other device
   renderDashboard();
   goToStep(3);startMission('length','test');
   return {step:session.step,prepare:currentPrescription().prepare};
  });
  expect(r.prepare).toBe('pelvic-pain');
  expect(r.step).toBe(0);
 });

 test('an unfinished draft is not resumed and not destroyed while pain is unresolved',async()=>{
  await app.page.evaluate(()=>{
   persisted.pelvicProfile='standard';persisted.schedule[new Date().getDay()]='length';
   startMission('length','test');goToStep(4);session.exerciseIndex=1;
   session._aborting=false;goToStep(0);                 // writes the draft
   session.timer?.cancel();session.timer=null;
  });
  const before=await app.page.evaluate(()=>localStorage.getItem('bp_session_draft_'+currentUser.id));
  expect(before,'the fixture did not produce a draft').not.toBeNull();
  await reportPain();
  const r=await app.page.evaluate(()=>{
   resumeSession();
   return {step:session.step,prepare:currentPrescription().prepare,
           draft:localStorage.getItem('bp_session_draft_'+currentUser.id)};
  });
  expect(r.step).toBe(0);
  expect(r.prepare).toBe('pelvic-pain');
  expect(r.draft,'the draft was lost').toBe(before);
 });

 test('no pain: the control, so none of the above is passing vacuously',async()=>{
  await app.page.evaluate(()=>{
   persisted.pelvicProfile='standard';persisted.schedule[new Date().getDay()]='length';
   persisted.sessionLog=[];renderDashboard();
  });
  const r=await app.page.evaluate(()=>{
   goToStep(3);startMission('length','test');
   const out={step:session.step,prepare:currentPrescription().prepare};
   session.timer?.cancel();session.timer=null;return out;
  });
  expect(r.prepare).toBeNull();
  expect(r.step).toBe(2);
 });

 test('contraction blocks alternate short lifts and full release rather than a minute-long hold',async()=>{
  const r=await app.page.evaluate(()=>({start:pelvicRhythmCue(ROUTINES.recovery[3],60),release:pelvicRhythmCue(ROUTINES.recovery[3],55),next:pelvicRhythmCue(ROUTINES.recovery[3],50),sets:ROUTINES.recovery[3].sets}));expect(r.start).toMatch(/lift/i);expect(r.release).toMatch(/release/i);expect(r.next).toMatch(/lift/i);expect(r.sets).toBe(1);
 });
 test('failed account loading cannot launch practice',async()=>{
  await app.page.evaluate(()=>{_persistedLoaded=false;renderToday();startDailyPelvicCare();});await expect(app.page.locator('#daily-pelvic-card').isVisible()).resolves.toBe(false);await app.page.evaluate(()=>{_persistedLoaded=true;});expect(app.errors).toEqual([]);
 });
});
