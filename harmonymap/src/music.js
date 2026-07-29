// ─── MUSIC DATA & PURE FUNCTIONS ─────────────────────────────
// Extracted from HarmonyMap.jsx for testability. Behavior-neutral.

export const NN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const FN = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
export const ENH = { Cb:'B', Fb:'E', 'E#':'F', 'B#':'C' };
export const CT = {
  major:{iv:[0,4,7],q:'major'},
  minor:{iv:[0,3,7],q:'minor'},
  dim:{iv:[0,3,6],q:'diminished'},
  aug:{iv:[0,4,8],q:'augmented'},
  dom7:{iv:[0,4,7,10],q:'dominant'},
  maj7:{iv:[0,4,7,11],q:'major'},
  min7:{iv:[0,3,7,10],q:'minor'},
  'm7b5':{iv:[0,3,6,10],q:'diminished'},
  sus2:{iv:[0,2,7],q:'suspended'},
  sus4:{iv:[0,5,7],q:'suspended'},
  power:{iv:[0,7],q:'power'}
};

export function cn(root, type, oct = 4) {
  const r = ENH[root] || root;
  const ri = NN.indexOf(r) !== -1 ? NN.indexOf(r) : FN.indexOf(r);
  if (ri === -1) return [];
  const d = CT[type];
  if (!d) return [];
  return d.iv.map(v => {
    const ni = (ri + v) % 12;
    return NN[ni] + (oct + Math.floor((ri + v) / 12));
  });
}

