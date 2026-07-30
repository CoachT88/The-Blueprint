import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { midiVarLen, noteToMidi, exportMIDI } from '../src/music.js';

// ─── midiVarLen ─────────────────────────────────────────────
describe('midiVarLen', () => {
  // Hand-computed against MIDI VLQ spec boundaries.
  const cases = [
    [0,       [0x00]],
    [127,     [0x7F]],
    [128,     [0x81, 0x00]],
    [16383,   [0xFF, 0x7F]],
    [16384,   [0x81, 0x80, 0x00]],
    [2097151, [0xFF, 0xFF, 0x7F]],
  ];
  it.each(cases)('midiVarLen(%d) → %o', (v, expected) => {
    expect(midiVarLen(v)).toEqual(expected);
  });
});

// ─── noteToMidi ─────────────────────────────────────────────
describe('noteToMidi', () => {
  it('C4 = 60', () => expect(noteToMidi('C4')).toBe(60));
  it('A4 = 69', () => expect(noteToMidi('A4')).toBe(69));
  it('C5 = 72', () => expect(noteToMidi('C5')).toBe(72));
  it('C0 = 12', () => expect(noteToMidi('C0')).toBe(12));
  it('B4 = 71', () => expect(noteToMidi('B4')).toBe(71));

  it('sharp/flat enharmonic equivalence', () => {
    expect(noteToMidi('A#4')).toBe(noteToMidi('Bb4'));
    expect(noteToMidi('C#4')).toBe(noteToMidi('Db4'));
    expect(noteToMidi('D#4')).toBe(noteToMidi('Eb4'));
    expect(noteToMidi('F#4')).toBe(noteToMidi('Gb4'));
    expect(noteToMidi('G#4')).toBe(noteToMidi('Ab4'));
  });

  it('invalid input falls back to 60', () => {
    expect(noteToMidi('nonsense')).toBe(60);
    expect(noteToMidi('')).toBe(60);
    expect(noteToMidi('C')).toBe(60);       // no octave digit
    expect(noteToMidi('H4')).toBe(60);      // invalid note
  });
});

// ─── exportMIDI (byte-level integration) ────────────────────
// Minimal DOM stubs so exportMIDI can run in Node.
let capturedBytes;
let capturedType;
let anchorCreated;
let clickCount;
let revokeCount;

function setupMidiStubs() {
  capturedBytes = null;
  capturedType = null;
  anchorCreated = null;
  clickCount = 0;
  revokeCount = 0;

  // Stub URL.createObjectURL to capture the Blob bytes synchronously.
  // We rely on Node 18+'s global Blob supporting .arrayBuffer(), but to
  // avoid async we intercept the Blob constructor via a proxy.
  const RealBlob = globalThis.Blob;
  const BlobStub = function (parts, opts) {
    // parts is an array — first entry is Uint8Array from exportMIDI
    const first = parts[0];
    if (first instanceof Uint8Array) {
      capturedBytes = new Uint8Array(first); // copy
    } else if (first?.buffer instanceof ArrayBuffer) {
      capturedBytes = new Uint8Array(first.buffer);
    }
    capturedType = opts?.type;
    return new RealBlob(parts, opts);
  };
  vi.stubGlobal('Blob', BlobStub);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:stub'),
    revokeObjectURL: vi.fn(() => { revokeCount++; }),
  });
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      anchorCreated = {
        href: '', download: '',
        click: vi.fn(() => { clickCount++; }),
      };
      return anchorCreated;
    }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
}

beforeEach(setupMidiStubs);
afterEach(() => vi.unstubAllGlobals());

