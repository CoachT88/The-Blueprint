import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import {
  cn, pc, cc, chordRN, gcon, extChordLabel, ml,
  exportMIDI,
  KEYS, MAJOR_COF, MINOR_COF, MOODS
} from "./music.js";

/* HarmonyMap — the chord map is the whole app.
   Sound-first. Presets front-and-center. Theory hidden behind a toggle. */

// ─── AUDIO ENGINE ───────────────────────────────────────────
class AudioEngine {
constructor() { this.ctx=null; this.mg=null; this.rv=null; this.rvStadium=null; this.isPlaying=false; this.tids=[]; this.instrument='underwater'; this.pianoWave=null; this.cinematicWave=null; this.padWave=null; this.noteEnvs=[]; this._loopGen=0; }
init() {
if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}
if(!this.iosUnlocked){this.iosUnlocked=true;try{const a=document.createElement('audio');a.setAttribute('playsinline','');a.setAttribute('preload','auto');a.src='data:audio/wav;base64,UklGRsEIAABXQVZFZm10IBAAAAABAAEAIlYAACJWAAABAAgAZGF0YZ0IAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICagICAgICAgICagICagICagICA=';a.play().catch(()=>{});}catch(e){}}
this.ctx=new(window.AudioContext||window.webkitAudioContext)();
this.ctx.resume();
try{const ub=this.ctx.createBuffer(1,this.ctx.sampleRate*0.1,this.ctx.sampleRate);const ud=ub.getChannelData(0);for(let i=0;i<ud.length;i++)ud[i]=(Math.random()-0.5)*1e-5;const us=this.ctx.createBufferSource();us.buffer=ub;us.connect(this.ctx.destination);us.start(0);}catch(e){}
this.mg=this.ctx.createGain(); this.mg.gain.value=0.32;
const comp=this.ctx.createDynamicsCompressor();
comp.threshold.value=-18;comp.knee.value=12;comp.ratio.value=3;comp.attack.value=0.008;comp.release.value=0.20;
const masterLP=this.ctx.createBiquadFilter();
masterLP.type='highshelf';masterLP.frequency.value=9000;masterLP.gain.value=-4;
const rvBufTiny=this._buildReverbBuffer(0.25,4.0);
const rvConv=this.ctx.createConvolver();rvConv.buffer=rvBufTiny;
const rvSendLP=this.ctx.createBiquadFilter();
rvSendLP.type='lowpass';rvSendLP.frequency.value=600;rvSendLP.Q.value=0.5;
const rvGain=this.ctx.createGain();rvGain.gain.value=0.07;
rvSendLP.connect(rvConv);rvConv.connect(rvGain);rvGain.connect(masterLP);
const stBufTiny=this._buildReverbBuffer(0.25,1.8,0.02);
const stConv=this.ctx.createConvolver();stConv.buffer=stBufTiny;
const stSendLP=this.ctx.createBiquadFilter();
stSendLP.type='lowpass';stSendLP.frequency.value=1400;stSendLP.Q.value=0.5;
const stGain=this.ctx.createGain();stGain.gain.value=0.11;
stSendLP.connect(stConv);stConv.connect(stGain);stGain.connect(masterLP);
// Defer the ~500k-sample real reverb IRs to idle time so first tap
// stays snappy. Convolver picks up the new buffer transparently.
const buildFull=()=>{try{rvConv.buffer=this._buildReverbBuffer(1.2,4.0);stConv.buffer=this._buildReverbBuffer(1.8,1.8,0.06);}catch(x){}};
if(typeof requestIdleCallback==='function')requestIdleCallback(buildFull,{timeout:400});
else setTimeout(buildFull,120);
const clip=this.ctx.createWaveShaper();const cv=new Float32Array(256);for(let i=0;i<256;i++){const x=i*2/255-1;cv[i]=Math.tanh(x*2.5)/Math.tanh(2.5);}clip.curve=cv;clip.oversample='4x';
this.mg.connect(comp);comp.connect(masterLP);masterLP.connect(clip);clip.connect(this.ctx.destination);
this.rv=rvSendLP;this.rvStadium=stSendLP;
this._buildWaves();
}
_buildWaves(){
if(!this.pianoWave){const pa=[0,1.0,0.275,0.30,0.080,0.10,0.034,0.044,0.015,0.020,0.0065,0.009,0.003,0.004];const N=pa.length,pr=new Float32Array(N),pi=new Float32Array(N);for(let i=1;i<N;i++)pr[i]=pa[i];this.pianoWave=this.ctx.createPeriodicWave(pr,pi,{disableNormalization:false});}
if(!this.cinematicWave){const N=16;const cr=new Float32Array(N),ci=new Float32Array(N);for(let i=1;i<N;i++){cr[i]=0;ci[i]=-(1/i)*(i%2===1?1.4:0.8);}this.cinematicWave=this.ctx.createPeriodicWave(cr,ci,{disableNormalization:false});}
if(!this.padWave){const N=22;const pr=new Float32Array(N),pi2=new Float32Array(N);for(let i=1;i<N;i++){const sq=i%2===1?1.28:0.72;pi2[i]=-(1/i)*sq*(1-i/N*0.35);}this.padWave=this.ctx.createPeriodicWave(pr,pi2,{disableNormalization:false});}
}
_buildReverbBuffer(dur,decay=3.6,preDelay=0.018){const sr=this.ctx.sampleRate,len=Math.floor(sr*dur),pre=Math.floor(sr*preDelay);const buf=this.ctx.createBuffer(2,len,sr);for(let ch=0;ch<2;ch++){const d=buf.getChannelData(ch);for(let i=pre;i<len;i++){const t=(i-pre)/sr;d[i]=(Math.random()*2-1)*Math.exp(-t*decay);}}return buf;}
setInstrument(name){this.instrument=name;}
noteToFreq(n) {const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};const m=n.match(/^([A-G][#b]?)(\d)$/); if(!m) return 440;return 440*Math.pow(2,(M[m[1]]-9+(parseInt(m[2])-4)*12)/12);}
_playUnderwater(fr,vel,t,dur){const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.6;fl.frequency.setValueAtTime(700,t);fl.frequency.linearRampToValueAtTime(580,t+dur*0.65);[-7,0,7].forEach(dt=>{const o=this.ctx.createOscillator();o.setPeriodicWave(this.pianoWave);o.frequency.value=fr;o.detune.value=dt;o.connect(fl);o.start(t);o.stop(t+dur+0.4);});const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.52,t+0.045);env.gain.exponentialRampToValueAtTime(vel*0.34,t+0.12);env.gain.exponentialRampToValueAtTime(vel*0.20,t+0.55);env.gain.exponentialRampToValueAtTime(vel*0.09,t+dur*0.85);env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.1);fl.connect(env);return env;}
_playCinematic(fr,vel,t,dur){const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.65;fl.frequency.setValueAtTime(1600,t);fl.frequency.exponentialRampToValueAtTime(1100,t+dur*0.6);const ws=this.ctx.createWaveShaper();const wc=new Float32Array(256);for(let i=0;i<256;i++){const x=i*2/255-1;wc[i]=x*(1.5+Math.abs(x)*0.5)/(1+Math.abs(x)*2.0);}ws.curve=wc;ws.oversample='2x';const lfo=this.ctx.createOscillator();const lfog=this.ctx.createGain();lfo.type='sine';lfo.frequency.value=0.28+Math.random()*0.22;lfog.gain.value=7;lfo.connect(lfog);lfo.start(t);lfo.stop(t+dur+0.9);const pg=this.ctx.createGain();pg.gain.value=0.22;[-10,-4,0,4,10].forEach(dt=>{const o=this.ctx.createOscillator();o.setPeriodicWave(this.cinematicWave);o.frequency.value=fr;o.detune.value=dt;lfog.connect(o.detune);o.connect(pg);o.start(t);o.stop(t+dur+0.7);});pg.connect(ws);ws.connect(fl);const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.56,t+0.050);env.gain.exponentialRampToValueAtTime(vel*0.40,t+0.14);env.gain.exponentialRampToValueAtTime(vel*0.28,t+0.50);env.gain.exponentialRampToValueAtTime(vel*0.14,t+dur*0.80);env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.25);fl.connect(env);return env;}
_playAnalogPad(fr,vel,t,dur){const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.5;fl.frequency.setValueAtTime(800,t);fl.frequency.exponentialRampToValueAtTime(3200,t+0.30);fl.frequency.exponentialRampToValueAtTime(2200,t+dur*0.55);const lfo=this.ctx.createOscillator();const lfog=this.ctx.createGain();lfo.type='sine';lfo.frequency.value=0.35+Math.random()*0.12;lfog.gain.value=9;lfo.connect(lfog);lfo.start(t);lfo.stop(t+dur+1.4);const pg=this.ctx.createGain();pg.gain.value=0.15;[-24,-10,-4,0,4,10,24].forEach(dt=>{const o=this.ctx.createOscillator();o.setPeriodicWave(this.padWave);o.frequency.value=fr;o.detune.value=dt;lfog.connect(o.detune);o.connect(pg);o.start(t);o.stop(t+dur+1.2);});pg.connect(fl);const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.64,t+0.22);env.gain.exponentialRampToValueAtTime(vel*0.52,t+0.48);env.gain.exponentialRampToValueAtTime(vel*0.38,t+dur*0.72);env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.55);fl.connect(env);return env;}
_octaveDown(n){const m=n.match(/^([A-G][#b]?)(\d)$/);if(!m)return n;return m[1]+(parseInt(m[2])-1);}
_playBass(fr,vel,t,dur){const o=this.ctx.createOscillator();o.type='sine';o.frequency.value=fr;const lp=this.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=200;lp.Q.value=0.5;const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.55,t+0.04);env.gain.exponentialRampToValueAtTime(vel*0.30,t+0.15);env.gain.exponentialRampToValueAtTime(0.0001,t+dur);o.connect(lp);lp.connect(env);env.connect(this.mg);o.start(t);o.stop(t+dur+0.1);return env;}
playNote(n,dur=1.2,vel=0.42,st=null){this.init();if(!this.pianoWave||!this.cinematicWave||!this.padWave)this._buildWaves();const fr=typeof n==='number'?n:this.noteToFreq(n);const t=st||(this.ctx.currentTime+0.15);const inst=this.instrument;const env=inst==='analog-pad'?this._playAnalogPad(fr,vel,t,dur):inst==='cinematic'?this._playCinematic(fr,vel,t,dur):this._playUnderwater(fr,vel,t,dur);env.connect(this.mg);if(inst==='cinematic'||inst==='analog-pad'){env.connect(this.rvStadium);}else{env.connect(this.rv);}return env;}
playChord(notes,dur=1.5,stg=0.018){this.init();if(!notes||!notes.length)return;const now=this.ctx.currentTime;const dead=this.noteEnvs.slice();dead.forEach(e=>{try{e.gain.cancelScheduledValues(now);e.gain.setTargetAtTime(0,now,0.015);}catch(x){}});setTimeout(()=>{dead.forEach(e=>{try{e.disconnect();}catch(x){}});},60);this.noteEnvs=[];const t=now+0.015;const bassNote=this._octaveDown(notes[0]);const be=this._playBass(this.noteToFreq(bassNote),0.42,t,dur*0.80);if(be)this.noteEnvs.push(be);const effStg=this.instrument==='cinematic'?0:this.instrument==='underwater'?Math.min(stg,0.010):stg;notes.forEach((n,i)=>{const vel=0.42*(0.86+Math.random()*0.28);const jit=(Math.random()-0.5)*0.006;const e=this.playNote(n,dur,vel,t+i*effStg+jit);if(e)this.noteEnvs.push(e);});}
playClick(hi,st){this.init();const t=st||(this.ctx.currentTime+0.15);const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.value=hi?1400:900;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.25,t+0.002);g.gain.exponentialRampToValueAtTime(0.0001,t+0.08);o.connect(g);g.connect(this.mg);o.start(t);o.stop(t+0.1);}
playProgression(cl,bpm=72,cb,beats=4,stg=0.018){this.init();this.stop();this.isPlaying=true;let acc=0;cl.forEach((n,i)=>{const d=(60/bpm)*beats;this.tids.push(setTimeout(()=>{if(!this.isPlaying)return;if(n)this.playChord(n,d*0.88,stg);if(cb)cb(i);},acc*1000));acc+=d;});this.tids.push(setTimeout(()=>{this.isPlaying=false;if(cb)cb(-1);},acc*1000));}
playLoop(cl,bpm=72,cb,beats=4,stg=0.018){this.init();this.stop();this.isPlaying=true;const gen=++this._loopGen;const go=()=>{if(!this.isPlaying||this._loopGen!==gen)return;let acc=0;cl.forEach((n,i)=>{const d=(60/bpm)*beats;this.tids.push(setTimeout(()=>{if(!this.isPlaying||this._loopGen!==gen)return;if(n)this.playChord(n,d*0.88,stg);if(cb)cb(i);},acc*1000));acc+=d;});this.tids.push(setTimeout(()=>{if(this.isPlaying&&this._loopGen===gen)go();},acc*1000));};go();}
stop() { this.isPlaying=false; this.tids.forEach(t=>clearTimeout(t)); this.tids=[]; }
absoluteStop(){this.isPlaying=false;this.tids.forEach(t=>clearTimeout(t));this.tids=[];const now=this.ctx?this.ctx.currentTime:0;this.noteEnvs.forEach(e=>{try{e.gain.cancelScheduledValues(now);e.gain.setTargetAtTime(0,now,0.003);setTimeout(()=>{try{e.disconnect();}catch(x){}},80);}catch(x){}});this.noteEnvs=[];if(this.mg&&this.ctx){try{this.mg.gain.cancelScheduledValues(now);this.mg.gain.setValueAtTime(0,now);this.mg.gain.linearRampToValueAtTime(0.32,now+0.12);}catch(x){}}}
}
const audio=new AudioEngine();

// ─── MUSIC DATA & PURE FUNCTIONS ────────────────────────────
// Extracted to ./music.js — see imports at the top of this file.

const SOUNDS=[
  {id:'underwater',  emoji:'🌊', label:'Dreamy'},
  {id:'cinematic',   emoji:'🎬', label:'Bold'},
  {id:'analog-pad',  emoji:'🎹', label:'Warm'},
];

const EXAMPLE_LOOP={id:'example',k:'C major',prog:['C','G','Am','F'],bpm:100};

// ─── STYLES ─────────────────────────────────────────────────
const S={
  card:(bc='rgba(255,255,255,0.10)')=>({background:'rgba(255,255,255,0.04)',borderRadius:14,padding:14,border:`1px solid ${bc}`,marginBottom:12}),
  btn:(bg='rgba(255,255,255,0.08)',c='#fff',bc='rgba(255,255,255,0.14)')=>({background:bg,border:`1px solid ${bc}`,borderRadius:10,padding:'9px 14px',color:c,cursor:'pointer',fontSize:12,fontWeight:600,transition:'all 0.15s',minHeight:44}),
  lbl:{fontSize:9,color:'rgba(255,255,255,0.4)',fontWeight:700,textTransform:'uppercase',letterSpacing:1.2},
};

// ─── HOOKS ──────────────────────────────────────────────────
function useDragReorder(setProg){
  const[dragging,setDragging]=useState(null);
  const[dragOver,setDragOver]=useState(null);
  const longPressTimer=useRef(null);
  const onLongPressStart=useCallback((idx)=>{longPressTimer.current=setTimeout(()=>{setDragging(idx);if(navigator.vibrate)navigator.vibrate(40);},450);},[]);
  const onLongPressEnd=useCallback(()=>clearTimeout(longPressTimer.current),[]);
  const onDragEnter=useCallback((idx)=>{if(dragging===null)return;setDragOver(idx);},[dragging]);
  const onDrop=useCallback((toIdx)=>{if(dragging===null||dragging===toIdx){setDragging(null);setDragOver(null);return;}setProg(prev=>{const n=[...prev];const[it]=n.splice(dragging,1);n.splice(toIdx,0,it);return n;});setDragging(null);setDragOver(null);},[dragging,setProg]);
  const cancelDrag=useCallback(()=>{clearTimeout(longPressTimer.current);setDragging(null);setDragOver(null);},[]);
  return{dragging,dragOver,onLongPressStart,onLongPressEnd,onDragEnter,onDrop,cancelDrag};
}

// ═══════════════════════════════════════════════════════════════
// CHORD MAP SVG — memoized so it doesn't re-render on `pi` (playing
// index) ticks during playback. Only re-renders when the props that
// actually affect its visuals change.
// ═══════════════════════════════════════════════════════════════
const ChordMapSVG=memo(function ChordMapSVG({k,sch,ext,showTheory,swapIdx,sk,onTap}){
  const svgNodes=useMemo(()=>k?ml(k.ch,200,200,132):[],[k]);
  const connections=useMemo(()=>k?gcon(k.ch,k.m):[],[k]);
  const nodeByChord=useMemo(()=>{const m=new Map();svgNodes.forEach(n=>m.set(n.c,n));return m;},[svgNodes]);
  const bestNext=useMemo(()=>{if(!sch||!k)return new Set();const conns=gcon(k.ch,k.m).filter(c=>c.f===sch);const top=[...conns].sort((a,b)=>a.st==='strong'?-1:b.st==='strong'?1:0).slice(0,3).map(c=>c.t);return new Set(top);},[sch,k]);
  const homeChord=k?.ch[0];
  return(
    <div style={{background:'rgba(0,0,0,0.35)',borderRadius:22,padding:'8px 4px 4px',border:'1px solid rgba(167,139,250,0.12)',marginBottom:14,position:'relative'}}>
      <svg viewBox="0 0 400 400" style={{width:'100%',height:'auto',display:'block'}} role="group" aria-label={`Chord map in ${sk}`}>
        {connections.map((c,i)=>{
          const fn=nodeByChord.get(c.f),tn=nodeByChord.get(c.t);
          if(!fn||!tn)return null;
          const active=sch===c.f;
          const strong=c.st==='strong';
          // Strong lines are always visible as a subtle amber "highway" through the key.
          // Normal lines are near-invisible at rest, appear in purple when a chord is selected.
          const stroke = strong
            ? (active ? '#FBBF24' : 'rgba(251,191,36,0.35)')
            : (active ? 'rgba(167,139,250,0.65)' : 'rgba(255,255,255,0.05)');
          const strokeWidth = strong ? (active ? 1.9 : 1.2) : (active ? 1.4 : 0.6);
          return<line key={i} x1={fn.x} y1={fn.y} x2={tn.x} y2={tn.y} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round"/>;
        })}
        {svgNodes.map((nd,i)=>{
          const sel=sch===nd.c;
          const isHome=nd.c===homeChord;
          const isNext=bestNext.has(nd.c);
          const col=cc(nd.c);
          const displayLbl=ext&&ext!=='triad'?extChordLabel(k,nd.c,ext):nd.c;
          const rn=showTheory?chordRN(k,nd.c):'';
          return<g key={i} onClick={()=>onTap(nd.c)} style={{cursor:'pointer'}} role="button" aria-label={`${nd.c}${rn?` (${rn})`:''} — tap to play`}>
            {isNext&&<circle cx={nd.x} cy={nd.y} r="34" fill="none" stroke="#A78BFA" strokeWidth="1.5" strokeOpacity="0.45" strokeDasharray="4 3"/>}
            <circle cx={nd.x} cy={nd.y} r={sel?32:28} fill={sel?col:'rgba(0,0,0,0.55)'} stroke={sel?col:col+'80'} strokeWidth={sel?2.5:1.5} style={{filter:sel?`drop-shadow(0 0 12px ${col})`:'none',transition:'all 0.15s'}}/>
            <text x={nd.x} y={nd.y+2} textAnchor="middle" dominantBaseline="middle" fill={sel?'#fff':col} fontSize={sel?15:13} fontWeight="800" style={{pointerEvents:'none'}}>{displayLbl}</text>
            {isHome&&!sel&&<text x={nd.x} y={nd.y+46} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8" fontWeight="700" style={{pointerEvents:'none'}}>HOME</text>}
            {rn&&<text x={nd.x} y={nd.y+(sel?52:46)} textAnchor="middle" fill="rgba(167,139,250,0.65)" fontSize="9" fontWeight="600" style={{pointerEvents:'none'}}>{rn}</text>}
          </g>;
        })}
        <text x="200" y="196" textAnchor="middle" fill={swapIdx!==null?'#A78BFA':'rgba(255,255,255,0.32)'} fontSize="12" fontWeight="700">{sk}</text>
        <text x="200" y="212" textAnchor="middle" fill="rgba(255,255,255,0.22)" fontSize="8">{swapIdx!==null?`Tap map → replace slot ${swapIdx+1}`:'Tap a chord to add'}</text>
      </svg>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function HarmonyMap(){
const[screen,setScreen]=useState('play');
const[sk,setSk]=useState('C major');
const[prog,setProg]=useState(['C','G','Am','F']);
const[pi,setPi]=useState(-1);
const[saved,setSaved]=useState([]);
const[bpm,setBpm]=useState(90);
const[beats,setBeats]=useState(4);
const[inst,setInst]=useState('underwater');
const[progLooping,setProgLooping]=useState(false);
const[sch,setSch]=useState(null);
const[ext,setExt]=useState('triad');
const[swapIdx,setSwapIdx]=useState(null);
const[undoProg,setUndoProg]=useState(null);
const[showTheory,setShowTheory]=useState(false);
const[showKeyPicker,setShowKeyPicker]=useState(false);
const[showSound,setShowSound]=useState(false);
const[showBpm,setShowBpm]=useState(false);
const[activeMood,setActiveMood]=useState('hopeful');
const[tip,setTip]=useState(null);
const[showMapTip,setShowMapTip]=useState(false);
const stateDeb=useRef(null);
const loadedRef=useRef(false);

const k=KEYS[sk];

// Load state from localStorage once
useEffect(()=>{
  try{
    const s=localStorage.getItem('hm_saved');if(s)setSaved(JSON.parse(s));
    const st=localStorage.getItem('hm_state');
    if(st){
      const o=JSON.parse(st);
      if(o.sk&&KEYS[o.sk])setSk(o.sk);
      if(o.bpm)setBpm(o.bpm);
      if(o.beats)setBeats(o.beats);
      if(['underwater','cinematic','analog-pad'].includes(o.inst))setInst(o.inst);
      if(Array.isArray(o.prog)&&o.prog.length)setProg(o.prog);
      if(typeof o.showTheory==='boolean')setShowTheory(o.showTheory);
      if(o.ext)setExt(o.ext);
      if(o.activeMood)setActiveMood(o.activeMood);
    }
  }catch(e){}
  loadedRef.current=true;
},[]);

// First-visit chord map tip
useEffect(()=>{
  try{if(!localStorage.getItem('hm_tips_v1'))setShowMapTip(true);}catch(e){}
},[]);
const dismissMapTip=useCallback(()=>{setShowMapTip(false);try{localStorage.setItem('hm_tips_v1','1');}catch(e){}},[]);

// Persist saved ideas
useEffect(()=>{try{localStorage.setItem('hm_saved',JSON.stringify(saved));}catch(e){}},[saved]);

// Persist app state (debounced)
useEffect(()=>{
  if(!loadedRef.current)return;
  if(stateDeb.current)clearTimeout(stateDeb.current);
  stateDeb.current=setTimeout(()=>{
    try{localStorage.setItem('hm_state',JSON.stringify({sk,bpm,beats,inst,prog,showTheory,ext,activeMood}));}catch(e){}
  },400);
  return()=>{if(stateDeb.current)clearTimeout(stateDeb.current);};
},[sk,bpm,beats,inst,prog,showTheory,ext,activeMood]);

// Instrument change
useEffect(()=>{audio.setInstrument(inst);},[inst]);

// Warmup audio + auto-start the preloaded loop on the first user gesture.
// Browsers block autoplay before a gesture, so we wait for one, then start.
const autoStartedRef=useRef(false);
useEffect(()=>{
  const warmup=()=>{
    audio.init();
    if(autoStartedRef.current)return;
    autoStartedRef.current=true;
    if(progRef.current.length&&!progLoopingRef.current){
      const notes=progRef.current.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3));
      setProgLooping(true);
      audio.playLoop(notes,bpmRef.current,i=>setPi(i),4,0.018);
    }
  };
  const evts=['touchstart','mousedown','keydown'];
  evts.forEach(e=>document.addEventListener(e,warmup,{once:true,passive:true,capture:true}));
  return()=>evts.forEach(e=>document.removeEventListener(e,warmup,{capture:true}));
},[]);

// Auto-clear tip
useEffect(()=>{if(!tip)return;const t=setTimeout(()=>setTip(null),3200);return()=>clearTimeout(t);},[tip]);

// Latest-value refs — read inside stable callbacks / effects so we
// don't rebuild them on every prog/bpm/beats change.
const progRef=useRef(prog),bpmRef=useRef(bpm),beatsRef=useRef(beats),progLoopingRef=useRef(progLooping);
useEffect(()=>{progRef.current=prog;bpmRef.current=bpm;beatsRef.current=beats;progLoopingRef.current=progLooping;});

// ── Playback controls (stable identities — no prog/bpm/beats deps) ──
const stopAll=useCallback(()=>{audio.absoluteStop();setProgLooping(false);setPi(-1);},[]);
const loopP=useCallback(()=>{const p=progRef.current;const notes=p.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3));setProgLooping(true);audio.playLoop(notes,bpmRef.current,i=>setPi(i),beatsRef.current,0.018);},[]);
const playP=useCallback(()=>{const p=progRef.current;const notes=p.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3));audio.playProgression(notes,bpmRef.current,i=>setPi(i),beatsRef.current,0.018);},[]);
const togglePlay=useCallback(()=>{if(progLoopingRef.current)stopAll();else loopP();},[stopAll,loopP]);

