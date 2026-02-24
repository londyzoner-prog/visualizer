const canvas = document.getElementById("visualizer");
const ctx = canvas.getContext("2d");

const donateSection = document.getElementById("donate");
const walletText = document.getElementById("sol-wallet-text");
const donateLink = document.getElementById("sol-donate-link");
const copyWalletBtn = document.getElementById("copy-sol-wallet");

const demoBtn = document.getElementById("viz-demo");
const tabBtn = document.getElementById("viz-tab");
const micBtn = document.getElementById("viz-mic");
const fileBtn = document.getElementById("viz-file-btn");
const fileInput = document.getElementById("viz-file");
const statusEl = document.getElementById("viz-status");
const stageEl = document.getElementById("viz-stage");
const timeEl = document.getElementById("viz-time");
const energyEl = document.getElementById("viz-energy");
const audioEl = document.getElementById("viz-audio");

const PRIMARY = {
  red: "#ff1d25",
  yellow: "#ffe100",
  blue: "#0047ff",
  white: "#ffffff",
  black: "#040404",
};

let audioCtx;
let analyser;
let freqData;
let timeData;
let sourceNode;
let currentStream;
let currentMode = "demo";
let liveStart = performance.now();
let demoStart = performance.now();
let simulatedElapsed = 0;
let rafId = 0;

const renderState = {
  smoothEnergy: 0,
  bass: 0,
  mids: 0,
  highs: 0,
  beatPulse: 0,
  prevEnergy: 0,
  burstSeed: [],
};

function fitCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

fitCanvas();
window.addEventListener("resize", fitCanvas);

function getAudioContext() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      throw new Error("Web Audio API is not supported in this browser.");
    }
    audioCtx = new Ctor();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
  }
  return audioCtx;
}

async function ensureAudioRunning() {
  const ctxRef = getAudioContext();
  if (ctxRef.state === "suspended") {
    await ctxRef.resume();
  }
}

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function setActiveButton(mode) {
  const map = [
    [demoBtn, "demo"],
    [tabBtn, "tab"],
    [micBtn, "mic"],
    [fileBtn, "file"],
  ];
  map.forEach(([btn, key]) => {
    if (!btn) return;
    btn.classList.toggle("is-active", key === mode);
  });
}

function cleanupSource() {
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch {}
    sourceNode = null;
  }
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
  }
}

function connectAnalyser(node) {
  if (!analyser) return;
  node.connect(analyser);
}

function connectMediaElement() {
  if (!audioEl) return null;
  if (!audioEl._visualizerSourceNode) {
    audioEl._visualizerSourceNode = getAudioContext().createMediaElementSource(audioEl);
  }
  return audioEl._visualizerSourceNode;
}

async function startDemoMode() {
  cleanupSource();
  currentMode = "demo";
  demoStart = performance.now();
  liveStart = performance.now();
  setActiveButton("demo");
  setStatus("Mode: Demo signal (audio-reactive simulation)");
  if (audioCtx && audioCtx.state === "running") {
    try {
      await audioCtx.suspend();
    } catch {}
  }
}

async function startMicMode() {
  try {
    await ensureAudioRunning();
    cleanupSource();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    currentStream = stream;
    sourceNode = getAudioContext().createMediaStreamSource(stream);
    connectAnalyser(sourceNode);
    currentMode = "mic";
    liveStart = performance.now();
    setActiveButton("mic");
    setStatus("Mode: Mic input (for native app playback near speakers/headphones mix)");
  } catch (err) {
    setStatus(`Mic unavailable: ${err.message || "permission denied"}`);
  }
}

async function startTabCaptureMode() {
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("tab/system capture is not supported in this browser");
    }
    await ensureAudioRunning();
    cleanupSource();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("no audio track shared; choose a tab/window with audio and enable Share audio");
    }
    currentStream = stream;
    sourceNode = getAudioContext().createMediaStreamSource(stream);
    connectAnalyser(sourceNode);
    currentMode = "tab";
    liveStart = performance.now();
    setActiveButton("tab");
    setStatus("Mode: Tab audio capture (Spotify Web / Apple Music Web supported in-browser)");

    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (currentMode === "tab") {
          startDemoMode();
        }
      });
    });
  } catch (err) {
    setStatus(`Tab capture unavailable: ${err.message || "permission denied"}`);
  }
}

