const canvas = document.getElementById("visualizer");
const ctx = canvas.getContext("2d");

const demoBtn = document.getElementById("viz-demo");
const tabBtn = document.getElementById("viz-tab");
const micBtn = document.getElementById("viz-mic");
const fileBtn = document.getElementById("viz-file-btn");
const fileInput = document.getElementById("viz-file");
const statusEl = document.getElementById("viz-status");
const stageEl = document.getElementById("viz-stage");
const timeEl = document.getElementById("viz-time");
const audioEl = document.getElementById("viz-audio");

const COLORS = {
  red: "#18d3c8",
  yellow: "#5ee7ff",
  blue: "#0f5dff",
  black: "#020202",
};

const PALETTE = [COLORS.red, COLORS.yellow, COLORS.blue];
const FISH_SPECIES = [
  { id: "minnow", segs: 7, bodyLen: 1.7, bodyWidth: 0.28, tailSize: 0.42, finScale: 0.5, speed: 1.2, size: [7, 12] },
  { id: "tuna", segs: 10, bodyLen: 2.1, bodyWidth: 0.44, tailSize: 0.58, finScale: 0.75, speed: 0.95, size: [12, 22] },
  { id: "reef", segs: 9, bodyLen: 1.55, bodyWidth: 0.52, tailSize: 0.35, finScale: 0.9, speed: 0.8, size: [10, 19] },
  { id: "raylet", segs: 8, bodyLen: 1.45, bodyWidth: 0.75, tailSize: 0.22, finScale: 1.25, speed: 0.7, size: [14, 26] },
];

let audioCtx;
let analyser;
let freqData;
let timeData;
let sourceNode;
let currentStream;
let currentMode = "demo";
let liveStart = performance.now();
let demoStart = performance.now();
let rafId = 0;

const renderState = {
  smoothEnergy: 0,
  bass: 0,
  mids: 0,
  highs: 0,
  beatPulse: 0,
  prevEnergy: 0,
};

const scene = {
  schools: [],
  fish: [],
  dolphins: [],
  sharks: [],
  particles: [],
  initialized: false,
  lastSpawnTick: 0,
  dolphinCooldown: 0,
  camera: { x: 0, y: 0, z: 0 },
  world: { width: 0, height: 0, depth: 0, near: 140, far: 2200 },
};

function pickSpecies(index = 0) {
  return FISH_SPECIES[index % FISH_SPECIES.length];
}

function fitCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

fitCanvas();
window.addEventListener("resize", fitCanvas);

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function getAudioContext() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error("Web Audio API unsupported");
    audioCtx = new Ctor();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.84;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
  }
  return audioCtx;
}

async function ensureAudioRunning() {
  const ref = getAudioContext();
  if (ref.state === "suspended") {
    await ref.resume();
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setActiveButton(mode) {
  [
    [demoBtn, "demo"],
    [tabBtn, "tab"],
    [micBtn, "mic"],
    [fileBtn, "file"],
  ].forEach(([btn, key]) => btn && btn.classList.toggle("is-active", key === mode));
}

function cleanupSource() {
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch {}
    sourceNode = null;
  }
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
  }
}

function connectAnalyser(node) {
  if (analyser) node.connect(analyser);
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
  setStatus("DEMO");
  if (audioCtx && audioCtx.state === "running") {
    try { await audioCtx.suspend(); } catch {}
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
    setStatus("MIC");
  } catch (err) {
    setStatus(`MIC BLOCKED`);
    console.error(err);
  }
}

async function startTabCaptureMode() {
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("getDisplayMedia unsupported");
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
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("No audio track shared");
    }
    currentStream = stream;
    sourceNode = getAudioContext().createMediaStreamSource(stream);
    connectAnalyser(sourceNode);
    currentMode = "tab";
    liveStart = performance.now();
    setActiveButton("tab");
    setStatus("TAB");
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", () => currentMode === "tab" && startDemoMode());
    });
  } catch (err) {
    setStatus("TAB BLOCKED");
    console.error(err);
  }
}

async function startFileMode(file) {
  if (!file) return;
  try {
    await ensureAudioRunning();
    cleanupSource();
    audioEl.src = URL.createObjectURL(file);
    sourceNode = connectMediaElement();
    connectAnalyser(sourceNode);
    await audioEl.play();
    currentMode = "file";
    liveStart = performance.now();
    setActiveButton("file");
    setStatus("FILE");
  } catch (err) {
    setStatus("FILE BLOCKED");
    console.error(err);
  }
}

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function currentProgress() {
  if (currentMode === "file" && audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
    const elapsed = audioEl.currentTime || 0;
    return { elapsed, duration: audioEl.duration, ratio: clamp(elapsed / audioEl.duration, 0, 1) };
  }
  if (currentMode === "demo") {
    const elapsed = ((performance.now() - demoStart) / 1000) % 210;
    return { elapsed, duration: 210, ratio: elapsed / 210 };
  }
  const elapsed = (performance.now() - liveStart) / 1000;
  const cycle = 180;
  return { elapsed, duration: null, ratio: (elapsed % cycle) / cycle };
}

