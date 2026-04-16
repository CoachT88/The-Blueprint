/**
 * Onset / transient detection via energy-based spectral flux.
 *
 * Algorithm:
 *  1. Mix channels to mono.
 *  2. Compute RMS energy for overlapping short frames.
 *  3. Onset strength = half-wave rectified frame-to-frame energy delta.
 *  4. Normalize, then pick local maxima above `threshold` that are at least
 *     `minGap` seconds apart.
 *
 * @param {AudioBuffer} audioBuffer
 * @param {object}  opts
 * @param {number}  opts.frameSize  - Analysis window in samples (default: 512)
 * @param {number}  opts.hopSize    - Hop size in samples (default: 256)
 * @param {number}  opts.threshold  - Normalized onset strength cutoff 0–1 (default: 0.15)
 * @param {number}  opts.minGap     - Min seconds between detections (default: 0.08)
 * @returns {number[]} Sorted transient timestamps in seconds (never includes 0)
 */
export function detectTransients(audioBuffer, {
  frameSize = 512,
  hopSize   = 256,
  threshold = 0.15,
  minGap    = 0.08,
} = {}) {
  const data     = toMono(audioBuffer)
  const sr       = audioBuffer.sampleRate
  const numFrames = Math.floor((data.length - frameSize) / hopSize)

  if (numFrames < 2) return []

  // ── 1. RMS energy per frame ──────────────────────────────────────────────
  const energy = new Float32Array(numFrames)
  for (let i = 0; i < numFrames; i++) {
    const off = i * hopSize
    let sum = 0
    for (let j = 0; j < frameSize; j++) sum += data[off + j] ** 2
    energy[i] = Math.sqrt(sum / frameSize)
  }

  // ── 2. Half-wave rectified energy difference ─────────────────────────────
  const onset = new Float32Array(numFrames)
  for (let i = 1; i < numFrames; i++) {
    onset[i] = Math.max(0, energy[i] - energy[i - 1])
  }

  // ── 3. Normalize to [0, 1] ───────────────────────────────────────────────
  let peak = 0
  for (let i = 0; i < numFrames; i++) if (onset[i] > peak) peak = onset[i]
  if (peak === 0) return []
  for (let i = 0; i < numFrames; i++) onset[i] /= peak

  // ── 4. Peak picking ───────────────────────────────────────────────────────
  const minGapFrames = Math.ceil(minGap * sr / hopSize)
  const transients   = []
  let lastPeak       = -minGapFrames

  for (let i = 1; i < numFrames - 1; i++) {
    if (
      onset[i] >= threshold &&
      onset[i] >= onset[i - 1] &&
      onset[i] >= onset[i + 1] &&
      i - lastPeak >= minGapFrames
    ) {
      const t = (i * hopSize) / sr
      if (t > 0.02) {          // skip artefacts right at the start
        transients.push(t)
        lastPeak = i
      }
    }
  }

  return transients
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Mix an AudioBuffer down to a mono Float32Array. */
function toMono(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels
  if (numCh === 1) return audioBuffer.getChannelData(0)

  const len    = audioBuffer.length
  const mono   = new Float32Array(len)
  const scale  = 1 / numCh

  for (let ch = 0; ch < numCh; ch++) {
    const src = audioBuffer.getChannelData(ch)
    for (let i = 0; i < len; i++) mono[i] += src[i] * scale
  }

  return mono
}