async function startFileMode(file) {
  if (!file || !audioEl) return;
  try {
    await ensureAudioRunning();
    cleanupSource();
    audioEl.src = URL.createObjectURL(file);
    audioEl.loop = false;
    audioEl.crossOrigin = "anonymous";
    sourceNode = connectMediaElement();
    connectAnalyser(sourceNode);
    await audioEl.play();
    currentMode = "file";
    liveStart = performance.now();
    setActiveButton("file");
    setStatus(`Mode: Local file (${file.name})`);
    audioEl.onended = () => {
      if (currentMode === "file") {
        setStatus(`Mode: Local file finished (${file.name})`);
      }
    };
  } catch (err) {
    setStatus(`Audio file failed: ${err.message || "could not play file"}`);
  }
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function currentProgress() {
  if (currentMode === "file" && audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
    const elapsed = audioEl.currentTime || 0;
    return {
      elapsed,
      duration: audioEl.duration,
      ratio: Math.min(1, Math.max(0, elapsed / audioEl.duration)),
    };
  }

  if (currentMode === "demo") {
    simulatedElapsed = (performance.now() - demoStart) / 1000;
    const duration = 210;
    const looped = simulatedElapsed % duration;
    return {
      elapsed: looped,
      duration,
      ratio: looped / duration,
    };
  }

  const elapsed = (performance.now() - liveStart) / 1000;
  const cycle = 180;
  const ratio = (elapsed % cycle) / cycle;
  return {
    elapsed,
    duration: null,
    ratio,
  };
}

function analyzeFrame() {
  if (!analyser || currentMode === "demo") return simulateAnalysis();

  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  let bass = 0;
  let mids = 0;
  let highs = 0;
  let total = 0;
  const n = freqData.length;

  for (let i = 0; i < n; i += 1) {
    const v = freqData[i] / 255;
    total += v;
    if (i < n * 0.12) bass += v;
    else if (i < n * 0.45) mids += v;
    else highs += v;
  }

  bass /= Math.max(1, Math.floor(n * 0.12));
  mids /= Math.max(1, Math.floor(n * 0.33));
  highs /= Math.max(1, Math.floor(n * 0.55));

  const energy = total / n;
  renderState.smoothEnergy += (energy - renderState.smoothEnergy) * 0.24;
  renderState.bass += (bass - renderState.bass) * 0.22;
  renderState.mids += (mids - renderState.mids) * 0.18;
  renderState.highs += (highs - renderState.highs) * 0.2;

  const spike = Math.max(0, renderState.smoothEnergy - renderState.prevEnergy);
  renderState.beatPulse = Math.max(renderState.beatPulse * 0.88, spike * 5.2);
  renderState.prevEnergy = renderState.smoothEnergy;
}

function simulateAnalysis() {
  const t = performance.now() * 0.001;
  const phase = (performance.now() - demoStart) * 0.00025;
  const sectionBoost = 0.15 + 0.18 * Math.sin(phase * 4.2);

  const bass = 0.34 + 0.26 * (0.5 + 0.5 * Math.sin(t * 2.3)) + sectionBoost;
  const mids = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(t * 3.5 + 1.4));
  const highs = 0.22 + 0.22 * (0.5 + 0.5 * Math.sin(t * 5.2 + 0.8));
  const energy = Math.min(1, (bass * 0.45 + mids * 0.32 + highs * 0.23));

  renderState.smoothEnergy += (energy - renderState.smoothEnergy) * 0.18;
  renderState.bass += (bass - renderState.bass) * 0.17;
  renderState.mids += (mids - renderState.mids) * 0.15;
  renderState.highs += (highs - renderState.highs) * 0.15;

  const pseudoBeat = Math.max(0, Math.sin(t * (1.9 + bass * 0.8)));
  renderState.beatPulse = Math.max(renderState.beatPulse * 0.9, pseudoBeat * 0.65 + energy * 0.25);

  if (freqData && timeData) {
    for (let i = 0; i < freqData.length; i += 1) {
      const band = i / freqData.length;
      const v =
        0.25 +
        renderState.bass * (1 - band) * 0.8 +
        renderState.mids * Math.max(0, 1 - Math.abs(band - 0.35) * 3) * 0.6 +
        renderState.highs * band * 0.9 +
        0.12 * Math.sin(t * (2 + band * 8) + i * 0.09);
      freqData[i] = Math.max(0, Math.min(255, Math.floor(v * 255)));
    }
    for (let i = 0; i < timeData.length; i += 1) {
      const x = i / timeData.length;
      const wave =
        Math.sin((x * 14 + t * 2.6) * Math.PI) * renderState.bass * 0.55 +
        Math.sin((x * 36 - t * 4.8) * Math.PI) * renderState.highs * 0.18;
      timeData[i] = Math.floor(128 + wave * 102);
    }
  }
}

function updateReadouts(progress) {
  const stage = 1 + Math.min(4, Math.floor(progress.ratio * 5));
  if (stageEl) {
    stageEl.textContent = `Stage ${stage} / 5`;
  }
  if (timeEl) {
    if (progress.duration) {
      timeEl.textContent = `${fmtTime(progress.elapsed)} / ${fmtTime(progress.duration)}`;
    } else {
      timeEl.textContent = `${fmtTime(progress.elapsed)} live`;
    }
  }
  if (energyEl) {
    energyEl.textContent = `Energy ${Math.round(renderState.smoothEnergy * 100)}%`;
  }
  return stage;
}