function simulateAnalysis() {
  const t = performance.now() * 0.001;
  const section = ((performance.now() - demoStart) * 0.00012) % 1;
  const sectionLift = 0.08 + 0.28 * Math.sin(section * Math.PI) ** 2;

  const bass = 0.22 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.2 + 0.4)) + sectionLift;
  const mids = 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(t * 3.8 + 1.7));
  const highs = 0.12 + 0.24 * (0.5 + 0.5 * Math.sin(t * 6.1 + 0.6));
  const energy = clamp(bass * 0.45 + mids * 0.35 + highs * 0.2, 0, 1);

  renderState.smoothEnergy += (energy - renderState.smoothEnergy) * 0.18;
  renderState.bass += (bass - renderState.bass) * 0.2;
  renderState.mids += (mids - renderState.mids) * 0.18;
  renderState.highs += (highs - renderState.highs) * 0.16;
  const pseudoBeat = Math.max(0, Math.sin(t * (1.7 + renderState.bass * 0.9)));
  renderState.beatPulse = Math.max(renderState.beatPulse * 0.9, pseudoBeat * 0.65 + renderState.smoothEnergy * 0.25);

  if (freqData) {
    for (let i = 0; i < freqData.length; i += 1) {
      const x = i / freqData.length;
      const v =
        0.12 +
        renderState.bass * (1 - x) * 0.9 +
        renderState.mids * Math.max(0, 1 - Math.abs(x - 0.38) * 2.8) * 0.7 +
        renderState.highs * x * 0.75 +
        0.08 * Math.sin(i * 0.1 + t * (2 + x * 4));
      freqData[i] = clamp(Math.floor(v * 255), 0, 255);
    }
  }
  if (timeData) {
    for (let i = 0; i < timeData.length; i += 1) {
      const x = i / timeData.length;
      const y =
        Math.sin(x * 28 + t * 2.8) * renderState.bass * 0.45 +
        Math.sin(x * 61 - t * 5.4) * renderState.highs * 0.12;
      timeData[i] = Math.floor(128 + y * 110);
    }
  }
}

function analyzeFrame() {
  if (!analyser || currentMode === "demo") {
    simulateAnalysis();
    return;
  }

  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  let bass = 0;
  let mids = 0;
  let highs = 0;
  let total = 0;
  const n = freqData.length;
  const bassCut = Math.floor(n * 0.12);
  const midsCut = Math.floor(n * 0.46);

  for (let i = 0; i < n; i += 1) {
    const v = freqData[i] / 255;
    total += v;
    if (i < bassCut) bass += v;
    else if (i < midsCut) mids += v;
    else highs += v;
  }

  bass /= Math.max(1, bassCut);
  mids /= Math.max(1, midsCut - bassCut);
  highs /= Math.max(1, n - midsCut);

  const energy = total / n;
  renderState.smoothEnergy += (energy - renderState.smoothEnergy) * 0.22;
  renderState.bass += (bass - renderState.bass) * 0.2;
  renderState.mids += (mids - renderState.mids) * 0.17;
  renderState.highs += (highs - renderState.highs) * 0.18;

  const spike = Math.max(0, renderState.smoothEnergy - renderState.prevEnergy);
  renderState.beatPulse = Math.max(renderState.beatPulse * 0.87, spike * 5.5);
  renderState.prevEnergy = renderState.smoothEnergy;
}

function stageFromProgress(ratio) {
  return 1 + Math.min(4, Math.floor(ratio * 5));
}

function sceneWorldDims(w, h) {
  return {
    width: w * 2.8,
    height: h * 1.8,
    depth: 2200,
    near: 140,
    far: 2200,
  };
}

function wrapDepthRelative(relZ, world) {
  const span = world.far - world.near;
  while (relZ < world.near) relZ += span;
  while (relZ > world.far) relZ -= span;
  return relZ;
}

function projectWorldPoint(wx, wy, wz, w, h) {
  const world = scene.world;
  const relZ = wrapDepthRelative(wz - scene.camera.z, world);
  const depthNorm = 1 - (relZ - world.near) / (world.far - world.near);
  const persp = 220 / relZ;
  const x = w * 0.5 + (wx - scene.camera.x) * persp;
  const y = h * 0.5 + (wy - scene.camera.y) * persp;
  return { x, y, relZ, depthNorm, scale: clamp(persp * 7.5, 0.18, 3.6) };
}

function createFish(world, schoolIndex, colorIndex, cameraZ, speciesOverride) {
  const species = speciesOverride || pickSpecies(Math.floor(Math.random() * FISH_SPECIES.length));
  return {
    schoolIndex,
    speciesId: species.id,
    x: rand(-world.width * 0.5, world.width * 0.5),
    y: rand(-world.height * 0.5, world.height * 0.5),
    z: rand(cameraZ + world.near + 60, cameraZ + world.far),
    speed: rand(0.85, 1.25) * species.speed,
    size: rand(species.size[0], species.size[1]),
    phase: rand(0, Math.PI * 2),
    orbitR: rand(18, 220),
    orbitA: rand(0, Math.PI * 2),
    orbitSpeed: rand(-0.025, 0.025),
    wobble: rand(0.8, 3.2),
    dirBias: Math.random() < 0.5 ? -1 : 1,
    colorIndex,
    zOffset: rand(-220, 220),
    zDrift: rand(-0.8, 0.8),
    worldHeading: 0,
    heading: rand(-Math.PI, Math.PI),
    renderHeading: rand(-Math.PI, Math.PI),
    screenScale: 1,
    depthN: 0.5,
    vx: 0,
    vy: 0,
    vz: 0,
    prevSx: null,
    prevSy: null,
    trail: [],
  };
}

function createParticle(world, cameraZ) {
  return {
    x: rand(-world.width * 0.55, world.width * 0.55),
    y: rand(-world.height * 0.55, world.height * 0.55),
    z: rand(cameraZ + world.near, cameraZ + world.far),
    size: rand(1.5, 8),
    drift: rand(-1, 1),
    rise: rand(-0.4, 0.8),
    colorIndex: Math.floor(Math.random() * 3),
    spin: rand(0, Math.PI * 2),
  };
}

function updateReadout(progress) {
  const stage = stageFromProgress(progress.ratio);
  stageEl.textContent = `STAGE ${stage}`;
  timeEl.textContent = progress.duration
    ? `${fmtTime(progress.elapsed)}/${fmtTime(progress.duration)}`
    : `${fmtTime(progress.elapsed)} LIVE`;
  return stage;
}

