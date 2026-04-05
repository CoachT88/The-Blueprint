import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════
HARMONYMAP v4 — "Find Yourself in Sound"
Complete emotion-driven music theory app for beginners
═══════════════════════════════════════════════════════════════ */

// ─── AUDIO ENGINE ───────────────────────────────────────────
class AudioEngine {
constructor() { this.ctx=null; this.mg=null; this.rv=null; this.isPlaying=false; this.tids=[]; }
init() {
if(this.ctx) return;
this.ctx=new(window.AudioContext||window.webkitAudioContext)();
this.mg=this.ctx.createGain(); this.mg.gain.value=0.26;
const comp=this.ctx.createDynamicsCompressor();
comp.threshold.value=-20;comp.knee.value=10;comp.ratio.value=3;comp.attack.value=0.005;comp.release.value=0.15;
const d=this.ctx.createDelay(1.0); d.delayTime.value=0.12;
const f=this.ctx.createGain(); f.gain.value=0.2;
const d2=this.ctx.createDelay(1.0); d2.delayTime.value=0.07;
const f2=this.ctx.createGain(); f2.gain.value=0.12;
d.connect(f); f.connect(d); d.connect(comp);
d2.connect(f2); f2.connect(d2); d2.connect(comp);
f.connect(comp); f2.connect(comp);
this.rv=d; this.rv2=d2; this.mg.connect(comp); comp.connect(this.ctx.destination);
}
noteToFreq(n) {
const M={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
const m=n.match(/^([A-G][#b]?)(\d)$/); if(!m) return 440;
return 440*Math.pow(2,(M[m[1]]-9+(parseInt(m[2])-4)*12)/12);
}
playNote(n,dur=1.2,vel=0.5,st=null) {
this.init(); const fr=typeof n==='number'?n:this.noteToFreq(n); const t=st||this.ctx.currentTime;
const o1=this.ctx.createOscillator(),o2=this.ctx.createOscillator(),o3=this.ctx.createOscillator();
const g=this.ctx.createGain(),g3=this.ctx.createGain(),fl=this.ctx.createBiquadFilter();
o1.type='triangle'; o1.frequency.value=fr; o1.detune.value=-4;
o2.type='sine'; o2.frequency.value=fr; o2.detune.value=4;
o3.type='sawtooth'; o3.frequency.value=fr*2; g3.gain.value=0.06;
fl.type='lowpass'; fl.frequency.setValueAtTime(3500+vel*3000,t); fl.frequency.exponentialRampToValueAtTime(900,t+dur*0.4); fl.Q.value=0.7;
g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vel*0.42,t+0.01); g.gain.exponentialRampToValueAtTime(vel*0.15,t+0.2); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
o3.connect(g3); g3.connect(fl); o1.connect(fl); o2.connect(fl); fl.connect(g);
g.connect(this.mg); g.connect(this.rv); g.connect(this.rv2);
o1.start(t); o2.start(t); o3.start(t); o1.stop(t+dur+0.15); o2.stop(t+dur+0.15); o3.stop(t+dur+0.15);
}
playChord(notes,dur=1.5,stg=0.018) { this.init(); const t=this.ctx.currentTime; notes.forEach((n,i)=>this.playNote(n,dur,0.35,t+i*stg)); }
playInterval(a,b,dur=1.8) { this.init(); const t=this.ctx.currentTime; this.playNote(a,dur,0.4,t); this.playNote(b,dur,0.4,t+0.01); }
playMelodicInterval(a,b,dur=0.8) { this.init(); const t=this.ctx.currentTime; this.playNote(a,dur,0.45,t); this.playNote(b,dur,0.45,t+dur*0.7); }
playProgression(cl,bpm=72,cb) {
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*4;
cl.forEach((n,i)=>{ const t=setTimeout(()=>{if(!this.isPlaying)return; this.playChord(n,d*0.88); if(cb)cb(i);},i*d*1000); this.tids.push(t); });
this.tids.push(setTimeout(()=>{this.isPlaying=false; if(cb)cb(-1);},cl.length*d*1000));
}
playLoop(cl,bpm=72,cb) {
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*4; const tot=cl.length*d*1000;
const go=()=>{ if(!this.isPlaying) return;
cl.forEach((n,i)=>{ this.tids.push(setTimeout(()=>{if(!this.isPlaying)return; this.playChord(n,d*0.88); if(cb)cb(i);},i*d*1000)); });
this.tids.push(setTimeout(()=>{if(this.isPlaying)go();},tot));
}; go();
}
stop() { this.isPlaying=false; this.tids.forEach(t=>clearTimeout(t)); this.tids=[]; }
play808(n,dur=2.0,vel=0.85,st=null){
this.init(); const base=typeof n==='number'?n:this.noteToFreq((typeof n==='string'&&!/\d/.test(n))?n+'2':n); const t=st||this.ctx.currentTime;
const o=this.ctx.createOscillator(),g=this.ctx.createGain(),lp=this.ctx.createBiquadFilter();
o.type='sine'; o.frequency.setValueAtTime(base*2.5,t); o.frequency.exponentialRampToValueAtTime(base,t+0.06);
lp.type='lowpass'; lp.frequency.value=180; lp.Q.value=0.5;
g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vel*0.95,t+0.008); g.gain.exponentialRampToValueAtTime(vel*0.5,t+0.25); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
o.connect(lp); lp.connect(g); g.connect(this.mg);
o.start(t); o.stop(t+dur+0.1);
}
playMelody(notes,bpm=100,cb){
this.init(); this.stop(); this.isPlaying=true; const d=(60/bpm)*0.5;
notes.forEach((n,i)=>{ const t=setTimeout(()=>{if(!this.isPlaying)return; this.playNote(n+'4',d*0.75,0.5); if(cb)cb(i);},i*d*1000); this.tids.push(t); });
this.tids.push(setTimeout(()=>{this.isPlaying=false; if(cb)cb(-1);},notes.length*d*1000));
}
}
const audio=new AudioEngine();
function genreNotes(sym,genre){const{r,t}=pc(sym);const oct=(genre==='trap'||genre==='hiphop')?2:3;if((genre==='90s-rnb'||genre==='rnb'||genre==='lofi')&&CT[t]){const rt=t==='major'?'maj7':t==='minor'?'min7':t==='dominant'?'dom7':t;return cn(r,CT[rt]?rt:t,oct);}return cn(r,t,oct);}

// ─── MUSIC DATA ─────────────────────────────────────────────
const NN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FN=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const CT={
major:{iv:[0,4,7],q:'major'},minor:{iv:[0,3,7],q:'minor'},dim:{iv:[0,3,6],q:'diminished'},
aug:{iv:[0,4,8],q:'augmented'},dom7:{iv:[0,4,7,10],q:'dominant'},maj7:{iv:[0,4,7,11],q:'major'},
min7:{iv:[0,3,7,10],q:'minor'},sus2:{iv:[0,2,7],q:'suspended'},sus4:{iv:[0,5,7],q:'suspended'},add9:{iv:[0,4,7,14],q:'major'},
};
function cn(root,type,oct=4){const ri=NN.indexOf(root)!==-1?NN.indexOf(root):FN.indexOf(root);if(ri===-1)return[];const d=CT[type];if(!d)return[];return d.iv.map(v=>{const ni=(ri+v)%12;return NN[ni]+(oct+Math.floor((ri+v)/12));});}
function pc(sym){const m=sym.match(/^([A-G][#b]?)(m7|maj7|add9|sus2|sus4|°|\+|m|7)?$/);if(!m)return{r:'C',t:'major'};const M={'':'major',m:'minor','°':'dim','+':'aug','7':'dom7',maj7:'maj7',m7:'min7',sus2:'sus2',sus4:'sus4',add9:'add9'};return{r:m[1],t:M[m[2]||'']||'major'};}
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
'F major':{r:'F',m:'major',ch:['F','Gm','Am','Bb','C','Dm','E°'],sc:['F','G','A','Bb','C','D','E']},
'A minor':{r:'A',m:'minor',ch:['Am','B°','C','Dm','Em','F','G'],sc:['A','B','C','D','E','F','G']},
'E minor':{r:'E',m:'minor',ch:['Em','F#°','G','Am','Bm','C','D'],sc:['E','F#','G','A','B','C','D']},
'D minor':{r:'D',m:'minor',ch:['Dm','E°','F','Gm','Am','Bb','C'],sc:['D','E','F','G','A','Bb','C']},
};
const FNM=['Home (I)','Step (ii)','Color (iii)','Open (IV)','Tension (V)','Emotional (vi)','Edge (vii°)'];
const FNm=['Home (i)','Edge (ii°)','Relative (III)','Shadow (iv)','Pull (v)','Warmth (VI)','Gateway (VII)'];
function gcon(ch){if(!ch||ch.length<7)return[];return[[0,3],[0,4],[0,5],[1,4],[1,6],[2,5],[2,3],[3,0],[3,4],[3,1],[4,0],[4,5],[5,3],[5,1],[5,2],[6,0],[6,4]].map(([a,b])=>({f:ch[a],t:ch[b],st:(a===4&&b===0)||(a===3&&b===0)?'strong':'normal'}));}

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
function gvoi(sym){const{r,t}=pc(sym);const ri=NN.indexOf(r)!==-1?NN.indexOf(r):FN.indexOf(r);if(ri===-1)return[];const iv=CT[t]?.iv||[0,4,7];
return[
{n:'Root position',d:'Standard, clear',notes:iv.map(v=>NN[(ri+v)%12]+(4+Math.floor((ri+v)/12)))},
{n:'1st inversion',d:'Smoother bass',notes:[NN[(ri+iv[1])%12]+'3',...iv.filter((_,i)=>i!==1).map(v=>NN[(ri+v)%12]+(4+Math.floor((ri+v)/12)))]},
{n:'Open voicing',d:'Spacious, cinematic',notes:[NN[ri]+'3',NN[(ri+(iv[2]||7))%12]+'3',NN[(ri+(iv[1]||4))%12]+'4']},
{n:'High voicing',d:'Bright, airy',notes:iv.map(v=>NN[(ri+v)%12]+(5+Math.floor((ri+v)/12)))},
];
}

// ─── CHORD EMOTIONS ─────────────────────────────────────────
const CE={'C':{f:'Bright, pure',r:'Home base'},'Dm':{f:'Melancholy',r:'Pulls inward'},'Em':{f:'Cool, quiet',r:'Contemplation'},'F':{f:'Open, warm',r:'Expands sound'},'G':{f:'Bright, driving',r:'Pushes forward'},'Am':{f:'Sad, deep',r:'Emotional heart'},'Bm':{f:'Dark, serious',r:'Adds weight'},'D':{f:'Warm, confident',r:'Lifts clearly'},'E':{f:'Tense, powerful',r:'Strong pull'},'A':{f:'Bright, joyful',r:'Open confidence'},'Bb':{f:'Dramatic',r:'Cinematic color'},'B°':{f:'Tense, unstable',r:'Creates urgency'},'F#°':{f:'Sharp tension',r:'Drives forward'},'Gm':{f:'Moody',r:'Shadow depth'},'F#m':{f:'Somber',r:'Deeper sadness'},'C#m':{f:'Haunting',r:'Cold beauty'}};

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
const RHY=[{n:'Whole Notes',d:'Spacious',b:65},{n:'Steady',d:'Quarter-note drive',b:95},{n:'Ballad',d:'Gentle push-pull',b:72},{n:'Driving',d:'Eighth-note energy',b:110},{n:'Heavy',d:'Half notes, slow',b:55}];

// ─── LAYOUT ─────────────────────────────────────────────────
function ml(ch,cx,cy,r){return ch.map((c,i)=>{const a=(i/ch.length)*Math.PI*2-Math.PI/2;return{c,x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r};});}

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
const[ec,setEc]=useState(null);
const[ea,setEa]=useState(null);
const[es,setEs]=useState({c:0,t:0});
const[et,setEt]=useState('chord-quality');
const[disc,setDisc]=useState([]);
const[pa,setPa]=useState(false);
const[nh,setNh]=useState([]);
const[sv,setSv]=useState(false);
const[genre,setGenre]=useState(null);
const[mp,setMp]=useState(false);
const dr=useRef([]);dr.current=disc;
const k=KEYS[sk],em=emo?EMO[emo]:null;
const ps=useMemo(()=>presets(sk),[sk]);

const playC=useCallback(s=>{audio.playChord(cn(pc(s).r,pc(s).t,3));setSch(s);const t=ctip('sel',{ch:s});if(t)setTip(t);},[]);
const addC=useCallback(s=>{setProg(p=>{const n=[...p,s];const t=ctip('add',{prog:n});if(t)setTip(t);if(!dr.current.includes('fc')&&n.length===1)setDisc(d=>[...d,'fc']);if(!dr.current.includes('fp')&&n.length===4)setDisc(d=>[...d,'fp']);return n;});},[]);
const remC=useCallback(i=>{setProg(p=>p.filter((_,j)=>j!==i));},[]);
const playP=useCallback((bpm=72)=>{const n=prog.map(s=>cn(pc(s).r,pc(s).t,3));audio.playProgression(n,bpm,i=>setPi(i));const t=ctip('play',{prog});if(t)setTimeout(()=>setTip(t),2000);},[prog]);
const saveI=useCallback(()=>{if(!prog.length)return;setSaved(p=>[...p,{id:Date.now(),emo,k:sk,prog:[...prog],date:new Date().toLocaleDateString()}]);if(!dr.current.includes('fs'))setDisc(d=>[...d,'fs']);},[prog,emo,sk]);
const playM=useCallback(n=>{audio.playNote(n+'4',0.8,0.5);setMn(n);setNh(p=>[...p.slice(-31),{n,t:Date.now()}]);setTimeout(()=>setMn(null),500);},[]);
const selEmo=useCallback(e=>{setEmo(e);if(EMO[e].ks[0])setSk(EMO[e].ks[0]);setScreen('emotion');},[]);
const playMelodyBack=useCallback(()=>{if(!nh.length)return;audio.playMelody(nh.map(e=>e.n),100,i=>setMp(i>=0));},[nh]);
const newEar=useCallback(()=>{setEa(null);const c=earGen(et);setEc(c);if(c)setTimeout(()=>{if(c.pt==='chord')audio.playChord(c.pd);else if(c.pt==='melodic')audio.playMelodicInterval(c.pd[0],c.pd[1]);else if(c.pt==='two'){audio.playChord(c.pd[0],1.3);setTimeout(()=>audio.playChord(c.pd[1],1.3),1500);}},300);},[et]);
const replayEar=useCallback(()=>{if(!ec)return;if(ec.pt==='chord')audio.playChord(ec.pd);else if(ec.pt==='melodic')audio.playMelodicInterval(ec.pd[0],ec.pd[1]);else if(ec.pt==='two'){audio.playChord(ec.pd[0],1.3);setTimeout(()=>audio.playChord(ec.pd[1],1.3),1500);}},[ec]);
const ansEar=useCallback(a=>{if(ea)return;setEa(a);setEs(s=>({c:s.c+(a===ec?.ans?1:0),t:s.t+1}));if(a===ec?.ans&&!dr.current.includes('fe'))setDisc(d=>[...d,'fe']);},[ec,ea]);

const tabs=[{k:'home',i:'⌂',l:'Home'},{k:'chordmap',i:'◉',l:'Map'},{k:'builder',i:'♫',l:'Build'},{k:'melody',i:'♪',l:'Melody'},{k:'ear',i:'👂',l:'Ear'},{k:'intervals',i:'↕',l:'Intervals'},{k:'learn',i:'✦',l:'Learn'},{k:'saved',i:'♡',l:'Saved'}];

return(
<div style={{width:'100%',minHeight:'100vh',background:em?em.gr:'linear-gradient(135deg,#0a0a1a,#1a0a2e,#0a1a2d)',color:'#F0F0F0',fontFamily:"'Segoe UI','SF Pro Display',-apple-system,sans-serif",position:'relative',overflow:'hidden',transition:'background 0.8s'}}>
<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:`radial-gradient(ellipse at 30% 20%,${em?em.co[0]+'15':'#4ECDC415'} 0%,transparent 60%),radial-gradient(ellipse at 70% 80%,${em?em.co[1]+'10':'#FF6B6B10'} 0%,transparent 60%)`,pointerEvents:'none',zIndex:0}}/>

  {/* NAV */}
  <nav style={{position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 10px',background:'rgba(10,10,26,0.88)',backdropFilter:'blur(20px)',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
      <div style={{width:24,height:24,borderRadius:'50%',background:'linear-gradient(135deg,#FF6B6B,#4ECDC4,#C77DFF)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:900}}>H</div>
      <span style={{fontWeight:700,fontSize:13}}>HarmonyMap</span>
    </div>
    <div style={{display:'flex',gap:1,overflowX:'auto',flexShrink:1}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setScreen(t.k)} style={{background:screen===t.k?'rgba(255,255,255,0.12)':'transparent',border:'none',color:screen===t.k?'#fff':'rgba(255,255,255,0.4)',borderRadius:6,padding:'3px 6px',cursor:'pointer',fontSize:9,fontWeight:600,display:'flex',flexDirection:'column',alignItems:'center',whiteSpace:'nowrap'}}><span style={{fontSize:12}}>{t.i}</span><span>{t.l}</span></button>)}
    </div>
  </nav>

  {/* CONTEXT TIP */}
  {tip&&<div style={{position:'relative',zIndex:50,margin:'8px 12px 0',background:'rgba(78,205,196,0.1)',border:'1px solid rgba(78,205,196,0.25)',borderRadius:12,padding:'12px 14px',display:'flex',gap:10,alignItems:'flex-start',animation:'fadeIn 0.3s'}}>
    <span style={{fontSize:16,flexShrink:0}}>💡</span>
    <div style={{flex:1,fontSize:12,color:'rgba(255,255,255,0.75)',lineHeight:1.6}}>{tip}</div>
    <button onClick={()=>setTip(null)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:14,padding:0}}>×</button>
  </div>}

  <main style={{position:'relative',zIndex:1,paddingBottom:60}}>

    {/* ═══ HOME ═══ */}
    {screen==='home'&&<div style={{padding:'24px 16px',maxWidth:600,margin:'0 auto'}}>
      <div style={{textAlign:'center',marginBottom:28}}>
        <h1 style={{fontSize:26,fontWeight:800,margin:'0 0 8px',background:'linear-gradient(135deg,#FF6B6B,#4ECDC4,#C77DFF)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>What should your music feel like?</h1>
        <p style={{fontSize:13,color:'rgba(255,255,255,0.5)',margin:0}}>Start with a feeling. We'll find the chords, scales, and melodies.</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10}}>
        {Object.entries(EMO).map(([k,e])=><button key={k} onClick={()=>selEmo(k)} style={{background:e.gr,border:`1px solid ${e.co[0]}35`,borderRadius:14,padding:'18px 14px',cursor:'pointer',textAlign:'left',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',top:-15,right:-15,width:50,height:50,borderRadius:'50%',background:e.co[0]+'20',filter:'blur(15px)'}}/>
          <div style={{fontSize:20,fontWeight:800,color:e.co[0],marginBottom:3,position:'relative'}}>{e.l}</div>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.45)',position:'relative',lineHeight:1.3}}>{e.p}</div>
        </button>)}
      </div>
      <div style={{marginTop:20,display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
        {[{k:'chordmap',l:'◉ Map'},{k:'ear',l:'👂 Ear Training'},{k:'intervals',l:'↕ Intervals'},{k:'learn',l:'✦ Learn'}].map(b=><button key={b.k} onClick={()=>setScreen(b.k)} style={S.btn()}>{b.l}</button>)}
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
          {[{l:'Keys',v:em.ks.join(', ')},{l:'Tempo',v:em.tp+' BPM'},{l:'Feel',v:em.fl},{l:'Textures',v:em.tx}].map(i=><div key={i.l} style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:'9px 11px'}}><div style={{...S.lbl,fontSize:9,marginBottom:3}}>{i.l}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.75)',lineHeight:1.4}}>{i.v}</div></div>)}
        </div>
      </div>
      {em.pr.map((p,ri)=><div key={ri} style={{...S.card(),cursor:'pointer'}} onClick={()=>{audio.playProgression(p.ch.map(s=>cn(pc(s).r,pc(s).t,3)),72,idx=>{setPi(idx);setPRow(idx===-1?-1:ri);});}}>
        <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>{p.ch.map((c,j)=><span key={j} style={S.pill(cc(c),pRow===ri&&pi===j)}>{c}{j<p.ch.length-1&&<span style={{marginLeft:6,color:'rgba(255,255,255,0.25)'}}>→</span>}</span>)}</div>
        <p style={{fontSize:11,color:'rgba(255,255,255,0.5)',margin:'0 0 6px',lineHeight:1.4}}>{p.d}</p>
        <div style={{display:'flex',gap:6}}>
          <button onClick={e=>{e.stopPropagation();setProg(p.ch);setScreen('builder');}} style={S.btn(em.co[0]+'25',em.co[0],em.co[0]+'40')}>Use this →</button>
          <button onClick={e=>{e.stopPropagation();audio.playProgression(p.ch.map(s=>cn(pc(s).r,pc(s).t,3)),72,idx=>{setPi(idx);setPRow(idx===-1?-1:ri);});}} style={S.btn()}>▶ Listen</button>
        </div>
      </div>)}
      <div style={S.card()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{fontSize:13,fontWeight:700,margin:0}}>Melody notes</h3>
          <button onClick={()=>setSd(!sd)} style={{...S.btn(),fontSize:10,padding:'4px 10px'}}>{sd?'Roles':'Degrees'}</button>
        </div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
          {em.sn.map((n,ni)=>{const iS=em.sf.includes(n),iT=em.tn.includes(n),iC=em.cl.includes(n);const bg=iS?'#4ECDC430':iT?'#FF6B6B30':iC?'#FFB34730':'rgba(255,255,255,0.06)';const bc=iS?'#4ECDC4':iT?'#FF6B6B':iC?'#FFB347':'rgba(255,255,255,0.2)';const tc=iS?'#4ECDC4':iT?'#FF6B6B':iC?'#FFB347':'#fff';const dg=(k?.m==='minor'?Dm:DM)[ni];
            return <button key={n} onClick={()=>playM(n)} style={{background:bg,border:`1.5px solid ${bc}60`,borderRadius:10,padding:'8px 12px',color:tc,cursor:'pointer',fontSize:14,fontWeight:700,textAlign:'center',minWidth:42,boxShadow:mn===n?`0 0 15px ${bc}50`:'none',transform:mn===n?'scale(1.08)':'scale(1)',transition:'all 0.15s'}}><div>{n}</div><div style={{fontSize:7,opacity:0.65,marginTop:2}}>{sd?(dg?.d||''):(iS?'safe':iT?'tension':iC?'color':'')}</div></button>;})}
        </div>
        <div style={{display:'flex',gap:10,marginTop:8}}><span style={{fontSize:9,color:'#4ECDC4'}}>● Safe</span><span style={{fontSize:9,color:'#FFB347'}}>● Color</span><span style={{fontSize:9,color:'#FF6B6B'}}>● Tension</span></div>
      </div>
    </div>}

    {/* ═══ CHORD MAP ═══ */}
    {screen==='chordmap'&&<div style={{padding:'14px',maxWidth:600,margin:'0 auto'}}>
      <div style={{marginBottom:12}}>
        <div style={S.lbl}>Current Key</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{Object.keys(KEYS).map(kk=><button key={kk} onClick={()=>{setSk(kk);setSch(null);}} style={{...S.btn(sk===kk?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.04)',sk===kk?'#fff':'rgba(255,255,255,0.45)'),padding:'5px 10px',fontSize:11}}>{kk}</button>)}</div>
      </div>
      <div style={{background:'rgba(0,0,0,0.4)',borderRadius:22,padding:14,border:'1px solid rgba(255,255,255,0.06)'}}>
        <svg viewBox="0 0 400 400" style={{width:'100%',height:'auto'}}>
          {k&&gcon(k.ch).map((c,i)=>{const ly=ml(k.ch,200,200,140);const f=ly.find(n=>n.c===c.f),t=ly.find(n=>n.c===c.t);if(!f||!t)return null;const h=sch&&(c.f===sch||c.t===sch);return<line key={i} x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke={h?cc(sch):'rgba(255,255,255,0.07)'} strokeWidth={h?(c.st==='strong'?3:2):1} strokeDasharray={c.st==='strong'?'none':'4 4'} style={{transition:'all 0.3s'}}/>;
          })}
          {k&&ml(k.ch,200,200,140).map((nd,ni)=>{const col=cc(nd.c),sel=sch===nd.c,ip=prog.includes(nd.c),fn=k.m==='minor'?FNm:FNM;
            return<g key={ni} onClick={()=>playC(nd.c)} style={{cursor:'pointer'}}>
              <circle cx={nd.x} cy={nd.y} r={sel?36:28} fill={col+(sel?'15':'08')} stroke={col+(sel?'50':'20')} strokeWidth={sel?2:1} style={{transition:'all 0.3s'}}/>
              <circle cx={nd.x} cy={nd.y} r={sel?26:22} fill={col+(sel?'28':'12')} stroke={col} strokeWidth={sel?2.5:1.5} style={{transition:'all 0.3s',filter:sel?`drop-shadow(0 0 10px ${col}80)`:'none'}}/>
              {ip&&<circle cx={nd.x} cy={nd.y} r={30} fill="none" stroke="#FFD700" strokeWidth={2} strokeDasharray="4 3"/>}
              <text x={nd.x} y={nd.y+1} textAnchor="middle" dominantBaseline="middle" fill={sel?'#fff':col} fontSize={sel?15:13} fontWeight="800" style={{pointerEvents:'none'}}>{nd.c}</text>
              <text x={nd.x} y={nd.y+(sel?48:40)} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8" fontWeight="600" style={{pointerEvents:'none'}}>{fn[ni]}</text>
            </g>;})}
          <text x="200" y="192" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="12" fontWeight="700">{sk}</text>
          <text x="200" y="208" textAnchor="middle" fill="rgba(255,255,255,0.12)" fontSize="8">Tap to explore</text>
        </svg>
      </div>
      <div style={{display:'flex',gap:16,justifyContent:'center',padding:'8px 0',marginTop:6}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <svg width="28" height="8" style={{flexShrink:0}}><line x1="0" y1="4" x2="28" y2="4" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5"/></svg>
          <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>Strong pull (V→I, IV→I)</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <svg width="28" height="8" style={{flexShrink:0}}><line x1="0" y1="4" x2="28" y2="4" stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeDasharray="4 4"/></svg>
          <span style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>Common flow</span>
        </div>
      </div>
      {sch&&<div style={{...S.card(cc(sch)+'30'),marginTop:14,animation:'fadeIn 0.3s'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
          <div>
            <h3 style={{fontSize:26,fontWeight:800,color:cc(sch),margin:'0 0 2px'}}>{sch}</h3>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{ql(sch)} · {(k?.m==='minor'?FNm:FNM)[k?.ch.indexOf(sch)]||'Borrowed'}</div>
          </div>
          <button onClick={()=>addC(sch)} style={S.btn(cc(sch)+'25',cc(sch),cc(sch)+'50')}>+ Add</button>
        </div>
        <div style={{marginBottom:10}}><div style={{...S.lbl,marginBottom:4}}>Notes</div><div style={{display:'flex',gap:5}}>{cn(pc(sch).r,pc(sch).t,4).map((n,i)=><span key={i} style={{background:cc(sch)+'12',border:`1px solid ${cc(sch)}25`,borderRadius:6,padding:'3px 9px',fontSize:12,fontWeight:600,color:cc(sch)}}>{n.replace(/\d/,'')}</span>)}</div></div>
        {CE[sch]&&<div style={{background:'rgba(255,255,255,0.03)',borderRadius:10,padding:10,marginBottom:10}}><div style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.75)',marginBottom:3}}>Feels: {CE[sch].f}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.4)',lineHeight:1.4}}>{CE[sch].r}</div></div>}
        <div style={S.lbl}>Where it goes next</div>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {k&&gcon(k.ch).filter(c=>c.f===sch).map((c,i)=>{const m=mf(c.f,c.t),v=vl(c.f,c.t);return<button key={i} onClick={()=>playC(c.t)} style={{background:'rgba(255,255,255,0.04)',border:`1px solid ${cc(c.t)}25`,borderRadius:10,padding:'10px 12px',cursor:'pointer',textAlign:'left',width:'100%'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><span style={{fontSize:14,fontWeight:700,color:cc(c.t)}}>{c.t}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginLeft:8}}>{m.e} {m.l}</span></div>
              <span style={{fontSize:9,color:'rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.05)',borderRadius:4,padding:'2px 6px'}}>{v.sc} shared · {v.sm.toLowerCase()}</span>
            </div>
            <div style={{display:'flex',gap:4,marginTop:5}}>{v.mv.map((m,j)=><span key={j} style={{fontSize:9,color:m.s?'#4ECDC480':'#FFB34780'}}>{m.f}{m.s?'=':'→'}{m.t}</span>)}</div>
          </button>;})}
        </div>
        <div style={{marginTop:12}}>
          <button onClick={()=>setSv(!sv)} style={{...S.btn('rgba(255,255,255,0.05)','rgba(255,255,255,0.6)','rgba(255,255,255,0.1)'),width:'100%',fontSize:11,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>Voicing Explorer — same chord, different texture</span>
            <span style={{transform:sv?'rotate(90deg)':'none',transition:'transform 0.2s'}}>▶</span>
          </button>
          {sv&&<div style={{marginTop:8,animation:'fadeIn 0.3s'}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:8,lineHeight:1.5}}>Same notes arranged differently = completely different feel. Tap each to hear.</div>
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
    </div>}

    {/* ═══ BUILDER ═══ */}
    {screen==='builder'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
      <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Progression Builder</h2>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>Build, hear, and understand your progression. Voice leading shown live.</p>
      <div style={{background:'rgba(0,0,0,0.3)',borderRadius:16,padding:14,marginBottom:16,minHeight:70,border:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={S.lbl}>Your Progression {prog.length>0&&`(${prog.length})`}</div>
        {prog.length===0?<div style={{color:'rgba(255,255,255,0.2)',fontSize:12,textAlign:'center',padding:'14px 0'}}>Tap chords below to start</div>:
        <div>
          <div style={{display:'flex',gap:7,flexWrap:'wrap',alignItems:'center'}}>
            {prog.map((c,i)=><div key={i} style={{position:'relative'}}>
              <div style={{...S.pill(cc(c),pi===i),padding:'10px 16px',fontSize:16}} onClick={()=>playC(c)}>{c}</div>
              <button onClick={()=>remC(i)} style={{position:'absolute',top:-5,right:-5,background:'rgba(255,60,60,0.8)',border:'none',borderRadius:'50%',width:16,height:16,color:'#fff',fontSize:9,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
            </div>)}
          </div>
          {prog.length>=2&&<div style={{marginTop:12,background:'rgba(255,255,255,0.03)',borderRadius:10,padding:10}}>
            <div style={{...S.lbl,marginBottom:6}}>Movement analysis</div>
            {prog.slice(1).map((c,i)=>{const m=mf(prog[i],c),v=vl(prog[i],c);return<div key={i} style={{marginBottom:4}}>
              <span style={{fontSize:11,color:'rgba(255,255,255,0.6)'}}><span style={{color:cc(prog[i])}}>{prog[i]}</span><span style={{color:'rgba(255,255,255,0.2)',margin:'0 4px'}}>→</span><span style={{color:cc(c)}}>{c}</span><span style={{marginLeft:6,fontSize:10,color:'rgba(255,255,255,0.35)'}}>{m.e} {m.l} · {v.sm}</span></span>
              <div style={{display:'flex',gap:6,marginTop:2}}>{v.mv.map((m,j)=><span key={j} style={{fontSize:9,color:m.s?'#4ECDC480':'#FFB34780'}}>{m.f}{m.s?'=':'→'}{m.t}</span>)}</div>
            </div>;})}
          </div>}
          <div style={{display:'flex',gap:7,marginTop:12,flexWrap:'wrap'}}>
            <button onClick={()=>playP(sr!==null?RHY[sr].b:72)} style={{...S.btn('linear-gradient(135deg,#4ECDC4,#44B09E)','#fff','transparent'),border:'none'}}>▶ Play</button>
            <button onClick={saveI} style={S.btn('rgba(255,215,0,0.15)','#FFD700','rgba(255,215,0,0.3)')}>♡ Save</button>
            <button onClick={()=>setProg([])} style={S.btn()}>Clear</button>
          </div>
        </div>}
      </div>
      <div style={{...S.card(),marginBottom:14}}>
        <div style={S.lbl}>Rhythm Feel</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{RHY.map((r,i)=><button key={i} onClick={()=>{setSr(i);if(prog.length>0)playP(r.b);}} style={{...S.btn(sr===i?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.04)',sr===i?'#fff':'rgba(255,255,255,0.5)'),padding:'6px 10px',fontSize:10,textAlign:'left'}}><div style={{fontWeight:700}}>{r.n}</div><div style={{fontSize:8,opacity:0.5,marginTop:1}}>{r.b} BPM</div></button>)}</div>
        {sr!==null&&<div style={{marginTop:6,fontSize:10,color:'rgba(255,255,255,0.4)'}}>{RHY[sr].d}</div>}
      </div>
      <div style={{marginBottom:14}}>
        <div style={S.lbl}>Chords in {sk}</div>
        <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>{k?.ch.map((c,i)=><button key={i} onClick={()=>addC(c)} style={{background:cc(c)+'12',border:`1.5px solid ${cc(c)}45`,borderRadius:11,padding:'10px 14px',cursor:'pointer',fontSize:15,fontWeight:700,color:cc(c)}}>{c}</button>)}</div>
      </div>
      <div style={{marginBottom:14}}><div style={S.lbl}>Change Key</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{Object.keys(KEYS).map(kk=><button key={kk} onClick={()=>{setSk(kk);setProg([]);}} style={{...S.btn(sk===kk?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.04)',sk===kk?'#fff':'rgba(255,255,255,0.4)'),padding:'4px 9px',fontSize:10}}>{kk}</button>)}</div>
      </div>
      <div style={{marginBottom:14}}><div style={S.lbl}>Presets for {sk}</div>
        {ps.map((p,i)=><button key={i} onClick={()=>setProg(p.ch)} style={{...S.card(),display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',width:'100%',textAlign:'left'}}>
          <div><span style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.7)'}}>{p.n}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginLeft:8}}>{p.f}</span></div>
          <span style={{fontSize:11,color:'rgba(255,255,255,0.3)'}}>{p.ch.join(' → ')}</span>
        </button>)}
      </div>
      <div>
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
                <div key={pi} style={{...S.card(),cursor:'pointer'}} onClick={()=>{if(ch.length){setProg(ch);audio.playProgression(ch.map(s=>genreNotes(s,genre)),p.bpm,i=>setPi(i));}}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <div><span style={{fontSize:14,fontWeight:700,color:GENRES[genre].color}}>{p.n}</span><span style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginLeft:8}}>{p.d}</span></div>
                    <span style={{fontSize:9,color:'rgba(255,255,255,0.25)',background:'rgba(255,255,255,0.05)',borderRadius:4,padding:'2px 6px'}}>{p.bpm} BPM</span>
                  </div>
                  <div style={{display:'flex',gap:5,marginBottom:6,flexWrap:'wrap'}}>
                    {ch.map((c,j)=>(<span key={j} style={{fontSize:12,fontWeight:600,color:cc(c),background:cc(c)+'15',borderRadius:6,padding:'3px 8px',border:`1px solid ${cc(c)}30`}}>{c}</span>))}
                  </div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.5)',lineHeight:1.5}}>{p.w}</div>
                  <div style={{display:'flex',gap:6,marginTop:8}}>
                    <button onClick={e=>{e.stopPropagation();if(ch.length){setProg(ch);setSr(null);}}} style={S.btn(GENRES[genre].color+'20',GENRES[genre].color,GENRES[genre].color+'40')}>Use this</button>
                    <button onClick={e=>{e.stopPropagation();if(ch.length)audio.playProgression(ch.map(s=>genreNotes(s,genre)),p.bpm,i=>setPi(i));}} style={S.btn()}>▶ Play at {p.bpm}</button>
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
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>Tap notes to hear. Play Along loops your progression underneath.</p>
      {prog.length>=2?<div style={{...S.card(pa?'#4ECDC440':'rgba(255,255,255,0.06)'),marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{fontSize:14,fontWeight:700,margin:'0 0 2px',color:pa?'#4ECDC4':'#fff'}}>{pa?'● Playing Along':'Play Along'}</h3>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{pa?'Progression looping — tap notes to improvise!':'Loop your chords and play melody on top.'}</div>
          </div>
          <button onClick={()=>{if(pa){audio.stop();setPa(false);setPi(-1);}else{setPa(true);audio.playLoop(prog.map(s=>cn(pc(s).r,pc(s).t,3)),sr!==null?RHY[sr].b:72,idx=>{setPi(idx);setPRow(idx===-1?-1:ri);});}}} style={{...S.btn(pa?'#FF6B6B25':'#4ECDC425',pa?'#FF6B6B':'#4ECDC4',pa?'#FF6B6B50':'#4ECDC450'),fontSize:13,fontWeight:700,padding:'10px 20px'}}>{pa?'■ Stop':'▶ Start Loop'}</button>
        </div>
        {pa&&<div style={{display:'flex',gap:5,marginTop:10,flexWrap:'wrap'}}>{prog.map((c,i)=><span key={i} style={{...S.pill(cc(c),pi===i),fontSize:13,padding:'5px 12px'}}>{c}</span>)}</div>}
      </div>:<div style={{...S.card(),marginBottom:14,textAlign:'center'}}><div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>Build 2+ chords in Builder to unlock Play Along.</div></div>}
      <div style={{...S.card(),marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={S.lbl}>{sk}</div>
          <button onClick={()=>setSd(!sd)} style={{...S.btn(),fontSize:10,padding:'4px 10px'}}>{sd?'Hide degrees':'Show degrees'}</button>
        </div>
        <div style={{display:'flex',gap:4,justifyContent:'center'}}>
          {(k?.sc||['C','D','E','F','G','A','B']).map((n,ni)=>{const ed=em||EMO.hopeful;const iS=ed.sf.includes(n),iT=ed.tn.includes(n),iC=ed.cl.includes(n);const bg=iS?'#4ECDC435':iT?'#FF6B6B35':iC?'#FFB34735':'rgba(255,255,255,0.06)';const bc=iS?'#4ECDC4':iT?'#FF6B6B':iC?'#FFB347':'rgba(255,255,255,0.15)';const tc=iS?'#4ECDC4':iT?'#FF6B6B':iC?'#FFB347':'rgba(255,255,255,0.5)';const dg=(k?.m==='minor'?Dm:DM)[ni];
            return<button key={n} onClick={()=>playM(n)} style={{width:42,height:62,background:bg,border:`1.5px solid ${bc}50`,borderRadius:10,cursor:'pointer',color:tc,fontSize:15,fontWeight:700,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,boxShadow:mn===n?`0 0 16px ${bc}50`:'none',transform:mn===n?'scale(1.06)':'scale(1)',transition:'all 0.15s'}}>{n}<span style={{fontSize:7,opacity:0.6}}>{sd?(dg?.d||''):(iS?'safe':iT?'tension':iC?'color':'')}</span></button>;})}
        </div>
        {sd&&<div style={{marginTop:10,background:'rgba(0,0,0,0.2)',borderRadius:10,padding:10}}><div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Scale Degree Character</div>
          {(k?.m==='minor'?Dm:DM).map((d,i)=><div key={i} style={{display:'flex',gap:8,alignItems:'baseline',marginBottom:4}}><span style={{color:dc(d.st),fontWeight:800,fontSize:14,minWidth:16}}>{d.d}</span><span style={{fontSize:10,color:dc(d.st),fontWeight:600}}>{d.n} </span><span style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>{d.f}</span></div>)}
        </div>}
        <div style={{display:'flex',gap:10,marginTop:8}}><span style={{fontSize:9,color:'#4ECDC4'}}>● Safe</span><span style={{fontSize:9,color:'#FFB347'}}>● Color</span><span style={{fontSize:9,color:'#FF6B6B'}}>● Tension</span></div>
      </div>
      {nh.length>0&&<div style={{...S.card(),marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><div style={S.lbl}>Your melody so far</div><div style={{display:'flex',gap:4}}><button onClick={playMelodyBack} style={{...S.btn('rgba(78,205,196,0.12)','#4ECDC4','rgba(78,205,196,0.3)'),fontSize:9,padding:'3px 8px'}}>▶ Play back</button><button onClick={()=>setNh([])} style={{...S.btn(),fontSize:9,padding:'3px 8px'}}>Clear</button></div></div>
        <div style={{display:'flex',gap:2,flexWrap:'wrap',alignItems:'flex-end',minHeight:44}}>
          {nh.map((e,i)=>{const ed=em||EMO.hopeful;const sn=k?.sc||['C','D','E','F','G','A','B'];const ni=sn.indexOf(e.n);const h=ni>=0?14+ni*5:24;const iS=ed.sf.includes(e.n),iT=ed.tn.includes(e.n),iC=ed.cl.includes(e.n);const col=iS?'#4ECDC4':iT?'#FF6B6B':iC?'#FFB347':'rgba(255,255,255,0.4)';
            return<div key={i} style={{width:8,height:h,background:col+'80',borderRadius:3,boxShadow:i===nh.length-1?`0 0 6px ${col}`:'none'}} title={e.n}/>;
          })}
        </div>
        <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:6}}>{nh.length} notes · {nh.length>=8?'Look for repeating shapes — that\'s melody forming.':'Keep tapping to see patterns.'}</div>
      </div>}
      <div style={S.card()}>
        <h3 style={{fontSize:13,fontWeight:700,margin:'0 0 8px'}}>Compare: how one note changes everything</h3>
        {[{a:{n:'C major',no:['C4','E4','G4']},b:{n:'C minor',no:['C4','D#4','G4']},d:'The 3rd flips the emotional identity'},{a:{n:'Am',no:['A3','C4','E4']},b:{n:'A major',no:['A3','C#4','E4']},d:'Minor to major — introspection to clarity'},{a:{n:'G',no:['G3','B3','D4']},b:{n:'G7',no:['G3','B3','D4','F4']},d:'Dominant 7th adds tension demanding resolution'}].map((c,i)=>
          <div key={i} style={{background:'rgba(0,0,0,0.2)',borderRadius:12,padding:12,marginBottom:8}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:6,lineHeight:1.4}}>{c.d}</div>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>audio.playChord(c.a.no)} style={{flex:1,...S.btn('#4ECDC418','#4ECDC4','#4ECDC440'),fontSize:13,fontWeight:700}}>▶ {c.a.n}</button>
              <button onClick={()=>audio.playChord(c.b.no)} style={{flex:1,...S.btn('#FF6B6B18','#FF6B6B','#FF6B6B40'),fontSize:13,fontWeight:700}}>▶ {c.b.n}</button>
            </div>
          </div>)}
      </div>
      <div style={S.card()}>
        <h3 style={{fontSize:13,fontWeight:700,margin:'0 0 8px'}}>How melody creates emotion</h3>
        {[{t:'Safe notes (1, 3, 5) feel like home. Start and end phrases on them.',i:'🏠'},{t:'The 7th creates maximum pull. Use it to build anticipation.',i:'🧲'},{t:'Small steps = emotional. Big leaps = dramatic.',i:'🎭'},{t:'Repeat, then change one note. Tiny variation = huge weight.',i:'🔄'},{t:'Let tension notes linger before resolving — that delay creates ache.',i:'✨'}].map((m,i)=>
          <div key={i} style={{background:'rgba(0,0,0,0.15)',borderRadius:8,padding:'8px 10px',marginBottom:4,display:'flex',gap:8,alignItems:'flex-start'}}>
            <span style={{fontSize:14,flexShrink:0}}>{m.i}</span><span style={{fontSize:11,color:'rgba(255,255,255,0.6)',lineHeight:1.5}}>{m.t}</span>
          </div>)}
      </div>
      <div style={S.card()}>
        <h3 style={{fontSize:13,fontWeight:700,margin:'0 0 6px'}}>Where to start your melody</h3>
        <p style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:8}}>You don't have to start on the root. Each starting note signals something different.</p>
        {[{n:'Root (1)',t:'Grounded, declarative — states exactly where you are. Classic opener.',c:'#4ECDC4'},{n:'3rd',t:'Emotional entry — immediately into the feeling, no setup needed.',c:'#FFB347'},{n:'5th',t:'Confident and open — strong hook note that feels both resolved and interesting.',c:'#87CEEB'},{n:'6th',t:'Nostalgic, questioning — often used in melodies that feel like memories.',c:'#C77DFF'},{n:'7th',t:'Maximum tension as an opener — creates immediate pull toward resolution.',c:'#FF6B6B'}].map((s,i)=><div key={i} style={{background:'rgba(0,0,0,0.15)',borderRadius:8,padding:'8px 10px',marginBottom:4,display:'flex',gap:8,alignItems:'baseline'}}><span style={{fontSize:12,fontWeight:800,color:s.c,minWidth:32,flexShrink:0}}>{s.n}</span><span style={{fontSize:11,color:'rgba(255,255,255,0.55)',lineHeight:1.5}}>{s.t}</span></div>)}
      </div>
      <div style={S.card()}>
        <h3 style={{fontSize:13,fontWeight:700,margin:'0 0 4px'}}>Bass & 808</h3>
        <p style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:10}}>Low-end is the foundation. Tap to hear 808-style bass notes.</p>
        <div style={S.lbl}>808 Scale Notes</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
          {(k?.sc||['C','D','E','F','G','A','B']).map(n=><button key={n} onClick={()=>audio.play808(n,1.8)} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,width:44,height:44,cursor:'pointer',color:'rgba(255,255,255,0.7)',fontSize:14,fontWeight:700,padding:0}}>{n}</button>)}
        </div>
        {prog.length>0&&<div style={{marginBottom:10}}>
          <div style={S.lbl}>808 Your Progression Roots</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            {prog.map((c,i)=>{const r=pc(c).r;return<button key={i} onClick={()=>audio.play808(r,2.2)} style={{background:cc(c)+'12',border:`1.5px solid ${cc(c)}45`,borderRadius:10,padding:'8px 14px',cursor:'pointer',color:cc(c),fontWeight:700,fontSize:13}}>{r}</button>;})}
          </div>
        </div>}
        <div style={{background:'rgba(0,0,0,0.2)',borderRadius:10,padding:10}}>
          <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:6}}>Bass strategies</div>
          {[{t:'Root only',d:'Hit the root of each chord on the downbeat. Most solid approach.'},{t:'Root + 5th',d:'Root on beat 1, 5th on beat 3. Adds motion without losing stability.'},{t:'Octave jump',d:'Play root low, jump to octave above. Creates energy and bounce.'},{t:'808 slide',d:'Start higher, glide down to root. Trap and modern R&B signature.'}].map((s,i)=><div key={i} style={{marginBottom:5,fontSize:10,color:'rgba(255,255,255,0.45)',lineHeight:1.5}}><span style={{color:'rgba(255,255,255,0.65)',fontWeight:600}}>{s.t}: </span>{s.d}</div>)}
        </div>
      </div>
    </div>}

    {/* ═══ EAR TRAINING ═══ */}
    {screen==='ear'&&<div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
      <h2 style={{fontSize:20,fontWeight:800,marginBottom:3}}>Ear Training</h2>
      <p style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:16}}>Train your ears to recognize chord qualities, intervals, and emotional movement by feel.</p>
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
      {LES.map(ls=><div key={ls.id} style={{...S.card(al===ls.id?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.06)'),cursor:'pointer'}} onClick={()=>setAl(al===ls.id?null:ls.id)}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:9,color:'rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.06)',borderRadius:4,padding:'2px 6px',textTransform:'capitalize'}}>{ls.c}</span><h4 style={{fontSize:14,fontWeight:700,margin:0}}>{ls.t}</h4></div>
          <span style={{fontSize:11,color:'rgba(255,255,255,0.2)',transform:al===ls.id?'rotate(90deg)':'none',transition:'transform 0.2s'}}>▶</span>
        </div>
        {al===ls.id&&<div style={{marginTop:10,animation:'fadeIn 0.3s'}}>
          <p style={{fontSize:12,color:'rgba(255,255,255,0.6)',lineHeight:1.7,margin:'0 0 12px'}}>{ls.b}</p>
          <div style={{display:'flex',gap:6}}>{ls.ch.map((c,i)=><button key={i} onClick={e=>{e.stopPropagation();playC(c);}} style={{background:cc(c)+'18',border:`1.5px solid ${cc(c)}45`,borderRadius:10,padding:'8px 16px',cursor:'pointer',color:cc(c),fontSize:15,fontWeight:700}}>▶ {c}</button>)}</div>
        </div>}
      </div>)}
      <div style={{marginTop:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:10}}>Theory Translator</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
          {[{t:'Tonic',p:'Home chord'},{t:'Dominant',p:'Tension chord'},{t:'Resolution',p:'Landing after tension'},{t:'Dissonance',p:'Notes pulling apart'},{t:'Cadence',p:'How phrases rest'},{t:'Voice Leading',p:'Smooth note movement'},{t:'Scale Degree',p:'Note\'s emotional role'},{t:'Tritone',p:'Max tension interval'}].map(i=><div key={i.t} style={{background:'rgba(255,255,255,0.03)',borderRadius:9,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.04)'}}><div style={{fontSize:12,fontWeight:700,color:'#C77DFF',marginBottom:2}}>{i.t}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.45)',lineHeight:1.4}}>{i.p}</div></div>)}
        </div>
      </div>
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
        <div style={{display:'flex',gap:3,flexWrap:'wrap',marginBottom:6}}>{idea.prog.slice(1).map((c,i)=>{const m=mf(idea.prog[i],c);return<span key={i} style={{fontSize:8,color:'rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.04)',borderRadius:3,padding:'1px 5px'}}>{m.e} {m.l}</span>;})}</div>
        <div style={{display:'flex',gap:6}}>
          <button onClick={()=>{audio.playProgression(idea.prog.map(s=>cn(pc(s).r,pc(s).t,3)),72,idx=>{setPi(idx);setPRow(idx===-1?-1:ri);});}} style={S.btn()}>▶ Play</button>
          <button onClick={()=>{setProg(idea.prog);setSk(idea.k||sk);setScreen('builder');}} style={S.btn()}>Edit →</button>
          <button onClick={()=>{const e=idea.emo?EMO[idea.emo]:null;const t=[`🎵 HarmonyMap Sketch`,`${e?e.l+' — '+e.p:'Free exploration'}`,`Key: ${idea.k}`,`${idea.prog.join(' → ')}`,idea.date].join('\n');try{navigator.clipboard.writeText(t);setTip('Copied to clipboard!');}catch(e){}}} style={S.btn()}>📋 Copy</button>
        </div>
      </div>;})}
    </div>}

  </main>
  <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}button:hover{filter:brightness(1.1)}button:active{transform:scale(0.97)!important}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:3px}`}</style>
</div>
);
}
