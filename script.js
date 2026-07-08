/* ============================================================
   SYNTH LAB — Waveform Synthesizer v1.0
   Web Audio API + Canvas Visualizations
   ============================================================ */
'use strict';

// ============================================================
// DOM REFS
// ============================================================
const $ = id => document.getElementById(id);
const ringCanvas = $('ringCanvas');
const ringCtx = ringCanvas.getContext('2d');
const scopeCanvas = $('scopeCanvas');
const scopeCtx = scopeCanvas.getContext('2d');
const playBtn = $('playBtn');
const playIcon = playBtn.querySelector('.play-icon');
const playText = playBtn.querySelector('.play-text');
const freqDisplay = $('freqDisplay');
const volDisplay = $('volDisplay');
const peakDot = $('peakDot');
const clipIndicator = $('clipIndicator');
const modeIndicator = $('modeIndicator');
const functionInput = $('functionInput');
const toast = $('toast');

// ============================================================
// AUDIO ENGINE
// ============================================================
let audioCtx = null;
let processorNode = null;
let isPlaying = false;
let currentMode = 'function';
let masterVolume = 0.5;
let audioTime = 0;
let sampleRate = 44100;

// Audio sample ring buffers for visualization
const RING_BUFFER_SIZE = 512;
const SCOPE_BUFFER_SIZE = 2048;
let ringBuffer = new Float32Array(RING_BUFFER_SIZE);
let scopeBuffer = new Float32Array(SCOPE_BUFFER_SIZE);
let ringWriteIdx = 0;
let scopeWriteIdx = 0;
let rmsVolume = 0;
let peakVolume = 0;

// Compiled function for mode 1
let compiledFn = null;
let fnExpr = 'sin(440*2*PI*x)';

// Wave combo params for mode 2
const waveParams = [
  { amp: 0.5, freq: 220, phase: 0 },  // sine
  { amp: 0,   freq: 330, phase: 0 },  // triangle
  { amp: 0,   freq: 440, phase: 0 },  // sawtooth
  { amp: 0,   freq: 550, phase: 0 },  // square
];
const kValues = [1, 0, 0, 0];