function resetScene(w, h) {
  scene.schools = [];
  scene.fish = [];
  scene.dolphins = [];
  scene.sharks = [];
  scene.particles = [];
  scene.dolphinCooldown = 0;
  scene.camera = { x: 0, y: 0, z: 0 };
  scene.world = sceneWorldDims(w, h);

  const world = scene.world;

  for (let i = 0; i < 6; i += 1) {
    scene.schools.push({
      x: rand(-world.width * 0.5, world.width * 0.5),
      y: rand(-world.height * 0.28, world.height * 0.28),
      z: rand(world.near + 220, world.far),
      vx: rand(-1.2, 1.2),
      vy: rand(-0.45, 0.45),
      vz: rand(-0.3, 0.3),
      drift: rand(0, Math.PI * 2),
      colorIndex: i % 3,
      depthBias: rand(0.2, 1),
      speciesBias: i % FISH_SPECIES.length,
    });
  }

  for (let i = 0; i < 90; i += 1) {
    const schoolIndex = i % scene.schools.length;
    const school = scene.schools[schoolIndex];
    const species = pickSpecies(school.speciesBias + (i % 2 === 0 ? 0 : 1));
    const fish = createFish(world, schoolIndex, (schoolIndex + i) % 3, 0, species);
    scene.fish.push(fish);
  }

  for (let i = 0; i < 170; i += 1) {
    scene.particles.push(createParticle(world, 0));
  }

  scene.initialized = true;
}

function updateSchools(w, h, dt, progressRatio) {
  scene.world = sceneWorldDims(w, h);
  const world = scene.world;
  const drive = 0.25 + renderState.bass * 0.9;
  const camT = performance.now() * 0.001;
  scene.camera.x = Math.sin(camT * 0.22 + progressRatio * Math.PI * 2) * world.width * 0.03 * (0.4 + renderState.mids);
  scene.camera.y = Math.cos(camT * 0.17) * h * 0.03 * (0.35 + renderState.highs);
  scene.camera.z += dt * (65 + renderState.smoothEnergy * 180 + renderState.bass * 120);

  scene.schools.forEach((s, i) => {
    s.drift += dt * (0.2 + renderState.highs * 0.8) * (i % 2 ? 1 : -1);
    s.vx += Math.cos(s.drift + progressRatio * Math.PI * 2) * 0.02;
    s.vy += Math.sin(s.drift * 1.3) * 0.01;
    s.vz += Math.sin(s.drift * 0.7 + i) * 0.006;
    s.vx = clamp(s.vx, -1.8, 1.8);
    s.vy = clamp(s.vy, -0.9, 0.9);
    s.vz = clamp(s.vz, -0.7, 0.7);

    s.x += (s.vx + 0.35 * Math.sin(s.drift)) * dt * 60 * (0.6 + drive);
    s.y += (s.vy + 0.2 * Math.cos(s.drift * 0.8)) * dt * 60 * 0.7;
    s.z += (s.vz + 0.12 * Math.sin(s.drift * 0.5 + i)) * dt * 60;

    if (s.x < -world.width * 0.6) s.x = world.width * 0.6;
    if (s.x > world.width * 0.6) s.x = -world.width * 0.6;
    if (s.y < -world.height * 0.4) s.y = world.height * 0.4;
    if (s.y > world.height * 0.4) s.y = -world.height * 0.4;

    const relZ = wrapDepthRelative(s.z - scene.camera.z, world);
    s.z = scene.camera.z + relZ;
  });
}

function updateFish(w, h, dt, stage, progressRatio) {
  const world = scene.world;
  const targetCount = 48 + stage * 24;
  while (scene.fish.length < targetCount) {
    const schoolIndex = Math.floor(Math.random() * scene.schools.length);
    const school = scene.schools[schoolIndex];
    const species = pickSpecies(school.speciesBias + Math.floor(Math.random() * 2));
    scene.fish.push(createFish(world, schoolIndex, Math.floor(Math.random() * 3), scene.camera.z, species));
  }
  if (scene.fish.length > targetCount) {
    scene.fish.length = targetCount;
  }

  const energySpeed = 0.5 + renderState.smoothEnergy * 1.6;
  const bassSway = renderState.bass * 34;
  const highsJitter = renderState.highs * 4;
  const t = performance.now() * 0.001;
  const flowForward = 26 + renderState.smoothEnergy * 82 + renderState.bass * 60;

  scene.fish.forEach((f, index) => {
    const school = scene.schools[f.schoolIndex % scene.schools.length];
    f.orbitA += f.orbitSpeed * f.speed * (1 + renderState.mids * 2) * dt * 60;
    f.phase += dt * (f.wobble + renderState.highs * 4);

    const relDepth = wrapDepthRelative(f.z - scene.camera.z, world);
    const depthFactor = 1 - (relDepth - world.near) / (world.far - world.near);
    const schoolScale = (0.35 + depthFactor * 0.8) * (0.85 + stage * 0.05);
    const targetX = school.x + Math.cos(f.orbitA + index * 0.13) * f.orbitR * schoolScale;
    const targetY = school.y + Math.sin(f.orbitA * 1.3 + index * 0.11) * f.orbitR * 0.45 * schoolScale;
    const targetZ = school.z + f.zOffset + Math.sin(f.phase * 0.55 + index) * (18 + renderState.bass * 40);

    const flowX = (Math.sin(t * 0.45 + index * 0.17) * 0.3 + f.dirBias * 0.18) * energySpeed * f.speed;
    const flowY = Math.sin(f.phase * 0.9 + progressRatio * 8) * (2.5 + bassSway * 0.08);
    const flowZ = (f.zDrift + Math.sin(t * 0.28 + index * 0.12) * 0.18) * 6;

    const ax = (targetX - f.x) * (0.0018 + 0.0018 * depthFactor) + flowX * 0.05;
    const ay = (targetY - f.y) * (0.0022 + 0.0018 * depthFactor) + (flowY + Math.sin(t * 2 + index) * highsJitter) * 0.03;
    const az = (targetZ - f.z) * 0.0014 + (flowZ - flowForward) * 0.03;

    f.vx = (f.vx + ax * dt * 60) * 0.94;
    f.vy = (f.vy + ay * dt * 60) * 0.94;
    f.vz = (f.vz + az * dt * 60) * 0.95;

    const maxVX = (12 + renderState.smoothEnergy * 12) * f.speed;
    const maxVY = (8 + renderState.bass * 8) * (0.75 + f.speed * 0.25);
    const maxVZ = (24 + renderState.smoothEnergy * 16) * (0.8 + f.speed * 0.2);
    f.vx = clamp(f.vx, -maxVX, maxVX);
    f.vy = clamp(f.vy, -maxVY, maxVY);
    f.vz = clamp(f.vz, -maxVZ, maxVZ);

    f.x += f.vx * dt * 20;
    f.y += f.vy * dt * 20;
    f.z += f.vz * dt * 20;

    if (f.x < -world.width * 0.65) f.x = world.width * 0.65;
    if (f.x > world.width * 0.65) f.x = -world.width * 0.65;
    if (f.y < -world.height * 0.55) f.y = world.height * 0.55;
    if (f.y > world.height * 0.55) f.y = -world.height * 0.55;

    let relZNow = f.z - scene.camera.z;
    const span = world.far - world.near;
    while (relZNow < world.near) {
      relZNow += span;
      f.z = scene.camera.z + relZNow;
      f.x = school.x + rand(-world.width * 0.15, world.width * 0.15);
      f.y = school.y + rand(-world.height * 0.12, world.height * 0.12);
      f.vx *= 0.2;
      f.vy *= 0.2;
      f.vz *= 0.2;
      f.trail.length = 0;
    }
    while (relZNow > world.far) {
      relZNow -= span;
      f.z = scene.camera.z + relZNow;
      f.vx *= 0.2;
      f.vy *= 0.2;
      f.vz *= 0.2;
      f.trail.length = 0;
    }

    const desiredHeading = Math.atan2(f.vy * 0.7 + (targetY - f.y) * 0.02, f.vx + (targetX - f.x) * 0.02);
    let delta = desiredHeading - f.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    f.heading += delta * 0.1;
    f.worldHeading = f.heading;

    const proj = projectWorldPoint(f.x, f.y, f.z, w, h);
    f.sx = proj.x;
    f.sy = proj.y;
    f.screenScale = proj.scale;
    f.depthN = proj.depthNorm;

    if (f.prevSx !== null && f.prevSy !== null) {
      const dxs = f.sx - f.prevSx;
      const dys = f.sy - f.prevSy;
      const mag2 = dxs * dxs + dys * dys;
      if (mag2 > 0.04) {
        const desiredRenderHeading = Math.atan2(dys, dxs);
        let rDelta = desiredRenderHeading - f.renderHeading;
        while (rDelta > Math.PI) rDelta -= Math.PI * 2;
        while (rDelta < -Math.PI) rDelta += Math.PI * 2;
        f.renderHeading += rDelta * 0.22;
      }
    } else {
      f.renderHeading = f.heading;
    }

    f.renderHeading += Math.sin(f.phase * 0.55) * 0.006;
    f.prevSx = f.sx;
    f.prevSy = f.sy;

    if (stage >= 3) {
      f.trail.push({ x: f.sx, y: f.sy });
      if (f.trail.length > 5 + stage) f.trail.shift();
    } else {
      f.trail.length = 0;
    }
  });
}

