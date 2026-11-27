import { describe, test, expect } from 'vitest';
import { openApp, authSignIn } from './harness.js';

/**
 * READ-ONLY ADVERSARIAL CHARACTERIZATION, NOT A V2 FEATURE.
 * Uses the actual unchanged app/index.html and the app's real auth load,
 * renderer, goal picker and save paths. Only the Supabase row is synthetic.
 * It logs unsafe behavior instead of assuming the old client is safe.
 * Does not contact production Supabase or mutate a real member account.
 *
 * These observations are the first bounded proof requested in #186.
 */
const DATES = ['2026-03-16','2026-03-17','2026-03-18','2026-03-19','2026-03-20','2026-03-21','2026-03-22'];
const DATE = {
  eq: new Date('2026-03-16T12:00:00Z'),
  rest: new Date('2026-03-19T12:00:00Z'),
  all: new Date('2026-03-20T12:00:00Z'),
};
const cloned = x => JSON.parse(JSON.stringify(x));
const makeFixture = (goal='eq') => {
  const key = goal === 'all' ? 'everything-v2' : 'erectionQuality-v2';
  const base = date => ({
    date, mode:'rest', status:'pending', primarySession:null,
    supportingWork:[], dailyPractice:[],
    generatedFrom:{programmeKey:key,version:2},
  });
  const day_plans = DATES.map(base);
  const monday = day_plans[0];
  monday.mode='prescribed';
  monday.supportingWork=[{type:'move',category:'aerobic',title:'Move',required:true,dose:{minutes:15}}];
  const thu=day_plans[3];
  thu.mode='rest';
  thu.fullRest=true; // additive marker, not a new DAY_MODE
  thu.dailyPractice=[];
  if(goal==='all'){
    const fri=day_plans[4];
    fri.mode='prescribed';
    fri.primarySession={
      type:'length',title:'Length',tier:'intermediate',
      dose:{v:1,shape:'sets',tier:'intermediate',
        exercises:[{title:'Directional Pulls',sets:3,duration:30},{title:'V-Stretch',sets:3,duration:30}]}
    };
    fri.supportingWork=[{type:'move',category:'aerobic',title:'Move',required:true,dose:{minutes:15}}];
  }
  return {
    id:'stale-v1-test',primary_goal:goal,
    schedule:Array(7).fill('rest'), // legacy-compatible shadow only
    programme:{
      key,version:2,custom:false,adoptedAt:'2026-03-01',
      migration:{source:'v2-programme',presetKey:goal,reason:'explicit-upgrade',classifiedAt:'2026-03-01'}
    },
    day_plans,
    total_xp:500,all_time_session_count:12, difficulty:'intermediate',
    completed_days:Array(7).fill(false),session_log:[],measurements:[],
    progression_ledger:[],seen_milestones:[],xp_migrated:true,
    updated_at:'2026-03-15T12:00:00Z',
  };
};

const observe = page => page.evaluate(() => {
  const el=id=>document.getElementById(id);
  const visible=id=>{
    const n=el(id);return !!n && !n.classList.contains('hidden') &&
        getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
  };
  const current=currentTodayPrescription();
  const resolved=currentPrescription();
  const pelvic=currentPelvicPracticePlan();
  const week=window.__weekStrip?.();
  return {
    day:new Date().toISOString().slice(0,10),
    headline:el('today-headline')?.textContent?.trim()||null,
    sub:el('today-sub')?.textContent?.trim()||null,
    today:current?{ok:current.ok,dayKind:current.dayKind,
      primaryType:current.primaryType,reason:current.reason}:null,
    ready:resolved?{state:resolved.state,mission:resolved.mission,prepare:resolved.prepare}:null,
    readyCta:{visible:visible('ready-cta'),label:el('ready-cta')?.textContent?.trim()||null},
    launch:{visible:visible('launch-btn'),label:el('launch-btn')?.textContent?.trim()||null},
    pelvic:{visible:visible('daily-pelvic-card'),
      start:visible('daily-pelvic-start'),
      note:el('daily-pelvic-note')?.textContent?.trim()||null,
      steps:(pelvic?.steps||[]).map(s=>s.id||s.index||s.title||null)},
    week:week?{authority:week.authority,days:week.days.map(d=>({
      name:d.name,state:d.state,aria:d.aria,title:d.title
    }))}:null,
    persisted:{
      primaryGoal:persisted.primaryGoal,
      programmeKey:persisted.programme?.key,
      migrationSource:persisted.programme?.migration?.source,
      pending:clonedSerializable(persisted.programme?.pendingChange||null),
      schedule:[...persisted.schedule],
      dayPlans:persisted.dayPlans.map(p=>({
        date:p.date,mode:p.mode,type:p.primarySession?.type||null,
        supportingCount:p.supportingWork?.length||0,
        fullRest:p.fullRest===true,
        generatedFrom:p.generatedFrom
      }))
    },
    writes:window.__writes?.length||0,
    attempts:window.__attempts?.length||0
  };
  function clonedSerializable(v){return JSON.parse(JSON.stringify(v));}
});
const start = async (goal,clock,rowOverride=null) => {
  const app=await openApp({clock,timezoneId:'UTC'});
  await app.page.evaluate(() => localStorage.clear());
  await authSignIn(app.page,{
    id:'stale-v1-test',email:'stale-v1-test@example.com',
    row:rowOverride||makeFixture(goal)
  });
  await app.page.evaluate(() => {dismissUpdateNotice(); hideOnboarding(); renderDashboard();});
  return app;
};

