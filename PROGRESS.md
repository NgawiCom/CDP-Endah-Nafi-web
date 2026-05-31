# E.C.H.O Monitoring — Progress Log

Ringkasan pekerjaan yang sudah dilakukan pada proyek E.C.H.O (Dashboard pemantauan pasien non-verbal berbasis eye-tracking).

---

## 1. Audit Awal Workspace

Dilakukan audit lengkap dan ditemukan 7 masalah utama:

| # | Masalah | Lokasi |
|---|---|---|
| 1 | Auth login/register palsu — tidak ada validasi, langsung redirect | [frontend/login.html](frontend/login.html), [frontend/register.html](frontend/register.html) |
| 2 | 16 elemen DOM hilang — direferensi di JS tapi tidak ada di HTML | [frontend/index.html](frontend/index.html) |
| 3 | CORS tidak diatur | [backend/server.py](backend/server.py) |
| 4 | Error detail (stack trace) bocor ke response | backend lama |
| 5 | Keyboard shortcut bug — trigger saat user mengetik di input | [frontend/script.js](frontend/script.js) |
| 6 | NIK tidak divalidasi (boleh huruf, panjang bebas) | form pasien |
| 7 | Tidak ada limit Content-Length — rawan DoS | backend lama |

---

## 2. Fix Semua Audit Findings

Selesai dengan perubahan:

- **Auth real** — login/register kini hit API backend, token disimpan di `localStorage` (`echo_token`)
- **Auth guard** — setiap halaman terproteksi cek token di `<head>` sebelum render
- **Tombol Logout** — di topbar, hapus token + redirect ke login
- **Status Grid, Metrics Grid, Operations Grid, Log Panel** — section baru di [index.html](frontend/index.html) untuk semua DOM element yang sebelumnya hilang
- **CORS middleware** — terkonfigurasi via `--cors-origin` flag
- **Sanitasi error response** — hanya pesan, bukan stack trace
- **Keyboard handler aman** — skip event kalau target = `INPUT`/`TEXTAREA`/`SELECT`
- **NIK validation** — `pattern="[0-9]{16}"` + Pydantic `pattern=r"^\d{16}$"`
- **Limit body** — diserahkan ke FastAPI/uvicorn default

---

## 3. Migrasi Backend: stdlib → FastAPI (Versi Awal)

Backend dipindah dari `BaseHTTPRequestHandler` ke **FastAPI + uvicorn**:
- Pydantic v2 untuk validasi body
- `HTTPBearer` untuk auth dependency
- Auto-generate OpenAPI docs di `/api/docs`
- Exception handler untuk `ValueError`/`LookupError`/`HTTPException`
- PBKDF2-SHA256 untuk password hashing
- Token random hex 64-char di SQLite

---

## 4. Database Cleanup

- Seluruh data dummy (5 pasien sample, 3 sesi, 15 event) **dihapus**
- File [backend/data/echo_monitoring.sqlite3](backend/data/) di-reset
- Script `seed.py` dihapus
- Schema otomatis dibuat ulang saat server startup

---

## 5. Pembuatan CLAUDE.md

File [CLAUDE.md](CLAUDE.md) dibuat di root project sebagai instruksi persisten untuk Claude:
- Daftar perintah bash yang boleh **auto-run** vs yang wajib konfirmasi
- Anti-halu rules — wajib verifikasi file/endpoint sebelum klaim
- Standar coding — pattern Pydantic + Depends, jangan fetch langsung di frontend
- Format output — singkat, langsung, pakai bahasa Indonesia

---

## 6. Backend Rework Total (Versi Profesional)

Backend di-refactor total jadi **struktur modular siap produksi**.

### Stack modern
- **FastAPI 0.136** dengan factory pattern (`uvicorn.run("app.main:create_app", factory=True)`)
- **SQLAlchemy 2.0** dengan typed ORM (`Mapped[]` syntax, FK cascade, indexes)
- **JWT (PyJWT, HS256)** — secret auto-generate, expire 24 jam
- **bcrypt** via passlib (12 rounds, industry standard)
- **pydantic-settings** — config aware `.env` dengan prefix `ECHO_`
- **email-validator** — validasi format email otomatis

### Struktur direktori baru