function maybeSpawnDolphin(w, h, stage) {
  if (stage < 3) return;
  scene.dolphinCooldown -= 1 / 60;
  const trigger = renderState.beatPulse > 0.35 + (stage < 5 ? 0.14 : 0.02);
  if (!trigger || scene.dolphinCooldown > 0 || Math.random() > 0.04 + stage * 0.008) return;
  const world = scene.world;
  const duration = rand(3.2, 6.4);
  const startZ = scene.camera.z + rand(world.near + 260, world.far - 120);
  const startX = rand(-world.width * 0.45, world.width * 0.45);
  const endX = clamp(startX + rand(-world.width * 0.35, world.width * 0.35), -world.width * 0.48, world.width * 0.48);
  const baseY = rand(-world.height * 0.2, world.height * 0.15);
  scene.dolphins.push({
    t: 0,
    duration,
    x: startX,
    y: baseY,
    z: startZ,
    startX,
    endX,
    baseY,
    baseZ: startZ,
    zDrift: rand(-180, 180),
    zTravel: rand(-260, -40),
    arc: rand(80, 220) * (Math.random() < 0.5 ? -1 : 1),
    size: rand(42, 95) * (0.8 + renderState.bass * 0.8),
    color: PALETTE[Math.floor(Math.random() * 3)],
    spin: rand(-0.35, 0.35),
    phase: rand(0, Math.PI * 2),
    heading: rand(-Math.PI, Math.PI),
  });
  scene.dolphinCooldown = rand(4.5, 10.5) - stage * 0.8;
}

function maybeSpawnShark(stage) {
  if (stage < 4) return;
  const trigger = renderState.bass > 0.24 && renderState.beatPulse > 0.16;
  if (!trigger || Math.random() > 0.012 + stage * 0.004) return;
  if (scene.sharks.length > 1) return;

  const world = scene.world;
  const startZ = scene.camera.z + rand(world.near + 380, world.far - 180);
  const startX = Math.random() < 0.5 ? -world.width * 0.52 : world.width * 0.52;
  const endX = -startX * rand(0.65, 0.95);
  const baseY = rand(-world.height * 0.18, world.height * 0.12);
  scene.sharks.push({
    t: 0,
    duration: rand(5.2, 8.2),
    startX,
    endX,
    x: startX,
    y: baseY,
    z: startZ,
    baseY,
    baseZ: startZ,
    zTravel: rand(-180, 120),
    zDrift: rand(60, 220),
    arc: rand(40, 120) * (Math.random() < 0.5 ? -1 : 1),
    size: rand(70, 150) * (0.9 + renderState.bass * 0.5),
    color: PALETTE[Math.floor(Math.random() * 3)],
    phase: rand(0, Math.PI * 2),
    heading: 0,
  });
}

function updateDolphins(dt) {
  scene.dolphins.forEach((d) => {
    d.t += dt;
    const p = clamp(d.t / d.duration, 0, 1);
    const ease = p * p * (3 - 2 * p);
    d.x = d.startX + (d.endX - d.startX) * ease;
    d.y = d.baseY - Math.sin(p * Math.PI) * d.arc + Math.sin(d.phase + d.t * 3.2) * 18;
    d.z = d.baseZ + d.zTravel * ease + Math.sin(d.phase + d.t * 1.8) * d.zDrift * 0.25;
    const vx = (d.endX - d.startX) / d.duration;
    const vy = (-Math.cos(p * Math.PI) * d.arc * Math.PI) / d.duration;
    d.heading = Math.atan2(vy, vx) + d.spin * 0.1;
  });
  scene.dolphins = scene.dolphins.filter((d) => {
    if (d.t >= d.duration) return false;
    const relZ = wrapDepthRelative(d.z - scene.camera.z, scene.world);
    return relZ >= scene.world.near && relZ <= scene.world.far;
  });
}

