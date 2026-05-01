const sidebar = document.querySelector("[data-sidebar]");
const menuButton = document.querySelector("[data-menu-button]");
const navLinks = Array.from(document.querySelectorAll(".side-nav a"));
const clock = document.querySelector("[data-clock]");
const uptime = document.querySelector("[data-uptime]");
const canvas = document.querySelector("#eyeCanvas");
const ctx = canvas.getContext("2d");

const state = {
  startedAt: Date.now(),
  tick: 0,
  muted: false,
  blinkCount: 12,
  currentMessage: "Saya haus",
  logs: [
    ["22:19:08", "Pesan pasien", "Saya haus", "ok"],
    ["22:18:54", "Tracking", "Arah pandangan terdeteksi: tengah", "ok"],
    ["22:18:31", "Perangkat", "Speaker volume rendah", "warn"],
    ["22:17:42", "Kalibrasi", "Kalibrasi 5 titik selesai", "ok"],
    ["22:16:03", "Sesi", "Monitoring dimulai untuk ICU Bed A12", "ok"],
  ],
};

const directions = [
  { label: "Tengah", x: 0, y: 0, message: "Saya haus" },
  { label: "Kiri", x: -1, y: 0, message: "Tolong panggil perawat" },
  { label: "Kanan", x: 1, y: 0, message: "Ubah posisi tidur" },
  { label: "Atas", x: 0, y: -1, message: "Saya sakit" },
  { label: "Bawah", x: 0, y: 1, message: "Saya ingin istirahat" },
];

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
  ear: document.querySelector("[data-ear]"),
  blinkCount: document.querySelector("[data-blink-count]"),
  trackingQuality: document.querySelector("[data-tracking-quality]"),
  latency: document.querySelector("[data-latency]"),
  lighting: document.querySelector("[data-lighting]"),
  signal: document.querySelector("[data-signal]"),
  blinkRate: document.querySelector("[data-blink-rate]"),
  focus: document.querySelector("[data-focus]"),
  response: document.querySelector("[data-response]"),
  cameraStatus: document.querySelector("[data-camera-status]"),
  cpuTemp: document.querySelector("[data-cpu-temp]"),
  alertTime: document.querySelector("[data-alert-time]"),
  calibrationTime: document.querySelector("[data-calibration-time]"),
  alertCount: document.querySelector("[data-alert-count]"),
  logList: document.querySelector("[data-log-list]"),
};

