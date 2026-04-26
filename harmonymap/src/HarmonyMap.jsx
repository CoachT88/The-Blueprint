import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════
HARMONYMAP v5 — "Find Yourself in Sound"
NEW: Floating Playbar, Floating Metronome, Voice Memo,
Long-Press Drag Reorder, Progression Grid moved up
═══════════════════════════════════════════════════════════════ */

// ─── AUDIO ENGINE ───────────────────────────────────────────
class AudioEngine {
constructor() { this.ctx=null; this.mg=null; this.rv=null; this.rvStadium=null; this.isPlaying=false; this.tids=[]; this.instrument='underwater'; this.pianoWave=null; this.cinematicWave=null; this.padWave=null; this.noteEnvs=[]; }
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
masterLP.type='lowpass';masterLP.frequency.value=2800;masterLP.Q.value=0.7;
const rvBuf=this._buildReverbBuffer(1.2,4.0);
const rvConv=this.ctx.createConvolver();rvConv.buffer=rvBuf;
const rvSendLP=this.ctx.createBiquadFilter();
rvSendLP.type='lowpass';rvSendLP.frequency.value=600;rvSendLP.Q.value=0.5;
const rvGain=this.ctx.createGain();rvGain.gain.value=0.07;
rvSendLP.connect(rvConv);rvConv.connect(rvGain);rvGain.connect(masterLP);
const stBuf=this._buildReverbBuffer(2.8,1.8);
const stConv=this.ctx.createConvolver();stConv.buffer=stBuf;
const stSendLP=this.ctx.createBiquadFilter();
stSendLP.type='lowpass';stSendLP.frequency.value=1400;stSendLP.Q.value=0.5;
const stGain=this.ctx.createGain();stGain.gain.value=0.28;
stSendLP.connect(stConv);stConv.connect(stGain);stGain.connect(masterLP);
const clip=this.ctx.createWaveShaper();const cv=new Float32Array(256);for(let i=0;i<256;i++){const x=i*2/255-1;cv[i]=Math.tanh(x*2.5)/Math.tanh(2.5);}clip.curve=cv;clip.oversample='4x';
this.mg.connect(comp);comp.connect(masterLP);masterLP.connect(clip);clip.connect(this.ctx.destination);
this.rv=rvSendLP;this.rvStadium=stSendLP;
this._buildWaves();
}
_buildWaves(){
if(!this.pianoWave){const pa=[0,1.0,0.55,0.30,0.16,0.10,0.068,0.044,0.030,0.020,0.013,0.009,0.006,0.004];const N=pa.length,pr=new Float32Array(N),pi=new Float32Array(N);for(let i=1;i<N;i++)pr[i]=pa[i];this.pianoWave=this.ctx.createPeriodicWave(pr,pi,{disableNormalization:false});}
if(!this.cinematicWave){const N=16;const cr=new Float32Array(N),ci=new Float32Array(N);for(let i=1;i<N;i++){cr[i]=0;ci[i]=-(1/i)*(i%2===1?1.4:0.8);}this.cinematicWave=this.ctx.createPeriodicWave(cr,ci,{disableNormalization:false});}
if(!this.padWave){const N=22;const pr=new Float32Array(N),pi2=new Float32Array(N);for(let i=1;i<N;i++){const sq=i%2===1?1.28:0.72;pi2[i]=-(1/i)*sq*(1-i/N*0.35);}this.padWave=this.ctx.createPeriodicWave(pr,pi2,{disableNormalization:false});}
}
_buildReverbBuffer(dur,decay=3.6){const sr=this.ctx.sampleRate,len=Math.floor(sr*dur),pre=Math.floor(sr*0.018);const buf=this.ctx.createBuffer(2,len,sr);for(let ch=0;ch<2;ch++){const d=buf.getChannelData(ch);for(let i=pre;i<len;i++){const t=(i-pre)/sr;d[i]=(Math.random()*2-1)*Math.exp(-t*decay);}}return buf;}
setInstrument(name){this.instrument=name;}
noteToFreq(n) {const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};const m=n.match(/^([A-G][#b]?)(\d)$/); if(!m) return 440;return 440*Math.pow(2,(M[m[1]]-9+(parseInt(m[2])-4)*12)/12);}
_playUnderwater(fr,vel,t,dur){const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.6;fl.frequency.setValueAtTime(700,t);fl.frequency.linearRampToValueAtTime(580,t+dur*0.65);[-7,0,7].forEach(dt=>{const o=this.ctx.createOscillator();o.setPeriodicWave(this.pianoWave);o.frequency.value=fr;o.detune.value=dt;o.connect(fl);o.start(t);o.stop(t+dur+0.4);});const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.52,t+0.045);env.gain.exponentialRampToValueAtTime(vel*0.34,t+0.12);env.gain.exponentialRampToValueAtTime(vel*0.20,t+0.55);env.gain.exponentialRampToValueAtTime(vel*0.09,t+dur*0.85);env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.1);fl.connect(env);return env;}
_playCinematic(fr,vel,t,dur){const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.65;fl.frequency.setValueAtTime(1600,t);fl.frequency.exponentialRampToValueAtTime(1100,t+dur*0.6);const ws=this.ctx.createWaveShaper();const wc=new Float32Array(256);for(let i=0;i<256;i++){const x=i*2/255-1;wc[i]=x*(1.5+Math.abs(x)*0.5)/(1+Math.abs(x)*2.0);}ws.curve=wc;ws.oversample='2x';const lfo=this.ctx.createOscillator();const lfog=this.ctx.createGain();lfo.type='sine';lfo.frequency.value=0.28+Math.random()*0.22;lfog.gain.value=16;lfo.connect(lfog);lfo.start(t);lfo.stop(t+dur+0.9);const pg=this.ctx.createGain();pg.gain.value=0.22;[-20,-7,0,7,20].forEach(dt=>{const o=this.ctx.createOscillator();o.setPeriodicWave(this.cinematicWave);o.frequency.value=fr;o.detune.value=dt;lfog.connect(o.detune);o.connect(pg);o.start(t);o.stop(t+dur+0.7);});pg.connect(ws);ws.connect(fl);const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.56,t+0.050);env.gain.exponentialRampToValueAtTime(vel*0.40,t+0.14);env.gain.exponentialRampToValueAtTime(vel*0.28,t+0.50);env.gain.exponentialRampToValueAtTime(vel*0.14,t+dur*0.80);env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.25);fl.connect(env);return env;}
_playAnalogPad(fr,vel,t,dur){const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.5;fl.frequency.setValueAtTime(800,t);fl.frequency.exponentialRampToValueAtTime(3200,t+0.30);fl.frequency.exponentialRampToValueAtTime(2200,t+dur*0.55);const lfo=this.ctx.createOscillator();const lfog=this.ctx.createGain();lfo.type='sine';lfo.frequency.value=0.35+Math.random()*0.12;lfog.gain.value=9;lfo.connect(lfog);lfo.start(t);lfo.stop(t+dur+1.4);const pg=this.ctx.createGain();pg.gain.value=0.15;[-24,-10,-4,0,4,10,24].forEach(dt=>{const o=this.ctx.createOscillator();o.setPeriodicWave(this.padWave);o.frequency.value=fr;o.detune.value=dt;lfog.connect(o.detune);o.connect(pg);o.start(t);o.stop(t+dur+1.2);});pg.connect(fl);const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.64,t+0.22);env.gain.exponentialRampToValueAtTime(vel*0.52,t+0.48);env.gain.exponentialRampToValueAtTime(vel*0.38,t+dur*0.72);env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.55);fl.connect(env);return env;}
_octaveDown(n){const m=n.match(/^([A-G][#b]?)(\d)$/);if(!m)return n;return m[1]+(parseInt(m[2])-1);}
_playBass(fr,vel,t,dur){const o=this.ctx.createOscillator();o.type='sine';o.frequency.value=fr;const lp=this.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=200;lp.Q.value=0.5;const env=this.ctx.createGain();env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.55,t+0.04);env.gain.exponentialRampToValueAtTime(vel*0.30,t+0.15);env.gain.exponentialRampToValueAtTime(0.0001,t+dur);o.connect(lp);lp.connect(env);env.connect(this.mg);o.start(t);o.stop(t+dur+0.1);return env;}
playNote(n,dur=1.2,vel=0.42,st=null){this.init();if(!this.pianoWave||!this.cinematicWave||!this.padWave)this._buildWaves();const fr=typeof n==='number'?n:this.noteToFreq(n);const t=st||(this.ctx.currentTime+0.15);const inst=this.instrument;const env=inst==='analog-pad'?this._playAnalogPad(fr,vel,t,dur):inst==='cinematic'?this._playCinematic(fr,vel,t,dur):this._playUnderwater(fr,vel,t,dur);env.connect(this.mg);if(inst==='cinematic'||inst==='analog-pad'){env.connect(this.rvStadium);}else{env.connect(this.rv);}return env;}
playChord(notes,dur=1.5,stg=0.018){this.init();if(!notes||!notes.length)return;const now=this.ctx.currentTime;const dead=this.noteEnvs.slice();dead.forEach(e=>{try{e.gain.cancelScheduledValues(now);e.gain.setTargetAtTime(0,now,0.015);}catch(x){}});setTimeout(()=>{dead.forEach(e=>{try{e.disconnect();}catch(x){}});},200);this.noteEnvs=[];const t=now+0.015;const bassNote=(this.instrument==='cinematic'||this.instrument==='analog-pad')?this._octaveDown(this._octaveDown(notes[0])):this._octaveDown(notes[0]);const be=this._playBass(this.noteToFreq(bassNote),0.42,t,dur*0.80);if(be)this.noteEnvs.push(be);notes.forEach((n,i)=>{const vel=0.42*(0.86+Math.random()*0.28);const jit=(Math.random()-0.5)*0.006;const e=this.playNote(n,dur,vel,t+i*stg+jit);if(e)this.noteEnvs.push(e);});}
playClick(hi,st){this.init();const t=st||(this.ctx.currentTime+0.15);const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.value=hi?1400:900;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.25,t+0.002);g.gain.exponentialRampToValueAtTime(0.0001,t+0.08);o.connect(g);g.connect(this.mg);o.start(t);o.stop(t+0.1);}
countIn(bpm,beats,cb){this.init();const d=60/bpm;const t0=this.ctx.currentTime;for(let i=0;i<beats;i++)this.playClick(i===0,t0+i*d);const id=setTimeout(cb,beats*d*1000);this.tids.push(id);}
playInterval(a,b,dur=1.8) { this.init(); const t=this.ctx.currentTime+0.15; this.playNote(a,dur,0.4,t); this.playNote(b,dur,0.4,t+0.01); }
playMelodicInterval(a,b,dur=0.8) { this.init(); const t=this.ctx.currentTime+0.15; this.playNote(a,dur,0.45,t); this.playNote(b,dur,0.45,t+dur*0.7); }
playProgression(cl,bpm=72,cb,beats=4,stg=0.018,beatPat=null){this.init();this.stop();this.isPlaying=true;let acc=0;cl.forEach((n,i)=>{const b=beatPat?beatPat[i%beatPat.length]:beats;const d=(60/bpm)*b;this.tids.push(setTimeout(()=>{if(!this.isPlaying)return;if(n)this.playChord(n,d*0.88,stg);if(cb)cb(i);},acc*1000));acc+=d;});this.tids.push(setTimeout(()=>{this.isPlaying=false;if(cb)cb(-1);},acc*1000));}
playLoop(cl,bpm=72,cb,beats=4,stg=0.018,beatPat=null){this.init();this.stop();this.isPlaying=true;const go=()=>{if(!this.isPlaying)return;let acc=0;cl.forEach((n,i)=>{const b=beatPat?beatPat[i%beatPat.length]:beats;const d=(60/bpm)*b;this.tids.push(setTimeout(()=>{if(!this.isPlaying)return;if(n)this.playChord(n,d*0.88,stg);if(cb)cb(i);},acc*1000));acc+=d;});this.tids.push(setTimeout(()=>{if(this.isPlaying)go();},acc*1000));};go();}
stop() { this.isPlaying=false; this.tids.forEach(t=>clearTimeout(t)); this.tids=[]; }
absoluteStop(){this.isPlaying=false;this.tids.forEach(t=>clearTimeout(t));this.tids=[];const now=this.ctx?this.ctx.currentTime:0;this.noteEnvs.forEach(e=>{try{e.gain.cancelScheduledValues(now);e.gain.setTargetAtTime(0,now,0.003);setTimeout(()=>{try{e.disconnect();}catch(x){}},80);}catch(x){}});this.noteEnvs=[];if(this.mg&&this.ctx){try{this.mg.gain.cancelScheduledValues(now);this.mg.gain.setValueAtTime(0,now);this.mg.gain.linearRampToValueAtTime(0.32,now+0.12);}catch(x){}}}
play808(n,dur=2.0,vel=0.85,st=null){this.init(); const base=typeof n==='number'?n:this.noteToFreq((typeof n==='string'&&!/\d/.test(n))?n+'2':n); const t=st||(this.ctx.currentTime+0.15);const o=this.ctx.createOscillator(),g=this.ctx.createGain(),lp=this.ctx.createBiquadFilter();o.type='sine'; o.frequency.setValueAtTime(base*2.5,t); o.frequency.exponentialRampToValueAtTime(base,t+0.06);lp.type='lowpass'; lp.frequency.value=180; lp.Q.value=0.5;g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vel*0.95,t+0.008); g.gain.exponentialRampToValueAtTime(vel*0.5,t+0.25); g.gain.exponentialRampToValueAtTime(0.001,t+dur);o.connect(lp); lp.connect(g); g.connect(this.mg);o.start(t); o.stop(t+dur+0.1);}
playMelody(notes,bpm=100,cb){this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*0.5;notes.forEach((n,i)=>{ const t=setTimeout(()=>{if(!this.isPlaying)return; if(n&&n!=='REST')this.playNote(n+'4',d*0.75,0.5); if(cb)cb(i);},i*d*1000); this.tids.push(t); });this.tids.push(setTimeout(()=>{this.isPlaying=false; if(cb)cb(-1);},notes.length*d*1000));}
loopMelody(notes,bpm=100,cb){this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*0.5; const tot=notes.length*d*1000;const go=()=>{if(!this.isPlaying)return; notes.forEach((n,i)=>{this.tids.push(setTimeout(()=>{if(!this.isPlaying)return; if(n&&n!=='REST')this.playNote(n+'4',d*0.75,0.5); if(cb)cb(i);},i*d*1000));});this.tids.push(setTimeout(()=>{if(this.isPlaying)go();},tot));};go();}
}
const audio=new AudioEngine();
function genreNotes(sym,genre){const{r,t}=pc(sym);const oct=(genre==='trap'||genre==='hiphop')?2:3;if((genre==='90s-rnb'||genre==='rnb'||genre==='lofi')&&CT[t]){const rt=t==='major'?'maj7':t==='minor'?'min7':t==='dominant'?'dom7':t;return cn(r,CT[rt]?rt:t,oct);}return cn(r,t,oct);}
function idProg(ch){if(!ch||ch.length<3)return null;const ts=ch.map(c=>pc(c).t);const pat=ts.map(t=>({major:'M',minor:'m',diminished:'d',dominant:'7',suspended:'s',augmented:'a'})[t]||'?').join('');const names={'MmMm':'I–V–vi–IV (Pop Axis)','mMmM':'vi–IV–I–V (Emotional Pop)','MMmm':'I–IV–vi–V (Classic)','mmMM':'i–VII–VI–VII (Trap Loop)','mMMm':'i–III–VII–iv (Melodic)','MmmM':'I–ii–iii–IV (Ascending)','7MMM':'V–I–IV–I (Gospel)','MMmM':'I–V–vi–IV','mmmM':'i–iv–VII–III (Minor Cycle)'};return names[pat]||null;}