// ============================================================
// FUNCTION PARSER (Mode 1)
// ============================================================
function compileFunction(expr) {
  let processed = expr
    .replace(/\s+/g, '')
    .replace(/\^/g, '**')
    .replace(/(?<![a-zA-Z])PI(?![a-zA-Z])/g, 'Math.PI')
    .replace(/(?<![a-zA-Z])E(?![a-zA-Z])/g, 'Math.E');

  // Replace known functions with Math.*
  const funcMap = ['sin','cos','tan','sinh','cosh','tanh','abs','sqrt','exp','log','floor','ceil','round','min','max','sign','random'];
  for (const fn of funcMap) {
    const re = new RegExp('(?<![a-zA-Z.])' + fn + '(?=\\()', 'g');
    processed = processed.replace(re, 'Math.' + fn);
  }

  // Map ln to Math.log (natural log)
  processed = processed.replace(/(?<![a-zA-Z.])ln(?=\()/g, 'Math.log');

  // Validate: only allow safe characters
  const dangerous = /[^0-9+\-*/%().,xX\s]|(?:(?:Math\.)?[a-zA-Z]+(?!\.\w+))/g;
  // We already mapped known functions. Check remaining identifiers are safe.
  const afterMapping = processed.replace(/Math\.\w+/g, '').replace(/[\d+\-*/%().,><=!&|?:;\s]/g, '');
  if (afterMapping !== '' && afterMapping !== 'x' && afterMapping !== 'X') {
    // There's something unexpected
    const unknown = afterMapping.replace(/x/gi, '');
    if (unknown) throw new Error('Invalid identifier: ' + unknown);
  }

  // Now check for explicit dangerous patterns
  const blocklist = /__proto__|constructor|prototype|eval|Function|window|document|this|new\s|import|require|fetch|alert|prompt|XMLHttpRequest|setTimeout|setInterval/i;
  if (blocklist.test(processed)) {
    throw new Error('Blocked dangerous expression');
  }

  // Build the function - x is time in seconds
  const body = `"use strict"; return (${processed});`;
  const fn = new Function('x', body);

  // Test with sample value
  const testVal = fn(0);
  if (typeof testVal !== 'number' || !isFinite(testVal)) {
    throw new Error('Function must return a finite number');
  }

  return fn;
}

function initDefaultFunction() {
  try { compiledFn = compileFunction(fnExpr); }
  catch (e) { compiledFn = compileFunction('sin(440*2*PI*x)'); fnExpr = 'sin(440*2*PI*x)'; }
}

// ============================================================
// WAVE GENERATORS (Mode 2)
// ============================================================
function sineWave(phase)    { return Math.sin(phase); }
function triangleWave(phase){ const p = phase / (2*Math.PI); return 4 * Math.abs(p - Math.floor(p + 0.5)) - 1; }
function sawWave(phase)     { const p = phase / (2*Math.PI); return 2 * (p - Math.floor(p + 0.5)); }
function squareWave(phase)  { return Math.sin(phase) >= 0 ? 1 : -1; }

const waveGens = [sineWave, triangleWave, sawWave, squareWave];

// ============================================================
// AUDIO PROCESSING
// ============================================================
function processAudioMode1(output, len) {
  const fn = compiledFn;
  const invSR = 1 / sampleRate;
  try {
    for (let i = 0; i < len; i++) {
      let sample = fn(audioTime);
      if (!isFinite(sample)) sample = 0;
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      output[i] = sample * masterVolume;
      audioTime += invSR;
      writeToBuffers(output[i]);
    }
  } catch (e) {
    output.fill(0);
    audioTime += len * invSR;
  }
}

function processAudioMode2(output, len) {
  const invSR = 1 / sampleRate;
  for (let i = 0; i < len; i++) {
    let sample = 0;
    for (let w = 0; w < 4; w++) {
      if (waveParams[w].amp <= 0.001 && kValues[w] <= 0.001) continue;
      const freq = waveParams[w].freq;
      const amp = waveParams[w].amp;
      const phaseRad = waveParams[w].phase;
      const phase = 2 * Math.PI * freq * audioTime + phaseRad;
      sample += kValues[w] * amp * waveGens[w](phase);
    }
    if (sample > 1) sample = 1;
    if (sample < -1) sample = -1;
    output[i] = sample * masterVolume;
    audioTime += invSR;
    writeToBuffers(output[i]);
  }
}

function writeToBuffers(sample) {
  ringBuffer[ringWriteIdx] = sample;
  ringWriteIdx = (ringWriteIdx + 1) % RING_BUFFER_SIZE;

  scopeBuffer[scopeWriteIdx] = sample;
  scopeWriteIdx = (scopeWriteIdx + 1) % SCOPE_BUFFER_SIZE;
}

function onAudioProcess(e) {
  const output = e.outputBuffer.getChannelData(0);
  const len = output.length;
  if (currentMode === 'function') {
    processAudioMode1(output, len);
  } else {
    processAudioMode2(output, len);
  }
}

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sampleRate = audioCtx.sampleRate;
}

function startAudio() {
  if (!audioCtx) initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }

  // Reset time so we start fresh
  audioTime = 0;
  ringWriteIdx = 0;
  scopeWriteIdx = 0;
  ringBuffer.fill(0);
  scopeBuffer.fill(0);

  processorNode = audioCtx.createScriptProcessor(512, 0, 1);
  processorNode.onaudioprocess = onAudioProcess;
  processorNode.connect(audioCtx.destination);

  isPlaying = true;
  playBtn.classList.add('playing');
  playIcon.textContent = '■';
  playText.textContent = 'STOP';
}

function stopAudio() {
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  isPlaying = false;
  playBtn.classList.remove('playing');
  playIcon.textContent = '▶';
  playText.textContent = 'PLAY';
  rmsVolume = 0;
  peakVolume = 0;
}

