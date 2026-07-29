import { describe, it, expect } from 'vitest';
import {
  cn, pc, cc, chordRN, gcon, extChordLabel,
  KEYS, CT, NN
} from '../src/music.js';

describe('cn (chord notes)', () => {
  // Table-driven: every chord type at oct=4 rooted at C
  const cases = [
    ['C', 'major',  4, ['C4','E4','G4']],
    ['C', 'minor',  4, ['C4','D#4','G4']],
    ['C', 'dim',    4, ['C4','D#4','F#4']],
    ['C', 'aug',    4, ['C4','E4','G#4']],
    ['C', 'dom7',   4, ['C4','E4','G4','A#4']],
    ['C', 'maj7',   4, ['C4','E4','G4','B4']],
    ['C', 'min7',   4, ['C4','D#4','G4','A#4']],
    ['C', 'm7b5',   4, ['C4','D#4','F#4','A#4']],
    ['C', 'sus2',   4, ['C4','D4','G4']],
    ['C', 'sus4',   4, ['C4','F4','G4']],
    ['C', 'power',  4, ['C4','G4']],
  ];
  it.each(cases)('cn(%s, %s, %d) → %o', (root, type, oct, expected) => {
    expect(cn(root, type, oct)).toEqual(expected);
  });

  it('produces triads for every root in every octave (spot-shape check)', () => {
    for (const root of NN) {
      for (const oct of [3, 4, 5]) {
        const notes = cn(root, 'major', oct);
        expect(notes).toHaveLength(3);
        // First note must literally be root+oct
        expect(notes[0]).toBe(root + oct);
      }
    }
  });

  it('every type produces the correct interval count', () => {
    for (const type of Object.keys(CT)) {
      const notes = cn('C', type, 4);
      expect(notes).toHaveLength(CT[type].iv.length);
    }
  });

  it('enharmonic roots: Cb → B, E# → F, Fb → E, B# → C', () => {
    // ENH maps these to natural spellings; verify with major triad first note
    expect(cn('Cb', 'major', 4)[0]).toBe('B4');
    expect(cn('E#', 'major', 4)[0]).toBe('F4');
    expect(cn('Fb', 'major', 4)[0]).toBe('E4');
    expect(cn('B#', 'major', 4)[0]).toBe('C4');
  });

  it('invalid root returns []', () => {
    expect(cn('Q', 'major', 4)).toEqual([]);
    expect(cn('', 'major', 4)).toEqual([]);
    expect(cn('H', 'major', 4)).toEqual([]);
  });

  it('invalid type returns []', () => {
    expect(cn('C', 'bogus', 4)).toEqual([]);
  });

  it('flat spelling (FN) accepted as root', () => {
    // Db is in FN, not NN — still resolves via FN lookup
    expect(cn('Db', 'major', 4)).toEqual(['C#4','F4','G#4']);
    expect(cn('Eb', 'major', 4)).toEqual(['D#4','G4','A#4']);
  });

  it('octave rollover: B major triad at oct 4 rolls D# and F# into oct 5', () => {
    // B4 → D#5 (past C boundary), F#5
    expect(cn('B', 'major', 4)).toEqual(['B4','D#5','F#5']);
  });

  it('octave rollover: G# triad at oct 4 rolls into oct 5', () => {
    expect(cn('G#', 'major', 4)).toEqual(['G#4','C5','D#5']);
  });
});

describe('pc (parse chord symbol)', () => {
  const cases = [
    ['C',       { r:'C',  t:'major' }],
    ['Cm',      { r:'C',  t:'minor' }],
    ['C°',      { r:'C',  t:'dim'   }],
    ['C7',      { r:'C',  t:'dom7'  }],
    ['Cmaj7',   { r:'C',  t:'maj7'  }],
    ['Cm7',     { r:'C',  t:'min7'  }],
    ['Cm7b5',   { r:'C',  t:'m7b5'  }],
    ['Csus2',   { r:'C',  t:'sus2'  }],
    ['Csus4',   { r:'C',  t:'sus4'  }],
    ['C5',      { r:'C',  t:'power' }],
    ['F#m7b5',  { r:'F#', t:'m7b5'  }],
    ['Bb7',     { r:'Bb', t:'dom7'  }],
    ['Abmaj7',  { r:'Ab', t:'maj7'  }],
    ['Ebm',     { r:'Eb', t:'minor' }],
  ];
  it.each(cases)('pc(%s) → %o', (sym, expected) => {
    expect(pc(sym)).toEqual(expected);
  });

  it('malformed input falls back to {r:C, t:major}', () => {
    expect(pc('')).toEqual({ r:'C', t:'major' });
    expect(pc(null)).toEqual({ r:'C', t:'major' });
    expect(pc(undefined)).toEqual({ r:'C', t:'major' });
    expect(pc('note:D')).toEqual({ r:'C', t:'major' });
    expect(pc('bogus')).toEqual({ r:'C', t:'major' });
    expect(pc('Hm7')).toEqual({ r:'C', t:'major' });
  });
});