function updateSharks(dt) {
  scene.sharks.forEach((s) => {
    s.t += dt;
    const p = clamp(s.t / s.duration, 0, 1);
    const ease = p * p * (3 - 2 * p);
    s.x = s.startX + (s.endX - s.startX) * ease;
    s.y = s.baseY - Math.sin(p * Math.PI) * s.arc * 0.45 + Math.sin(s.phase + s.t * 1.7) * 14;
    s.z = s.baseZ + s.zTravel * ease + Math.sin(s.phase + s.t * 1.2) * s.zDrift * 0.2;
    const vx = (s.endX - s.startX) / s.duration;
    const vy = (-Math.cos(p * Math.PI) * s.arc * 0.45 * Math.PI) / s.duration;
    s.heading = Math.atan2(vy, vx);
  });
  scene.sharks = scene.sharks.filter((s) => s.t < s.duration);
}

function updateParticles(dt) {
  const world = scene.world;
  const target = 150 + Math.floor(renderState.smoothEnergy * 110);
  while (scene.particles.length < target) {
    scene.particles.push(createParticle(world, scene.camera.z));
  }
  if (scene.particles.length > target) {
    scene.particles.length = target;
  }

  const driftX = (renderState.mids - 0.4) * 18;
  const rise = (renderState.highs - 0.35) * 10;
  scene.particles.forEach((p, i) => {
    p.spin += dt * (0.4 + (i % 7) * 0.08);
    p.x += (p.drift * 9 + driftX + Math.sin(p.spin + i) * 1.2) * dt;
    p.y += (p.rise * 7 - rise + Math.cos(p.spin * 1.4) * 0.8) * dt;
    p.z -= dt * (26 + renderState.smoothEnergy * 95 + p.size * 2);

    if (p.x < -world.width * 0.65) p.x = world.width * 0.65;
    if (p.x > world.width * 0.65) p.x = -world.width * 0.65;
    if (p.y < -world.height * 0.65) p.y = world.height * 0.65;
    if (p.y > world.height * 0.65) p.y = -world.height * 0.65;

    let relZ = p.z - scene.camera.z;
    const span = world.far - world.near;
    while (relZ < world.near) {
      relZ += span;
      p.z = scene.camera.z + relZ;
      p.x = rand(-world.width * 0.55, world.width * 0.55);
      p.y = rand(-world.height * 0.55, world.height * 0.55);
    }
    while (relZ > world.far) {
      relZ -= span;
      p.z = scene.camera.z + relZ;
    }
  });
}

function drawCaustics(w, h, stage) {
  const t = performance.now() * 0.001;
  for (let layer = 0; layer < 3 + stage; layer += 1) {
    const z = scene.camera.z + 260 + layer * 140 + Math.sin(t * 0.6 + layer) * 50;
    const left = projectWorldPoint(-scene.world.width * 0.4, -scene.world.height * 0.22 + layer * 16, z, w, h);
    const right = projectWorldPoint(scene.world.width * 0.4, -scene.world.height * 0.25 + layer * 12, z, w, h);
    const c = PALETTE[layer % 3];
    ctx.strokeStyle = `${c}${(16 + layer * 4).toString(16).padStart(2, "0")}`;
    ctx.lineWidth = 1 + left.scale * 0.22;
    ctx.beginPath();
    for (let i = 0; i <= 10; i += 1) {
      const p = i / 10;
      const x = left.x + (right.x - left.x) * p;
      const y =
        left.y + (right.y - left.y) * p +
        Math.sin(p * Math.PI * (2 + layer * 0.3) + t * (1.5 + layer * 0.1)) * (8 + layer * 2 + renderState.beatPulse * 10);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawParticles(w, h) {
  scene.particles.forEach((p) => {
    const proj = projectWorldPoint(p.x, p.y, p.z, w, h);
    if (proj.x < -40 || proj.x > w + 40 || proj.y < -40 || proj.y > h + 40) return;
    const size = p.size * proj.scale * (0.5 + renderState.highs * 0.5);
    if (size < 0.6) return;
    const c = PALETTE[p.colorIndex % 3];
    ctx.fillStyle = `${c}${Math.round((0.06 + proj.depthNorm * 0.18) * 255).toString(16).padStart(2, "0")}`;
    ctx.beginPath();
    ctx.moveTo(proj.x, proj.y - size);
    ctx.lineTo(proj.x + size * 0.85, proj.y);
    ctx.lineTo(proj.x, proj.y + size);
    ctx.lineTo(proj.x - size * 0.85, proj.y);
    ctx.closePath();
    ctx.fill();
  });
}

function drawBackground(w, h, stage, progressRatio) {
  ctx.fillStyle = COLORS.black;
  ctx.fillRect(0, 0, w, h);

  const t = performance.now() * 0.001;
  const horizon = h * (0.18 + 0.03 * Math.sin(progressRatio * Math.PI * 2));

  const water = ctx.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, "rgba(15,93,255,0.18)");
  water.addColorStop(0.36, "rgba(94,231,255,0.05)");
  water.addColorStop(0.7, "rgba(24,211,200,0.06)");
  water.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 7 + stage; i += 1) {
    const x = ((i * 160) + t * (8 + i)) % (w + 240) - 120;
    const beamW = 36 + (i % 4) * 10;
    const c = PALETTE[i % 3];
    ctx.fillStyle = `${c}10`;
    ctx.beginPath();
    ctx.moveTo(x, -10);
    ctx.lineTo(x + beamW, -10);
    ctx.lineTo(x + beamW * 2.7, h * 0.82);
    ctx.lineTo(x + beamW * 1.5, h * 0.82);
    ctx.closePath();
    ctx.fill();
  }

  const ridgeLayers = 3 + Math.min(stage, 3);
  for (let layer = 0; layer < ridgeLayers; layer += 1) {
    const yBase = h * (0.72 + layer * 0.07);
    const amp = h * (0.05 + layer * 0.015);
    const color = PALETTE[layer % 3];
    ctx.beginPath();
    ctx.moveTo(-40, h + 40);
    for (let x = -40; x <= w + 40; x += 42) {
      const y =
        yBase -
        Math.abs(Math.sin(x * 0.006 + t * (0.22 + layer * 0.08) + layer)) * amp -
        Math.sin(x * 0.016 + layer * 2.1) * amp * 0.22;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w + 40, h + 40);
    ctx.closePath();
    ctx.fillStyle = `${color}${(16 + layer * 10).toString(16).padStart(2, "0")}`;
    ctx.fill();
    ctx.strokeStyle = `${color}2a`;
    ctx.stroke();
  }

  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i += 1) {
    const drift = (t * (10 + (i % 5) * 3) + i * 47) % (w + 200) - 100;
    const y = h * (0.12 + (i % 10) * 0.06) + Math.sin(t * 0.9 + i) * 8;
    const c = PALETTE[i % 3];
    ctx.strokeStyle = `${c}1e`;
    ctx.beginPath();
    ctx.moveTo(drift, y);
    ctx.lineTo(drift + 24, y - 8);
    ctx.lineTo(drift + 42, y);
    ctx.lineTo(drift + 20, y + 10);
    ctx.closePath();
    ctx.stroke();
  }

  if (stage >= 3) {
    ctx.strokeStyle = `${PALETTE[(stage + 1) % 3]}22`;
    for (let i = 0; i < 8 + stage; i += 1) {
      const p = i / (8 + stage);
      const y = horizon + p * h * 0.55 + Math.sin(t * 0.6 + i) * 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + Math.sin(i + t) * 10);
      ctx.stroke();
    }
  }
}