// Re-loop when bpm or prog changes while looping (refs make this safe)
useEffect(()=>{if(progLoopingRef.current)loopP();},[bpm,beats,loopP]);

// ── Chord map interaction ──
const playChord=useCallback((s)=>{
  if(s==='REST'){audio.absoluteStop();setSch(null);return;}
  const lbl=extChordLabel(k,s,ext);
  audio.playChord(cn(pc(lbl).r,pc(lbl).t,3));
  setSch(s);
  if(swapIdx!==null){
    setProg(p=>{const n=[...p];n[swapIdx]=lbl;return n;});
    setSwapIdx(null);
  }else{
    setProg(p=>p.length>=16?p:[...p,lbl]);
  }
},[k,ext,swapIdx]);

// ── Progression strip ──
const remC=useCallback((i)=>{setProg(p=>p.filter((_,j)=>j!==i));setSwapIdx(cur=>cur===null?null:cur===i?null:cur>i?cur-1:cur);},[]);
const selectSlot=useCallback((i,c)=>{
  if(swapIdx===i){setSwapIdx(null);return;}
  if(swapIdx===null)setUndoProg(progRef.current);
  setSwapIdx(i);
  if(c&&c!=='REST'){audio.playChord(cn(pc(c).r,pc(c).t,3));}
},[swapIdx]);
const clearAll=useCallback(()=>{stopAll();setProg([]);setSch(null);setSwapIdx(null);setUndoProg(null);},[stopAll]);
const undoLast=useCallback(()=>{if(!undoProg)return;setProg(undoProg);setUndoProg(null);setSwapIdx(null);},[undoProg]);

