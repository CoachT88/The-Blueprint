/** Daily practice policy, separate from the mechanical dose and progression.
 * Durations are small adherence defaults, not a proven treatment dose.
 * NHS relaxation guidance and individualized contraction guidance:
 * https://www.dynamichealth.nhs.uk/help-and-advice/pelvic-health/male-pelvic-pain/
 * https://www.ouh.nhs.uk/media/in3ekdyl/74150guide.pdf
 */
import {isDateKey} from './dayPlan.js';
export const PRACTICE_VERSION = 1;
export const PRACTICE_EXERCISES = Object.freeze({
    breathing:8, reverseRelease:1, floorRelease:2,
    squat:4, happyBaby:5, pigeon:6, butterfly:7,
});
const FEEDBACK = new Set(['comfortable','tense','painful']);
export function latestPracticeFeedback(log, now) {
    const end=now instanceof Date?now.getTime():0;
    return (Array.isArray(log)?log:[])
        .filter(x=>x&&FEEDBACK.has(x.pelvicPractice?.feedback)&&Number.isFinite(Date.parse(x.date))&&Date.parse(x.date)<=end)
        .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0]||null;
}
export function buildPelvicPracticePlan({date,dayKind='primary',profile='',feedback='',painCleared=false,busy=false}={}) {
    if(!isDateKey(date))return null;
    const when=new Date(date+'T12:00:00');
    if(!Number.isFinite(when.getTime()))return null;
    const paused=feedback==='painful'&&!painCleared;
    const foundation=busy||feedback==='tense'||(feedback==='painful'&&painCleared);
    const step=(id,sets,duration,restDur=0)=>({id,index:PRACTICE_EXERCISES[id],sets,duration,restDur});
    const steps=paused?[]:[step('breathing',1,120)];
    if(!paused&&!foundation){
        steps.push(step(profile==='standard'?'floorRelease':'reverseRelease',1,45));
        if(dayKind==='rest'||dayKind==='support-only'){
            const mobility=['happyBaby','squat','butterfly','pigeon'][when.getDay()%4];
            steps.push(step(mobility,2,45,20));
        }
    }
    return {v:1,date,mode:paused?'paused':foundation?'foundation':'daily',steps};
}
export function normalisePelvicPracticePlan(raw) {
    if(!raw||raw.v!==1||!isDateKey(raw.date)||!['daily','foundation','paused'].includes(raw.mode)||!Array.isArray(raw.steps)||raw.steps.length>3)return null;
    const seen=new Set();const steps=[];
    for(const s of raw.steps){
        if(!s||!(s.id in PRACTICE_EXERCISES)||s.index!==PRACTICE_EXERCISES[s.id]||seen.has(s.id)
            ||!Number.isInteger(s.sets)||s.sets<1||s.sets>2||!Number.isInteger(s.duration)||s.duration<30||s.duration>120
            ||!Number.isInteger(s.restDur)||s.restDur<0||s.restDur>20)return null;
        seen.add(s.id);steps.push({id:s.id,index:s.index,sets:s.sets,duration:s.duration,restDur:s.restDur});
    }
    if(raw.mode==='paused'?steps.length!==0:steps[0]?.id!=='breathing')return null;
    return {v:1,date:raw.date,mode:raw.mode,steps};
}
export function practiceSeconds(plan, completedIndices=[]) {
    const p=normalisePelvicPracticePlan(plan);if(!p)return 0;
    const done=new Set(completedIndices);
    return p.steps.filter(s=>!done.has(s.index)).reduce((n,s)=>n+s.sets*s.duration+(s.sets-1)*s.restDur,0);
}
export function dailyPracticeItems(plan) {
    const p=normalisePelvicPracticePlan(plan);
    return p&&p.steps.length?[{type:'pelvic-practice',required:true,dose:{v:1,mode:p.mode,steps:p.steps}}]:[];
}