function transformPoint(px, py, x, y, angle, scale) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return {
    x: x + (px * ca - py * sa) * scale,
    y: y + (px * sa + py * ca) * scale,
  };
}

function drawPoly(points, color, alphaFill = 0.18, alphaStroke = 0.65) {
  ctx.fillStyle = `${color}${Math.round(alphaFill * 255).toString(16).padStart(2, "0")}`;
  ctx.strokeStyle = `${color}${Math.round(alphaStroke * 255).toString(16).padStart(2, "0")}`;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawFacet(points, color, alpha = 0.22) {
  ctx.fillStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawFish(f, stage) {
  if (!Number.isFinite(f.sx) || !Number.isFinite(f.sy)) return;
  if (f.sx < -120 || f.sx > canvas.clientWidth + 120 || f.sy < -120 || f.sy > canvas.clientHeight + 120) return;
  const pulse = 1 + renderState.beatPulse * 0.12 + f.depthN * 0.05;
  const scale = f.size * f.screenScale * pulse;
  if (scale < 2) return;
  const species = FISH_SPECIES.find((s) => s.id === f.speciesId) || FISH_SPECIES[1];
  const tailSwing = Math.sin(f.phase * 2.4) * (0.1 + renderState.highs * 0.12);
  const bodyAngle = f.renderHeading ?? f.heading;
  const tailAngle = bodyAngle + tailSwing * (f.dirBias < 0 ? -1 : 1);
  const color = PALETTE[f.colorIndex % 3];

  if (stage >= 3 && f.trail.length > 1) {
    ctx.strokeStyle = `${color}33`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(f.trail[0].x, f.trail[0].y);
    for (let i = 1; i < f.trail.length; i += 1) ctx.lineTo(f.trail[i].x, f.trail[i].y);
    ctx.stroke();
  }

  const segs = species.segs;
  const spine = [];
  const top = [];
  const bot = [];
  const bodyLen = species.bodyLen;
  const bodyW = species.bodyWidth;
  for (let i = 0; i < segs; i += 1) {
    const u = i / (segs - 1);
    const localX = -bodyLen * 0.5 + u * bodyLen;
    const bodyProfile = Math.sin(u * Math.PI);
    const rayWing = species.id === "raylet" ? Math.sin(u * Math.PI * 1.2) * 0.16 : 0;
    const taper = 0.04 + bodyProfile * (bodyW - (u > 0.8 ? (u - 0.8) * bodyW * 1.25 : 0)) + rayWing;
    const wave = Math.sin(f.phase * 2 + u * 5.2) * (species.id === "raylet" ? 0.1 : 0.05) * (1 - u * 0.7);
    const p = transformPoint(localX, wave, f.sx, f.sy, bodyAngle, scale);
    spine.push(p);
    top.push(transformPoint(localX, wave - taper, f.sx, f.sy, bodyAngle, scale));
    bot.push(transformPoint(localX, wave + taper, f.sx, f.sy, bodyAngle, scale));
  }

  const tailBase = spine[0];
  const tail = [
    tailBase,
    transformPoint(-(bodyLen * 0.62), -0.12, f.sx, f.sy, tailAngle, scale),
    transformPoint(-(bodyLen * 0.95), -(species.tailSize * 0.9), f.sx, f.sy, tailAngle, scale * 0.94),
    transformPoint(-(bodyLen * 0.78), 0.0, f.sx, f.sy, tailAngle, scale * 0.94),
    transformPoint(-(bodyLen * 0.95), species.tailSize * 0.9, f.sx, f.sy, tailAngle, scale * 0.94),
    transformPoint(-(bodyLen * 0.62), 0.12, f.sx, f.sy, tailAngle, scale),
  ];

  ctx.lineWidth = 0.7 + f.screenScale * 0.7;
  for (let i = 0; i < segs - 1; i += 1) {
    const quad = [top[i], top[i + 1], bot[i + 1], bot[i]];
    const upperTri = [spine[i], top[i], top[i + 1]];
    const lowerTri = [spine[i], bot[i], bot[i + 1]];
    const shade = i / (segs - 1);

    drawPoly(quad, color, 0.06 + f.depthN * 0.08 + shade * 0.03, 0.15 + f.depthN * 0.25);
    drawFacet(upperTri, "#ffffff", 0.03 + (1 - shade) * 0.04 + renderState.beatPulse * 0.015);
    drawFacet(lowerTri, "#000000", 0.03 + shade * 0.03);

    if (stage >= 3 && i % 2 === 0) {
      ctx.strokeStyle = `${color}55`;
      ctx.beginPath();
      ctx.moveTo(top[i].x, top[i].y);
      ctx.lineTo(bot[i].x, bot[i].y);
      ctx.stroke();
    }
  }

  drawPoly(tail, color, 0.06 + f.depthN * 0.1, 0.2 + f.depthN * 0.26);
  drawFacet([tail[0], tail[1], tail[2]], "#ffffff", 0.04);
  drawFacet([tail[0], tail[5], tail[4]], "#000000", 0.04);

  const dorsal = [
    transformPoint(-0.08 * bodyLen, -0.02, f.sx, f.sy, bodyAngle, scale),
    transformPoint(0.14 * bodyLen, -(0.26 + species.finScale * 0.32), f.sx, f.sy, bodyAngle, scale),
    transformPoint(0.34 * bodyLen, -0.04, f.sx, f.sy, bodyAngle, scale),
  ];
  const pectoralTop = [
    transformPoint(0.0, -0.02, f.sx, f.sy, bodyAngle, scale),
    transformPoint(0.2 + species.finScale * 0.08, -(0.12 + species.finScale * 0.12), f.sx, f.sy, bodyAngle, scale * 0.95),
    transformPoint(0.42, -0.02, f.sx, f.sy, bodyAngle, scale),
  ];
  const pectoralBot = [
    transformPoint(0.0, 0.02, f.sx, f.sy, bodyAngle, scale),
    transformPoint(0.2 + species.finScale * 0.08, 0.12 + species.finScale * 0.12, f.sx, f.sy, bodyAngle, scale * 0.95),
    transformPoint(0.44, 0.02, f.sx, f.sy, bodyAngle, scale),
  ];
  drawPoly(dorsal, color, 0.04, 0.18);
  drawPoly(pectoralTop, color, 0.03, 0.14);
  drawPoly(pectoralBot, color, 0.03, 0.14);

  if (stage >= 2) {
    const eyeTri = [
      transformPoint(0.7, -0.03, f.sx, f.sy, bodyAngle, scale * 0.52),
      transformPoint(0.82, 0.0, f.sx, f.sy, bodyAngle, scale * 0.52),
      transformPoint(0.7, 0.03, f.sx, f.sy, bodyAngle, scale * 0.52),
    ];
    drawFacet(eyeTri, "#ffffff", 0.14);
  }
}

function drawDolphin(d) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const proj = projectWorldPoint(d.x, d.y, d.z, w, h);
  if (proj.x < -240 || proj.x > w + 240 || proj.y < -240 || proj.y > h + 240) return;
  const p = d.t / d.duration;
  const x = proj.x;
  const y = proj.y;
  const angle = d.heading;
  const s = d.size * proj.scale * (0.7 + renderState.bass * 0.25 + Math.sin(p * Math.PI) * 0.1);
  if (s < 6) return;

  const segs = 11;
  const spine = [];
  const top = [];
  const bot = [];
  for (let i = 0; i < segs; i += 1) {
    const u = i / (segs - 1);
    const lx = -1.05 + u * 2.55;
    const width = (Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.9) * (0.28 - Math.max(0, u - 0.8) * 0.16);
    const bend = Math.sin(d.t * 8 + u * 6) * 0.03 * (1 - u);
    spine.push(transformPoint(lx, bend, x, y, angle, s));
    top.push(transformPoint(lx, bend - width, x, y, angle, s));
    bot.push(transformPoint(lx, bend + width, x, y, angle, s));
  }

  const tail = [
    spine[0],
    transformPoint(-1.34, -0.13, x, y, angle, s),
    transformPoint(-1.88, -0.46, x, y, angle - Math.sin(d.t * 10) * 0.08, s),
    transformPoint(-1.58, 0, x, y, angle - Math.sin(d.t * 10) * 0.08, s),
    transformPoint(-1.88, 0.46, x, y, angle - Math.sin(d.t * 10) * 0.08, s),
    transformPoint(-1.34, 0.13, x, y, angle, s),
  ];

  ctx.lineWidth = 1.2 + Math.sin(p * Math.PI) * 0.8;
  for (let i = 0; i < segs - 1; i += 1) {
    const q = [top[i], top[i + 1], bot[i + 1], bot[i]];
    const upper = [spine[i], top[i], top[i + 1]];
    const lower = [spine[i], bot[i], bot[i + 1]];
    const shade = i / (segs - 1);
    drawPoly(q, d.color, 0.06 + shade * 0.04, 0.22 + shade * 0.3);
    drawFacet(upper, "#ffffff", 0.03 + (1 - shade) * 0.05);
    drawFacet(lower, "#000000", 0.03 + shade * 0.03);
  }

  drawPoly(tail, d.color, 0.06, 0.38);
  drawFacet([tail[0], tail[1], tail[2]], "#ffffff", 0.04);
  drawFacet([tail[0], tail[5], tail[4]], "#000000", 0.04);

  const dorsal = [
    transformPoint(0.1, -0.03, x, y, angle, s),
    transformPoint(0.34, -0.5, x, y, angle, s),
    transformPoint(0.62, -0.05, x, y, angle, s),
  ];
  drawPoly(dorsal, d.color, 0.04, 0.22);
}

function drawShark(s) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const proj = projectWorldPoint(s.x, s.y, s.z, w, h);
  if (proj.x < -280 || proj.x > w + 280 || proj.y < -240 || proj.y > h + 240) return;
  const size = s.size * proj.scale * (0.85 + renderState.bass * 0.18);
  if (size < 8) return;
  const angle = s.heading;
  const x = proj.x;
  const y = proj.y;

  const segs = 9;
  const spine = [];
  const top = [];
  const bot = [];
  for (let i = 0; i < segs; i += 1) {
    const u = i / (segs - 1);
    const lx = -1.2 + u * 2.6;
    const width = (Math.sin(u * Math.PI) ** 0.8) * (0.22 + (u < 0.55 ? 0.12 : 0.02));
    const bend = Math.sin(s.t * 5 + u * 7) * 0.025 * (1 - u);
    spine.push(transformPoint(lx, bend, x, y, angle, size));
    top.push(transformPoint(lx, bend - width, x, y, angle, size));
    bot.push(transformPoint(lx, bend + width, x, y, angle, size));
  }

  for (let i = 0; i < segs - 1; i += 1) {
    const q = [top[i], top[i + 1], bot[i + 1], bot[i]];
    const upper = [spine[i], top[i], top[i + 1]];
    const lower = [spine[i], bot[i], bot[i + 1]];
    const shade = i / (segs - 1);
    drawPoly(q, s.color, 0.05 + shade * 0.035, 0.18 + shade * 0.24);
    drawFacet(upper, "#ffffff", 0.02 + (1 - shade) * 0.035);
    drawFacet(lower, "#000000", 0.03 + shade * 0.04);
  }

  const tail = [
    spine[0],
    transformPoint(-1.46, -0.12, x, y, angle, size),
    transformPoint(-2.1, -0.5, x, y, angle - Math.sin(s.t * 7) * 0.06, size),
    transformPoint(-1.72, 0, x, y, angle - Math.sin(s.t * 7) * 0.06, size),
    transformPoint(-2.1, 0.5, x, y, angle - Math.sin(s.t * 7) * 0.06, size),
    transformPoint(-1.46, 0.12, x, y, angle, size),
  ];
  drawPoly(tail, s.color, 0.05, 0.24);

  const dorsal = [
    transformPoint(0.1, -0.03, x, y, angle, size),
    transformPoint(0.28, -0.72, x, y, angle, size),
    transformPoint(0.6, -0.05, x, y, angle, size),
  ];
  const pectoralL = [
    transformPoint(0.05, -0.03, x, y, angle, size),
    transformPoint(0.55, -0.34, x, y, angle, size),
    transformPoint(0.48, -0.02, x, y, angle, size),
  ];
  const pectoralR = [
    transformPoint(0.05, 0.03, x, y, angle, size),
    transformPoint(0.55, 0.34, x, y, angle, size),
    transformPoint(0.48, 0.02, x, y, angle, size),
  ];
  drawPoly(dorsal, s.color, 0.04, 0.2);
  drawPoly(pectoralL, s.color, 0.04, 0.18);
  drawPoly(pectoralR, s.color, 0.04, 0.18);
}

