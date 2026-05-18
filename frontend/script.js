const sidebar = document.querySelector("[data-sidebar]");
const menuButton = document.querySelector("[data-menu-button]");
const navLinks = Array.from(document.querySelectorAll(".side-nav a"));
const clock = document.querySelector("[data-clock]");
const uptime = document.querySelector("[data-uptime]");
const video = document.querySelector("#cameraVideo");
const canvas = document.querySelector("#eyeCanvas");
const cameraFrame = document.querySelector("[data-camera-frame]");
const cameraFullscreenButton = document.querySelector("[data-camera-fullscreen]");
const ctx = canvas.getContext("2d", { alpha: false });

const DEFAULT_CALIBRATION_SECONDS = 4;
const MIN_CALIBRATION_SAMPLES = 8;
const MIN_OPEN_GAP_FOR_CALIBRATION = 0.006;
const CLOSED_THRESHOLD_FACTOR = 0.55;
const MIN_CLOSED_THRESHOLD = 0.006;
const MAX_CLOSED_THRESHOLD = 0.09;
const DIRECTION_ACTIVATION_RATIO = 0.35;
const MIN_DIRECTION_OFFSET = 0.001;
const LONG_CLOSE_SECONDS = 5;
const FAST_BLINK_MIN_SECONDS = 0.05;
const FAST_BLINK_MAX_SECONDS = 0.7;
const DOUBLE_BLINK_WINDOW_SECONDS = 1.2;
const SMOOTHING_FRAMES = 3;
const MESSAGE_COOLDOWN_MS = 450;
const MIRROR_CAMERA = true;

const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];
const LEFT_TOP = [158, 159, 160];
const LEFT_BOTTOM = [144, 145, 153];
const RIGHT_TOP = [385, 386, 387];
const RIGHT_BOTTOM = [373, 374, 380];
const LEFT_CORNERS = [33, 133];
const RIGHT_CORNERS = [362, 263];

const TARGET_BY_KEY = {
  b: "bottom",
  c: "center",
  t: "top",
};

const TARGET_LABEL = {
  top: "ATAS",
  center: "TENGAH",
  bottom: "BAWAH",
};

const directions = [
  { id: 0, label: "ATAS", name: "Atas", message: "Arah atas terdeteksi" },
  { id: 1, label: "BAWAH", name: "Bawah", message: "Arah bawah terdeteksi" },
];

const directionsByLabel = new Map(directions.map((direction) => [direction.label, direction]));

const state = {
  startedAt: Date.now(),
  muted: false,
  blinkCount: 0,
  currentMessage: "Menunggu input pasien",
  clickStatus: "BELUM ADA KLIK",
  cameraActive: false,
  cameraStarting: false,
  cameraFullscreen: false,
  fallbackFullscreen: false,
  faceVisible: false,
  mode: "calibration",
  profile: null,
  calibration: createCalibrationState("Kalibrasi dulu: tekan B, C, atau T."),
  eyeClosed: false,
  closedStartedAt: 0,
  longBlinkSent: false,
  quickBlinks: [],
  directionHistory: [],
  stableDirection: "-",
  lastProgramDirection: "-",
  lastDisplayDirection: "-",
  lastEyeState: "WAJAH TIDAK TERBACA",
  lastConfidence: 0,
  lastAutoMessageAt: -MESSAGE_COOLDOWN_MS,
  lastFrameAt: 0,
  fps: 0,
  latency: 0,
  lastInferenceStartedAt: 0,
  lastFeatures: null,
  lastCanvasMap: null,
  output: "MENUNGGU",
  logs: [
    ["22:19:08", "Sesi", "Dashboard siap. Aktifkan kamera untuk tracking asli.", "ok"],
    ["22:18:54", "Tracking", "Menunggu feed kamera pasien", "warn"],
    ["22:18:31", "Perangkat", "Speaker volume rendah", "warn"],
    ["22:17:42", "Kalibrasi", "Gunakan B / C / T seperti program Python", "ok"],
    ["22:16:03", "Sesi", "Monitoring dimulai untuk ICU Bed A12", "ok"],
  ],
};