// ── Mood chip ──
const loadMood=useCallback((m)=>{
  stopAll();
  setActiveMood(m.id);
  setSk(m.key);
  setBpm(m.bpm);
  setProg(m.prog);
  setSwapIdx(null);setUndoProg(null);setSch(null);
  setTip(`${m.emoji} ${m.label} preset loaded`);
  setTimeout(()=>{
    const notes=m.prog.map(s=>cn(pc(s).r,pc(s).t,3));
    setProgLooping(true);
    audio.playLoop(notes,m.bpm,i=>setPi(i),4,0.018);
  },140);
},[stopAll]);

// ── Save/Load/Export ──
const saveI=useCallback(()=>{if(!prog.length)return;setSaved(p=>[{id:Date.now(),k:sk,prog:[...prog],bpm,date:new Date().toLocaleDateString()},...p]);setTip('Saved to Library');},[prog,sk,bpm]);
const loadIdea=useCallback((idea)=>{stopAll();setSk(idea.k||'C major');setBpm(idea.bpm||90);setProg(idea.prog);setScreen('play');setTimeout(()=>{const notes=idea.prog.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3));setProgLooping(true);audio.playLoop(notes,idea.bpm||90,i=>setPi(i),4,0.018);},140);},[stopAll]);
const deleteIdea=useCallback((id)=>{setSaved(p=>p.filter(i=>i.id!==id));},[]);

