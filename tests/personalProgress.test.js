import {describe,test,expect} from 'vitest';
import {readProgressCheckin,progressCheckinStatus,putProgressCheckin,personalProgress,recordedMeasurementProgress,todayPlanExplanation} from '../src/personalProgress.js';
const row=(date,control=2,goal='stamina')=>({v:1,date,goal,control,confidence:3});
describe('personal progress is a record, never a treatment decision',()=>{
 test('rejects invalid dates, versions, goals and empty or out-of-range ratings',()=>{
  for(const r of [null,{...row('2026-02-30')},{...row('2026-01-01'),v:2},{...row('2026-01-01'),goal:'bad'},{v:1,date:'2026-01-01',goal:'eq',eq:11,confidence:0}])expect(readProgressCheckin(r)).toBeNull();
 });
 test('uses chronological, same-goal, non-future entries',()=>{
  const p=personalProgress([row('2026-10-08',4),row('2026-10-01',2),row('2026-12-01',5),row('2026-10-02',1,'all')],'stamina','2026-10-08');
  expect(p.metrics[0]).toMatchObject({first:2,last:4,change:2});expect(p.records).toHaveLength(2);
 });
 test('one rating gives a starting point, not improvement',()=>expect(personalProgress([row('2026-10-01')],'stamina','2026-10-01').metrics[0].change).toBeNull());
 test('each metric gets its own first available baseline',()=>{
  const p=personalProgress([{...row('2026-10-01'),control:null},row('2026-10-08',4)],'stamina','2026-10-08');expect(p.metrics[0]).toMatchObject({first:4,last:4,change:null});
 });
 test('the reminder is seven calendar days later, not simply next Monday',()=>{
  expect(progressCheckinStatus([row('2026-10-11')],'stamina','2026-10-12').due).toBe(false);
  expect(progressCheckinStatus([row('2026-10-11')],'stamina','2026-10-18').due).toBe(true);
 });
 test('editing today replaces that goal and date, preserving other goals and unknown data',()=>{
  const unknown={v:8,date:'2026-10-01',future:true};const raw=[row('2026-10-01'),row('2026-10-01',4,'all'),unknown];
  const next=putProgressCheckin(raw,row('2026-10-01',5));expect(next).toHaveLength(3);expect(next).toContain(unknown);expect(next.at(-1).control).toBe(5);expect(raw[0].control).toBe(2);
 });
 test('retention preserves initial baselines and unread versions',()=>{
  const unknown={v:7};const rows=Array.from({length:150},(_,i)=>row(new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10)));
  const next=putProgressCheckin([...rows,unknown],row('2026-10-01'));expect(next).toContain(rows[0]);expect(next).toContain(unknown);expect(next.length).toBeLessThanOrEqual(106);
 });
 test('measurement comparisons are chronological and ignore invalid/future values',()=>{
  const p=recordedMeasurementProgress([{date:'2026-10-08',bpel:7.1},{date:'2026-10-01',bpel:7},{date:'2030-01-01',bpel:9},{date:'2026-10-05',bpel:'8'}],new Date('2026-10-09'));
  expect(p[0]).toMatchObject({first:7,last:7.1,change:.1});expect(p[1].change).toBeNull();
 });
 test('explanations reflect existing decisions without inventing a stronger dose',()=>{
  expect(todayPlanExplanation({state:'REST'})).toMatch(/without primary training/);
  expect(todayPlanExplanation({state:'TRAIN'},{mode:'foundation'},'tense')).toMatch(/breathing only/);
  expect(todayPlanExplanation({state:'PREPARE',prepare:'loading'})).toBe('');
 });
});