export function pc(sym) {
  if (!sym) return { r:'C', t:'major' };
  const m = sym.match(/^([A-G][#b]?)(m7b5|m7|maj7|sus2|sus4|°|m|7|5)?$/);
  if (!m) return { r:'C', t:'major' };
  const M = { '':'major', m:'minor', '°':'dim', '7':'dom7', maj7:'maj7', m7:'min7', m7b5:'m7b5', sus2:'sus2', sus4:'sus4', '5':'power' };
  return { r: m[1], t: M[m[2] || ''] || 'major' };
}

export function cc(s) {
  const q = CT[pc(s).t]?.q;
  return { major:'#FF6B9D', minor:'#4FD1C7', diminished:'#C77DFF', dominant:'#FF9500', suspended:'#5EEAD4', power:'#94A3B8' }[q] || '#fff';
}

export const KEYS = {
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
  'Bb minor':{r:'Bb',m:'minor',ch:['Bbm','C°','Db','Ebm','Fm','Gb','Ab'],sc:['Bb','C','Db','Eb','F','Gb','Ab']},
  'Eb minor':{r:'Eb',m:'minor',ch:['Ebm','F°','Gb','Abm','Bbm','Cb','Db'],sc:['Eb','F','Gb','Ab','Bb','Cb','Db']},
  'Ab minor':{r:'Ab',m:'minor',ch:['Abm','Bb°','Cb','Dbm','Ebm','Fb','Gb'],sc:['Ab','Bb','Cb','Db','Eb','Fb','Gb']}
};

export const MAJOR_COF = ['C major','G major','D major','A major','E major','B major','Gb major','Db major','Ab major','Eb major','Bb major','F major'];
export const MINOR_COF = ['A minor','E minor','B minor','F# minor','C# minor','D minor','G minor','C minor','F minor','Bb minor','Eb minor','Ab minor'].filter(k => KEYS[k]);

export function chordRN(k, ch) {
  if (!k?.ch) return '';
  const rn = ['I','ii','iii','IV','V','vi','vii°'];
  const rm = ['i','ii°','III','iv','v','VI','VII'];
  const pos = k.ch.indexOf(ch);
  return pos === -1 ? '' : (k.m === 'minor' ? rm[pos] : rn[pos]);
}

export function gcon(ch, mode = 'major') {
  if (!ch || ch.length < 7) return [];
  const p = mode === 'minor'
    ? [[0,3],[0,4],[0,5],[1,4],[3,0],[3,4],[4,0],[4,5],[5,3],[5,2],[6,0]]
    : [[0,3],[0,4],[0,5],[1,0],[1,4],[2,5],[3,0],[3,4],[4,0],[4,5],[5,3]];
  const strong = mode === 'minor'
    ? new Set(['6,0','3,0'])
    : new Set(['4,0','3,0']);
  return p.map(([a,b]) => ({
    f: ch[a],
    t: ch[b],
    st: strong.has(`${a},${b}`) ? 'strong' : 'normal'
  }));
}

export function notePC(note) {
  const M = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11,'B#':0 };
  return M[note] ?? -1;
}

export function extChordLabel(k, baseName, ext) {
  if (!ext || ext === 'triad') return baseName;
  if (!k || !k.ch) return baseName;
  const pos = k.ch.indexOf(baseName);
  if (pos === -1) return baseName;
  const { r } = pc(baseName);
  const isDim = (k.m === 'major' && pos === 6) || (k.m === 'minor' && pos === 1);
  if (ext === 'power') return r + '5';
  if (ext === 'sus2') return isDim ? baseName : r + 'sus2';
  if (ext === 'sus4') return isDim ? baseName : r + 'sus4';
  if (ext === '7ths') {
    if (isDim) return r + 'm7b5';
    const isMaj7 = (k.m === 'major' && (pos === 0 || pos === 3)) || (k.m === 'minor' && (pos === 2 || pos === 5));
    const isDom7 = (k.m === 'major' && pos === 4) || (k.m === 'minor' && pos === 6);
    if (isMaj7) return r + 'maj7';
    if (isDom7) return r + '7';
    return r + 'm7';
  }
  return baseName;
}

export function ml(ch, cx, cy, r) {
  return ch.map((c, i) => {
    const a = (i / ch.length) * Math.PI * 2 - Math.PI / 2;
    return { c, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}

export function midiVarLen(v) {
  const b = [];
  let x = v & 0x7f;
  v >>= 7;
  while (v) {
    b.unshift(0x80 | (v & 0x7f));
    v >>= 7;
  }
  b.push(x);
  return b;
}

export function noteToMidi(n) {
  const M = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
  const m = n.match(/^([A-G][#b]?)(\d)$/);
  if (!m) return 60;
  return (M[m[1]] ?? 0) + (parseInt(m[2]) + 1) * 12;
}

export function exportMIDI(prog, bpm = 90, beats = 4) {
  const filled = prog.filter(s => s && s !== 'REST');
  if (!filled.length) return;
  const tpqn = 480, beatTicks = tpqn * beats, tempo = Math.round(60000000 / bpm);
  const evts = [];
  filled.forEach((s, si) => {
    const ns = cn(pc(s).r, pc(s).t, 4);
    const st = si * beatTicks, et = (si + 1) * beatTicks;
    ns.forEach(n => {
      const m = noteToMidi(n);
      evts.push([st, 0x90, m, 80], [et, 0x80, m, 0]);
    });
  });
  evts.sort((a, b) => a[0] - b[0] || (a[1] === 0x80 ? -1 : 1));
  let prev = 0;
  const td = [0x00, 0xFF, 0x51, 0x03, (tempo >> 16) & 0xFF, (tempo >> 8) & 0xFF, tempo & 0xFF];
  evts.forEach(([tick, st, note, vel]) => {
    const d = tick - prev;
    prev = tick;
    td.push(...midiVarLen(d), st, note, vel);
  });
  td.push(0x00, 0xFF, 0x2F, 0x00);
  const tl = td.length;
  const bytes = new Uint8Array([
    0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1,
    (tpqn >> 8) & 0xFF, tpqn & 0xFF,
    0x4D, 0x54, 0x72, 0x6B,
    (tl >> 24) & 0xFF, (tl >> 16) & 0xFF, (tl >> 8) & 0xFF, tl & 0xFF,
    ...td
  ]);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'harmonymap.mid';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const MOODS = [
  { id:'chill',   emoji:'😌', label:'Chill',   color:'#5EEAD4', key:'F major', bpm:72,  prog:['F','Bb','Am','Dm'] },
  { id:'hopeful', emoji:'🌅', label:'Hopeful', color:'#FBBF24', key:'C major', bpm:100, prog:['C','G','Am','F'] },
  { id:'dark',    emoji:'🌑', label:'Dark',    color:'#818CF8', key:'A minor', bpm:84,  prog:['Am','F','Dm','G'] },
  { id:'epic',    emoji:'🔥', label:'Epic',    color:'#FB7185', key:'E minor', bpm:128, prog:['Em','C','G','D'] },
  { id:'dreamy',  emoji:'💭', label:'Dreamy',  color:'#A78BFA', key:'G major', bpm:72,  prog:['Em','C','G','Am'] },
];
