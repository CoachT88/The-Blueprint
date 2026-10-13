import {beforeAll,afterAll,beforeEach,describe,test,expect} from 'vitest';
import {openApp,signIn,authSignIn,authSignOut} from './harness.js';
describe('personal progress uses the real UI and private save path',()=>{
 let app;
 beforeAll(async()=>{app=await openApp({clock:new Date('2026-10-13T12:00:00Z')});await signIn(app.page,{id:'progress-a'});},60000);
 afterAll(async()=>{await app?.close();});
 beforeEach(async()=>{await app.page.evaluate(()=>{
  session._aborting=true;goToStep(0);session._aborting=false;
  _persistedLoaded=true;persisted.primaryGoal='stamina';persisted.progressCheckins=[];persisted.measurements=[];
  persisted.sessionLog=[];persisted.allTimeSessionCount=0;persisted.programme=window.__legacyProgramme();
  persisted.dayPlans=[];persisted.schedule=Array(7).fill('rest');persisted.pelvicProfile='tight';
  window.__failUpsert=false;window.__writes=[];_schemaMissingLatestCols=false;_schemaMissingNewCols=false;
  _closeMemberOverlays();renderDashboard();
 });});
 test('first-run setup starts at the goal and hands back to Today',async()=>{
  await app.page.evaluate(()=>showFirstRunSetup());
  expect(await app.page.locator('#ob-slide-4').getAttribute('class')).toContain('active');
  expect(await app.page.locator('#ob-next-btn').textContent()).toBe('Start my plan');
  await app.page.locator('[data-goal="stamina"]').click();await app.page.locator('#ob-next-btn').click();
  expect(await app.page.evaluate(()=>session.step)).toBe(0);
  expect(await app.page.locator('#onboarding-overlay').getAttribute('class')).not.toContain('show');
  expect(await app.page.locator('#tour-layer').evaluate(x=>x.classList.contains('show'))).toBe(false);
 });
 test('unknown answers stay empty and skipping creates no training or rating',async()=>{
  await app.page.locator('#progress-btn').click();await app.page.locator('#personal-checkin-btn').click();
  expect(await app.page.locator('#progress-rating-control').inputValue()).toBe('');
  await app.page.locator('#personal-checkin-save').click();expect(await app.page.locator('#personal-checkin-status').textContent()).toMatch(/at least one/);
  await app.page.locator('#personal-checkin-cancel').click();
  expect(await app.page.evaluate(()=>({ratings:persisted.progressCheckins.length,sessions:persisted.sessionLog.length,count:persisted.allTimeSessionCount}))).toEqual({ratings:0,sessions:0,count:0});
 });
 test('saving and editing a starting point syncs the row without training credit or dose changes',async()=>{
  const before=await app.page.evaluate(()=>({program:JSON.stringify(persisted.programme),days:JSON.stringify(persisted.dayPlans),schedule:JSON.stringify(persisted.schedule)}));
  await app.page.locator('#progress-btn').click();await app.page.locator('#personal-checkin-btn').click();
  await app.page.locator('#progress-rating-control').selectOption('2');await app.page.locator('#progress-rating-confidence').selectOption('3');
  await app.page.locator('#personal-checkin-save').click();
  await expect.poll(()=>app.page.locator('#personal-checkin-status').textContent()).toMatch(/Check-in saved/);
  expect(await app.page.locator('#personal-progress-summary').textContent()).toMatch(/Starting point/);
  await app.page.locator('#personal-checkin-btn').click();await app.page.locator('#progress-rating-control').selectOption('4');await app.page.locator('#personal-checkin-save').click();
  await expect.poll(()=>app.page.locator('#personal-checkin-status').textContent()).toMatch(/Check-in saved/);
  const result=await app.page.evaluate(()=>({records:persisted.progressCheckins,write:window.__writes.at(-1),sessions:persisted.sessionLog.length,count:persisted.allTimeSessionCount,program:JSON.stringify(persisted.programme),days:JSON.stringify(persisted.dayPlans),schedule:JSON.stringify(persisted.schedule)}));
  expect(result.records).toHaveLength(1);expect(result.records[0].control).toBe(4);expect(result.write.progress_checkins[0].control).toBe(4);
  expect(result.sessions).toBe(0);expect(result.count).toBe(0);for(const key of ['program','days','schedule'])expect(result[key]).toBe(before[key]);
 });
 test('server failure stays visibly pending with a recoverable local backup',async()=>{
  await app.page.evaluate(()=>{window.__failUpsert=true;});
  await app.page.locator('#progress-btn').click();await app.page.locator('#personal-checkin-btn').click();await app.page.locator('#progress-rating-confidence').selectOption('3');await app.page.locator('#personal-checkin-save').click();
  await expect.poll(()=>app.page.locator('#personal-checkin-status').textContent()).toMatch(/Cloud sync is pending/);
  const r=await app.page.evaluate(()=>({dirty:localStorage.getItem('bp_dirty_'+currentUser.id),backup:JSON.parse(localStorage.getItem('bp_data_'+currentUser.id)).progressCheckins}));
  expect(r.dirty).toBe('1');expect(r.backup).toHaveLength(1);
 });
 test('chronological weekly comparisons show personal ratings and keep goals separate',async()=>{
  await app.page.evaluate(()=>{persisted.progressCheckins=[{v:1,date:'2026-10-08',goal:'stamina',control:4,confidence:3},{v:1,date:'2026-10-01',goal:'stamina',control:2,confidence:2},{v:1,date:'2026-10-02',goal:'eq',eq:9,confidence:5}];});
  await app.page.locator('#progress-btn').click();const text=await app.page.locator('#personal-progress-summary').textContent();
  expect(text).toMatch(/2 → 4/);expect(text).not.toMatch(/Erection quality/);expect(text).toMatch(/own ratings/);
  await app.page.locator('#progress-week-summary').click();expect(await app.page.locator('#weekly-report-content').textContent()).toMatch(/2 → 4/);
 });
 test('normal days explain the actual plan and do not modify execution',async()=>{
  await app.page.evaluate(()=>{persisted.schedule=Array(7).fill('stamina');persisted.primaryGoal='stamina';renderDashboard();});
  const before=await app.page.evaluate(()=>JSON.stringify(persisted));
  await app.page.locator('#today-why-btn').click();expect(await app.page.locator('#today-plan-context').isVisible()).toBe(true);
  expect(await app.page.locator('#today-plan-context').textContent()).toMatch(/program schedules/);expect(await app.page.evaluate(()=>JSON.stringify(persisted))).toBe(before);
 });
});
describe('check-ins stay isolated through the real auth lifecycle',()=>{
 let app;
 beforeAll(async()=>{app=await openApp();await app.page.evaluate(()=>{for(const id of ['progress-owner','progress-other']){localStorage.setItem('bp_welcomed_'+id,'1');localStorage.setItem('bp_onboarded_'+id,'1');}});},60000);
 afterAll(async()=>{await app?.close();});
 test('the next member never sees the previous member’s record or open answers',async()=>{
  await authSignIn(app.page,{id:'progress-owner',email:'owner@example.com',row:{primary_goal:'stamina',progress_checkins:[{v:1,date:'2026-10-01',goal:'stamina',control:5,confidence:5}],xp_migrated:true}});
  await app.page.evaluate(()=>dismissUpdateNotice());
  await app.page.locator('#progress-btn').click();await app.page.locator('#personal-checkin-btn').click();await app.page.locator('#progress-rating-confidence').selectOption('5');
  await authSignOut(app.page);await authSignIn(app.page,{id:'progress-other',email:'other@example.com',row:{primary_goal:'eq',progress_checkins:[],xp_migrated:true}});
  await app.page.evaluate(()=>dismissUpdateNotice());
  await app.page.locator('#progress-btn').click();expect(await app.page.locator('#personal-progress-summary').textContent()).not.toMatch(/5 \/ 5/);
  expect(await app.page.locator('#personal-checkin-editor').isVisible()).toBe(false);
  await app.page.locator('#personal-checkin-btn').click();expect(await app.page.locator('#progress-rating-confidence').inputValue()).toBe('');expect(await app.page.locator('#progress-rating-control').count()).toBe(0);
 });
});
describe('unread and first-time history are different',()=>{
 let app;
 beforeAll(async()=>{app=await openApp();},60000);
 afterAll(async()=>{await app?.close();});
 test('a genuinely new member reaches goal-first setup and can save an optional starting point',async()=>{
  await authSignIn(app.page,{id:'first-progress',email:'first-progress@example.com',row:null});
  await app.page.locator('#check-liability').check();await app.page.locator('#check-pain').check();await app.page.locator('#init-btn').click();
  await expect.poll(()=>app.page.locator('#ob-slide-4').getAttribute('class')).toContain('active');
  await app.page.locator('[data-goal="stamina"]').click();await app.page.locator('#ob-next-btn').click();
  expect(await app.page.evaluate(()=>Array.isArray(persisted.progressCheckins))).toBe(true);
  await app.page.locator('#progress-btn').click();expect(await app.page.locator('#personal-checkin-btn').isEnabled()).toBe(true);
 });
 test('unread history never becomes an empty cloud overwrite',async()=>{
  const r=await app.page.evaluate(()=>{adoptPersisted({...persisted,progressCheckins:null});openProgressChart();return {payload:_buildSavePayload(),text:document.getElementById('personal-progress-summary').textContent};});
  expect(r.payload).not.toHaveProperty('progress_checkins');expect(r.text).toMatch(/unavailable/);expect(await app.page.locator('#personal-checkin-btn').isEnabled()).toBe(false);
 });
});
describe('older backups preserve new server check-ins',()=>{
 let app;
 beforeAll(async()=>{
  app=await openApp();
  await app.page.evaluate(()=>{localStorage.setItem('bp_welcomed_backup-progress','1');localStorage.setItem('bp_onboarded_backup-progress','1');localStorage.setItem('bp_data_backup-progress',JSON.stringify({_savedAt:'2026-10-13T23:59:00Z',primaryGoal:'stamina',xpMigrated:true,sessionLog:[],measurements:[]}));localStorage.setItem('bp_dirty_backup-progress','1');});
 },60000);
 afterAll(async()=>{await app?.close();});
 test('a newer old-format backup does not wipe a separately available rating',async()=>{
  await authSignIn(app.page,{id:'backup-progress',email:'backup-progress@example.com',row:{updated_at:'2026-10-01T00:00:00Z',progress_checkins:[{v:1,date:'2026-10-01',goal:'stamina',control:4,confidence:4}],xp_migrated:true}});
  const r=await app.page.evaluate(()=>({state:persisted.progressCheckins,write:window.__writes.find(x=>x.progress_checkins?.length)}));
  expect(r.state[0].control).toBe(4);expect(r.write.progress_checkins[0].control).toBe(4);
 });
});
describe('a missing check-in column cannot silently drop history',()=>{
 let app;
 beforeAll(async()=>{app=await openApp({rejectColumns:['progress_checkins']});await signIn(app.page,{id:'column-progress',persisted:{primaryGoal:'stamina',progressCheckins:[],dayPlans:[]}});},60000);
 afterAll(async()=>{await app?.close();});
 test('new ratings remain pending without stripping program data',async()=>{
  await app.page.evaluate(()=>{goToStep(0);_closeMemberOverlays();clearTimeout(_saveDebounce);window.__attempts=[];_schemaMissingLatestCols=false;_schemaMissingNewCols=false;});
  await app.page.locator('#progress-btn').click();await app.page.locator('#personal-checkin-btn').click();await app.page.locator('#progress-rating-control').selectOption('3');await app.page.locator('#personal-checkin-save').click();
  await expect.poll(()=>app.page.locator('#personal-checkin-status').textContent()).toMatch(/Cloud sync is pending/);
  const r=await app.page.evaluate(()=>({attempts:window.__attempts,latest:_schemaMissingLatestCols,broad:_schemaMissingNewCols,dirty:localStorage.getItem('bp_dirty_'+currentUser.id)}));
  expect(r.attempts).toHaveLength(1);expect(r.attempts[0]).toHaveProperty('programme');expect(r.attempts[0]).toHaveProperty('progress_checkins');expect(r.latest).toBe(false);expect(r.broad).toBe(false);expect(r.dirty).toBe('1');
 });
});