function togglePlay() {
  if (isPlaying) { stopAudio(); }
  else {
    // Ensure we have a valid compiled function
    if (currentMode === 'function' && !compiledFn) {
      try { compiledFn = compileFunction(fnExpr); }
      catch (e) { showToast('Invalid function: ' + e.message); return; }
    }
    startAudio();
  }
}

// ============================================================
// VISUALIZATION — Circular Waveform Ring
// ============================================================
function drawRing() {
  if (ringCanvas.clientWidth === 0) return;
  const dpr = window.devicePixelRatio || 1;
  ringCanvas.width = ringCanvas.clientWidth * dpr;
  ringCanvas.height = ringCanvas.clientHeight * dpr;
  ringCtx.setTransform(1, 0, 0, 1, 0, 0);
  ringCtx.scale(dpr, dpr);
  const cw = ringCanvas.clientWidth;
  const ch = ringCanvas.clientHeight;
  const cx = cw / 2;
  const cy = ch / 2;
  const baseRadius = cw * 0.36;
  const deviation = cw * 0.12;

  ringCtx.clearRect(0, 0, cw, ch);

  // Compute RMS volume from ring buffer
  let sumSq = 0;
  for (let i = 0; i < RING_BUFFER_SIZE; i++) sumSq += ringBuffer[i] * ringBuffer[i];
  rmsVolume = Math.sqrt(sumSq / RING_BUFFER_SIZE);
  // Smooth peak
  const instPeak = Math.max(...Array.from(ringBuffer).map(Math.abs));
  peakVolume += (instPeak - peakVolume) * 0.3;

  // --- Outer glow ring ---
  ringCtx.save();
  ringCtx.beginPath();
  ringCtx.arc(cx, cy, baseRadius + deviation + 4, 0, Math.PI * 2);
  ringCtx.strokeStyle = `rgba(0,229,255,${0.12 + rmsVolume * 1.2})`;
  ringCtx.lineWidth = 1;
  ringCtx.shadowColor = 'rgba(0,229,255,0.6)';
  ringCtx.shadowBlur = 8 + rmsVolume * 30;
  ringCtx.stroke();
  ringCtx.restore();

  // --- Base guide ring ---
  ringCtx.beginPath();
  ringCtx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  ringCtx.strokeStyle = 'rgba(255,255,255,0.06)';
  ringCtx.lineWidth = 1;
  ringCtx.setLineDash([4, 8]);
  ringCtx.stroke();
  ringCtx.setLineDash([]);

  // --- Waveform ring (filled band, no seam) ---
  const numPoints = 720;
  const bandInnerRatio = 0.65;
  const bandOuterMax = baseRadius + deviation * 0.8;

  ringCtx.beginPath();
  // Outer boundary: waveform, clockwise
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2 - Math.PI / 2;
    const idx = (i === numPoints) ? 0 : Math.floor(i / numPoints * RING_BUFFER_SIZE);
    const sample = ringBuffer[(ringWriteIdx - 1 - idx + RING_BUFFER_SIZE * 2) % RING_BUFFER_SIZE];
    const r = baseRadius + sample * deviation * 0.8;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ringCtx.moveTo(x, y);
    else ringCtx.lineTo(x, y);
  }

  // Inner boundary: smooth circle, counter-clockwise
  const innerR = baseRadius * bandInnerRatio;
  for (let i = numPoints; i >= 0; i--) {
    const angle = (i / numPoints) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * innerR;
    const y = cy + Math.sin(angle) * innerR;
    ringCtx.lineTo(x, y);
  }
  ringCtx.closePath();

  // Fill the band
  const bandGrad = ringCtx.createRadialGradient(cx, cy, innerR, cx, cy, bandOuterMax);
  bandGrad.addColorStop(0, 'rgba(0,0,0,0)');
  bandGrad.addColorStop(0.4, `rgba(0,229,255,${0.04 + rmsVolume * 0.08})`);
  bandGrad.addColorStop(0.7, `rgba(0,229,255,${0.1 + rmsVolume * 0.25})`);
  bandGrad.addColorStop(1, `rgba(0,229,255,${0.06 + rmsVolume * 0.12})`);
  ringCtx.fillStyle = bandGrad;
  ringCtx.shadowColor = 'rgba(0,229,255,0.6)';
  ringCtx.shadowBlur = 10 + rmsVolume * 30;
  ringCtx.fill();
  ringCtx.shadowBlur = 0;

  // Thin stroke on outer edge for definition
  ringCtx.beginPath();
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2 - Math.PI / 2;
    const idx = Math.floor(i / numPoints * RING_BUFFER_SIZE);
    const sample = ringBuffer[(ringWriteIdx - 1 - idx + RING_BUFFER_SIZE * 2) % RING_BUFFER_SIZE];
    const r = baseRadius + sample * deviation * 0.8;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ringCtx.moveTo(x, y);
    else ringCtx.lineTo(x, y);
  }
  const edgeGrad = ringCtx.createLinearGradient(cx - baseRadius, cy, cx + baseRadius, cy);
  edgeGrad.addColorStop(0, `rgba(0,229,255,${0.3 + rmsVolume})`);
  edgeGrad.addColorStop(0.3, `rgba(255,64,129,${0.2 + rmsVolume * 0.8})`);
  edgeGrad.addColorStop(0.5, `rgba(255,193,7,${0.15 + rmsVolume * 0.6})`);
  edgeGrad.addColorStop(0.7, `rgba(255,64,129,${0.2 + rmsVolume * 0.8})`);
  edgeGrad.addColorStop(1, `rgba(0,229,255,${0.3 + rmsVolume})`);
  ringCtx.strokeStyle = edgeGrad;
  ringCtx.lineWidth = 1.5 + rmsVolume * 2;
  ringCtx.lineCap = 'butt';
  ringCtx.lineJoin = 'round';
  ringCtx.shadowColor = 'rgba(0,229,255,0.5)';
  ringCtx.shadowBlur = 6 + rmsVolume * 20;
  ringCtx.stroke();
  ringCtx.shadowBlur = 0;

  // --- Inner fill ---
  ringCtx.beginPath();
  ringCtx.arc(cx, cy, baseRadius * 0.28, 0, Math.PI * 2);
  const innerGrad = ringCtx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.28);
  innerGrad.addColorStop(0, `rgba(0,229,255,${0.15 + rmsVolume * 0.8})`);
  innerGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ringCtx.fillStyle = innerGrad;
  ringCtx.fill();

  // --- Peak dot ---
  if (peakVolume > 0.5) {
    peakDot.classList.add('visible');
    peakDot.style.transform = `scale(${1 + peakVolume * 2})`;
  } else {
    peakDot.classList.remove('visible');
  }

  // Update center displays
  let dominantFreq = 440;
  if (currentMode === 'combo') {
    for (let w = 0; w < 4; w++) {
      if (waveParams[w].amp > 0.01 && kValues[w] > 0.01) {
        dominantFreq = waveParams[w].freq;
        break;
      }
    }
  }
  freqDisplay.textContent = dominantFreq + ' Hz';
  const db = rmsVolume > 0.0001 ? Math.round(20 * Math.log10(rmsVolume)) : -60;
  volDisplay.textContent = db + ' dB';

  // Clip indicator
  if (peakVolume > 0.97) {
    clipIndicator.classList.add('on');
    setTimeout(() => clipIndicator.classList.remove('on'), 300);
  }
}