// ─── MUSIC DATA ─────────────────────────────────────────────
const NN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FN=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const ENH={Cb:'B',Fb:'E','E#':'F','B#':'C'};
const CT={major:{iv:[0,4,7],q:'major'},minor:{iv:[0,3,7],q:'minor'},dim:{iv:[0,3,6],q:'diminished'},aug:{iv:[0,4,8],q:'augmented'},dom7:{iv:[0,4,7,10],q:'dominant'},maj7:{iv:[0,4,7,11],q:'major'},min7:{iv:[0,3,7,10],q:'minor'},'m7b5':{iv:[0,3,6,10],q:'diminished'},sus2:{iv:[0,2,7],q:'suspended'},sus4:{iv:[0,5,7],q:'suspended'},add9:{iv:[0,4,7,14],q:'major'},power:{iv:[0,7],q:'power'},single:{iv:[0],q:'single'}};
function cn(root,type,oct=4){const r=ENH[root]||root;const ri=NN.indexOf(r)!==-1?NN.indexOf(r):FN.indexOf(r);if(ri===-1)return[];const d=CT[type];if(!d)return[];return d.iv.map(v=>{const ni=(ri+v)%12;return NN[ni]+(oct+Math.floor((ri+v)/12));});}
function pc(sym){if(!sym)return{r:'C',t:'major'};if(sym.startsWith('note:'))return{r:sym.slice(5),t:'single'};const m=sym.match(/^([A-G][#b]?)(m7b5|m7|maj7|add9|sus2|sus4|°|\+|m|7|5)?$/);if(!m)return{r:'C',t:'major'};const M={'':'major',m:'minor','°':'dim','+':'aug','7':'dom7',maj7:'maj7',m7:'min7',m7b5:'m7b5',sus2:'sus2',sus4:'sus4',add9:'add9','5':'power'};return{r:m[1],t:M[m[2]||'']||'major'};}
function cc(s){const q=CT[pc(s).t]?.q;return{major:'#FF3D6A',minor:'#00FFD0',diminished:'#E040FB',augmented:'#B5F000',dominant:'#FF9500',suspended:'#29D4FF'}[q]||'#fff';}
function ql(s){const q=CT[pc(s).t]?.q;return{major:'Major',minor:'Minor',diminished:'Diminished',augmented:'Augmented',dominant:'Dominant 7th',suspended:'Suspended'}[q]||'Chord';}

const IVS=[{s:0,n:'Unison',sn:'P1',f:'Identity — pure stillness',c:'perfect'},{s:1,n:'Minor 2nd',sn:'m2',f:'Tension — two notes pressing together',c:'dissonant'},{s:2,n:'Major 2nd',sn:'M2',f:'Gentle movement — a step forward',c:'mild'},{s:3,n:'Minor 3rd',sn:'m3',f:'Sadness, tenderness — heart of minor',c:'consonant'},{s:4,n:'Major 3rd',sn:'M3',f:'Brightness, joy — heart of major',c:'consonant'},{s:5,n:'Perfect 4th',sn:'P4',f:'Openness — floating, calm suspension',c:'perfect'},{s:6,n:'Tritone',sn:'TT',f:'Maximum tension — wants to resolve desperately',c:'dissonant'},{s:7,n:'Perfect 5th',sn:'P5',f:'Power — foundation of almost all chords',c:'perfect'},{s:8,n:'Minor 6th',sn:'m6',f:'Longing — aches gorgeously',c:'consonant'},{s:9,n:'Major 6th',sn:'M6',f:'Warmth, nostalgia — golden and familiar',c:'consonant'},{s:10,n:'Minor 7th',sn:'m7',f:'Bluesy pull — cool tension',c:'mild'},{s:11,n:'Major 7th',sn:'M7',f:'Dreamy tension — floating below resolution',c:'dissonant'},{s:12,n:'Octave',sn:'P8',f:'Completion — same note higher',c:'perfect'}];
function ic(c){return{perfect:'#4ECDC4',consonant:'#FFB347',mild:'#87CEEB',dissonant:'#FF6B6B'}[c]||'#fff';}

const DM=[{d:1,n:'Root',f:'Home',st:'anchor'},{d:2,n:'Supertonic',f:'Gentle longing',st:'passing'},{d:3,n:'Mediant',f:'Emotional identity',st:'stable'},{d:4,n:'Subdominant',f:'Leaning forward',st:'mild-tension'},{d:5,n:'Dominant',f:'Strong anchor',st:'anchor'},{d:6,n:'Submediant',f:'Sweet, nostalgic',st:'stable'},{d:7,n:'Leading Tone',f:'Maximum pull to root',st:'tension'}];
const Dm=[{d:1,n:'Root',f:'Heavy home',st:'anchor'},{d:2,n:'Supertonic',f:'Restless urgency',st:'passing'},{d:3,n:'Mediant',f:'Minor identity',st:'stable'},{d:4,n:'Subdominant',f:'Weight',st:'mild-tension'},{d:5,n:'Dominant',f:'Cold or strong',st:'anchor'},{d:6,n:'Submediant',f:'Dark warmth',st:'stable'},{d:7,n:'Subtonic',f:'Soft pull',st:'mild-tension'}];
function dc(s){return{anchor:'#4ECDC4',stable:'#87CEEB',passing:'#FFB347','mild-tension':'#DDA0DD',tension:'#FF6B6B'}[s]||'#fff';}

function vl(f,t){const fn=cn(pc(f).r,pc(f).t,4).map(n=>({n:n.replace(/\d/,''),m:NN.indexOf(n.replace(/\d/,''))}));const tn=cn(pc(t).r,pc(t).t,4).map(n=>({n:n.replace(/\d/,''),m:NN.indexOf(n.replace(/\d/,''))}));const mv=[],u=new Set();fn.forEach(a=>{let bd=99,bi=0;tn.forEach((b,i)=>{if(u.has(i))return;const d=Math.min(Math.abs(b.m-a.m),12-Math.abs(b.m-a.m));if(d<bd){bd=d;bi=i;}});u.add(bi);const b=tn[bi]||a;mv.push({f:a.n,t:b.n,d:bd,s:a.n===b.n});});const sc=mv.filter(m=>m.s).length,tm=mv.reduce((s,m)=>s+m.d,0);return{mv,sc,tm,sm:tm>6?'Dramatic':tm>3?'Moderate':'Smooth'};}
function mf(f,t){const a=CT[pc(f).t]?.q||'major',b=CT[pc(t).t]?.q||'major';if(a==='minor'&&b==='major') return{l:'Opening up',e:'🌅'};if(a==='major'&&b==='minor') return{l:'Turning inward',e:'🌙'};if(a==='dominant'&&b==='major') return{l:'Resolving',e:'✨'};if(a==='dominant'&&b==='minor') return{l:'Dark resolution',e:'⚡'};if(a==='diminished') return{l:'Escaping tension',e:'💨'};if(b==='diminished') return{l:'Into unknown',e:'🌀'};if(a===b) return{l:'Staying in mood',e:'〰️'};return{l:'Shifting color',e:'🎭'};}

const KEYS={'C major':{r:'C',m:'major',ch:['C','Dm','Em','F','G','Am','B°'],sc:['C','D','E','F','G','A','B']},'G major':{r:'G',m:'major',ch:['G','Am','Bm','C','D','Em','F#°'],sc:['G','A','B','C','D','E','F#']},'D major':{r:'D',m:'major',ch:['D','Em','F#m','G','A','Bm','C#°'],sc:['D','E','F#','G','A','B','C#']},'A major':{r:'A',m:'major',ch:['A','Bm','C#m','D','E','F#m','G#°'],sc:['A','B','C#','D','E','F#','G#']},'E major':{r:'E',m:'major',ch:['E','F#m','G#m','A','B','C#m','D#°'],sc:['E','F#','G#','A','B','C#','D#']},'F major':{r:'F',m:'major',ch:['F','Gm','Am','Bb','C','Dm','E°'],sc:['F','G','A','Bb','C','D','E']},'Bb major':{r:'Bb',m:'major',ch:['Bb','Cm','Dm','Eb','F','Gm','A°'],sc:['Bb','C','D','Eb','F','G','A']},'Eb major':{r:'Eb',m:'major',ch:['Eb','Fm','Gm','Ab','Bb','Cm','D°'],sc:['Eb','F','G','Ab','Bb','C','D']},'A minor':{r:'A',m:'minor',ch:['Am','B°','C','Dm','Em','F','G'],sc:['A','B','C','D','E','F','G']},'E minor':{r:'E',m:'minor',ch:['Em','F#°','G','Am','Bm','C','D'],sc:['E','F#','G','A','B','C','D']},'D minor':{r:'D',m:'minor',ch:['Dm','E°','F','Gm','Am','Bb','C'],sc:['D','E','F','G','A','Bb','C']},'G minor':{r:'G',m:'minor',ch:['Gm','A°','Bb','Cm','Dm','Eb','F'],sc:['G','A','Bb','C','D','Eb','F']},'F minor':{r:'F',m:'minor',ch:['Fm','G°','Ab','Bbm','Cm','Db','Eb'],sc:['F','G','Ab','Bb','C','Db','Eb']},'C minor':{r:'C',m:'minor',ch:['Cm','D°','Eb','Fm','Gm','Ab','Bb'],sc:['C','D','Eb','F','G','Ab','Bb']},'B minor':{r:'B',m:'minor',ch:['Bm','C#°','D','Em','F#m','G','A'],sc:['B','C#','D','E','F#','G','A']},'B major':{r:'B',m:'major',ch:['B','C#m','D#m','E','F#','G#m','A#°'],sc:['B','C#','D#','E','F#','G#','A#']},'Gb major':{r:'Gb',m:'major',ch:['Gb','Abm','Bbm','Cb','Db','Ebm','F°'],sc:['Gb','Ab','Bb','Cb','Db','Eb','F']},'Db major':{r:'Db',m:'major',ch:['Db','Ebm','Fm','Gb','Ab','Bbm','C°'],sc:['Db','Eb','F','Gb','Ab','Bb','C']},'Ab major':{r:'Ab',m:'major',ch:['Ab','Bbm','Cm','Db','Eb','Fm','G°'],sc:['Ab','Bb','C','Db','Eb','F','G']},'F# minor':{r:'F#',m:'minor',ch:['F#m','G#°','A','Bm','C#m','D','E'],sc:['F#','G#','A','B','C#','D','E']},'C# minor':{r:'C#',m:'minor',ch:['C#m','D#°','E','F#m','G#m','A','B'],sc:['C#','D#','E','F#','G#','A','B']},'G# minor':{r:'G#',m:'minor',ch:['G#m','A#°','B','C#m','D#m','E','F#'],sc:['G#','A#','B','C#','D#','E','F#']},'Eb minor':{r:'Eb',m:'minor',ch:['Ebm','F°','Gb','Abm','Bbm','Cb','Db'],sc:['Eb','F','Gb','Ab','Bb','Cb','Db']},'Bb minor':{r:'Bb',m:'minor',ch:['Bbm','C°','Db','Ebm','Fm','Gb','Ab'],sc:['Bb','C','Db','Eb','F','Gb','Ab']}};
const MAJOR_COF=['C major','G major','D major','A major','E major','B major','Gb major','Db major','Ab major','Eb major','Bb major','F major'];
const MINOR_COF=['A minor','E minor','B minor','F# minor','C# minor','G# minor','Eb minor','Bb minor','F minor','C minor','G minor','D minor'];
const RELATIVE={'C major':'A minor','A minor':'C major','G major':'E minor','E minor':'G major','D major':'B minor','B minor':'D major','A major':'F# minor','F# minor':'A major','E major':'C# minor','C# minor':'E major','B major':'G# minor','G# minor':'B major','Gb major':'Eb minor','Eb minor':'Gb major','Db major':'Bb minor','Bb minor':'Db major','Ab major':'F minor','F minor':'Ab major','Eb major':'C minor','C minor':'Eb major','Bb major':'G minor','G minor':'Bb major','F major':'D minor','D minor':'F major'};
const FNM=['Home (I / 1)','Shadow (ii / 2)','Edge (iii / 3)','Warmth (IV / 4)','Pull (V / 5)','Relative (vi / 6)','Gateway (vii° / 7)'];
const FNm=['Home (i / 1)','Edge (ii° / 2)','Relative (III / 3)','Shadow (iv / 4)','Pull (v / 5)','Warmth (VI / 6)','Gateway (VII / 7)'];
function chordRN(k,ch){if(!k?.ch)return'';const rn=['I','ii','iii','IV','V','vi','vii°'],rm=['i','ii°','III','iv','v','VI','VII'];const pos=k.ch.indexOf(ch);return pos===-1?'':`${k.m==='minor'?rm[pos]:rn[pos]} / ${pos+1}`;}
function gcon(ch,mode='major'){if(!ch||ch.length<7)return[];const p=mode==='minor'?[[0,3],[0,4],[0,5],[1,4],[1,6],[2,5],[2,3],[3,0],[3,4],[3,1],[4,0],[4,5],[5,3],[5,1],[5,2],[5,6],[6,0],[6,2],[6,4]]:[[0,3],[0,4],[0,5],[1,4],[1,6],[2,5],[2,3],[3,0],[3,4],[3,1],[4,0],[4,5],[5,3],[5,1],[5,2],[6,0],[6,4]];return p.map(([a,b])=>({f:ch[a],t:ch[b],st:((a===4&&b===0)||(a===3&&b===0))?'strong':'normal'}));}

function presets(kn){const k=KEYS[kn];if(!k)return[];const c=k.ch;
if(k.m==='major') return[{n:'Pop Classic',f:'Anthemic',ch:[c[0],c[4],c[5],c[3]]},{n:'Emotional',f:'Sad then opens',ch:[c[5],c[3],c[0],c[4]]},{n:'Uplifting',f:'Forward motion',ch:[c[0],c[2],c[5],c[3]]},{n:'Gentle',f:'Warm, flowing',ch:[c[0],c[5],c[3],c[4]]},{n:'Cinematic',f:'Dramatic sweep',ch:[c[5],c[4],c[3],c[4]]}];
else return[{n:'Reflective',f:'Inward, opens',ch:[c[0],c[5],c[2],c[6]]},{n:'Dark Drive',f:'Heavy cycle',ch:[c[0],c[3],c[4],c[0]]},{n:'Bittersweet',f:'Descending',ch:[c[0],c[6],c[5],c[4]]},{n:'Wandering',f:'Searching',ch:[c[0],c[2],c[5],c[6]]},{n:'Circular',f:'Trapped pull',ch:[c[0],c[4],c[0],c[3]]}];}

const GENRES = {
pop:{n:'Pop',color:'#FF6B6B',desc:'Catchy, polished, singable',tempo:120,feel:'Upbeat, clean, driving',tips:'Pop lives on the I–V–vi–IV axis. Keep it simple, let the melody carry.',progs:[{n:'The Anthem',d:'I–V–vi–IV',w:'The backbone of modern pop — bright, emotional, universally catchy.',g:c=>[c[0],c[4],c[5],c[3]],bpm:120},{n:'Emotional Pop',d:'vi–IV–I–V',w:'Starts in feeling, builds to power. Every emotional pop chorus lives here.',g:c=>[c[5],c[3],c[0],c[4]],bpm:115},{n:'The Lift',d:'I–iii–IV–V',w:'Gentle climb that builds momentum.',g:c=>[c[0],c[2],c[3],c[4]],bpm:118},{n:'Pop Ballad',d:'I–V–vi–iii–IV',w:'Extended pop axis — the iii chord adds vulnerability.',g:c=>[c[0],c[4],c[5],c[2],c[3]],bpm:76}]},
'90s-rnb':{n:'90s R&B',color:'#DDA0DD',desc:'Smooth, lush, soulful — golden era',tempo:85,feel:'Laid-back groove, warm and rich',tips:'90s R&B uses 7th chords everywhere. Replace every triad with its 7th version.',progs:[{n:'Slow Jam',d:'I–vi–IV–V',w:'The classic slow jam foundation. Add 7ths to every chord.',g:c=>[c[0],c[5],c[3],c[4]],bpm:78},{n:'Quiet Storm',d:'ii–V–I–vi',w:'Jazz-influenced movement that defines the quietstorm sound.',g:c=>[c[1],c[4],c[0],c[5]],bpm:82},{n:'New Jack Swing',d:'I–IV–V–IV',w:'Bouncy, groovy, uptempo. The swagger era.',g:c=>[c[0],c[3],c[4],c[3]],bpm:105},{n:'Ballad Gold',d:'I–iii–vi–IV',w:'Tender, emotional, intimate. Whitney and Mariah territory.',g:c=>[c[0],c[2],c[5],c[3]],bpm:68}]},
rnb:{n:'R&B / Neo-Soul',color:'#FFB347',desc:'Modern, intimate, textured',tempo:72,feel:'Spacious, breathy, emotive',tips:'Modern R&B strips things back. Fewer chords, more space, heavier bass.',progs:[{n:'Late Night Vibe',d:'vi–IV–I–V',w:'Moody, atmospheric. The foundation of modern R&B.',g:c=>[c[5],c[3],c[0],c[4]],bpm:68},{n:'Two-Chord Float',d:'I–vi',w:'Just two chords looping. Modern R&B proves less is more.',g:c=>[c[0],c[5]],bpm:65},{n:'Neo-Soul Cycle',d:'ii–V–I–IV',w:'Jazz DNA in a modern body. Erykah Badu, D\'Angelo territory.',g:c=>[c[1],c[4],c[0],c[3]],bpm:78},{n:'Vulnerable',d:'vi–V–IV–I',w:'Descending into openness. Modern confessional R&B.',g:c=>[c[5],c[4],c[3],c[0]],bpm:70}]},
trap:{n:'Trap',color:'#FF4500',desc:'Dark, minimal, hard-hitting',tempo:140,feel:'Half-time feel, heavy 808s, sparse',tips:'Trap harmony is minimal — often just 2-3 chords. The power comes from the bass and space.',progs:[{n:'Dark Loop',d:'i–VI–VII',w:'The classic trap triangle. Minor home, major VI, push to VII.',g:c=>[c[0],c[5],c[6]],bpm:140},{n:'Sad Trap',d:'i–iv–VII–III',w:'Emotional trap. The iv chord adds weight.',g:c=>[c[0],c[3],c[6],c[2]],bpm:138},{n:'Hard Minor',d:'i–VII–VI–VII',w:'Aggressive and repetitive. The VII launches the loop.',g:c=>[c[0],c[6],c[5],c[6]],bpm:145},{n:'Melodic Trap',d:'i–III–VII–iv',w:'The melodic wave. Modern hit formula.',g:c=>[c[0],c[2],c[6],c[3]],bpm:135}]},
lofi:{n:'Lo-fi / Chill',color:'#87CEEB',desc:'Warm, nostalgic, lo-fi textures',tempo:80,feel:'Relaxed, jazzy, imperfect beauty',tips:'Lo-fi loves 7th and 9th chords. Warmth comes from extended harmony and behind-the-beat feel.',progs:[{n:'Study Beats',d:'ii–V–I–vi',w:'Jazz bones with lo-fi skin. The most natural-sounding resolution.',g:c=>[c[1],c[4],c[0],c[5]],bpm:82},{n:'Rainy Day',d:'I–vi–ii–V',w:'Circular warmth. Endless comfort.',g:c=>[c[0],c[5],c[1],c[4]],bpm:75},{n:'Night Walk',d:'vi–ii–V–I',w:'Starts contemplative, gradually resolves.',g:c=>[c[5],c[1],c[4],c[0]],bpm:78},{n:'Vinyl Crackle',d:'I–iii–IV–ii',w:'Warm, slightly unexpected. The iii to IV has golden quality.',g:c=>[c[0],c[2],c[3],c[1]],bpm:85}]},
hiphop:{n:'Hip-Hop / Boom Bap',color:'#D2691E',desc:'Sample-based, gritty, groove-driven',tempo:90,feel:'Head-nod tempo, dusty, soulful',tips:'Boom bap lives on jazzy chords and soul samples. Groove is everything.',progs:[{n:'Golden Era',d:'i–iv–i–VII',w:'The classic hip-hop loop. Dusty records, MPC drums.',g:c=>[c[0],c[3],c[0],c[6]],bpm:92},{n:'Soul Sample',d:'I–vi–IV–V',w:'Soulful chop. Decades of sample-based hip-hop.',g:c=>[c[0],c[5],c[3],c[4]],bpm:88},{n:'Head Nod',d:'i–VII–VI–VII',w:'Minimal and repetitive. Hypnotic.',g:c=>[c[0],c[6],c[5],c[6]],bpm:86},{n:'Jazz Hop',d:'ii–V–I–iii',w:'Jazzier. Sophisticated warmth.',g:c=>[c[1],c[4],c[0],c[2]],bpm:84}]},
gospel:{n:'Gospel / Soul',color:'#FFD700',desc:'Rich, powerful, spiritually charged',tempo:95,feel:'Full, dynamic, call-and-response energy',tips:'Gospel harmony is about the movement. Use dominant 7ths for strong pull between chords.',progs:[{n:'Praise Build',d:'I–IV–V–I',w:'The most fundamental gospel movement. Pure resolution.',g:c=>[c[0],c[3],c[4],c[0]],bpm:95},{n:'Worship Climb',d:'IV–V–vi–I',w:'Rising from open to tension to emotion to home.',g:c=>[c[3],c[4],c[5],c[0]],bpm:78},{n:'Shout Music',d:'I–IV–I–V',w:'Driving, repetitive, building intensity.',g:c=>[c[0],c[3],c[0],c[4]],bpm:110},{n:'Sunday Morning',d:'I–vi–ii–V',w:'Warm, sophisticated, soulful.',g:c=>[c[0],c[5],c[1],c[4]],bpm:72}]},
rock:{n:'Rock / Alternative',color:'#8FBC8F',desc:'Raw, guitar-driven, dynamic',tempo:125,feel:'Energetic, distorted, emotionally direct',tips:'Rock power comes from dynamics, distortion, and rhythm — not chord complexity.',progs:[{n:'Power Anthem',d:'I–V–vi–IV',w:'The rock anthem. Stadium-sized with distortion and dynamics.',g:c=>[c[0],c[4],c[5],c[3]],bpm:130},{n:'Grunge Drop',d:'vi–IV–I–V',w:'Starts dark, opens up. The emotional trajectory of 90s alternative.',g:c=>[c[5],c[3],c[0],c[4]],bpm:120},{n:'Punk Drive',d:'I–IV–V–V',w:'Three chords. The sustained V creates urgency.',g:c=>[c[0],c[3],c[4],c[4]],bpm:165},{n:'Indie Float',d:'I–iii–vi–IV',w:'Dreamy, less aggressive. Cool introspection.',g:c=>[c[0],c[2],c[5],c[3]],bpm:108}]},
};
const GENRE_KEYS = Object.keys(GENRES);

function gvoi(sym){const{r,t}=pc(sym);const rn=ENH[r]||r;const ri=NN.indexOf(rn)!==-1?NN.indexOf(rn):FN.indexOf(rn);if(ri===-1)return[];const iv=CT[t]?.iv||[0,4,7];return[{n:'Root position',d:'Standard, clear',notes:iv.map(v=>NN[(ri+v)%12]+(4+Math.floor((ri+v)/12)))},{n:'1st inversion',d:'Smoother bass',notes:[NN[(ri+iv[1])%12]+'3',...iv.filter((_,i)=>i!==1).map(v=>NN[(ri+v)%12]+(4+Math.floor((ri+v)/12)))]},{n:'Open voicing',d:'Spacious, cinematic',notes:[NN[ri]+'3',NN[(ri+(iv[2]||7))%12]+'3',NN[(ri+(iv[1]||4))%12]+'4']},{n:'High voicing',d:'Bright, airy',notes:iv.map(v=>NN[(ri+v)%12]+(5+Math.floor((ri+v)/12)))}];}
function chordNotesInKey(k,chordName){if(!k||!k.ch||!k.sc)return cn(pc(chordName).r,pc(chordName).t,4).map(n=>n.replace(/\d/,''));const pos=k.ch.indexOf(chordName);if(pos===-1)return cn(pc(chordName).r,pc(chordName).t,4).map(n=>n.replace(/\d/,''));return[k.sc[pos],k.sc[(pos+2)%7],k.sc[(pos+4)%7]];}
function notePC(note){const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};return M[note]??-1;}
function pcToKeyNote(pc12,k){if(k?.sc){const found=k.sc.find(n=>notePC(n)===pc12);if(found)return found;}const useFlats=k?.sc?.some(n=>n.includes('b'))??false;return useFlats?FN[pc12]:NN[pc12];}
function extChordLabel(k,baseName,ext){if(!ext||ext==='triad')return baseName;if(!k||!k.ch)return baseName;const pos=k.ch.indexOf(baseName);if(pos===-1)return baseName;const{r}=pc(baseName);const isDim=(k.m==='major'&&pos===6)||(k.m==='minor'&&pos===1);if(ext==='power')return r+'5';if(ext==='note')return 'note:'+(pos!==-1&&k.sc?k.sc[pos]:r);if(ext==='sus2'){return isDim?baseName:r+'sus2';}if(ext==='sus4'){return isDim?baseName:r+'sus4';}if(ext==='7ths'){if(isDim)return r+'m7b5';const isMaj7=(k.m==='major'&&(pos===0||pos===3))||(k.m==='minor'&&(pos===2||pos===5));const isDom7=(k.m==='major'&&pos===4)||(k.m==='minor'&&pos===6);if(isMaj7)return r+'maj7';if(isDom7)return r+'7';return r+'m7';}return baseName;}
function extChordNotes(k,baseName,ext){if(!k||!k.ch||!k.sc)return chordNotesInKey(k,baseName);const pos=k.ch.indexOf(baseName);if(pos===-1)return chordNotesInKey(k,baseName);const root=k.sc[pos],third=k.sc[(pos+2)%7],fifth=k.sc[(pos+4)%7];const isDim=(k.m==='major'&&pos===6)||(k.m==='minor'&&pos===1);if(!ext||ext==='triad')return[root,third,fifth];if(ext==='power')return[root,fifth];if(ext==='note')return[root];if(ext==='7ths')return[root,third,fifth,k.sc[(pos+6)%7]];if(ext==='sus2'){if(isDim)return[root,third,fifth];return[root,pcToKeyNote((notePC(root)+2)%12,k),fifth];}if(ext==='sus4'){if(isDim)return[root,third,fifth];return[root,pcToKeyNote((notePC(root)+5)%12,k),fifth];}return[root,third,fifth];}

const CE={'C':{f:'Bright, pure',r:'Home base'},'Dm':{f:'Melancholy',r:'Pulls inward'},'Em':{f:'Cool, quiet',r:'Contemplation'},'F':{f:'Open, warm',r:'Expands sound'},'G':{f:'Bright, driving',r:'Pushes forward'},'Am':{f:'Sad, deep',r:'Emotional heart'},'Bm':{f:'Dark, serious',r:'Adds weight'},'D':{f:'Warm, confident',r:'Lifts clearly'},'E':{f:'Tense, powerful',r:'Strong pull'},'A':{f:'Bright, joyful',r:'Open confidence'},'Bb':{f:'Dramatic, full',r:'Cinematic color'},'Eb':{f:'Rich, soulful',r:'Gospel warmth'},'Ab':{f:'Lush, floating',r:'Dreamy lift'},'Cm':{f:'Dark, heavy',r:'Brooding weight'},'Fm':{f:'Aching, raw',r:'Deep sorrow'},'Gm':{f:'Moody, restless',r:'Shadow depth'},'G#m':{f:'Eerie, intense',r:'Unsettled beauty'},'C#m':{f:'Haunting',r:'Cold beauty'},'F#m':{f:'Somber',r:'Deeper sadness'},'B°':{f:'Tense, unstable',r:'Creates urgency'}};

const EMO={sad:{l:'Sad',p:'Heavy, reflective, aching',co:['#4A6FA5','#7B68EE','#C0C0C0'],gr:'linear-gradient(135deg,#1a1a3e,#2d1b69,#1a2744)',ks:['A minor','D minor'],pr:[{ch:['Am','F','C','G'],d:'Starts inward, slowly opens'},{ch:['Am','Em','F','Dm'],d:'Stays in shadow'},{ch:['Dm','Am','Em','Am'],d:'Circular, never resolves'}],sn:['A','B','C','D','E','F','G'],tn:['F','B'],sf:['A','C','E'],cl:['D','G'],tp:'60–80',fl:'Slow, spacious',tx:'Soft piano, pads'},hopeful:{l:'Hopeful',p:'Open, rising, warm',co:['#FFD700','#87CEEB','#FF7F50'],gr:'linear-gradient(135deg,#1a2a1a,#2d4a1b,#3d2a0a)',ks:['C major','G major'],pr:[{ch:['C','G','Am','F'],d:'Grounded brightness lifting gently'},{ch:['G','Em','C','D'],d:'Forward with optimism'},{ch:['F','C','G','Am'],d:'Ascending with tenderness'}],sn:['C','D','E','F','G','A','B'],tn:['B','F'],sf:['C','E','G'],cl:['A','D'],tp:'80–110',fl:'Flowing, rising',tx:'Acoustic piano, guitar'},dark:{l:'Dark',p:'Tense, cold, dramatic',co:['#DC143C','#8B008B','#2F4F4F'],gr:'linear-gradient(135deg,#0d0d0d,#2d0a1e,#1a0a0a)',ks:['A minor','E minor'],pr:[{ch:['Am','E','Am','Dm'],d:'Oppressive dominant pull'},{ch:['Em','Bm','C','Am'],d:'Cold descent into shadow'},{ch:['Dm','Am','E','Am'],d:'Dark cycle with tension'}],sn:['A','B','C','D','E','F','G'],tn:['B','F'],sf:['A','E'],cl:['C','D'],tp:'60–90',fl:'Slow, heavy',tx:'Low piano, dark pads'},dreamy:{l:'Dreamy',p:'Floating, soft, unreal',co:['#00CED1','#E6E6FA','#FFDAB9'],gr:'linear-gradient(135deg,#0a1a2d,#1b1a3d,#0d2d3d)',ks:['C major','F major'],pr:[{ch:['C','Am','F','G'],d:'Floating between comfort and wonder'},{ch:['F','Am','G','C'],d:'Drifting without urgency'},{ch:['Em','G','C','Am'],d:'Cool mist into warmth'}],sn:['C','D','E','F','G','A','B'],tn:['F','B'],sf:['C','E','G'],cl:['A','D','F'],tp:'70–95',fl:'Spacious, ethereal',tx:'Electric piano, ambient pads'},powerful:{l:'Powerful',p:'Bold, intense, cinematic',co:['#FF4500','#FFD700','#FF6347'],gr:'linear-gradient(135deg,#1a0a00,#3d1a0a,#2d1500)',ks:['C major','A minor'],pr:[{ch:['Am','F','C','G'],d:'Emotional depth rising to triumph'},{ch:['C','G','Am','F'],d:'Anthemic and driving'},{ch:['D','Bm','G','A'],d:'Bold ascent'}],sn:['C','D','E','F','G','A','B'],tn:['B','F'],sf:['C','E','G'],cl:['A','D'],tp:'80–130',fl:'Driving, emphatic',tx:'Full piano, strings'},nostalgic:{l:'Nostalgic',p:'Warm, bittersweet, memory',co:['#DEB887','#D2691E','#BC8F8F'],gr:'linear-gradient(135deg,#1a1510,#2d1f0a,#1a1818)',ks:['G major','C major'],pr:[{ch:['G','Em','C','D'],d:'Looking back with warmth'},{ch:['C','Am','F','G'],d:'Simple beauty, familiar'},{ch:['Am','G','F','Em'],d:'Descending through feeling'}],sn:['G','A','B','C','D','E','F#'],tn:['F#','C'],sf:['G','B','D'],cl:['E','A'],tp:'70–100',fl:'Mid-tempo, gentle',tx:'Warm piano, soft guitar'},romantic:{l:'Romantic',p:'Tender, intimate',co:['#FF69B4','#DDA0DD','#FFB6C1'],gr:'linear-gradient(135deg,#1a0a15,#2d0a20,#1a1018)',ks:['F major','C major'],pr:[{ch:['F','Am','Dm','G'],d:'Tenderness into longing'},{ch:['C','Em','Am','F'],d:'Gentle confession'},{ch:['G','Bm','C','D'],d:'Warm closeness'}],sn:['F','G','A','Bb','C','D','E'],tn:['E','Bb'],sf:['F','A','C'],cl:['D','G'],tp:'65–90',fl:'Slow, intimate',tx:'Felt piano, nylon guitar'},aggressive:{l:'Aggressive',p:'Raw, fierce, relentless',co:['#FF0000','#FF4500','#8B0000'],gr:'linear-gradient(135deg,#0d0000,#2d0505,#1a0000)',ks:['E minor','A minor'],pr:[{ch:['Em','C','G','D'],d:'Relentless raw energy'},{ch:['Am','G','F','E'],d:'Descending force'},{ch:['Dm','C','Bb','Am'],d:'Heavy unresolved descent'}],sn:['E','F#','G','A','B','C','D'],tn:['F#','C'],sf:['E','G','B'],cl:['A','D'],tp:'100–150',fl:'Fast, punchy',tx:'Hard piano, distorted synths'},cinematic:{l:'Cinematic',p:'Epic, sweeping, vast',co:['#FFD700','#4169E1','#DC143C'],gr:'linear-gradient(135deg,#0a0a1a,#1a1540,#0a1a2d)',ks:['C major','D major'],pr:[{ch:['Am','G','F','G'],d:'Building emotional momentum'},{ch:['C','Am','F','G'],d:'Classic emotional arc'},{ch:['D','Bm','G','A'],d:'Grand, wide open'}],sn:['C','D','E','F','G','A','B'],tn:['B','F'],sf:['C','E','G'],cl:['A','D'],tp:'70–110',fl:'Sweeping, dynamic',tx:'Piano + strings, brass'},lonely:{l:'Lonely',p:'Sparse, quiet, isolated',co:['#708090','#4682B4','#5F9EA0'],gr:'linear-gradient(135deg,#0a0a15,#151520,#0d1520)',ks:['A minor','E minor'],pr:[{ch:['Am','Em','Am','Em'],d:'Trapped in repetition'},{ch:['Em','C','Am','Em'],d:'Brief light, back to solitude'},{ch:['Dm','Am','F','C'],d:'Quiet wandering'}],sn:['A','B','C','D','E','F','G'],tn:['B','F'],sf:['A','E'],cl:['C','D'],tp:'55–75',fl:'Very slow, sparse',tx:'Solo piano, reverb'}};

function earGen(type){const R=['C','D','E','F','G','A'],root=R[Math.floor(Math.random()*R.length)];if(type==='chord-quality'){const ts=[{t:'major',l:'Major',h:'Bright, open — the wide major 3rd creates brightness.'},{t:'minor',l:'Minor',h:'Sad, emotional — the lowered 3rd creates depth.'},{t:'dim',l:'Diminished',h:'Tense, unstable — stacked minor 3rds create anxiety.'}];const a=ts[Math.floor(Math.random()*ts.length)];return{q:'What quality is this chord?',pt:'chord',pd:cn(root,a.t,3),ops:ts.map(t=>t.l),ans:a.l,h:a.h};}if(type==='interval'){const pool=[{s:1,n:'Minor 2nd'},{s:3,n:'Minor 3rd'},{s:4,n:'Major 3rd'},{s:5,n:'Perfect 4th'},{s:7,n:'Perfect 5th'},{s:8,n:'Minor 6th'},{s:9,n:'Major 6th'},{s:12,n:'Octave'}];const pk=pool[Math.floor(Math.random()*pool.length)],iv=IVS.find(i=>i.s===pk.s);const ri=NN.indexOf(root),n1=root+'3',n2=NN[(ri+pk.s)%12]+(3+Math.floor((ri+pk.s)/12));const oth=pool.filter(p=>p.n!==pk.n).sort(()=>Math.random()-0.5).slice(0,3).map(p=>p.n);return{q:'What interval do you hear?',pt:'melodic',pd:[n1,n2],ops:[...oth,pk.n].sort(()=>Math.random()-0.5),ans:pk.n,h:iv?iv.f:''};}if(type==='movement'){const ps=[{f:'G',t:'C',a:'Resolving',h:'Tension releasing into stability'},{f:'C',t:'Am',a:'Turning inward',h:'Brightness shifting to emotion'},{f:'Am',t:'F',a:'Opening up',h:'Shadow toward warmth'},{f:'C',t:'G',a:'Building tension',h:'Moving away from home'},{f:'F',t:'C',a:'Settling home',h:'Soft landing back'}];const p=ps[Math.floor(Math.random()*ps.length)];const n1=cn(pc(p.f).r,pc(p.f).t,3),n2=cn(pc(p.t).r,pc(p.t).t,3);const oth=ps.filter(x=>x.a!==p.a).sort(()=>Math.random()-0.5).slice(0,3).map(x=>x.a);return{q:`${p.f} → ${p.t}: What does this feel like?`,pt:'two',pd:[n1,n2],ops:[...oth,p.a].sort(()=>Math.random()-0.5),ans:p.a,h:p.h};}}

function ctip(act,d){if(act==='add'&&d.prog){const p=d.prog;if(p.length===2){const v=vl(p[0],p[1]);return v.sc>=2?`${p[0]}→${p[1]} shares ${v.sc} notes. That's why it flows naturally.`:`${p[0]}→${p[1]} moves ${v.tm} steps — more movement means more dramatic energy.`;}if(p.length===3&&p.every(c=>['minor','diminished'].includes(CT[pc(c).t]?.q)))return"Three dark chords in a row — try one major chord in the middle for contrast.";if(p.length===4&&p[3]===p[0])return"Ending where you started creates a satisfying loop.";}if(act==='sel'&&d.ch){const q=CT[pc(d.ch).t]?.q;if(q==='diminished')return"Diminished chords stack minor 3rds symmetrically — that symmetry creates instability.";if(q==='dominant')return"Dominant chords contain a tritone — the most tense interval. That's why they want to resolve.";}if(act==='play'&&d.prog?.some((c,i)=>i>0&&pc(d.prog[i-1]).t==='minor'&&pc(c).t==='major'))return"That minor→major shift is one of music's most powerful tools. Shadow to light creates hope.";return null;}

const LES=[{id:1,t:'Major vs Minor',b:'Major: wide 3rd = bright. Minor: lowered 3rd = emotional. One note changes everything.',ch:['C','Am'],c:'basics'},{id:2,t:'What is Tension?',b:'Tension = unfinished. Dominant chords contain a tritone that creates maximum pull toward resolution.',ch:['G','C'],c:'basics'},{id:3,t:'Resolution = Landing',b:'V→I is the strongest resolution. That satisfied "ahhh" when tension releases.',ch:['G','C'],c:'basics'},{id:4,t:'Power of the 3rd',b:'The 3rd defines the mood. C major (C-E-G) → lower E to Eb → C minor. Completely different world.',ch:['C','Am'],c:'intermediate'},{id:5,t:'Borrowed Chords',b:"Bb in C major sounds dramatic because it doesn't belong. Musical accent — stands out beautifully.",ch:['C','Bb'],c:'intermediate'},{id:6,t:'Voice Leading',b:'C→Am shares 2 notes (C and E stay). Shared notes = smooth, connected movement.',ch:['C','Am'],c:'intermediate'},{id:7,t:'The Tritone',b:'6 semitones apart — maximum instability. Appears in dominant 7ths. Engine of Western harmony.',ch:['G','C'],c:'advanced'},{id:8,t:'Scale Degrees',b:'Each note has personality. Root=home, 5th=anchor, 7th=desperate pull. Learn these and craft melodies intentionally.',ch:['C','G'],c:'advanced'},{id:9,t:'Cadences',b:'V→I = period. IV→I = exhale. Ending on V = question mark. Control how sections breathe.',ch:['G','C'],c:'advanced'}];
const RHY=[{n:'Spacious',d:'4 bars per chord — slow, breathing',b:60,beats:8,stg:0.032},{n:'Standard',d:'2 bars per chord — most common',b:90,beats:4,stg:0.018},{n:'Ballad',d:'2 bars, slow tempo — expressive',b:68,beats:4,stg:0.026},{n:'Driving',d:'1 bar per chord — forward momentum',b:116,beats:2,stg:0.010},{n:'Half-Time',d:'4 bars, heavy — hip-hop/trap feel',b:75,beats:8,stg:0.038}];
const RHYTHM_PATTERNS=[
  {n:'Even',        pat:[4,4,4,4],   tag:'Standard', desc:'All chords equal length'},
  {n:'Long Short',  pat:[3,1,3,1],   tag:'Bounce',   desc:'Sustain then quick hit'},
  {n:'Build',       pat:[1,1,2,4],   tag:'Rise',     desc:'Each chord gets longer'},
  {n:'Fall',        pat:[4,2,1,1],   tag:'Drop',     desc:'Starts long, ends quick'},
  {n:'Pump',        pat:[2,2,4,4],   tag:'Drive',    desc:'Two short into two long'},
  {n:'Clave',       pat:[3,3,2],     tag:'Afro',     desc:'3-3-2 African clave feel'},
  {n:'Soca',        pat:[2,4,2,4],   tag:'Island',   desc:'Quick bounce then hold'},
  {n:'Trap Hit',    pat:[4,4,2,1,1], tag:'Trap',     desc:'Hold then rapid fire'},
  {n:'Gallop',      pat:[2,1,2,1],   tag:'Energy',   desc:'Forward driving gallop'},
  {n:'Stutter',     pat:[1,1,1,5],   tag:'Wild',     desc:'Three quick then breathe'},
  {n:'Lopsided',    pat:[5,3],       tag:'Odd',      desc:'Long-ish and shorter pair'},
  {n:'Waltz',       pat:[3,2,1],     tag:'3/4',      desc:'Waltz-style triplet arc'},
];
function ml(ch,cx,cy,r){return ch.map((c,i)=>{const a=(i/ch.length)*Math.PI*2-Math.PI/2;return{c,x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r};});}
function tensionLevel(f,t){if(!f||!t)return 0;try{const v=vl(f,t);return Math.min(5,Math.round(v.tm/2));}catch(e){return 0;}}
function midiVarLen(v){const b=[];let x=v&0x7f;v>>=7;while(v){b.unshift(0x80|(v&0x7f));v>>=7;}b.push(x);return b;}
function noteToMidi(n){const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};const m=n.match(/^([A-G][#b]?)(\d)$/);if(!m)return 60;return(M[m[1]]??0)+(parseInt(m[2])+1)*12;}
function exportMIDI(prog,bpm=90,beats=4){const filled=prog.filter(s=>s&&s!=='REST');if(!filled.length)return;const tpqn=480,beatTicks=tpqn*beats,tempo=Math.round(60000000/bpm);const evts=[];filled.forEach((s,si)=>{const ns=cn(pc(s).r,pc(s).t,4);const st=si*beatTicks,et=(si+1)*beatTicks;ns.forEach(n=>{const m=noteToMidi(n);evts.push([st,0x90,m,80],[et,0x80,m,0]);});});evts.sort((a,b)=>a[0]-b[0]||(a[1]===0x80?-1:1));let prev=0;const td=[0x00,0xFF,0x51,0x03,(tempo>>16)&0xFF,(tempo>>8)&0xFF,tempo&0xFF];evts.forEach(([tick,st,note,vel])=>{const d=tick-prev;prev=tick;td.push(...midiVarLen(d),st,note,vel);});td.push(0x00,0xFF,0x2F,0x00);const tl=td.length;const bytes=new Uint8Array([0x4D,0x54,0x68,0x64,0,0,0,6,0,1,0,1,(tpqn>>8)&0xFF,tpqn&0xFF,0x4D,0x54,0x72,0x6B,(tl>>24)&0xFF,(tl>>16)&0xFF,(tl>>8)&0xFF,tl&0xFF,...td]);const url=URL.createObjectURL(new Blob([bytes],{type:'audio/midi'}));const a=document.createElement('a');a.href=url;a.download='harmonymap.mid';document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(url),1000);}
function generateBlueprint(prog,k){const f=prog.filter(s=>s&&s!=='REST');if(f.length<4)return null;const ts=f.slice(1).map((c,i)=>tensionLevel(f[i],c));const avg=ts.reduce((a,b)=>a+b,0)/(ts.length||1);const mx=Math.max(...ts),mn2=Math.min(...ts);const arc=mx-mn2>=3?'dramatic roller-coaster arc':avg>=3?'high-tension journey':avg<=1?'smooth, flowing':'emotionally varied arc';const endQ=CT[pc(f[f.length-1]).t]?.q||'major';const endFeel=endQ==='major'?'resolves into light':endQ==='minor'?'settles into shadow':endQ==='dominant'?'ends on tension — leaves the listener wanting more':'fades into ambiguity';return`Your ${f.length}-chord progression traces a ${arc} — starting on ${f[0]} and moving through ${f.slice(1,-1).join(' → ')}. It ${endFeel}.`;}
function vibeScore(prog){const f=prog.filter(s=>s&&s!=='REST');if(f.length<2)return{score:0,label:'Too short'};const tls=f.slice(1).map((c,i)=>tensionLevel(f[i],c));const avg=tls.reduce((a,b)=>a+b,0)/(tls.length||1);const spread=Math.max(...tls)-Math.min(...tls);const raw=Math.round(100-Math.abs(avg-2.2)*12-(spread>3?8:0));const score=Math.max(10,Math.min(100,raw));const label=score>=85?'Smooth Flow':score>=70?'Dynamic Groove':score>=50?'Tension Builder':'Wild Card';return{score,label};}

const S={
card:(bc='rgba(255,255,255,0.10)')=>({background:'rgba(255,255,255,0.07)',borderRadius:16,padding:16,border:`1px solid ${bc}`,marginBottom:12}),
lbl:{fontSize:10,color:'rgba(255,255,255,0.45)',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:6,marginTop:0},
btn:(bg='rgba(255,255,255,0.10)',c='#fff',bc='rgba(255,255,255,0.16)')=>({background:bg,border:`1px solid ${bc}`,borderRadius:10,padding:'8px 16px',color:c,cursor:'pointer',fontSize:12,fontWeight:600,transition:'all 0.2s'}),
pill:(col,play=false)=>({display:'inline-flex',alignItems:'center',justifyContent:'center',background:col+'28',color:col,border:`1.5px solid ${col}70`,borderRadius:10,padding:'6px 14px',fontSize:15,fontWeight:700,boxShadow:play?`0 0 18px ${col}70`:'none',transform:play?'scale(1.08)':'scale(1)',transition:'all 0.2s',cursor:'pointer'}),
};

// ═══════════════════════════════════════════════════════════════
// FLOATING METRONOME HOOK
// ═══════════════════════════════════════════════════════════════
function useMetronome(bpm, onBpmChange) {
const [metrOn, setMetrOn] = useState(false);
const [beat, setBeat] = useState(0);
const [tapTimes, setTapTimes] = useState([]);
const [metBpm, setMetBpm] = useState(bpm);
const metrTids = useRef([]);
const metrActive = useRef(false);

useEffect(() => { setMetBpm(bpm); }, [bpm]);

const stopMetro = useCallback(() => {
metrActive.current = false;
metrTids.current.forEach(t => clearTimeout(t));
metrTids.current = [];
setBeat(0);
}, []);

const startMetro = useCallback((currentBpm) => {
stopMetro();
metrActive.current = true;
const d = 60000 / currentBpm;
let b = 0;
const tick = () => {
if (!metrActive.current) return;
const isOne = b % 4 === 0;
audio.playClick(isOne, null);
setBeat(b % 4);
b++;
metrTids.current.push(setTimeout(tick, d));
};
tick();
}, [stopMetro]);

const toggleMetro = useCallback(() => {
if (metrOn) { stopMetro(); setMetrOn(false); }
else { startMetro(metBpm); setMetrOn(true); }
}, [metrOn, metBpm, startMetro, stopMetro]);

const tapTempo = useCallback(() => {
const now = Date.now();
setTapTimes(prev => {
const recent = [...prev, now].filter(t => now - t < 3000).slice(-6);
if (recent.length >= 2) {
const intervals = recent.slice(1).map((t, i) => t - recent[i]);
const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
const newBpm = Math.round(60000 / avg);
const clamped = Math.max(40, Math.min(200, newBpm));
setMetBpm(clamped);
if(onBpmChange)onBpmChange(clamped);
if (metrActive.current) startMetro(clamped);
}
return recent;
});
}, [startMetro]);

useEffect(() => { if(metrActive.current) startMetro(bpm); }, [bpm, startMetro]);
useEffect(() => () => stopMetro(), [stopMetro]);

return { metrOn, beat, metBpm, setMetBpm, toggleMetro, tapTempo, startMetro, stopMetro };
}

// ═══════════════════════════════════════════════════════════════
// VOICE MEMO HOOK
// ═══════════════════════════════════════════════════════════════
function useVoiceMemo() {
const [recording, setRecording] = useState(false);
const [memos, setMemos] = useState([]);
const [playingMemo, setPlayingMemo] = useState(null);
const mediaRecRef = useRef(null);
const chunksRef = useRef([]);
const audioRef = useRef(null);

const startRecording = useCallback(async () => {
try {
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
chunksRef.current = [];
const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t))||'';
const mr = new MediaRecorder(stream, mimeType ? {mimeType} : {});
mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
mr.onstop = () => {
const blob = new Blob(chunksRef.current, { type: mimeType||'audio/webm' });
const url = URL.createObjectURL(blob);
setMemos(prev => [...prev, { id: Date.now(), url, mimeType, date: new Date().toLocaleTimeString(), duration: 0 }]);
stream.getTracks().forEach(t => t.stop());
};
mediaRecRef.current = mr;
mr.start();
setRecording(true);
} catch (e) { alert('Microphone access needed for voice memos.'); }
}, []);

const stopRecording = useCallback(() => {
if (mediaRecRef.current && recording) {
mediaRecRef.current.stop();
setRecording(false);
}
}, [recording]);

const playMemo = useCallback((memo) => {
if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setPlayingMemo(null); }
if (playingMemo === memo.id) { return; }
const a = new Audio(memo.url);
a.onended = () => { setPlayingMemo(null); audioRef.current = null; };
a.onerror = () => { setPlayingMemo(null); audioRef.current = null; };
audioRef.current = a;
setPlayingMemo(memo.id);
a.play().catch(() => { setPlayingMemo(null); audioRef.current = null; });
}, [playingMemo]);

const deleteMemo = useCallback((id) => {
setMemos(prev => prev.filter(m => m.id !== id));
if (playingMemo === id && audioRef.current) { audioRef.current.pause(); setPlayingMemo(null); }
}, [playingMemo]);

return { recording, memos, playingMemo, startRecording, stopRecording, playMemo, deleteMemo };
}

// ═══════════════════════════════════════════════════════════════
// DRAG-REORDER HOOK (Long Press)
// ═══════════════════════════════════════════════════════════════
function useDragReorder(prog, setProg, onReorderComplete) {
const [dragging, setDragging] = useState(null); // index being dragged
const [dragOver, setDragOver] = useState(null);  // index being hovered over
const longPressTimer = useRef(null);
const isDragging = useRef(false);

const onLongPressStart = useCallback((idx) => {
longPressTimer.current = setTimeout(() => {
isDragging.current = true;
setDragging(idx);
// Haptic feedback if available
if (navigator.vibrate) navigator.vibrate(40);
}, 480);
}, []);

const onLongPressEnd = useCallback(() => {
clearTimeout(longPressTimer.current);
}, []);

const onDragEnter = useCallback((idx) => {
if (dragging === null) return;
setDragOver(idx);
}, [dragging]);

const onDrop = useCallback((toIdx) => {
if (dragging === null || dragging === toIdx) {
setDragging(null); setDragOver(null); isDragging.current = false; return;
}
setProg(prev => {
const next = [...prev];
const [item] = next.splice(dragging, 1);
next.splice(toIdx, 0, item);
return next;
});
if (onReorderComplete) onReorderComplete();
setDragging(null); setDragOver(null); isDragging.current = false;
}, [dragging, setProg, onReorderComplete]);

const cancelDrag = useCallback(() => {
clearTimeout(longPressTimer.current);
setDragging(null); setDragOver(null); isDragging.current = false;
}, []);

return { dragging, dragOver, onLongPressStart, onLongPressEnd, onDragEnter, onDrop, cancelDrag };
}

// ═══════════════════════════════════════════════════════════════
// FLOATING PLAYBAR COMPONENT
// ═══════════════════════════════════════════════════════════════
function FloatingPlaybar({ prog, bpm, sk, progLooping, pi, onPlay, onLoop, onStop, onClear, visible }) {
const [minimized, setMinimized] = useState(false);
if (!visible) return null;
const isActive = progLooping || pi >= 0;

return (
<div style={{
position: 'fixed', bottom: 130, right: 14, zIndex: 300,
background: isActive ? 'rgba(10,10,26,0.96)' : 'rgba(10,10,26,0.88)',
backdropFilter: 'blur(24px)',
border: `1.5px solid ${isActive ? 'rgba(78,205,196,0.5)' : 'rgba(255,255,255,0.1)'}`,
borderRadius: minimized ? 50 : 18,
padding: minimized ? '10px 14px' : '12px 14px',
boxShadow: isActive ? '0 4px 28px rgba(78,205,196,0.25)' : '0 4px 20px rgba(0,0,0,0.5)',
transition: 'all 0.3s',
minWidth: minimized ? 'auto' : 200,
animation: isActive ? 'floatPulse 3s ease-in-out infinite' : 'none',
}}>
{minimized ? (
<button onClick={() => setMinimized(false)} style={{ background: 'none', border: 'none', color: isActive ? '#4ECDC4' : 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 18, padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
{isActive ? '▶' : '◉'} <span style={{ fontSize: 10, fontWeight: 700 }}>{bpm}</span>
</button>
) : (
<>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
<div>
<div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Playbar</div>
<div style={{ fontSize: 11, color: isActive ? '#4ECDC4' : 'rgba(255,255,255,0.5)', fontWeight: 700 }}>{sk.replace(' major','').replace(' minor','m')} · {bpm} BPM</div>
</div>
<button onClick={() => setMinimized(true)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 14, padding: 0 }}>−</button>
</div>
{prog.length > 0 && (
<div style={{ display: 'flex', gap: 3, marginBottom: 10, flexWrap: 'wrap' }}>
{prog.slice(0, 8).map((c, i) => (
<span key={i} style={{ fontSize: 9, fontWeight: 700, color: pi === i ? cc(c) : 'rgba(255,255,255,0.3)', background: pi === i ? cc(c) + '20' : 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '2px 5px', border: `1px solid ${pi === i ? cc(c) + '50' : 'rgba(255,255,255,0.06)'}`, transition: 'all 0.2s' }}>{c}</span>
))}
{prog.length > 8 && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>+{prog.length - 8}</span>}
</div>
)}
<div style={{ display: 'flex', gap: 6 }}>
<button onClick={onPlay} style={{ flex: 1, background: 'rgba(78,205,196,0.15)', border: '1px solid rgba(78,205,196,0.35)', borderRadius: 10, padding: '8px 0', color: '#4ECDC4', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>▶</button>
<button onClick={progLooping ? onStop : onLoop} style={{ flex: 1, background: progLooping ? 'rgba(255,107,107,0.15)' : 'rgba(199,125,255,0.15)', border: `1px solid ${progLooping ? 'rgba(255,107,107,0.35)' : 'rgba(199,125,255,0.35)'}`, borderRadius: 10, padding: '8px 0', color: progLooping ? '#FF6B6B' : '#C77DFF', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>{progLooping ? '■' : '↺'}</button>
<button onClick={onStop} style={{ background: 'rgba(255,107,107,0.12)', border: '1px solid rgba(255,107,107,0.25)', borderRadius: 10, padding: '8px 10px', color: '#FF6B6B', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>◼</button>
<button onClick={onClear} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '8px 10px', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 13, fontWeight: 800 }}>⌫</button>
</div>
</>
)}
</div>
);
}

// ═══════════════════════════════════════════════════════════════
// FLOATING METRONOME COMPONENT
// ═══════════════════════════════════════════════════════════════
function FloatingMetronome({ bpm, onBpmChange }) {
const [visible, setVisible] = useState(false);
const [minimized, setMinimized] = useState(false);
const { metrOn, beat, metBpm, setMetBpm, toggleMetro, tapTempo } = useMetronome(bpm, onBpmChange);

const beatDots = [0, 1, 2, 3];

return (
<>
{/* Toggle button */}
<button onClick={() => setVisible(v => !v)} style={{
position: 'fixed', bottom: 186, right: 14, zIndex: 300,
background: metrOn ? 'rgba(255,183,71,0.2)' : 'rgba(10,10,26,0.88)',
border: `1.5px solid ${metrOn ? 'rgba(255,183,71,0.6)' : 'rgba(255,255,255,0.1)'}`,
borderRadius: '50%', width: 44, height: 44,
color: metrOn ? '#FFB347' : 'rgba(255,255,255,0.4)',
cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
boxShadow: metrOn ? '0 0 18px rgba(255,183,71,0.4)' : '0 2px 8px rgba(0,0,0,0.4)',
animation: metrOn ? 'metrPulse 0.15s ease-out' : 'none',
backdropFilter: 'blur(12px)',
}}>♩</button>

  {visible && (
    <div style={{
      position: 'fixed', bottom: 240, right: 14, zIndex: 300,
      background: 'rgba(10,10,26,0.96)', backdropFilter: 'blur(24px)',
      border: `1.5px solid ${metrOn ? 'rgba(255,183,71,0.45)' : 'rgba(255,255,255,0.1)'}`,
      borderRadius: 18, padding: minimized ? '10px 14px' : '14px',
      boxShadow: metrOn ? '0 4px 28px rgba(255,183,71,0.2)' : '0 4px 20px rgba(0,0,0,0.5)',
      minWidth: minimized ? 'auto' : 200, transition: 'all 0.3s',
    }}>
      {minimized ? (
        <button onClick={() => setMinimized(false)} style={{ background: 'none', border: 'none', color: metrOn ? '#FFB347' : 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 16, padding: 0 }}>♩ {metBpm}</button>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Metronome</div>
            <button onClick={() => setMinimized(true)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 14, padding: 0 }}>−</button>
          </div>
          {/* Beat flash */}
          <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 12 }}>
            {beatDots.map(i => (
              <div key={i} style={{
                width: i === 0 ? 14 : 10, height: i === 0 ? 14 : 10,
                borderRadius: '50%',
                background: metrOn && beat === i ? (i === 0 ? '#FFB347' : '#4ECDC4') : 'rgba(255,255,255,0.1)',
                boxShadow: metrOn && beat === i ? `0 0 ${i === 0 ? 14 : 8}px ${i === 0 ? '#FFB347' : '#4ECDC4'}` : 'none',
                transition: 'all 0.06s',
              }} />
            ))}
          </div>
          {/* BPM */}
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
            <button onClick={()=>{const v=Math.max(40,metBpm-1);setMetBpm(v);if(onBpmChange)onBpmChange(v);}} style={{width:30,height:30,borderRadius:'50%',background:'rgba(255,255,255,0.08)',border:'none',color:'rgba(255,255,255,0.7)',cursor:'pointer',fontSize:18,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
            <input type="number" min="40" max="200" value={metBpm} onChange={e=>{const v=Math.max(40,Math.min(200,parseInt(e.target.value)||40));setMetBpm(v);if(onBpmChange)onBpmChange(v);}} style={{flex:1,textAlign:'center',fontSize:22,fontWeight:900,color:metrOn?'#FFB347':'rgba(255,255,255,0.6)',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'5px 0',outline:'none',WebkitAppearance:'none',MozAppearance:'textfield'}}/>
            <button onClick={()=>{const v=Math.min(200,metBpm+1);setMetBpm(v);if(onBpmChange)onBpmChange(v);}} style={{width:30,height:30,borderRadius:'50%',background:'rgba(255,255,255,0.08)',border:'none',color:'rgba(255,255,255,0.7)',cursor:'pointer',fontSize:18,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={toggleMetro} style={{ flex: 1, background: metrOn ? 'rgba(255,107,107,0.15)' : 'rgba(255,183,71,0.15)', border: `1px solid ${metrOn ? 'rgba(255,107,107,0.4)' : 'rgba(255,183,71,0.4)'}`, borderRadius: 10, padding: '9px 0', color: metrOn ? '#FF6B6B' : '#FFB347', cursor: 'pointer', fontSize: 13, fontWeight: 800 }}>{metrOn ? '■ Stop' : '▶ Start'}</button>
            <button onClick={tapTempo} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '9px 0', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Tap</button>
          </div>
        </>
      )}
    </div>
  )}
</>

);
}

// ═══════════════════════════════════════════════════════════════
// FLOATING RECORDER COMPONENT
// ═══════════════════════════════════════════════════════════════
function FloatingRecorder({recState,takes,setTakes,recElapsed,recChordCount,replayChord,onStart,onStop,onStopReplay,onReplay}){
const[histOpen,setHistOpen]=useState(false);
const isRec=recState==='recording';
const isRepl=recState==='replaying';
const mm=String(Math.floor(recElapsed/60)).padStart(2,'0');
const ss=String(recElapsed%60).padStart(2,'0');
return(<>
  {/* History panel — opens above the history button */}
  {histOpen&&!isRec&&!isRepl&&(
    <div style={{position:'fixed',bottom:130,left:14,zIndex:300,background:'rgba(8,8,20,0.97)',backdropFilter:'blur(24px)',border:'1.5px solid rgba(255,77,109,0.28)',borderRadius:16,padding:12,boxShadow:'0 4px 32px rgba(0,0,0,0.7)',width:248,maxHeight:340,overflowY:'auto',animation:'fadeIn 0.2s'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <span style={{fontSize:10,color:'#FF4D6D',fontWeight:800,textTransform:'uppercase',letterSpacing:1}}>Recorded Takes</span>
        <button onClick={()=>setHistOpen(false)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:14,lineHeight:1}}>×</button>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {takes.map(take=>(
          <div key={take.id} style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.07)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <div style={{display:'flex',gap:4,alignItems:'center'}}>
                <span style={{fontSize:9,color:'rgba(255,255,255,0.65)',fontWeight:700}}>{take.key.replace(' major','').replace(' minor','m')}</span>
                <span style={{fontSize:8,color:'rgba(255,255,255,0.2)'}}>·</span>
                <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>{take.chordCount} chords</span>
                <span style={{fontSize:8,color:'rgba(255,255,255,0.2)'}}>·</span>
                <span style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>{Math.round(take.duration/1000)}s</span>
              </div>
              <div style={{display:'flex',gap:3}}>
                <button onClick={()=>onReplay(take)} disabled={recState!=='idle'} style={{background:'rgba(0,240,200,0.15)',border:'1px solid rgba(0,240,200,0.3)',borderRadius:6,padding:'2px 8px',color:'#00F0C8',cursor:'pointer',fontSize:9,fontWeight:700,opacity:recState!=='idle'?0.4:1}}>▶ Play</button>
                <button onClick={()=>setTakes(prev=>prev.filter(t=>t.id!==take.id))} style={{background:'none',border:'none',color:'rgba(255,255,255,0.2)',cursor:'pointer',fontSize:13,padding:'0 2px',lineHeight:1}}>×</button>
              </div>
            </div>
            <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
              {take.events.slice(0,12).map((ev,i)=>(
                <span key={i} style={{fontSize:8,fontWeight:700,color:replayChord===ev.chord&&isRepl?cc(ev.chord):'rgba(255,255,255,0.38)',background:replayChord===ev.chord&&isRepl?cc(ev.chord)+'22':'rgba(255,255,255,0.04)',borderRadius:4,padding:'1px 4px',border:`1px solid ${replayChord===ev.chord&&isRepl?cc(ev.chord)+'55':'rgba(255,255,255,0.07)'}`,transition:'all 0.1s'}}>{ev.chord}</span>
              ))}
              {take.events.length>12&&<span style={{fontSize:7,color:'rgba(255,255,255,0.2)'}}>+{take.events.length-12}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )}

  {/* Main record button — always ⏺ Rec when idle, pill while recording */}
  <button
    onClick={()=>{
      if(isRec){onStop();return;}
      if(isRepl){onStopReplay();return;}
      onStart();
    }}
    style={{
      position:'fixed',bottom:76,left:14,zIndex:300,
      background:isRec?'rgba(255,50,80,0.22)':isRepl?'rgba(0,240,200,0.15)':'rgba(10,10,26,0.88)',
      border:`1.5px solid ${isRec?'rgba(255,77,109,0.75)':isRepl?'rgba(0,240,200,0.55)':'rgba(255,77,109,0.35)'}`,
      borderRadius:isRec?22:'50%',
      height:44,minWidth:44,
      padding:isRec?'0 12px':0,
      color:isRec?'#FF4D6D':isRepl?'#00F0C8':'#FF4D6D',
      cursor:'pointer',fontSize:isRec?11:15,fontWeight:800,
      display:'flex',alignItems:'center',justifyContent:'center',gap:6,
      boxShadow:isRec?'0 0 22px rgba(255,77,109,0.6),0 0 8px rgba(255,77,109,0.3)':'0 0 14px rgba(255,77,109,0.25)',
      backdropFilter:'blur(12px)',
      transition:'all 0.25s',
      animation:isRec?'pulse 1.4s ease-in-out infinite':'none',
      whiteSpace:'nowrap',
    }}>
    {isRec?(
      <>
        <span style={{width:8,height:8,borderRadius:2,background:'#FF4D6D',flexShrink:0,boxShadow:'0 0 6px #FF4D6D'}}/>
        <span>{mm}:{ss}</span>
        <span style={{opacity:0.55,fontSize:9,fontWeight:700}}>{recChordCount}</span>
      </>
    ):isRepl?(
      <span style={{fontSize:11,fontWeight:800}}>■ Stop</span>
    ):(
      <span style={{fontSize:11,fontWeight:800}}>⏺ Rec</span>
    )}
  </button>

  {/* History button — only when takes exist and not recording/replaying */}
  {takes.length>0&&!isRec&&!isRepl&&(
    <button
      onClick={()=>setHistOpen(v=>!v)}
      style={{
        position:'fixed',bottom:76,left:66,zIndex:300,
        background:histOpen?'rgba(255,77,109,0.18)':'rgba(10,10,26,0.82)',
        border:`1px solid ${histOpen?'rgba(255,77,109,0.5)':'rgba(255,255,255,0.1)'}`,
        borderRadius:22,height:44,minWidth:36,padding:'0 10px',
        color:histOpen?'#FF4D6D':'rgba(255,255,255,0.4)',
        cursor:'pointer',fontSize:9,fontWeight:800,
        display:'flex',alignItems:'center',justifyContent:'center',gap:4,
        backdropFilter:'blur(12px)',
        transition:'all 0.2s',
        boxShadow:histOpen?'0 0 14px rgba(255,77,109,0.35)':'none',
      }}>
      <span style={{fontSize:12}}>◎</span>
      <span>{takes.length}</span>
    </button>
  )}
</>);}

// ═══════════════════════════════════════════════════════════════
// FLOATING RHYTHM COMPONENT
// ═══════════════════════════════════════════════════════════════
function BeatBlocks({pat,active,small}){
const maxB=Math.max(...pat);
return(
  <div style={{display:'flex',gap:small?2:3,alignItems:'flex-end',height:small?10:14}}>
    {pat.map((b,i)=>(
      <div key={i} style={{
        width: small?b*5+1:b*7+2,
        height: small?Math.max(3,b*2):Math.max(4,b*3+2),
        borderRadius:2,
        background:active
          ?`hsl(${38+i*12},100%,${55+b*4}%)`
          :`rgba(255,255,255,${0.15+b/maxB*0.3})`,
        transition:'all 0.2s',
        flexShrink:0,
      }}/>
    ))}
  </div>
);}

function FloatingRhythm({rhythmPat,onApply}){
const[open,setOpen]=useState(false);
const cur=rhythmPat?RHYTHM_PATTERNS.find(p=>p.pat.join()===rhythmPat.join())||null:null;
return(<>
  {open&&(
    <div style={{position:'fixed',bottom:185,left:14,zIndex:300,background:'rgba(8,8,20,0.97)',backdropFilter:'blur(24px)',border:`1.5px solid ${cur?'rgba(255,183,71,0.5)':'rgba(255,255,255,0.12)'}`,borderRadius:18,padding:'12px 12px 10px',boxShadow:'0 4px 32px rgba(0,0,0,0.7)',width:266,animation:'fadeIn 0.2s'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <span style={{fontSize:9,color:'rgba(255,255,255,0.3)',fontWeight:800,textTransform:'uppercase',letterSpacing:1}}>Chord Rhythm</span>
        {cur&&<button onClick={()=>{onApply(null);setOpen(false);}} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:9}}>Clear</button>}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {RHYTHM_PATTERNS.map((p,i)=>{
          const active=cur?.n===p.n;
          return(
            <button key={i} onClick={()=>{onApply(p.pat);setOpen(false);}} style={{background:active?'rgba(255,183,71,0.18)':'rgba(255,255,255,0.03)',border:`1px solid ${active?'rgba(255,183,71,0.55)':'rgba(255,255,255,0.07)'}`,borderRadius:10,padding:'7px 10px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,transition:'all 0.15s',boxShadow:active?'0 0 12px rgba(255,183,71,0.25)':'none'}}>
              <div style={{textAlign:'left',flexShrink:0}}>
                <div style={{fontSize:11,fontWeight:700,color:active?'#FFB347':'rgba(255,255,255,0.75)',lineHeight:1.2}}>{p.n}</div>
                <div style={{fontSize:8,color:'rgba(255,255,255,0.28)',marginTop:1}}>{p.pat.join('-')} · {p.tag}</div>
              </div>
              <BeatBlocks pat={p.pat} active={active}/>
            </button>
          );
        })}
      </div>
    </div>
  )}
  <button onClick={()=>setOpen(v=>!v)} style={{position:'fixed',bottom:130,left:14,zIndex:300,background:open||cur?'rgba(255,183,71,0.18)':'rgba(10,10,26,0.88)',border:`1.5px solid ${open?'rgba(255,183,71,0.65)':cur?'rgba(255,183,71,0.4)':'rgba(255,255,255,0.1)'}`,borderRadius:'50%',width:44,height:44,cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',backdropFilter:'blur(12px)',boxShadow:open?'0 0 18px rgba(255,183,71,0.45)':cur?'0 0 10px rgba(255,183,71,0.3)':'0 2px 8px rgba(0,0,0,0.4)',transition:'all 0.2s',gap:2,padding:0}}>
    {cur
      ?<BeatBlocks pat={cur.pat} active={true} small={true}/>
      :<span style={{fontSize:14,color:'rgba(255,255,255,0.4)'}}>♩</span>}
  </button>
</>);}

// ═══════════════════════════════════════════════════════════════
// VOICE MEMO PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════
function VoiceMemoPanel({ attachToIdea }) {
const { recording, memos, playingMemo, startRecording, stopRecording, playMemo, deleteMemo } = useVoiceMemo();

return (
<div style={{ ...S.card('rgba(199,125,255,0.2)'), marginBottom: 14 }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
<div>
<div style={{ fontSize: 14, fontWeight: 800, color: '#C77DFF', marginBottom: 2 }}>🎙 Voice Memos</div>
<div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Record melody ideas, lyrics, or notes while you loop chords</div>
</div>
<button
onPointerDown={startRecording}
onPointerUp={stopRecording}
onPointerLeave={stopRecording}
style={{
width: 52, height: 52, borderRadius: '50%',
background: recording ? 'rgba(255,60,60,0.9)' : 'rgba(199,125,255,0.2)',
border: `2px solid ${recording ? '#FF3C3C' : 'rgba(199,125,255,0.5)'}`,
cursor: 'pointer', color: '#fff', fontSize: 20,
display: 'flex', alignItems: 'center', justifyContent: 'center',
boxShadow: recording ? '0 0 22px rgba(255,60,60,0.7)' : '0 0 12px rgba(199,125,255,0.2)',
animation: recording ? 'pulse 0.8s ease-in-out infinite' : 'none',
transition: 'all 0.2s', flexShrink: 0,
}}>
{recording ? '⏹' : '⏺'}
</button>
</div>
{recording && (
<div style={{ background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.3)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: '#FF6B6B', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, animation: 'fadeIn 0.2s' }}>
<span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF3C3C', display: 'inline-block', animation: 'pulse 0.8s ease-in-out infinite' }} />
Recording... release to stop
</div>
)}
{memos.length === 0 && !recording && (
<div style={{ textAlign: 'center', padding: '16px 0', color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>Hold the button to record. Release to save.</div>
)}
{memos.map(memo => (
<div key={memo.id} style={{ background: 'rgba(199,125,255,0.06)', border: '1px solid rgba(199,125,255,0.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, animation: 'fadeIn 0.3s' }}>
<button onClick={() => playMemo(memo)} style={{ width: 36, height: 36, borderRadius: '50%', background: playingMemo === memo.id ? 'rgba(199,125,255,0.3)' : 'rgba(199,125,255,0.1)', border: '1px solid rgba(199,125,255,0.4)', cursor: 'pointer', color: '#C77DFF', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
{playingMemo === memo.id ? '⏸' : '▶'}
</button>
<div style={{ flex: 1, minWidth: 0 }}>
<div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>Voice Memo</div>
<div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{memo.date}</div>
</div>
<button onClick={() => deleteMemo(memo.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 16, padding: 4, flexShrink: 0 }}>×</button>
</div>
))}
</div>
);
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function HarmonyMap(){
const[screen,setScreen]=useState('chordmap');
const[emo,setEmo]=useState(null);
const[sk,setSk]=useState('C major');
const[sch,setSch]=useState(null);
const[prog,setProg]=useState([]);
const[pi,setPi]=useState(-1);
const[pRow,setPRow]=useState(-1);
const[saved,setSaved]=useState([]);
const[mn,setMn]=useState(null);
const[al,setAl]=useState(null);
const[tip,setTip]=useState(null);
const[sd,setSd]=useState(false);
const[sr,setSr]=useState(null);
const[sv,setSv]=useState(false);
const[kmf,setKmf]=useState('major');
const[ext,setExt]=useState('triad');
const[ec,setEc]=useState(null);
const[ea,setEa]=useState(null);
const[es,setEs]=useState({c:0,t:0});
const[et,setEt]=useState('chord-quality');
const[disc,setDisc]=useState([]);
const[pa,setPa]=useState(false);
const[genre,setGenre]=useState(null);
const[progLooping,setProgLooping]=useState(false);
const[blueprint,setBlueprint]=useState(null);
const[swapIdx,setSwapIdx]=useState(null);
const[undoProg,setUndoProg]=useState(null);
const[originalKey,setOriginalKey]=useState(null);
const[keyToast,setKeyToast]=useState(null);
const[streak,setStreak]=useState({count:0,lastDate:null});
const[xp,setXp]=useState(0);
const[dailyAvail,setDailyAvail]=useState(false);
const[dailySecs,setDailySecs]=useState(60);
const[dailyActive,setDailyActive]=useState(false);
const[dailyDone,setDailyDone]=useState(false);
const[recState,setRecState]=useState('idle');// 'idle'|'recording'|'replaying'
const[takes,setTakes]=useState([]);
const[recElapsed,setRecElapsed]=useState(0);
const[replayChord,setReplayChord]=useState(null);
const[recChordCount,setRecChordCount]=useState(0);
const[rhythmPat,setRhythmPat]=useState(null);// null = even
const isRecording=useRef(false);
const recEventsRef=useRef([]);
const recStartRef=useRef(null);
const recElapsedTid=useRef(null);
const replayTids=useRef([]);
const lastTapTimeRef=useRef(null);
const[bpm,setBpm]=useState(90);const[beats,setBeats]=useState(4);const[stg,setStg]=useState(0.018);
const[bpmInput,setBpmInput]=useState('90');
useEffect(()=>{setBpmInput(String(bpm));},[bpm]);
const{metrOn,toggleMetro}=useMetronome(bpm,setBpm);
const[inst,setInst]=useState('underwater');
useEffect(()=>{audio.setInstrument(inst);},[inst]);
useEffect(()=>{const warmup=()=>{audio.init();};document.addEventListener('touchstart',warmup,{once:true,passive:true,capture:true});return()=>document.removeEventListener('touchstart',warmup,{capture:true});},[]);
useEffect(()=>{try{const s=localStorage.getItem('harmonymap_saved');if(s)setSaved(JSON.parse(s));const st=localStorage.getItem('harmonymap_settings');if(st){const o=JSON.parse(st);if(o.bpm)setBpm(o.bpm);if(o.beats)setBeats(o.beats);if(o.stg!=null)setStg(o.stg);if(o.sk)setSk(o.sk);if(['underwater','cinematic','analog-pad'].includes(o.inst))setInst(o.inst);}const sk2=localStorage.getItem('harmonymap_streak');if(sk2)setStreak(JSON.parse(sk2));const xp2=localStorage.getItem('harmonymap_xp');if(xp2)setXp(parseInt(xp2)||0);const today=new Date().toISOString().slice(0,10);const dl=localStorage.getItem('harmonymap_daily');if(!dl||JSON.parse(dl).date!==today)setDailyAvail(true);}catch(e){}},[]);
useEffect(()=>{try{localStorage.setItem('harmonymap_saved',JSON.stringify(saved));}catch(e){}},[saved]);
useEffect(()=>{try{localStorage.setItem('harmonymap_streak',JSON.stringify(streak));}catch(e){}},[streak]);
useEffect(()=>{try{localStorage.setItem('harmonymap_xp',String(xp));}catch(e){}},[xp]);
const lsDeb=useRef(null);
useEffect(()=>{if(lsDeb.current)clearTimeout(lsDeb.current);lsDeb.current=setTimeout(()=>{try{localStorage.setItem('harmonymap_settings',JSON.stringify({bpm,beats,stg,sk,inst}));}catch(e){}},500);return()=>{if(lsDeb.current)clearTimeout(lsDeb.current);};},[bpm,beats,stg,sk,inst]);
const swapTid=useRef(null);
const toastTid=useRef(null);
const dailyTid=useRef(null);
useEffect(()=>{if(!dailyActive)return;dailyTid.current=setInterval(()=>setDailySecs(s=>s>0?s-1:0),1000);return()=>clearInterval(dailyTid.current);},[dailyActive]);
useEffect(()=>{if(!dailyActive||dailySecs!==0)return;clearInterval(dailyTid.current);setDailyActive(false);setDailyDone(true);setDailyAvail(false);setXp(x=>x+10);try{localStorage.setItem('harmonymap_daily',JSON.stringify({date:new Date().toISOString().slice(0,10)}));}catch(e){};},[dailyActive,dailySecs]);
const clearSwap=useCallback(()=>{setSwapIdx(null);if(swapTid.current){clearTimeout(swapTid.current);swapTid.current=null;}},[]);
useEffect(()=>{const onKey=(e)=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'&&undoProg){setProg(undoProg);setUndoProg(null);clearSwap();}};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);},[undoProg,clearSwap]);
const dr=useRef([]);dr.current=disc;
const k=KEYS[sk],em=emo?EMO[emo]:null;
const ps=useMemo(()=>presets(sk),[sk]);
const bestNext=useMemo(()=>{if(!sch||!k)return[];const conns=gcon(k.ch,k.m).filter(c=>c.f===sch);const sorted=[...conns].sort((a,b)=>a.st==='strong'?-1:b.st==='strong'?1:0);return sorted.slice(0,3).map(c=>c.t);},[sch,k]);
const ghostChords=useMemo(()=>{if(!k||!sk)return[];const pName=k.m==='major'?`${k.r} minor`:`${k.r} major`;const pk=KEYS[pName];if(!pk)return[];const idxs=k.m==='major'?[3,6]:[0,3];return idxs.map(i=>({chord:pk.ch[i],fromKey:pName,idx:i})).filter(g=>g.chord&&!k.ch.includes(g.chord));},[k,sk]);

// Drag-reorder
const { dragging, dragOver, onLongPressStart, onLongPressEnd, onDragEnter, onDrop, cancelDrag } = useDragReorder(
prog, setProg,
useCallback(() => {
// Replay progression after reorder so user hears new sequence
setTimeout(() => {
const n = prog.map(s => s === 'REST' ? null : cn(pc(s).r, pc(s).t, 3));
audio.playProgression(n, bpm, i => setPi(i), beats, stg);
}, 100);
}, [prog, bpm, beats, stg])
);

const playC=useCallback(s=>{if(s==='REST')return;const lbl=extChordLabel(k,s,ext);if(lbl.startsWith('note:')){audio.playNote(lbl.slice(5)+'4',1.0,0.45);}else{audio.playChord(cn(pc(lbl).r,pc(lbl).t,3));}setSch(s);if(isRecording.current){recEventsRef.current.push({chord:lbl,mapChord:s,t:Date.now()-recStartRef.current});setRecChordCount(n=>n+1);};if(swapIdx!==null){setProg(p=>{const n=[...p];n[swapIdx]=lbl;return n;});if(swapTid.current)clearTimeout(swapTid.current);swapTid.current=setTimeout(()=>setSwapIdx(null),5000);}else{setProg(p=>{if(p.length>=16)return p;const n=[...p,lbl];const t=ctip('add',{prog:n});if(t)setTip(t);if(!dr.current.includes('fc')&&n.length===1)setDisc(d=>[...d,'fc']);if(!dr.current.includes('fp')&&n.length===4)setDisc(d=>[...d,'fp']);return n;});const t=ctip('sel',{ch:s});if(t)setTip(t);}},[k,ext,swapIdx]);
const addC=useCallback(s=>{setProg(p=>{if(p.length>=16)return p;const n=[...p,s];const t=ctip('add',{prog:n});if(t)setTip(t);if(!dr.current.includes('fc')&&n.length===1)setDisc(d=>[...d,'fc']);if(!dr.current.includes('fp')&&n.length===4)setDisc(d=>[...d,'fp']);return n;});},[]);
const remC=useCallback(i=>{setProg(p=>p.filter((_,j)=>j!==i));setRhythmPat(p=>p?p.filter((_,j)=>j!==i):null);setSwapIdx(cur=>{if(cur===null)return null;if(cur===i){if(swapTid.current){clearTimeout(swapTid.current);swapTid.current=null;}return null;}return cur>i?cur-1:cur;});},[]);
const selectSlot=useCallback((i,c)=>{if(swapTid.current)clearTimeout(swapTid.current);if(swapIdx===i){setSwapIdx(null);swapTid.current=null;return;}setUndoProg(prog);setSwapIdx(i);swapTid.current=setTimeout(()=>setSwapIdx(null),5000);if(c!=='REST'){if(c.startsWith('note:')){audio.playNote(c.slice(5)+'4',1.0,0.45);}else{const lbl=extChordLabel(k,c,ext);audio.playChord(cn(pc(lbl).r,pc(lbl).t,3));}}},[swapIdx,k,ext,prog]);
const warpKey=useCallback((ghostChordBase,fromKeyName)=>{const pk=KEYS[fromKeyName];if(!pk)return;audio.playChord(cn(pc(ghostChordBase).r,pc(ghostChordBase).t,3));setOriginalKey(cur=>cur===null?sk:cur);setSk(fromKeyName);setSch(ghostChordBase);setKmf(pk.m);setProg(p=>[...p,ghostChordBase]);if(toastTid.current)clearTimeout(toastTid.current);setKeyToast(`Key shifted to ${fromKeyName} — tap 🏠 to return`);toastTid.current=setTimeout(()=>setKeyToast(null),3500);},[sk]);
const returnHome=useCallback(()=>{if(!originalKey)return;const ok=KEYS[originalKey];if(!ok)return;setSk(originalKey);setSch(null);setKmf(ok.m);setOriginalKey(null);if(toastTid.current)clearTimeout(toastTid.current);setKeyToast(`Returned to ${originalKey}`);toastTid.current=setTimeout(()=>setKeyToast(null),2500);},[originalKey]);
const resolveNotes=useCallback(ch=>{if(ch==='REST')return null;if(ch.startsWith('note:'))return[ch.slice(5)+'4'];return cn(pc(ch).r,pc(ch).t,3);},[]);

// Pattern recognition for repetition teaching
const progPattern=useMemo(()=>{const seen=new Map();const L='ABCDEFGHIJKLMNOP';let idx=0;return prog.map(c=>{if(!c||c==='REST')return null;if(!seen.has(c))seen.set(c,L[idx++]||'?');return seen.get(c);});},[prog]);
const patternGuide=useMemo(()=>{
  const ls=progPattern.filter(Boolean);
  const ltc={};
  prog.forEach((c,i)=>{if(c&&c!=='REST'&&progPattern[i]&&!ltc[progPattern[i]])ltc[progPattern[i]]=c.startsWith('note:')?c.slice(5):c;});
  const NM={'ABAB':{name:'Loop',icon:'↺',tip:'The most common structure in pop music'},'AABA':{name:'Classic Hook',icon:'✦',tip:'Used in the majority of hit songs'},'ABAC':{name:'Story Arc',icon:'→',tip:'Returns home with a twist each time'},'ABCA':{name:'Bookend',icon:'⟨⟩',tip:'Same start and end feels complete'},'AAAB':{name:'Build-Up',icon:'△',tip:'The new chord hits harder after repetition'},'ABBA':{name:'Mirror',icon:'⇄',tip:'Symmetrical and deeply satisfying'},'AAAA':{name:'Mantra',icon:'○',tip:'Hypnotic simplicity — repetition IS the hook'},'ABCD':{name:'All New',icon:'?',tip:'Too varied — repeat one chord to create a hook'}};
  if(ls.length===0)return{type:'start',msg:'Tap any chord — it becomes your A'};
  if(ls.length===1)return{type:'building',current:'A _ _ _',steps:[{action:`Tap ${ltc['A']} again`,result:'A A _ _',hint:'builds a mantra'},{action:'Tap a different chord',result:'A B _ _',hint:'adds contrast'}]};
  if(ls.length===2){const[a,b]=ls;if(a===b)return{type:'building',current:'A A _ _',steps:[{action:`Tap something new (B)`,result:'A A B _',hint:'then A = AABA classic hook'},{action:`Tap ${ltc['A']} again`,result:'A A A _',hint:'building a mantra'}]};return{type:'building',current:'A B _ _',steps:[{action:`Tap ${ltc['A']} (A)`,result:'A B A _',hint:'sets up a hook or loop'},{action:`Tap ${ltc['B']} (B)`,result:'A B B _',hint:'doubles down on B'}]};}
  if(ls.length===3){const sugs=[];['A','B','C','D'].forEach(n=>{const c=[...ls,n].join('');if(NM[c]){const ch=ltc[n];sugs.push({action:ch?`Tap ${ch} (${n})`:`Tap new chord (${n})`,result:[...ls,n].join(' '),name:NM[c].name,icon:NM[c].icon});}});return{type:'almost',current:ls.join(' ')+' _',sugs:sugs.slice(0,3)};}
  const named=NM[ls.slice(0,4).join('')];
  if(named)return{type:'named',name:named.name,icon:named.icon,pattern:ls.slice(0,4).join(' '),tip:named.tip};
  return{type:'custom',pattern:ls.join(' '),tip:'Your own pattern — repeat it to lock in the feel'};
},[prog,progPattern]);
const playP=useCallback((b=bpm,bt=beats,s=stg)=>{const n=prog.map(resolveNotes);const pat=rhythmPat?rhythmPat.map(sec=>sec*b/60):null;audio.playProgression(n,b,i=>setPi(i),bt,s,pat);const t=ctip('play',{prog});if(t)setTimeout(()=>setTip(t),2000);},[prog,bpm,beats,stg,rhythmPat,resolveNotes]);
const loopP=useCallback((b=bpm,bt=beats,s=stg)=>{const n=prog.map(resolveNotes);const pat=rhythmPat?rhythmPat.map(sec=>sec*b/60):null;setProgLooping(true);audio.playLoop(n,b,i=>{setPi(i);},bt,s,pat);},[prog,bpm,beats,stg,rhythmPat,resolveNotes]);
// Restart loop at new BPM whenever tempo changes while looping
useEffect(()=>{if(progLooping)loopP();},[bpm,beats]);// eslint-disable-line react-hooks/exhaustive-deps
const saveI=useCallback(()=>{if(!prog.length)return;setSaved(p=>[...p,{id:Date.now(),emo,k:sk,prog:[...prog],date:new Date().toLocaleDateString()}]);if(!dr.current.includes('fs'))setDisc(d=>[...d,'fs']);setXp(x=>x+2);const today=new Date().toISOString().slice(0,10);setStreak(s=>{const diff=s.lastDate?Math.round((new Date(today)-new Date(s.lastDate))/86400000):null;const cnt=diff===1?(s.count||0)+1:diff===0?s.count||1:1;return{count:cnt,lastDate:today};});},[prog,emo,sk]);
const selEmo=useCallback(e=>{const entry=EMO[e];setEmo(e);const fk=entry.ks[0];if(fk){setSk(fk);setKmf(KEYS[fk]?.m||'major');}setSch(null);if(entry.pr?.[0]?.ch)setProg(entry.pr[0].ch);const pb=parseInt(entry.tp);if(pb)setBpm(pb);setScreen('chordmap');},[]);
const stopAll=useCallback(()=>{audio.absoluteStop();setPa(false);setPi(-1);setPRow(-1);setProgLooping(false);},[]);
const newEar=useCallback(()=>{setEa(null);const c=earGen(et);setEc(c);if(c)setTimeout(()=>{if(c.pt==='chord')audio.playChord(c.pd);else if(c.pt==='melodic')audio.playMelodicInterval(c.pd[0],c.pd[1]);else if(c.pt==='two'){audio.playChord(c.pd[0],1.3);setTimeout(()=>audio.playChord(c.pd[1],1.3),1500);}},300);},[et]);
const replayEar=useCallback(()=>{if(!ec)return;if(ec.pt==='chord')audio.playChord(ec.pd);else if(ec.pt==='melodic')audio.playMelodicInterval(ec.pd[0],ec.pd[1]);else if(ec.pt==='two'){audio.playChord(ec.pd[0],1.3);setTimeout(()=>audio.playChord(ec.pd[1],1.3),1500);}},[ec]);
const ansEar=useCallback(a=>{if(ea)return;setEa(a);const ok=a===ec?.ans;setEs(s=>({c:s.c+(ok?1:0),t:s.t+1}));if(ok){setXp(x=>x+1);if(!dr.current.includes('fe'))setDisc(d=>[...d,'fe']);}if(dailyActive)setTimeout(()=>{setEa(null);newEar();},900);},[ec,ea,dailyActive,newEar]);
const startDaily=useCallback(()=>{setDailySecs(60);setDailyActive(true);setEa(null);setEc(null);newEar();},[newEar]);

const startRec=useCallback(()=>{
  recEventsRef.current=[];
  recStartRef.current=Date.now();
  isRecording.current=true;
  setRecState('recording');
  setRecElapsed(0);
  setRecChordCount(0);
  recElapsedTid.current=setInterval(()=>setRecElapsed(s=>s+1),1000);
},[]);

const stopRec=useCallback(()=>{
  isRecording.current=false;
  clearInterval(recElapsedTid.current);
  const evs=recEventsRef.current;
  if(evs.length>0){
    const duration=Date.now()-recStartRef.current;
    const take={id:Date.now(),key:sk,events:[...evs],duration,date:new Date().toLocaleTimeString(),chordCount:evs.length};
    setTakes(prev=>[take,...prev].slice(0,10));
    // Compute rhythm pattern in seconds from inter-chord gaps
    const recPat=evs.slice(0,16).map((ev,i)=>{
      const nextT=evs[i+1]?.t;
      if(nextT!=null)return Math.max(0.1,(nextT-ev.t)/1000);
      return 2;
    });
    const chords=evs.slice(0,16).map(e=>e.chord);
    setProg(chords);
    setRhythmPat(recPat);
    setTimeout(()=>{
      const n=chords.map(ch=>ch==='REST'?null:cn(pc(ch).r,pc(ch).t,3));
      const pat=recPat.map(sec=>sec*bpm/60);
      setProgLooping(true);
      audio.playLoop(n,bpm,i=>setPi(i),beats,stg,pat);
    },220);
  }
  setRecState('idle');
},[sk,bpm,beats,stg]);

const replayTake=useCallback((take)=>{
  replayTids.current.forEach(clearTimeout);
  replayTids.current=[];
  setRecState('replaying');
  take.events.forEach((ev,i)=>{
    const nextT=take.events[i+1]?.t;
    // Duration = gap to next tap, scaled to 0.88 so chords don't bleed into each other.
    // Last chord gets 2s or the median gap, whichever is larger.
    const dur=nextT!=null?Math.max(0.18,(nextT-ev.t)/1000*0.88):2.0;
    const tid=setTimeout(()=>{
      if(ev.chord.startsWith('note:')){audio.playNote(ev.chord.slice(5)+'4',dur,0.45);}else{audio.playChord(cn(pc(ev.chord).r,pc(ev.chord).t,3),dur,stg);}
      setSch(ev.mapChord||pc(ev.chord).r);
      setReplayChord(ev.chord);
    },ev.t);
    replayTids.current.push(tid);
  });
  const lastT=take.events[take.events.length-1]?.t||0;
  replayTids.current.push(setTimeout(()=>{setRecState('idle');setReplayChord(null);setSch(null);},lastT+2400));
},[stg]);

const stopReplay=useCallback(()=>{
  replayTids.current.forEach(clearTimeout);
  replayTids.current=[];
  setRecState('idle');
  setReplayChord(null);
},[]);

const loadTake=useCallback((take)=>{
  const unique=[];take.events.forEach(ev=>{if(!unique.includes(ev.chord)&&unique.length<16)unique.push(ev.chord);});
  setProg(unique);setSch(null);
},[]);

// ── 16-slot Progression Grid (drag-reorder enabled) ──────────
const ProgGrid = useCallback(() => {
const isAnyActive = progLooping || pi >= 0;
return (
<div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 16, padding: 14, marginBottom: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
<div style={S.lbl}>Progression Grid {prog.length > 0 && `${prog.length}/16`}</div>
<div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
{prog.length > 0 && <button onClick={() => exportMIDI(prog, bpm, beats)} style={{ ...S.btn('rgba(78,205,196,0.12)', '#4ECDC4', 'rgba(78,205,196,0.3)'), padding: '3px 8px', fontSize: 9, fontWeight: 700 }}>⬇ MIDI</button>}
{dragging !== null && <span style={{ fontSize: 9, color: '#FFD700', fontWeight: 700 }}>Drop to reorder</span>}
</div>
</div>

  {/* Mode banner */}
  <div style={{ background: dragging !== null ? 'rgba(255,215,0,0.12)' : swapIdx !== null ? 'rgba(255,215,0,0.08)' : 'rgba(78,205,196,0.07)', border: `1px solid ${dragging !== null ? 'rgba(255,215,0,0.5)' : swapIdx !== null ? 'rgba(255,215,0,0.35)' : 'rgba(78,205,196,0.22)'}`, borderRadius: 8, padding: '6px 10px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
    <span style={{ fontSize: 11, color: dragging !== null ? '#FFD700' : swapIdx !== null ? '#FFD700' : 'rgba(78,205,196,0.9)', fontWeight: 500, lineHeight: 1.4 }}>
      {dragging !== null ? `✋ Dragging slot ${dragging + 1} — drop on another slot to swap` : swapIdx !== null ? `✏️ Slot ${swapIdx + 1} active — tap a chord on the map to swap it in` : '🎵 Tap chords on the map · Long-press to drag & reorder'}
    </span>
    {swapIdx !== null && dragging === null && <button onClick={clearSwap} style={{ ...S.btn('rgba(255,215,0,0.2)', '#FFD700', 'rgba(255,215,0,0.5)'), padding: '3px 9px', fontSize: 10, flexShrink: 0 }}>✓ Done</button>}
    {dragging !== null && <button onClick={cancelDrag} style={{ ...S.btn('rgba(255,107,107,0.2)', '#FF6B6B', 'rgba(255,107,107,0.4)'), padding: '3px 9px', fontSize: 10, flexShrink: 0 }}>Cancel</button>}
  </div>

  {/* Pattern tip */}
  {patternGuide&&(()=>{const g=patternGuide;
    if(g.type==='start')return<div style={{marginBottom:8,padding:'8px 12px',background:'rgba(78,205,196,0.06)',borderRadius:10,border:'1px solid rgba(78,205,196,0.12)'}}>
      <div style={{fontSize:9,color:'rgba(78,205,196,0.6)',fontWeight:700,letterSpacing:1,marginBottom:3}}>PATTERN GUIDE</div>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.55)'}}>{g.msg}</div></div>;
    if(g.type==='building')return<div style={{marginBottom:8,padding:'8px 12px',background:'rgba(78,205,196,0.06)',borderRadius:10,border:'1px solid rgba(78,205,196,0.12)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{fontSize:9,color:'rgba(78,205,196,0.6)',fontWeight:700,letterSpacing:1}}>BUILDING</span><span style={{fontSize:14,fontWeight:900,letterSpacing:5,color:'#4ECDC4'}}>{g.current}</span></div>
      {g.steps.map((s,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:5,marginBottom:i<g.steps.length-1?4:0}}><span style={{fontSize:10,color:'#FFB347',fontWeight:700}}>→</span><span style={{fontSize:10,color:'rgba(255,255,255,0.7)',fontWeight:600}}>{s.action}</span><span style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>{s.hint}</span></div>)}</div>;
    if(g.type==='almost')return<div style={{marginBottom:8,padding:'8px 12px',background:'rgba(255,183,71,0.07)',borderRadius:10,border:'1px solid rgba(255,183,71,0.2)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{fontSize:9,color:'rgba(255,183,71,0.8)',fontWeight:700,letterSpacing:1}}>ONE MORE CHORD</span><span style={{fontSize:14,fontWeight:900,letterSpacing:5,color:'#FFB347'}}>{g.current}</span></div>
      {g.sugs.map((s,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:5,marginBottom:i<g.sugs.length-1?4:0}}><span style={{fontSize:11,color:'#FFB347'}}>{s.icon}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.7)',fontWeight:600}}>{s.action}</span><span style={{fontSize:9,color:'rgba(255,183,71,0.7)',fontWeight:700}}>→ {s.name}</span></div>)}</div>;
    if(g.type==='named')return<div style={{marginBottom:8,padding:'8px 12px',background:'rgba(78,205,196,0.1)',borderRadius:10,border:'1px solid rgba(78,205,196,0.3)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><span style={{fontSize:16}}>{g.icon}</span><span style={{fontSize:13,fontWeight:900,color:'#4ECDC4'}}>{g.name}</span><span style={{fontSize:11,fontWeight:900,letterSpacing:4,color:'rgba(78,205,196,0.5)'}}>{g.pattern}</span></div>
      <div style={{fontSize:10,color:'rgba(255,255,255,0.5)'}}>{g.tip}</div></div>;
    return<div style={{marginBottom:8,padding:'8px 12px',background:'rgba(78,205,196,0.06)',borderRadius:10,border:'1px solid rgba(78,205,196,0.12)'}}>
      <span style={{fontSize:12,fontWeight:900,letterSpacing:3,color:'#4ECDC4'}}>{g.pattern}</span>
      <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:2}}>{g.tip}</div></div>;
  })()}

  {/* 4×4 grid */}
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
    {Array.from({ length: 16 }, (_, i) => {
      const c = prog[i] || null;
      const isActive = swapIdx === i;
      const isPlaying = pi === i;
      const isDragSource = dragging === i;
      const isDragTarget = dragOver === i && dragging !== null && dragging !== i;

      if (!c) return (
        <div key={i}
          onPointerEnter={() => onDragEnter(i)}
          onPointerUp={() => dragging !== null && onDrop(i)}
          style={{ background: isDragTarget ? 'rgba(255,215,0,0.12)' : 'rgba(255,255,255,0.03)', border: isDragTarget ? '1px dashed rgba(255,215,0,0.5)' : '1px dashed rgba(255,255,255,0.07)', borderRadius: 10, minHeight: 54, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.12)', userSelect: 'none', transition: 'all 0.15s' }}>
          <span style={{ fontSize: 15, fontWeight: 300, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 7, marginTop: 2 }}>{i + 1}</span>
        </div>
      );

      return (
        <div key={i} style={{ position: 'relative' }}
          onPointerEnter={() => onDragEnter(i)}
          onPointerUp={() => dragging !== null ? onDrop(i) : null}>
          <div
            onPointerDown={() => { onLongPressStart(i); }}
            onPointerUp={() => { onLongPressEnd(); if (!isDragSource) selectSlot(i, c); }}
            onPointerLeave={onLongPressEnd}
            style={{
              background: isDragSource ? 'rgba(255,215,0,0.32)' : isDragTarget ? 'rgba(0,240,200,0.22)' : isActive ? 'rgba(255,215,0,0.22)' : cc(c) + '2a',
              border: isDragSource ? '2px solid #FFD700' : isDragTarget ? '2px solid #4ECDC4' : isActive ? '2px solid #FFD700' : `1.5px solid ${cc(c)}45`,
              borderRadius: 10, minHeight: 54, padding: '8px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: 'grab', touchAction: 'none', userSelect: 'none',
              transition: 'all 0.15s',
              animation: isActive && !isDragSource ? 'swapPulse 1.2s ease-in-out infinite' : undefined,
              boxShadow: isDragSource ? '0 8px 28px rgba(255,215,0,0.6)' : isActive ? '0 0 20px rgba(255,215,0,0.8),0 0 40px rgba(255,215,0,0.3)' : isPlaying ? `0 0 18px ${cc(c)}a0,0 0 36px ${cc(c)}40` : 'none',
              transform: isDragSource ? 'scale(1.08) rotate(2deg)' : isPlaying && !isActive ? 'scale(1.05)' : undefined,
            }}>
            {progPattern[i]&&<div style={{position:'absolute',top:3,left:5,fontSize:8,fontWeight:900,color:isDragSource||isActive?'rgba(255,215,0,0.6)':'rgba(78,205,196,0.5)',lineHeight:1,letterSpacing:0}}>{progPattern[i]}</div>}
            <div style={{ fontSize: 11, fontWeight: 800, color: isDragSource ? '#FFD700' : isActive ? '#FFD700' : cc(c), textAlign: 'center', lineHeight: 1.2 }}>{c}</div>
            <div style={{ fontSize: 7, color: isActive ? 'rgba(255,215,0,0.55)' : 'rgba(255,255,255,0.25)', marginTop: 2 }}>{i + 1}</div>
            {dragging === null && isActive && <div style={{ fontSize: 7, color: '#FFD700', marginTop: 1 }}>←tap</div>}
            {dragging === null && !isActive && <div style={{ fontSize: 6, color: 'rgba(255,255,255,0.15)', marginTop: 1 }}>hold</div>}
          </div>
          {dragging === null && <button onClick={e => { e.stopPropagation(); remC(i); }} style={{ position: 'absolute', top: -4, right: -4, background: 'rgba(255,60,60,0.85)', border: 'none', borderRadius: '50%', width: 14, height: 14, color: '#fff', fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, lineHeight: 1 }}>×</button>}
        </div>
      );
    })}
  </div>

  {/* Last move + tension meter */}
  {prog.filter(c => c && c !== 'REST').length >= 2 && (() => {
    const fp = prog.filter(c => c && c !== 'REST');
    const lf = fp[fp.length - 2], lt = fp[fp.length - 1];
    const m = mf(lf, lt), v = vl(lf, lt), tl = tensionLevel(lf, lt), rA = chordRN(k, lf), rB = chordRN(k, lt);
    return <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: cc(lf) }}>{lf}</span>{rA && <span style={{ fontSize: 9, color: 'rgba(255,215,0,0.65)' }}>({rA})</span>}
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>→</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: cc(lt) }}>{lt}</span>{rB && <span style={{ fontSize: 9, color: 'rgba(255,215,0,0.65)' }}>({rB})</span>}
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginLeft: 2 }}>{m.e} {m.l}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
          {Array.from({ length: 5 }, (_, j) => <div key={j} style={{ width: 5, height: 10, borderRadius: 1, background: j < tl ? (tl >= 4 ? '#FF6B6B' : tl >= 3 ? '#FFB347' : '#4ECDC4') : 'rgba(255,255,255,0.1)' }} />)}
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', marginLeft: 3 }}>{tl >= 4 ? 'Dramatic' : tl >= 3 ? 'High' : tl >= 2 ? 'Medium' : 'Smooth'}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{v.mv.map((mv, j) => <span key={j} style={{ fontSize: 9, color: mv.s ? '#4ECDC480' : '#FFB34780', background: mv.s ? '#4ECDC408' : '#FFB34708', borderRadius: 3, padding: '1px 5px' }}>{mv.s ? `${mv.f} stays` : `${mv.f}→${mv.t}`}</span>)}</div>
      {idProg(fp) && <div style={{ marginTop: 4, fontSize: 10, color: '#FFB347', background: 'rgba(255,183,71,0.08)', borderRadius: 6, padding: '4px 7px' }}>✦ {idProg(fp)}</div>}
    </div>;
  })() || null}

  {/* Vibe Score */}
  {prog.filter(c => c && c !== 'REST').length >= 4 && (() => {
    const vs = vibeScore(prog);
    return <div style={{ background: 'rgba(78,205,196,0.05)', border: '1px solid rgba(78,205,196,0.18)', borderRadius: 10, padding: '8px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div><div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Vibe Score</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}><span style={{ fontSize: 22, fontWeight: 900, color: '#4ECDC4', lineHeight: 1 }}>{vs.score}</span><span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{vs.label}</span></div>
      </div>
      <button onClick={() => { const vs2 = vibeScore(prog); const txt = [`🎵 HarmonyMap`, `Vibe: ${vs2.score}% ${vs2.label}`, `Streak: 🔥${streak.count}`, `Progression: ${prog.filter(s => s && s !== 'REST').join(' → ')}`, `XP: ${xp}`].join('\n'); try { navigator.clipboard.writeText(txt); setTip('Stats copied!'); } catch (er) { } }} style={{ ...S.btn('rgba(78,205,196,0.12)', '#4ECDC4', 'rgba(78,205,196,0.3)'), padding: '5px 10px', fontSize: 10, flexShrink: 0 }}>📋 Export Stats</button>
    </div>;
  })() || null}

  {/* Actions */}
  {prog.length > 0 && <div>
    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
      <button onClick={() => playP()} style={{ ...S.btn('linear-gradient(135deg,#4ECDC4,#44B09E)', '#fff', 'transparent'), border: 'none' }}>▶ Play</button>
      <button onClick={progLooping ? stopAll : () => loopP()} style={{ ...S.btn(progLooping ? 'rgba(255,107,107,0.18)' : 'rgba(199,125,255,0.15)', progLooping ? '#FF6B6B' : '#C77DFF', progLooping ? 'rgba(255,107,107,0.4)' : 'rgba(199,125,255,0.3)') }}>{progLooping ? '■ Stop' : '↺ Loop'}</button>
      <button onClick={() => addC('REST')} style={{ ...S.btn(), padding: '8px 10px', fontSize: 11 }}>𝄽 Rest</button>
      <button onClick={saveI} style={S.btn('rgba(255,215,0,0.15)', '#FFD700', 'rgba(255,215,0,0.3)')}>♡ Save</button>
      {undoProg && <button onClick={() => { setProg(undoProg); setUndoProg(null); clearSwap(); }} style={S.btn('rgba(78,205,196,0.12)', '#4ECDC4', 'rgba(78,205,196,0.3)')}>↩ Undo</button>}
      <button onClick={() => { stopAll(); setProg([]); setRhythmPat(null); lastTapTimeRef.current=null; setUndoProg(null); clearSwap(); setBlueprint(null); }} style={S.btn()}>Clear</button>
    </div>
    {prog.filter(c => c && c !== 'REST').length >= 4 && <div style={{ marginBottom: 6 }}>
      {!blueprint
        ? <button onClick={() => setBlueprint(generateBlueprint(prog, k))} style={{ ...S.btn('rgba(255,183,71,0.1)', '#FFB347', 'rgba(255,183,71,0.3)'), width: '100%', fontSize: 11, display: 'flex', justifyContent: 'center' }}>✦ Generate Beat Blueprint</button>
        : <div style={{ background: 'rgba(255,183,71,0.07)', border: '1px solid rgba(255,183,71,0.3)', borderRadius: 10, padding: '10px 12px', fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, display: 'flex', gap: 8, alignItems: 'flex-start', animation: 'fadeIn 0.3s' }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>✦</span>
          <div style={{ flex: 1 }}>{blueprint}</div>
          <button onClick={() => setBlueprint(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 13, padding: 0, flexShrink: 0 }}>×</button>
        </div>
      }
    </div>}
  </div>}
</div>

);
}, [prog, pi, progLooping, swapIdx, dragging, dragOver, bpm, beats, stg, k, ext, undoProg, blueprint, streak, xp, clearSwap, cancelDrag, onLongPressStart, onLongPressEnd, onDragEnter, onDrop, selectSlot, remC, addC, playP, loopP, saveI, stopAll]);

const tabs=[{k:'chordmap',i:'◉',l:'Map',c:'#00F0C8'},{k:'home',i:'✦',l:'Explore',c:'#FF4D6D'},{k:'ear',i:'👂',l:'Train',c:'#FFB347'},{k:'saved',i:'♡',l:'Studio',c:'#C77DFF'}];
const isAudioActive = pa || progLooping || pi >= 0 || pRow >= 0;

return(

<div style={{width:'100%',minHeight:'100vh',background:em?em.gr:'linear-gradient(135deg,#0d0d24,#1a0a38,#060f26)',color:'#F2F2F2',fontFamily:"'Segoe UI','SF Pro Display',-apple-system,sans-serif",position:'relative',overflow:'hidden',transition:'background 0.8s'}}>
<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:`radial-gradient(ellipse at 15% 12%,${em?em.co[0]+'40':'#FF4D6D40'} 0%,transparent 52%),radial-gradient(ellipse at 85% 80%,${em?em.co[1]+'32':'#00F0C830'} 0%,transparent 52%),radial-gradient(ellipse at 55% 45%,${em?em.co[0]+'1e':'#D946EF24'} 0%,transparent 48%)`,pointerEvents:'none',zIndex:0,animation:'orbFloat 14s ease-in-out infinite'}}/>

{/* FLOATING PLAYBAR */}
<FloatingPlaybar
prog={prog} bpm={bpm} sk={sk}
progLooping={progLooping} pi={pi}
onPlay={() => playP()} onLoop={() => loopP()} onStop={stopAll}
onClear={() => { stopAll(); setProg([]); setRhythmPat(null); lastTapTimeRef.current=null; setUndoProg(null); }}
visible={prog.length > 0}
/>

{/* FLOATING RECORDER */}
<FloatingRecorder
  recState={recState} takes={takes} setTakes={setTakes}
  recElapsed={recElapsed} recChordCount={recChordCount} replayChord={replayChord}
  onStart={startRec} onStop={stopRec} onStopReplay={stopReplay}
  onReplay={replayTake}
/>


{/* KEY WARP TOAST */}
{keyToast&&<div style={{position:'fixed',top:80,left:'50%',transform:'translateX(-50%)',background:'rgba(78,205,196,0.95)',color:'#0a0a1a',borderRadius:12,padding:'10px 20px',fontSize:12,fontWeight:700,zIndex:300,boxShadow:'0 4px 20px rgba(0,0,0,0.5)',whiteSpace:'nowrap',animation:'fadeIn 0.3s',backdropFilter:'blur(10px)'}}>{keyToast}</div>}

{/* NAV */}

  <nav style={{position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 10px',background:'rgba(8,8,20,0.92)',backdropFilter:'blur(24px)',borderBottom:`2px solid ${tabs.find(t=>t.k===screen)?.c||'#00F0C8'}50`}}>
    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
      <div style={{width:24,height:24,borderRadius:'50%',background:'linear-gradient(135deg,#FF6B6B,#4ECDC4,#C77DFF)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900}}>H</div>
      <span style={{fontWeight:700,fontSize:13}}>HarmonyMap</span>
    </div>
    <div style={{display:'flex',gap:1,overflowX:'auto',flexShrink:1,alignItems:'center'}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setScreen(t.k)} style={{background:screen===t.k?`${t.c}20`:'transparent',border:'none',color:screen===t.k?t.c:'rgba(255,255,255,0.4)',borderRadius:6,padding:'5px 7px',cursor:'pointer',fontSize:9,fontWeight:screen===t.k?800:500,display:'flex',flexDirection:'column',alignItems:'center',whiteSpace:'nowrap',minHeight:44,justifyContent:'center',position:'relative',textShadow:screen===t.k?`0 0 10px ${t.c}80`:'none',transition:'all 0.2s'}}><span style={{fontSize:13,position:'relative'}}>{t.i}{t.k==='ear'&&dailyAvail&&!dailyDone&&<span style={{position:'absolute',top:-2,right:-3,width:6,height:6,background:'#FFB347',borderRadius:'50%',boxShadow:'0 0 5px #FFB347',display:'block'}}/>}</span><span>{t.l}</span></button>)}
      {streak.count>0&&<div style={{display:'flex',alignItems:'center',paddingLeft:5,paddingRight:3,fontSize:10,color:'rgba(255,200,100,0.75)',fontWeight:800,flexShrink:0,whiteSpace:'nowrap'}}>🔥{streak.count}</div>}
    </div>
    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,marginLeft:6}}>
      {isAudioActive&&<button onClick={stopAll} style={{background:'linear-gradient(135deg,#FF6B6B,#FF4444)',border:'1px solid rgba(255,107,107,0.6)',borderRadius:8,padding:'6px 10px',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:800,flexShrink:0,boxShadow:'0 0 12px rgba(255,107,107,0.5)',animation:'pulse 1.4s ease-in-out infinite'}}>■ Stop</button>}
    </div>
  </nav>

{/* CONTEXT TIP */}
{tip&&<div style={{position:'relative',zIndex:50,margin:'8px 12px 0',background:'rgba(78,205,196,0.1)',border:'1px solid rgba(78,205,196,0.25)',borderRadius:12,padding:'12px 14px',display:'flex',gap:10,alignItems:'flex-start',animation:'fadeIn 0.3s'}}>
<span style={{fontSize:16,flexShrink:0}}>💡</span>
<div style={{flex:1,fontSize:12,color:'rgba(255,255,255,0.75)',lineHeight:1.6}}>{tip}</div>
<button onClick={()=>setTip(null)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:14,padding:0}}>×</button>

  </div>}

  <main style={{position:'relative',zIndex:1,paddingBottom:72}}>

{/* ═══ HOME ═══ */}
{screen==='home'&&(()=>{const EMO_IC={sad:'○',hopeful:'✦',dark:'◆',dreamy:'◎',powerful:'⬟',nostalgic:'◇',romantic:'♡',aggressive:'▲',cinematic:'◐',lonely:'·'};return(<div style={{padding:'28px 16px 36px',maxWidth:600,margin:'0 auto'}}>
  <div style={{textAlign:'center',marginBottom:28}}>
    <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.28)',letterSpacing:3,textTransform:'uppercase',marginBottom:12}}>Start here</div>
    <h1 style={{fontSize:32,fontWeight:900,margin:'0 0 10px',lineHeight:1.1,background:'linear-gradient(135deg,#FF6B6B 0%,#C77DFF 50%,#4ECDC4 100%)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>What should it feel like?</h1>
    <p style={{fontSize:13,color:'rgba(255,255,255,0.38)',margin:0,lineHeight:1.5}}>Pick a mood — we set the key, tempo, and first progression.</p>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10}}>
    {Object.entries(EMO).map(([ek,e])=><button key={ek} onClick={()=>selEmo(ek)} style={{background:e.gr,border:`1.5px solid ${e.co[0]}28`,borderRadius:18,padding:'20px 16px 16px',cursor:'pointer',textAlign:'left',position:'relative',overflow:'hidden',minHeight:110,transition:'border-color 0.2s,transform 0.15s'}}>
      <div style={{position:'absolute',top:-24,right:-24,width:90,height:90,borderRadius:'50%',background:e.co[0]+'22',filter:'blur(28px)',pointerEvents:'none'}}/>
      <div style={{position:'absolute',top:14,right:14,fontSize:20,color:e.co[0],opacity:0.45,fontWeight:900,lineHeight:1,pointerEvents:'none'}}>{EMO_IC[ek]||'◉'}</div>
      <div style={{fontSize:19,fontWeight:800,color:e.co[0],marginBottom:4,position:'relative'}}>{e.l}</div>
      <div style={{fontSize:10,color:'rgba(255,255,255,0.48)',position:'relative',lineHeight:1.4,marginBottom:10}}>{e.p}</div>
      <div style={{fontSize:9,color:e.co[0],opacity:0.6,position:'relative',fontWeight:700,letterSpacing:0.3}}>{e.ks[0]?.replace(' major','').replace(' minor','m')} · {e.tp} BPM</div>
    </button>)}
  </div>
  {disc.length>0&&<div style={{...S.card(),marginTop:16}}>
    <div style={S.lbl}>Your Discoveries</div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      {disc.includes('fc')&&<span style={{fontSize:11,color:'#4ECDC4',background:'#4ECDC415',borderRadius:6,padding:'4px 10px'}}>First chord</span>}
      {disc.includes('fp')&&<span style={{fontSize:11,color:'#FFB347',background:'#FFB34715',borderRadius:6,padding:'4px 10px'}}>First progression</span>}
      {disc.includes('fs')&&<span style={{fontSize:11,color:'#FF6B6B',background:'#FF6B6B15',borderRadius:6,padding:'4px 10px'}}>First save</span>}
      {disc.includes('fe')&&<span style={{fontSize:11,color:'#C77DFF',background:'#C77DFF15',borderRadius:6,padding:'4px 10px'}}>Ear training win</span>}
    </div>
  </div>}
</div>);})()}

{/* ═══ EMOTION ═══ */}
{screen==='emotion'&&em&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
  <button onClick={()=>setScreen('home')} style={{background:'none',border:'none',color:'rgba(255,255,255,0.4)',cursor:'pointer',fontSize:12,marginBottom:10,padding:0}}>← Back</button>
  <div style={{textAlign:'center',marginBottom:20,padding:'20px 14px',background:'rgba(0,0,0,0.3)',borderRadius:18,border:`1px solid ${em.co[0]}30`}}>
    <h2 style={{fontSize:28,fontWeight:800,color:em.co[0],margin:'0 0 4px'}}>{em.l}</h2>
    <p style={{fontSize:13,color:'rgba(255,255,255,0.5)',margin:0}}>{em.p}</p>
  </div>
  <div style={S.card()}>
    <h3 style={{fontSize:13,fontWeight:700,marginBottom:10,marginTop:0,color:em.co[0]}}>Musical ingredients</h3>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
      {[{l:'Keys',v:em.ks.join(', ')},{l:'Tempo',v:em.tp+' BPM'},{l:'Feel',v:em.fl},{l:'Sounds to use',v:em.tx}].map(i=><div key={i.l} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'9px 11px'}}><div style={{...S.lbl,fontSize:9,marginBottom:3}}>{i.l}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.75)',lineHeight:1.4}}>{i.v}</div></div>)}
    </div>
  </div>
  {em.pr.map((p,ri)=><div key={ri} style={{...S.card(),cursor:'default'}}>
    <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>{p.ch.map((c,j)=><span key={j} style={S.pill(cc(c),pRow===ri&&pi===j)}>{c}{j<p.ch.length-1&&<span style={{marginLeft:6,color:'rgba(255,255,255,0.25)'}}>→</span>}</span>)}</div>
    <p style={{fontSize:11,color:'rgba(255,255,255,0.5)',margin:'0 0 10px',lineHeight:1.4}}>{p.d}</p>
    <div style={{display:'flex',gap:8}}>
      <button onClick={()=>{audio.playProgression(p.ch.map(s=>cn(pc(s).r,pc(s).t,3)),parseInt(em.tp)||72,idx=>{setPi(idx);setPRow(idx===-1?-1:ri);});}} style={{...S.btn('rgba(255,255,255,0.1)','#fff','rgba(255,255,255,0.2)'),padding:'10px 18px',fontSize:13}}>▶ Listen</button>
      <button onClick={()=>{setProg(p.ch);setScreen('chordmap');}} style={{...S.btn(em.co[0]+'30',em.co[0],em.co[0]+'50'),padding:'10px 18px',fontSize:13,fontWeight:800}}>Use this → Map</button>
    </div>
  </div>)}
  <div style={S.card()}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
      <h3 style={{fontSize:13,fontWeight:700,margin:0}}>Melody notes</h3>
      <button onClick={()=>setSd(!sd)} style={{...S.btn(),fontSize:10,padding:'4px 10px'}}>{sd?'Roles':'Degrees'}</button>
    </div>
    <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
      {em.sn.map((n,ni)=>{const iS=em.sf.includes(n),iT=em.tn.includes(n),iC=em.cl.includes(n);const bg=iS?'#4ECDC430':iT?'#FF6B6B30':iC?'#FFB34730':'rgba(255,255,255,0.06)';const bc=iS?'#4ECDC4':iT?'#FF6B6B':iC?'#FFB347':'rgba(255,255,255,0.2)';const tc=iS?'#4ECDC4':iT?'#FF6B6B':iC?'#FFB347':'#fff';const dg=(k?.m==='minor'?Dm:DM)[ni];
        return <button key={n} onClick={()=>{audio.playNote(n+'4',0.8,0.5);setMn(n);setTimeout(()=>setMn(null),500);}} style={{background:bg,border:`1.5px solid ${bc}60`,borderRadius:10,padding:'8px 12px',color:tc,cursor:'pointer',fontSize:14,fontWeight:700,textAlign:'center',minWidth:42,boxShadow:mn===n?`0 0 15px ${bc}50`:'none',transform:mn===n?'scale(1.08)':'scale(1)',transition:'all 0.15s'}}><div>{n}</div><div style={{fontSize:7,opacity:0.65,marginTop:2}}>{sd?(dg?.d||''):(iS?'safe':iT?'tension':iC?'color':'')}</div></button>;})}
    </div>
    <div style={{display:'flex',gap:10,marginTop:8}}><span style={{fontSize:9,color:'#4ECDC4'}}>● Safe</span><span style={{fontSize:9,color:'#FFB347'}}>● Color</span><span style={{fontSize:9,color:'#FF6B6B'}}>● Tension</span></div>
  </div>
</div>}

{/* ═══ CHORD MAP ═══ */}
{screen==='chordmap'&&<div style={{padding:'14px',maxWidth:600,margin:'0 auto'}}>

  {/* ── MOOD STRIP ── */}
  {emo&&em&&<div style={{display:'flex',alignItems:'center',gap:10,background:`${em.co[0]}18`,border:`1px solid ${em.co[0]}35`,borderRadius:12,padding:'10px 14px',marginBottom:12,animation:'fadeIn 0.3s'}}>
    <span style={{fontSize:18,lineHeight:1}}>{em.l}</span>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:11,fontWeight:700,color:em.co[0]}}>{em.l}</div>
      <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginTop:1}}>{em.fl} · {em.tp} BPM</div>
    </div>
    <button onClick={()=>setScreen('emotion')} style={{...S.btn(`${em.co[0]}25`,em.co[0],`${em.co[0]}45`),padding:'5px 10px',fontSize:10,flexShrink:0,fontWeight:700}}>More progressions</button>
    <button onClick={()=>setEmo(null)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:16,padding:0,lineHeight:1,flexShrink:0}}>×</button>
  </div>}

  {/* ── KEY SELECTOR ── */}
  <div style={{marginBottom:12}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
      <div style={{...S.lbl,marginBottom:0}}>Choose a Key</div>
      {originalKey&&<button onClick={returnHome} style={{...S.btn('rgba(78,205,196,0.15)','#4ECDC4','rgba(78,205,196,0.4)'),padding:'4px 10px',fontSize:10,fontWeight:700}}>🏠 {originalKey.replace(' major','').replace(' minor','m')}</button>}
    </div>
    <div style={{display:'flex',gap:0,marginBottom:8,background:'rgba(255,255,255,0.05)',borderRadius:10,padding:3}}>
      <button onClick={()=>{setKmf('major');if(KEYS[sk]?.m==='minor'){const r=RELATIVE[sk]||'C major';setSk(r);setSch(null);}}} style={{flex:1,background:kmf==='major'?'rgba(255,107,107,0.18)':'transparent',border:'none',borderRadius:8,padding:'8px 6px',cursor:'pointer',color:kmf==='major'?'#FF6B6B':'rgba(255,255,255,0.4)',fontWeight:700,fontSize:12,transition:'all 0.15s'}}>Major — Bright, open</button>
      <button onClick={()=>{setKmf('minor');if(KEYS[sk]?.m==='major'){const r=RELATIVE[sk]||'A minor';setSk(r);setSch(null);}}} style={{flex:1,background:kmf==='minor'?'rgba(78,205,196,0.18)':'transparent',border:'none',borderRadius:8,padding:'8px 6px',cursor:'pointer',color:kmf==='minor'?'#4ECDC4':'rgba(255,255,255,0.4)',fontWeight:700,fontSize:12,transition:'all 0.15s'}}>Minor — Deep, emotional</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:4}}>
      {(kmf==='major'?MAJOR_COF:MINOR_COF).map(kk=>{const root=kk.replace(' major','').replace(' minor','');const active=sk===kk;const ac=kmf==='major'?'255,107,107':'78,205,196';return<button key={kk} onClick={()=>{setSk(kk);setSch(null);}} style={{...S.btn(active?`rgba(${ac},0.2)`:'rgba(255,255,255,0.04)',active?`rgb(${ac})`:'rgba(255,255,255,0.5)'),padding:'7px 2px',fontSize:11,fontWeight:active?800:500,textAlign:'center',boxShadow:active?`0 0 10px rgba(${ac},0.45)`:'none',border:`1.5px solid ${active?`rgba(${ac},0.55)`:'rgba(255,255,255,0.06)'}`,transition:'all 0.15s'}}>{root}{kmf==='minor'?'m':''}</button>;})}
    </div>
    <div style={{marginTop:4,fontSize:8,color:'rgba(255,255,255,0.42)',textAlign:'center',lineHeight:1.4}}>Circle of Fifths order — neighboring keys share the most notes</div>
  </div>

  {/* ── CHORD EXTENSION ── */}
  <div style={{marginBottom:10}}>
    <div style={{display:'flex',gap:0,marginBottom:4,background:'rgba(255,255,255,0.05)',borderRadius:50,padding:3,border:'1px solid rgba(255,255,255,0.08)'}}>
      {[{v:'triad',l:'Triads',d:'3 notes'},{v:'7ths',l:'7ths',d:'4 notes'},{v:'sus2',l:'Sus2',d:'open'},{v:'sus4',l:'Sus4',d:'lifted'}].map(o=><button key={o.v} onClick={()=>setExt(o.v)} style={{flex:1,background:ext===o.v?'rgba(255,255,255,0.14)':'transparent',border:'none',borderRadius:50,padding:'7px 2px',cursor:'pointer',color:ext===o.v?'#fff':'rgba(255,255,255,0.45)',fontWeight:ext===o.v?700:500,fontSize:11,transition:'all 0.15s',boxShadow:ext===o.v?'0 1px 6px rgba(0,0,0,0.35)':'none'}}>{o.l}</button>)}
    </div>
    <div style={{display:'flex',gap:4}}>
      <button onClick={()=>setExt('power')} style={{flex:1,background:ext==='power'?'rgba(255,107,107,0.18)':'rgba(255,255,255,0.04)',border:`1px solid ${ext==='power'?'rgba(255,107,107,0.5)':'rgba(255,255,255,0.08)'}`,borderRadius:50,padding:'7px 8px',cursor:'pointer',color:ext==='power'?'#FF6B6B':'rgba(255,255,255,0.45)',fontWeight:ext==='power'?700:500,fontSize:11,transition:'all 0.15s'}}>⚡ Power (root+5th)</button>
      <button onClick={()=>setExt('note')} style={{flex:1,background:ext==='note'?'rgba(78,205,196,0.18)':'rgba(255,255,255,0.04)',border:`1px solid ${ext==='note'?'rgba(78,205,196,0.5)':'rgba(255,255,255,0.08)'}`,borderRadius:50,padding:'7px 8px',cursor:'pointer',color:ext==='note'?'#4ECDC4':'rgba(255,255,255,0.45)',fontWeight:ext==='note'?700:500,fontSize:11,transition:'all 0.15s'}}>♪ Notes (melody)</button>
    </div>
  </div>

  {/* ── BPM STRIP ── */}
  <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:12,background:'rgba(255,255,255,0.05)',borderRadius:50,padding:'3px 3px 3px 14px',border:'1px solid rgba(255,255,255,0.08)'}}>
    <span style={{flex:1,fontSize:11,color:'rgba(255,255,255,0.45)',fontWeight:600,letterSpacing:1}}>BPM</span>
    <input type="number" min="40" max="200" value={bpmInput} onChange={e=>setBpmInput(e.target.value)} onBlur={()=>{const v=Math.max(40,Math.min(200,parseInt(bpmInput)||90));setBpm(v);setBpmInput(String(v));}} onKeyDown={e=>{if(e.key==='Enter'){const v=Math.max(40,Math.min(200,parseInt(bpmInput)||90));setBpm(v);setBpmInput(String(v));e.target.blur();}}} style={{fontSize:18,fontWeight:800,color:'#4ECDC4',width:52,textAlign:'center',background:'transparent',border:'none',outline:'none',WebkitAppearance:'none',MozAppearance:'textfield'}}/>
    <button onClick={()=>setBpm(b=>Math.max(40,b-1))} style={{width:38,height:38,borderRadius:'50%',background:'rgba(255,255,255,0.07)',border:'none',color:'rgba(255,255,255,0.7)',cursor:'pointer',fontSize:18,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.15s'}}>−</button>
    <button onClick={()=>setBpm(b=>Math.min(200,b+1))} style={{width:38,height:38,borderRadius:'50%',background:'rgba(255,255,255,0.07)',border:'none',color:'rgba(255,255,255,0.7)',cursor:'pointer',fontSize:18,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.15s'}}>+</button>
  </div>

  {/* ── SVG CHORD MAP ── */}
  <div style={{background:'rgba(0,0,0,0.4)',borderRadius:22,padding:14,border:'1px solid rgba(255,255,255,0.06)'}}>
    <svg viewBox="0 0 400 400" style={{width:'100%',height:'auto'}}>
      <rect x="0" y="0" width="400" height="400" fill="transparent" onClick={()=>{if(swapIdx!==null)clearSwap();}}/>
      {k&&gcon(k.ch,k.m).map((c,i)=>{const ly=ml(k.ch,200,200,140);const f=ly.find(n=>n.c===c.f),t=ly.find(n=>n.c===c.t);if(!f||!t)return null;const h=sch&&(c.f===sch||c.t===sch);const isStrong=c.st==='strong';
        return<line key={i} x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={h?(isStrong?'#FFD700':cc(sch)):isStrong?'rgba(255,215,0,0.45)':'rgba(255,255,255,0.11)'} strokeWidth={h?(isStrong?4:2.5):isStrong?2.5:1} strokeDasharray={isStrong?'none':'5 5'} style={{transition:'all 0.3s',filter:h&&isStrong?'drop-shadow(0 0 4px #FFD700)':'none'}}/>;
      })}
      {k&&ml(k.ch,200,200,140).map((nd,ni)=>{const col=cc(nd.c),sel=sch===nd.c,extLbl=extChordLabel(k,nd.c,ext),isNoteMode=ext==='note',displayLbl=isNoteMode?extLbl.slice(5):extLbl,ip=prog.includes(extLbl)||prog.includes(nd.c),fn=k.m==='minor'?FNm:FNM;const fnParts=fn[ni].split(' (');const fnName=fnParts[0];const fnRN=fnParts[1]?.slice(0,-1);const bnRank=bestNext.indexOf(nd.c);const isBestNext=bnRank!==-1&&!isNoteMode;
        return<g key={ni} onClick={()=>playC(nd.c)} style={{cursor:'pointer'}}>
          {isBestNext&&<circle cx={nd.x} cy={nd.y} r={44} fill="none" stroke={col} strokeWidth={bnRank===0?3.5:2.5} strokeOpacity={bnRank===0?0.9:0.65} style={{animation:'svgRingPulse 1.4s ease-in-out infinite',animationDelay:`${bnRank*0.4}s`}}/>}
          <circle cx={nd.x} cy={nd.y} r={sel?38:30} fill={col+(sel?'30':'10')} stroke={col+(sel?'80':'35')} strokeWidth={sel?2:1} style={{transition:'all 0.3s'}}/>
          <circle cx={nd.x} cy={nd.y} r={sel?28:23} fill={col+(sel?'30':'15')} stroke={col} strokeWidth={sel?3:1.5} style={{transition:'all 0.3s',filter:sel?`drop-shadow(0 0 12px ${col}90)`:'none'}}/>
          {ip&&<circle cx={nd.x} cy={nd.y} r={32} fill="none" stroke="#FFD700" strokeWidth={2.5} strokeDasharray="4 3"/>}
          <text x={nd.x} y={nd.y+1} textAnchor="middle" dominantBaseline="middle" fill={sel?'#fff':col} fontSize={sel?14:12} fontWeight="800" style={{pointerEvents:'none'}}>{displayLbl}</text>
          <text x={nd.x} y={nd.y+(sel?47:39)} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize="7" fontWeight="600" style={{pointerEvents:'none'}}>{fnName}</text>
          {!isNoteMode&&<text x={nd.x} y={nd.y+(sel?55:47)} textAnchor="middle" fill="rgba(255,215,0,0.72)" fontSize="6" style={{pointerEvents:'none'}}>{fnRN&&`(${fnRN})`}</text>}
          <text x={nd.x} y={nd.y+(sel?63:55)} textAnchor="middle" fill="rgba(255,255,255,0.50)" fontSize="6" style={{pointerEvents:'none'}}>{extChordNotes(k,nd.c,ext).join('·')}</text>
        </g>;})}
      <text x="200" y="192" textAnchor="middle" fill={swapIdx!==null?'#FFD700':'rgba(255,255,255,0.35)'} fontSize="12" fontWeight="700">{sk}</text>
      <text x="200" y="208" textAnchor="middle" fill={swapIdx!==null?'rgba(255,215,0,0.6)':'rgba(255,255,255,0.22)'} fontSize="8">{swapIdx!==null?`replacing slot ${swapIdx+1}`:ext==='note'?'Tap a note':'Tap a chord'}</text>
    </svg>
  </div>

  {/* Ghost Chords */}
  {ghostChords.length>0&&<div style={{background:'rgba(199,125,255,0.06)',border:'1px dashed rgba(199,125,255,0.4)',borderRadius:14,padding:'12px 14px',marginTop:10}}>
    <div style={{...S.lbl,color:'rgba(199,125,255,0.85)',marginBottom:6}}>Ghost Chords — Borrowed from parallel key</div>
    <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:10,lineHeight:1.5}}>Outside your key but they blend. Tap one to hear it and shift the map.</div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      {ghostChords.map((g,i)=><button key={i} onClick={()=>warpKey(g.chord,g.fromKey)} style={{background:'rgba(199,125,255,0.12)',border:'1px dashed rgba(199,125,255,0.55)',borderRadius:10,padding:'10px 16px',cursor:'pointer',color:'#C77DFF',fontWeight:700,fontSize:14,textAlign:'center',transition:'all 0.2s'}}>
        <div>{g.chord}</div>
        <div style={{fontSize:9,color:'rgba(199,125,255,0.65)',marginTop:3,fontWeight:500}}>from {g.fromKey.replace(' major','maj').replace(' minor','min')}</div>
      </button>)}
    </div>
  </div>}

  {/* ── PROGRESSION GRID — NOW DIRECTLY BELOW THE MAP ── */}
  <ProgGrid />

  {/* Chord / Note detail */}
  {sch&&ext==='note'&&(()=>{const ni=k?.ch.indexOf(sch);const noteName=ni!==-1&&k?.sc?k.sc[ni]:pc(sch).r;const fn=(k?.m==='minor'?FNm:FNM)[ni]||'';const deg=['1st','2nd','3rd','4th','5th','6th','7th'][ni]||'';return(<div style={{...S.card(cc(sch)+'30'),marginTop:4,animation:'fadeIn 0.3s'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
      <div><h3 style={{fontSize:32,fontWeight:800,color:cc(sch),margin:'0 0 2px'}}>{noteName}</h3><div style={{fontSize:11,color:'rgba(255,255,255,0.55)'}}>{deg} degree · {fn.split(' (')[0]}</div></div>
      <button onClick={()=>addC('note:'+noteName)} style={S.btn(cc(sch)+'25',cc(sch),cc(sch)+'50')}>+ Add</button>
    </div>
    <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',lineHeight:1.6,background:'rgba(0,0,0,0.2)',borderRadius:8,padding:'8px 10px'}}>
      {ni===0?'The root — your tonal home. Always safe, always resolves.':ni===1?'Creates tension over the tonic. Use for suspense.':ni===2?'The third — defines major/minor mood.':ni===3?'The fourth — lifts and opens. Relaxed tension.':ni===4?'The fifth — powerful and stable. Pure energy.':ni===5?'The sixth — emotional and bittersweet.':'The seventh — floats just below resolution.'}
    </div>
  </div>);})()}
  {sch&&ext!=='note'&&<div style={{...S.card(cc(sch)+'30'),marginTop:4,animation:'fadeIn 0.3s'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
      <div>
        <h3 style={{fontSize:26,fontWeight:800,color:cc(sch),margin:'0 0 2px'}}>{extChordLabel(k,sch,ext)}</h3>
        <div style={{fontSize:11,color:'rgba(255,255,255,0.55)'}}>{ql(sch)} · {(k?.m==='minor'?FNm:FNM)[k?.ch.indexOf(sch)]||'Borrowed'}</div>
      </div>
      <button onClick={()=>addC(extChordLabel(k,sch,ext))} style={S.btn(cc(sch)+'25',cc(sch),cc(sch)+'50')}>+ Add</button>
    </div>
    <div style={{marginBottom:10}}><div style={{...S.lbl,marginBottom:4}}>Notes</div><div style={{display:'flex',gap:5}}>{extChordNotes(k,sch,ext).map((n,i)=><span key={i} style={{background:cc(sch)+'12',border:`1px solid ${cc(sch)}25`,borderRadius:6,padding:'3px 9px',fontSize:12,fontWeight:600,color:cc(sch)}}>{n}</span>)}</div></div>
    {CE[sch]&&<div style={{background:'rgba(255,255,255,0.03)',borderRadius:10,padding:10,marginBottom:10}}><div style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.75)',marginBottom:3}}>Feels: {CE[sch].f}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.4}}>{CE[sch].r}</div></div>}
    <div style={S.lbl}>Where it goes next — tap to hear, + to add</div>
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {k&&gcon(k.ch,k.m).filter(c=>c.f===sch).map((c,i)=>{const m=mf(c.f,c.t),v=vl(c.f,c.t);const tLbl=extChordLabel(k,c.t,ext);return<div key={i} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${cc(c.t)}25`,borderRadius:10,padding:'10px 12px',display:'flex',gap:8,alignItems:'center'}}>
        <button onClick={()=>playC(c.t)} style={{flex:1,background:'none',border:'none',cursor:'pointer',textAlign:'left',padding:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
            <div><span style={{fontSize:14,fontWeight:700,color:cc(c.t)}}>{tLbl}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.5)',marginLeft:8}}>{m.e} {m.l}</span></div>
            <span style={{fontSize:9,color:'rgba(255,255,255,0.45)',background:'rgba(255,255,255,0.05)',borderRadius:4,padding:'2px 5px'}}>{v.sm.toLowerCase()}</span>
          </div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{v.mv.map((mv,j)=><span key={j} style={{fontSize:9,color:mv.s?'#4ECDC480':'#FFB34780',background:mv.s?'#4ECDC408':'#FFB34708',borderRadius:3,padding:'1px 5px'}}>{mv.s?`${mv.f} stays`:`${mv.f}→${mv.t}`}</span>)}</div>
        </button>
        <button onClick={()=>addC(tLbl)} style={{...S.btn(cc(c.t)+'20',cc(c.t),cc(c.t)+'40'),flexShrink:0,padding:'6px 10px',fontSize:12,fontWeight:800}}>+ Add</button>
      </div>;})}
    </div>
    <div style={{marginTop:12}}>
      <button onClick={()=>setSv(!sv)} style={{...S.btn('rgba(255,255,255,0.05)','rgba(255,255,255,0.6)','rgba(255,255,255,0.1)'),width:'100%',fontSize:11,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>Different ways to play this chord</span><span style={{transform:sv?'rotate(90deg)':'none',transition:'transform 0.2s'}}>▶</span>
      </button>
      {sv&&<div style={{marginTop:8,animation:'fadeIn 0.3s'}}>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:8,lineHeight:1.5}}>The same chord can feel completely different depending on how you arrange the notes.</div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {gvoi(sch).map((v,i)=><button key={i} onClick={()=>audio.playChord(v.notes,2.0)} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${cc(sch)}20`,borderRadius:10,padding:'10px 12px',cursor:'pointer',textAlign:'left',width:'100%'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><span style={{fontSize:12,fontWeight:700,color:cc(sch)}}>{v.n}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginLeft:8}}>{v.d}</span></div><span style={{fontSize:11,color:'rgba(255,255,255,0.25)'}}>▶</span></div>
            <div style={{display:'flex',gap:4,marginTop:4}}>{v.notes.map((n,j)=><span key={j} style={{fontSize:9,color:cc(sch)+'80',background:cc(sch)+'10',borderRadius:3,padding:'1px 5px'}}>{n}</span>)}</div>
          </button>)}
        </div>
      </div>}
    </div>
  </div>}

</div>}

{/* ═══ MELODY LAB ═══ */}
{screen==='melody'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
  <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Melody Lab</h2>
  <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>Everything you need to write melodies that stick and 808s that hit.</p>

  {/* Voice Memo */}
  <VoiceMemoPanel />

  {/* Play Along */}
  {prog.length>=2?<div style={{...S.card(pa?'#4ECDC440':'rgba(255,255,255,0.06)'),marginBottom:14}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div>
        <h3 style={{fontSize:14,fontWeight:700,margin:'0 0 2px',color:pa?'#4ECDC4':'#fff'}}>{pa?'● Playing Along':'Play Along'}</h3>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{pa?'Progression looping underneath you.':'Loop your chords and improvise a melody on top.'}</div>
      </div>
      <button onClick={()=>{if(pa){audio.stop();setPa(false);setPi(-1);setPRow(-1);}else{setPa(true);audio.playLoop(prog.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3)),bpm,idx=>{setPi(idx);setPRow(-1);},beats,stg);}}} style={{...S.btn(pa?'#FF6B6B25':'#4ECDC425',pa?'#FF6B6B':'#4ECDC4',pa?'#FF6B6B50':'#4ECDC450'),fontSize:13,fontWeight:700,padding:'10px 20px'}}>{pa?'■ Stop':'▶ Start Loop'}</button>
    </div>
    {pa&&<div style={{display:'flex',gap:5,marginTop:10,flexWrap:'wrap'}}>{prog.map((c,i)=><span key={i} style={{...S.pill(cc(c),pi===i),fontSize:13,padding:'5px 12px'}}>{c}</span>)}</div>}
  </div>:<div style={{...S.card(),marginBottom:14,textAlign:'center'}}><div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>Build 2+ chords in the Map to unlock Play Along.</div></div>}

  {/* Melody Sauce */}
  <div style={{...S.card('rgba(199,125,255,0.2)'),marginBottom:14}}>
    <h3 style={{fontSize:15,fontWeight:800,margin:'0 0 4px',color:'#C77DFF'}}>Melody Sauce</h3>
    <p style={{fontSize:10,color:'rgba(255,255,255,0.4)',margin:'0 0 12px',lineHeight:1.5}}>Simple rules that make melodies stick in people's heads.</p>
    {[{i:'🎣',t:'Keep it short and repeat it',d:'A great melody is usually just 2–4 seconds long. Play the same short idea twice before changing anything.'},{i:'🎯',t:'Use only 5 notes',d:'Pick any key and remove the 4th and 7th notes. The 5 notes left (pentatonic) all sound good together — you literally cannot play a wrong note.'},{i:'💬',t:'Ask and answer',d:'Play a phrase that feels like a question (ends going up). Then play one that feels like the answer (ends going down).'},{i:'🔄',t:'Say it twice, then change the ending',d:'Play your melody. Play it again exactly the same. On the third time, change just the last note or two. That small change is where the feeling lives.'},{i:'🤫',t:'Leave gaps — silence is powerful',d:'Don\'t fill every second with notes. The note you play right after silence hits harder because of it.'},{i:'👑',t:'Build to your best note',d:'Every great melody has one climactic moment — usually the highest note. Build up to it, let it land, then bring it back down.'},{i:'🔗',t:'Start each phrase on the chord\'s main note',d:'When a chord plays, begin your phrase on that chord\'s root note. It makes everything lock together.'},{i:'🔥',t:'Play slightly before the beat',d:'Play just a tiny bit early — right before the beat drops. This "on top of the beat" feel makes melodies more energetic.'}].map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'10px 12px',marginBottom:6,display:'flex',gap:10,alignItems:'flex-start'}}><span style={{fontSize:16,flexShrink:0,marginTop:1}}>{s.i}</span><div><div style={{fontSize:12,fontWeight:700,color:'#C77DFF',marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.d}</div></div></div>)}
  </div>

  {/* 808 Sauce */}
  <div style={{...S.card('rgba(255,215,0,0.2)')}}>
    <h3 style={{fontSize:15,fontWeight:800,margin:'0 0 4px',color:'#FFD700'}}>808 Sauce</h3>
    <p style={{fontSize:10,color:'rgba(255,255,255,0.4)',margin:'0 0 12px',lineHeight:1.5}}>How to make 808s that hit hard and sound professional.</p>
    {[{i:'🎵',t:'Tune your 808 to match your song\'s key',d:'An 808 that\'s out of tune with your chords makes the whole beat sound wrong. Pitch your 808 to the root note of your key.'},{i:'🔗',t:'Match the 808 note to the chord',d:'When your chord changes, your 808 note changes too. C chord = C 808. Am chord = A 808.'},{i:'📉',t:'Use pitch slides between notes',d:'Instead of jumping straight between notes, let the pitch glide. This sliding sound is the signature of trap music. Try 50–100ms slide time.'},{i:'⏱️',t:'Long notes feel heavy, short notes feel bouncy',d:'Hold an 808 for the full beat = dark and heavy. Cut it short = punchy and bouncy.'},{i:'🥁',t:'Let the kick hit first',d:'The kick and 808 compete for low-end space. Slightly shorten the 808\'s start so the kick\'s punch is heard first.'},{i:'🔊',t:'Hit the downbeats harder',d:'Beat 1 should be your loudest 808 hit. This makes your pattern feel like a real performance.'}].map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'10px 12px',marginBottom:6,display:'flex',gap:10,alignItems:'flex-start'}}><span style={{fontSize:16,flexShrink:0,marginTop:1}}>{s.i}</span><div><div style={{fontSize:12,fontWeight:700,color:'#FFD700',marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.d}</div></div></div>)}
  </div>
</div>}

{/* ═══ EAR TRAINING ═══ */}
{screen==='ear'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
  <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Ear Training</h2>
  <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:12}}>Train your ears to recognize chord qualities, intervals, and emotional movement.</p>
  {dailyDone?<div style={{background:'rgba(78,205,196,0.08)',border:'1px solid rgba(78,205,196,0.3)',borderRadius:12,padding:'10px 14px',marginBottom:14,fontSize:11,color:'#4ECDC4',fontWeight:600,animation:'fadeIn 0.3s'}}>✓ Daily Drop complete — +10 XP earned today!</div>
  :dailyAvail&&<div style={{background:'linear-gradient(135deg,rgba(255,183,71,0.1),rgba(255,140,40,0.06))',border:'1px solid rgba(255,183,71,0.4)',borderRadius:14,padding:'12px 14px',marginBottom:14,animation:'fadeIn 0.3s'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:dailyActive?6:0}}>
      <div><div style={{fontSize:12,fontWeight:800,color:'#FFB347'}}>🎯 Daily Drop Challenge</div><div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:2}}>Answer questions in 60 seconds — earn +10 XP</div></div>
      {dailyActive?<div style={{fontSize:20,fontWeight:900,color:dailySecs<=10?'#FF6B6B':'#FFB347',minWidth:40,textAlign:'right'}}>{dailySecs}s</div>:<button onClick={startDaily} style={{...S.btn('rgba(255,183,71,0.2)','#FFB347','rgba(255,183,71,0.5)'),padding:'6px 14px',fontSize:11,fontWeight:800,flexShrink:0}}>Start</button>}
    </div>
    {dailyActive&&<div style={{height:3,background:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}><div style={{width:`${(dailySecs/60)*100}%`,height:'100%',background:dailySecs<=10?'#FF6B6B':'#FFB347',borderRadius:2,transition:'width 1s linear'}}/></div>}
  </div>}
  {es.t>0&&<div style={{...S.card('#4ECDC430'),display:'flex',justifyContent:'space-between',alignItems:'center'}}>
    <div><div style={{fontSize:22,fontWeight:800,color:'#4ECDC4'}}>{es.c}/{es.t}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{es.t>=5?(es.c/es.t>=0.8?'Your ears are sharp.':es.c/es.t>=0.5?'Building sensitivity.':'Every miss teaches your ear.'):'Keep listening...'}</div></div>
    <button onClick={()=>setEs({c:0,t:0})} style={{...S.btn(),fontSize:10}}>Reset</button>
  </div>}
  <div style={{marginBottom:14}}>
    <div style={S.lbl}>Challenge Type</div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      {[{k:'chord-quality',l:'Chord Quality',d:'Major/Minor/Dim'},{k:'interval',l:'Intervals',d:'Note distances'},{k:'movement',l:'Movement',d:'Emotional direction'}].map(t=><button key={t.k} onClick={()=>{setEt(t.k);setEc(null);setEa(null);}} style={{...S.btn(et===t.k?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.04)',et===t.k?'#fff':'rgba(255,255,255,0.45)'),padding:'8px 12px',fontSize:10,textAlign:'left'}}><div style={{fontWeight:700}}>{t.l}</div><div style={{fontSize:8,opacity:0.5,marginTop:1}}>{t.d}</div></button>)}
    </div>
  </div>
  {!ec?<div style={{textAlign:'center',padding:'40px 20px'}}><button onClick={newEar} style={{background:'linear-gradient(135deg,#4ECDC4,#44B09E)',border:'none',borderRadius:14,padding:'16px 32px',color:'#fff',cursor:'pointer',fontSize:16,fontWeight:700}}>Start a Challenge</button></div>:
  <div style={S.card('#4ECDC420')}>
    <h3 style={{fontSize:15,fontWeight:700,margin:'0 0 12px',color:'#fff'}}>{ec.q}</h3>
    <button onClick={replayEar} style={{background:'linear-gradient(135deg,#4ECDC425,#44B09E25)',border:'1px solid #4ECDC440',borderRadius:12,padding:'14px 24px',color:'#4ECDC4',cursor:'pointer',fontSize:14,fontWeight:700,width:'100%',marginBottom:14}}>🔊 Play Again</button>
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {ec.ops.map((o,i)=>{const ok=ea&&o===ec.ans,no=ea===o&&o!==ec.ans;return<button key={i} onClick={()=>ansEar(o)} style={{background:ok?'#4ECDC420':no?'#FF6B6B20':'rgba(255,255,255,0.04)',border:`1.5px solid ${ok?'#4ECDC460':no?'#FF6B6B60':'rgba(255,255,255,0.08)'}`,borderRadius:10,padding:'12px 14px',cursor:ea?'default':'pointer',color:ok?'#4ECDC4':no?'#FF6B6B':'rgba(255,255,255,0.7)',fontSize:13,fontWeight:600,textAlign:'left'}}>{o}{ok&&' ✓'}{no&&' ✗'}</button>;})}
    </div>
    {ea&&<div style={{marginTop:14,background:'rgba(0,0,0,0.2)',borderRadius:10,padding:12,animation:'fadeIn 0.3s'}}>
      <div style={{fontSize:13,fontWeight:700,color:ea===ec.ans?'#4ECDC4':'#FFB347',marginBottom:4}}>{ea===ec.ans?'Correct!':`Answer: ${ec.ans}`}</div>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.6,marginBottom:10}}>{ec.h}</div>
      <button onClick={newEar} style={S.btn('rgba(255,255,255,0.1)','#fff','rgba(255,255,255,0.2)')}>Next →</button>
    </div>}
  </div>}
</div>}

{/* ═══ INTERVALS ═══ */}
{screen==='intervals'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
  <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Interval Explorer</h2>
  <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>The atoms of music. Every chord and melody is built from these distances.</p>
  <div style={{display:'flex',flexDirection:'column',gap:8}}>
    {IVS.map((iv,i)=>{const tp=iv.s===6?100:iv.s===1||iv.s===11?85:iv.c==='consonant'?30:iv.c==='perfect'?10:55;return<div key={i} style={S.card(ic(iv.c)+'30')}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
        <div><span style={{fontSize:16,fontWeight:800,color:ic(iv.c)}}>{iv.n}</span><span style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginLeft:8}}>{iv.sn} · {iv.s} st</span></div>
        <div style={{display:'flex',gap:4}}>
          <button onClick={()=>{const n2=NN[(0+iv.s)%12]+(3+Math.floor(iv.s/12));audio.playInterval('C3',n2);}} style={{...S.btn(ic(iv.c)+'20',ic(iv.c),ic(iv.c)+'40'),fontSize:10,padding:'5px 10px'}}>Together</button>
          <button onClick={()=>{const n2=NN[(0+iv.s)%12]+(3+Math.floor(iv.s/12));audio.playMelodicInterval('C3',n2);}} style={{...S.btn('rgba(255,255,255,0.06)','rgba(255,255,255,0.6)'),fontSize:10,padding:'5px 10px'}}>Apart</button>
        </div>
      </div>
      <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',lineHeight:1.5,marginBottom:6}}>{iv.f}</div>
      <div style={{display:'flex',gap:4,alignItems:'center'}}>
        <span style={{fontSize:9,color:ic(iv.c),background:ic(iv.c)+'15',borderRadius:4,padding:'2px 6px'}}>{iv.c}</span>
        <div style={{flex:1,height:3,background:'rgba(255,255,255,0.06)',borderRadius:2,overflow:'hidden'}}><div style={{width:`${tp}%`,height:'100%',background:ic(iv.c),borderRadius:2}}/></div>
        <span style={{fontSize:8,color:'rgba(255,255,255,0.25)'}}>{iv.c==='dissonant'?'high tension':iv.c==='perfect'?'stable':iv.c==='consonant'?'sweet':'gentle'}</span>
      </div>
    </div>;})}
  </div>
</div>}

{/* ═══ LEARN ═══ */}
{screen==='learn'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
  <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Learn</h2>
  <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>Short, playable lessons. Each teaches one idea with sound.</p>
  {LES.map(ls=><div key={ls.id} style={S.card(al===ls.id?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.06)')}>
    <button onClick={()=>setAl(al===ls.id?null:ls.id)} style={{background:'none',border:'none',width:'100%',padding:0,cursor:'pointer',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:9,color:'rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.06)',borderRadius:4,padding:'2px 6px',textTransform:'capitalize'}}>{ls.c}</span><h4 style={{fontSize:14,fontWeight:700,margin:0,color:'#fff'}}>{ls.t}</h4></div>
      <span style={{fontSize:11,color:'rgba(255,255,255,0.2)',transform:al===ls.id?'rotate(90deg)':'none',transition:'transform 0.2s',flexShrink:0}}>▶</span>
    </button>
    {al===ls.id&&<div style={{marginTop:10,animation:'fadeIn 0.3s'}}>
      <p style={{fontSize:12,color:'rgba(255,255,255,0.6)',lineHeight:1.7,margin:'0 0 12px'}}>{ls.b}</p>
      <div style={{display:'flex',gap:6}}>{ls.ch.map((c,i)=><button key={i} onClick={()=>playC(c)} style={{background:cc(c)+'18',border:`1.5px solid ${cc(c)}45`,borderRadius:10,padding:'8px 16px',cursor:'pointer',color:cc(c),fontSize:15,fontWeight:700}}>▶ {c}</button>)}</div>
    </div>}
  </div>)}
  <div style={{marginTop:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:10}}>Theory Translator</h3>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
      {[{t:'Tonic',p:'Home chord'},{t:'Dominant',p:'Tension chord'},{t:'Resolution',p:'Landing after tension'},{t:'Dissonance',p:'Notes pulling apart'},{t:'Cadence',p:'How phrases rest'},{t:'Voice Leading',p:'Smooth note movement'},{t:'Scale Degree',p:'Note\'s emotional role'},{t:'Tritone',p:'Max tension interval'}].map(i=><div key={i.t} style={{background:'rgba(255,255,255,0.03)',borderRadius:9,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.04)'}}><div style={{fontSize:12,fontWeight:700,color:'#C77DFF',marginBottom:2}}>{i.t}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.45)',lineHeight:1.4}}>{i.p}</div></div>)}
    </div>
  </div>
</div>}

{/* ═══ MIX LAB ═══ */}
{screen==='mix'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
  <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Mix Lab</h2>
  <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>How to get a loud, punchy, professional-sounding mix.</p>
  {[{title:'Levels & Structure',color:'#4ECDC4',items:[{i:'🏗️',t:'Build your mix like a pyramid',d:'Your kick and 808 should be the loudest things. Then snare. Then chords and pads. Then melody on top.'},{i:'📏',t:'Leave breathing room at the top',d:'Keep your mix from maxing out. If everything is already at full volume, you have no room to make it louder.'},{i:'🔺',t:'Group your sounds into 3 layers',d:'Bottom: drums and 808. Middle: chords, pads, and rhythm sounds. Top: melody and vocals.'},{i:'🎚️',t:'Start every track quieter than you think',d:'Turn all tracks down low first. Then bring each up until the mix sounds balanced.'}]},{title:'Tone Shaping (EQ)',color:'#FFB347',items:[{i:'✂️',t:'Take away before you add',d:'If something sounds muddy, try removing frequencies first instead of adding more.'},{i:'🎯',t:'Give every sound its own space',d:'If piano and pad are clashing, cut overlapping frequencies from one. Every sound needs its own lane.'},{i:'🔉',t:'Remove low rumble from everything except bass',d:'On everything that isn\'t kick, 808, or bass — cut out the very low rumbling frequencies.'},{i:'💡',t:'Boosting upper-mids makes things cut through',d:'That range is what your ears hear most clearly. Boosting it makes a sound closer and more present.'}]},{title:'Width & Space',color:'#87CEEB',items:[{i:'↔️',t:'Keep bass sounds in the center',d:'808 and bass always from center. If spread wide, they disappear on phone speakers.'},{i:'🌊',t:'Use reverb to put sounds in a room',d:'Snare: small reverb. Chords and pads: medium reverb. Kick and 808: dry — no reverb.'},{i:'📍',t:'Pan sounds left and right',d:'Kick, snare, 808, main melody: center. Hi-hats, extra layers, background chords: spread wide.'}]},{title:'Making It Loud',color:'#FF6B6B',items:[{i:'🔒',t:'Add a limiter as your very last step',d:'A limiter at the end of your master channel stops your mix from ever going above a set volume.'},{i:'🎧',t:'Use a reference track',d:'Put a song you love in your project and listen to it next to your mix. Match the energy and tone.'},{i:'📱',t:'Test your mix on multiple speakers',d:'Listen on studio headphones, laptop speakers, phone speaker, and in your car. All four.'},{i:'🔵',t:'Check your mix in mono',d:'If something disappears in mono, two sounds are canceling each other. Move them apart or lower one.'}]}].map((section,si)=>(
    <div key={si} style={{marginBottom:18}}>
      <div style={{fontSize:10,fontWeight:800,color:section.color,textTransform:'uppercase',letterSpacing:1.5,marginBottom:8,paddingLeft:2}}>{section.title}</div>
      {section.items.map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'10px 12px',marginBottom:6,display:'flex',gap:10,alignItems:'flex-start',border:`1px solid ${section.color}15`}}><span style={{fontSize:16,flexShrink:0,marginTop:1}}>{s.i}</span><div><div style={{fontSize:12,fontWeight:700,color:section.color,marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.d}</div></div></div>)}
    </div>))}
</div>}

{/* ═══ SAVED ═══ */}
{screen==='saved'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
  <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Saved Ideas</h2>
  <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>Your musical sketches.</p>
  {saved.length===0?<div style={{textAlign:'center',padding:'40px 20px',background:'rgba(255,255,255,0.03)',borderRadius:18,border:'1px solid rgba(255,255,255,0.05)'}}><div style={{fontSize:28,marginBottom:10}}>♡</div><div style={{fontSize:13,color:'rgba(255,255,255,0.35)'}}>No saved ideas yet</div></div>:
  saved.map((idea,idx)=>{const e=idea.emo?EMO[idea.emo]:null;return<div key={idea.id} style={{...S.card(e?e.co[0]+'30':'rgba(255,255,255,0.06)'),background:e?e.gr:'rgba(255,255,255,0.03)'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
      <div>{e&&<span style={{fontSize:10,color:e.co[0],fontWeight:700}}>{e.l} · </span>}<span style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>{idea.k} · {idea.date}</span></div>
      <button onClick={()=>setSaved(p=>p.filter((_,i)=>i!==idx))} style={{background:'none',border:'none',color:'rgba(255,255,255,0.25)',cursor:'pointer',fontSize:13}}>×</button>
    </div>
    <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:6}}>{idea.prog.map((c,i)=><span key={i} style={{background:cc(c)+'18',color:cc(c),border:`1px solid ${cc(c)}35`,borderRadius:7,padding:'4px 10px',fontSize:13,fontWeight:700}}>{c}</span>)}</div>
    <div style={{display:'flex',gap:6}}>
      <button onClick={()=>{audio.playProgression(idea.prog.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3)),bpm,i=>{setPi(i);setPRow(-1);});}} style={S.btn()}>▶ Play</button>
      <button onClick={()=>{setProg(idea.prog);setSk(idea.k||sk);setSch(null);setScreen('chordmap');}} style={S.btn()}>Edit →</button>
      <button onClick={()=>{const txt=[`🎵 HarmonyMap Sketch`,`Key: ${idea.k}`,`${idea.prog.join(' → ')}`,idea.date].join('\n');try{navigator.clipboard.writeText(txt);setTip('Copied!');}catch(e){}}} style={S.btn()}>📋 Copy</button>
    </div>
  </div>;})}
</div>}

  </main>

{/* SOUND TRAY */}

  <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:90,background:'rgba(6,6,16,0.97)',backdropFilter:'blur(28px)',borderTop:`2px solid ${tabs.find(t=>t.k===screen)?.c||'#00F0C8'}35`,padding:'6px 10px',display:'flex',alignItems:'center',gap:8}}>
    <span style={{fontSize:9,color:'rgba(255,255,255,0.3)',fontWeight:700,textTransform:'uppercase',letterSpacing:0.8,flexShrink:0}}>Sound</span>
    <div style={{display:'flex',background:'rgba(255,255,255,0.06)',borderRadius:50,padding:2,border:'1px solid rgba(255,255,255,0.1)'}}>
      {[{v:'underwater',l:'🌊',d:'R&B'},{v:'cinematic',l:'🎬',d:'Trap'}].map(o=><button key={o.v} onClick={()=>setInst(o.v)} style={{background:inst===o.v?'rgba(78,205,196,0.22)':'transparent',border:'none',borderRadius:50,padding:'6px 9px',cursor:'pointer',color:inst===o.v?'#4ECDC4':'rgba(255,255,255,0.4)',fontWeight:inst===o.v?700:500,fontSize:10,transition:'all 0.15s',display:'flex',alignItems:'center',gap:3,whiteSpace:'nowrap'}}><span>{o.l}</span><span>{o.d}</span></button>)}
    </div>
    <div style={{display:'flex',gap:4,alignItems:'center'}}>
      {[{v:'analog-pad',l:'🎹',t:'Pad',xpReq:25},{v:'rhodes',l:'✨',t:'Rhodes',xpReq:50},{v:'midpad',l:'🌙',t:'Mid',xpReq:100}].map(o=>{const unlocked=xp>=o.xpReq;return<button key={o.v} onClick={()=>{if(unlocked)setInst(o.v);}} style={{background:inst===o.v&&unlocked?'rgba(199,125,255,0.2)':'rgba(255,255,255,0.04)',border:`1px solid ${inst===o.v&&unlocked?'rgba(199,125,255,0.45)':'rgba(255,255,255,0.08)'}`,borderRadius:8,padding:'5px 7px',cursor:unlocked?'pointer':'default',color:unlocked?(inst===o.v?'#C77DFF':'rgba(255,255,255,0.55)'):'rgba(255,255,255,0.2)',fontSize:10,display:'flex',flexDirection:'column',alignItems:'center',gap:1,opacity:unlocked?1:0.6,flexShrink:0}}><span style={{fontSize:12}}>{unlocked?o.l:'🔒'}</span><span style={{fontSize:7,lineHeight:1}}>{unlocked?o.t:`${o.xpReq}xp`}</span></button>;})}
    </div>
    <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
      <div style={{fontSize:10,fontWeight:900,background:'linear-gradient(135deg,#D946EF,#FF4D6D)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',filter:'drop-shadow(0 0 6px rgba(217,70,239,0.6))'}}>{xp}<span style={{fontSize:7,WebkitTextFillColor:'rgba(199,125,255,0.55)',marginLeft:1}}>xp</span></div>
      <div style={{fontSize:11,fontWeight:700,color:'#4ECDC4',minWidth:40,textAlign:'right'}}>{bpm}<span style={{fontSize:8,color:'rgba(255,255,255,0.3)',fontWeight:500,marginLeft:2}}>bpm</span></div>
      <button onClick={toggleMetro} style={{width:34,height:34,borderRadius:'50%',background:metrOn?'rgba(255,183,71,0.2)':'rgba(255,255,255,0.06)',border:`1.5px solid ${metrOn?'rgba(255,183,71,0.6)':'rgba(255,255,255,0.12)'}`,color:metrOn?'#FFB347':'rgba(255,255,255,0.35)',cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,boxShadow:metrOn?'0 0 12px rgba(255,183,71,0.35)':'none',transition:'all 0.2s'}}>♩</button>
    </div>
  </div>

  <style>{`
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    @keyframes orbFloat{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.85;transform:scale(1.04)}}
    @keyframes recDot{0%,100%{opacity:1;box-shadow:0 0 6px rgba(255,77,109,0.8)}50%{opacity:0.6;box-shadow:0 0 16px rgba(255,77,109,1)}}
    @keyframes tabPop{0%{transform:scale(1)}50%{transform:scale(1.14)}100%{transform:scale(1)}}
    @keyframes pulse{0%,100%{box-shadow:0 0 14px rgba(255,77,109,0.6)}50%{box-shadow:0 0 28px rgba(255,77,109,1),0 0 50px rgba(255,77,109,0.4)}}
    @keyframes swapPulse{0%,100%{box-shadow:0 0 24px rgba(255,215,0,1),0 0 48px rgba(255,215,0,0.5)}50%{box-shadow:0 0 38px rgba(255,215,0,1),0 0 72px rgba(255,215,0,0.7)}}
    @keyframes svgRingPulse{0%,100%{stroke-opacity:0.45}50%{stroke-opacity:1}}
    @keyframes floatPulse{0%,100%{box-shadow:0 4px 28px rgba(78,205,196,0.25)}50%{box-shadow:0 4px 36px rgba(78,205,196,0.4)}}
    @keyframes metrPulse{0%{transform:scale(1)}50%{transform:scale(1.08)}100%{transform:scale(1)}}
    button:hover{filter:brightness(1.1)}
    button:active{transform:scale(0.97)!important}
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}
    input[type=range]{-webkit-appearance:none;height:4px;background:linear-gradient(90deg,rgba(0,240,200,0.2),rgba(255,77,109,0.1));border-radius:2px;outline:none}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;background:linear-gradient(135deg,#00F0C8,#4ECDC4);border-radius:50%;cursor:pointer;box-shadow:0 0 12px rgba(0,240,200,0.7)}
    input[type=range]::-moz-range-thumb{width:18px;height:18px;background:linear-gradient(135deg,#00F0C8,#4ECDC4);border-radius:50%;cursor:pointer;border:none;box-shadow:0 0 10px rgba(0,240,200,0.6)}
  `}</style>

</div>
);
}