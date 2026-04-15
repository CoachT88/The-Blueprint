import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════
HARMONYMAP v4 — "Find Yourself in Sound"
Complete emotion-driven music theory app for beginners
═══════════════════════════════════════════════════════════════ */

// ─── AUDIO ENGINE ───────────────────────────────────────────
class AudioEngine {
constructor() { this.ctx=null; this.mg=null; this.rv=null; this.rvStadium=null; this.isPlaying=false; this.tids=[]; this.instrument='underwater'; this.pianoWave=null; this.cinematicWave=null; this.noteEnvs=[]; }
init() {
if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}
// iOS speaker fix: the <audio> element must have REAL audio data to switch
// the session from SoloAmbient (earpiece) to Playback (speaker).
// A 0-byte WAV does nothing — iOS ignores it and stays on earpiece.
if(!this.iosUnlocked){this.iosUnlocked=true;try{const a=document.createElement('audio');a.setAttribute('playsinline','');a.setAttribute('preload','auto');a.src='data:audio/wav;base64,UklGRsEIAABXQVZFZm10IBAAAAABAAEAIlYAACJWAAABAAgAZGF0YZ0IAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICagICAgICAgICAgICagICAgICagICagICagICA=';a.play().catch(()=>{});}catch(e){}}
this.ctx=new(window.AudioContext||window.webkitAudioContext)();
this.ctx.resume();
// Play an inaudible noise burst through the AudioContext — forces iOS to
// commit the audio session to speaker output immediately.
try{const ub=this.ctx.createBuffer(1,this.ctx.sampleRate*0.1,this.ctx.sampleRate);const ud=ub.getChannelData(0);for(let i=0;i<ud.length;i++)ud[i]=(Math.random()-0.5)*1e-5;const us=this.ctx.createBufferSource();us.buffer=ub;us.connect(this.ctx.destination);us.start(0);}catch(e){}
this.mg=this.ctx.createGain(); this.mg.gain.value=0.32;
const comp=this.ctx.createDynamicsCompressor();
comp.threshold.value=-18;comp.knee.value=12;comp.ratio.value=3;comp.attack.value=0.008;comp.release.value=0.20;
// ── Master Low-Pass: 2800Hz — open enough for both profiles ─
const masterLP=this.ctx.createBiquadFilter();
masterLP.type='lowpass';masterLP.frequency.value=2800;masterLP.Q.value=0.7;
// ── Room reverb (Underwater dry send, small dark tail) ────
const rvBuf=this._buildReverbBuffer(1.2,4.0);
const rvConv=this.ctx.createConvolver();rvConv.buffer=rvBuf;
const rvSendLP=this.ctx.createBiquadFilter();
rvSendLP.type='lowpass';rvSendLP.frequency.value=600;rvSendLP.Q.value=0.5;
const rvGain=this.ctx.createGain();rvGain.gain.value=0.07;
rvSendLP.connect(rvConv);rvConv.connect(rvGain);rvGain.connect(masterLP);
// ── Stadium reverb (Cinematic — lush 2.8s hall) ───────────
const stBuf=this._buildReverbBuffer(2.8,1.8);
const stConv=this.ctx.createConvolver();stConv.buffer=stBuf;
const stSendLP=this.ctx.createBiquadFilter();
stSendLP.type='lowpass';stSendLP.frequency.value=1400;stSendLP.Q.value=0.5;
const stGain=this.ctx.createGain();stGain.gain.value=0.28;
stSendLP.connect(stConv);stConv.connect(stGain);stGain.connect(masterLP);
// ── Master chain: mg → comp → masterLP → speakers ─────────
// ── Soft-clipper: tanh limiter before destination — zero distortion at any volume ──
const clip=this.ctx.createWaveShaper();const cv=new Float32Array(256);for(let i=0;i<256;i++){const x=i*2/255-1;cv[i]=Math.tanh(x*2.5)/Math.tanh(2.5);}clip.curve=cv;clip.oversample='4x';
this.mg.connect(comp);comp.connect(masterLP);masterLP.connect(clip);clip.connect(this.ctx.destination);
this.rv=rvSendLP;this.rvStadium=stSendLP;
// Pre-build both instrument waves so switching is instant (no lag on first tap)
this._buildWaves();
}
_buildWaves(){
if(!this.pianoWave){
// Underwater: soft piano, gentle harmonic rolloff — muffled by LP 700Hz anyway
const pa=[0,1.0,0.55,0.30,0.16,0.10,0.068,0.044,0.030,0.020,0.013,0.009,0.006,0.004];
const N=pa.length,pr=new Float32Array(N),pi=new Float32Array(N);
for(let i=1;i<N;i++)pr[i]=pa[i];
this.pianoWave=this.ctx.createPeriodicWave(pr,pi,{disableNormalization:false});
}
if(!this.cinematicWave){
// Cinematic: analog saw-square blend — odd partials boosted for that Travis-Scott buzz
// Sawtooth base (1/n) with odd harmonics 1.4× louder → classic Moog-like character
const N=16;const cr=new Float32Array(N),ci=new Float32Array(N);
for(let i=1;i<N;i++){cr[i]=0;ci[i]=-(1/i)*(i%2===1?1.4:0.8);}
this.cinematicWave=this.ctx.createPeriodicWave(cr,ci,{disableNormalization:false});
}
}
_buildReverbBuffer(dur,decay=3.6){
// Synthetic IR: exponential noise decay with variable decay rate
// decay=4.0 → short dark room; decay=1.8 → long lush hall
const sr=this.ctx.sampleRate,len=Math.floor(sr*dur),pre=Math.floor(sr*0.018);
const buf=this.ctx.createBuffer(2,len,sr);
for(let ch=0;ch<2;ch++){const d=buf.getChannelData(ch);for(let i=pre;i<len;i++){const t=(i-pre)/sr;d[i]=(Math.random()*2-1)*Math.exp(-t*decay);}}
return buf;
}
setInstrument(name){this.instrument=name;}
noteToFreq(n) {
const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};
const m=n.match(/^([A-G][#b]?)(\d)$/); if(!m) return 440;
return 440*Math.pow(2,(M[m[1]]-9+(parseInt(m[2])-4)*12)/12);
}
_playUnderwater(fr,vel,t,dur){
// ── UNDERWATER ─────────────────────────────────────────────
// Deep, muffled, still — Drake "Take Care" vibe.
// Heavy LP at 700Hz kills all brightness. No wobble (stillness = eeriness).
const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.6;
// Hard-muffled: fixed 700Hz sweeping gently to 580Hz as note blooms
fl.frequency.setValueAtTime(700,t);fl.frequency.linearRampToValueAtTime(580,t+dur*0.65);
// 3-voice unison width (no LFO — stillness is the effect)
[-7,0,7].forEach(dt=>{
  const o=this.ctx.createOscillator();
  o.setPeriodicWave(this.pianoWave);
  o.frequency.value=fr;o.detune.value=dt;
  o.connect(fl);o.start(t);o.stop(t+dur+0.4);
});
const env=this.ctx.createGain();
// 45ms swell — chord blooms slowly, no attack click
env.gain.setValueAtTime(0,t);
env.gain.linearRampToValueAtTime(vel*0.52,t+0.045);
env.gain.exponentialRampToValueAtTime(vel*0.34,t+0.12);
env.gain.exponentialRampToValueAtTime(vel*0.20,t+0.55);
env.gain.exponentialRampToValueAtTime(vel*0.09,t+dur*0.85);
env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.1);
fl.connect(env);return env;
}
_playCinematic(fr,vel,t,dur){
// ── CINEMATIC ──────────────────────────────────────────────
// Massive, analog, Travis Scott "Stargazing" vibe.
// Saw-square wave blend, tape drift LFO, soft saturation, lush hall reverb.
const fl=this.ctx.createBiquadFilter();fl.type='lowpass';fl.Q.value=0.65;
fl.frequency.setValueAtTime(1600,t);fl.frequency.exponentialRampToValueAtTime(1100,t+dur*0.6);
// Soft saturation waveshaper — tape warmth / slight overdrive
const ws=this.ctx.createWaveShaper();
const wc=new Float32Array(256);
for(let i=0;i<256;i++){const x=i*2/255-1;wc[i]=x*(1.5+Math.abs(x)*0.5)/(1+Math.abs(x)*2.0);}
ws.curve=wc;ws.oversample='2x';
// Tape wobble LFO (0.3-0.5 Hz, ±16 cents) — analog drift character
const lfo=this.ctx.createOscillator();const lfog=this.ctx.createGain();
lfo.type='sine';lfo.frequency.value=0.28+Math.random()*0.22;lfog.gain.value=16;
lfo.connect(lfog);lfo.start(t);lfo.stop(t+dur+0.9);
// Pre-gain to prevent waveshaper clipping from 5-voice sum
const pg=this.ctx.createGain();pg.gain.value=0.22;
// 5-voice chorus — wide stereo spread, massive analog sound
[-20,-7,0,7,20].forEach(dt=>{
  const o=this.ctx.createOscillator();
  o.setPeriodicWave(this.cinematicWave);
  o.frequency.value=fr;o.detune.value=dt;
  lfog.connect(o.detune);
  o.connect(pg);o.start(t);o.stop(t+dur+0.7);
});
pg.connect(ws);ws.connect(fl);
const env=this.ctx.createGain();
// 50ms swell — cinematic chord swells in like a film score
env.gain.setValueAtTime(0,t);
env.gain.linearRampToValueAtTime(vel*0.56,t+0.050);
env.gain.exponentialRampToValueAtTime(vel*0.40,t+0.14);
env.gain.exponentialRampToValueAtTime(vel*0.28,t+0.50);
env.gain.exponentialRampToValueAtTime(vel*0.14,t+dur*0.80);
env.gain.exponentialRampToValueAtTime(0.0001,t+dur+0.25);
fl.connect(env);return env;
}
_octaveDown(n){const m=n.match(/^([A-G][#b]?)(\d)$/);if(!m)return n;return m[1]+(parseInt(m[2])-1);}
_playBass(fr,vel,t,dur){
// Pure sine sub-bass root — LP at 200Hz keeps it clean, no reverb send to prevent mud
const o=this.ctx.createOscillator();o.type='sine';o.frequency.value=fr;
const lp=this.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=200;lp.Q.value=0.5;
const env=this.ctx.createGain();
env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(vel*0.55,t+0.04);
env.gain.exponentialRampToValueAtTime(vel*0.30,t+0.15);env.gain.exponentialRampToValueAtTime(0.0001,t+dur);
o.connect(lp);lp.connect(env);env.connect(this.mg);
o.start(t);o.stop(t+dur+0.1);
return env;
}
playNote(n,dur=1.2,vel=0.42,st=null){
this.init();if(!this.pianoWave||!this.cinematicWave)this._buildWaves();
const fr=typeof n==='number'?n:this.noteToFreq(n);const t=st||(this.ctx.currentTime+0.15);
const isCinematic=this.instrument==='cinematic';
const env=isCinematic?this._playCinematic(fr,vel,t,dur):this._playUnderwater(fr,vel,t,dur);
env.connect(this.mg);
// Cinematic → lush stadium reverb; Underwater → stays dry (claustrophobic muffled feel)
if(isCinematic){env.connect(this.rvStadium);}else{env.connect(this.rv);}
return env;
}
playChord(notes,dur=1.5,stg=0.018){
this.init();if(!notes||!notes.length)return;
const now=this.ctx.currentTime;
// Choke group: ~45ms kill — previous chord cut the moment new one fires
const dead=this.noteEnvs.slice();
dead.forEach(e=>{try{e.gain.cancelScheduledValues(now);e.gain.setTargetAtTime(0,now,0.015);}catch(x){}});
// Disconnect dead nodes from graph after fade completes — prevents memory leak
setTimeout(()=>{dead.forEach(e=>{try{e.disconnect();}catch(x){}});},200);
this.noteEnvs=[];
const t=now+0.015;
// Bass root: Cinematic = 2 octaves down (stadium depth); Underwater = 1 octave down
const bassNote=this.instrument==='cinematic'?
  this._octaveDown(this._octaveDown(notes[0])):this._octaveDown(notes[0]);
const be=this._playBass(this.noteToFreq(bassNote),0.42,t,dur*0.80);
if(be)this.noteEnvs.push(be);
// Humanize: ±14% velocity + ±3ms timing jitter for soulful feel
notes.forEach((n,i)=>{const vel=0.42*(0.86+Math.random()*0.28);const jit=(Math.random()-0.5)*0.006;const e=this.playNote(n,dur,vel,t+i*stg+jit);if(e)this.noteEnvs.push(e);});
}
playClick(hi,st){this.init();const t=st||(this.ctx.currentTime+0.15);const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.value=hi?1400:900;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.25,t+0.002);g.gain.exponentialRampToValueAtTime(0.0001,t+0.08);o.connect(g);g.connect(this.mg);o.start(t);o.stop(t+0.1);}
countIn(bpm,beats,cb){this.init();const d=60/bpm;const t0=this.ctx.currentTime;for(let i=0;i<beats;i++)this.playClick(i===0,t0+i*d);const id=setTimeout(cb,beats*d*1000);this.tids.push(id);}
play808Pattern(grid,notes,bpm,cb,loop){this.init();this.stop();this.isPlaying=true;const stepD=(60/bpm)/4;const steps=grid[0]?.length||16;const tot=steps*stepD*1000;const go=()=>{if(!this.isPlaying)return;for(let s=0;s<steps;s++){const tms=s*stepD*1000;this.tids.push(setTimeout(()=>{if(!this.isPlaying)return;for(let r=0;r<grid.length;r++)if(grid[r][s])this.play808(notes[r],stepD*4,0.85);if(cb)cb(s);},tms));}if(loop)this.tids.push(setTimeout(()=>{if(this.isPlaying)go();},tot));else this.tids.push(setTimeout(()=>{this.isPlaying=false;if(cb)cb(-1);},tot));};go();}
playInterval(a,b,dur=1.8) { this.init(); const t=this.ctx.currentTime+0.15; this.playNote(a,dur,0.4,t); this.playNote(b,dur,0.4,t+0.01); }
playMelodicInterval(a,b,dur=0.8) { this.init(); const t=this.ctx.currentTime+0.15; this.playNote(a,dur,0.45,t); this.playNote(b,dur,0.45,t+dur*0.7); }
playProgression(cl,bpm=72,cb,beats=4,stg=0.018) {
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*beats;
cl.forEach((n,i)=>{ const t=setTimeout(()=>{if(!this.isPlaying)return; if(n)this.playChord(n,d*0.88,stg); if(cb)cb(i);},i*d*1000); this.tids.push(t); });
this.tids.push(setTimeout(()=>{this.isPlaying=false; if(cb)cb(-1);},cl.length*d*1000));
}
playLoop(cl,bpm=72,cb,beats=4,stg=0.018) {
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*beats; const tot=cl.length*d*1000;
const go=()=>{ if(!this.isPlaying) return;
cl.forEach((n,i)=>{ this.tids.push(setTimeout(()=>{if(!this.isPlaying)return; if(n)this.playChord(n,d*0.88,stg); if(cb)cb(i);},i*d*1000)); });
this.tids.push(setTimeout(()=>{if(this.isPlaying)go();},tot));
}; go();
}
stop() { this.isPlaying=false; this.tids.forEach(t=>clearTimeout(t)); this.tids=[]; }
absoluteStop(){this.isPlaying=false;this.tids.forEach(t=>clearTimeout(t));this.tids=[];const now=this.ctx?this.ctx.currentTime:0;this.noteEnvs.forEach(e=>{try{e.gain.cancelScheduledValues(now);e.gain.setTargetAtTime(0,now,0.003);setTimeout(()=>{try{e.disconnect();}catch(x){}},80);}catch(x){}});this.noteEnvs=[];if(this.mg&&this.ctx){try{this.mg.gain.cancelScheduledValues(now);this.mg.gain.setValueAtTime(0,now);this.mg.gain.linearRampToValueAtTime(0.32,now+0.12);}catch(x){}}}
play808(n,dur=2.0,vel=0.85,st=null){
this.init(); const base=typeof n==='number'?n:this.noteToFreq((typeof n==='string'&&!/\d/.test(n))?n+'2':n); const t=st||(this.ctx.currentTime+0.15);
const o=this.ctx.createOscillator(),g=this.ctx.createGain(),lp=this.ctx.createBiquadFilter();
o.type='sine'; o.frequency.setValueAtTime(base*2.5,t); o.frequency.exponentialRampToValueAtTime(base,t+0.06);
lp.type='lowpass'; lp.frequency.value=180; lp.Q.value=0.5;
g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vel*0.95,t+0.008); g.gain.exponentialRampToValueAtTime(vel*0.5,t+0.25); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
o.connect(lp); lp.connect(g); g.connect(this.mg);
o.start(t); o.stop(t+dur+0.1);
}
playMelody(notes,bpm=100,cb){
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*0.5;
notes.forEach((n,i)=>{ const t=setTimeout(()=>{if(!this.isPlaying)return; if(n&&n!=='REST')this.playNote(n+'4',d*0.75,0.5); if(cb)cb(i);},i*d*1000); this.tids.push(t); });
this.tids.push(setTimeout(()=>{this.isPlaying=false; if(cb)cb(-1);},notes.length*d*1000));
}
loopMelody(notes,bpm=100,cb){
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*0.5; const tot=notes.length*d*1000;
const go=()=>{if(!this.isPlaying)return; notes.forEach((n,i)=>{this.tids.push(setTimeout(()=>{if(!this.isPlaying)return; if(n&&n!=='REST')this.playNote(n+'4',d*0.75,0.5); if(cb)cb(i);},i*d*1000));});this.tids.push(setTimeout(()=>{if(this.isPlaying)go();},tot));};go();
}
loop808(notes,bpm=90,cb){
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*2; const tot=notes.length*d*1000;
const go=()=>{if(!this.isPlaying)return; notes.forEach((n,i)=>{this.tids.push(setTimeout(()=>{if(!this.isPlaying)return; this.play808(n,d*0.85,0.85); if(cb)cb(i);},i*d*1000));});this.tids.push(setTimeout(()=>{if(this.isPlaying)go();},tot));};go();
}
}
const audio=new AudioEngine();
function genreNotes(sym,genre){const{r,t}=pc(sym);const oct=(genre==='trap'||genre==='hiphop')?2:3;if((genre==='90s-rnb'||genre==='rnb'||genre==='lofi')&&CT[t]){const rt=t==='major'?'maj7':t==='minor'?'min7':t==='dominant'?'dom7':t;return cn(r,CT[rt]?rt:t,oct);}return cn(r,t,oct);}
function idProg(ch){if(!ch||ch.length<3)return null;const ts=ch.map(c=>pc(c).t);const pat=ts.map(t=>({major:'M',minor:'m',diminished:'d',dominant:'7',suspended:'s',augmented:'a'})[t]||'?').join('');const names={'MmMm':'I–V–vi–IV (Pop Axis)','mMmM':'vi–IV–I–V (Emotional Pop)','MMmm':'I–IV–vi–V (Classic)','mmMM':'i–VII–VI–VII (Trap Loop)','mMMm':'i–III–VII–iv (Melodic)','MmmM':'I–ii–iii–IV (Ascending)','7MMM':'V–I–IV–I (Gospel)','MMmM':'I–V–vi–IV','mmmM':'i–iv–VII–III (Minor Cycle)'};return names[pat]||null;}

// ─── MUSIC DATA ─────────────────────────────────────────────
const NN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FN=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const ENH={Cb:'B',Fb:'E','E#':'F','B#':'C'};
const CT={
major:{iv:[0,4,7],q:'major'},minor:{iv:[0,3,7],q:'minor'},dim:{iv:[0,3,6],q:'diminished'},
aug:{iv:[0,4,8],q:'augmented'},dom7:{iv:[0,4,7,10],q:'dominant'},maj7:{iv:[0,4,7,11],q:'major'},
min7:{iv:[0,3,7,10],q:'minor'},'m7b5':{iv:[0,3,6,10],q:'diminished'},sus2:{iv:[0,2,7],q:'suspended'},sus4:{iv:[0,5,7],q:'suspended'},add9:{iv:[0,4,7,14],q:'major'},
};
function cn(root,type,oct=4){const r=ENH[root]||root;const ri=NN.indexOf(r)!==-1?NN.indexOf(r):FN.indexOf(r);if(ri===-1)return[];const d=CT[type];if(!d)return[];return d.iv.map(v=>{const ni=(ri+v)%12;return NN[ni]+(oct+Math.floor((ri+v)/12));});}
function pc(sym){const m=sym.match(/^([A-G][#b]?)(m7b5|m7|maj7|add9|sus2|sus4|°|\+|m|7)?$/);if(!m)return{r:'C',t:'major'};const M={'':'major',m:'minor','°':'dim','+':'aug','7':'dom7',maj7:'maj7',m7:'min7',m7b5:'m7b5',sus2:'sus2',sus4:'sus4',add9:'add9'};return{r:m[1],t:M[m[2]||'']||'major'};}
function cc(s){const q=CT[pc(s).t]?.q;return{major:'#FF6B6B',minor:'#4ECDC4',diminished:'#C77DFF',augmented:'#B5FF3D',dominant:'#FFB347',suspended:'#87CEEB'}[q]||'#fff';}
function ql(s){const q=CT[pc(s).t]?.q;return{major:'Major',minor:'Minor',diminished:'Diminished',augmented:'Augmented',dominant:'Dominant 7th',suspended:'Suspended'}[q]||'Chord';}

// ─── INTERVALS ──────────────────────────────────────────────
const IVS=[
{s:0,n:'Unison',sn:'P1',f:'Identity — pure stillness',c:'perfect'},
{s:1,n:'Minor 2nd',sn:'m2',f:'Tension — two notes pressing together',c:'dissonant'},
{s:2,n:'Major 2nd',sn:'M2',f:'Gentle movement — a step forward',c:'mild'},
{s:3,n:'Minor 3rd',sn:'m3',f:'Sadness, tenderness — heart of minor',c:'consonant'},
{s:4,n:'Major 3rd',sn:'M3',f:'Brightness, joy — heart of major',c:'consonant'},
{s:5,n:'Perfect 4th',sn:'P4',f:'Openness — floating, calm suspension',c:'perfect'},
{s:6,n:'Tritone',sn:'TT',f:'Maximum tension — wants to resolve desperately',c:'dissonant'},
{s:7,n:'Perfect 5th',sn:'P5',f:'Power — foundation of almost all chords',c:'perfect'},
{s:8,n:'Minor 6th',sn:'m6',f:'Longing — aches gorgeously',c:'consonant'},
{s:9,n:'Major 6th',sn:'M6',f:'Warmth, nostalgia — golden and familiar',c:'consonant'},
{s:10,n:'Minor 7th',sn:'m7',f:'Bluesy pull — cool tension',c:'mild'},
{s:11,n:'Major 7th',sn:'M7',f:'Dreamy tension — floating below resolution',c:'dissonant'},
{s:12,n:'Octave',sn:'P8',f:'Completion — same note higher',c:'perfect'},
];
function ic(c){return{perfect:'#4ECDC4',consonant:'#FFB347',mild:'#87CEEB',dissonant:'#FF6B6B'}[c]||'#fff';}

// ─── SCALE DEGREES ──────────────────────────────────────────
const DM=[{d:1,n:'Root',f:'Home',st:'anchor'},{d:2,n:'Supertonic',f:'Gentle longing',st:'passing'},{d:3,n:'Mediant',f:'Emotional identity',st:'stable'},{d:4,n:'Subdominant',f:'Leaning forward',st:'mild-tension'},{d:5,n:'Dominant',f:'Strong anchor',st:'anchor'},{d:6,n:'Submediant',f:'Sweet, nostalgic',st:'stable'},{d:7,n:'Leading Tone',f:'Maximum pull to root',st:'tension'}];
const Dm=[{d:1,n:'Root',f:'Heavy home',st:'anchor'},{d:2,n:'Supertonic',f:'Restless urgency',st:'passing'},{d:3,n:'Mediant',f:'Minor identity',st:'stable'},{d:4,n:'Subdominant',f:'Weight',st:'mild-tension'},{d:5,n:'Dominant',f:'Cold or strong',st:'anchor'},{d:6,n:'Submediant',f:'Dark warmth',st:'stable'},{d:7,n:'Subtonic',f:'Soft pull',st:'mild-tension'}];
function dc(s){return{anchor:'#4ECDC4',stable:'#87CEEB',passing:'#FFB347','mild-tension':'#DDA0DD',tension:'#FF6B6B'}[s]||'#fff';}

// ─── VOICE LEADING ──────────────────────────────────────────
function vl(f,t){
const fn=cn(pc(f).r,pc(f).t,4).map(n=>({n:n.replace(/\d/,''),m:NN.indexOf(n.replace(/\d/,''))}));
const tn=cn(pc(t).r,pc(t).t,4).map(n=>({n:n.replace(/\d/,''),m:NN.indexOf(n.replace(/\d/,''))}));
const mv=[],u=new Set();
fn.forEach(a=>{let bd=99,bi=0;tn.forEach((b,i)=>{if(u.has(i))return;const d=Math.min(Math.abs(b.m-a.m),12-Math.abs(b.m-a.m));if(d<bd){bd=d;bi=i;}});u.add(bi);const b=tn[bi]||a;mv.push({f:a.n,t:b.n,d:bd,s:a.n===b.n});});
const sc=mv.filter(m=>m.s).length,tm=mv.reduce((s,m)=>s+m.d,0);
return{mv,sc,tm,sm:tm>6?'Dramatic':tm>3?'Moderate':'Smooth'};
}

// ─── MOVEMENT FEEL ──────────────────────────────────────────
function mf(f,t){
const a=CT[pc(f).t]?.q||'major',b=CT[pc(t).t]?.q||'major';
if(a==='minor'&&b==='major') return{l:'Opening up',e:'🌅'};
if(a==='major'&&b==='minor') return{l:'Turning inward',e:'🌙'};
if(a==='dominant'&&b==='major') return{l:'Resolving',e:'✨'};
if(a==='dominant'&&b==='minor') return{l:'Dark resolution',e:'⚡'};
if(a==='diminished') return{l:'Escaping tension',e:'💨'};
if(b==='diminished') return{l:'Into unknown',e:'🌀'};
if(a===b) return{l:'Staying in mood',e:'〰️'};
return{l:'Shifting color',e:'🎭'};
}

// ─── KEY DATA ───────────────────────────────────────────────
const KEYS={
'C major':{r:'C',m:'major',ch:['C','Dm','Em','F','G','Am','B°'],sc:['C','D','E','F','G','A','B']},
'G major':{r:'G',m:'major',ch:['G','Am','Bm','C','D','Em','F#°'],sc:['G','A','B','C','D','E','F#']},
'D major':{r:'D',m:'major',ch:['D','Em','F#m','G','A','Bm','C#°'],sc:['D','E','F#','G','A','B','C#']},
'A major':{r:'A',m:'major',ch:['A','Bm','C#m','D','E','F#m','G#°'],sc:['A','B','C#','D','E','F#','G#']},
'E major':{r:'E',m:'major',ch:['E','F#m','G#m','A','B','C#m','D#°'],sc:['E','F#','G#','A','B','C#','D#']},
'F major':{r:'F',m:'major',ch:['F','Gm','Am','Bb','C','Dm','E°'],sc:['F','G','A','Bb','C','D','E']},
'Bb major':{r:'Bb',m:'major',ch:['Bb','Cm','Dm','Eb','F','Gm','A°'],sc:['Bb','C','D','Eb','F','G','A']},
'Eb major':{r:'Eb',m:'major',ch:['Eb','Fm','Gm','Ab','Bb','Cm','D°'],sc:['Eb','F','G','Ab','Bb','C','D']},
'A minor':{r:'A',m:'minor',ch:['Am','B°','C','Dm','Em','F','G'],sc:['A','B','C','D','E','F','G']},
'E minor':{r:'E',m:'minor',ch:['Em','F#°','G','Am','Bm','C','D'],sc:['E','F#','G','A','B','C','D']},
'D minor':{r:'D',m:'minor',ch:['Dm','E°','F','Gm','Am','Bb','C'],sc:['D','E','F','G','A','Bb','C']},
'G minor':{r:'G',m:'minor',ch:['Gm','A°','Bb','Cm','Dm','Eb','F'],sc:['G','A','Bb','C','D','Eb','F']},
'F minor':{r:'F',m:'minor',ch:['Fm','G°','Ab','Bbm','Cm','Db','Eb'],sc:['F','G','Ab','Bb','C','Db','Eb']},
'C minor':{r:'C',m:'minor',ch:['Cm','D°','Eb','Fm','Gm','Ab','Bb'],sc:['C','D','Eb','F','G','Ab','Bb']},
'B minor':{r:'B',m:'minor',ch:['Bm','C#°','D','Em','F#m','G','A'],sc:['B','C#','D','E','F#','G','A']},
'B major':{r:'B',m:'major',ch:['B','C#m','D#m','E','F#','G#m','A#°'],sc:['B','C#','D#','E','F#','G#','A#']},
'Gb major':{r:'Gb',m:'major',ch:['Gb','Abm','Bbm','Cb','Db','Ebm','F°'],sc:['Gb','Ab','Bb','Cb','Db','Eb','F']},
'Db major':{r:'Db',m:'major',ch:['Db','Ebm','Fm','Gb','Ab','Bbm','C°'],sc:['Db','Eb','F','Gb','Ab','Bb','C']},
'Ab major':{r:'Ab',m:'major',ch:['Ab','Bbm','Cm','Db','Eb','Fm','G°'],sc:['Ab','Bb','C','Db','Eb','F','G']},
'F# minor':{r:'F#',m:'minor',ch:['F#m','G#°','A','Bm','C#m','D','E'],sc:['F#','G#','A','B','C#','D','E']},
'C# minor':{r:'C#',m:'minor',ch:['C#m','D#°','E','F#m','G#m','A','B'],sc:['C#','D#','E','F#','G#','A','B']},
'G# minor':{r:'G#',m:'minor',ch:['G#m','A#°','B','C#m','D#m','E','F#'],sc:['G#','A#','B','C#','D#','E','F#']},
'Eb minor':{r:'Eb',m:'minor',ch:['Ebm','F°','Gb','Abm','Bbm','Cb','Db'],sc:['Eb','F','Gb','Ab','Bb','Cb','Db']},
'Bb minor':{r:'Bb',m:'minor',ch:['Bbm','C°','Db','Ebm','Fm','Gb','Ab'],sc:['Bb','C','Db','Eb','F','Gb','Ab']},
};
const MAJOR_COF=['C major','G major','D major','A major','E major','B major','Gb major','Db major','Ab major','Eb major','Bb major','F major'];
const MINOR_COF=['A minor','E minor','B minor','F# minor','C# minor','G# minor','Eb minor','Bb minor','F minor','C minor','G minor','D minor'];
const RELATIVE={'C major':'A minor','A minor':'C major','G major':'E minor','E minor':'G major','D major':'B minor','B minor':'D major','A major':'F# minor','F# minor':'A major','E major':'C# minor','C# minor':'E major','B major':'G# minor','G# minor':'B major','Gb major':'Eb minor','Eb minor':'Gb major','Db major':'Bb minor','Bb minor':'Db major','Ab major':'F minor','F minor':'Ab major','Eb major':'C minor','C minor':'Eb major','Bb major':'G minor','G minor':'Bb major','F major':'D minor','D minor':'F major'};
const FNM=['Home (I / 1)','Shadow (ii / 2)','Edge (iii / 3)','Warmth (IV / 4)','Pull (V / 5)','Relative (vi / 6)','Gateway (vii° / 7)'];
const FNm=['Home (i / 1)','Edge (ii° / 2)','Relative (III / 3)','Shadow (iv / 4)','Pull (v / 5)','Warmth (VI / 6)','Gateway (VII / 7)'];
function chordRN(k,ch){if(!k?.ch)return'';const rn=['I','ii','iii','IV','V','vi','vii°'],rm=['i','ii°','III','iv','v','VI','VII'];const pos=k.ch.indexOf(ch);return pos===-1?'':`${k.m==='minor'?rm[pos]:rn[pos]} / ${pos+1}`;}
function gcon(ch,mode='major'){if(!ch||ch.length<7)return[];const p=mode==='minor'?[[0,3],[0,4],[0,5],[1,4],[1,6],[2,5],[2,3],[3,0],[3,4],[3,1],[4,0],[4,5],[5,3],[5,1],[5,2],[5,6],[6,0],[6,2],[6,4]]:[[0,3],[0,4],[0,5],[1,4],[1,6],[2,5],[2,3],[3,0],[3,4],[3,1],[4,0],[4,5],[5,3],[5,1],[5,2],[6,0],[6,4]];return p.map(([a,b])=>({f:ch[a],t:ch[b],st:((a===4&&b===0)||(a===3&&b===0))?'strong':'normal'}));}

// ─── KEY-AWARE PRESETS ──────────────────────────────────────
function presets(kn){const k=KEYS[kn];if(!k)return[];const c=k.ch;
if(k.m==='major') return[
{n:'Pop Classic',f:'Anthemic',ch:[c[0],c[4],c[5],c[3]]},{n:'Emotional',f:'Sad then opens',ch:[c[5],c[3],c[0],c[4]]},
{n:'Uplifting',f:'Forward motion',ch:[c[0],c[2],c[5],c[3]]},{n:'Gentle',f:'Warm, flowing',ch:[c[0],c[5],c[3],c[4]]},
{n:'Cinematic',f:'Dramatic sweep',ch:[c[5],c[4],c[3],c[4]]},
]; else return[
{n:'Reflective',f:'Inward, opens',ch:[c[0],c[5],c[2],c[6]]},{n:'Dark Drive',f:'Heavy cycle',ch:[c[0],c[3],c[4],c[0]]},
{n:'Bittersweet',f:'Descending',ch:[c[0],c[6],c[5],c[4]]},{n:'Wandering',f:'Searching',ch:[c[0],c[2],c[5],c[6]]},
{n:'Circular',f:'Trapped pull',ch:[c[0],c[4],c[0],c[3]]},
];
}

// ─── GENRE SYSTEM ───────────────────────────────────────────
const GENRES = {
pop: {
n:'Pop', color:'#FF6B6B', desc:'Catchy, polished, singable',
tempo:120, feel:'Upbeat, clean, driving',
tips:'Pop lives on the I–V–vi–IV axis. Keep it simple, let the melody carry.',
progs:[
{n:'The Anthem',d:'I–V–vi–IV',w:'The backbone of modern pop — bright, emotional, universally catchy. You\'ve heard this thousands of times.',g:c=>[c[0],c[4],c[5],c[3]],bpm:120},
{n:'Emotional Pop',d:'vi–IV–I–V',w:'Starts in feeling, builds to power. Every emotional pop chorus lives here.',g:c=>[c[5],c[3],c[0],c[4]],bpm:115},
{n:'The Lift',d:'I–iii–IV–V',w:'Gentle climb that builds momentum — perfect for verses that open into big choruses.',g:c=>[c[0],c[2],c[3],c[4]],bpm:118},
{n:'Pop Ballad',d:'I–V–vi–iii–IV',w:'Extended version of the pop axis — the extra iii chord adds a moment of cool vulnerability.',g:c=>[c[0],c[4],c[5],c[2],c[3]],bpm:76},
]
},
'90s-rnb': {
n:'90s R&B', color:'#DDA0DD', desc:'Smooth, lush, soulful — golden era',
tempo:85, feel:'Laid-back groove, warm and rich',
tips:'90s R&B uses 7th chords everywhere. Replace every triad with its 7th version. The smoothness comes from those extra notes.',
progs:[
{n:'Slow Jam',d:'I–vi–IV–V',w:'The classic slow jam foundation. Add 7ths to every chord and it immediately sounds like silk.',g:c=>[c[0],c[5],c[3],c[4]],bpm:78},
{n:'Quiet Storm',d:'ii–V–I–vi',w:'Jazz-influenced movement that defines the quietstorm sound. Smooth, sophisticated, late-night.',g:c=>[c[1],c[4],c[0],c[5]],bpm:82},
{n:'New Jack Swing',d:'I–IV–V–IV',w:'Bouncy, groovy, uptempo. The swagger era. Drum machine energy.',g:c=>[c[0],c[3],c[4],c[3]],bpm:105},
{n:'Ballad Gold',d:'I–iii–vi–IV',w:'Tender, emotional, intimate. Whitney and Mariah territory. Every note dripping with feeling.',g:c=>[c[0],c[2],c[5],c[3]],bpm:68},
]
},
rnb: {
n:'R&B / Neo-Soul', color:'#FFB347', desc:'Modern, intimate, textured',
tempo:72, feel:'Spacious, breathy, emotive',
tips:'Modern R&B strips things back. Fewer chords, more space, heavier bass, atmospheric textures. Let things breathe.',
progs:[
{n:'Late Night Vibe',d:'vi–IV–I–V',w:'Moody, atmospheric. The foundation of modern R&B — sparse but emotionally dense.',g:c=>[c[5],c[3],c[0],c[4]],bpm:68},
{n:'Two-Chord Float',d:'I–vi',w:'Just two chords looping. Modern R&B proves you don\'t need complexity — mood is everything.',g:c=>[c[0],c[5]],bpm:65},
{n:'Neo-Soul Cycle',d:'ii–V–I–IV',w:'Jazz DNA in a modern body. Smooth, warm, sophisticated. Erykah Badu, D\'Angelo territory.',g:c=>[c[1],c[4],c[0],c[3]],bpm:78},
{n:'Vulnerable',d:'vi–V–IV–I',w:'Descending into openness. Starts guarded, gradually reveals. Modern confessional R&B.',g:c=>[c[5],c[4],c[3],c[0]],bpm:70},
]
},
trap: {
n:'Trap', color:'#FF4500', desc:'Dark, minimal, hard-hitting',
tempo:140, feel:'Half-time feel, heavy 808s, sparse',
tips:'Trap harmony is minimal — often just 2-3 chords looping. The power comes from the bass, the space, and the repetition. Minor keys only.',
progs:[
{n:'Dark Loop',d:'i–VI–VII',w:'The classic trap triangle. Minor home, up to the major VI, push to VII. Dark but melodic.',g:c=>[c[0],c[5],c[6]],bpm:140},
{n:'Sad Trap',d:'i–iv–VII–III',w:'Emotional trap. The iv chord adds weight, the VII and III create that melancholic float.',g:c=>[c[0],c[3],c[6],c[2]],bpm:138},
{n:'Hard Minor',d:'i–VII–VI–VII',w:'Aggressive and repetitive. The VII acts as a launch pad that keeps driving the loop forward.',g:c=>[c[0],c[6],c[5],c[6]],bpm:145},
{n:'Melodic Trap',d:'i–III–VII–iv',w:'The melodic wave. Opens from minor, lifts to III, floats on VII, then sinks back. Modern hit formula.',g:c=>[c[0],c[2],c[6],c[3]],bpm:135},
]
},
lofi: {
n:'Lo-fi / Chill', color:'#87CEEB', desc:'Warm, nostalgic, lo-fi textures',
tempo:80, feel:'Relaxed, jazzy, imperfect beauty',
tips:'Lo-fi loves 7th and 9th chords. The warmth comes from extended harmony and a slightly behind-the-beat feel. Think rainy window vibes.',
progs:[
{n:'Study Beats',d:'ii–V–I–vi',w:'Jazz bones with lo-fi skin. The ii–V–I is the most natural-sounding resolution in music, then vi adds nostalgia.',g:c=>[c[1],c[4],c[0],c[5]],bpm:82},
{n:'Rainy Day',d:'I–vi–ii–V',w:'Circular warmth. Keeps cycling through sweet and melancholy without ever feeling dark. Endless comfort.',g:c=>[c[0],c[5],c[1],c[4]],bpm:75},
{n:'Night Walk',d:'vi–ii–V–I',w:'Starts contemplative, gradually resolves. Like watching city lights from a distance.',g:c=>[c[5],c[1],c[4],c[0]],bpm:78},
{n:'Vinyl Crackle',d:'I–iii–IV–ii',w:'Warm, slightly unexpected. The iii to IV move has a golden, nostalgic quality.',g:c=>[c[0],c[2],c[3],c[1]],bpm:85},
]
},
hiphop: {
n:'Hip-Hop / Boom Bap', color:'#D2691E', desc:'Sample-based, gritty, groove-driven',
tempo:90, feel:'Head-nod tempo, dusty, soulful',
tips:'Boom bap lives on jazzy chords and soul samples. The groove is everything. Keep the harmony warm and the rhythm pocket deep.',
progs:[
{n:'Golden Era',d:'i–iv–i–VII',w:'The classic hip-hop loop. Minor groove with a VII lift. Dusty records, MPC drums.',g:c=>[c[0],c[3],c[0],c[6]],bpm:92},
{n:'Soul Sample',d:'I–vi–IV–V',w:'Soulful chop. The I–vi movement carries decades of sample-based hip-hop production.',g:c=>[c[0],c[5],c[3],c[4]],bpm:88},
{n:'Head Nod',d:'i–VII–VI–VII',w:'Minimal and repetitive. The VII keeps pushing while VI adds one moment of color. Hypnotic.',g:c=>[c[0],c[6],c[5],c[6]],bpm:86},
{n:'Jazz Hop',d:'ii–V–I–iii',w:'Jazzier. The ii–V–I resolution plus the unexpected iii creates sophisticated warmth.',g:c=>[c[1],c[4],c[0],c[2]],bpm:84},
]
},
gospel: {
n:'Gospel / Soul', color:'#FFD700', desc:'Rich, powerful, spiritually charged',
tempo:95, feel:'Full, dynamic, call-and-response energy',
tips:'Gospel harmony is ALL about the movement. Use dominant 7ths to create strong pull between chords. Voice lead everything smoothly. Let the changes tell the story.',
progs:[
{n:'Praise Build',d:'I–IV–V–I',w:'The most fundamental gospel movement. Simple but powerful. The IV–V–I cadence is pure resolution.',g:c=>[c[0],c[3],c[4],c[0]],bpm:95},
{n:'Worship Climb',d:'IV–V–vi–I',w:'Rising from open to tension to emotion to home. The journey of a worship chorus.',g:c=>[c[3],c[4],c[5],c[0]],bpm:78},
{n:'Shout Music',d:'I–IV–I–V',w:'Driving, repetitive, building intensity. The foundation under every gospel shout section.',g:c=>[c[0],c[3],c[0],c[4]],bpm:110},
{n:'Sunday Morning',d:'I–vi–ii–V',w:'Warm, sophisticated, soulful. Every note connects smoothly. Classic church piano movement.',g:c=>[c[0],c[5],c[1],c[4]],bpm:72},
]
},
rock: {
n:'Rock / Alternative', color:'#8FBC8F', desc:'Raw, guitar-driven, dynamic',
tempo:125, feel:'Energetic, distorted, emotionally direct',
tips:'Rock harmony is often simpler than you think. Power comes from dynamics (quiet vs loud), distortion, and rhythm — not chord complexity.',
progs:[
{n:'Power Anthem',d:'I–V–vi–IV',w:'The rock anthem. Same as pop\'s backbone but with distortion and dynamics it becomes stadium-sized.',g:c=>[c[0],c[4],c[5],c[3]],bpm:130},
{n:'Grunge Drop',d:'vi–IV–I–V',w:'Starts dark, opens up, resolves with tension. The emotional trajectory of 90s alternative.',g:c=>[c[5],c[3],c[0],c[4]],bpm:120},
{n:'Punk Drive',d:'I–IV–V–V',w:'Three chords. That\'s it. The sustained V at the end creates urgency before the loop restarts.',g:c=>[c[0],c[3],c[4],c[4]],bpm:165},
{n:'Indie Float',d:'I–iii–vi–IV',w:'Dreamy, less aggressive. The iii chord adds cool introspection between bright and emotional.',g:c=>[c[0],c[2],c[5],c[3]],bpm:108},
]
},
};
const GENRE_KEYS = Object.keys(GENRES);

// ─── VOICINGS ───────────────────────────────────────────────
function gvoi(sym){const{r,t}=pc(sym);const rn=ENH[r]||r;const ri=NN.indexOf(rn)!==-1?NN.indexOf(rn):FN.indexOf(rn);if(ri===-1)return[];const iv=CT[t]?.iv||[0,4,7];
return[
{n:'Root position',d:'Standard, clear',notes:iv.map(v=>NN[(ri+v)%12]+(4+Math.floor((ri+v)/12)))},
{n:'1st inversion',d:'Smoother bass',notes:[NN[(ri+iv[1])%12]+'3',...iv.filter((_,i)=>i!==1).map(v=>NN[(ri+v)%12]+(4+Math.floor((ri+v)/12)))]},
{n:'Open voicing',d:'Spacious, cinematic',notes:[NN[ri]+'3',NN[(ri+(iv[2]||7))%12]+'3',NN[(ri+(iv[1]||4))%12]+'4']},
{n:'High voicing',d:'Bright, airy',notes:iv.map(v=>NN[(ri+v)%12]+(5+Math.floor((ri+v)/12)))},
];
}
function chordNotesInKey(k,chordName){if(!k||!k.ch||!k.sc)return cn(pc(chordName).r,pc(chordName).t,4).map(n=>n.replace(/\d/,''));const pos=k.ch.indexOf(chordName);if(pos===-1)return cn(pc(chordName).r,pc(chordName).t,4).map(n=>n.replace(/\d/,''));return[k.sc[pos],k.sc[(pos+2)%7],k.sc[(pos+4)%7]];}
// ─── NOTE PITCH CLASS ───────────────────────────────────────
function notePC(note){const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0};return M[note]??-1;}
function pcToKeyNote(pc12,k){if(k?.sc){const found=k.sc.find(n=>notePC(n)===pc12);if(found)return found;}const useFlats=k?.sc?.some(n=>n.includes('b'))??false;return useFlats?FN[pc12]:NN[pc12];}
// ─── CHORD EXTENSION HELPERS ────────────────────────────────
function extChordLabel(k,baseName,ext){if(!ext||ext==='triad')return baseName;if(!k||!k.ch)return baseName;const pos=k.ch.indexOf(baseName);if(pos===-1)return baseName;const{r}=pc(baseName);const isDim=(k.m==='major'&&pos===6)||(k.m==='minor'&&pos===1);if(ext==='sus2'){return isDim?baseName:r+'sus2';}if(ext==='sus4'){return isDim?baseName:r+'sus4';}if(ext==='7ths'){if(isDim)return r+'m7b5';const isMaj7=(k.m==='major'&&(pos===0||pos===3))||(k.m==='minor'&&(pos===2||pos===5));const isDom7=(k.m==='major'&&pos===4)||(k.m==='minor'&&pos===6);if(isMaj7)return r+'maj7';if(isDom7)return r+'7';return r+'m7';}return baseName;}
function extChordNotes(k,baseName,ext){if(!k||!k.ch||!k.sc)return chordNotesInKey(k,baseName);const pos=k.ch.indexOf(baseName);if(pos===-1)return chordNotesInKey(k,baseName);const root=k.sc[pos],third=k.sc[(pos+2)%7],fifth=k.sc[(pos+4)%7];const isDim=(k.m==='major'&&pos===6)||(k.m==='minor'&&pos===1);if(!ext||ext==='triad')return[root,third,fifth];if(ext==='7ths')return[root,third,fifth,k.sc[(pos+6)%7]];if(ext==='sus2'){if(isDim)return[root,third,fifth];return[root,pcToKeyNote((notePC(root)+2)%12,k),fifth];}if(ext==='sus4'){if(isDim)return[root,third,fifth];return[root,pcToKeyNote((notePC(root)+5)%12,k),fifth];}return[root,third,fifth];}

// ─── CHORD EMOTIONS ─────────────────────────────────────────
const CE={'C':{f:'Bright, pure',r:'Home base'},'Dm':{f:'Melancholy',r:'Pulls inward'},'Em':{f:'Cool, quiet',r:'Contemplation'},'F':{f:'Open, warm',r:'Expands sound'},'G':{f:'Bright, driving',r:'Pushes forward'},'Am':{f:'Sad, deep',r:'Emotional heart'},'Bm':{f:'Dark, serious',r:'Adds weight'},'D':{f:'Warm, confident',r:'Lifts clearly'},'E':{f:'Tense, powerful',r:'Strong pull'},'A':{f:'Bright, joyful',r:'Open confidence'},'Bb':{f:'Dramatic, full',r:'Cinematic color'},'Eb':{f:'Rich, soulful',r:'Gospel warmth'},'Ab':{f:'Lush, floating',r:'Dreamy lift'},'Cm':{f:'Dark, heavy',r:'Brooding weight'},'Fm':{f:'Aching, raw',r:'Deep sorrow'},'Gm':{f:'Moody, restless',r:'Shadow depth'},'G#m':{f:'Eerie, intense',r:'Unsettled beauty'},'C#m':{f:'Haunting',r:'Cold beauty'},'F#m':{f:'Somber',r:'Deeper sadness'},'B°':{f:'Tense, unstable',r:'Creates urgency'},'F#°':{f:'Sharp tension',r:'Drives forward'},'C#°':{f:'Uneasy, sharp',r:'Desperate pull'},'G#°':{f:'Piercing tension',r:'Wants to resolve'},'E°':{f:'Unstable, eerie',r:'Needs to move'},'A°':{f:'Tense, restless',r:'Pulls strongly'},'D°':{f:'Dark tension',r:'Resolves downward'},'G°':{f:'Murky tension',r:'Unsettled'},'Db':{f:'Lush, deep',r:'Rich cinematic warmth'},'Gb':{f:'Mysterious',r:'Exotic, colorful'},'F#':{f:'Bright, tense',r:'Bold drive upward'},'Abm':{f:'Dark, floating',r:'Cool shadow depth'},'Bbm':{f:'Brooding, heavy',r:'Dense emotional weight'},'Ebm':{f:'Aching, cold',r:'Hollow longing'},'D#m':{f:'Eerie, tense',r:'Pulls toward resolution'},'C°':{f:'Sharp instability',r:'Urgent need to move'},'A#°':{f:'Tense, dark',r:'Edge of collapse'},'D#°':{f:'Dissonant pull',r:'Sharp urgency'},'A#m':{f:'Tense, searching',r:'Dark yearning'},'Cb':{f:'Mysterious, lifted',r:'Unexpected exotic color'}};

// ─── EMOTION ENGINE ─────────────────────────────────────────
const EMO={
sad:{l:'Sad',p:'Heavy, reflective, aching',co:['#4A6FA5','#7B68EE','#C0C0C0'],gr:'linear-gradient(135deg,#1a1a3e,#2d1b69,#1a2744)',ks:['A minor','D minor'],pr:[{ch:['Am','F','C','G'],d:'Starts inward, slowly opens'},{ch:['Am','Em','F','Dm'],d:'Stays in shadow'},{ch:['Dm','Am','Em','Am'],d:'Circular, never resolves'}],sn:['A','B','C','D','E','F','G'],tn:['F','B'],sf:['A','C','E'],cl:['D','G'],tp:'60–80',fl:'Slow, spacious',tx:'Soft piano, pads'},
hopeful:{l:'Hopeful',p:'Open, rising, warm',co:['#FFD700','#87CEEB','#FF7F50'],gr:'linear-gradient(135deg,#1a2a1a,#2d4a1b,#3d2a0a)',ks:['C major','G major'],pr:[{ch:['C','G','Am','F'],d:'Grounded brightness lifting gently'},{ch:['G','Em','C','D'],d:'Forward with optimism'},{ch:['F','C','G','Am'],d:'Ascending with tenderness'}],sn:['C','D','E','F','G','A','B'],tn:['B','F'],sf:['C','E','G'],cl:['A','D'],tp:'80–110',fl:'Flowing, rising',tx:'Acoustic piano, guitar'},
dark:{l:'Dark',p:'Tense, cold, dramatic',co:['#DC143C','#8B008B','#2F4F4F'],gr:'linear-gradient(135deg,#0d0d0d,#2d0a1e,#1a0a0a)',ks:['A minor','E minor'],pr:[{ch:['Am','E','Am','Dm'],d:'Oppressive dominant pull'},{ch:['Em','Bm','C','Am'],d:'Cold descent into shadow'},{ch:['Dm','Am','E','Am'],d:'Dark cycle with tension'}],sn:['A','B','C','D','E','F','G'],tn:['B','F'],sf:['A','E'],cl:['C','D'],tp:'60–90',fl:'Slow, heavy',tx:'Low piano, dark pads'},
dreamy:{l:'Dreamy',p:'Floating, soft, unreal',co:['#00CED1','#E6E6FA','#FFDAB9'],gr:'linear-gradient(135deg,#0a1a2d,#1b1a3d,#0d2d3d)',ks:['C major','F major'],pr:[{ch:['C','Am','F','G'],d:'Floating between comfort and wonder'},{ch:['F','Am','G','C'],d:'Drifting without urgency'},{ch:['Em','G','C','Am'],d:'Cool mist into warmth'}],sn:['C','D','E','F','G','A','B'],tn:['F','B'],sf:['C','E','G'],cl:['A','D','F'],tp:'70–95',fl:'Spacious, ethereal',tx:'Electric piano, ambient pads'},
powerful:{l:'Powerful',p:'Bold, intense, cinematic',co:['#FF4500','#FFD700','#FF6347'],gr:'linear-gradient(135deg,#1a0a00,#3d1a0a,#2d1500)',ks:['C major','A minor'],pr:[{ch:['Am','F','C','G'],d:'Emotional depth rising to triumph'},{ch:['C','G','Am','F'],d:'Anthemic and driving'},{ch:['D','Bm','G','A'],d:'Bold ascent'}],sn:['C','D','E','F','G','A','B'],tn:['B','F'],sf:['C','E','G'],cl:['A','D'],tp:'80–130',fl:'Driving, emphatic',tx:'Full piano, strings'},
nostalgic:{l:'Nostalgic',p:'Warm, bittersweet, memory',co:['#DEB887','#D2691E','#BC8F8F'],gr:'linear-gradient(135deg,#1a1510,#2d1f0a,#1a1818)',ks:['G major','C major'],pr:[{ch:['G','Em','C','D'],d:'Looking back with warmth'},{ch:['C','Am','F','G'],d:'Simple beauty, familiar'},{ch:['Am','G','F','Em'],d:'Descending through feeling'}],sn:['G','A','B','C','D','E','F#'],tn:['F#','C'],sf:['G','B','D'],cl:['E','A'],tp:'70–100',fl:'Mid-tempo, gentle',tx:'Warm piano, soft guitar'},
romantic:{l:'Romantic',p:'Tender, intimate',co:['#FF69B4','#DDA0DD','#FFB6C1'],gr:'linear-gradient(135deg,#1a0a15,#2d0a20,#1a1018)',ks:['F major','C major'],pr:[{ch:['F','Am','Dm','G'],d:'Tenderness into longing'},{ch:['C','Em','Am','F'],d:'Gentle confession'},{ch:['G','Bm','C','D'],d:'Warm closeness'}],sn:['F','G','A','Bb','C','D','E'],tn:['E','Bb'],sf:['F','A','C'],cl:['D','G'],tp:'65–90',fl:'Slow, intimate',tx:'Felt piano, nylon guitar'},
aggressive:{l:'Aggressive',p:'Raw, fierce, relentless',co:['#FF0000','#FF4500','#8B0000'],gr:'linear-gradient(135deg,#0d0000,#2d0505,#1a0000)',ks:['E minor','A minor'],pr:[{ch:['Em','C','G','D'],d:'Relentless raw energy'},{ch:['Am','G','F','E'],d:'Descending force'},{ch:['Dm','C','Bb','Am'],d:'Heavy unresolved descent'}],sn:['E','F#','G','A','B','C','D'],tn:['F#','C'],sf:['E','G','B'],cl:['A','D'],tp:'100–150',fl:'Fast, punchy',tx:'Hard piano, distorted synths'},
cinematic:{l:'Cinematic',p:'Epic, sweeping, vast',co:['#FFD700','#4169E1','#DC143C'],gr:'linear-gradient(135deg,#0a0a1a,#1a1540,#0a1a2d)',ks:['C major','D major'],pr:[{ch:['Am','G','F','G'],d:'Building emotional momentum'},{ch:['C','Am','F','G'],d:'Classic emotional arc'},{ch:['D','Bm','G','A'],d:'Grand, wide open'}],sn:['C','D','E','F','G','A','B'],tn:['B','F'],sf:['C','E','G'],cl:['A','D'],tp:'70–110',fl:'Sweeping, dynamic',tx:'Piano + strings, brass'},
lonely:{l:'Lonely',p:'Sparse, quiet, isolated',co:['#708090','#4682B4','#5F9EA0'],gr:'linear-gradient(135deg,#0a0a15,#151520,#0d1520)',ks:['A minor','E minor'],pr:[{ch:['Am','Em','Am','Em'],d:'Trapped in repetition'},{ch:['Em','C','Am','Em'],d:'Brief light, back to solitude'},{ch:['Dm','Am','F','C'],d:'Quiet wandering'}],sn:['A','B','C','D','E','F','G'],tn:['B','F'],sf:['A','E'],cl:['C','D'],tp:'55–75',fl:'Very slow, sparse',tx:'Solo piano, reverb'},
};

// ─── EAR TRAINING ───────────────────────────────────────────
function earGen(type){
const R=['C','D','E','F','G','A'],root=R[Math.floor(Math.random()*R.length)];
if(type==='chord-quality'){
const ts=[{t:'major',l:'Major',h:'Bright, open — the wide major 3rd creates brightness.'},{t:'minor',l:'Minor',h:'Sad, emotional — the lowered 3rd creates depth.'},{t:'dim',l:'Diminished',h:'Tense, unstable — stacked minor 3rds create anxiety.'}];
const a=ts[Math.floor(Math.random()*ts.length)];
return{q:'What quality is this chord?',pt:'chord',pd:cn(root,a.t,3),ops:ts.map(t=>t.l),ans:a.l,h:a.h};
}
if(type==='interval'){
const pool=[{s:1,n:'Minor 2nd'},{s:3,n:'Minor 3rd'},{s:4,n:'Major 3rd'},{s:5,n:'Perfect 4th'},{s:7,n:'Perfect 5th'},{s:8,n:'Minor 6th'},{s:9,n:'Major 6th'},{s:12,n:'Octave'}];
const pk=pool[Math.floor(Math.random()*pool.length)],iv=IVS.find(i=>i.s===pk.s);
const ri=NN.indexOf(root),n1=root+'3',n2=NN[(ri+pk.s)%12]+(3+Math.floor((ri+pk.s)/12));
const oth=pool.filter(p=>p.n!==pk.n).sort(()=>Math.random()-0.5).slice(0,3).map(p=>p.n);
return{q:'What interval do you hear?',pt:'melodic',pd:[n1,n2],ops:[...oth,pk.n].sort(()=>Math.random()-0.5),ans:pk.n,h:iv?iv.f:''};
}
if(type==='movement'){
const ps=[{f:'G',t:'C',a:'Resolving',h:'Tension releasing into stability'},{f:'C',t:'Am',a:'Turning inward',h:'Brightness shifting to emotion'},{f:'Am',t:'F',a:'Opening up',h:'Shadow toward warmth'},{f:'C',t:'G',a:'Building tension',h:'Moving away from home'},{f:'F',t:'C',a:'Settling home',h:'Soft landing back'}];
const p=ps[Math.floor(Math.random()*ps.length)];
const n1=cn(pc(p.f).r,pc(p.f).t,3),n2=cn(pc(p.t).r,pc(p.t).t,3);
const oth=ps.filter(x=>x.a!==p.a).sort(()=>Math.random()-0.5).slice(0,3).map(x=>x.a);
return{q:`${p.f} → ${p.t}: What does this feel like?`,pt:'two',pd:[n1,n2],ops:[...oth,p.a].sort(()=>Math.random()-0.5),ans:p.a,h:p.h};
}
}

// ─── CONTEXT TIPS ───────────────────────────────────────────
function ctip(act,d){
if(act==='add'&&d.prog){
const p=d.prog;
if(p.length===2){const v=vl(p[0],p[1]);return v.sc>=2?`${p[0]}→${p[1]} shares ${v.sc} notes. That's why it flows naturally.`:`${p[0]}→${p[1]} moves ${v.tm} steps — more movement means more dramatic energy.`;}
if(p.length===3&&p.every(c=>['minor','diminished'].includes(CT[pc(c).t]?.q)))return"Three dark chords in a row — try one major chord in the middle for contrast.";
if(p.length===4&&p[3]===p[0])return"Ending where you started creates a satisfying loop.";
}
if(act==='sel'&&d.ch){const q=CT[pc(d.ch).t]?.q;if(q==='diminished')return"Diminished chords stack minor 3rds symmetrically — that symmetry creates instability.";if(q==='dominant')return"Dominant chords contain a tritone — the most tense interval. That's why they want to resolve.";}
if(act==='play'&&d.prog?.some((c,i)=>i>0&&pc(d.prog[i-1]).t==='minor'&&pc(c).t==='major'))return"That minor→major shift is one of music's most powerful tools. Shadow to light creates hope.";
return null;
}

// ─── LESSONS ────────────────────────────────────────────────
const LES=[
{id:1,t:'Major vs Minor',b:'Major: wide 3rd = bright. Minor: lowered 3rd = emotional. One note changes everything.',ch:['C','Am'],c:'basics'},
{id:2,t:'What is Tension?',b:'Tension = unfinished. Dominant chords contain a tritone that creates maximum pull toward resolution.',ch:['G','C'],c:'basics'},
{id:3,t:'Resolution = Landing',b:'V→I is the strongest resolution. That satisfied "ahhh" when tension releases.',ch:['G','C'],c:'basics'},
{id:4,t:'Power of the 3rd',b:'The 3rd defines the mood. C major (C-E-G) → lower E to Eb → C minor. Completely different world.',ch:['C','Am'],c:'intermediate'},
{id:5,t:'Borrowed Chords',b:'Bb in C major sounds dramatic because it doesn\'t belong. Musical accent — stands out beautifully.',ch:['C','Bb'],c:'intermediate'},
{id:6,t:'Voice Leading',b:'C→Am shares 2 notes (C and E stay). Shared notes = smooth, connected movement.',ch:['C','Am'],c:'intermediate'},
{id:7,t:'The Tritone',b:'6 semitones apart — maximum instability. Appears in dominant 7ths. Engine of Western harmony.',ch:['G','C'],c:'advanced'},
{id:8,t:'Scale Degrees',b:'Each note has personality. Root=home, 5th=anchor, 7th=desperate pull. Learn these and craft melodies intentionally.',ch:['C','G'],c:'advanced'},
{id:9,t:'Cadences',b:'V→I = period. IV→I = exhale. Ending on V = question mark. Control how sections breathe.',ch:['G','C'],c:'advanced'},
];

// ─── RHYTHMS ────────────────────────────────────────────────
const RHY=[
{n:'Spacious',d:'4 bars per chord — slow, breathing',b:60,beats:8,stg:0.032},
{n:'Standard',d:'2 bars per chord — most common',b:90,beats:4,stg:0.018},
{n:'Ballad',d:'2 bars, slow tempo — expressive',b:68,beats:4,stg:0.026},
{n:'Driving',d:'1 bar per chord — forward momentum',b:116,beats:2,stg:0.010},
{n:'Half-Time',d:'4 bars, heavy — hip-hop/trap feel',b:75,beats:8,stg:0.038},
];

// ─── LAYOUT ─────────────────────────────────────────────────
function ml(ch,cx,cy,r){return ch.map((c,i)=>{const a=(i/ch.length)*Math.PI*2-Math.PI/2;return{c,x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r};});}

// ─── TENSION / MIDI / BLUEPRINT HELPERS ─────────────────────
function tensionLevel(f,t){if(!f||!t)return 0;try{const v=vl(f,t);return Math.min(5,Math.round(v.tm/2));}catch(e){return 0;}}
function midiVarLen(v){const b=[];let x=v&0x7f;v>>=7;while(v){b.unshift(0x80|(v&0x7f));v>>=7;}b.push(x);return b;}
function noteToMidi(n){const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};const m=n.match(/^([A-G][#b]?)(\d)$/);if(!m)return 60;return(M[m[1]]??0)+(parseInt(m[2])+1)*12;}
function exportMIDI(prog,bpm=90,beats=4){
  const filled=prog.filter(s=>s&&s!=='REST');if(!filled.length)return;
  const tpqn=480,beatTicks=tpqn*beats,tempo=Math.round(60000000/bpm);
  const evts=[];
  filled.forEach((s,si)=>{const ns=cn(pc(s).r,pc(s).t,4);const st=si*beatTicks,et=(si+1)*beatTicks;ns.forEach(n=>{const m=noteToMidi(n);evts.push([st,0x90,m,80],[et,0x80,m,0]);});});
  evts.sort((a,b)=>a[0]-b[0]||(a[1]===0x80?-1:1));
  let prev=0;const td=[0x00,0xFF,0x51,0x03,(tempo>>16)&0xFF,(tempo>>8)&0xFF,tempo&0xFF];
  evts.forEach(([tick,st,note,vel])=>{const d=tick-prev;prev=tick;td.push(...midiVarLen(d),st,note,vel);});
  td.push(0x00,0xFF,0x2F,0x00);const tl=td.length;
  const bytes=new Uint8Array([0x4D,0x54,0x68,0x64,0,0,0,6,0,1,0,1,(tpqn>>8)&0xFF,tpqn&0xFF,0x4D,0x54,0x72,0x6B,(tl>>24)&0xFF,(tl>>16)&0xFF,(tl>>8)&0xFF,tl&0xFF,...td]);
  const url=URL.createObjectURL(new Blob([bytes],{type:'audio/midi'}));
  const a=document.createElement('a');a.href=url;a.download='harmonymap.mid';document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function generateBlueprint(prog,k){
  const f=prog.filter(s=>s&&s!=='REST');if(f.length<4)return null;
  const ts=f.slice(1).map((c,i)=>tensionLevel(f[i],c));
  const avg=ts.reduce((a,b)=>a+b,0)/(ts.length||1);
  const mx=Math.max(...ts),mn2=Math.min(...ts);
  const arc=mx-mn2>=3?'dramatic roller-coaster arc':avg>=3?'high-tension journey':avg<=1?'smooth, flowing':'emotionally varied arc';
  const endQ=CT[pc(f[f.length-1]).t]?.q||'major';
  const endFeel=endQ==='major'?'resolves into light':endQ==='minor'?'settles into shadow':endQ==='dominant'?'ends on tension — leaves the listener wanting more':'fades into ambiguity';
  return`Your ${f.length}-chord progression traces a ${arc} — starting on ${f[0]} and moving through ${f.slice(1,-1).join(' → ')}. It ${endFeel}.`;
}
function vibeScore(prog){const f=prog.filter(s=>s&&s!=='REST');if(f.length<2)return{score:0,label:'Too short'};const tls=f.slice(1).map((c,i)=>tensionLevel(f[i],c));const avg=tls.reduce((a,b)=>a+b,0)/(tls.length||1);const spread=Math.max(...tls)-Math.min(...tls);const raw=Math.round(100-Math.abs(avg-2.2)*12-(spread>3?8:0));const score=Math.max(10,Math.min(100,raw));const label=score>=85?'Smooth Flow':score>=70?'Dynamic Groove':score>=50?'Tension Builder':'Wild Card';return{score,label};}
// ─── STYLES ─────────────────────────────────────────────────
const S={
card:(bc='rgba(255,255,255,0.06)')=>({background:'rgba(255,255,255,0.04)',borderRadius:16,padding:16,border:`1px solid ${bc}`,marginBottom:12}),
lbl:{fontSize:10,color:'rgba(255,255,255,0.35)',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:6,marginTop:0},
btn:(bg='rgba(255,255,255,0.08)',c='#fff',bc='rgba(255,255,255,0.12)')=>({background:bg,border:`1px solid ${bc}`,borderRadius:10,padding:'8px 16px',color:c,cursor:'pointer',fontSize:12,fontWeight:600,transition:'all 0.2s'}),
pill:(col,play=false)=>({display:'inline-flex',alignItems:'center',justifyContent:'center',background:col+'20',color:col,border:`1.5px solid ${col}60`,borderRadius:10,padding:'6px 14px',fontSize:15,fontWeight:700,boxShadow:play?`0 0 15px ${col}60`:'none',transform:play?'scale(1.08)':'scale(1)',transition:'all 0.2s',cursor:'pointer'}),
};

// ═════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════
export default function HarmonyMap(){
const[screen,setScreen]=useState('home');
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
const[bpm,setBpm]=useState(90);const[beats,setBeats]=useState(4);const[stg,setStg]=useState(0.018);
const[inst,setInst]=useState('underwater');
useEffect(()=>{audio.setInstrument(inst);},[inst]);
// Pre-warm AudioContext on first touch anywhere — before any button handler fires.
// This separates context creation+resume from note scheduling, solving iOS first-tap silence.
useEffect(()=>{
const warmup=()=>{audio.init();};
document.addEventListener('touchstart',warmup,{once:true,passive:true,capture:true});
return()=>document.removeEventListener('touchstart',warmup,{capture:true});
},[]);
useEffect(()=>{try{const s=localStorage.getItem('harmonymap_saved');if(s)setSaved(JSON.parse(s));const st=localStorage.getItem('harmonymap_settings');if(st){const o=JSON.parse(st);if(o.bpm)setBpm(o.bpm);if(o.beats)setBeats(o.beats);if(o.stg!=null)setStg(o.stg);if(o.sk)setSk(o.sk);if(o.inst==='underwater'||o.inst==='cinematic')setInst(o.inst);}const sk2=localStorage.getItem('harmonymap_streak');if(sk2)setStreak(JSON.parse(sk2));const xp2=localStorage.getItem('harmonymap_xp');if(xp2)setXp(parseInt(xp2)||0);const today=new Date().toISOString().slice(0,10);const dl=localStorage.getItem('harmonymap_daily');if(!dl||JSON.parse(dl).date!==today)setDailyAvail(true);}catch(e){}},[]);
useEffect(()=>{try{localStorage.setItem('harmonymap_saved',JSON.stringify(saved));}catch(e){}},[saved]);
useEffect(()=>{try{localStorage.setItem('harmonymap_streak',JSON.stringify(streak));}catch(e){}},[streak]);
useEffect(()=>{try{localStorage.setItem('harmonymap_xp',String(xp));}catch(e){}},[xp]);
const lsDeb=useRef(null);
useEffect(()=>{
  if(lsDeb.current)clearTimeout(lsDeb.current);
  lsDeb.current=setTimeout(()=>{try{localStorage.setItem('harmonymap_settings',JSON.stringify({bpm,beats,stg,sk,inst}));}catch(e){}},500);
  return()=>{if(lsDeb.current)clearTimeout(lsDeb.current);};
},[bpm,beats,stg,sk,inst]);
const swapTid=useRef(null);
const toastTid=useRef(null);
const dailyTid=useRef(null);
useEffect(()=>{if(!dailyActive)return;if(dailySecs<=0){setDailyActive(false);setDailyDone(true);setDailyAvail(false);setXp(x=>x+10);try{localStorage.setItem('harmonymap_daily',JSON.stringify({date:new Date().toISOString().slice(0,10)}));}catch(e){}return;}dailyTid.current=setInterval(()=>setDailySecs(s=>s-1),1000);return()=>clearInterval(dailyTid.current);},[dailyActive,dailySecs]);
const clearSwap=useCallback(()=>{setSwapIdx(null);if(swapTid.current){clearTimeout(swapTid.current);swapTid.current=null;}},[]);
// Ctrl+Z / Cmd+Z: revert last swap session
useEffect(()=>{const onKey=(e)=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'&&undoProg){setProg(undoProg);setUndoProg(null);clearSwap();}};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);},[undoProg,clearSwap]);
const dr=useRef([]);dr.current=disc;
const k=KEYS[sk],em=emo?EMO[emo]:null;
const ps=useMemo(()=>presets(sk),[sk]);
const bestNext=useMemo(()=>{if(!sch||!k)return[];const conns=gcon(k.ch,k.m).filter(c=>c.f===sch);const sorted=[...conns].sort((a,b)=>a.st==='strong'?-1:b.st==='strong'?1:0);return sorted.slice(0,3).map(c=>c.t);},[sch,k]);
const ghostChords=useMemo(()=>{if(!k||!sk)return[];const pName=k.m==='major'?`${k.r} minor`:`${k.r} major`;const pk=KEYS[pName];if(!pk)return[];const idxs=k.m==='major'?[3,6]:[0,3];return idxs.map(i=>({chord:pk.ch[i],fromKey:pName,idx:i})).filter(g=>g.chord&&!k.ch.includes(g.chord));},[k,sk]);

const playC=useCallback(s=>{
  if(s==='REST')return;
  const lbl=extChordLabel(k,s,ext);
  audio.playChord(cn(pc(lbl).r,pc(lbl).t,3));
  setSch(s);
  if(swapIdx!==null){
    // Swap mode: replace active slot, reset 8s inactivity timeout
    setProg(p=>{const n=[...p];n[swapIdx]=lbl;return n;});
    if(swapTid.current)clearTimeout(swapTid.current);
    swapTid.current=setTimeout(()=>setSwapIdx(null),5000);
  } else {
    // Default jam mode: play + immediately add to progression
    setProg(p=>{const n=[...p,lbl];const t=ctip('add',{prog:n});if(t)setTip(t);if(!dr.current.includes('fc')&&n.length===1)setDisc(d=>[...d,'fc']);if(!dr.current.includes('fp')&&n.length===4)setDisc(d=>[...d,'fp']);return n;});
    const t=ctip('sel',{ch:s});if(t)setTip(t);
  }
},[k,ext,swapIdx]);
const addC=useCallback(s=>{setProg(p=>{if(p.length>=16)return p;const n=[...p,s];const t=ctip('add',{prog:n});if(t)setTip(t);if(!dr.current.includes('fc')&&n.length===1)setDisc(d=>[...d,'fc']);if(!dr.current.includes('fp')&&n.length===4)setDisc(d=>[...d,'fp']);return n;});},[]);
const remC=useCallback(i=>{
  setProg(p=>p.filter((_,j)=>j!==i));
  // If the removed slot was active, deselect; if it was before active, shift index down
  setSwapIdx(cur=>{
    if(cur===null)return null;
    if(cur===i){if(swapTid.current){clearTimeout(swapTid.current);swapTid.current=null;}return null;}
    return cur>i?cur-1:cur;
  });
},[]);
const selectSlot=useCallback((i,c)=>{
  if(swapTid.current)clearTimeout(swapTid.current);
  if(swapIdx===i){setSwapIdx(null);swapTid.current=null;return;}
  // Snapshot progression for undo before any swaps happen
  setUndoProg(prog);
  setSwapIdx(i);
  swapTid.current=setTimeout(()=>setSwapIdx(null),5000);
  // Play the slot's current chord so user hears what they're replacing
  if(c!=='REST'){const lbl=extChordLabel(k,c,ext);audio.playChord(cn(pc(lbl).r,pc(lbl).t,3));}
},[swapIdx,k,ext,prog]);
const warpKey=useCallback((ghostChordBase,fromKeyName)=>{
  const pk=KEYS[fromKeyName];if(!pk)return;
  audio.playChord(cn(pc(ghostChordBase).r,pc(ghostChordBase).t,3));
  setOriginalKey(cur=>cur===null?sk:cur);
  setSk(fromKeyName);setSch(ghostChordBase);setKmf(pk.m);
  setProg(p=>[...p,ghostChordBase]);
  if(toastTid.current)clearTimeout(toastTid.current);
  setKeyToast(`Key shifted to ${fromKeyName} — tap 🏠 to return`);
  toastTid.current=setTimeout(()=>setKeyToast(null),3500);
},[sk]);
const returnHome=useCallback(()=>{
  if(!originalKey)return;const ok=KEYS[originalKey];if(!ok)return;
  setSk(originalKey);setSch(null);setKmf(ok.m);setOriginalKey(null);
  if(toastTid.current)clearTimeout(toastTid.current);
  setKeyToast(`Returned to ${originalKey}`);
  toastTid.current=setTimeout(()=>setKeyToast(null),2500);
},[originalKey]);
const playP=useCallback((bpm=72,beats=4,stg=0.018)=>{const n=prog.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3));audio.playProgression(n,bpm,i=>setPi(i),beats,stg);const t=ctip('play',{prog});if(t)setTimeout(()=>setTip(t),2000);},[prog]);
const loopP=useCallback((bpm=72,beats=4,stg=0.018)=>{const n=prog.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3));setProgLooping(true);audio.playLoop(n,bpm,i=>{setPi(i);},beats,stg);},[prog]);
const saveI=useCallback(()=>{if(!prog.length)return;setSaved(p=>[...p,{id:Date.now(),emo,k:sk,prog:[...prog],date:new Date().toLocaleDateString()}]);if(!dr.current.includes('fs'))setDisc(d=>[...d,'fs']);setXp(x=>x+2);const today=new Date().toISOString().slice(0,10);setStreak(s=>{const diff=s.lastDate?(new Date(today)-new Date(s.lastDate))/(86400000):null;const cnt=diff===1?(s.count||0)+1:diff===0?s.count||1:1;return{count:cnt,lastDate:today};});},[prog,emo,sk]);
const selEmo=useCallback(e=>{setEmo(e);if(EMO[e].ks[0])setSk(EMO[e].ks[0]);setSch(null);setScreen('emotion');},[]);
const stopAll=useCallback(()=>{audio.absoluteStop();setPa(false);setPi(-1);setPRow(-1);setProgLooping(false);},[]);
const newEar=useCallback(()=>{setEa(null);const c=earGen(et);setEc(c);if(c)setTimeout(()=>{if(c.pt==='chord')audio.playChord(c.pd);else if(c.pt==='melodic')audio.playMelodicInterval(c.pd[0],c.pd[1]);else if(c.pt==='two'){audio.playChord(c.pd[0],1.3);setTimeout(()=>audio.playChord(c.pd[1],1.3),1500);}},300);},[et]);
const replayEar=useCallback(()=>{if(!ec)return;if(ec.pt==='chord')audio.playChord(ec.pd);else if(ec.pt==='melodic')audio.playMelodicInterval(ec.pd[0],ec.pd[1]);else if(ec.pt==='two'){audio.playChord(ec.pd[0],1.3);setTimeout(()=>audio.playChord(ec.pd[1],1.3),1500);}},[ec]);
const ansEar=useCallback(a=>{if(ea)return;setEa(a);const ok=a===ec?.ans;setEs(s=>({c:s.c+(ok?1:0),t:s.t+1}));if(ok){setXp(x=>x+1);if(!dr.current.includes('fe'))setDisc(d=>[...d,'fe']);}if(dailyActive)setTimeout(()=>setEa(null)||newEar(),900);},[ec,ea,dailyActive,newEar]);

const startDaily=useCallback(()=>{setDailySecs(60);setDailyActive(true);setEa(null);setEc(null);newEar();},[newEar]);
const tabs=[{k:'home',i:'⌂',l:'Home'},{k:'chordmap',i:'◉',l:'Map'},{k:'melody',i:'♪',l:'Melody'},{k:'ear',i:'👂',l:'Ear'},{k:'intervals',i:'↕',l:'Intervals'},{k:'learn',i:'✦',l:'Learn'},{k:'mix',i:'🎚',l:'Mix'},{k:'saved',i:'♡',l:'Saved'}];

return(
<div style={{width:'100%',minHeight:'100vh',background:em?em.gr:'linear-gradient(135deg,#0a0a1a,#1a0a2e,#0a1a2d)',color:'#F0F0F0',fontFamily:"'Segoe UI','SF Pro Display',-apple-system,sans-serif",position:'relative',overflow:'hidden',transition:'background 0.8s'}}>
<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:`radial-gradient(ellipse at 30% 20%,${em?em.co[0]+'15':'#4ECDC415'} 0%,transparent 60%),radial-gradient(ellipse at 70% 80%,${em?em.co[1]+'10':'#FF6B6B10'} 0%,transparent 60%)`,pointerEvents:'none',zIndex:0}}/>

  {/* FLOATING STOP — always visible */}
  <button onClick={()=>{stopAll();}} style={{position:'fixed',bottom:76,right:14,zIndex:200,background:pa||progLooping||pi>=0||pRow>=0?'linear-gradient(135deg,#FF4444,#CC0000)':'rgba(40,40,50,0.82)',border:`1.5px solid ${pa||progLooping||pi>=0||pRow>=0?'rgba(255,80,80,0.7)':'rgba(255,255,255,0.1)'}`,borderRadius:'50%',width:44,height:44,color:pa||progLooping||pi>=0||pRow>=0?'#fff':'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:13,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:pa||progLooping||pi>=0||pRow>=0?'0 4px 18px rgba(255,60,60,0.55)':'0 2px 8px rgba(0,0,0,0.4)',animation:pa||progLooping||pi>=0||pRow>=0?'pulse 1.8s ease-in-out infinite':undefined,transition:'background 0.3s,border 0.3s,color 0.3s'}}>■</button>
  {/* KEY WARP TOAST */}
  {keyToast&&<div style={{position:'fixed',top:80,left:'50%',transform:'translateX(-50%)',background:'rgba(78,205,196,0.95)',color:'#0a0a1a',borderRadius:12,padding:'10px 20px',fontSize:12,fontWeight:700,zIndex:300,boxShadow:'0 4px 20px rgba(0,0,0,0.5)',whiteSpace:'nowrap',animation:'fadeIn 0.3s',backdropFilter:'blur(10px)'}}>{keyToast}</div>}
  {/* NAV */}
  <nav style={{position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 10px',background:'rgba(10,10,26,0.88)',backdropFilter:'blur(20px)',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
      <div style={{width:24,height:24,borderRadius:'50%',background:'linear-gradient(135deg,#FF6B6B,#4ECDC4,#C77DFF)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900}}>H</div>
      <span style={{fontWeight:700,fontSize:13}}>HarmonyMap</span>
    </div>
    <div style={{display:'flex',gap:1,overflowX:'auto',flexShrink:1,alignItems:'center'}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setScreen(t.k)} style={{background:screen===t.k?'rgba(255,255,255,0.12)':'transparent',border:'none',color:screen===t.k?'#fff':'rgba(255,255,255,0.4)',borderRadius:6,padding:'5px 7px',cursor:'pointer',fontSize:9,fontWeight:600,display:'flex',flexDirection:'column',alignItems:'center',whiteSpace:'nowrap',minHeight:44,justifyContent:'center',position:'relative'}}><span style={{fontSize:13,position:'relative'}}>{t.i}{t.k==='ear'&&dailyAvail&&!dailyDone&&<span style={{position:'absolute',top:-2,right:-3,width:6,height:6,background:'#FFB347',borderRadius:'50%',boxShadow:'0 0 5px #FFB347',display:'block'}}/>}</span><span>{t.l}</span></button>)}
      {streak.count>0&&<div style={{display:'flex',alignItems:'center',paddingLeft:5,paddingRight:3,fontSize:10,color:'rgba(255,200,100,0.75)',fontWeight:800,flexShrink:0,whiteSpace:'nowrap'}}>🔥{streak.count}</div>}
    </div>
    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,marginLeft:6}}>
      {(pa||progLooping||pi>=0||pRow>=0)&&<button onClick={stopAll} style={{background:'linear-gradient(135deg,#FF6B6B,#FF4444)',border:'1px solid rgba(255,107,107,0.6)',borderRadius:8,padding:'6px 10px',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:800,flexShrink:0,boxShadow:'0 0 12px rgba(255,107,107,0.5)',animation:'pulse 1.4s ease-in-out infinite'}}>■ Stop</button>}
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
    {screen==='home'&&<div style={{padding:'24px 16px',maxWidth:600,margin:'0 auto'}}>
      <div style={{textAlign:'center',marginBottom:20}}>
        <h1 style={{fontSize:26,fontWeight:800,margin:'0 0 8px',background:'linear-gradient(135deg,#FF6B6B,#4ECDC4,#C77DFF)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>What should your music feel like?</h1>
        <p style={{fontSize:13,color:'rgba(255,255,255,0.5)',margin:0}}>Start with a feeling. We'll find the chords, scales, and melodies.</p>
      </div>
      {/* How it works */}
      <div style={{display:'flex',gap:0,marginBottom:20,background:'rgba(255,255,255,0.03)',borderRadius:14,border:'1px solid rgba(255,255,255,0.06)',overflow:'hidden'}}>
        {[{n:'1',l:'Pick a feeling',d:'below',c:'#FF6B6B'},{n:'2',l:'Choose a progression',d:'tap Listen then Use this →',c:'#4ECDC4'},{n:'3',l:'Build your progression',d:'in the Chord Map',c:'#C77DFF'},{n:'4',l:'Add melody & mix',d:'Melody + Mix tabs',c:'#FFB347'}].map((s,i)=><div key={i} style={{flex:1,padding:'10px 6px',textAlign:'center',borderRight:i<3?'1px solid rgba(255,255,255,0.04)':'none'}}>
          <div style={{fontSize:14,fontWeight:800,color:s.c,marginBottom:2}}>{s.n}</div>
          <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.65)',lineHeight:1.3,marginBottom:1}}>{s.l}</div>
          <div style={{fontSize:8,color:'rgba(255,255,255,0.3)',lineHeight:1.3}}>{s.d}</div>
        </div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10}}>
        {Object.entries(EMO).map(([k,e])=><button key={k} onClick={()=>selEmo(k)} style={{background:e.gr,border:`1px solid ${e.co[0]}35`,borderRadius:14,padding:'18px 14px',cursor:'pointer',textAlign:'left',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',top:-15,right:-15,width:50,height:50,borderRadius:'50%',background:e.co[0]+'20',filter:'blur(15px)'}}/>
          <div style={{fontSize:20,fontWeight:800,color:e.co[0],marginBottom:3,position:'relative'}}>{e.l}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.45)',position:'relative',lineHeight:1.3}}>{e.p}</div>
        </button>)}
      </div>
      <div style={{marginTop:16,display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
        {[{k:'chordmap',l:'◉ Chord Map'},{k:'ear',l:'👂 Ear Training'},{k:'learn',l:'✦ Learn Theory'}].map(b=><button key={b.k} onClick={()=>setScreen(b.k)} style={S.btn()}>{b.l}</button>)}
      </div>
      {disc.length>0&&<div style={{...S.card(),marginTop:20}}>
        <div style={S.lbl}>Your Discoveries</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {disc.includes('fc')&&<span style={{fontSize:11,color:'#4ECDC4',background:'#4ECDC415',borderRadius:6,padding:'4px 10px'}}>First chord</span>}
          {disc.includes('fp')&&<span style={{fontSize:11,color:'#FFB347',background:'#FFB34715',borderRadius:6,padding:'4px 10px'}}>First progression</span>}
          {disc.includes('fs')&&<span style={{fontSize:11,color:'#FF6B6B',background:'#FF6B6B15',borderRadius:6,padding:'4px 10px'}}>First save</span>}
          {disc.includes('fe')&&<span style={{fontSize:11,color:'#C77DFF',background:'#C77DFF15',borderRadius:6,padding:'4px 10px'}}>Ear training win</span>}
        </div>
      </div>}
    </div>}

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
      <div style={{background:'rgba(78,205,196,0.08)',border:'1px solid rgba(78,205,196,0.2)',borderRadius:12,padding:'10px 12px',marginBottom:12,fontSize:11,color:'rgba(255,255,255,0.65)',lineHeight:1.5}}>
        <strong style={{color:'#4ECDC4'}}>How to use:</strong> Tap any chord on the map to hear it and add it to your progression. Build your sequence below, then play it back and save it.
      </div>
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
      {/* ── Chord Extension Toggle ── */}
      <div style={{display:'flex',gap:0,marginBottom:12,background:'rgba(255,255,255,0.05)',borderRadius:50,padding:3,border:'1px solid rgba(255,255,255,0.08)'}}>
        {[{v:'triad',l:'Triads'},{v:'7ths',l:'7ths'},{v:'sus2',l:'Sus2'},{v:'sus4',l:'Sus4'}].map(o=><button key={o.v} onClick={()=>setExt(o.v)} style={{flex:1,background:ext===o.v?'rgba(255,255,255,0.14)':'transparent',border:'none',borderRadius:50,padding:'8px 4px',cursor:'pointer',color:ext===o.v?'#fff':'rgba(255,255,255,0.45)',fontWeight:ext===o.v?700:500,fontSize:12,transition:'all 0.15s',boxShadow:ext===o.v?'0 1px 6px rgba(0,0,0,0.35)':'none'}}>{o.l}</button>)}
      </div>
      <div style={{background:'rgba(0,0,0,0.4)',borderRadius:22,padding:14,border:'1px solid rgba(255,255,255,0.06)'}}>
        <svg viewBox="0 0 400 400" style={{width:'100%',height:'auto'}}>
          {/* Click-away deselect for swap mode */}
          <rect x="0" y="0" width="400" height="400" fill="transparent" onClick={()=>{if(swapIdx!==null)clearSwap();}}/>
          {k&&gcon(k.ch,k.m).map((c,i)=>{const ly=ml(k.ch,200,200,140);const f=ly.find(n=>n.c===c.f),t=ly.find(n=>n.c===c.t);if(!f||!t)return null;const h=sch&&(c.f===sch||c.t===sch);const isStrong=c.st==='strong';
            return<line key={i} x1={f.x} y1={f.y} x2={t.x} y2={t.y}
              stroke={h?(isStrong?'#FFD700':cc(sch)):isStrong?'rgba(255,215,0,0.35)':'rgba(255,255,255,0.08)'}
              strokeWidth={h?(isStrong?4:2.5):isStrong?2.5:1}
              strokeDasharray={isStrong?'none':'5 5'}
              style={{transition:'all 0.3s',filter:h&&isStrong?'drop-shadow(0 0 4px #FFD700)':'none'}}/>;
          })}
          {k&&ml(k.ch,200,200,140).map((nd,ni)=>{const col=cc(nd.c),sel=sch===nd.c,extLbl=extChordLabel(k,nd.c,ext),ip=prog.includes(extLbl)||prog.includes(nd.c),fn=k.m==='minor'?FNm:FNM;const fnParts=fn[ni].split(' (');const fnName=fnParts[0];const fnRN=fnParts[1]?.slice(0,-1);const bnRank=bestNext.indexOf(nd.c);const isBestNext=bnRank!==-1;
            return<g key={ni} onClick={()=>playC(nd.c)} style={{cursor:'pointer'}}>
              {isBestNext&&<circle cx={nd.x} cy={nd.y} r={44} fill="none" stroke={col} strokeWidth={bnRank===0?3.5:2.5} strokeOpacity={bnRank===0?0.9:0.65} style={{animation:'svgRingPulse 1.4s ease-in-out infinite',animationDelay:`${bnRank*0.4}s`}}/>}
              <circle cx={nd.x} cy={nd.y} r={sel?38:30} fill={col+(sel?'18':'0a')} stroke={col+(sel?'60':'25')} strokeWidth={sel?2:1} style={{transition:'all 0.3s'}}/>
              <circle cx={nd.x} cy={nd.y} r={sel?28:23} fill={col+(sel?'30':'15')} stroke={col} strokeWidth={sel?3:1.5} style={{transition:'all 0.3s',filter:sel?`drop-shadow(0 0 12px ${col}90)`:'none'}}/>
              {ip&&<circle cx={nd.x} cy={nd.y} r={32} fill="none" stroke="#FFD700" strokeWidth={2.5} strokeDasharray="4 3"/>}
              <text x={nd.x} y={nd.y+1} textAnchor="middle" dominantBaseline="middle" fill={sel?'#fff':col} fontSize={sel?14:12} fontWeight="800" style={{pointerEvents:'none'}}>{extLbl}</text>
              <text x={nd.x} y={nd.y+(sel?47:39)} textAnchor="middle" fill="rgba(255,255,255,0.78)" fontSize="7" fontWeight="600" style={{pointerEvents:'none'}}>{fnName}</text>
              <text x={nd.x} y={nd.y+(sel?55:47)} textAnchor="middle" fill="rgba(255,215,0,0.72)" fontSize="6" style={{pointerEvents:'none'}}>{fnRN&&`(${fnRN})`}</text>
              <text x={nd.x} y={nd.y+(sel?63:55)} textAnchor="middle" fill="rgba(255,255,255,0.50)" fontSize="6" style={{pointerEvents:'none'}}>{extChordNotes(k,nd.c,ext).join('·')}</text>
            </g>;})}
          <text x="200" y="192" textAnchor="middle" fill={swapIdx!==null?'#FFD700':'rgba(255,255,255,0.35)'} fontSize="12" fontWeight="700">{sk}</text>
          <text x="200" y="208" textAnchor="middle" fill={swapIdx!==null?'rgba(255,215,0,0.6)':'rgba(255,255,255,0.22)'} fontSize="8">{swapIdx!==null?`replacing slot ${swapIdx+1}`:'Tap a chord'}</text>
        </svg>
      </div>
      {/* Ghost Chords Panel */}
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
      {/* Legend */}
      <div style={{display:'flex',gap:10,padding:'10px 4px',marginTop:4,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:7,background:'rgba(255,215,0,0.08)',border:'1px solid rgba(255,215,0,0.25)',borderRadius:8,padding:'6px 10px',flex:1}}>
          <svg width="32" height="10" style={{flexShrink:0}}><line x1="0" y1="5" x2="32" y2="5" stroke="#FFD700" strokeWidth="3.5"/></svg>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.7)',lineHeight:1.3}}><strong style={{color:'#FFD700'}}>Strong move</strong><br/>Most emotional, hits hardest</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:7,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'6px 10px',flex:1}}>
          <svg width="32" height="10" style={{flexShrink:0}}><line x1="0" y1="5" x2="32" y2="5" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="5 4"/></svg>
          <span style={{fontSize:10,color:'rgba(255,255,255,0.55)',lineHeight:1.3}}><strong style={{color:'rgba(255,255,255,0.6)'}}>Smooth move</strong><br/>Works well, softer change</span>
        </div>
      </div>
      {sch&&<div style={{...S.card(cc(sch)+'30'),marginTop:14,animation:'fadeIn 0.3s'}}>
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
            <span>Different ways to play this chord</span>
            <span style={{transform:sv?'rotate(90deg)':'none',transition:'transform 0.2s'}}>▶</span>
          </button>
          {sv&&<div style={{marginTop:8,animation:'fadeIn 0.3s'}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:8,lineHeight:1.5}}>The same chord can feel completely different depending on how you arrange the notes. Tap each version to hear it.</div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {gvoi(sch).map((v,i)=><button key={i} onClick={()=>audio.playChord(v.notes,2.0)} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${cc(sch)}20`,borderRadius:10,padding:'10px 12px',cursor:'pointer',textAlign:'left',width:'100%'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div><span style={{fontSize:12,fontWeight:700,color:cc(sch)}}>{v.n}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginLeft:8}}>{v.d}</span></div>
                  <span style={{fontSize:11,color:'rgba(255,255,255,0.25)'}}>▶</span>
                </div>
                <div style={{display:'flex',gap:4,marginTop:4}}>{v.notes.map((n,j)=><span key={j} style={{fontSize:9,color:cc(sch)+'80',background:cc(sch)+'10',borderRadius:3,padding:'1px 5px'}}>{n}</span>)}</div>
              </button>)}
            </div>
          </div>}
        </div>
      </div>}
      {/* ── Tempo + Rhythm ── */}
      <div style={{...S.card(),marginTop:14,marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{...S.lbl,marginBottom:0}}>Tempo</div>
          <div style={{fontSize:18,fontWeight:800,color:'#4ECDC4'}}>{bpm} <span style={{fontSize:10,color:'rgba(255,255,255,0.4)',fontWeight:600}}>BPM</span></div>
        </div>
        <input type="range" min="40" max="200" value={bpm} onChange={e=>setBpm(parseInt(e.target.value))} style={{width:'100%',marginBottom:10}}/>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:8,color:'rgba(255,255,255,0.3)',marginTop:-6,marginBottom:10}}><span>40</span><span>120</span><span>200</span></div>
        <div style={S.lbl}>Rhythm Feel</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{RHY.map((r,i)=><button key={i} onClick={()=>{setSr(i);setBpm(r.b);setBeats(r.beats);setStg(r.stg);if(prog.length>0)playP(r.b,r.beats,r.stg);}} style={{...S.btn(sr===i?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.04)',sr===i?'#fff':'rgba(255,255,255,0.5)'),padding:'6px 10px',fontSize:10,textAlign:'left'}}><div style={{fontWeight:700}}>{r.n}</div><div style={{fontSize:8,opacity:0.5,marginTop:1}}>{r.b} BPM · {r.beats} beats</div></button>)}</div>
        {sr!==null&&<div style={{marginTop:6,fontSize:10,color:'rgba(255,255,255,0.4)'}}>{RHY[sr].d}</div>}
        <div style={{marginTop:8,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{fontSize:9,color:'rgba(255,255,255,0.35)'}}>Beats per chord:</div>
          {[1,2,4,8].map(b=><button key={b} onClick={()=>setBeats(b)} style={{...S.btn(beats===b?'rgba(78,205,196,0.2)':'rgba(255,255,255,0.04)',beats===b?'#4ECDC4':'rgba(255,255,255,0.5)'),padding:'3px 9px',fontSize:10}}>{b}</button>)}
        </div>
      </div>
      {/* ── 16-Slot Progression Grid ── */}
      <div style={{background:'rgba(0,0,0,0.3)',borderRadius:16,padding:14,marginBottom:12,border:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={S.lbl}>Progression Grid {prog.length>0&&`${prog.length}/16`}</div>
          <div style={{display:'flex',gap:5}}>
            {prog.length>0&&<button onClick={()=>exportMIDI(prog,bpm,beats)} style={{...S.btn('rgba(78,205,196,0.12)','#4ECDC4','rgba(78,205,196,0.3)'),padding:'3px 8px',fontSize:9,fontWeight:700}}>⬇ MIDI</button>}
          </div>
        </div>
        <div style={{background:swapIdx!==null?'rgba(255,215,0,0.08)':'rgba(78,205,196,0.07)',border:`1px solid ${swapIdx!==null?'rgba(255,215,0,0.35)':'rgba(78,205,196,0.22)'}`,borderRadius:8,padding:'6px 10px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <span style={{fontSize:11,color:swapIdx!==null?'#FFD700':'rgba(78,205,196,0.9)',fontWeight:500,lineHeight:1.4}}>
            {swapIdx!==null?`✏️ Slot ${swapIdx+1} active — tap a chord on the map to swap it in`:'🎵 Tap chords on the map to fill the 16-slot grid'}
          </span>
          {swapIdx!==null&&<button onClick={clearSwap} style={{...S.btn('rgba(255,215,0,0.2)','#FFD700','rgba(255,215,0,0.5)'),padding:'3px 9px',fontSize:10,flexShrink:0}}>✓ Done</button>}
        </div>
        {/* 4×4 grid */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,marginBottom:10}}>
          {Array.from({length:16},(_,i)=>{
            const c=prog[i]||null;const isActive=swapIdx===i;const isPlaying=pi===i;
            if(!c)return<div key={i} style={{background:'rgba(255,255,255,0.03)',border:'1px dashed rgba(255,255,255,0.07)',borderRadius:10,minHeight:54,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'rgba(255,255,255,0.12)',userSelect:'none'}}>
              <span style={{fontSize:15,fontWeight:300,lineHeight:1}}>+</span><span style={{fontSize:7,marginTop:2}}>{i+1}</span>
            </div>;
            return<div key={i} style={{position:'relative'}}>
              <div onClick={()=>selectSlot(i,c)} style={{background:isActive?'rgba(255,215,0,0.18)':cc(c)+'18',border:isActive?'2px solid #FFD700':`1.5px solid ${cc(c)}45`,borderRadius:10,minHeight:54,padding:'8px 4px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',transition:'all 0.2s',animation:isActive?'swapPulse 1.2s ease-in-out infinite':undefined,boxShadow:isActive?'0 0 16px rgba(255,215,0,0.65)':isPlaying?`0 0 10px ${cc(c)}70`:'none',transform:isPlaying&&!isActive?'scale(1.05)':undefined}}>
                <div style={{fontSize:11,fontWeight:800,color:isActive?'#FFD700':cc(c),textAlign:'center',lineHeight:1.2}}>{c}</div>
                <div style={{fontSize:7,color:isActive?'rgba(255,215,0,0.55)':'rgba(255,255,255,0.25)',marginTop:2}}>{i+1}</div>
                {isActive&&<div style={{fontSize:7,color:'#FFD700',marginTop:1}}>←tap</div>}
              </div>
              <button onClick={e=>{e.stopPropagation();remC(i);}} style={{position:'absolute',top:-4,right:-4,background:'rgba(255,60,60,0.85)',border:'none',borderRadius:'50%',width:14,height:14,color:'#fff',fontSize:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2,lineHeight:1}}>×</button>
            </div>;})}
        </div>
        {/* Last move + tension meter */}
        {prog.filter(c=>c&&c!=='REST').length>=2&&(()=>{const fp=prog.filter(c=>c&&c!=='REST');const lf=fp[fp.length-2],lt=fp[fp.length-1];const m=mf(lf,lt),v=vl(lf,lt),tl=tensionLevel(lf,lt),rA=chordRN(k,lf),rB=chordRN(k,lt);return<div style={{background:'rgba(255,255,255,0.03)',borderRadius:10,padding:'8px 10px',marginBottom:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:4,flexWrap:'wrap'}}>
            <span style={{fontSize:12,fontWeight:700,color:cc(lf)}}>{lf}</span>{rA&&<span style={{fontSize:9,color:'rgba(255,215,0,0.65)'}}>({rA})</span>}
            <span style={{color:'rgba(255,255,255,0.2)',fontSize:10}}>→</span>
            <span style={{fontSize:12,fontWeight:700,color:cc(lt)}}>{lt}</span>{rB&&<span style={{fontSize:9,color:'rgba(255,215,0,0.65)'}}>({rB})</span>}
            <span style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginLeft:2}}>{m.e} {m.l}</span>
            <div style={{marginLeft:'auto',display:'flex',gap:2,alignItems:'center'}}>
              {Array.from({length:5},(_,j)=><div key={j} style={{width:5,height:10,borderRadius:1,background:j<tl?(tl>=4?'#FF6B6B':tl>=3?'#FFB347':'#4ECDC4'):'rgba(255,255,255,0.1)'}}/>)}
              <span style={{fontSize:8,color:'rgba(255,255,255,0.35)',marginLeft:3}}>{tl>=4?'Dramatic':tl>=3?'High':tl>=2?'Medium':'Smooth'}</span>
            </div>
          </div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{v.mv.map((mv,j)=><span key={j} style={{fontSize:9,color:mv.s?'#4ECDC480':'#FFB34780',background:mv.s?'#4ECDC408':'#FFB34708',borderRadius:3,padding:'1px 5px'}}>{mv.s?`${mv.f} stays`:`${mv.f}→${mv.t}`}</span>)}</div>
          {idProg(fp)&&<div style={{marginTop:4,fontSize:10,color:'#FFB347',background:'rgba(255,183,71,0.08)',borderRadius:6,padding:'4px 7px'}}>✦ {idProg(fp)}</div>}
        </div>;})()||null}
        {/* Vibe Score + Export Stats */}
        {prog.filter(c=>c&&c!=='REST').length>=4&&(()=>{const vs=vibeScore(prog);return<div style={{background:'rgba(78,205,196,0.05)',border:'1px solid rgba(78,205,196,0.18)',borderRadius:10,padding:'8px 12px',marginBottom:8,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div><div style={{fontSize:9,color:'rgba(255,255,255,0.3)',fontWeight:700,textTransform:'uppercase',letterSpacing:0.8}}>Vibe Score</div>
            <div style={{display:'flex',alignItems:'center',gap:5,marginTop:1}}><span style={{fontSize:22,fontWeight:900,color:'#4ECDC4',lineHeight:1}}>{vs.score}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.5)',fontWeight:600}}>{vs.label}</span></div>
          </div>
          <button onClick={()=>{const vs2=vibeScore(prog);const txt=[`🎵 HarmonyMap`,`Vibe: ${vs2.score}% ${vs2.label}`,`Streak: 🔥${streak.count}`,`Progression: ${prog.filter(s=>s&&s!=='REST').join(' → ')}`,`XP: ${xp}`].join('\n');try{navigator.clipboard.writeText(txt);setTip('Stats copied!');}catch(er){}}} style={{...S.btn('rgba(78,205,196,0.12)','#4ECDC4','rgba(78,205,196,0.3)'),padding:'5px 10px',fontSize:10,flexShrink:0}}>📋 Export Stats</button>
        </div>;})()||null}
        {/* Actions */}
        {prog.length>0&&<div>
          <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
            <button onClick={()=>playP(bpm,beats,stg)} style={{...S.btn('linear-gradient(135deg,#4ECDC4,#44B09E)','#fff','transparent'),border:'none'}}>▶ Play</button>
            <button onClick={progLooping?stopAll:()=>loopP(bpm,beats,stg)} style={{...S.btn(progLooping?'rgba(255,107,107,0.18)':'rgba(199,125,255,0.15)',progLooping?'#FF6B6B':'#C77DFF',progLooping?'rgba(255,107,107,0.4)':'rgba(199,125,255,0.3)')}}>{progLooping?'■ Stop':'↺ Loop'}</button>
            <button onClick={()=>addC('REST')} style={{...S.btn(),padding:'8px 10px',fontSize:11}}>𝄽 Rest</button>
            <button onClick={saveI} style={S.btn('rgba(255,215,0,0.15)','#FFD700','rgba(255,215,0,0.3)')}>♡ Save</button>
            {undoProg&&<button onClick={()=>{setProg(undoProg);setUndoProg(null);clearSwap();}} style={S.btn('rgba(78,205,196,0.12)','#4ECDC4','rgba(78,205,196,0.3)')}>↩ Undo</button>}
            <button onClick={()=>{stopAll();setProg([]);setUndoProg(null);clearSwap();setBlueprint(null);}} style={S.btn()}>Clear</button>
          </div>
          {prog.filter(c=>c&&c!=='REST').length>=4&&<div style={{marginBottom:6}}>
            {!blueprint
              ?<button onClick={()=>setBlueprint(generateBlueprint(prog,k))} style={{...S.btn('rgba(255,183,71,0.1)','#FFB347','rgba(255,183,71,0.3)'),width:'100%',fontSize:11,display:'flex',justifyContent:'center'}}>✦ Generate Beat Blueprint</button>
              :<div style={{background:'rgba(255,183,71,0.07)',border:'1px solid rgba(255,183,71,0.3)',borderRadius:10,padding:'10px 12px',fontSize:11,color:'rgba(255,255,255,0.75)',lineHeight:1.6,display:'flex',gap:8,alignItems:'flex-start',animation:'fadeIn 0.3s'}}>
                <span style={{fontSize:14,flexShrink:0}}>✦</span>
                <div style={{flex:1}}>{blueprint}</div>
                <button onClick={()=>setBlueprint(null)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:13,padding:0,flexShrink:0}}>×</button>
              </div>
            }
          </div>}
        </div>}
      </div>
      {/* ── Presets ── */}
      <div style={{marginBottom:14}}>
        <div style={S.lbl}>Presets for {sk}</div>
        {ps.map((p,i)=><button key={i} onClick={()=>setProg(p.ch)} style={{...S.card(),display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',width:'100%',textAlign:'left'}}>
          <div><span style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.7)'}}>{p.n}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginLeft:8}}>{p.f}</span></div>
          <span style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>{p.ch.join(' → ')}</span>
        </button>)}
      </div>
      {/* ── Genre Progressions ── */}
      <div style={{marginBottom:14}}>
        <div style={S.lbl}>Progressions by Genre</div>
        <p style={{fontSize:10,color:'rgba(255,255,255,0.35)',margin:'0 0 10px'}}>Pick a genre. Every progression plays at the right tempo and feel for that style.</p>
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:14}}>
          {GENRE_KEYS.map(gk=>{const g=GENRES[gk];return(
            <button key={gk} onClick={()=>setGenre(genre===gk?null:gk)} style={{background:genre===gk?g.color+'25':'rgba(255,255,255,0.04)',border:`1.5px solid ${genre===gk?g.color+'60':'rgba(255,255,255,0.08)'}`,borderRadius:10,padding:'6px 12px',cursor:'pointer',textAlign:'left',transition:'all 0.2s'}}>
              <div style={{fontSize:11,fontWeight:700,color:genre===gk?g.color:'rgba(255,255,255,0.6)'}}>{g.n}</div>
              <div style={{fontSize:8,color:'rgba(255,255,255,0.3)',marginTop:1}}>{g.tempo} BPM</div>
            </button>
          );})}
        </div>
        {genre&&GENRES[genre]&&(
          <div>
            <div style={{...S.card(GENRES[genre].color+'30'),background:GENRES[genre].color+'08'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                <div>
                  <h3 style={{fontSize:18,fontWeight:800,color:GENRES[genre].color,margin:'0 0 2px'}}>{GENRES[genre].n}</h3>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>{GENRES[genre].desc}</div>
                </div>
                <span style={{fontSize:10,color:'rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.06)',borderRadius:6,padding:'3px 8px'}}>{GENRES[genre].tempo} BPM</span>
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.5)',lineHeight:1.6,marginTop:6,background:'rgba(0,0,0,0.15)',borderRadius:8,padding:'8px 10px'}}>
                💡 {GENRES[genre].tips}
              </div>
            </div>
            {GENRES[genre].progs.map((p,pi)=>{
              const ch=k?p.g(k.ch):[];
              return(
                <div key={pi} style={S.card()}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <div><span style={{fontSize:14,fontWeight:700,color:GENRES[genre].color}}>{p.n}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginLeft:8}}>{p.d}</span></div>
                    <span style={{fontSize:9,color:'rgba(255,255,255,0.25)',background:'rgba(255,255,255,0.05)',borderRadius:4,padding:'2px 6px'}}>{p.bpm} BPM</span>
                  </div>
                  <div style={{display:'flex',gap:5,marginBottom:6,flexWrap:'wrap'}}>
                    {ch.map((c,j)=>(<span key={j} style={{fontSize:12,fontWeight:600,color:cc(c),background:cc(c)+'15',borderRadius:6,padding:'3px 8px',border:`1px solid ${cc(c)}30`}}>{c}</span>))}
                  </div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.5)',lineHeight:1.5,marginBottom:8}}>{p.w}</div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={()=>{if(ch.length){setProg(ch);setSr(null);}}} style={S.btn(GENRES[genre].color+'20',GENRES[genre].color,GENRES[genre].color+'40')}>Use this</button>
                    <button onClick={()=>{if(ch.length)audio.playProgression(ch.map(s=>genreNotes(s,genre)),p.bpm,i=>setPi(i),beats,stg);}} style={S.btn()}>▶ Play at {p.bpm}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!genre&&(<div style={{textAlign:'center',padding:'20px',color:'rgba(255,255,255,0.25)',fontSize:11}}>Select a genre above to see its signature progressions.</div>)}
      </div>
    </div>}

    {/* ═══ MELODY LAB ═══ */}
    {screen==='melody'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
      <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Melody Lab</h2>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>Everything you need to write melodies that stick and 808s that hit.</p>

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
      </div>:<div style={{...S.card(),marginBottom:14,textAlign:'center'}}><div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>Build 2+ chords in Builder to unlock Play Along.</div></div>}

      {/* Melody Sauce */}
      <div style={{...S.card('rgba(199,125,255,0.2)'),marginBottom:14}}>
        <h3 style={{fontSize:15,fontWeight:800,margin:'0 0 4px',color:'#C77DFF'}}>Melody Sauce</h3>
        <p style={{fontSize:10,color:'rgba(255,255,255,0.4)',margin:'0 0 12px',lineHeight:1.5}}>Simple rules that make melodies stick in people's heads.</p>
        {[
          {i:'🎣',t:'Keep it short and repeat it',d:'A great melody is usually just 2–4 seconds long. Play the same short idea twice before changing anything. The more you hear it, the more you like it — that\'s how hooks work.'},
          {i:'🎯',t:'Use only 5 notes',d:'Pick any key and remove the 4th and 7th notes from the scale. The 5 notes left (called the pentatonic scale) all sound good together no matter what order you play them. You literally can\'t play a wrong note.'},
          {i:'💬',t:'Ask and answer',d:'Play a short phrase that feels like a question (ends going up). Then play a phrase that feels like the answer (ends going down). This back-and-forth is in almost every hit song.'},
          {i:'🔄',t:'Say it twice, then change the ending',d:'Play your melody idea. Play it again exactly the same. On the third time, change just the last note or two. That small change is what makes people feel something.'},
          {i:'🤫',t:'Leave gaps — silence is powerful',d:'Don\'t fill every second with notes. Leave empty space in your melody. The note you play right after the silence will hit harder because of it.'},
          {i:'👑',t:'Build to your best note',d:'Every great melody has one moment that\'s the most exciting — usually the highest note. Don\'t open with it. Build up to it, let it land, then bring the melody back down.'},
          {i:'🔗',t:'Start each phrase on the chord\'s main note',d:'When a new chord starts, begin your melody phrase on that chord\'s root note (the note the chord is named after). Example: when a C chord plays, start your phrase on C. It makes everything lock together.'},
          {i:'🔥',t:'Play slightly before the beat',d:'Instead of playing notes exactly on beat 1, try playing just a tiny bit early — right before the beat drops. This is called playing "on top of" the beat and it makes melodies feel more energetic and alive.'},
        ].map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'10px 12px',marginBottom:6,display:'flex',gap:10,alignItems:'flex-start'}}>
          <span style={{fontSize:16,flexShrink:0,marginTop:1}}>{s.i}</span>
          <div><div style={{fontSize:12,fontWeight:700,color:'#C77DFF',marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.d}</div></div>
        </div>)}
      </div>

      {/* How melody creates emotion */}
      <div style={{...S.card(),marginBottom:14}}>
        <h3 style={{fontSize:13,fontWeight:700,margin:'0 0 8px'}}>How melody creates emotion</h3>
        {[
          {t:'Notes 1, 3, and 5 of your scale always feel safe and settled. Start and end your phrases on these.',i:'🏠'},
          {t:'Moving one note at a time sounds emotional and intimate. Jumping several notes at once sounds dramatic and bold.',i:'〰️'},
          {t:'Play your melody idea twice exactly the same, then change one note on the third time. That small change is where the feeling lives.',i:'🔄'},
          {t:'Hold a tense note for longer before moving to the next one. The longer you wait, the more emotional the release feels.',i:'✨'},
          {t:'The highest note in your melody is usually the most emotional moment. Everything before it is the build-up.',i:'👑'},
        ].map((m,i)=>
          <div key={i} style={{background:'rgba(0,0,0,0.15)',borderRadius:8,padding:'8px 10px',marginBottom:4,display:'flex',gap:8,alignItems:'flex-start'}}>
            <span style={{fontSize:14,flexShrink:0}}>{m.i}</span><span style={{fontSize:11,color:'rgba(255,255,255,0.6)',lineHeight:1.5}}>{m.t}</span>
          </div>)}
      </div>

      {/* Where to start */}
      <div style={{...S.card(),marginBottom:14}}>
        <h3 style={{fontSize:13,fontWeight:700,margin:'0 0 6px'}}>Where to start your melody</h3>
        <p style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:8}}>The first note you sing or play sets the entire mood. Each starting note feels different.</p>
        {[
          {n:'Note 1 (Root)',t:'Sounds grounded and confident. Like you\'re making a statement. The safest and most common starting point.',c:'#4ECDC4'},
          {n:'Note 3',t:'Immediately emotional. Starting here puts you right in the feeling of the chord — happy if major, sad if minor.',c:'#FFB347'},
          {n:'Note 5',t:'Sounds open and strong. Not as settled as note 1 but still feels good. Great for choruses that need to sound big.',c:'#87CEEB'},
          {n:'Note 6',t:'Sounds nostalgic and a little searching — like you\'re remembering something. Common in R&B and emotional pop.',c:'#C77DFF'},
          {n:'Note 7',t:'Creates instant tension. Starting here makes the listener feel like something needs to happen next. Very powerful but advanced.',c:'#FF6B6B'},
        ].map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.15)',borderRadius:8,padding:'8px 10px',marginBottom:4,display:'flex',gap:8,alignItems:'flex-start'}}><div style={{fontSize:11,fontWeight:800,color:s.c,minWidth:56,flexShrink:0,paddingTop:1}}>{s.n}</div><span style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.t}</span></div>)}
      </div>

      {/* 808 Sauce */}
      <div style={{...S.card('rgba(255,215,0,0.2)')}}>
        <h3 style={{fontSize:15,fontWeight:800,margin:'0 0 4px',color:'#FFD700'}}>808 Sauce</h3>
        <p style={{fontSize:10,color:'rgba(255,255,255,0.4)',margin:'0 0 12px',lineHeight:1.5}}>How to make 808s that hit hard and sound professional.</p>
        {[
          {i:'🎵',t:'Tune your 808 to match your song\'s key',d:'An 808 that\'s out of tune with your chords makes the whole beat sound wrong — even if everything else is perfect. In your DAW, pitch your 808 to the root note of your key. This is the most important 808 rule.'},
          {i:'🔗',t:'Match the 808 note to the chord that\'s playing',d:'When your chord progression changes, your 808 note changes too. C chord is playing → use a C 808. Am chord → use an A 808. Think of the 808 as the bass voice that follows your chords.'},
          {i:'📉',t:'Use pitch slides between notes',d:'Instead of jumping straight from one 808 note to the next, program the pitch to glide smoothly between them. This sliding sound is the signature of trap music. Try a 50–100ms slide time in your DAW.'},
          {i:'⏱️',t:'Long notes feel heavy, short notes feel bouncy',d:'Hold an 808 note for the full beat length and it sounds dark and heavy. Cut it short (half a beat or less) and it sounds punchy and bouncy. Change the lengths to match the energy you want.'},
          {i:'🥁',t:'Let the kick hit first, then the 808 comes in',d:'The kick drum and 808 compete for the same low-end space. Fix this by slightly shortening the start of your 808 so the kick\'s punch is heard first, then the 808 sustains underneath it.'},
          {i:'🔊',t:'Hit the downbeats harder',d:'Beat 1 of every bar should be your loudest 808 hit. The "between beats" notes should be quieter. This makes your pattern feel like a real performance instead of something a robot programmed.'},
          {i:'🔥',t:'Add a tiny amount of distortion',d:'A very small amount of distortion or saturation on your 808 adds grit that makes it audible on phone speakers and earbuds — which can\'t play deep bass. Without it, your 808 might disappear on smaller speakers.'},
          {i:'🎼',t:'Simple classic pattern to start with',d:'Beat 1: your root note (long) → Beat 2: same note (shorter) → Beat 3: same or 5th (medium) → Beat 4: slide into the next chord\'s root note. This pattern works in almost every hip-hop and trap beat.'},
          {i:'⚡',t:'Make the kick duck the 808 slightly',d:'Look for a "sidechain" setting on your 808 channel and link it to your kick. This makes the 808 go slightly quieter every time the kick hits, then come back up. The result is a pumping, rhythmic feel and both sounds stay clean and clear.'},
        ].map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'10px 12px',marginBottom:6,display:'flex',gap:10,alignItems:'flex-start'}}>
          <span style={{fontSize:16,flexShrink:0,marginTop:1}}>{s.i}</span>
          <div><div style={{fontSize:12,fontWeight:700,color:'#FFD700',marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.d}</div></div>
        </div>)}
      </div>
    </div>}

    {/* ═══ EAR TRAINING ═══ */}
    {screen==='ear'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
      <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Ear Training</h2>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:12}}>Train your ears to recognize chord qualities, intervals, and emotional movement by feel.</p>
      {/* Daily Drop Challenge */}
      {dailyDone?<div style={{background:'rgba(78,205,196,0.08)',border:'1px solid rgba(78,205,196,0.3)',borderRadius:12,padding:'10px 14px',marginBottom:14,fontSize:11,color:'#4ECDC4',fontWeight:600,animation:'fadeIn 0.3s'}}>✓ Daily Drop complete — +10 XP earned today!</div>
      :dailyAvail&&<div style={{background:'linear-gradient(135deg,rgba(255,183,71,0.1),rgba(255,140,40,0.06))',border:'1px solid rgba(255,183,71,0.4)',borderRadius:14,padding:'12px 14px',marginBottom:14,animation:'fadeIn 0.3s'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:dailyActive?6:0}}>
          <div>
            <div style={{fontSize:12,fontWeight:800,color:'#FFB347'}}>🎯 Daily Drop Challenge</div>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:2}}>Answer questions in 60 seconds — earn +10 XP</div>
          </div>
          {dailyActive
            ?<div style={{fontSize:20,fontWeight:900,color:dailySecs<=10?'#FF6B6B':'#FFB347',minWidth:40,textAlign:'right'}}>{dailySecs}s</div>
            :<button onClick={startDaily} style={{...S.btn('rgba(255,183,71,0.2)','#FFB347','rgba(255,183,71,0.5)'),padding:'6px 14px',fontSize:11,fontWeight:800,flexShrink:0}}>Start</button>
          }
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
      {!ec?<div style={{textAlign:'center',padding:'40px 20px'}}>
        <button onClick={newEar} style={{background:'linear-gradient(135deg,#4ECDC4,#44B09E)',border:'none',borderRadius:14,padding:'16px 32px',color:'#fff',cursor:'pointer',fontSize:16,fontWeight:700}}>Start a Challenge</button>
      </div>:
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
      {[
        {title:'Levels & Structure',color:'#4ECDC4',items:[
          {i:'🏗️',t:'Build your mix like a pyramid',d:'Your kick and 808 should be the loudest things. Then your snare or clap. Then your chords and pads. Then your melody on top. Think of it like layers — the bottom holds everything up.'},
          {i:'📏',t:'Leave breathing room at the top',d:'Keep your mix from maxing out the volume meter. If everything is already at full volume before you\'re done, you have no room to make it louder at the end. Aim for a mix that still has space above it.'},
          {i:'🔺',t:'Group your sounds into 3 layers',d:'Bottom layer: drums and 808. Middle layer: chords, pads, and rhythm sounds. Top layer: melody, lead, and vocals. Every sound belongs to one of these three layers. This keeps things organized and avoids clutter.'},
          {i:'🎚️',t:'Start every track quieter than you think',d:'Turn all your tracks down low when you first start mixing. Then bring each one up until the mix sounds balanced. Starting quiet gives you control. Starting loud means everything fights each other.'},
        ]},
        {title:'Tone Shaping (EQ)',color:'#FFB347',items:[
          {i:'✂️',t:'Take away before you add',d:'If something sounds muddy or cluttered, try removing some of the sound first instead of adding more. Taking frequencies away makes room for everything else to breathe.'},
          {i:'🎯',t:'Give every sound its own space',d:'If two sounds are clashing — like a piano and a pad — cut some of the overlapping tone from one of them. Every sound needs its own lane. When they stop fighting, everything sounds clearer.'},
          {i:'🔉',t:'Remove the low rumble from everything except bass',d:'On every track that isn\'t your kick, 808, or bass — cut out all the very low, rumbling frequencies. Those low sounds pile up and make your mix sound muddy and weak. Cleaning them out makes the whole mix punchier.'},
          {i:'💡',t:'Boosting the upper-mids makes things cut through',d:'Sounds in the middle-to-upper range of the EQ are what your ears hear most clearly. Boosting that range on a sound makes it feel closer and more present. Cutting it makes a sound sit further back in the mix.'},
        ]},
        {title:'Volume Control (Compression)',color:'#C77DFF',items:[
          {i:'🎛️',t:'Compression keeps loud moments from spiking',d:'When a sound suddenly gets too loud for a split second, a compressor automatically turns it down just a tiny bit, then lets it back up. This makes the sound feel more even and controlled without changing the vibe.'},
          {i:'⚡',t:'Make the kick and 808 work together',d:'Set up your 808 so that every time the kick hits, the 808 briefly gets a tiny bit quieter. This stops them from crashing into each other. The result is a clean, hard-hitting low end where both sounds punch through clearly.'},
          {i:'🔗',t:'Glue your whole mix together at the end',d:'Add a very light compressor to your master channel — the final channel that controls the entire mix. Use gentle settings. This makes all your sounds feel like they belong together instead of sitting separately.'},
        ]},
        {title:'Width & Space',color:'#87CEEB',items:[
          {i:'↔️',t:'Keep bass sounds in the center',d:'Your 808 and bass should always play from the center of the stereo field. If you spread them too wide, they disappear when the track plays on a phone or mono speaker. Everything else can be spread out wide.'},
          {i:'🌊',t:'Use reverb to put sounds in a room',d:'Add a little reverb to your snare to give it a sense of space. Add medium reverb to chords and pads to make them feel big. Keep your kick and 808 dry with no reverb — they need to hit hard without washing out.'},
          {i:'📍',t:'Pan sounds left and right to create width',d:'Your kick, snare, 808, and main melody should sit in the center. Everything else — hi-hats, extra layers, background chords — can be spread to the left and right. This makes the mix feel wide and cinematic.'},
        ]},
        {title:'Making It Loud',color:'#FF6B6B',items:[
          {i:'📊',t:'Streaming platforms turn your music down automatically',d:'Spotify, Apple Music, and YouTube all automatically lower loud tracks to match the volume of quieter tracks. So making your mix extremely loud before uploading doesn\'t help. Focus on making it sound good, not just loud.'},
          {i:'🔒',t:'Add a limiter as your very last step',d:'A limiter is a plugin you put at the very end of your master channel. It stops your mix from ever going above a set volume. This is what makes your track sound loud without distorting. Push it until you gain a good amount of volume but stop before it starts sounding crushed.'},
          {i:'🎧',t:'Use a reference track to check yourself',d:'Take a song you love that sounds similar to what you\'re making. Put it in your project and listen to it next to your mix. Switch back and forth. Try to match the energy and tone of the reference. This is the fastest way to hear what\'s wrong with your mix.'},
          {i:'📱',t:'Test your mix on multiple speakers',d:'Before you call a mix done, listen to it on your studio headphones, your laptop speakers, your phone speaker, and in your car. If it sounds good on all of them, it\'s ready. Phone speakers are the toughest test — they can\'t play much bass, so if your mix sounds hollow there, check your low end.'},
          {i:'🔵',t:'Check your mix in mono',d:'Most DAWs have a button to collapse your mix into mono (one speaker instead of two). Listen like this. If something disappears or sounds weird, two sounds are canceling each other out. Try moving them apart in the stereo field or lowering one slightly.'},
        ]},
      ].map((section,si)=>(
        <div key={si} style={{marginBottom:18}}>
          <div style={{fontSize:10,fontWeight:800,color:section.color,textTransform:'uppercase',letterSpacing:1.5,marginBottom:8,paddingLeft:2}}>{section.title}</div>
          {section.items.map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'10px 12px',marginBottom:6,display:'flex',gap:10,alignItems:'flex-start',border:`1px solid ${section.color}15`}}>
            <span style={{fontSize:16,flexShrink:0,marginTop:1}}>{s.i}</span>
            <div><div style={{fontSize:12,fontWeight:700,color:section.color,marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.d}</div></div>
          </div>)}
        </div>
      ))}
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
        <div style={{display:'flex',gap:3,flexWrap:'wrap',marginBottom:6}}>{idea.prog.slice(1).map((c,i)=>{if(c==='REST'||idea.prog[i]==='REST')return null;const m=mf(idea.prog[i],c);return<span key={i} style={{fontSize:8,color:'rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.04)',borderRadius:3,padding:'1px 5px'}}>{m.e} {m.l}</span>;})}</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>{audio.playProgression(idea.prog.map(s=>s==='REST'?null:cn(pc(s).r,pc(s).t,3)),bpm,i=>{setPi(i);setPRow(-1);});}} style={S.btn()}>▶ Play</button>
          <button onClick={()=>{setProg(idea.prog);setSk(idea.k||sk);setSch(null);setScreen('chordmap');}} style={S.btn()}>Edit →</button>
          <button onClick={()=>{const e=idea.emo?EMO[idea.emo]:null;const t=[`🎵 HarmonyMap Sketch`,`${e?e.l+' — '+e.p:'Free exploration'}`,`Key: ${idea.k}`,`${idea.prog.join(' → ')}`,idea.date].join('\n');try{navigator.clipboard.writeText(t);setTip('Copied to clipboard!');}catch(e){}}} style={S.btn()}>📋 Copy</button>
        </div>
      </div>;})}
    </div>}

  </main>
  {/* SOUND TRAY */}
  <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:90,background:'rgba(8,8,20,0.94)',backdropFilter:'blur(22px)',borderTop:'1px solid rgba(255,255,255,0.08)',padding:'6px 10px',display:'flex',alignItems:'center',gap:8}}>
    <span style={{fontSize:9,color:'rgba(255,255,255,0.3)',fontWeight:700,textTransform:'uppercase',letterSpacing:0.8,flexShrink:0}}>Sound</span>
    <div style={{display:'flex',background:'rgba(255,255,255,0.06)',borderRadius:50,padding:2,border:'1px solid rgba(255,255,255,0.1)'}}>
      {[{v:'underwater',l:'🌊',d:'R&B'},{v:'cinematic',l:'🎬',d:'Trap'}].map(o=><button key={o.v} onClick={()=>setInst(o.v)} style={{background:inst===o.v?'rgba(78,205,196,0.22)':'transparent',border:'none',borderRadius:50,padding:'6px 9px',cursor:'pointer',color:inst===o.v?'#4ECDC4':'rgba(255,255,255,0.4)',fontWeight:inst===o.v?700:500,fontSize:10,transition:'all 0.15s',display:'flex',alignItems:'center',gap:3,whiteSpace:'nowrap'}}>
        <span>{o.l}</span><span>{o.d}</span>
      </button>)}
    </div>
    <div style={{display:'flex',gap:4,alignItems:'center'}}>
      {[{v:'808sub',l:'🎸',t:'808',xpReq:25},{v:'rhodes',l:'🎹',t:'Rhodes',xpReq:50},{v:'midpad',l:'🌙',t:'Pad',xpReq:100}].map(o=>{const unlocked=xp>=o.xpReq;return<button key={o.v} onClick={()=>{if(unlocked)setInst(o.v);}} style={{background:inst===o.v&&unlocked?'rgba(199,125,255,0.2)':'rgba(255,255,255,0.04)',border:`1px solid ${inst===o.v&&unlocked?'rgba(199,125,255,0.45)':'rgba(255,255,255,0.08)'}`,borderRadius:8,padding:'5px 7px',cursor:unlocked?'pointer':'default',color:unlocked?(inst===o.v?'#C77DFF':'rgba(255,255,255,0.55)'):'rgba(255,255,255,0.2)',fontSize:10,display:'flex',flexDirection:'column',alignItems:'center',gap:1,opacity:unlocked?1:0.6,flexShrink:0}}>
        <span style={{fontSize:12}}>{unlocked?o.l:'🔒'}</span>
        <span style={{fontSize:7,lineHeight:1}}>{unlocked?o.t:`${o.xpReq}xp`}</span>
      </button>;})}
    </div>
    <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
      <div style={{fontSize:9,color:'rgba(199,125,255,0.7)',fontWeight:700}}>{xp}<span style={{fontSize:7,color:'rgba(255,255,255,0.25)',marginLeft:1}}>xp</span></div>
      <div style={{fontSize:11,fontWeight:700,color:'#4ECDC4',minWidth:40,textAlign:'right'}}>{bpm}<span style={{fontSize:8,color:'rgba(255,255,255,0.3)',fontWeight:500,marginLeft:2}}>bpm</span></div>
    </div>
  </div>
  <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{box-shadow:0 0 12px rgba(255,107,107,0.5)}50%{box-shadow:0 0 22px rgba(255,107,107,0.9)}}@keyframes swapPulse{0%,100%{box-shadow:0 0 22px rgba(255,215,0,0.9),0 0 44px rgba(255,215,0,0.35)}50%{box-shadow:0 0 32px rgba(255,215,0,1),0 0 60px rgba(255,215,0,0.55)}}@keyframes svgRingPulse{0%,100%{stroke-opacity:0.45}50%{stroke-opacity:1}}button:hover{filter:brightness(1.1)}button:active{transform:scale(0.97)!important}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}input[type=range]{-webkit-appearance:none;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;outline:none}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;background:#4ECDC4;border-radius:50%;cursor:pointer;box-shadow:0 0 8px rgba(78,205,196,0.5)}input[type=range]::-moz-range-thumb{width:18px;height:18px;background:#4ECDC4;border-radius:50%;cursor:pointer;border:none}`}</style>
</div>
);
}