// ============================================================
// VISUALIZATION — Scrolling Oscilloscope
// ============================================================
function drawScope() {
  if (scopeCanvas.clientWidth === 0) return;
  const dpr = window.devicePixelRatio || 1;
  scopeCanvas.width = scopeCanvas.clientWidth * dpr;
  scopeCanvas.height = scopeCanvas.clientHeight * dpr;
  scopeCtx.setTransform(1, 0, 0, 1, 0, 0);
  scopeCtx.scale(dpr, dpr);
  const cw = scopeCanvas.clientWidth;
  const ch = scopeCanvas.clientHeight;
  const mid = ch / 2;

  scopeCtx.clearRect(0, 0, cw, ch);

  // Center line
  scopeCtx.beginPath();
  scopeCtx.moveTo(0, mid);
  scopeCtx.lineTo(cw, mid);
  scopeCtx.strokeStyle = 'rgba(0,229,255,0.12)';
  scopeCtx.lineWidth = 1;
  scopeCtx.stroke();

  // Waveform
  scopeCtx.beginPath();
  const points = SCOPE_BUFFER_SIZE;
  const step = cw / points;
  for (let i = 0; i < points; i++) {
    const bufIdx = (scopeWriteIdx - 1 - i + SCOPE_BUFFER_SIZE * 2) % SCOPE_BUFFER_SIZE;
    const sample = scopeBuffer[bufIdx];
    const x = cw - i * step;
    const y = mid - sample * mid * 0.9;
    if (i === 0) scopeCtx.moveTo(x, y);
    else scopeCtx.lineTo(x, y);
  }

  // Gradient from right (new) to left (old)
  const scopeGrad = scopeCtx.createLinearGradient(cw, 0, 0, 0);
  scopeGrad.addColorStop(0, `rgba(0,229,255,${0.8 + rmsVolume})`);
  scopeGrad.addColorStop(0.3, `rgba(0,229,255,0.5)`);
  scopeGrad.addColorStop(0.6, `rgba(0,229,255,0.2)`);
  scopeGrad.addColorStop(1, 'rgba(0,229,255,0.04)');
  scopeCtx.strokeStyle = scopeGrad;
  scopeCtx.lineWidth = 1.5;
  scopeCtx.shadowColor = 'rgba(0,229,255,0.4)';
  scopeCtx.shadowBlur = 4;
  scopeCtx.stroke();
  scopeCtx.shadowBlur = 0;
}