const elements = {
  patientState: document.querySelector("[data-patient-state]"),
  gazeDirection: document.querySelector("[data-gaze-direction]"),
  confidence: document.querySelector("[data-confidence]"),
  confidenceBar: document.querySelector("[data-confidence-bar]"),
  currentMessage: document.querySelector("[data-current-message]"),
  messageTime: document.querySelector("[data-message-time]"),
  outputText: document.querySelector("[data-output-text]"),
  deviceScore: document.querySelector("[data-device-score]"),
  fps: document.querySelector("[data-fps]"),
  eyeDistance: document.querySelector("[data-eye-distance]"),
  eyeState: document.querySelector("[data-eye-state]"),
  blinkCount: document.querySelector("[data-blink-count]"),
  trackingQuality: document.querySelector("[data-tracking-quality]"),
  latency: document.querySelector("[data-latency]"),
  lighting: document.querySelector("[data-lighting]"),
  signal: document.querySelector("[data-signal]"),
  signalBar: document.querySelector("[data-signal-bar]"),
  blinkRate: document.querySelector("[data-blink-rate]"),
  focus: document.querySelector("[data-focus]"),
  response: document.querySelector("[data-response]"),
  cameraStatus: document.querySelector("[data-camera-status]"),
  cpuTemp: document.querySelector("[data-cpu-temp]"),
  alertTime: document.querySelector("[data-alert-time]"),
  calibrationTime: document.querySelector("[data-calibration-time]"),
  alertCount: document.querySelector("[data-alert-count]"),
  logList: document.querySelector("[data-log-list]"),
  iris468: document.querySelector("[data-iris-468]"),
  iris473: document.querySelector("[data-iris-473]"),
  eyelidGap: document.querySelector("[data-eyelid-gap]"),
  stablePrediction: document.querySelector("[data-stable-prediction]"),
  clickStatus: document.querySelector("[data-click-status]"),
  gazeButtons: Array.from(document.querySelectorAll("[data-gaze-option]")),
  cameraOverlay: document.querySelector("[data-camera-overlay]"),
  startCamera: document.querySelector("[data-start-camera]"),
  calibrationBanner: document.querySelector("[data-calibration-banner]"),
  calibrationTitle: document.querySelector("[data-calibration-title]"),
  calibrationDetail: document.querySelector("[data-calibration-detail]"),
};

let faceMesh = null;
let camera = null;