describe('cc (chord color)', () => {
  it('returns quality-specific colors', () => {
    expect(cc('C')).toBe('#FF6B9D');      // major
    expect(cc('Cm')).toBe('#4FD1C7');     // minor
    expect(cc('C°')).toBe('#C77DFF');     // diminished
    expect(cc('C7')).toBe('#FF9500');     // dominant
    expect(cc('Csus2')).toBe('#5EEAD4');  // suspended
    expect(cc('Csus4')).toBe('#5EEAD4');  // suspended
    expect(cc('C5')).toBe('#94A3B8');     // power
  });

  it('fallback on unknown quality is #fff', () => {
    // pc falls back to major on bad input, so cc still returns a color;
    // but if we pass something whose t maps to a q not in the table, we'd get #fff.
    // Since pc's fallback is major, an invalid input still yields #FF6B9D.
    expect(cc('bogus')).toBe('#FF6B9D');
  });
});

describe('chordRN (Roman numeral)', () => {
  const rnMajor = ['I','ii','iii','IV','V','vi','vii°'];
  const rnMinor = ['i','ii°','III','iv','v','VI','VII'];

  it('every diatonic chord in every key resolves to the correct RN', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      const expected = k.m === 'minor' ? rnMinor : rnMajor;
      k.ch.forEach((ch, i) => {
        expect(chordRN(k, ch), `${name} pos ${i} chord ${ch}`).toBe(expected[i]);
      });
    }
  });

  it('unknown chord in a valid key returns ""', () => {
    expect(chordRN(KEYS['C major'], 'Xzz')).toBe('');
  });

  it('missing key returns ""', () => {
    expect(chordRN(null, 'C')).toBe('');
    expect(chordRN(undefined, 'C')).toBe('');
    expect(chordRN({}, 'C')).toBe('');
  });
});