function drawBackground(w, h, beatPulse, ratio) {
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = PRIMARY.black;
  ctx.fillRect(0, 0, w, h);

  const diag = ctx.createLinearGradient(0, 0, w, h);
  diag.addColorStop(0, "rgba(255,29,37,0.12)");
  diag.addColorStop(0.5, "rgba(255,225,0,0.08)");
  diag.addColorStop(1, "rgba(0,71,255,0.14)");
  ctx.fillStyle = diag;
  ctx.fillRect(0, 0, w, h);

  const ringAlpha = 0.08 + beatPulse * 0.07;
  ctx.strokeStyle = `rgba(255,255,255,${ringAlpha})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i += 1) {
    const r = 28 + i * 34 + Math.sin(ratio * Math.PI * 6 + i) * 5;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBars(w, h, stage) {
  const mid = h * 0.64;
  const count = Math.max(36, Math.floor(w / 10));
  const barW = w / count;
  const baseScale = 0.25 + renderState.smoothEnergy * 0.85;

  for (let i = 0; i < count; i += 1) {
    const f = freqData ? freqData[Math.floor((i / count) * (freqData.length - 1))] / 255 : 0;
    const hueBand =
      i % 3 === 0 ? PRIMARY.red :
      i % 3 === 1 ? PRIMARY.yellow :
      PRIMARY.blue;

    const shapeBoost = 0.2 + Math.sin(i * 0.18 + performance.now() * 0.004) * 0.08;
    const barH = Math.max(4, h * (f * baseScale + shapeBoost * renderState.beatPulse * 0.4));

    ctx.fillStyle = hueBand;
    ctx.fillRect(i * barW + 1, mid - barH, Math.max(2, barW - 2), barH * 2);

    if (stage >= 2 && i % 5 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(i * barW + 1, mid - barH - 6, Math.max(2, barW - 2), 3);
      ctx.fillRect(i * barW + 1, mid + barH + 3, Math.max(2, barW - 2), 3);
    }
  }
}

function drawRadialLines(w, h, ratio) {
  const cx = w * 0.5;
  const cy = h * 0.48;
  const spokes = 48;
  const radius = Math.min(w, h) * 0.15 + renderState.bass * 80;

  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2 + ratio * Math.PI * 2 * 1.2;
    const bandIndex = Math.floor((i / spokes) * (freqData.length - 1));
    const amp = (freqData?.[bandIndex] || 0) / 255;
    const len = radius + amp * Math.min(w, h) * 0.24;
    const color = i % 3 === 0 ? PRIMARY.red : i % 3 === 1 ? PRIMARY.yellow : PRIMARY.blue;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 + amp * 2.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * (radius * 0.45), cy + Math.sin(angle) * (radius * 0.45));
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }
}

function drawWaveRibbon(w, h, ratio) {
  if (!timeData) return;
  const colors = [PRIMARY.red, PRIMARY.yellow, PRIMARY.blue];
  const centerY = h * 0.34;
  const amplitudeBase = 32 + renderState.mids * 80;

  colors.forEach((color, layer) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 + layer;
    ctx.beginPath();
    for (let x = 0; x < w; x += 4) {
      const idx = Math.floor((x / w) * (timeData.length - 1));
      const v = (timeData[idx] - 128) / 128;
      const offset =
        v * (amplitudeBase * (1 + layer * 0.16)) +
        Math.sin(x * 0.01 + ratio * 10 + layer) * (5 + renderState.highs * 16);
      const y = centerY + layer * 18 + offset;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

function ensureBurstPool() {
  if (renderState.burstSeed.length) return;
  for (let i = 0; i < 120; i += 1) {
    renderState.burstSeed.push({
      angle: Math.random() * Math.PI * 2,
      radius: 0.18 + Math.random() * 0.82,
      speed: 0.4 + Math.random() * 1.6,
      size: 1 + Math.random() * 4,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

function drawBursts(w, h, ratio) {
  ensureBurstPool();
  const cx = w * 0.5;
  const cy = h * 0.5;
  const pulse = renderState.beatPulse;

  for (let i = 0; i < renderState.burstSeed.length; i += 1) {
    const p = renderState.burstSeed[i];
    const drift = (ratio * 6 + p.phase) * p.speed;
    const r = (30 + p.radius * Math.min(w, h) * 0.45) * (1 + pulse * 0.18 * Math.sin(drift));
    const x = cx + Math.cos(p.angle + drift * 0.12) * r;
    const y = cy + Math.sin(p.angle + drift * 0.12) * r;

    ctx.fillStyle = i % 3 === 0 ? PRIMARY.red : i % 3 === 1 ? PRIMARY.yellow : PRIMARY.blue;
    ctx.fillRect(x, y, p.size + pulse * 3, p.size + pulse * 3);
  }
}

function drawKaleidoscope(w, h, ratio) {
  const cols = 10;
  const rows = 5;
  const cellW = w / cols;
  const cellH = h / rows;
  const mix = renderState.smoothEnergy * 0.6 + renderState.beatPulse * 0.4;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = ((x + y * cols) / (cols * rows)) * (freqData.length - 1);
      const amp = (freqData[Math.floor(idx)] || 0) / 255;
      const phase = ratio * 14 + x * 0.8 + y * 1.15;
      const colorIndex = Math.floor((amp * 9 + x + y) % 3);
      const color = colorIndex === 0 ? PRIMARY.red : colorIndex === 1 ? PRIMARY.yellow : PRIMARY.blue;

      ctx.save();
      ctx.translate(x * cellW + cellW / 2, y * cellH + cellH / 2);
      ctx.rotate(phase * 0.25 + amp * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + mix * 2;
      ctx.strokeRect(
        -cellW * 0.34 * (1 + amp * 0.4),
        -cellH * 0.28 * (1 + amp * 0.4),
        cellW * 0.68,
        cellH * 0.56
      );
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.03 + amp * 0.08})`;
        ctx.fillRect(-cellW * 0.14, -cellH * 0.12, cellW * 0.28, cellH * 0.24);
      }
      ctx.restore();
    }
  }
}

