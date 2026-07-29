import { describe, it, expect } from 'vitest';
import { KEYS, MOODS, MAJOR_COF, MINOR_COF, pc } from '../src/music.js';

describe('KEYS invariants', () => {
  it('every key has exactly 7 diatonic chords and 7 scale notes', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      expect(k.ch, `${name}.ch`).toHaveLength(7);
      expect(k.sc, `${name}.sc`).toHaveLength(7);
    }
  });

  it('every key mode is major or minor', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      expect(['major', 'minor']).toContain(k.m);
      expect(k.m, `${name}.m`).toBeDefined();
    }
  });

  it('every root parses cleanly via pc', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      const parsed = pc(k.r);
      expect(parsed.r, `${name} root ${k.r}`).toBe(k.r);
    }
  });

  it('key naming convention matches mode ("X major" / "X minor")', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      expect(name.endsWith(k.m), `${name} name should end with ${k.m}`).toBe(true);
      expect(name.startsWith(k.r), `${name} name should start with root ${k.r}`).toBe(true);
    }
  });

  it('major keys: chord 0 is I (root major), chord 6 is vii° (diminished)', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      if (k.m !== 'major') continue;
      expect(pc(k.ch[0]).t, `${name} chord[0] should be major`).toBe('major');
      expect(pc(k.ch[6]).t, `${name} chord[6] should be dim`).toBe('dim');
    }
  });

  it('minor keys: chord 0 is i (minor), chord 1 is ii° (diminished)', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      if (k.m !== 'minor') continue;
      expect(pc(k.ch[0]).t, `${name} chord[0] should be minor`).toBe('minor');
      expect(pc(k.ch[1]).t, `${name} chord[1] should be dim`).toBe('dim');
    }
  });

  it('scale root is the key root', () => {
    for (const [name, k] of Object.entries(KEYS)) {
      expect(k.sc[0], `${name}.sc[0]`).toBe(k.r);
    }
  });
});

describe('MOODS invariants', () => {
  it('every mood key exists in KEYS', () => {
    for (const m of MOODS) {
      expect(KEYS[m.key], `${m.id}.key ${m.key} in KEYS`).toBeDefined();
    }
  });

  it('every chord in mood progression is diatonic to its key', () => {
    for (const m of MOODS) {
      const diatonic = KEYS[m.key].ch;
      for (const chord of m.prog) {
        expect(diatonic, `${m.id} chord ${chord} in ${m.key}`).toContain(chord);
      }
    }
  });

  it('bpm is within [40, 200]', () => {
    for (const m of MOODS) {
      expect(m.bpm, `${m.id}.bpm`).toBeGreaterThanOrEqual(40);
      expect(m.bpm, `${m.id}.bpm`).toBeLessThanOrEqual(200);
    }
  });

  it('every mood id is unique', () => {
    const ids = MOODS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every mood has non-empty emoji and label', () => {
    for (const m of MOODS) {
      expect(m.emoji, `${m.id}.emoji`).toBeTruthy();
      expect(m.emoji.length).toBeGreaterThan(0);
      expect(m.label, `${m.id}.label`).toBeTruthy();
      expect(m.label.length).toBeGreaterThan(0);
    }
  });

  it('every mood has at least one chord in prog', () => {
    for (const m of MOODS) {
      expect(m.prog.length, `${m.id}.prog`).toBeGreaterThan(0);
    }
  });

  it('every mood has a valid color string', () => {
    for (const m of MOODS) {
      expect(m.color, `${m.id}.color`).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
    }
  });
});

describe('Circle-of-fifths tables', () => {
  it('every MAJOR_COF entry exists in KEYS and is major', () => {
    for (const name of MAJOR_COF) {
      expect(KEYS[name], `${name} in KEYS`).toBeDefined();
      expect(KEYS[name].m).toBe('major');
    }
  });

  it('every MINOR_COF entry exists in KEYS and is minor', () => {
    for (const name of MINOR_COF) {
      expect(KEYS[name], `${name} in KEYS`).toBeDefined();
      expect(KEYS[name].m).toBe('minor');
    }
  });

  it('MAJOR_COF and MINOR_COF have unique entries', () => {
    expect(new Set(MAJOR_COF).size).toBe(MAJOR_COF.length);
    expect(new Set(MINOR_COF).size).toBe(MINOR_COF.length);
  });
});