describe('extChordLabel', () => {
  const k = KEYS['C major']; // ch=[C, Dm, Em, F, G, Am, B°]

  it('triad / unset ext returns base name', () => {
    expect(extChordLabel(k, 'C', 'triad')).toBe('C');
    expect(extChordLabel(k, 'F', undefined)).toBe('F');
    expect(extChordLabel(k, 'F', '')).toBe('F');
  });

  it('unknown base name is passed through', () => {
    expect(extChordLabel(k, 'Xzz', '7ths')).toBe('Xzz');
  });

  it('missing key is passed through', () => {
    expect(extChordLabel(null, 'C', '7ths')).toBe('C');
  });

  it('power: root+5 for every position (including dim)', () => {
    expect(extChordLabel(k, 'C', 'power')).toBe('C5');
    expect(extChordLabel(k, 'Dm', 'power')).toBe('D5');
    expect(extChordLabel(k, 'B°', 'power')).toBe('B5');
  });

  it('sus2/sus4 suppressed on dim (major position 6)', () => {
    expect(extChordLabel(k, 'B°', 'sus2')).toBe('B°');
    expect(extChordLabel(k, 'B°', 'sus4')).toBe('B°');
  });

  it('sus2/sus4 suppressed on dim (minor position 1)', () => {
    const am = KEYS['A minor']; // Am, B°, C, Dm, Em, F, G — pos 1 is B°
    expect(extChordLabel(am, 'B°', 'sus2')).toBe('B°');
    expect(extChordLabel(am, 'B°', 'sus4')).toBe('B°');
  });

  it('sus2/sus4 emit sus label on non-dim positions', () => {
    expect(extChordLabel(k, 'C', 'sus2')).toBe('Csus2');
    expect(extChordLabel(k, 'F', 'sus4')).toBe('Fsus4');
    expect(extChordLabel(k, 'Dm', 'sus2')).toBe('Dsus2'); // root only, quality dropped
  });

  it('7ths major key: I→maj7, IV→maj7, V→7, vii°→m7b5, others→m7', () => {
    // C major: C→maj7, Dm→m7, Em→m7, F→maj7, G→7, Am→m7, B°→m7b5
    expect(extChordLabel(k, 'C',  '7ths')).toBe('Cmaj7');
    expect(extChordLabel(k, 'Dm', '7ths')).toBe('Dm7');
    expect(extChordLabel(k, 'Em', '7ths')).toBe('Em7');
    expect(extChordLabel(k, 'F',  '7ths')).toBe('Fmaj7');
    expect(extChordLabel(k, 'G',  '7ths')).toBe('G7');
    expect(extChordLabel(k, 'Am', '7ths')).toBe('Am7');
    expect(extChordLabel(k, 'B°', '7ths')).toBe('Bm7b5');
  });

  it('7ths minor key: III→maj7, VI→maj7, VII→7, ii°→m7b5, others→m7', () => {
    const am = KEYS['A minor']; // Am, B°, C, Dm, Em, F, G
    expect(extChordLabel(am, 'Am', '7ths')).toBe('Am7');
    expect(extChordLabel(am, 'B°', '7ths')).toBe('Bm7b5');
    expect(extChordLabel(am, 'C',  '7ths')).toBe('Cmaj7');
    expect(extChordLabel(am, 'Dm', '7ths')).toBe('Dm7');
    expect(extChordLabel(am, 'Em', '7ths')).toBe('Em7');
    expect(extChordLabel(am, 'F',  '7ths')).toBe('Fmaj7');
    expect(extChordLabel(am, 'G',  '7ths')).toBe('G7');
  });

  it('every key: every diatonic position × every ext mode returns a string', () => {
    for (const [, k] of Object.entries(KEYS)) {
      for (const ch of k.ch) {
        for (const ext of ['triad','power','sus2','sus4','7ths']) {
          const out = extChordLabel(k, ch, ext);
          expect(typeof out).toBe('string');
          expect(out.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('gcon (chord connections)', () => {
  const cMajor = KEYS['C major'].ch; // [C, Dm, Em, F, G, Am, B°]
  const aMinor = KEYS['A minor'].ch; // [Am, B°, C, Dm, Em, F, G]

  it('major mode edge list: I→F, I→G, I→Am, ii→G, IV→I, IV→G, V→I, V→vi, vi→IV', () => {
    const edges = gcon(cMajor, 'major');
    expect(edges).toEqual([
      { f:'C',  t:'F',  st:'normal' },
      { f:'C',  t:'G',  st:'normal' },
      { f:'C',  t:'Am', st:'normal' },
      { f:'Dm', t:'G',  st:'normal' },
      { f:'F',  t:'C',  st:'strong' }, // IV → I
      { f:'F',  t:'G',  st:'normal' },
      { f:'G',  t:'C',  st:'strong' }, // V → I
      { f:'G',  t:'Am', st:'normal' },
      { f:'Am', t:'F',  st:'normal' },
    ]);
  });

  it('minor mode has one extra edge (10 vs 9)', () => {
    const edges = gcon(aMinor, 'minor');
    expect(edges).toHaveLength(10);
    // last edge is [5,2] = F → C
    expect(edges[edges.length - 1]).toEqual({ f:'F', t:'C', st:'normal' });
  });

  it('strong markers only on IV→I and V→I', () => {
    const strong = gcon(cMajor, 'major').filter(e => e.st === 'strong');
    expect(strong).toEqual([
      { f:'F', t:'C', st:'strong' },
      { f:'G', t:'C', st:'strong' },
    ]);
  });

  it('short chord list returns []', () => {
    expect(gcon([], 'major')).toEqual([]);
    expect(gcon(['C','Dm','Em'], 'major')).toEqual([]);
    expect(gcon(null, 'major')).toEqual([]);
  });
});