function pad(value) {
  return String(value).padStart(2, "0");
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
          <span role="cell">${time}</span>
          <span role="cell">${event}</span>
          <span role="cell">${detail}</span>
          <span role="cell" class="log-status ${status}" aria-label="${label}">${label}</span>
        </div>
      `;
    })
    .join("");
}

function syncClock() {
  const now = new Date();
  clock.textContent = formatTime(now);
  uptime.textContent = formatDuration(Date.now() - state.startedAt);
}

function setMessage(message, source = "Pesan pasien") {
  state.currentMessage = message;
  elements.currentMessage.textContent = message;
  elements.outputText.textContent = message;
  elements.messageTime.textContent = "Diterima baru saja";
  addLog(source, message, message.includes("panggil") || message.includes("sakit") ? "alert" : "ok");
}

function updateMetrics() {
  state.tick += 1;
  const direction = directions[Math.floor(state.tick / 4) % directions.length];
  const confidence = 88 + Math.round(Math.abs(Math.sin(state.tick / 3)) * 10);
  const fps = 29 + Math.round(Math.sin(state.tick / 2));
  const ear = (0.27 + Math.abs(Math.sin(state.tick / 5)) * 0.09).toFixed(2);
  const latency = 38 + Math.round(Math.abs(Math.cos(state.tick / 4)) * 16);
  const signal = 86 + Math.round(Math.abs(Math.sin(state.tick / 2.5)) * 10);
  const focus = 82 + Math.round(Math.abs(Math.cos(state.tick / 3.5)) * 12);
  const temp = 47 + Math.round(Math.abs(Math.sin(state.tick / 4)) * 5);

  if (state.tick % 6 === 0) {
    state.blinkCount += 1;
  }

  if (state.tick % 16 === 0) {
    setMessage(direction.message, "Deteksi gerakan mata");
  }

  elements.gazeDirection.textContent = direction.label;
  elements.confidence.textContent = `${confidence}%`;
  elements.confidenceBar.style.width = `${confidence}%`;
  elements.fps.textContent = fps;
  elements.ear.textContent = ear;
  elements.blinkCount.textContent = state.blinkCount;
  elements.latency.textContent = `${latency} ms`;
  elements.signal.textContent = `${signal}%`;
  elements.focus.textContent = `${focus}%`;
  elements.response.textContent = `${(0.6 + Math.abs(Math.sin(state.tick / 5)) * 0.5).toFixed(1)} s`;
  elements.blinkRate.textContent = `${12 + Math.round(Math.abs(Math.sin(state.tick / 2)) * 4)} /min`;
  elements.cameraStatus.textContent = `${fps} FPS`;
  elements.cpuTemp.textContent = `${temp} C`;
  elements.deviceScore.textContent = signal > 90 ? "98" : "94";
  elements.trackingQuality.textContent = confidence > 93 ? "Excellent" : "Good";
  elements.lighting.textContent = state.tick % 9 === 0 ? "Cukup" : "Normal";
  elements.alertTime.textContent = state.muted ? "Alert disenyapkan" : "Baru saja";
  elements.alertCount.textContent = state.muted ? "Senyap" : "2 aktif";

  drawEyeTracking(direction, confidence);
}

function drawEyeTracking(direction, confidence) {
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const offsetX = direction.x * 42 + Math.sin(state.tick / 2) * 5;
  const offsetY = direction.y * 24 + Math.cos(state.tick / 2) * 3;

  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071417");
  gradient.addColorStop(0.55, "#102a30");
  gradient.addColorStop(1, "#071417");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let x = 40; x < width; x += 52) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 36; y < height; y += 52) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + 46, 168, 205, 0, 0, Math.PI * 2);
  ctx.fill();

  drawEye(centerX - 92, centerY - 18, offsetX, offsetY);
  drawEye(centerX + 92, centerY - 18, offsetX, offsetY);

  ctx.strokeStyle = "rgba(42, 168, 184, 0.9)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 10]);
  ctx.strokeRect(centerX - 248, centerY - 132, 496, 190);
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(141, 230, 229, 0.92)";
  ctx.font = "700 18px Inter, system-ui, sans-serif";
  ctx.fillText(`Gaze: ${direction.label}`, centerX - 238, centerY - 102);
  ctx.fillText(`Confidence: ${confidence}%`, centerX - 238, centerY - 76);

  ctx.strokeStyle = "rgba(217, 138, 24, 0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - 18);
  ctx.lineTo(centerX + direction.x * 130, centerY - 18 + direction.y * 90);
  ctx.stroke();

  ctx.fillStyle = "#d98a18";
  ctx.beginPath();
  ctx.arc(centerX + direction.x * 130, centerY - 18 + direction.y * 90, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawEye(x, y, offsetX, offsetY) {
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.ellipse(x, y, 72, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(15, 143, 140, 0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y, 72, 34, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#143842";
  ctx.beginPath();
  ctx.arc(x + offsetX * 0.42, y + offsetY * 0.55, 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#7ddbd7";
  ctx.beginPath();
  ctx.arc(x + offsetX * 0.42, y + offsetY * 0.55, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.beginPath();
  ctx.arc(x + offsetX * 0.42 - 6, y + offsetY * 0.55 - 7, 4, 0, Math.PI * 2);
  ctx.fill();
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
  elements.calibrationTime.textContent = "Baru saja";
  addLog("Kalibrasi", "Kalibrasi 5 titik dijalankan", "ok");
});

document.querySelector("[data-toggle-alert]").addEventListener("click", () => {
  state.muted = !state.muted;
  addLog("Alert", state.muted ? "Alert disenyapkan" : "Alert diaktifkan kembali", state.muted ? "warn" : "ok");
  updateMetrics();
});

document.querySelector("[data-refresh-device]").addEventListener("click", () => {
  addLog("Perangkat", "Status perangkat diperbarui", "ok");
});

document.querySelector("[data-export-log]").addEventListener("click", () => {
  addLog("Log", "Riwayat sesi disiapkan untuk export", "ok");
});

renderLogs();
syncClock();
updateMetrics();

setInterval(syncClock, 1000);
setInterval(updateMetrics, 2200);