describe('UNCORRECTED V1 against future V2 data, no client replacement', () => {
  test('EQ support-only: observe original UI and real goal-change bypass', async () => {
    const app=await start('eq',DATE.eq);
    try {
      const before=await observe(app.page);
      const allow=await app.page.evaluate(()=>window.BP.mayGenerateOver(persisted.programme));
      await app.page.evaluate(()=>selectGoal('size'));
      const after=await observe(app.page);
      const result={case:'eq-old-client-goal-change',allow,before,after};
      console.log('OLD_HEAD_PROOF '+JSON.stringify(result));
      expect(allow).toBe(false);
      expect(before.persisted.migrationSource).toBe('v2-programme');
      expect(after.persisted.primaryGoal).toBe('size');
      expect(after.persisted.schedule).toHaveLength(7);
    } finally {await app.close();}
  }, 90_000);

  test('V2 explicit full rest: observe whether old REST UI offers pelvic practice', async () => {
    const app=await start('eq',DATE.rest);
    try {
      const before=await observe(app.page);
      await app.page.evaluate(()=>selectGoal('size'));
      const after=await observe(app.page);
      console.log('OLD_HEAD_PROOF '+JSON.stringify({case:'full-rest-on-old-client',before,after}));
      expect(before.persisted.dayPlans.find(p=>p.date==='2026-03-19').fullRest).toBe(true);
    } finally {await app.close();}
  },90_000);

  test('All mixed: observe old Today and old goal-switch', async () => {
    const app=await start('all',DATE.all);
    try {
      const before=await observe(app.page);
      await app.page.evaluate(()=>selectGoal('eq'));
      const after=await observe(app.page);
      console.log('OLD_HEAD_PROOF '+JSON.stringify({case:'all-mixed-old-client',before,after}));
      expect(before.persisted.dayPlans.find(p=>p.date==='2026-03-20').supportingCount).toBe(1);
    } finally {await app.close();}
  },90_000);

  test('old dirty backup with queued change takes local-write path; OBSERVATION ONLY', async () => {
    const server=makeFixture('eq');
    // Backup is intentionally a stale V1 week with a newer local timestamp.
    const old={schedule:['rest','length','girth','stamina','rest','length','rest'],
      programme:{key:'size',version:1,custom:false,adoptedAt:'2026-03-15',
        migration:{source:'preset',presetKey:'size',classifiedAt:'2026-03-10'},
        pendingChange:{key:'erectionQuality',effectiveDate:'2026-03-16',
          schedule:['stamina','rest','length','rest','stamina','rest','rest']}},
      dayPlans:[],primaryGoal:'eq',
      sessionLog:[{date:'2026-03-15T13:00:00Z',routineType:'stamina',xpEarned:15}],
      measurements:[],totalXp:100,allTimeSessionCount:1,
      _savedAt:'2026-03-16T13:00:00Z'
    };
    const app=await openApp({clock:DATE.eq,timezoneId:'UTC'});
    try {
      await app.page.evaluate(({old})=>{
        localStorage.setItem('bp_data_stale-v1-test',JSON.stringify(old));
        localStorage.setItem('bp_dirty_stale-v1-test','1');
      },{old});
      await authSignIn(app.page,{id:'stale-v1-test',email:'stale-v1-test@example.com',row:server});
      await app.page.evaluate(() => {dismissUpdateNotice();hideOnboarding();renderDashboard();});
      const got=await observe(app.page);
      const kept=await app.page.evaluate(()=>({
        dirty:localStorage.getItem('bp_dirty_stale-v1-test'),
        local:JSON.parse(localStorage.getItem('bp_data_stale-v1-test')||'null'),
        writes:window.__writes.map(w=>({schedule:w.schedule,
          key:w.programme?.key,logSize:w.session_log?.length||0}))
      }));
      console.log('OLD_HEAD_PROOF '+JSON.stringify({case:'old-dirty-backup-replay',got,kept}));
      expect(got.persisted.schedule).toHaveLength(7);
    } finally {await app.close();}
  },90_000);
});