function drawCenterMark(w, h, stage) {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const pulseR = 12 + renderState.beatPulse * 26 + renderState.bass * 12;

  ctx.fillStyle = PRIMARY.white;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = stage % 3 === 1 ? PRIMARY.red : stage % 3 === 2 ? PRIMARY.yellow : PRIMARY.blue;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR + 15 + renderState.mids * 12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.font = "700 12px Manrope";
  ctx.fillText("ZONERS", cx - 22, cy + 4);
}

function drawHud(w, h, stage, progress) {
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "700 12px Manrope";
  ctx.fillText(`PRIMARY MODE`, 16, 20);
  ctx.fillText(`STAGE ${stage}/5`, 16, 38);
  ctx.fillText(
    progress.duration ? `${fmtTime(progress.elapsed)} / ${fmtTime(progress.duration)}` : `${fmtTime(progress.elapsed)} LIVE`,
    16,
    56
  );

  const meterW = Math.min(240, w * 0.3);
  const meterX = w - meterW - 18;
  const meterY = 20;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(meterX, meterY, meterW, 12);
  ctx.fillStyle = PRIMARY.yellow;
  ctx.fillRect(meterX + 1, meterY + 1, (meterW - 2) * Math.min(1, renderState.smoothEnergy), 10);
}

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const progress = currentProgress();
  analyzeFrame();
  const stage = updateReadouts(progress);

  drawBackground(w, h, renderState.beatPulse, progress.ratio);
  drawBars(w, h, stage);

  if (stage >= 2) drawRadialLines(w, h, progress.ratio);
  if (stage >= 3) drawWaveRibbon(w, h, progress.ratio);
  if (stage >= 4) drawBursts(w, h, progress.ratio);
  if (stage >= 5) drawKaleidoscope(w, h, progress.ratio);

  drawCenterMark(w, h, stage);
  drawHud(w, h, stage, progress);

  rafId = window.requestAnimationFrame(draw);
}

if (demoBtn) {
  demoBtn.addEventListener("click", () => {
    startDemoMode();
  });
}

if (tabBtn) {
  tabBtn.addEventListener("click", () => {
    startTabCaptureMode();
  });
}

if (micBtn) {
  micBtn.addEventListener("click", () => {
    startMicMode();
  });
}

if (fileBtn && fileInput) {
  fileBtn.addEventListener("click", () => {
    fileInput.click();
  });
  fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) {
      startFileMode(file);
    }
    event.target.value = "";
  });
}

if (document.visibilityState !== "hidden") {
  draw();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    return;
  }
  if (!rafId) {
    draw();
  }
});

startDemoMode();

if (donateSection && walletText && donateLink && copyWalletBtn) {
  const solAddress = donateSection.dataset.solAddress || "";
  const paymentUri = `solana:${solAddress}?label=${encodeURIComponent("LondyZone Donation")}`;

  walletText.textContent = solAddress;
  donateLink.setAttribute("href", paymentUri);

  copyWalletBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(solAddress);
      copyWalletBtn.textContent = "Copied";
      setTimeout(() => {
        copyWalletBtn.textContent = "Copy Wallet";
      }, 1400);
    } catch {
      copyWalletBtn.textContent = "Copy failed";
      setTimeout(() => {
        copyWalletBtn.textContent = "Copy Wallet";
      }, 1400);
    }
  });
}
