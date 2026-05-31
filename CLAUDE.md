# E.C.H.O Monitoring — Instruksi untuk Claude

Dashboard pemantauan pasien non-verbal berbasis eye-tracking (MediaPipe FaceMesh). Frontend berdiri sendiri tanpa koneksi backend.

## Stack

- **Frontend**: Vanilla JS + HTML + CSS, folder [frontend/](frontend/)
  - Entry point: [frontend/index.html](frontend/index.html)
  - Logika utama: [frontend/script.js](frontend/script.js)
  - Gaya: [frontend/styles.css](frontend/styles.css)
  - `login.html` dan `register.html` ada di folder tapi **tidak terhubung** ke dashboard — tidak dipakai
- **Eye-tracking**: MediaPipe FaceMesh via CDN (`@mediapipe/face_mesh`, `@mediapipe/camera_utils`)
- **Penyimpanan data**: `localStorage` saja, key `echo_patients` — tidak ada IndexedDB, tidak ada backend
- **Backend** (terpisah, tidak digunakan frontend): FastAPI + SQLAlchemy di [backend/](backend/), entry point [backend/server.py](backend/server.py)
- **Eye-tracking standalone Python**: [backend/coba_mata_lis_control.py](backend/coba_mata_lis_control.py) (OpenCV + MediaPipe, berjalan mandiri)

## Cara Menjalankan Frontend

Buka langsung di browser: `frontend/index.html` — tidak butuh server.

Atau jalankan backend (opsional, tidak dipakai frontend):
```powershell
& "d:\CDP-Endah-Nafi-web\backend\.venv\Scripts\python.exe" "d:\CDP-Endah-Nafi-web\backend\server.py" --cors-origin "*"
```

## Fitur Frontend yang Sudah Ada

| Fitur | Deskripsi |
|-------|-----------|
| Eye tracking | MediaPipe FaceMesh via CDN, kamera nyata |
| Kalibrasi | 3 titik: Bawah (B), Tengah (C), Atas (T) — keyboard shortcut |
| Deteksi arah | ATAS / BAWAH / TENGAH dari rasio iris |
| Blink detection | Merem 5 detik = YES, kedip cepat 2x = NO |
| Simpan pasien | Form biodata (Nama, NIK 16 digit, Jenis Kelamin) → localStorage |
| Muat pasien | Klik nama di sidebar → kalibrasi dimuat, program langsung aktif |
| Alert panel | Driven dari `state.logs`, filter status `warn`/`alert` |
| Durasi sesi | Real-time dari `state.startedAt`, update tiap detik |
| Camera fullscreen | Fullscreen API + fallback CSS |

## Struktur localStorage

```json
// Key: "echo_patients"
// Upsert by NIK — NIK sama menggantikan data lama
[
  {
    "id": "timestamp-string",
    "name": "Nama Pasien",
    "nik": "1234567890123456",
    "gender": "Laki-laki",
    "savedAt": "ISO-string",
    "calibration": {
      "samples": { "top": [float...], "center": [float...], "bottom": [float...] },
      "openEyeGaps": [float...]
    }
  }
]
```

## Data Attributes Penting (index.html ↔ script.js)

| Attribute | Lokasi | Fungsi |
|-----------|--------|--------|
| `data-patient-list` | sidebar | container list pasien tersimpan |
| `data-save-section` | command panel | form simpan kalibrasi, `hidden` by default |
| `data-save-form` | command panel | form biodata pasien |
| `data-save-error` | command panel | pesan error validasi form |
| `data-active-patient-section` | command panel | card pasien aktif, `hidden` by default |
| `data-load-patient` | dinamis | id pasien untuk dimuat dari localStorage |
| `data-device-dot-camera` | status sistem | dot kamera, class `active`/`idle` |
| `data-calibration-status` | tracking summary | status kalibrasi real-time |
| `data-session-duration` | metrics | durasi sesi, update tiap detik |
| `data-alert-list` | alert panel | driven dari logs warn/alert |

## Aturan Kerja

### Jalankan otomatis (jangan tanya dulu)
- Baca file, grep, glob, list direktori
- Edit kode existing — eksekusi langsung
- Verifikasi perubahan dengan membaca file hasil edit

### Wajib konfirmasi dulu
- Hapus file/folder (`Remove-Item`)
- Commit + push ke remote
- Perubahan pada `login.html`/`register.html` (tidak dipakai, hindari menyentuh)

### Anti-Halu
- **Jangan asumsi fungsi/elemen ada** — grep dulu atau baca file sebelum menyebutnya
- **Jangan bilang "selesai" tanpa verifikasi** — untuk perubahan logika JS, cek tidak ada referensi putus (`data-*` di HTML harus ada di `elements` di script.js dan sebaliknya)
- **Jangan tambah backend baru** — frontend sudah sengaja standalone tanpa API call

### Standar Coding

**Frontend JS:**
- Tidak ada framework — vanilla JS murni
- State global di satu objek `state` di [script.js](frontend/script.js)
- Elemen DOM di satu objek `elements` di [script.js](frontend/script.js) — tambah di sini kalau butuh elemen baru
- Semua update DOM lewat `setText()` / `setWidth()` — tidak langsung `element.textContent`
- `addLog(event, detail, status)` untuk semua log → otomatis trigger `renderAlerts()`
- `localStorage` diakses lewat `loadStoredPatients()` / `persistPatient()` — jangan akses langsung

**HTML:**
- Auth guard dihapus — `index.html` tidak redirect ke login
- `login.html` dan `register.html` tidak terhubung ke mana-mana — jangan tambah link ke sana
- NIK: validasi `pattern="[0-9]{16}"` di form HTML, validasi `/^\d{16}$/` di JS handler

**CSS:**
- CSS custom properties di `:root` di [styles.css](frontend/styles.css)
- Kelas baru ikuti pola yang sudah ada — lihat blok terakhir `styles.css` untuk referensi kelas pasien terbaru
- `device-dot` punya varian: `active` (hijau), `idle` (abu), `online` (hijau), `warning` (amber)

**Komentar:**
- Tidak ada komentar yang menjelaskan WHAT — kode harus self-explanatory
- Komentar hanya untuk WHY non-obvious

### Format Output
- Respon singkat, langsung ke point
- Jangan ringkas ulang apa yang baru dilakukan kalau diff sudah jelas
- Pakai bahasa Indonesia
- Reference file pakai markdown link: `[script.js:120](frontend/script.js#L120)`

## Konteks Domain

Pasien target: non-verbal di ICU/bangsal saraf (stroke, ALS, sindrom locked-in). Sistem membantu komunikasi via gerakan mata — ATAS/BAWAH untuk navigasi, kedip untuk konfirmasi YES/NO. NIK & biodata = sensitif → jangan log ke console, jangan expose ke URL.

## File yang Tidak Dipakai (Jangan Dimodifikasi Tanpa Alasan)

- `frontend/login.html` — ada tapi tidak terhubung ke dashboard
- `frontend/register.html` — ada tapi tidak terhubung ke dashboard
- `backend/` — backend masih utuh tapi frontend tidak menggunakannya