```
backend/
├── server.py                 # Entry point (thin) — argparse + uvicorn
├── requirements.txt          # Dependency modern
├── data/                     # SQLite (auto-create)
└── app/
    ├── __init__.py
    ├── main.py               # FastAPI factory + lifespan + router wiring
    ├── config.py             # pydantic-settings (.env aware)
    ├── database.py           # SQLAlchemy 2.0 engine + session
    ├── security.py           # bcrypt + JWT
    ├── models.py             # ORM (User, Patient, TrackingSession, TrackingEvent)
    ├── schemas.py            # Pydantic v2 request/response
    ├── deps.py               # DbSession, CurrentUser (JWT verify)
    ├── exceptions.py         # AppError/NotFound/Auth/Conflict + handlers
    ├── routers/
    │   ├── auth.py           # /api/auth/{register,login,me,logout}
    │   ├── health.py         # /api/health
    │   ├── patients.py       # /api/patients
    │   └── sessions.py       # /api/patients/{id}/sessions, /api/sessions/{id}/*
    └── services/             # Business logic layer
        ├── auth_service.py
        ├── patient_service.py
        └── session_service.py
```

### Tabel database
- **users** — id, name, email (unik), role, password_hash (bcrypt), is_active, timestamps
- **patients** — id, patient_code (unik), name, gender, nik (unik, 16 digit), room, bed, notes, calibration_json, FK created_by_id
- **tracking_sessions** — id, FK patient_id, started_at, ended_at, status, source, device_label, notes
- **tracking_events** — id, FK session_id, FK patient_id, captured_at, event_type, gaze_direction, eye_state, confidence, fps, latency_ms, blink_count, click_status, output_message, metadata_json

### Endpoint API

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/health` | - | Health check |
| POST | `/api/auth/register` | - | Daftar akun |
| POST | `/api/auth/login` | - | Login -> JWT token |
| GET | `/api/auth/me` | Bearer | Info user aktif |
| POST | `/api/auth/logout` | Bearer | Logout (hapus di client) |
| GET | `/api/patients?q=...` | Bearer | List pasien (cari nama/NIK/kode) |
| POST | `/api/patients` | Bearer | Tambah/update pasien (idempotent by NIK) |
| GET | `/api/patients/{id}` | Bearer | Detail pasien |
| GET | `/api/patients/{id}/sessions` | Bearer | Daftar sesi |
| POST | `/api/patients/{id}/sessions` | Bearer | Buat sesi baru |
| PATCH | `/api/sessions/{id}` | Bearer | Update status sesi |
| GET | `/api/sessions/{id}/tracking-events` | Bearer | List event |
| POST | `/api/sessions/{id}/tracking-events` | Bearer | Rekam event |
| GET | `/api/sessions/{id}/summary` | Bearer | Ringkasan agregat sesi |

### Hasil Test End-to-End

| Test | Status |
|---|---|
| Health check | OK |
| Register user baru | 201 + user object |
| Login -> JWT | 200 + token (HS256, 24h) + expires_in |
| GET /auth/me dengan JWT | OK |
| List patients kosong | OK `{patients:[]}` |
| POST patient (NIK 16 digit) | 201 + patient object |
| List patients (terisi) | OK dengan session_count + event_count |
| POST session | 201 |
| POST tracking event | 201 |
| GET session summary | OK dengan stats agregat |
| Tanpa Authorization header | 401 "Header Authorization Bearer wajib disertakan." |
| Token tidak valid | 401 "Token tidak valid." |
| Email duplikat | 409 "Email sudah terdaftar." |
| NIK kurang dari 16 digit | 422 "nik: String should have at least 16 characters" |

---

## Cara Menjalankan Server

```powershell
& "d:\CDP-Endah-Nafi-web\backend\.venv\Scripts\python.exe" "d:\CDP-Endah-Nafi-web\backend\server.py" --cors-origin "*"
```

Setelah running:
- **Dashboard**: http://127.0.0.1:8000
- **API Docs (Swagger)**: http://127.0.0.1:8000/api/docs
- **API Docs (ReDoc)**: http://127.0.0.1:8000/api/redoc
- **Login page**: http://127.0.0.1:8000/login.html
- **Register page**: http://127.0.0.1:8000/register.html

Database akan auto-create di [backend/data/echo_monitoring.sqlite3](backend/data/) saat startup pertama.

---

## Konteks Domain

Aplikasi untuk **pasien non-verbal di ICU/bangsal saraf** (stroke, ALS, sindrom locked-in, cedera tulang belakang). Komunikasi via eye-tracking (MediaPipe FaceMesh).

NIK & data medis = sensitif -> auth wajib di setiap endpoint kecuali register/login/health. Password di-hash bcrypt 12 rounds. JWT signed HS256 dengan secret auto-generate per deployment.