// ── Drag reorder ──
const{dragging,dragOver,onLongPressStart,onLongPressEnd,onDragEnter,onDrop,cancelDrag}=useDragReorder(setProg);

// ── Suggest chord (uses the last chord in the loop, not the map selection) ──
const lastChord=prog[prog.length-1];
const suggestions=useMemo(()=>{if(!lastChord||!k)return[];const conns=gcon(k.ch,k.m).filter(c=>c.f===lastChord);return[...conns].sort((a,b)=>a.st==='strong'?-1:b.st==='strong'?1:0).slice(0,3).map(c=>c.t);},[lastChord,k]);
const suggest=useCallback(()=>{if(!suggestions.length||progRef.current.length>=16)return;const pick=suggestions[0];audio.playChord(cn(pc(pick).r,pc(pick).t,3));setProg(p=>[...p,pick]);setSch(pick);},[suggestions]);

const currentSound=SOUNDS.find(s=>s.id===inst)||SOUNDS[0];
const isAudioActive=progLooping||pi>=0;

return(
<div style={{minHeight:'100vh',background:'radial-gradient(ellipse at top,#1a0f2e 0%,#0a0518 60%,#000 100%)',color:'#fff',fontFamily:'system-ui,-apple-system,BlinkMacSystemFont,sans-serif',paddingBottom:80}}>

  {/* ── NAV ── */}
  <nav style={{position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'rgba(10,5,24,0.9)',backdropFilter:'blur(20px)',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div style={{width:26,height:26,borderRadius:'50%',background:'linear-gradient(135deg,#FB7185,#A78BFA,#5EEAD4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:900}}>H</div>
      <span style={{fontWeight:700,fontSize:14,letterSpacing:0.3}}>HarmonyMap</span>
    </div>
    <div style={{display:'flex',gap:4}}>
      {[{k:'play',l:'Play'},{k:'library',l:`Library${saved.length?' · '+saved.length:''}`}].map(t=>(
        <button key={t.k} onClick={()=>setScreen(t.k)} style={{background:screen===t.k?'rgba(167,139,250,0.16)':'transparent',border:'none',color:screen===t.k?'#A78BFA':'rgba(255,255,255,0.5)',borderRadius:8,padding:'8px 14px',cursor:'pointer',fontSize:12,fontWeight:screen===t.k?800:500,minHeight:44}}>{t.l}</button>
      ))}
    </div>
    {isAudioActive?
      <button onClick={stopAll} style={{background:'linear-gradient(135deg,#FF6B6B,#FF4444)',border:'none',borderRadius:8,padding:'7px 12px',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:800,boxShadow:'0 0 10px rgba(255,107,107,0.4)'}}>■ Stop</button>
      :<div style={{width:52}}/>}
  </nav>

  {/* ═══ PLAY SCREEN ═══ */}
  {screen==='play'&&<div style={{padding:'14px 14px 24px',maxWidth:560,margin:'0 auto'}}>

    {/* ── Mood chip row ── */}
    <div style={{display:'flex',gap:8,overflowX:'auto',marginBottom:14,padding:'2px 0',scrollbarWidth:'none',WebkitOverflowScrolling:'touch'}}>
      {MOODS.map(m=>{
        const active=activeMood===m.id;
        return(
          <button key={m.id} onClick={()=>loadMood(m)} style={{flexShrink:0,background:active?`${m.color}22`:'rgba(255,255,255,0.04)',border:`1.5px solid ${active?m.color+'80':'rgba(255,255,255,0.08)'}`,borderRadius:22,padding:'9px 14px',color:active?m.color:'rgba(255,255,255,0.75)',cursor:'pointer',fontSize:12,fontWeight:700,display:'flex',alignItems:'center',gap:6,boxShadow:active?`0 0 14px ${m.color}40`:'none',transition:'all 0.15s',minHeight:44}}>
            <span style={{fontSize:15}}>{m.emoji}</span>{m.label}
          </button>
        );
      })}
    </div>

    {/* ── Key pill ── */}
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
      <button onClick={()=>setShowKeyPicker(v=>!v)} style={{background:showKeyPicker?'rgba(167,139,250,0.16)':'rgba(255,255,255,0.05)',border:`1px solid ${showKeyPicker?'rgba(167,139,250,0.5)':'rgba(255,255,255,0.1)'}`,borderRadius:10,padding:'8px 14px',color:'#fff',cursor:'pointer',fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:6,minHeight:44}}>
        <span style={{color:'#A78BFA'}}>♪</span> {sk} <span style={{opacity:0.5,fontSize:10}}>▾</span>
      </button>
      {tip&&<div style={{fontSize:11,color:'rgba(255,255,255,0.6)',animation:'fadeIn 0.2s',flex:1,textAlign:'right',marginLeft:10}}>{tip}</div>}
    </div>

    {/* ── Key picker popover ── */}
    {showKeyPicker&&<div style={{background:'rgba(15,10,28,0.98)',border:'1px solid rgba(167,139,250,0.3)',borderRadius:14,padding:12,marginBottom:12,animation:'fadeIn 0.2s'}}>
      <div style={{...S.lbl,marginBottom:8}}>Major</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:12}}>
        {MAJOR_COF.map(kk=>{const active=sk===kk;const short=kk.replace(' major','');return<button key={kk} onClick={()=>{setSk(kk);setSch(null);}} style={{background:active?'rgba(255,107,157,0.2)':'rgba(255,255,255,0.04)',border:`1px solid ${active?'rgba(255,107,157,0.6)':'rgba(255,255,255,0.08)'}`,borderRadius:8,padding:'6px 10px',color:active?'#FF6B9D':'rgba(255,255,255,0.65)',cursor:'pointer',fontSize:12,fontWeight:active?800:600,minHeight:36}}>{short}</button>;})}
      </div>
      <div style={{...S.lbl,marginBottom:8}}>Minor</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
        {MINOR_COF.map(kk=>{const active=sk===kk;const short=kk.replace(' minor','m');return<button key={kk} onClick={()=>{setSk(kk);setSch(null);}} style={{background:active?'rgba(79,209,199,0.2)':'rgba(255,255,255,0.04)',border:`1px solid ${active?'rgba(79,209,199,0.6)':'rgba(255,255,255,0.08)'}`,borderRadius:8,padding:'6px 10px',color:active?'#4FD1C7':'rgba(255,255,255,0.65)',cursor:'pointer',fontSize:12,fontWeight:active?800:600,minHeight:36}}>{short}</button>;})}
      </div>
    </div>}

    {/* ── CHORD MAP (the hero — memoized subcomponent) ── */}
    <div style={{position:'relative'}}>
      <ChordMapSVG k={k} sch={sch} ext={ext} showTheory={showTheory} swapIdx={swapIdx} sk={sk} onTap={playChord}/>
      <button onClick={()=>setShowMapTip(true)} aria-label="What do the lines mean?" style={{position:'absolute',top:12,right:12,width:32,height:32,borderRadius:'50%',background:'rgba(15,10,28,0.7)',border:'1px solid rgba(255,255,255,0.12)',color:'rgba(255,255,255,0.55)',cursor:'pointer',fontSize:13,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:0,backdropFilter:'blur(6px)'}}>?</button>
      {showMapTip&&(
        <div role="dialog" aria-label="Chord map guide" style={{position:'absolute',top:12,left:12,right:12,background:'rgba(15,10,28,0.97)',border:'1px solid rgba(251,191,36,0.4)',borderRadius:14,padding:'14px 16px',boxShadow:'0 8px 32px rgba(0,0,0,0.6)',animation:'fadeIn 0.2s',zIndex:10}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
            <div style={{fontSize:20,lineHeight:1,marginTop:1}}>🎵</div>
            <div style={{flex:1,fontSize:12,color:'rgba(255,255,255,0.85)',lineHeight:1.5}}>
              <div style={{fontWeight:800,marginBottom:4,color:'#FBBF24'}}>Reading the chord map</div>
              The <span style={{color:'#FBBF24',fontWeight:700}}>gold lines</span> show the strongest chord movements — the ones that sound like they resolve, like V→I. Tap any chord to hear it and see where it wants to go next.
            </div>
          </div>
          <button onClick={dismissMapTip} style={{marginTop:12,width:'100%',background:'rgba(251,191,36,0.15)',border:'1px solid rgba(251,191,36,0.4)',borderRadius:8,padding:'8px',color:'#FBBF24',cursor:'pointer',fontSize:11,fontWeight:700,minHeight:36}}>Got it</button>
        </div>
      )}
    </div>

    {/* ── PROGRESSION STRIP ── */}
    <div style={{background:'rgba(0,0,0,0.3)',borderRadius:14,padding:'10px 12px',marginBottom:14,border:'1px solid rgba(255,255,255,0.05)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{...S.lbl}}>Loop {prog.length>0&&`· ${prog.length}/16`}</span>
        <div style={{display:'flex',gap:6}}>
          {undoProg&&<button onClick={undoLast} style={{background:'rgba(139,92,246,0.12)',border:'1px solid rgba(139,92,246,0.3)',borderRadius:8,padding:'5px 10px',color:'#8B5CF6',cursor:'pointer',fontSize:10,fontWeight:700,minHeight:32}}>↩ Undo</button>}
          {prog.length>0&&<button onClick={clearAll} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'5px 10px',color:'rgba(255,255,255,0.5)',cursor:'pointer',fontSize:10,fontWeight:700,minHeight:32}}>Clear</button>}
        </div>
      </div>
      {prog.length===0?
        <div style={{textAlign:'center',padding:'22px 0',color:'rgba(255,255,255,0.28)',fontSize:12}}>Pick a mood above, or tap a chord on the map ↑</div>
        :<div style={{display:'flex',gap:6,overflowX:'auto',padding:'4px 0',scrollbarWidth:'none',WebkitOverflowScrolling:'touch'}}>
          {prog.map((c,i)=>{
            const active=pi===i;
            const inSwap=swapIdx===i;
            const isDrag=dragging===i,isOver=dragOver===i;
            const col=cc(c);
            return<div key={i} onPointerDown={()=>onLongPressStart(i)} onPointerUp={()=>{onLongPressEnd();if(dragging===null)selectSlot(i,c);else onDrop(i);}} onPointerLeave={()=>{onLongPressEnd();cancelDrag();}} onPointerEnter={()=>onDragEnter(i)} style={{position:'relative',flexShrink:0,minWidth:60}}>
              <div style={{background:inSwap?'rgba(167,139,250,0.18)':col+'20',border:`${active?2.5:1.5}px solid ${inSwap?'#A78BFA':active?col:col+'55'}`,borderRadius:12,padding:'10px 12px',cursor:'pointer',boxShadow:active?`0 0 16px ${col}70`:inSwap?'0 0 12px rgba(167,139,250,0.6)':'none',transform:isDrag?'scale(1.08)':isOver?'scale(1.04)':active?'scale(1.05)':'scale(1)',opacity:isDrag?0.6:1,transition:'all 0.15s',textAlign:'center'}}>
                <div style={{fontSize:14,fontWeight:800,color:active||inSwap?'#fff':col}}>{c}</div>
                <div style={{fontSize:8,color:'rgba(255,255,255,0.28)',marginTop:2}}>{i+1}</div>
              </div>
              <button onClick={e=>{e.stopPropagation();remC(i);}} style={{position:'absolute',top:-7,right:-7,background:'rgba(255,80,80,0.9)',border:'none',borderRadius:'50%',width:22,height:22,color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',lineHeight:1,padding:0,zIndex:2}}>×</button>
            </div>;
          })}
        </div>}
    </div>

    {/* ── PRIMARY PLAY BUTTON + SAVE ── */}
    <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'stretch'}}>
      <button onClick={togglePlay} disabled={prog.length===0} className={!progLooping&&prog.length>0&&!isAudioActive?'hm-pulse':''} style={{flex:1,background:progLooping?'linear-gradient(135deg,#FF6B6B,#FF4444)':prog.length===0?'rgba(255,255,255,0.06)':'linear-gradient(135deg,#A78BFA,#8B5CF6)',border:'none',borderRadius:14,padding:'16px',color:'#fff',cursor:prog.length===0?'not-allowed':'pointer',fontSize:16,fontWeight:800,minHeight:56,boxShadow:progLooping?'0 4px 20px rgba(255,107,107,0.4)':prog.length===0?'none':'0 4px 20px rgba(167,139,250,0.35)',opacity:prog.length===0?0.5:1,transition:'all 0.15s',letterSpacing:0.5}}>
        {progLooping?'■ Stop Loop':'▶ Play Loop'}
      </button>
      <button onClick={saveI} disabled={prog.length===0} aria-label="Save loop to library" style={{width:56,height:56,borderRadius:'50%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.12)',color:prog.length===0?'rgba(255,255,255,0.2)':'#A78BFA',cursor:prog.length===0?'not-allowed':'pointer',fontSize:20,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>♡</button>
    </div>

    {/* ── SUGGEST CHIP (Scaler/Captain "one-click exploration") ── */}
    {suggestions.length>0&&prog.length>0&&prog.length<16&&(
      <button onClick={suggest} style={{width:'100%',background:'rgba(167,139,250,0.10)',border:'1px dashed rgba(167,139,250,0.5)',borderRadius:12,padding:'10px',color:'#A78BFA',cursor:'pointer',fontSize:12,fontWeight:700,marginBottom:14,minHeight:44,transition:'all 0.15s'}}>
        + Suggest a chord <span style={{opacity:0.65,fontWeight:600}}>· {suggestions[0]}</span>
      </button>
    )}

    {/* ── INLINE SETTINGS (was Details drawer) ── */}
    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',justifyContent:'center',marginTop:8}}>
      <div style={{display:'flex',background:'rgba(255,255,255,0.04)',borderRadius:8,padding:2,border:'1px solid rgba(255,255,255,0.06)'}}>
        {[{v:'triad',l:'Basic'},{v:'7ths',l:'Lush'}].map(o=>(
          <button key={o.v} onClick={()=>setExt(o.v)} style={{background:ext===o.v?'rgba(167,139,250,0.2)':'transparent',border:'none',borderRadius:6,padding:'6px 12px',color:ext===o.v?'#A78BFA':'rgba(255,255,255,0.55)',cursor:'pointer',fontSize:11,fontWeight:700,minHeight:36}}>{o.l}</button>
        ))}
      </div>
      <button onClick={()=>setShowTheory(v=>!v)} aria-pressed={showTheory} style={{background:showTheory?'rgba(167,139,250,0.16)':'rgba(255,255,255,0.04)',border:`1px solid ${showTheory?'rgba(167,139,250,0.4)':'rgba(255,255,255,0.06)'}`,borderRadius:8,padding:'6px 12px',color:showTheory?'#A78BFA':'rgba(255,255,255,0.55)',cursor:'pointer',fontSize:11,fontWeight:600,minHeight:40}}>
        {showTheory?'Theory ✓':'Theory'}
      </button>
      <button onClick={()=>exportMIDI(prog,bpm,beats)} disabled={prog.length===0} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.06)',borderRadius:8,padding:'6px 12px',color:prog.length===0?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.55)',cursor:prog.length===0?'not-allowed':'pointer',fontSize:11,fontWeight:600,minHeight:40}}>⬇ MIDI</button>
    </div>

  </div>}

  {/* ═══ LIBRARY SCREEN ═══ */}
  {screen==='library'&&<div style={{padding:'14px 14px 24px',maxWidth:560,margin:'0 auto'}}>
    <h2 style={{fontSize:20,fontWeight:800,margin:'6px 0 14px',color:'#fff'}}>Your Loops</h2>
    {saved.length===0?
      <>
        <div style={{padding:'14px 0 10px',color:'rgba(255,255,255,0.5)',fontSize:12,textAlign:'center'}}>No saved loops yet — here's an example to try:</div>
        <div style={{background:'rgba(255,255,255,0.04)',border:'1px dashed rgba(167,139,250,0.4)',borderRadius:14,padding:14,marginBottom:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:'#A78BFA'}}>{EXAMPLE_LOOP.k}</div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginTop:2}}>Example · {EXAMPLE_LOOP.bpm} BPM</div>
            </div>
            <span style={{fontSize:9,color:'rgba(167,139,250,0.8)',fontWeight:700,textTransform:'uppercase',letterSpacing:1,background:'rgba(167,139,250,0.12)',padding:'3px 8px',borderRadius:6}}>Try it</span>
          </div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
            {EXAMPLE_LOOP.prog.map((c,j)=>(
              <span key={j} style={{background:cc(c)+'20',border:`1px solid ${cc(c)}50`,borderRadius:8,padding:'5px 10px',fontSize:11,color:cc(c),fontWeight:700}}>{c}</span>
            ))}
          </div>
          <button onClick={()=>loadIdea(EXAMPLE_LOOP)} style={{width:'100%',...S.btn('rgba(167,139,250,0.16)','#A78BFA','rgba(167,139,250,0.4)')}}>▶ Load & Play</button>
        </div>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',textAlign:'center',lineHeight:1.5}}>Build your own loop on Play, then tap ♡ to save it here.</div>
      </>
      :saved.map(idea=>(
        <div key={idea.id} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:14,marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:'#A78BFA'}}>{idea.k}</div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginTop:2}}>{idea.date} · {idea.bpm||90} BPM</div>
            </div>
            <button onClick={()=>deleteIdea(idea.id)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:18,padding:6,minHeight:44,minWidth:32}}>×</button>
          </div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
            {idea.prog.map((c,j)=>(
              <span key={j} style={{background:cc(c)+'20',border:`1px solid ${cc(c)}50`,borderRadius:8,padding:'5px 10px',fontSize:11,color:cc(c),fontWeight:700}}>{c}</span>
            ))}
          </div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>loadIdea(idea)} style={{flex:2,...S.btn('rgba(167,139,250,0.16)','#A78BFA','rgba(167,139,250,0.4)')}}>▶ Load & Play</button>
            <button onClick={()=>exportMIDI(idea.prog,idea.bpm||90,4)} style={{flex:1,...S.btn()}}>⬇ MIDI</button>
            <button onClick={()=>{const txt=`🎵 ${idea.k}\n${idea.prog.join(' → ')}\n${idea.date}`;try{navigator.clipboard.writeText(txt);setTip('Copied!');}catch(e){setTip('Copy failed');}}} style={{flex:1,...S.btn()}}>📋</button>
          </div>
        </div>
      ))
    }
  </div>}

  {/* ═══ BOTTOM BAR — compact status chips ═══ */}
  <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:90,background:'rgba(10,5,24,0.96)',backdropFilter:'blur(24px)',borderTop:'1px solid rgba(255,255,255,0.06)',padding:'10px 14px',display:'flex',alignItems:'center',gap:10}}>
    <div style={{position:'relative'}}>
      <button onClick={()=>{setShowBpm(v=>!v);setShowSound(false);}} aria-expanded={showBpm} style={{background:showBpm?'rgba(167,139,250,0.16)':'rgba(255,255,255,0.05)',border:`1px solid ${showBpm?'rgba(167,139,250,0.4)':'rgba(255,255,255,0.08)'}`,borderRadius:8,padding:'8px 12px',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:700,minHeight:44,display:'flex',alignItems:'center',gap:5}}>
        {bpm} <span style={{fontSize:9,color:'rgba(255,255,255,0.4)',fontWeight:600,letterSpacing:0.5}}>BPM</span> <span style={{fontSize:9,opacity:0.5}}>▾</span>
      </button>
      {showBpm&&<div style={{position:'absolute',bottom:52,left:0,minWidth:200,background:'rgba(15,10,28,0.98)',border:'1px solid rgba(167,139,250,0.3)',borderRadius:12,padding:10,animation:'fadeIn 0.15s'}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <button onClick={()=>setBpm(b=>Math.max(40,b-5))} aria-label="Decrease BPM" style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.08)',border:'none',color:'#fff',cursor:'pointer',fontSize:16}}>−</button>
          <input type="number" value={bpm} onChange={e=>{const v=Math.max(40,Math.min(200,parseInt(e.target.value)||90));setBpm(v);}} aria-label="BPM" style={{flex:1,fontSize:22,fontWeight:900,color:'#A78BFA',textAlign:'center',background:'transparent',border:'none',outline:'none',width:'100%'}}/>
          <button onClick={()=>setBpm(b=>Math.min(200,b+5))} aria-label="Increase BPM" style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.08)',border:'none',color:'#fff',cursor:'pointer',fontSize:16}}>+</button>
        </div>
      </div>}
    </div>
    <div style={{position:'relative'}}>
      <button onClick={()=>{setShowSound(v=>!v);setShowBpm(false);}} aria-expanded={showSound} style={{background:showSound?'rgba(167,139,250,0.16)':'rgba(255,255,255,0.05)',border:`1px solid ${showSound?'rgba(167,139,250,0.4)':'rgba(255,255,255,0.08)'}`,borderRadius:8,padding:'8px 12px',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:700,minHeight:44,display:'flex',alignItems:'center',gap:5}}>
        {currentSound.emoji} {currentSound.label} <span style={{fontSize:9,opacity:0.5}}>▾</span>
      </button>
      {showSound&&<div style={{position:'absolute',bottom:52,left:0,minWidth:160,background:'rgba(15,10,28,0.98)',border:'1px solid rgba(167,139,250,0.3)',borderRadius:12,padding:6,animation:'fadeIn 0.15s'}}>
        {SOUNDS.map(s=>(
          <button key={s.id} onClick={()=>{setInst(s.id);setShowSound(false);}} style={{width:'100%',background:inst===s.id?'rgba(167,139,250,0.16)':'transparent',border:'none',borderRadius:8,padding:'8px 10px',color:inst===s.id?'#A78BFA':'#fff',cursor:'pointer',fontSize:12,fontWeight:600,textAlign:'left',minHeight:40}}>{s.emoji} {s.label}</button>
        ))}
      </div>}
    </div>
  </div>

  {/* ═══ Global CSS ═══ */}
  <style>{`
    @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    @keyframes hmPulse{0%,100%{transform:scale(1);box-shadow:0 4px 20px rgba(167,139,250,0.35)}50%{transform:scale(1.015);box-shadow:0 4px 28px rgba(167,139,250,0.55)}}
    .hm-pulse{animation:hmPulse 1.6s ease-in-out infinite}
    body{margin:0;padding:0;overscroll-behavior:none;}
    button{-webkit-tap-highlight-color:transparent;font-family:inherit;}
    input{font-family:inherit;}
    ::-webkit-scrollbar{display:none}
    input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
    input[type=number]{-moz-appearance:textfield;}
    @media (prefers-reduced-motion: reduce){
      *,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important;}
    }
  `}</style>
</div>);}