function createCalibrationState(message) {
  return {
    seconds: DEFAULT_CALIBRATION_SECONDS,
    samples: {
      top: [],
      center: [],
      bottom: [],
    },
    openEyeGaps: [],
    activeTarget: null,
    activeSamples: [],
    activeStartedAt: 0,
    activeEndsAt: 0,
    message,
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeMedian(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(digits);
}

function formatPoint(point) {
  if (!point) {
    return "-";
  }

  return `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
}

function setText(element, value) {
  if (!element) {
    return;
  }

  const nextValue = String(value);
  if (element.textContent !== nextValue) {
    element.textContent = nextValue;
  }
}

function setWidth(element, value) {
  if (!element) {
    return;
  }

  if (element.style.width !== value) {
    element.style.width = value;
  }
}

function syncCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width === width && canvas.height === height) {
    return false;
  }

  canvas.width = width;
  canvas.height = height;
  return true;
}

function addLog(event, detail, status = "ok") {
  state.logs.unshift([formatTime(), event, detail, status]);
  state.logs = state.logs.slice(0, 8);
  renderLogs();
}

function renderLogs() {
  elements.logList.innerHTML = state.logs
    .map(([time, event, detail, status]) => {
      const label = status === "ok" ? "Normal" : status === "warn" ? "Perhatian" : "Alert";

      return `
        <div class="log-row" role="row">
          <span role="cell">${escapeHtml(time)}</span>
          <span role="cell">${escapeHtml(event)}</span>
          <span role="cell">${escapeHtml(detail)}</span>
          <span role="cell" class="log-status ${escapeHtml(status)}" aria-label="${label}">${label}</span>
        </div>
      `;
    })
    .join("");
}

function syncClock() {
  const now = new Date();
  setText(clock, formatTime(now));
  setText(uptime, formatDuration(Date.now() - state.startedAt));
}

function setMessage(message, source = "Pesan pasien", status = "ok") {
  state.currentMessage = message;
  state.output = message;
  setText(elements.currentMessage, message);
  setText(elements.outputText, message);
  setText(elements.messageTime, "Diterima baru saja");
  addLog(source, message, status);
}

function point(landmarks, index) {
  const landmark = landmarks[index];
  return {
    x: Number(landmark.x),
    y: Number(landmark.y),
  };
}

function meanPoint(landmarks, indexes) {
  const total = indexes.reduce(
    (accumulator, index) => {
      const current = point(landmarks, index);
      accumulator.x += current.x;
      accumulator.y += current.y;
      return accumulator;
    },
    { x: 0, y: 0 }
  );

  return {
    x: total.x / indexes.length,
    y: total.y / indexes.length,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function eyeRatio(landmarks, irisIndexes, topIndexes, bottomIndexes, cornerIndexes) {
  const iris = meanPoint(landmarks, irisIndexes);
  const top = meanPoint(landmarks, topIndexes);
  const bottom = meanPoint(landmarks, bottomIndexes);
  const cornerA = point(landmarks, cornerIndexes[0]);
  const cornerB = point(landmarks, cornerIndexes[1]);

  const verticalGap = Math.max(bottom.y - top.y, 0.0001);
  const horizontalWidth = Math.max(distance(cornerA, cornerB), 0.0001);
  const ratio = clamp((iris.y - top.y) / verticalGap, -0.5, 1.5);
  const normalizedGap = Math.abs(bottom.y - top.y) / horizontalWidth;

  return {
    ratio,
    gap: normalizedGap,
    iris,
  };
}

function extractEyeFeatures(faceLandmarks) {
  const landmarks = faceLandmarks.landmark || faceLandmarks;

  if (!landmarks || landmarks.length <= Math.max(...RIGHT_IRIS)) {
    return null;
  }

  const left = eyeRatio(landmarks, LEFT_IRIS, LEFT_TOP, LEFT_BOTTOM, LEFT_CORNERS);
  const right = eyeRatio(landmarks, RIGHT_IRIS, RIGHT_TOP, RIGHT_BOTTOM, RIGHT_CORNERS);
  const eyePoints = [LEFT_TOP, LEFT_BOTTOM, RIGHT_TOP, RIGHT_BOTTOM, LEFT_IRIS, RIGHT_IRIS].map((group) =>
    meanPoint(landmarks, group)
  );

  return {
    landmarks,
    gazeRatio: (left.ratio + right.ratio) / 2,
    eyeGap: (left.gap + right.gap) / 2,
    leftIris: left.iris,
    rightIris: right.iris,
    eyePoints,
  };
}

function isCalibrationComplete() {
  return Object.values(state.calibration.samples).every((values) => values.length >= MIN_CALIBRATION_SAMPLES);
}

function buildProfile() {
  if (!isCalibrationComplete()) {
    return null;
  }

  let top = safeMedian(state.calibration.samples.top);
  let center = safeMedian(state.calibration.samples.center);
  let bottom = safeMedian(state.calibration.samples.bottom);
  let orderedAutomatically = false;

  if (!(top < center && center < bottom)) {
    [top, center, bottom] = [top, center, bottom].sort((a, b) => a - b);
    orderedAutomatically = true;
  }

  const openGap = safeMedian(state.calibration.openEyeGaps) || 0.16;

  return {
    top,
    center,
    bottom,
    upperThreshold: center - Math.max((center - top) * DIRECTION_ACTIVATION_RATIO, MIN_DIRECTION_OFFSET),
    lowerThreshold: center + Math.max((bottom - center) * DIRECTION_ACTIVATION_RATIO, MIN_DIRECTION_OFFSET),
    closedThreshold: clamp(openGap * CLOSED_THRESHOLD_FACTOR, MIN_CLOSED_THRESHOLD, MAX_CLOSED_THRESHOLD),
    orderedAutomatically,
    range: bottom - top,
  };
}

async function startCalibrationTarget(target) {
  if (!state.cameraActive) {
    await startCamera();
  }

  if (!state.cameraActive) {
    return;
  }

  const now = performance.now() / 1000;
  state.mode = "calibration";
  state.profile = null;
  state.directionHistory = [];
  state.stableDirection = "-";
  state.calibration.activeTarget = target;
  state.calibration.activeSamples = [];
  state.calibration.activeStartedAt = now;
  state.calibration.activeEndsAt = now + state.calibration.seconds;
  state.calibration.message = `Lihat ${TARGET_LABEL[target]}. Mengambil data ${state.calibration.seconds.toFixed(0)} detik...`;
  setText(elements.calibrationTime, "Sedang berjalan");
  addLog("Kalibrasi", `Mengambil data ${TARGET_LABEL[target]}`, "ok");
  updateCalibrationBanner();
}

function resetCalibration(message = "Kalibrasi diulang. Tekan B, C, atau T.") {
  state.mode = "calibration";
  state.profile = null;
  state.calibration = createCalibrationState(message);
  state.directionHistory = [];
  state.stableDirection = "-";
  state.lastProgramDirection = "-";
  state.output = "MENUNGGU KALIBRASI";
  resetBlinkState();
  setText(elements.outputText, "Menunggu input pasien");
  setText(elements.currentMessage, "Menunggu input pasien");
  updateActiveGazeMap("-");
  updateCalibrationBanner();
}

function updateCalibration(features, now) {
  const calibration = state.calibration;

  if (!calibration.activeTarget) {
    return;
  }

  if (features && features.eyeGap >= MIN_OPEN_GAP_FOR_CALIBRATION) {
    calibration.activeSamples.push(features.gazeRatio);
    calibration.openEyeGaps.push(features.eyeGap);
  }

  if (now < calibration.activeEndsAt) {
    return;
  }

  const target = calibration.activeTarget;
  const label = TARGET_LABEL[target];
  const sampleCount = calibration.activeSamples.length;

  if (sampleCount >= MIN_CALIBRATION_SAMPLES) {
    calibration.samples[target] = [...calibration.activeSamples];
    calibration.message = `Kalibrasi ${label} selesai (${sampleCount} sampel).`;
    addLog("Kalibrasi", `${label} selesai dengan ${sampleCount} sampel`, "ok");
  } else {
    calibration.samples[target] = [];
    calibration.message = `Kalibrasi ${label} gagal. Wajah/mata kurang terbaca.`;
    addLog("Kalibrasi", `${label} gagal, sampel hanya ${sampleCount}`, "warn");
  }

  calibration.activeTarget = null;
  calibration.activeSamples = [];
  setText(elements.calibrationTime, "Baru saja");
}

function startProgram() {
  state.profile = buildProfile();

  if (!state.profile) {
    state.calibration.message = "Kalibrasi belum lengkap. Isi B, C, dan T dulu.";
    addLog("Kalibrasi", "Program belum bisa mulai, data B/C/T belum lengkap", "warn");
    updateCalibrationBanner();
    return;
  }

  state.mode = "running";
  state.output = "PROGRAM E MULAI";
  state.directionHistory = [];
  state.lastProgramDirection = "-";
  resetBlinkState();
  setMessage("Program E mulai", "Sesi", "ok");

  if (state.profile.orderedAutomatically) {
    addLog("Kalibrasi", "Urutan nilai kalibrasi diperbaiki otomatis", "warn");
  }

  updateCalibrationBanner();
}

function resetBlinkState() {
  state.eyeClosed = false;
  state.closedStartedAt = 0;
  state.longBlinkSent = false;
  state.quickBlinks = [];
  state.clickStatus = "BELUM ADA KLIK";
}

function classifyDirection(features) {
  if (!state.profile) {
    return "-";
  }

  if (features.gazeRatio < state.profile.upperThreshold) {
    return "ATAS";
  }

  if (features.gazeRatio > state.profile.lowerThreshold) {
    return "BAWAH";
  }

  return "TENGAH";
}

function stableDirection(nextDirection) {
  if (!nextDirection || nextDirection === "-") {
    return "-";
  }

  state.directionHistory.push(nextDirection);

  if (state.directionHistory.length > SMOOTHING_FRAMES) {
    state.directionHistory.shift();
  }

  const counts = new Map();
  let bestDirection = state.directionHistory[0];
  let bestCount = 0;

  state.directionHistory.forEach((direction) => {
    const count = (counts.get(direction) || 0) + 1;
    counts.set(direction, count);

    if (count > bestCount) {
      bestDirection = direction;
      bestCount = count;
    }
  });

  return bestDirection;
}

function updateBlink(isClosed, now) {
  if (isClosed) {
    if (!state.eyeClosed) {
      state.eyeClosed = true;
      state.closedStartedAt = now;
      state.longBlinkSent = false;
    }

    const closedFor = now - state.closedStartedAt;

    if (closedFor >= LONG_CLOSE_SECONDS && !state.longBlinkSent) {
      state.longBlinkSent = true;
      state.quickBlinks = [];
      state.blinkCount += 1;
      state.clickStatus = "KLIK: MEREM 5 DETIK (YES)";
      setMessage("YES", "Merem 5 detik", "alert");
      return "MATA TERTUTUP";
    }

    state.clickStatus = `MATA TERTUTUP ${closedFor.toFixed(1)}s`;
    return "MATA TERTUTUP";
  }

  if (!state.eyeClosed) {
    return "MATA TERBUKA";
  }

  const closedDuration = now - state.closedStartedAt;
  state.eyeClosed = false;

  if (state.longBlinkSent) {
    state.longBlinkSent = false;
    state.clickStatus = "MATA TERBUKA";
    return "MATA TERBUKA";
  }

  if (closedDuration >= FAST_BLINK_MIN_SECONDS && closedDuration <= FAST_BLINK_MAX_SECONDS) {
    state.blinkCount += 1;
    state.quickBlinks = state.quickBlinks.filter((blinkAt) => now - blinkAt <= DOUBLE_BLINK_WINDOW_SECONDS);
    state.quickBlinks.push(now);

    if (state.quickBlinks.length >= 2) {
      state.quickBlinks = [];
      state.clickStatus = "KLIK: KEDIP 2 KALI (NO)";
      setMessage("NO", "Kedip cepat 2 kali", "ok");
      return "MATA TERBUKA";
    }

    state.clickStatus = "KEDIP CEPAT 1X";
    return "MATA TERBUKA";
  }

  state.quickBlinks = [];
  state.clickStatus = "MATA TERBUKA";
  return "MATA TERBUKA";
}

function getCalibrationProgress(now) {
  const calibration = state.calibration;

  if (!calibration.activeTarget) {
    return 0;
  }

  const total = Math.max(calibration.activeEndsAt - calibration.activeStartedAt, 0.001);
  return clamp((now - calibration.activeStartedAt) / total, 0, 1);
}

function getConfidence(features, eyeState) {
  if (!features) {
    return 0;
  }

  const readableEye = clamp((features.eyeGap - 0.025) / 0.12, 0, 1);
  const profileReady = state.profile ? 1 : 0.72;
  const closedPenalty = eyeState === "MATA TERTUTUP" ? 0.74 : 1;
  const confidence = (58 + readableEye * 34) * profileReady * closedPenalty;

  return Math.round(clamp(confidence, 0, 98));
}

function updateActiveGazeMap(directionLabel) {
  elements.gazeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.gazeOption === directionLabel);
  });
}

function updateDashboard(features, displayDirection, programDirection, eyeState, confidence) {
  state.lastDisplayDirection = displayDirection;
  state.lastProgramDirection = programDirection;
  state.lastEyeState = eyeState;
  state.lastConfidence = confidence;

  const hasFace = Boolean(features);
  const signal = hasFace ? clamp(confidence + 2, 36, 99) : 0;
  const focus = hasFace ? clamp(confidence - (displayDirection === "TENGAH" ? 0 : 5), 20, 98) : 0;
  const temp = 45 + Math.round(Math.abs(Math.sin(Date.now() / 1800)) * 4);
  const profile = state.profile;
  const thresholdText = profile
    ? `${profile.upperThreshold.toFixed(3)} / ${profile.lowerThreshold.toFixed(3)}`
    : "Belum kalibrasi";

  setText(elements.patientState, hasFace ? (eyeState === "MATA TERTUTUP" ? "Menunggu" : "Responsif") : "Tidak terbaca");
  setText(elements.gazeDirection, displayDirection);
  setText(elements.confidence, `${confidence}%`);
  setWidth(elements.confidenceBar, `${confidence}%`);
  setText(elements.fps, state.fps ? Math.round(state.fps) : "-");
  setText(elements.eyeDistance, features ? features.eyeGap.toFixed(3) : "-");
  setText(elements.eyeState, eyeState === "MATA TERTUTUP" ? "Tertutup" : hasFace ? "Terbuka" : "Tidak terbaca");
  setText(elements.blinkCount, state.blinkCount);
  setText(elements.latency, state.latency ? `${Math.round(state.latency)} ms` : "-");
  setText(elements.signal, `${signal}%`);
  setWidth(elements.signalBar, `${signal}%`);
  setText(elements.focus, `${focus}%`);
  setText(elements.response, state.latency ? `${(state.latency / 1000).toFixed(2)} s` : "-");
  setText(elements.blinkRate, `${Math.max(0, state.blinkCount)} sesi`);
  setText(elements.cameraStatus, state.cameraActive ? `${Math.round(state.fps || 0)} FPS` : "Offline");
  setText(elements.cpuTemp, `${temp} C`);
  setText(elements.deviceScore, hasFace ? (signal > 88 ? "98" : "92") : "70");
  setText(elements.trackingQuality, hasFace ? (confidence > 86 ? "Excellent" : confidence > 65 ? "Good" : "Cukup") : "Cari wajah");
  setText(elements.lighting, hasFace ? "Normal" : "Cek cahaya");
  setText(elements.alertTime, state.muted ? "Alert disenyapkan" : "Baru saja");
  setText(elements.alertCount, state.muted ? "Senyap" : "2 aktif");
  setText(elements.iris468, features ? features.gazeRatio.toFixed(3) : "-");
  setText(elements.iris473, thresholdText);
  setText(elements.eyelidGap, features ? features.eyeGap.toFixed(3) : "-");
  setText(elements.stablePrediction, programDirection && programDirection !== "-" ? programDirection : displayDirection);
  setText(elements.clickStatus, state.clickStatus);

  updateActiveGazeMap(programDirection);
}

function updateCalibrationBanner() {
  if (state.mode === "running") {
    elements.calibrationBanner.classList.add("is-hidden");
    return;
  }

  elements.calibrationBanner.classList.remove("is-hidden");
  const completed = ["bottom", "center", "top"]
    .map((target) => `${TARGET_LABEL[target]}:${state.calibration.samples[target].length ? "OK" : "--"}`)
    .join("  ");
  const activeSamples = state.calibration.activeTarget ? `  Sampel:${state.calibration.activeSamples.length}` : "";
  const liveReadout = state.lastFeatures
    ? `  Ratio:${state.lastFeatures.gazeRatio.toFixed(3)} Gap:${state.lastFeatures.eyeGap.toFixed(3)}`
    : "";

  setText(elements.calibrationTitle, state.calibration.activeTarget ? "Sedang Kalibrasi" : "Mode Kalibrasi");
  setText(elements.calibrationDetail, `${state.calibration.message}  ${completed}${activeSamples}${liveReadout}`);
}

function setOverlay(title, detail, showButton = true) {
  if (!elements.cameraOverlay) {
    return;
  }

  elements.cameraOverlay.classList.remove("is-hidden");
  elements.cameraOverlay.querySelector("strong").textContent = title;
  elements.cameraOverlay.querySelector("span").textContent = detail;
  elements.startCamera.hidden = !showButton;
}

function hideOverlay() {
  elements.cameraOverlay.classList.add("is-hidden");
}

function setCameraFullscreenState(isFullscreen) {
  state.cameraFullscreen = isFullscreen;
  document.body.classList.toggle("camera-fullscreen-active", isFullscreen);
  cameraFrame.classList.toggle("is-camera-fullscreen", isFullscreen);

  const label = isFullscreen ? "Minimize kamera" : "Fullscreen kamera";
  cameraFullscreenButton.setAttribute("aria-label", label);
  cameraFullscreenButton.title = label;

  syncCanvasSize();

  if (!state.cameraActive) {
    drawIdleView();
  }
}

function isCameraFullscreenActive() {
  return document.fullscreenElement === cameraFrame || state.fallbackFullscreen;
}

async function enterCameraFullscreen() {
  if (isCameraFullscreenActive()) {
    return;
  }

  try {
    if (cameraFrame.requestFullscreen) {
      await cameraFrame.requestFullscreen();
    } else {
      state.fallbackFullscreen = true;
    }
  } catch (error) {
    state.fallbackFullscreen = true;
  }

  setCameraFullscreenState(true);
}

async function exitCameraFullscreen() {
  state.fallbackFullscreen = false;

  if (document.fullscreenElement === cameraFrame && document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }

  setCameraFullscreenState(false);
}

function handleCameraFullscreenChange() {
  const isFullscreen = isCameraFullscreenActive();
  setCameraFullscreenState(isFullscreen);
}

function toggleCameraFullscreen() {
  if (isCameraFullscreenActive()) {
    exitCameraFullscreen();
    return;
  }

  enterCameraFullscreen();
}

function isMediaPipeReady() {
  return typeof window.FaceMesh === "function" && typeof window.Camera === "function";
}

async function startCamera() {
  if (state.cameraActive || state.cameraStarting) {
    return;
  }

  state.cameraStarting = true;
  setOverlay("Membuka kamera...", "Izinkan akses kamera di browser untuk melihat wajah asli.", false);

  if (!isMediaPipeReady()) {
    state.cameraStarting = false;
    setOverlay(
      "MediaPipe belum termuat",
      "Pastikan perangkat tersambung internet, lalu buka dari localhost/HTTPS agar kamera bisa aktif.",
      true
    );
    addLog("Tracking", "MediaPipe gagal dimuat dari CDN", "warn");
    return;
  }

  try {
    faceMesh = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.7,
    });

    faceMesh.onResults(handleFaceResults);

    camera = new window.Camera(video, {
      width: 640,
      height: 480,
      onFrame: async () => {
        state.lastInferenceStartedAt = performance.now();
        await faceMesh.send({ image: video });
      },
    });

    await camera.start();
    state.cameraActive = true;
    state.cameraStarting = false;
    hideOverlay();
    addLog("Tracking", "Kamera asli aktif dengan FaceMesh", "ok");
  } catch (error) {
    state.cameraStarting = false;
    setOverlay("Kamera gagal aktif", "Buka halaman dari localhost/HTTPS dan pastikan izin kamera diberikan.", true);
    addLog("Tracking", `Kamera gagal aktif: ${error.message || "izin ditolak"}`, "warn");
  }
}

function updateFps(nowMs) {
  if (state.lastFrameAt) {
    const instantFps = 1000 / Math.max(nowMs - state.lastFrameAt, 1);
    state.fps = state.fps ? state.fps * 0.8 + instantFps * 0.2 : instantFps;
  }

  state.lastFrameAt = nowMs;

  if (state.lastInferenceStartedAt) {
    state.latency = nowMs - state.lastInferenceStartedAt;
  }
}

function handleFaceResults(results) {
  const nowMs = performance.now();
  const now = nowMs / 1000;
  updateFps(nowMs);

  const faceLandmarks = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
  const features = faceLandmarks ? extractEyeFeatures(faceLandmarks) : null;
  state.faceVisible = Boolean(features);
  state.lastFeatures = features;

  if (state.mode === "calibration") {
    updateCalibration(features, now);
  }

  let displayDirection = "-";
  let programDirection = "-";
  let eyeState = features ? "MATA TERBUKA" : "WAJAH TIDAK TERBACA";

  if (features && state.mode === "running" && state.profile) {
    const isClosed = features.eyeGap < state.profile.closedThreshold;
    eyeState = updateBlink(isClosed, now);

    if (!isClosed) {
      displayDirection = stableDirection(classifyDirection(features));
      state.stableDirection = displayDirection;

      if (displayDirection === "ATAS" || displayDirection === "BAWAH") {
        programDirection = displayDirection;

        if (
          programDirection !== state.lastProgramDirection &&
          nowMs - state.lastAutoMessageAt >= MESSAGE_COOLDOWN_MS
        ) {
          state.lastProgramDirection = programDirection;
          state.lastAutoMessageAt = nowMs;
          const direction = directionsByLabel.get(programDirection);
          setMessage(direction.message, `Arah pandangan ${programDirection}`, "ok");
        }
      }
    } else {
      displayDirection = "MATA TERTUTUP";
      state.directionHistory = [];
    }
  } else if (features && state.mode === "calibration") {
    displayDirection = "KALIBRASI";
    resetBlinkState();
  } else {
    state.directionHistory = [];
    resetBlinkState();
  }

  const confidence = getConfidence(features, eyeState);
  updateDashboard(features, displayDirection, programDirection, eyeState, confidence);
  updateCalibrationBanner();
  drawTrackingView(results.image || video, features, displayDirection, programDirection, eyeState, confidence, now);
}

function getCanvasMap(source) {
  const sourceWidth = source.videoWidth || source.width || 640;
  const sourceHeight = source.videoHeight || source.height || 480;
  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;

  return {
    sourceWidth,
    sourceHeight,
    scale,
    drawWidth,
    drawHeight,
    offsetX,
    offsetY,
  };
}

function mapPointToCanvas(pointValue, map) {
  const rawX = map.offsetX + pointValue.x * map.sourceWidth * map.scale;
  const x = MIRROR_CAMERA ? canvas.width - rawX : rawX;
  const y = map.offsetY + pointValue.y * map.sourceHeight * map.scale;

  return { x, y };
}

function drawCameraFrame(source, map) {
  if (!source || !(source.videoWidth || source.width)) {
    ctx.fillStyle = "#071417";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  ctx.save();

  if (MIRROR_CAMERA) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(
    source,
    0,
    0,
    map.sourceWidth,
    map.sourceHeight,
    MIRROR_CAMERA ? -map.offsetX - map.drawWidth + canvas.width : map.offsetX,
    map.offsetY,
    map.drawWidth,
    map.drawHeight
  );

  ctx.restore();
}

function drawTrackingView(source, features, displayDirection, programDirection, eyeState, confidence, now) {
  syncCanvasSize();
  const map = getCanvasMap(source);
  state.lastCanvasMap = map;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCameraFrame(source, map);
  drawCameraOverlays(features, map, displayDirection, programDirection, eyeState, confidence, now);
}

function drawCameraOverlays(features, map, displayDirection, programDirection, eyeState, confidence, now) {
  const width = canvas.width;
  const height = canvas.height;

  ctx.fillStyle = "rgba(5, 16, 19, 0.72)";
  ctx.fillRect(0, 0, width, 142);
  ctx.fillRect(0, height - 74, width, 74);

  if (features) {
    drawEyePoints(features, map);
  }

  if (state.mode === "calibration") {
    const completed = ["bottom", "center", "top"]
      .map((target) => `${TARGET_LABEL[target]}: ${state.calibration.samples[target].length ? "OK" : "--"}`)
      .join(" | ");

    drawTextBlock(
      [
        "MODE KALIBRASI - lihat sesuai tombol selama data diambil",
        "B=bawah  C=center  T=atas  S=mulai Program E  R=ulang",
        state.calibration.message,
        completed,
      ],
      18,
      30
    );

    if (state.calibration.activeTarget) {
      drawProgressBar(18, 112, width - 36, 16, getCalibrationProgress(now));
    }
  } else {
    const ratioText = features ? features.gazeRatio.toFixed(3) : "-";
    const gapText = features ? features.eyeGap.toFixed(3) : "-";
    const thresholdText = state.profile
      ? `atas<${state.profile.upperThreshold.toFixed(3)} bawah>${state.profile.lowerThreshold.toFixed(3)}`
      : "-";

    drawTextBlock(
      [
        "PROGRAM E AKTIF - dua arah: ATAS / BAWAH",
        `ARAH PROGRAM: ${programDirection || "-"}     DETEKSI: ${displayDirection}`,
        `MATA: ${eyeState}     OUTPUT: ${state.output}`,
        `ratio=${ratioText}  gap=${gapText}  conf=${confidence}%  threshold=${thresholdText}`,
      ],
      18,
      30
    );
  }

  drawTextBlock(
    ["YES = mata tertutup 5 detik     NO = kedip cepat 2 kali", "Tekan R untuk kalibrasi ulang."],
    18,
    height - 46,
    0.55
  );
}

function drawTextBlock(lines, x, y, scale = 0.58) {
  ctx.font = `${Math.round(scale * 28)}px Consolas, 'Courier New', monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f5f5f5";

  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * 24);
  });
}