// ============================================================
// ANIMATION LOOP
// ============================================================
function animate() {
  drawRing();
  drawScope();

  // Update frequency display in mode 1 with a pseudo-estimate
  if (currentMode === 'function' && isPlaying) {
    const crossings = countZeroCrossings(ringBuffer);
    const estFreq = Math.round(crossings * sampleRate / RING_BUFFER_SIZE / 2);
    if (estFreq > 10 && estFreq < 4000) {
      freqDisplay.textContent = estFreq + ' Hz';
    }
  }

  requestAnimationFrame(animate);
}

function countZeroCrossings(buffer) {
  let count = 0;
  for (let i = 1; i < buffer.length; i++) {
    if ((buffer[i-1] >= 0 && buffer[i] < 0) || (buffer[i-1] < 0 && buffer[i] >= 0)) {
      count++;
    }
  }
  return count;
}

// ============================================================
// UI HANDLERS
// ============================================================

// Play/Stop
playBtn.addEventListener('click', togglePlay);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
    e.preventDefault();
    togglePlay();
  }
});

// Master volume
$('masterVolume').addEventListener('input', function() {
  masterVolume = parseFloat(this.value);
  $('volPct').textContent = Math.round(masterVolume * 100) + '%';
});

// Mode switching
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    currentMode = this.dataset.mode;

    document.querySelectorAll('.control-panel').forEach(p => p.classList.remove('active'));
    if (currentMode === 'function') {
      $('panelFunction').classList.add('active');
      modeIndicator.textContent = 'MODE: FUNCTION';
    } else {
      $('panelCombo').classList.add('active');
      modeIndicator.textContent = 'MODE: WAVE_MIX';
    }

    // Restart if playing
    if (isPlaying) {
      stopAudio();
      if (currentMode === 'function') {
        try { compiledFn = compileFunction(fnExpr); } catch(e) {}
      }
      startAudio();
    }
  });
});

// ============================================================
// MODE 1 — FUNCTION INPUT
// ============================================================

$('btnApply').addEventListener('click', applyFunction);
functionInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') applyFunction();
});

// ── Undo / Redo History (session only) ──
let historyStack = [];
let historyIdx = -1;

function pushHistory(expr) {
  // Discard any redo future
  historyStack = historyStack.slice(0, historyIdx + 1);
  // Avoid duplicate consecutive entries
  if (historyStack.length === 0 || historyStack[historyStack.length - 1] !== expr) {
    historyStack.push(expr);
    historyIdx = historyStack.length - 1;
  }
  updateUndoRedoButtons();
}