function drawHUD(w, h, stage) {
  const meterW = Math.min(220, w * 0.22);
  const x = 14;
  const y = 14;

  ctx.strokeStyle = `${COLORS.red}66`;
  ctx.strokeRect(x, y, meterW, 8);
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(x + 1, y + 1, (meterW - 2) * clamp(renderState.bass, 0, 1), 6);

  ctx.strokeStyle = `${COLORS.yellow}66`;
  ctx.strokeRect(x, y + 13, meterW, 8);
  ctx.fillStyle = COLORS.yellow;
  ctx.fillRect(x + 1, y + 14, (meterW - 2) * clamp(renderState.mids, 0, 1), 6);

  ctx.strokeStyle = `${COLORS.blue}66`;
  ctx.strokeRect(x, y + 26, meterW, 8);
  ctx.fillStyle = COLORS.blue;
  ctx.fillRect(x + 1, y + 27, (meterW - 2) * clamp(renderState.highs, 0, 1), 6);

  ctx.font = "700 11px Orbitron";
  ctx.fillStyle = stage % 3 === 1 ? COLORS.red : stage % 3 === 2 ? COLORS.yellow : COLORS.blue;
  ctx.fillText("OCEAN CURRENT VISUALIZER", x, y + 50);
}

function updateAndRender(dt, progress, stage) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!scene.initialized) resetScene(w, h);

  updateSchools(w, h, dt, progress.ratio);
  updateFish(w, h, dt, stage, progress.ratio);
  maybeSpawnDolphin(w, h, stage);
  maybeSpawnShark(stage);
  updateDolphins(dt);
  updateSharks(dt);
  updateParticles(dt);

  drawBackground(w, h, stage, progress.ratio);
  drawCaustics(w, h, stage);
  drawParticles(w, h);

  const sortedFish = [...scene.fish].sort((a, b) => a.depthN - b.depthN);
  sortedFish.forEach((f) => drawFish(f, stage));
  [...scene.sharks]
    .sort((a, b) => (a.z - scene.camera.z) - (b.z - scene.camera.z))
    .forEach(drawShark);
  [...scene.dolphins]
    .sort((a, b) => (a.z - scene.camera.z) - (b.z - scene.camera.z))
    .forEach(drawDolphin);

  if (stage >= 4) {
    const c = PALETTE[(stage + 1) % 3];
    ctx.strokeStyle = `${c}26`;
    for (let i = 0; i < 6; i += 1) {
      const p = (performance.now() * 0.0002 + i / 6) % 1;
      const y = h * (0.15 + p * 0.55);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + Math.sin(p * Math.PI * 8) * 14);
      ctx.stroke();
    }
  }

  drawHUD(w, h, stage);
}

let lastFrameMs = performance.now();
function draw() {
  const now = performance.now();
  const dt = clamp((now - lastFrameMs) / 1000, 0.001, 0.05);
  lastFrameMs = now;

  const progress = currentProgress();
  analyzeFrame();
  const stage = updateReadout(progress);
  updateAndRender(dt, progress, stage);

  rafId = requestAnimationFrame(draw);
}

demoBtn?.addEventListener("click", () => startDemoMode());
tabBtn?.addEventListener("click", () => startTabCaptureMode());
micBtn?.addEventListener("click", () => startMicMode());
fileBtn?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) startFileMode(file);
  event.target.value = "";
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    return;
  }
  if (!rafId) {
    lastFrameMs = performance.now();
    draw();
  }
});

startDemoMode();
draw();