function drawProgressBar(x, y, width, height, progress) {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.44)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#29ab87";
  ctx.fillRect(x + 2, y + 2, Math.max(0, (width - 4) * progress), height - 4);
}

function drawEyePoints(features, map) {
  ctx.fillStyle = "#35e0ac";

  features.eyePoints.forEach((item) => {
    const mapped = mapPointToCanvas(item, map);
    ctx.beginPath();
    ctx.arc(mapped.x, mapped.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  [features.leftIris, features.rightIris].forEach((item) => {
    const mapped = mapPointToCanvas(item, map);
    ctx.fillStyle = "#00b4ff";
    ctx.beginPath();
    ctx.arc(mapped.x, mapped.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawIdleView() {
  syncCanvasSize();
  ctx.fillStyle = "#071417";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "700 24px Inter, system-ui, sans-serif";
  ctx.fillText("Aktifkan kamera untuk menampilkan wajah asli", 42, 70);
  ctx.font = "600 17px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.fillText("Deteksi akan memakai FaceMesh seperti logika program Python.", 42, 108);
}

menuButton.addEventListener("click", () => {
  const isOpen = sidebar.classList.toggle("is-open");
  document.body.classList.toggle("menu-open", isOpen);
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.forEach((item) => item.classList.remove("is-active"));
    link.classList.add("is-active");
    sidebar.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  });
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    setMessage(button.dataset.command, "Input manual");
  });
});

document.querySelector("[data-clear-message]").addEventListener("click", () => {
  setMessage("Menunggu input pasien", "Output");
});

document.querySelector("[data-calibrate]").addEventListener("click", () => {
  resetCalibration("Kalibrasi diulang. Tekan B, C, atau T.");
  startCamera();
  addLog("Kalibrasi", "Mode kalibrasi aktif", "ok");
});

document.querySelectorAll("[data-calibration-target]").forEach((button) => {
  button.addEventListener("click", () => {
    startCalibrationTarget(button.dataset.calibrationTarget);
  });
});

document.querySelector("[data-start-program]").addEventListener("click", () => {
  startProgram();
});

document.querySelector("[data-reset-calibration]").addEventListener("click", () => {
  resetCalibration();
  startCamera();
  addLog("Kalibrasi", "Kalibrasi diulang", "ok");
});

elements.startCamera.addEventListener("click", () => {
  startCamera();
});

cameraFullscreenButton.addEventListener("click", () => {
  toggleCameraFullscreen();
});

document.addEventListener("fullscreenchange", handleCameraFullscreenChange);

window.addEventListener("resize", () => {
  const resized = syncCanvasSize();

  if (resized && !state.cameraActive) {
    drawIdleView();
  }
});

document.querySelector("[data-toggle-alert]").addEventListener("click", () => {
  state.muted = !state.muted;
  addLog("Alert", state.muted ? "Alert disenyapkan" : "Alert diaktifkan kembali", state.muted ? "warn" : "ok");
  updateDashboard(
    state.lastFeatures,
    state.lastDisplayDirection,
    state.lastProgramDirection,
    state.lastEyeState,
    state.lastConfidence
  );
});

document.querySelector("[data-refresh-device]").addEventListener("click", () => {
  addLog("Perangkat", "Status perangkat diperbarui", "ok");
});

document.querySelector("[data-export-log]").addEventListener("click", () => {
  addLog("Log", "Riwayat sesi disiapkan untuk export", "ok");
});

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (key === "escape" && state.fallbackFullscreen) {
    exitCameraFullscreen();
    return;
  }

  if (TARGET_BY_KEY[key]) {
    startCalibrationTarget(TARGET_BY_KEY[key]);
    return;
  }

  if (key === "s") {
    startProgram();
    return;
  }

  if (key === "r") {
    resetCalibration();
    addLog("Kalibrasi", "Kalibrasi diulang", "ok");
  }
});

renderLogs();
syncClock();
drawIdleView();
updateCalibrationBanner();
updateDashboard(null, "-", "-", "WAJAH TIDAK TERBACA", 0);

setInterval(syncClock, 1000);
