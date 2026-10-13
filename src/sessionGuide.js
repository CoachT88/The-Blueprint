/** Presentation only. Guidance never starts, advances, or changes a timer. */
export function createGuideSpeech({synth,Utterance,isAllowed=()=>true,onUnavailable=()=>{}}={}) {
    const available=!!synth&&typeof synth.speak==='function'&&typeof synth.cancel==='function'&&typeof Utterance==='function';
    let enabled=false,last='',ticket=0;
    const cancel=()=>{ticket++;last='';try{synth?.cancel();}catch{}};
    const setEnabled=value=>{enabled=available&&value===true;if(!enabled)cancel();return enabled;};
    const say=text=>{
        if(!enabled||!isAllowed()||typeof text!=='string')return false;
        const clean=text.trim().slice(0,240);
        if(!clean||clean===last)return false;
        last=clean;const current=++ticket;
        try{
            synth.cancel();
            const utterance=new Utterance(clean);
            utterance.lang='en-US';utterance.rate=.95;
            utterance.onerror=event=>{
                if(current!==ticket||['canceled','interrupted'].includes(event?.error))return;
                enabled=false;cancel();onUnavailable();
            };
            synth.speak(utterance);return true;
        }catch{enabled=false;cancel();onUnavailable();return false;}
    };
    return {available,isEnabled:()=>enabled,setEnabled,say,cancel};
}

/** Brief setup cues for the existing library, without prescribing a dose.
 * Breathing/release wording follows NHS male pelvic pain guidance:
 * https://dynamichealth.nhs.uk/help-and-advice/pelvic-health/male-pelvic-pain/
 * The visual is illustrative; the member follows their comfortable breath.
 */
export function guideSetup(ex={}) {
    const cues={
        'Diaphragmatic breathing':'Settle into a comfortable position. Breathe gently into your lower ribs and belly. Let go as if allowing pee or gas to pass easily; do not push anything out.',
        'Reverse Kegel Stretch':'Sit or lie supported, with your belly soft. Breathe in gently and let go as if allowing pee or gas to pass easily. Do not push anything out.',
        'Pelvic Floor Release':'Let your body settle. Breathe comfortably and let the pelvic floor soften.',
        'Happy Baby':'Lie on your back and bring your knees toward your chest. Keep the position comfortable.',
        'Deep Squat — Malasana':'Find a comfortable squat, using support if needed. Keep breathing and avoid forcing depth.',
        'Butterfly Stretch':'Bring the soles of your feet together. Let your knees settle gently without pressing them down.',
        'Pigeon Pose':'Settle into a comfortable position. Support yourself and keep the stretch gentle.',
        'Kegel Contractions':'Use a gentle lift followed by a full release. Keep your breath flowing.',
        'Pelvic Floor Endurance Hold':'Follow the short lift and release cues. Relax sooner if control fades.',
    };
    return cues[ex.title]||'Review the technique below before starting. Keep the movement comfortable.';
}