// Walk a MIDI track body, counting note-on / note-off events.
function walkTrack(bytes, start, len) {
  const events = [];
  let i = start;
  const end = start + len;
  while (i < end) {
    // Read VLQ delta
    let delta = 0, byte;
    do {
      byte = bytes[i++];
      delta = (delta << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    const status = bytes[i++];
    if (status === 0xFF) {
      const meta = bytes[i++];
      // VLQ length
      let mlen = 0, mb;
      do { mb = bytes[i++]; mlen = (mlen << 7) | (mb & 0x7f); } while (mb & 0x80);
      events.push({ delta, status, meta, data: Array.from(bytes.slice(i, i + mlen)) });
      i += mlen;
    } else if ((status & 0xF0) === 0x90 || (status & 0xF0) === 0x80) {
      events.push({ delta, status, note: bytes[i], vel: bytes[i + 1] });
      i += 2;
    } else {
      throw new Error(`Unexpected status byte 0x${status.toString(16)} at ${i - 1}`);
    }
  }
  return events;
}

describe('exportMIDI', () => {
  it('empty progression is a no-op (no Blob created)', () => {
    exportMIDI([], 120, 4);
    expect(capturedBytes).toBeNull();
    expect(clickCount).toBe(0);
  });

  it('all-REST progression is a no-op', () => {
    exportMIDI(['REST', 'REST'], 120, 4);
    expect(capturedBytes).toBeNull();
  });

  it('null/undefined/empty slots are skipped', () => {
    // Cmaj triad × 1 chord = 3 note-on / 3 note-off
    exportMIDI([null, 'C', undefined, 'REST'], 120, 4);
    expect(capturedBytes).not.toBeNull();
    const tl = (capturedBytes[18] << 24) | (capturedBytes[19] << 16) | (capturedBytes[20] << 8) | capturedBytes[21];
    const evts = walkTrack(capturedBytes, 22, tl);
    const noteOns = evts.filter(e => e.status === 0x90);
    const noteOffs = evts.filter(e => e.status === 0x80);
    expect(noteOns).toHaveLength(3);
    expect(noteOffs).toHaveLength(3);
  });

  it('produces a byte-valid MIDI file with correct header', () => {
    exportMIDI(['C', 'G', 'Am', 'F'], 120, 4);
    expect(capturedBytes).not.toBeNull();
    expect(capturedType).toBe('audio/midi');

    // MThd magic
    expect(Array.from(capturedBytes.slice(0, 4))).toEqual([0x4D, 0x54, 0x68, 0x64]);
    // Header length = 6
    expect(Array.from(capturedBytes.slice(4, 8))).toEqual([0, 0, 0, 6]);
    // Format = 1
    expect(Array.from(capturedBytes.slice(8, 10))).toEqual([0, 1]);
    // Track count = 1
    expect(Array.from(capturedBytes.slice(10, 12))).toEqual([0, 1]);
    // Division = 480 (0x01E0)
    expect((capturedBytes[12] << 8) | capturedBytes[13]).toBe(480);
    // MTrk magic
    expect(Array.from(capturedBytes.slice(14, 18))).toEqual([0x4D, 0x54, 0x72, 0x6B]);
  });

  it('embeds tempo meta matching BPM', () => {
    const bpm = 120;
    const expectedTempo = Math.round(60000000 / bpm); // 500000 = 0x07A120
    exportMIDI(['C'], bpm, 4);

    // Tempo meta lives at the start of the track body.
    // MTrk starts at 14; length bytes at 18-21; body at 22.
    // Body: [0x00, 0xFF, 0x51, 0x03, hi, mid, lo, ...]
    expect(capturedBytes[22]).toBe(0x00);
    expect(capturedBytes[23]).toBe(0xFF);
    expect(capturedBytes[24]).toBe(0x51);
    expect(capturedBytes[25]).toBe(0x03);
    const tempo = (capturedBytes[26] << 16) | (capturedBytes[27] << 8) | capturedBytes[28];
    expect(tempo).toBe(expectedTempo);
  });

  it('note-on and note-off events are balanced (12/12 for 4 major triads)', () => {
    exportMIDI(['C', 'G', 'Am', 'F'], 120, 4);
    const tl = (capturedBytes[18] << 24) | (capturedBytes[19] << 16) | (capturedBytes[20] << 8) | capturedBytes[21];
    const evts = walkTrack(capturedBytes, 22, tl);
    const noteOns = evts.filter(e => e.status === 0x90);
    const noteOffs = evts.filter(e => e.status === 0x80);
    // 4 chords × 3 notes each
    expect(noteOns).toHaveLength(12);
    expect(noteOffs).toHaveLength(12);
    // Every note-on has a matching note-off (same note number, same count)
    const onNotes = noteOns.map(e => e.note).sort();
    const offNotes = noteOffs.map(e => e.note).sort();
    expect(onNotes).toEqual(offNotes);
    // Velocities: on = 80, off = 0
    noteOns.forEach(e => expect(e.vel).toBe(80));
    noteOffs.forEach(e => expect(e.vel).toBe(0));
  });

  it('EOT terminator is the last 4 bytes: 0x00 0xFF 0x2F 0x00', () => {
    exportMIDI(['C', 'G', 'Am', 'F'], 90, 4);
    const n = capturedBytes.length;
    expect(Array.from(capturedBytes.slice(n - 4))).toEqual([0x00, 0xFF, 0x2F, 0x00]);
  });

  it('track length in header matches actual body byte count', () => {
    exportMIDI(['C', 'G', 'Am', 'F'], 90, 4);
    const tl = (capturedBytes[18] << 24) | (capturedBytes[19] << 16) | (capturedBytes[20] << 8) | capturedBytes[21];
    // Total file length = 14 (header) + 8 (MTrk + length) + tl (body)
    expect(capturedBytes.length).toBe(14 + 8 + tl);
  });

  it('triggers download side effects (createObjectURL, anchor click)', () => {
    exportMIDI(['C'], 90, 4);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickCount).toBe(1);
    expect(anchorCreated.download).toBe('harmonymap.mid');
  });
});
