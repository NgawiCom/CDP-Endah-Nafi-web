// Polyfill untuk String.prototype.replaceAll untuk kompatibilitas Edge/Browser lama
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function(search, replace) {
    if (typeof search === 'string') {
      return this.split(search).join(replace);
    }
    let target = this;
    let regex;
    if (search instanceof RegExp) {
      if (!search.global) {
        throw new TypeError('replaceAll called with a non-global RegExp argument');
      }
      regex = search;
    } else {
      regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    }
    return target.replace(regex, replace);
  };
}

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
const API_BASE_URL =
  window.ECHO_API_BASE_URL ||
  (window.location.hostname === "127.0.0.1" && window.location.port === "8000"
    ? "/api"
    : "http://127.0.0.1:8000/api");
const TRACKING_SNAPSHOT_INTERVAL_MS = 2500;
const PATIENT_SEARCH_DEBOUNCE_MS = 250;

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
  backend: {
    initializing: false,
    initPromise: null,
    online: false,
    disabled: false,
    errorLogged: false,
    patientId: null,
    sessionId: null,
    lastSnapshotAt: 0,
    activePatient: null,
    calibrationSaved: false,
    pendingStartProfile: null,
    searchTimer: 0,
  },
  logs: [],
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
  patientSearchInput: document.querySelector("[data-patient-search-input]"),
  patientSearchResults: document.querySelector("[data-patient-search-results]"),
  patientProfileForm: document.querySelector("[data-patient-profile-form]"),
  profileName: document.querySelector("[data-profile-name]"),
  profileGender: document.querySelector("[data-profile-gender]"),
  profileNik: document.querySelector("[data-profile-nik]"),
  profileSaveNote: document.querySelector("[data-profile-save-note]"),
  profileSection: document.querySelector("[data-profile-section]"),
  profileSaveStatus: document.querySelector("[data-profile-save-status]"),
  profileInitials: document.querySelector("[data-profile-initials]"),
  profileDisplayName: document.querySelector("[data-profile-display-name]"),
  profileDisplayMeta: document.querySelector("[data-profile-display-meta]"),
  profileDetailName: document.querySelector("[data-profile-detail-name]"),
  profileDetailGender: document.querySelector("[data-profile-detail-gender]"),
  profileDetailNik: document.querySelector("[data-profile-detail-nik]"),
  profileBackendStatus: document.querySelector("[data-profile-backend-status]"),
  savedCalibrationTop: document.querySelector("[data-saved-calibration-top]"),
  savedCalibrationCenter: document.querySelector("[data-saved-calibration-center]"),
  savedCalibrationBottom: document.querySelector("[data-saved-calibration-bottom]"),
  savedCalibrationThreshold: document.querySelector("[data-saved-calibration-threshold]"),
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
  if (typeof value !== 'string') {
    value = String(value || '');
  }
  
  // Menggunakan metode yang kompatibel dengan browser lama
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
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
  if (!element || typeof element.textContent === 'undefined') {
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

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function formatSavedNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : "-";
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "--";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function apiRequest(path, options = {}) {
  try {
    const response = await fetch(apiUrl(path), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      keepalive: Boolean(options.keepalive),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request backend gagal (${response.status})`);
    }

    return payload;
  } catch (error) {
    console.error('API request error:', path, error);
    throw error;
  }
}

function reportBackendError(error) {
  if (state.backend.errorLogged) {
    return;
  }

  state.backend.errorLogged = true;
  addLog("Backend", `Penyimpanan data belum aktif: ${error.message}`, "warn");
}

function setActivePatient(patient, calibrationSaved = Boolean(patient && patient.has_calibration)) {
  state.backend.activePatient = patient;
  state.backend.patientId = patient ? patient.id : null;
  state.backend.calibrationSaved = calibrationSaved;
  renderActivePatientProfile();

  if (patient) {
    if (elements.profileName) {
      elements.profileName.value = patient.name || "";
    }
    if (elements.profileGender) {
      elements.profileGender.value = patient.gender || "";
    }
    if (elements.profileNik) {
      elements.profileNik.value = patient.nik || "";
    }
    setText(elements.messageTime, `Profil aktif: ${patient.name} / ${patient.nik}`);
  }
}

function renderActivePatientProfile() {
  const patient = state.backend.activePatient;
  const calibrationData = patient && patient.calibration_data;
  const profile = state.profile || calibrationData?.profile || null;
  const coordinates = calibrationData?.coordinates || profile || {};
  const thresholds = calibrationData?.thresholds || {};
  const hasCalibration = Boolean(state.backend.calibrationSaved || patient?.has_calibration || profile);
  const sessionText = state.backend.sessionId ? `Tersimpan / sesi #${state.backend.sessionId}` : "Profil tersimpan";

  if (!patient) {
    elements.profileSaveStatus.className = "status-badge warning";
    setText(elements.profileSaveStatus, "Belum dipilih");
    setText(elements.profileInitials, "--");
    setText(elements.profileDisplayName, "Belum ada pasien aktif");
    setText(elements.profileDisplayMeta, "Pilih pasien dari sidebar atau simpan hasil kalibrasi baru.");
    setText(elements.profileDetailName, "-");
    setText(elements.profileDetailGender, "-");
    setText(elements.profileDetailNik, "-");
    setText(elements.profileBackendStatus, "Belum tersimpan");
    setText(elements.savedCalibrationTop, "-");
    setText(elements.savedCalibrationCenter, "-");
    setText(elements.savedCalibrationBottom, "-");
    setText(elements.savedCalibrationThreshold, "-");
    return;
  }

  elements.profileSaveStatus.className = hasCalibration ? "status-badge safe" : "status-badge warning";
  setText(elements.profileSaveStatus, hasCalibration ? "Kalibrasi tersimpan" : "Belum ada kalibrasi");
  setText(elements.profileInitials, getInitials(patient.name));
  setText(elements.profileDisplayName, patient.name || "-");
  setText(
    elements.profileDisplayMeta,
    `${patient.gender || "-"} / NIK ${patient.nik || "-"}`
  );
  setText(elements.profileDetailName, patient.name || "-");
  setText(elements.profileDetailGender, patient.gender || "-");
  setText(elements.profileDetailNik, patient.nik || "-");
  setText(elements.profileBackendStatus, sessionText);
  setText(elements.savedCalibrationTop, formatSavedNumber(coordinates.top));
  setText(elements.savedCalibrationCenter, formatSavedNumber(coordinates.center));
  setText(elements.savedCalibrationBottom, formatSavedNumber(coordinates.bottom));
  setText(
    elements.savedCalibrationThreshold,
    `${formatSavedNumber(thresholds.upper ?? profile?.upperThreshold)} / ${formatSavedNumber(
      thresholds.lower ?? profile?.lowerThreshold
    )} / ${formatSavedNumber(thresholds.closed ?? profile?.closedThreshold)}`
  );
}

function showProfileSection() {
  if (!elements.profileSection) {
    return;
  }

  elements.profileSection.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", "#profile");
}

function serializeCalibrationData(profile = state.profile) {
  return {
    version: 1,
    captured_at: new Date().toISOString(),
    source: "browser-dashboard",
    coordinates: {
      top: profile ? profile.top : null,
      center: profile ? profile.center : null,
      bottom: profile ? profile.bottom : null,
    },
    thresholds: {
      upper: profile ? profile.upperThreshold : null,
      lower: profile ? profile.lowerThreshold : null,
      closed: profile ? profile.closedThreshold : null,
    },
    profile,
    samples: {
      top: [...state.calibration.samples.top],
      center: [...state.calibration.samples.center],
      bottom: [...state.calibration.samples.bottom],
    },
    openEyeGaps: [...state.calibration.openEyeGaps],
  };
}

function normalizeCalibrationProfile(profile) {
  if (!profile) {
    return null;
  }

  const normalized = {
    top: Number(profile.top),
    center: Number(profile.center),
    bottom: Number(profile.bottom),
    upperThreshold: Number(profile.upperThreshold ?? profile.upper_threshold ?? profile.thresholds?.upper),
    lowerThreshold: Number(profile.lowerThreshold ?? profile.lower_threshold ?? profile.thresholds?.lower),
    closedThreshold: Number(profile.closedThreshold ?? profile.closed_threshold ?? profile.thresholds?.closed),
    orderedAutomatically: Boolean(profile.orderedAutomatically ?? profile.ordered_automatically),
    range: Number(profile.range ?? Number(profile.bottom) - Number(profile.top)),
  };

  return Object.values(normalized).some((value) => typeof value === "number" && !Number.isFinite(value))
    ? null
    : normalized;
}

function applyPatientCalibration(patient) {
  const calibrationData = patient.calibration_data;
  if (!calibrationData) {
    throw new Error("Profil pasien belum punya data kalibrasi.");
  }

  const samples = calibrationData.samples || {};
  state.calibration = createCalibrationState(`Profil ${patient.name} dimuat. Kalibrasi tersimpan aktif.`);
  state.calibration.samples = {
    top: Array.isArray(samples.top) ? samples.top.map(Number).filter(Number.isFinite) : [],
    center: Array.isArray(samples.center) ? samples.center.map(Number).filter(Number.isFinite) : [],
    bottom: Array.isArray(samples.bottom) ? samples.bottom.map(Number).filter(Number.isFinite) : [],
  };
  state.calibration.openEyeGaps = Array.isArray(calibrationData.openEyeGaps)
    ? calibrationData.openEyeGaps.map(Number).filter(Number.isFinite)
    : Array.isArray(calibrationData.open_eye_gaps)
      ? calibrationData.open_eye_gaps.map(Number).filter(Number.isFinite)
      : [];

  state.profile =
    normalizeCalibrationProfile(calibrationData.profile) ||
    normalizeCalibrationProfile({
      ...(calibrationData.coordinates || {}),
      thresholds: calibrationData.thresholds,
    }) ||
    buildProfile();

  if (!state.profile) {
    throw new Error("Data kalibrasi pasien tidak lengkap.");
  }

  state.mode = "running";
  state.directionHistory = [];
  state.stableDirection = "-";
  state.lastProgramDirection = "-";
  resetBlinkState();
  setActivePatient(patient, true);
  updateCalibrationBanner();
  updateDashboard(state.lastFeatures, "PROFIL DIMUAT", "-", state.lastEyeState, state.lastConfidence);
}

async function openSessionForPatient(patient, notes = "Sesi dibuat dari profil pasien.") {
  if (!patient || state.backend.disabled) {
    return null;
  }

  if (state.backend.sessionId && state.backend.patientId === patient.id) {
    return state.backend.sessionId;
  }

  closeBackendSession();
  state.backend.initializing = true;

  try {
    const sessionResult = await apiRequest(`/patients/${patient.id}/sessions`, {
      method: "POST",
      body: {
        source: "browser-dashboard",
        device_label: navigator.userAgent,
        notes,
      },
    });

    state.backend.online = true;
    state.backend.sessionId = sessionResult.session.id;
    state.backend.patientId = patient.id;
    renderActivePatientProfile();
    return state.backend.sessionId;
  } catch (error) {
    state.backend.online = false;
    reportBackendError(error);
    return null;
  } finally {
    state.backend.initializing = false;
  }
}

async function storeBackendEvent(event) {
  if (state.backend.disabled || !state.backend.sessionId) {
    return;
  }

  try {
    await apiRequest(`/sessions/${state.backend.sessionId}/tracking-events`, {
      method: "POST",
      body: {
        captured_at: new Date().toISOString(),
        ...event,
      },
    });
  } catch (error) {
    state.backend.online = false;
    reportBackendError(error);
  }
}

function storeMessageEvent(message, source, status) {
  storeBackendEvent({
    event_type: "message",
    gaze_direction: state.lastDisplayDirection,
    program_direction: state.lastProgramDirection,
    eye_state: state.lastEyeState,
    confidence: state.lastConfidence,
    blink_count: state.blinkCount,
    click_status: state.clickStatus,
    output_message: message,
    metadata: {
      source,
      status,
      mode: state.mode,
    },
  });
}

function storeTrackingSnapshot(features, displayDirection, programDirection, eyeState, confidence, nowMs) {
  if (nowMs - state.backend.lastSnapshotAt < TRACKING_SNAPSHOT_INTERVAL_MS) {
    return;
  }

  state.backend.lastSnapshotAt = nowMs;
  storeBackendEvent({
    event_type: "snapshot",
    gaze_direction: displayDirection,
    program_direction: programDirection,
    eye_state: eyeState,
    confidence,
    eye_gap: features ? numberOrNull(features.eyeGap) : null,
    gaze_ratio: features ? numberOrNull(features.gazeRatio) : null,
    fps: numberOrNull(state.fps),
    latency_ms: numberOrNull(state.latency),
    blink_count: state.blinkCount,
    click_status: state.clickStatus,
    output_message: state.output,
    metadata: {
      mode: state.mode,
      face_visible: Boolean(features),
      stable_direction: state.stableDirection,
    },
  });
}

function closeBackendSession() {
  if (!state.backend.sessionId || state.backend.disabled) {
    return;
  }

  fetch(apiUrl(`/sessions/${state.backend.sessionId}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "closed",
      ended_at: new Date().toISOString(),
    }),
    keepalive: true,
  }).catch(() => {});
  state.backend.sessionId = null;
}

function showPatientProfileForm() {
  const patient = state.backend.activePatient;
  if (patient) {
    elements.profileName.value = patient.name || "";
    elements.profileGender.value = patient.gender || "";
    elements.profileNik.value = patient.nik || "";
  }
  setText(
    elements.profileSaveNote,
    patient
      ? "Data kalibrasi baru akan menggantikan kalibrasi tersimpan untuk pasien ini."
      : "Isi profil pasien lalu klik Simpan Kalibrasi di panel kanan."
  );
  showProfileSection();

  if (elements.profileName) {
    elements.profileName.focus();
  }
}

function hidePatientProfileForm() {
  setText(elements.profileSaveNote, "Data kalibrasi disimpan manual setelah profil diisi.");
}

function renderPatientSearchResults(patients) {
  if (!elements.patientSearchResults) {
    return;
  }

  if (!patients.length) {
    elements.patientSearchResults.innerHTML = "<p>Pasien tidak ditemukan.</p>";
    return;
  }

  elements.patientSearchResults.innerHTML = patients
    .map((patient) => {
      const calibrationLabel = patient.has_calibration ? "Kalibrasi tersimpan" : "Belum ada kalibrasi";
      return `
        <button class="patient-result-button" type="button" data-patient-id="${patient.id}">
          <strong>${escapeHtml(patient.name || "Tanpa nama")}</strong>
          <span>${escapeHtml(patient.nik || "-")} / ${escapeHtml(patient.gender || "-")}</span>
          <span>${calibrationLabel}</span>
        </button>
      `;
    })
    .join("");
}

async function searchPatients(query = "") {
  if (!elements.patientSearchResults) {
    return;
  }

  elements.patientSearchResults.innerHTML = "<p>Mencari pasien...</p>";

  try {
    const payload = await apiRequest(`/patients?q=${encodeURIComponent(query)}`);
    renderPatientSearchResults(payload.patients || []);
  } catch (error) {
    elements.patientSearchResults.innerHTML = "<p>Backend belum aktif.</p>";
    reportBackendError(error);
  }
}

function schedulePatientSearch() {
  clearTimeout(state.backend.searchTimer);
  state.backend.searchTimer = window.setTimeout(() => {
    searchPatients(elements.patientSearchInput.value);
  }, PATIENT_SEARCH_DEBOUNCE_MS);
}

function activateProgram(message = "Program E mulai") {
  state.mode = "running";
  state.output = message.toUpperCase();
  state.directionHistory = [];
  state.lastProgramDirection = "-";
  resetBlinkState();
  setMessage(message, "Sesi", "ok");

  if (state.profile && state.profile.orderedAutomatically) {
    addLog("Kalibrasi", "Urutan nilai kalibrasi diperbaiki otomatis", "warn");
  }

  updateCalibrationBanner();
}

async function savePatientCalibration() {
  const profile = state.backend.pendingStartProfile || buildProfile();
  if (!profile) {
    setText(elements.profileSaveNote, "Kalibrasi belum lengkap. Ambil data Bawah, Tengah, dan Atas dulu.");
    addLog("Kalibrasi", "Data kalibrasi belum lengkap, profil belum disimpan", "warn");
    return;
  }

  const name = elements.profileName.value.trim();
  const gender = elements.profileGender.value;
  const nik = elements.profileNik.value.trim();

  if (!name || !gender || !nik) {
    setText(elements.profileSaveNote, "Nama, jenis kelamin, dan NIK wajib diisi.");
    return;
  }

  const submitButton = elements.patientProfileForm.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
  }
  setText(elements.profileSaveNote, "Menyimpan profil dan data kalibrasi ke backend...");

  try {
    state.profile = profile;
    const payload = await apiRequest("/patients", {
      method: "POST",
      body: {
        patient_code: `NIK-${nik}`,
        name,
        gender,
        nik,
        room: "",
        bed: "",
        notes: "Data dibuat dari form profil pasien dashboard E.C.H.O.",
        calibration_data: serializeCalibrationData(profile),
      },
    });
    const patient = payload.patient;
    setActivePatient(patient, true);
    const sessionId = await openSessionForPatient(patient, "Sesi dibuat setelah kalibrasi baru disimpan.");
    if (!sessionId) {
      throw new Error("Profil tersimpan, tetapi sesi tracking belum bisa dibuat.");
    }
    state.backend.pendingStartProfile = null;
    setText(elements.profileSaveNote, "Kalibrasi tersimpan di backend. Tekan Mulai untuk menjalankan Program E.");
    addLog("Backend", `Kalibrasi ${patient.name} tersimpan`, "ok");
    updateCalibrationBanner();
    showProfileSection();
    searchPatients(elements.patientSearchInput ? elements.patientSearchInput.value : "");
  } catch (error) {
    setText(elements.profileSaveNote, error.message);
    reportBackendError(error);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function loadPatientProfile(patientId) {
  try {
    const payload = await apiRequest(`/patients/${patientId}`);
    const patient = payload.patient;
    const sessionId = await openSessionForPatient(patient, "Sesi dibuat dari profil dengan kalibrasi tersimpan.");
    if (!sessionId) {
      throw new Error("Profil dimuat, tetapi sesi tracking belum bisa dibuat.");
    }
    applyPatientCalibration(patient);
    setMessage(`Profil ${patient.name} dimuat`, "Cari Pasien", "ok");
    showProfileSection();
    sidebar.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  } catch (error) {
    addLog("Cari Pasien", error.message, "warn");
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
  if (!elements.logList) {
    return;
  }

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
  storeMessageEvent(message, source, status);
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
  state.backend.calibrationSaved = false;
  state.backend.pendingStartProfile = null;
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
  state.backend.calibrationSaved = false;
  state.backend.pendingStartProfile = null;
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

async function startProgram() {
  state.profile = buildProfile() || (state.backend.calibrationSaved ? state.profile : null);

  if (!state.profile) {
    state.calibration.message = "Kalibrasi belum lengkap. Isi B, C, dan T dulu.";
    addLog("Kalibrasi", "Program belum bisa mulai, data B/C/T belum lengkap", "warn");
    updateCalibrationBanner();
    return;
  }

  if (!state.backend.calibrationSaved) {
    state.backend.pendingStartProfile = state.profile;
    addLog("Backend", "Program belum mulai karena kalibrasi belum disimpan", "warn");
    showPatientProfileForm();
    setText(elements.profileSaveNote, "Kalibrasi belum tersimpan. Isi profil lalu klik Simpan Kalibrasi.");
    return;
  }

  if (state.backend.activePatient && !state.backend.sessionId) {
    await openSessionForPatient(state.backend.activePatient, "Sesi dibuat dari kalibrasi tersimpan.");
  }

  activateProgram("Program E mulai");
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
  setText(elements.cpuTemp, "-");
  setText(elements.deviceScore, hasFace ? `${signal}` : "-");
  setText(elements.trackingQuality, hasFace ? (confidence > 86 ? "Sangat baik" : confidence > 65 ? "Baik" : "Cukup") : "Menunggu");
  setText(elements.lighting, hasFace ? "Normal" : "Menunggu");
  setText(elements.alertTime, state.muted ? "Alert disenyapkan" : "-");
  setText(elements.alertCount, state.muted ? "Senyap" : "Tidak ada");
  setText(elements.iris468, features ? features.gazeRatio.toFixed(3) : "-");
  setText(elements.iris473, thresholdText);
  setText(elements.eyelidGap, features ? features.eyeGap.toFixed(3) : "-");
  setText(elements.stablePrediction, programDirection && programDirection !== "-" ? programDirection : displayDirection);
  setText(elements.clickStatus, state.clickStatus);

  updateActiveGazeMap(programDirection);
}

function updateCalibrationControls() {
  // Disable calibration buttons when patient with saved calibration is loaded and running
  const isPatientActive = Boolean(state.backend.activePatient && state.backend.calibrationSaved);
  const shouldDisable = state.mode === "running" && isPatientActive;

  document.querySelectorAll("[data-calibration-target], [data-reset-calibration]").forEach((button) => {
    button.disabled = shouldDisable;
    button.title = shouldDisable
      ? `Profil pasien sedang aktif - Profil ${state.backend.activePatient.name}`
      : "";
    button.style.opacity = shouldDisable ? "0.5" : "1";
    button.style.cursor = shouldDisable ? "not-allowed" : "pointer";
  });
}

function updateCalibrationBanner() {
  if (state.mode === "running") {
    elements.calibrationBanner.classList.add("is-hidden");
    updateCalibrationControls();
    return;
  }

  elements.calibrationBanner.classList.remove("is-hidden");
  updateCalibrationControls();
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
        try {
          state.lastInferenceStartedAt = performance.now();
          await faceMesh.send({ image: video });
        } catch (error) {
          console.error('Error in camera frame processing:', error);
        }
      },
    });

    await camera.start();
    state.cameraActive = true;
    state.cameraStarting = false;
    hideOverlay();
    addLog("Tracking", "Kamera asli aktif dengan FaceMesh", "ok");
  } catch (error) {
    state.cameraStarting = false;
    console.error('Camera error:', error);
    setOverlay("Kamera gagal aktif", "Buka halaman dari localhost/HTTPS dan pastikan izin kamera diberikan. Error: " + (error.message || error), true);
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
  storeTrackingSnapshot(features, displayDirection, programDirection, eyeState, confidence, nowMs);
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
        "B=bawah  C=center  T=atas  S=mulai setelah tersimpan  R=ulang",
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

    if (link.hasAttribute("data-patient-search-toggle")) {
      elements.patientSearchInput.focus();
      searchPatients(elements.patientSearchInput.value);
      return;
    }

    sidebar.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  });
});

// Safely add event listeners with null checks
try {
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      setMessage(button.dataset.command, "Input manual");
    });
  });

  const clearMessageButton = document.querySelector("[data-clear-message]");
  if (clearMessageButton) {
    clearMessageButton.addEventListener("click", () => {
      setMessage("Menunggu input pasien", "Output");
    });
  }

  const calibrateButton = document.querySelector("[data-calibrate]");
  if (calibrateButton) {
    calibrateButton.addEventListener("click", () => {
      // Protect against accidental reset when patient profile is active
      if (state.backend.activePatient && state.backend.calibrationSaved) {
        const confirmed = confirm(
          `Anda yakin ingin mulai kalibrasi baru untuk ${state.backend.activePatient.name}?\n\n` +
          `Ini akan menghapus kalibrasi tersimpan saat ini.`
        );
        if (!confirmed) {
          return;
        }
        // Clear active patient when resetting calibration
        setActivePatient(null, false);
      }
      
      resetCalibration("Kalibrasi diulang. Tekan B, C, atau T.");
      startCamera();
      addLog("Kalibrasi", "Mode kalibrasi aktif", "ok");
    });
  }
} catch (error) {
  console.error('Error setting up event listeners:', error);
}

// Safely add calibration and program listeners
try {
  document.querySelectorAll("[data-calibration-target]").forEach((button) => {
    button.addEventListener("click", () => {
      // Protect against accidental calibration when patient profile is active
      if (state.backend.activePatient && state.backend.calibrationSaved && state.mode === "running") {
        const confirmed = confirm(
          `Profil ${state.backend.activePatient.name} sedang aktif.\n\n` +
          `Mulai kalibrasi baru akan menghapus profil aktif saat ini. Lanjutkan?`
        );
        if (!confirmed) {
          return;
        }
        // Clear active patient when starting new calibration
        setActivePatient(null, false);
      }
      
      startCalibrationTarget(button.dataset.calibrationTarget);
    });
  });

  const startProgramButton = document.querySelector("[data-start-program]");
  if (startProgramButton) {
    startProgramButton.addEventListener("click", () => {
      startProgram();
    });
  }

  const resetCalibrationButton = document.querySelector("[data-reset-calibration]");
  if (resetCalibrationButton) {
    resetCalibrationButton.addEventListener("click", () => {
      // Protect against accidental reset when patient profile is active
      if (state.backend.activePatient && state.backend.calibrationSaved) {
        const confirmed = confirm(
          `Anda yakin ingin ulang kalibrasi untuk ${state.backend.activePatient.name}?\n\n` +
          `Ini akan menghapus kalibrasi tersimpan dan memasuki mode kalibrasi baru.`
        );
        if (!confirmed) {
          return;
        }
        // Clear active patient when resetting calibration
        setActivePatient(null, false);
      }
      
      resetCalibration();
      startCamera();
      addLog("Kalibrasi", "Kalibrasi diulang", "ok");
    });
  }

  if (elements.startCamera) {
    elements.startCamera.addEventListener("click", () => {
      startCamera();
    });
  }

  if (cameraFullscreenButton) {
    cameraFullscreenButton.addEventListener("click", () => {
      toggleCameraFullscreen();
    });
  }
} catch (error) {
  console.error('Error setting up calibration and camera listeners:', error);
}

document.addEventListener("fullscreenchange", handleCameraFullscreenChange);

// Safely add patient search listeners
try {
  if (elements.patientSearchInput) {
    elements.patientSearchInput.addEventListener("focus", () => {
      searchPatients(elements.patientSearchInput.value);
    });

    elements.patientSearchInput.addEventListener("input", schedulePatientSearch);
  }

  if (elements.patientSearchResults) {
    elements.patientSearchResults.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target.parentElement;
      const button = target ? target.closest("[data-patient-id]") : null;
      if (!button) {
        return;
      }

      loadPatientProfile(button.dataset.patientId);
    });
  }

  if (elements.patientProfileForm) {
    elements.patientProfileForm.addEventListener("submit", (event) => {
      event.preventDefault();
      savePatientCalibration();
    });
  }

  document.querySelectorAll("[data-close-patient-profile]").forEach((button) => {
    button.addEventListener("click", hidePatientProfileForm);
  });
} catch (error) {
  console.error('Error setting up patient search listeners:', error);
}

window.addEventListener("resize", () => {
  const resized = syncCanvasSize();

  if (resized && !state.cameraActive) {
    drawIdleView();
  }
});

window.addEventListener("beforeunload", closeBackendSession);

// Safely add remaining event listeners
try {
  const toggleAlertButton = document.querySelector("[data-toggle-alert]");
  if (toggleAlertButton) {
    toggleAlertButton.addEventListener("click", () => {
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
  }

  const refreshDeviceButton = document.querySelector("[data-refresh-device]");
  if (refreshDeviceButton) {
    refreshDeviceButton.addEventListener("click", () => {
      addLog("Perangkat", "Status perangkat diperbarui", "ok");
    });
  }

  const exportLogButton = document.querySelector("[data-export-log]");
  if (exportLogButton) {
    exportLogButton.addEventListener("click", () => {
      addLog("Log", "Riwayat sesi disiapkan untuk export", "ok");
    });
  }

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
} catch (error) {
  console.error('Error setting up remaining event listeners:', error);
}

// Initialize aplikasi dengan error handling
try {
  renderLogs();
  syncClock();
  drawIdleView();
  updateCalibrationBanner();
  updateDashboard(null, "-", "-", "WAJAH TIDAK TERBACA", 0);
  renderActivePatientProfile();
  searchPatients();

  setInterval(syncClock, 1000);
} catch (error) {
  console.error('Error initializing application:', error);
  addLog('System', 'Error initializing app: ' + error.message, 'warn');
}