function undo() {
  if (historyIdx <= 0) return;
  historyIdx--;
  loadHistoryEntry();
}

function redo() {
  if (historyIdx >= historyStack.length - 1) return;
  historyIdx++;
  loadHistoryEntry();
}

function loadHistoryEntry() {
  const expr = historyStack[historyIdx];
  functionInput.value = expr;
  fnExpr = expr;
  try {
    compiledFn = compileFunction(expr);
    functionInput.classList.remove('error');
    if (isPlaying) { stopAudio(); startAudio(); }
  } catch (e) { /* history entries are always valid */ }
  updateUndoRedoButtons();
  updateBookmarkButton();
}

function updateUndoRedoButtons() {
  $('btnUndo').disabled = historyIdx <= 0;
  $('btnRedo').disabled = historyIdx >= historyStack.length - 1;
}

$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);

document.addEventListener('keydown', function(e) {
  if (currentMode !== 'function') return;
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); toggleBookmark(); }
});

function applyFunction() {
  const expr = functionInput.value.trim();
  if (!expr) return;
  try {
    compiledFn = compileFunction(expr);
    fnExpr = expr;
    functionInput.classList.remove('error');
    pushHistory(expr);
    updateBookmarkButton();
    if (isPlaying) { stopAudio(); startAudio(); }
  } catch (e) {
    functionInput.classList.add('error');
    showToast('Error: ' + e.message);
  }
}

// ── Favorites (persistent in localStorage) ──
const FAV_KEY = 'synthlab_favorites';

function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
  } catch (e) { return []; }
}

function saveFavorites(favs) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  } catch (e) { /* storage full */ }
}

function isBookmarked(expr) {
  const favs = loadFavorites();
  return favs.some(f => f.expr === expr);
}

function toggleBookmark() {
  const expr = fnExpr;
  let favs = loadFavorites();
  const idx = favs.findIndex(f => f.expr === expr);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    // Generate a short name from the expression
    const name = expr.length > 30 ? expr.slice(0, 28) + '…' : expr;
    favs.push({ name, expr });
  }
  saveFavorites(favs);
  updateBookmarkButton();
  renderFavorites();
}

function updateBookmarkButton() {
  const btn = $('btnBookmark');
  if (isBookmarked(fnExpr)) {
    btn.classList.add('bookmarked');
  } else {
    btn.classList.remove('bookmarked');
  }
}

function renderFavorites() {
  const favs = loadFavorites();
  const list = $('favList');
  const count = $('favCount');
  count.textContent = favs.length;

  if (favs.length === 0) {
    list.innerHTML = '<span class="fav-empty">No bookmarked functions yet</span>';
    return;
  }

  list.innerHTML = favs.map((f, i) =>
    `<div class="fav-item">
      <button class="fav-item-name" data-idx="${i}" title="${f.expr}">${f.name}</button>
      <button class="fav-item-del" data-idx="${i}" title="Remove">&#x2715;</button>
    </div>`
  ).join('');

  list.querySelectorAll('.fav-item-name').forEach(btn => {
    btn.addEventListener('click', function() {
      const f = loadFavorites()[parseInt(this.dataset.idx)];
      if (!f) return;
      functionInput.value = f.expr;
      fnExpr = f.expr;
      try {
        compiledFn = compileFunction(f.expr);
        functionInput.classList.remove('error');
        pushHistory(f.expr);
        updateBookmarkButton();
        if (isPlaying) { stopAudio(); startAudio(); }
      } catch (e) { /* stored functions should be valid */ }
    });
  });

  list.querySelectorAll('.fav-item-del').forEach(btn => {
    btn.addEventListener('click', function() {
      let favs = loadFavorites();
      favs.splice(parseInt(this.dataset.idx), 1);
      saveFavorites(favs);
      updateBookmarkButton();
      renderFavorites();
    });
  });
}

$('btnBookmark').addEventListener('click', toggleBookmark);

