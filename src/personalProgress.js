/** Personal ratings and recorded measurements, never a diagnosis or a dose input. */
import {isDateKey} from './dayPlan.js';
export const PROGRESS_FIELDS=Object.freeze({
 size:['confidence'],stamina:['control','confidence'],eq:['eq','confidence'],all:['control','eq','confidence'],
});
export const PROGRESS_LABELS=Object.freeze({control:'Climax control',eq:'Erection quality',confidence:'Sexual confidence'});
const limits={control:5,confidence:5,eq:10};
const dayNumber=d=>Date.parse(d+'T12:00:00Z')/86400000;
const rating=(v,max)=>Number.isInteger(v)&&v>=1&&v<=max?v:null;
export function readProgressCheckin(raw){
 if(!raw||raw.v!==1||!isDateKey(raw.date)||!PROGRESS_FIELDS[raw.goal])return null;
 const out={v:1,date:raw.date,goal:raw.goal};let any=false;
 for(const field of PROGRESS_FIELDS[raw.goal]){out[field]=rating(raw[field],limits[field]);if(out[field]!==null)any=true;}
 return any?out:null;
}
export function progressCheckinStatus(raw,goal,today){
 const records=(Array.isArray(raw)?raw:[]).map(readProgressCheckin)
  .filter(x=>x&&x.goal===goal&&isDateKey(today)&&x.date<=today).sort((a,b)=>a.date.localeCompare(b.date));
 const latest=records.at(-1)||null;
 return {records,latest,baseline:records[0]||null,due:!latest||dayNumber(today)-dayNumber(latest.date)>=7};
}
export function putProgressCheckin(raw,value){
 const valid=readProgressCheckin(value);if(!valid)return null;
 const all=Array.isArray(raw)?raw:[];
 // Unknown versions are carried through. Keep each goal's first known baseline
 // and the latest 104 known entries; reading never destroys unread history.
 const next=all.filter(x=>{const v=readProgressCheckin(x);return !v||v.goal!==valid.goal||v.date!==valid.date;}).concat(valid);
 const known=next.filter(x=>readProgressCheckin(x)).sort((a,b)=>a.date.localeCompare(b.date));
 const first=new Map();for(const x of known)if(!first.has(x.goal))first.set(x.goal,x);
 const keep=new Set([...first.values(),...known.slice(-104)]);
 return next.filter(x=>!readProgressCheckin(x)||keep.has(x));
}
export function personalProgress(raw,goal,today){
 const state=progressCheckinStatus(raw,goal,today);
 const metrics=(PROGRESS_FIELDS[goal]||[]).map(field=>{
  const samples=state.records.filter(x=>x[field]!==null&&x[field]!==undefined);
  const first=samples[0],last=samples.at(-1);
  return {field,label:PROGRESS_LABELS[field],max:limits[field],first:first?.[field]??null,last:last?.[field]??null,
   firstDate:first?.date||null,lastDate:last?.date||null,
   change:first&&last&&first.date!==last.date?last[field]-first[field]:null};
 });
 return {...state,metrics};
}
export function measurementSeries(raw,field,now){
 const end=now instanceof Date?now.getTime():NaN;
 return (Array.isArray(raw)?raw:[]).filter(x=>x&&Number.isFinite(Date.parse(x.date))&&Date.parse(x.date)<=end&&typeof x[field]==='number'&&Number.isFinite(x[field])&&x[field]>0)
  .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).map(x=>({date:x.date,value:x[field]}));
}
export function recordedMeasurementProgress(raw,now){
 return ['bpel','mseg'].map(field=>{
  const rows=measurementSeries(raw,field,now),first=rows[0],last=rows.at(-1);
  return {field,first:first?.value??null,last:last?.value??null,
   change:first&&last&&Date.parse(first.date)<Date.parse(last.date)?Math.round((last.value-first.value)*100)/100:null};
 });
}
export function todayPlanExplanation(r={},practice={},feedback=''){
 const lines=[];
 if(r.state==='TRAIN')lines.push('Your program schedules this session today. Follow the exercises, sets and timer shown in your session.');
 else if(r.state==='RESUME')lines.push('Continue the saved session from where you stopped.');
 else if(r.state==='REST')lines.push('Your program schedules a day without primary training. Follow the daily practice shown on Today, then let recovery be enough.');
 else if(r.state==='SUPPORT_ONLY')lines.push('There is no primary training scheduled today. Follow the supporting practice shown on Today.');
 else if(r.state==='COMPLETE')lines.push('The required work recorded for today is complete. Your next assignment will appear on Today.');
 else if(['MODIFIED','RECOVER'].includes(r.state)&&!(r.changes||[]).length&&r.reason)lines.push(r.reason);
 if(practice.mode==='foundation'&&feedback==='tense')lines.push('Your latest pelvic practice felt more tense, so today’s daily practice uses gentle breathing only.');
 return lines.join(' ');
}
