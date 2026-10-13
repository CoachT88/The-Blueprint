import {describe,test,expect} from 'vitest';
import {buildPelvicPracticePlan as build,normalisePelvicPracticePlan as normalise,practiceSeconds,dailyPracticeItems,latestPracticeFeedback} from '../src/pelvicPractice.js';
import {generatePlans,retainPlans} from '../src/programmeGenerate.js';
const base={date:'2026-10-13',profile:'standard'};
describe('small prescribed pelvic practice',()=>{
 test.each(['','tight','standard'])('always includes breathing and no automatic strength: %s',profile=>{
  const p=build({...base,profile});expect(p.steps[0].id).toBe('breathing');expect(p.steps).toHaveLength(2);expect(practiceSeconds(p)).toBe(165);
  expect(p.steps.every(x=>![0,3].includes(x.index))).toBe(true);
 });
 test('unscreened and tension-flagged members get release guidance',()=>{expect(build({...base,profile:''}).steps[1].id).toBe('reverseRelease');expect(build({...base,profile:'tight'}).steps[1].id).toBe('reverseRelease');});
 test('rest days rotate one mobility exercise within a six-minute budget',()=>{
  const choices=new Set();for(let d=11;d<=17;d++){const p=build({...base,date:`2026-10-${d}`,dayKind:'rest'});expect(p.steps).toHaveLength(3);expect(practiceSeconds(p)).toBe(275);choices.add(p.steps[2].id);}
  expect(choices).toEqual(new Set(['happyBaby','squat','butterfly','pigeon']));
 });
 test('support-only days receive practice without a primary mission',()=>{expect(practiceSeconds(build({...base,dayKind:'support-only'}))).toBe(275);});
 test('busy days retain a two-minute foundation without adding later debt',()=>{expect(practiceSeconds(build({...base,busy:true}))).toBe(120);expect(practiceSeconds(build({...base,date:'2026-10-14'}))).toBe(165);});
 test('increased tension reduces the next practice to gentle breathing',()=>{expect(build({...base,feedback:'tense'}).mode).toBe('foundation');expect(practiceSeconds(build({...base,feedback:'tense'}))).toBe(120);});
 test('pain pauses work until the member reports symptoms have settled',()=>{expect(build({...base,feedback:'painful'}).steps).toEqual([]);expect(practiceSeconds(build({...base,feedback:'painful',painCleared:true}))).toBe(120);});
 test('already performed library exercises are excluded from remaining time',()=>{const p=build({...base,dayKind:'rest'});expect(practiceSeconds(p,[8,p.steps[2].index])).toBe(45);expect(practiceSeconds(p,p.steps.map(x=>x.index))).toBe(0);});
 test('resolved items fit dated daily practice and never create supporting/primary work',()=>{const items=dailyPracticeItems(build(base));expect(items[0].type).toBe('pelvic-practice');expect(items[0].dose.steps[0].duration).toBe(120);expect(items[0]).not.toHaveProperty('tier');});
 test('malformed dates, oversized doses, duplicates and contractions cannot execute',()=>{
  expect(build({...base,date:'2026-02-31'})).toBeNull();const p=build(base);
  for(const steps of [[{...p.steps[0],duration:3600}],[p.steps[0],p.steps[0]],[{...p.steps[0],index:0}],[]])expect(normalise({...p,steps})).toBeNull();
 });
 test('feedback is read from real, timestamped, completed practice; future records cannot dominate',()=>{
  const log=[{date:'2026-10-12T20:00:00Z',pelvicPractice:{feedback:'painful'}},{date:'2026-10-13T20:00:00Z',pelvicPractice:{feedback:'comfortable'}},{date:'2026-11-01T00:00:00Z',pelvicPractice:{feedback:'painful'}}];
  expect(latestPracticeFeedback(log,new Date('2026-10-13T21:00:00Z')).pelvicPractice.feedback).toBe('comfortable');
 });
 test('generation adds practice without changing an existing primary prescription',()=>{
  const input={key:'everything',presets:{all:['rest','length','girth','rest','stamina','length','rest']},now:new Date('2026-10-13T12:00:00'),tier:'beginner'};
  const baseline=generatePlans(input);const extended=generatePlans({...input,dailyPracticeFor:(date,slot)=>dailyPracticeItems(build({date,dayKind:slot==='rest'?'rest':'primary'}))});
  expect(extended.ok).toBe(true);extended.plans.forEach((p,i)=>{expect(p.primarySession).toEqual(baseline.plans[i].primarySession);expect(p.mode).toBe(baseline.plans[i].mode);expect(p.dailyPractice).toHaveLength(1);});
  const kept=retainPlans(baseline.plans,extended.plans,{today:base.date});expect((kept.plans||kept).find(p=>p.date===base.date)).toEqual(baseline.plans.find(p=>p.date===base.date));
 });
});