// Math keyboard
document.querySelectorAll('.math-key').forEach(btn => {
  btn.addEventListener('click', function() {
    const val = this.textContent;
    const inp = functionInput;
    const start = inp.selectionStart;
    const end = inp.selectionEnd;
    const before = inp.value.substring(0, start);
    const after = inp.value.substring(end);
    let insert = val;
    if (val === 'x' || val === 'PI' || val === 'E') insert = val;
    if (val === 'ln' || val === 'log' || val === 'exp' || val === 'sqrt' || val === 'abs' || val === 'sinh' || val === 'cosh' || val === 'tanh') insert = val + '(';
    inp.value = before + insert + after;
    const cursor = start + insert.length;
    inp.setSelectionRange(cursor, cursor);
    inp.focus();
  });
});

// Presets
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    const expr = this.dataset.expr;
    functionInput.value = expr;
    fnExpr = expr;
    try {
      compiledFn = compileFunction(expr);
      functionInput.classList.remove('error');
      pushHistory(expr);
      updateBookmarkButton();
      if (isPlaying) { stopAudio(); startAudio(); }
    } catch (e) { /* preset should be valid */ }
  });
});

// ============================================================
// MODE 2 — WAVE COMBINATION
// ============================================================

function bindWaveSlider(id, param, waveIdx) {
  const slider = $(id);
  const numInput = $(id + 'Num');
  if (!slider) return;

  function update(val) {
    val = parseFloat(val);
    if (isNaN(val)) return;
    waveParams[waveIdx][param] = val;
    slider.value = val;
    if (numInput) numInput.value = val;
  }

  slider.addEventListener('input', function() {
    update(this.value);
  });
  if (numInput) {
    numInput.addEventListener('input', function() {
      update(this.value);
    });
  }
}

function bindKSlider(id, idx) {
  const slider = $(id);
  const numInput = $(id + 'Num');
  if (!slider) return;

  function update(val) {
    val = parseFloat(val);
    if (isNaN(val)) return;
    kValues[idx] = val;
    slider.value = val;
    if (numInput) numInput.value = val;
  }

  slider.addEventListener('input', function() {
    update(this.value);
  });
  if (numInput) {
    numInput.addEventListener('input', function() {
      update(this.value);
    });
  }
}

// Wave params
bindWaveSlider('amp0', 'amp', 0);
bindWaveSlider('freq0', 'freq', 0);
bindWaveSlider('phase0', 'phase', 0);
bindWaveSlider('amp1', 'amp', 1);
bindWaveSlider('freq1', 'freq', 1);
bindWaveSlider('phase1', 'phase', 1);
bindWaveSlider('amp2', 'amp', 2);
bindWaveSlider('freq2', 'freq', 2);
bindWaveSlider('phase2', 'phase', 2);
bindWaveSlider('amp3', 'amp', 3);
bindWaveSlider('freq3', 'freq', 3);
bindWaveSlider('phase3', 'phase', 3);

// K values
bindKSlider('k0', 0);
bindKSlider('k1', 1);
bindKSlider('k2', 2);
bindKSlider('k3', 3);

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ============================================================
// RESIZE HANDLER
// ============================================================
function onResize() {
  ringCanvas.style.width = ringCanvas.clientWidth + 'px';
  ringCanvas.style.height = ringCanvas.clientHeight + 'px';
  scopeCanvas.style.width = scopeCanvas.clientWidth + 'px';
  scopeCanvas.style.height = scopeCanvas.clientHeight + 'px';
}
window.addEventListener('resize', onResize);

// ============================================================
// INIT
// ============================================================
function initSliderDisplays() {
  // Number inputs already have value attributes set in HTML, no extra init needed
}

function init() {
  initDefaultFunction();
  functionInput.value = fnExpr;
  pushHistory(fnExpr);         // seed history
  updateUndoRedoButtons();
  updateBookmarkButton();
  renderFavorites();
  initSliderDisplays();
  animate();
  $('panelFunction').classList.add('active');

  // Click anywhere to init audio context (browser autoplay policy)
  document.addEventListener('click', function initCtx() {
    if (!audioCtx) { initAudio(); }
  }, { once: false });
}

init();
