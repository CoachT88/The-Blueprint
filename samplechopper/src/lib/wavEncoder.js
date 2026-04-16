/**
 * Slice an AudioBuffer and encode it as a 16-bit PCM WAV Blob.
 *
 * The output is mono if the source has 1 channel, stereo if ≥2 channels.
 * Samples are clamped to [-1, 1] then linearly mapped to Int16.
 *
 * @param {AudioBuffer} audioBuffer  - Source buffer
 * @param {number}      startTime    - Slice start in seconds (default: 0)
 * @param {number|null} endTime      - Slice end in seconds (default: buffer end)
 * @returns {Blob}  WAV file blob (audio/wav)
 */
export function audioBufferToWav(audioBuffer, startTime = 0, endTime = null) {
  const sr          = audioBuffer.sampleRate
  const totalLen    = audioBuffer.length
  const startSample = Math.max(0, Math.floor(startTime * sr))
  const endSample   = endTime != null
    ? Math.min(Math.ceil(endTime * sr), totalLen)
    : totalLen
  const numSamples  = Math.max(0, endSample - startSample)
  const numCh       = Math.min(audioBuffer.numberOfChannels, 2)   // mono or stereo

  if (numSamples === 0) return new Blob([], { type: 'audio/wav' })

  // ── Interleave channels → Int16 ──────────────────────────────────────────
  const pcm = new Int16Array(numSamples * numCh)
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const f = audioBuffer.getChannelData(ch)[startSample + i]
      const c = Math.max(-1, Math.min(1, f))
      pcm[i * numCh + ch] = c < 0
        ? Math.round(c * 0x8000)
        : Math.round(c * 0x7FFF)
    }
  }

  // ── Build RIFF/WAV header (44 bytes) ─────────────────────────────────────
  const dataBytes = pcm.byteLength
  const buf       = new ArrayBuffer(44 + dataBytes)
  const v         = new DataView(buf)
  const s         = (off, str) => {
    for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i))
  }

  s(0,  'RIFF')
  v.setUint32(4,  36 + dataBytes,      true)  // file size − 8
  s(8,  'WAVE')
  s(12, 'fmt ')
  v.setUint32(16, 16,                  true)  // fmt chunk size
  v.setUint16(20, 1,                   true)  // PCM = 1
  v.setUint16(22, numCh,               true)  // channels
  v.setUint32(24, sr,                  true)  // sample rate
  v.setUint32(28, sr * numCh * 2,      true)  // byte rate
  v.setUint16(32, numCh * 2,           true)  // block align
  v.setUint16(34, 16,                  true)  // bits per sample
  s(36, 'data')
  v.setUint32(40, dataBytes,           true)  // data chunk size
  new Int16Array(buf, 44).set(pcm)

  return new Blob([buf], { type: 'audio/wav' })
}
