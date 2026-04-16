<script>
  import { onDestroy, tick } from 'svelte'
  import WaveSurfer from 'wavesurfer.js'
  import RegionsPlugin from 'wavesurfer.js/plugins/regions'
  import { detectTransients } from './lib/transientDetector.js'
  import { audioBufferToWav }  from './lib/wavEncoder.js'
  import { exportZip }         from './lib/zipExporter.js'

  // ── State machine ────────────────────────────────────────────────────────
  // 'idle' | 'loading' | 'ready' | 'exporting'
  let state = 'idle'

  // ── Audio ────────────────────────────────────────────────────────────────
  let audioCtx    = null
  let audioBuffer = null   // kept alive for WAV encoding
  let duration    = 0
  let fileName    = ''

  // ── WaveSurfer ───────────────────────────────────────────────────────────
  let wavesurfer  = null
  let wsRegions   = null
  let waveformEl  = null   // bound via bind:this after tick()

  // ── Chop points ──────────────────────────────────────────────────────────
  // Always sorted; first = 0, last = duration
  let chopPoints  = []
  let sensitivity = 0.15   // transient threshold 0–1

  // ── Playback ─────────────────────────────────────────────────────────────
  let isPlaying   = false
  let currentTime = 0

  // ── Pads — MPC audition grid ──────────────────────────────────────────────
  // All pads share the single audioCtx — never create per-pad contexts.
  let pitchSemitones = 0
  $: playbackRate = 2 ** (pitchSemitones / 12)   // vinyl-style: pitch changes speed

  let activePads  = new Set()   // reactive Set drives pad--active CSS
  const padSources = {}          // padIndex → AudioBufferSourceNode (non-reactive)

  function playPad(i) {
    if (!audioCtx || !audioBuffer || i >= chopCount) return
    unlockAudio()

    // Retrigger: stop any still-playing source for this slot
    if (padSources[i]) {
      try { padSources[i].stop() } catch (_) {}
      delete padSources[i]
    }

    const src = audioCtx.createBufferSource()
    src.buffer            = audioBuffer
    src.playbackRate.value = playbackRate
    src.connect(audioCtx.destination)

    const offset  = chopPoints[i]
    const chopLen = chopPoints[i + 1] - chopPoints[i]
    src.start(0, offset, chopLen)
    padSources[i] = src

    activePads = new Set([...activePads, i])
    src.onended = () => {
      delete padSources[i]
      activePads = new Set([...activePads].filter(x => x !== i))
    }
  }

  function stopAllPads() {
    for (const src of Object.values(padSources)) {
      try { src.stop() } catch (_) {}
    }
    for (const k of Object.keys(padSources)) delete padSources[k]
    activePads = new Set()
  }

  // ── Zoom ─────────────────────────────────────────────────────────────────
  // pixels-per-second; 0 = fit-to-container (default overview)
  let zoomPx = 0

  const ZOOM_MIN  = 0
  const ZOOM_MAX  = 600
  const ZOOM_STEP = 60   // each tap ≈ one bar width on a typical beat grid

  function zoomIn() {
    zoomPx = Math.min(zoomPx + ZOOM_STEP, ZOOM_MAX)
    applyZoom()
  }
  function zoomOut() {
    zoomPx = Math.max(zoomPx - ZOOM_STEP, ZOOM_MIN)
    applyZoom()
  }
  function applyZoom() {
    if (!wavesurfer) return
    // zoom(0) or falsy resets to overview; positive values scroll the waveform
    wavesurfer.zoom(zoomPx || undefined)
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  let errorMsg         = ''
  let showSilentBanner = false

  $: chopCount = Math.max(0, chopPoints.length - 1)

  // ── iOS: unlock AudioContext on first user gesture ───────────────────────
  function unlockAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      // Show ringer banner on iOS
      if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
        showSilentBanner = true
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()
  }

  // ── File ingestion ────────────────────────────────────────────────────────
  async function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return

    // Unlock AudioContext on this user gesture (iOS requirement)
    unlockAudio()

    // Tear down existing WaveSurfer before any state change
    if (wavesurfer) {
      wavesurfer.destroy()
      wavesurfer  = null
      wsRegions   = null
    }

    stopAllPads()
    state          = 'loading'
    errorMsg       = ''
    fileName       = file.name
    audioBuffer    = null
    zoomPx         = 0
    pitchSemitones = 0

    try {
      const mimeType  = file.type || 'audio/mpeg'
      const rawBuffer = await file.arrayBuffer()

      // Dereference the File handle immediately — critical on iOS Safari
      e.target.value = ''

      // Decode for analysis; slice(0) clones so decodeAudioData can't neuter rawBuffer
      audioBuffer = await audioCtx.decodeAudioData(rawBuffer.slice(0))
      duration    = audioBuffer.duration
      chopPoints  = [0, duration]

      // Create Blob for WaveSurfer visualization, then let rawBuffer be GC'd
      const blob  = new Blob([rawBuffer], { type: mimeType })

      // Flip to 'ready' FIRST so waveformEl div enters the DOM, then tick()
      state = 'ready'
      await tick()

      await initWavesurfer(blob)
    } catch (err) {
      console.error('[CHOP] decode error', err)
      errorMsg = 'Could not decode this file. Try MP3, WAV, M4A, or AAC.'
      state    = 'idle'
    }
  }

  // ── WaveSurfer setup ──────────────────────────────────────────────────────
  async function initWavesurfer(blob) {
    if (!waveformEl) {
      console.error('[CHOP] waveformEl not in DOM')
      return
    }

    wsRegions  = RegionsPlugin.create()

    wavesurfer = WaveSurfer.create({
      container:     waveformEl,
      waveColor:     ['#ff6b35', '#cc3d00'],
      progressColor: ['#ffb380', '#ff7c46'],
      cursorColor:   '#00e5ff',
      cursorWidth:   2,
      barWidth:      2,
      barGap:        1,
      barRadius:     2,
      height:        128,
      normalize:     true,
      fillParent:    true,
      interact:      true,
      plugins:       [wsRegions],
    })

    wavesurfer.on('play',        ()  => { isPlaying = true  })
    wavesurfer.on('pause',       ()  => { isPlaying = false })
    wavesurfer.on('finish',      ()  => { isPlaying = false })
    wavesurfer.on('timeupdate',  (t) => { currentTime = t   })

    // Tap on waveform → add a chop point at that time
    wavesurfer.on('interaction', (newTime) => {
      if (state !== 'ready') return
      addChopPoint(newTime)
    })

    await wavesurfer.loadBlob(blob)
    redrawRegions()
  }

  // ── Chop point management ─────────────────────────────────────────────────
  function addChopPoint(time) {
    const t = Math.round(time * 1000) / 1000   // ms precision
    // Ignore if too close to an existing boundary (< 10 ms)
    if (chopPoints.some(cp => Math.abs(cp - t) < 0.01)) return
    chopPoints = [...chopPoints, t].sort((a, b) => a - b)
    redrawRegions()
  }

  function removeChopPoint(index) {
    // Guard: never remove the leading 0 or trailing duration
    if (index === 0 || index >= chopPoints.length - 1) return
    chopPoints = chopPoints.filter((_, i) => i !== index)
    redrawRegions()
  }

  const REGION_COLORS = [
    'rgba(255,107,53,0.22)',
    'rgba(0,229,255,0.18)',
    'rgba(255,220,0,0.20)',
    'rgba(120,255,150,0.20)',
    'rgba(200,100,255,0.18)',
    'rgba(255,100,150,0.20)',
    'rgba(100,200,255,0.18)',
    'rgba(255,180,50,0.20)',
  ]

  const DOT_COLORS = [
    '#ff6b35','#00e5ff','#ffd700','#78ff96',
    '#c864ff','#ff6496','#64c8ff','#ffb432',
  ]

  function redrawRegions() {
    if (!wsRegions) return
    wsRegions.clearRegions()
    for (let i = 0; i < chopPoints.length - 1; i++) {
      wsRegions.addRegion({
        id:     `chop-${i}`,
        start:  chopPoints[i],
        end:    chopPoints[i + 1],
        color:  REGION_COLORS[i % REGION_COLORS.length],
        drag:   false,
        resize: false,
      })
    }
  }

  // ── Auto-chop ─────────────────────────────────────────────────────────────
  function autoChop() {
    if (!audioBuffer) return
    const transients = detectTransients(audioBuffer, { threshold: sensitivity, minGap: 0.25 })
    const raw        = [0, ...transients, duration]
    const seen       = new Set()
    chopPoints = raw
      .map(t  => Math.round(t * 1000) / 1000)
      .filter(t => { if (seen.has(t)) return false; seen.add(t); return true })
      .sort((a, b) => a - b)
    redrawRegions()
  }

  function clearChops() {
    stopAllPads()
    chopPoints = [0, duration]
    redrawRegions()
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  function togglePlay()  { wavesurfer?.playPause() }
  function skipToStart() { wavesurfer?.seekTo(0)   }

  // ── Export ────────────────────────────────────────────────────────────────
  async function doExport() {
    if (!audioBuffer || chopCount === 0) return
    state    = 'exporting'
    errorMsg = ''

    try {
      const base  = fileName.replace(/\.[^.]+$/, '') || 'sample'
      const files = []

      for (let i = 0; i < chopPoints.length - 1; i++) {
        const wav = audioBufferToWav(audioBuffer, chopPoints[i], chopPoints[i + 1])
        files.push({ name: `${base}_chop_${String(i + 1).padStart(2, '0')}.wav`, blob: wav })
      }

      await exportZip(files, `${base}_chops.zip`)
    } catch (err) {
      console.error('[CHOP] export error', err)
      errorMsg = 'Export failed. Check browser permissions and try again.'
    }

    state = 'ready'
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(s) {
    if (!isFinite(s)) return '0:00.0'
    const m   = Math.floor(s / 60)
    const sec = (s % 60).toFixed(1)
    return `${m}:${sec.padStart(4, '0')}`
  }

  function chopDuration(i) {
    const ms = (chopPoints[i + 1] - chopPoints[i]) * 1000
    return ms >= 1000
      ? `${(ms / 1000).toFixed(2)}s`
      : `${ms.toFixed(0)}ms`
  }

  onDestroy(() => {
    stopAllPads()
    wavesurfer?.destroy()
    audioCtx?.close()
    audioBuffer = null
  })
</script>

<!-- ── iOS silent-switch banner ─────────────────────────────────────────── -->
{#if showSilentBanner}
  <div class="banner" role="alert">
    <span class="banner-icon">🔔</span>
    <span>Not hearing audio? Make sure your ringer switch is <strong>on</strong>.</span>
    <button class="banner-close" on:click={() => showSilentBanner = false} aria-label="Dismiss">✕</button>
  </div>
{/if}

<!-- ── App shell ────────────────────────────────────────────────────────── -->
<div class="app">

  <!-- Header -->
  <header class="header">
    <div class="logo">
      <span class="logo-mark">✂</span>
      <span class="logo-text">CHOP</span>
    </div>

    {#if state === 'ready' || state === 'exporting'}
      <div class="file-meta">
        <span class="file-name">{fileName}</span>
        <span class="file-dur">{fmt(duration)}</span>
      </div>
      <label class="btn-ghost btn-sm" title="Load a different sample">
        New
        <input
          type="file"
          accept="audio/*, video/*, .mp3, .wav, .m4a, .mp4, .mov, .aiff, .ogg, .flac"
          on:change={handleFileSelect}
          class="sr-only"
        />
      </label>
    {/if}
  </header>

  <!-- Error banner -->
  {#if errorMsg}
    <p class="error" role="alert">{errorMsg}</p>
  {/if}

  <!-- ── IDLE: upload screen ──────────────────────────────────────────── -->
  {#if state === 'idle'}
    <div class="upload-screen">
      <div class="upload-glyph">✂</div>
      <h1 class="upload-heading">Drop a sample,<br>slice it up.</h1>
      <p class="upload-formats">MP3 · WAV · M4A · MP4 · MOV</p>

      <label class="btn-primary btn-xl">
        Upload Sample
        <input
          type="file"
          accept="audio/*, video/*, .mp3, .wav, .m4a, .mp4, .mov, .aiff, .ogg, .flac"
          on:change={handleFileSelect}
          class="sr-only"
        />
      </label>

      <p class="upload-note">All processing happens on your device.<br>Nothing is sent to any server.</p>
    </div>
  {/if}

  <!-- ── LOADING ──────────────────────────────────────────────────────── -->
  {#if state === 'loading'}
    <div class="loading-screen">
      <div class="spinner" role="status" aria-label="Decoding audio"></div>
      <p>Decoding <strong>{fileName}</strong>…</p>
    </div>
  {/if}

  <!-- ── READY / EXPORTING ────────────────────────────────────────────── -->
  {#if state === 'ready' || state === 'exporting'}

    <!-- Waveform — bind:this works because we tick() before rendering this block -->
    <div class="waveform-wrap">
      <div bind:this={waveformEl} class="waveform"></div>
      <div class="waveform-footer">
        <p class="waveform-tip">Tap to split</p>
        <div class="zoom-btns">
          <button
            class="btn-zoom"
            on:click={zoomOut}
            disabled={zoomPx === ZOOM_MIN}
            title="Zoom out"
            aria-label="Zoom out"
          >−</button>
          <span class="zoom-label">{zoomPx === 0 ? 'Overview' : `${zoomPx}px/s`}</span>
          <button
            class="btn-zoom"
            on:click={zoomIn}
            disabled={zoomPx === ZOOM_MAX}
            title="Zoom in"
            aria-label="Zoom in"
          >+</button>
        </div>
      </div>
    </div>

    <!-- Transport -->
    <div class="transport">
      <button class="btn-icon" on:click={skipToStart} title="Back to start">⏮</button>
      <button class="btn-play" on:click={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <span class="time-display">{fmt(currentTime)}</span>
    </div>

    <!-- Auto-chop controls -->
    <div class="chop-controls">
      <div class="sensitivity-row">
        <label class="sens-label" for="sens-range">
          Sensitivity
          <span class="sens-val">{Math.round(sensitivity * 100)}%</span>
        </label>
        <input
          id="sens-range"
          type="range"
          min="0.05" max="0.50" step="0.01"
          bind:value={sensitivity}
          class="range-slider"
        />
      </div>
      <div class="sensitivity-row">
        <label class="sens-label" for="pitch-range">
          Pitch
          <span class="sens-val">{pitchSemitones > 0 ? '+' : ''}{pitchSemitones} st</span>
        </label>
        <input
          id="pitch-range"
          type="range"
          min="-12" max="12" step="1"
          bind:value={pitchSemitones}
          class="range-slider range-slider--pitch"
        />
      </div>
      <div class="chop-btn-row">
        <button class="btn-accent" on:click={autoChop}>
          <span>Auto Chop</span>
          <span class="btn-sub">detect transients</span>
        </button>
        <button class="btn-ghost" on:click={clearChops}>Clear All</button>
      </div>
    </div>

    <!-- MPC pad grid (up to 16 pads) -->
    {#if chopCount > 0}
      <div class="pad-section">
        <div class="pad-section-header">
          <span>Audition Pads</span>
          <span class="muted">
            {pitchSemitones === 0 ? 'original pitch' : `${pitchSemitones > 0 ? '+' : ''}${pitchSemitones} semitones`}
          </span>
        </div>
        <div class="pad-grid">
          {#each { length: 16 } as _, i}
            <button
              class="pad"
              class:pad--active={activePads.has(i)}
              class:pad--empty={i >= chopCount}
              on:click={() => playPad(i)}
              style={i < chopCount ? `--pad-color:${DOT_COLORS[i % DOT_COLORS.length]}` : ''}
              disabled={i >= chopCount}
              aria-label={i < chopCount ? `Play chop ${i + 1}` : 'Empty pad'}
            >
              {#if i < chopCount}
                <span class="pad-num">{i + 1}</span>
                <span class="pad-dur">{chopDuration(i)}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Chop list -->
    {#if chopCount > 0}
      <div class="chop-list">
        <div class="chop-list-header">
          <span>{chopCount} chop{chopCount !== 1 ? 's' : ''}</span>
          <span class="muted">tap ✕ to merge with previous</span>
        </div>
        <div class="chop-scroll">
          {#each { length: chopCount } as _, i}
            <div class="chop-row">
              <span
                class="chop-dot"
                style="background:{DOT_COLORS[i % DOT_COLORS.length]}"
              ></span>
              <span class="chop-num">#{i + 1}</span>
              <span class="chop-times">{fmt(chopPoints[i])} → {fmt(chopPoints[i + 1])}</span>
              <span class="chop-dur">{chopDuration(i)}</span>
              {#if i > 0}
                <button
                  class="chop-del"
                  on:click={() => removeChopPoint(i)}
                  title="Remove this boundary"
                  aria-label="Remove chop {i + 1} boundary"
                >✕</button>
              {:else}
                <span class="chop-del-spacer"></span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Export -->
    <div class="export-bar">
      <button
        class="btn-export"
        on:click={doExport}
        disabled={state === 'exporting' || chopCount === 0}
      >
        {#if state === 'exporting'}
          <span class="spinner spinner-sm" aria-hidden="true"></span>
          Packaging…
        {:else}
          Export {chopCount} WAV{chopCount !== 1 ? 's' : ''} as ZIP
        {/if}
      </button>
      <p class="export-meta">16-bit · 44.1 kHz · DAW-ready</p>
    </div>

  {/if}
</div><!-- .app -->

<style>
  /* ── Reset / globals ─────────────────────────────────────────────────── */
  :global(*) {
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
  }
  :global(body) {
    margin: 0;
    background: #0d0d0d;
    color: #f2f2f7;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
  }
  :global(#app) { min-height: 100dvh; }

  /* ── App shell ───────────────────────────────────────────────────────── */
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    max-width: 600px;
    margin: 0 auto;
    /* Respect notch / home bar */
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* ── iOS silent-switch banner ────────────────────────────────────────── */
  .banner {
    position: fixed;
    inset-inline: 0;
    top: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: #1c1c1e;
    border-bottom: 1px solid #ff6b35;
    font-size: 13px;
    line-height: 1.4;
  }
  .banner-icon { font-size: 18px; flex-shrink: 0; }
  .banner-close {
    margin-left: auto;
    background: none;
    border: none;
    color: #8e8e93;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 6px;
    min-width: 30px;
    min-height: 30px;
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    padding: 14px 20px;
    gap: 12px;
    border-bottom: 1px solid #1c1c1e;
    flex-shrink: 0;
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .logo-mark {
    font-size: 22px;
    color: #ff6b35;
    line-height: 1;
  }
  .logo-text {
    font-size: 21px;
    font-weight: 800;
    letter-spacing: 0.14em;
  }
  .file-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .file-name {
    font-size: 12px;
    color: #8e8e93;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-dur {
    font-size: 11px;
    color: #48484a;
    font-variant-numeric: tabular-nums;
  }

  /* ── Error ───────────────────────────────────────────────────────────── */
  .error {
    margin: 12px 20px;
    padding: 12px 16px;
    background: rgba(255,69,58,0.12);
    border: 1px solid rgba(255,69,58,0.35);
    border-radius: 10px;
    font-size: 13px;
    color: #ff6b6b;
  }

  /* ── Idle / upload screen ────────────────────────────────────────────── */
  .upload-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 32px;
    gap: 22px;
    text-align: center;
  }
  .upload-glyph {
    font-size: 64px;
    line-height: 1;
    filter: drop-shadow(0 0 28px rgba(255,107,53,0.65));
  }
  .upload-heading {
    font-size: 34px;
    font-weight: 800;
    margin: 0;
    line-height: 1.15;
    letter-spacing: -0.02em;
  }
  .upload-formats {
    font-size: 13px;
    letter-spacing: 0.1em;
    color: #636366;
    margin: -10px 0 0;
  }
  .upload-note {
    font-size: 12px;
    color: #48484a;
    line-height: 1.6;
    max-width: 260px;
  }

  /* ── Loading screen ──────────────────────────────────────────────────── */
  .loading-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    color: #8e8e93;
    font-size: 15px;
  }

  /* ── Waveform ────────────────────────────────────────────────────────── */
  .waveform-wrap {
    background: #111;
    border-bottom: 1px solid #1c1c1e;
    padding-top: 8px;
  }
  .waveform {
    width: 100%;
    /* WaveSurfer injects its own canvas; touch-action prevents scroll jank */
    touch-action: none;
  }
  .waveform-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px 8px;
  }
  .waveform-tip {
    font-size: 11px;
    color: #3a3a3c;
    margin: 0;
  }
  .zoom-btns {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-zoom {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: #1c1c1e;
    border: none;
    color: #f2f2f7;
    font-size: 18px;
    font-weight: 300;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: background 0.1s;
  }
  .btn-zoom:active  { background: #2c2c2e; }
  .btn-zoom:disabled { color: #3a3a3c; cursor: default; }
  .zoom-label {
    font-size: 11px;
    color: #636366;
    min-width: 62px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* ── Transport ───────────────────────────────────────────────────────── */
  .transport {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 12px 24px;
    border-bottom: 1px solid #1c1c1e;
  }
  .btn-play {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: #ff6b35;
    border: none;
    color: #fff;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.1s, background 0.1s;
    box-shadow: 0 4px 16px rgba(255,107,53,0.4);
  }
  .btn-play:active { transform: scale(0.92); background: #e05520; }
  .btn-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #1c1c1e;
    border: none;
    color: #f2f2f7;
    font-size: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .btn-icon:active { background: #2c2c2e; }
  .time-display {
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    color: #8e8e93;
    min-width: 60px;
    text-align: center;
  }

  /* ── Chop controls ───────────────────────────────────────────────────── */
  .chop-controls {
    padding: 16px 20px;
    border-bottom: 1px solid #1c1c1e;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .sensitivity-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sens-label {
    font-size: 11px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #636366;
    display: flex;
    justify-content: space-between;
  }
  .sens-val { color: #ff6b35; font-variant-numeric: tabular-nums; }
  .range-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: #2c2c2e;
    outline: none;
    cursor: pointer;
  }
  .range-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #ff6b35;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(255,107,53,0.5);
  }
  .range-slider::-moz-range-thumb {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #ff6b35;
    border: none;
    cursor: pointer;
  }
  .chop-btn-row {
    display: flex;
    gap: 10px;
  }

  /* ── Chop list ───────────────────────────────────────────────────────── */
  .chop-list {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .chop-list-header {
    display: flex;
    justify-content: space-between;
    padding: 10px 20px 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #636366;
  }
  .chop-scroll {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    max-height: 220px;
    padding: 0 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chop-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: #1c1c1e;
    border-radius: 10px;
  }
  .chop-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .chop-num {
    font-size: 12px;
    font-weight: 600;
    color: #636366;
    min-width: 30px;
    font-variant-numeric: tabular-nums;
  }
  .chop-times {
    flex: 1;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chop-dur {
    font-size: 11px;
    color: #636366;
    font-variant-numeric: tabular-nums;
    min-width: 46px;
    text-align: right;
  }
  .chop-del {
    background: none;
    border: none;
    color: #48484a;
    font-size: 13px;
    cursor: pointer;
    padding: 4px;
    min-width: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .chop-del:active { background: rgba(255,69,58,0.2); color: #ff453a; }
  .chop-del-spacer { width: 28px; flex-shrink: 0; }

  /* ── Export bar ──────────────────────────────────────────────────────── */
  .export-bar {
    margin-top: auto;
    padding: 16px 20px;
    border-top: 1px solid #1c1c1e;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .export-meta {
    font-size: 11px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #48484a;
    margin: 0;
  }

  /* ── Buttons ─────────────────────────────────────────────────────────── */
  .btn-primary,
  .btn-accent,
  .btn-ghost,
  .btn-export {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: none;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
    border-radius: 12px;
    padding: 13px 20px;
    min-height: 48px;
    transition: transform 0.1s, opacity 0.15s;
    -webkit-appearance: none;
    text-align: center;
    text-decoration: none;
  }
  .btn-primary:active,
  .btn-accent:active,
  .btn-ghost:active { transform: scale(0.97); }

  .btn-primary,
  .btn-export  { background: #ff6b35; color: #fff; width: 100%; }
  .btn-export:disabled { background: #2c2c2e; color: #48484a; cursor: default; opacity: 1; }

  .btn-accent {
    background: #ff6b35;
    color: #fff;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;
  }
  .btn-sub {
    font-size: 10px;
    font-weight: 400;
    opacity: 0.7;
    letter-spacing: 0.04em;
  }

  .btn-ghost {
    background: #1c1c1e;
    color: #f2f2f7;
  }
  .btn-ghost.btn-sm {
    font-size: 13px;
    padding: 7px 14px;
    min-height: 34px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .btn-xl { min-height: 56px; font-size: 17px; padding: 16px 36px; border-radius: 14px; }

  /* ── Spinner ─────────────────────────────────────────────────────────── */
  .spinner {
    width: 42px;
    height: 42px;
    border: 3px solid #1c1c1e;
    border-top-color: #ff6b35;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
    flex-shrink: 0;
  }
  .spinner-sm { width: 18px; height: 18px; border-width: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Misc ────────────────────────────────────────────────────────────── */
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border: 0;
  }
  .muted { color: #3a3a3c; }

  /* ── Pitch slider accent ─────────────────────────────────────────────── */
  .range-slider--pitch::-webkit-slider-thumb { background: #00e5ff; box-shadow: 0 2px 8px rgba(0,229,255,0.45); }
  .range-slider--pitch::-moz-range-thumb     { background: #00e5ff; }

  /* ── MPC pad grid ────────────────────────────────────────────────────── */
  .pad-section {
    border-bottom: 1px solid #1c1c1e;
  }
  .pad-section-header {
    display: flex;
    justify-content: space-between;
    padding: 10px 20px 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #636366;
  }
  .pad-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    padding: 8px 16px 16px;
  }
  .pad {
    aspect-ratio: 1;
    border-radius: 10px;
    background: #1c1c1e;
    border: 1.5px solid var(--pad-color, transparent);
    color: #f2f2f7;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 4px;
    position: relative;
    overflow: hidden;
    transition: transform 0.07s;
    -webkit-appearance: none;
  }
  /* Tinted fill using the pad colour */
  .pad::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--pad-color, transparent);
    opacity: 0.12;
    border-radius: inherit;
    pointer-events: none;
  }
  .pad:active  { transform: scale(0.88); }
  .pad--active { transform: scale(0.88); border-color: var(--pad-color, #ff6b35); }
  .pad--active::before { opacity: 0.32; }
  .pad--empty  { opacity: 0.15; cursor: default; border-color: transparent !important; }
  .pad--empty::before { display: none; }
  .pad-num {
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    position: relative;
    z-index: 1;
  }
  .pad-dur {
    font-size: 9px;
    color: #8e8e93;
    position: relative;
    z-index: 1;
    font-variant-numeric: tabular-nums;
  }
</style>
