# E.C.H.O Monitoring — Instruksi untuk Claude

Dashboard pemantauan pasien non-verbal berbasis eye-tracking (MediaPipe FaceMesh).

## Stack

- **Backend**: FastAPI + uvicorn (Python 3.14), entry point [backend/server.py](backend/server.py), aplikasi di [backend/app/](backend/app/)
- **ORM**: SQLAlchemy 2.0 (typed `Mapped[]` syntax), model di [backend/app/models.py](backend/app/models.py)
- **Auth**: JWT (HS256, PyJWT) + bcrypt (passlib) — lihat [backend/app/security.py](backend/app/security.py)
- **Config**: pydantic-settings (.env aware, prefix `ECHO_`) di [backend/app/config.py](backend/app/config.py)
- **Database**: SQLite di [backend/data/echo_monitoring.sqlite3](backend/data/) (auto-create)
- **Frontend**: Vanilla JS + HTML + CSS, folder [frontend/](frontend/)
- **Eye-tracking standalone**: [backend/coba_mata_lis_control.py](backend/coba_mata_lis_control.py) (OpenCV + MediaPipe)
- **Package manager**: `uv`, virtualenv di `backend/.venv/`

## Cara Menjalankan

```powershell
& "d:\CDP-Endah-Nafi-web\backend\.venv\Scripts\python.exe" "d:\CDP-Endah-Nafi-web\backend\server.py" --cors-origin "*"
```

- Server: http://127.0.0.1:8000
- API Docs: http://127.0.0.1:8000/api/docs
- Login: http://127.0.0.1:8000/login.html
- Register: http://127.0.0.1:8000/register.html

## Aturan Kerja

### Jalankan otomatis (jangan tanya dulu)
- Baca file, grep, glob, list direktori
- Run server backend, restart server, cek port
- Query SQLite read-only untuk verifikasi
- Test endpoint API (`Invoke-RestMethod`)
- Edit kode existing — eksekusi langsung, jangan minta approval per langkah

### Wajib konfirmasi dulu
- Hapus file/folder/database (`Remove-Item`, `DROP TABLE`)
- Force push, reset --hard, hapus branch
- Install/uninstall paket baru
- Commit + push ke remote
- Ubah skema database yang sudah berisi data asli

### Anti-Halu (verifikasi sebelum klaim)
- **Jangan asumsi file/fungsi/endpoint ada** — baca dulu file-nya atau grep dulu sebelum menyebutnya
- **Jangan bilang "selesai" tanpa test** — kalau ubah backend, hit endpoint-nya. Kalau ubah frontend yang punya logika, jalankan dan cek di browser; kalau cuma kosmetik, sebutkan tidak di-test
- **Jangan invent API FastAPI/Pydantic** — kalau ragu, cek dokumentasi resmi via WebFetch, jangan ngarang
- **Konfirmasi hasil sebelum lanjut** — kalau install paket, jalankan `python -c "import x"` untuk pastikan terinstall
- **Cek error sesungguhnya** — jangan tebak; baca stderr / log uvicorn dulu

### Standar Coding
- **Backend**: ikuti pattern modular di [backend/app/](backend/app/) — schemas (Pydantic) → routers (HTTP layer) → services (business logic) → models (ORM). Untuk route terproteksi pakai `CurrentUser` dari [backend/app/deps.py](backend/app/deps.py), jangan invent dependency baru
- **Error handling**: raise exception domain dari [backend/app/exceptions.py](backend/app/exceptions.py) — `NotFoundError` (→404), `ValidationError` (→400), `ConflictError` (→409), `AuthError` (→401). Jangan return `JSONResponse` manual
- **Frontend**: vanilla JS, tidak ada framework. Selalu pakai `apiRequest()` dari [frontend/script.js](frontend/script.js) untuk hit backend (sudah handle token + 401 redirect). Jangan `fetch()` langsung
- **Auth**: JWT disimpan di `localStorage` key `echo_token`. Setiap halaman terproteksi harus ada auth-guard `<script>` di `<head>` yang redirect ke `login.html` kalau token kosong
- **NIK**: validasi 16 digit angka — `pattern="[0-9]{16}"` di form HTML + `pattern=r"^\d{16}$"` di Pydantic schema, jangan dihilangkan
- **Konsisten naming**: snake_case untuk Python, camelCase untuk JS, kebab-case untuk file frontend
- **Jangan tambah komentar yang menjelaskan WHAT** — kode harus self-explanatory. Komentar hanya untuk WHY yang non-obvious (workaround, constraint medis, kompatibilitas)
- **Jangan refactor di luar scope** — kalau diminta fix bug, jangan sekalian rapikan file lain
- **Jangan buat file baru** kalau bisa edit existing. Tidak ada README, CHANGELOG, dst kecuali diminta

### Format Output
- Respon singkat, langsung ke point — tidak perlu preamble "Saya akan..."
- Jangan ringkas ulang apa yang baru dilakukan kalau diff sudah jelas
- Pakai bahasa Indonesia (user pakai Indonesia)
- Reference file pakai markdown link: `[server.py](backend/server.py)` atau `[server.py:639](backend/server.py#L639)`

## Konteks Domain

Pasien target: non-verbal di ICU/bangsal saraf (stroke, ALS, sindrom locked-in, cedera tulang belakang). NIK & data medis = sensitif → auth wajib, jangan log password / token ke stdout, jangan expose stack trace ke response.

## Database Schema

Tabel utama: `users`, `patients`, `tracking_sessions`, `tracking_events`. Skema didefinisikan via SQLAlchemy ORM di [backend/app/models.py](backend/app/models.py). Auto-create via `init_db()` (`Base.metadata.create_all`) saat lifespan startup. Untuk perubahan schema yang melibatkan data asli, **jangan drop table** — tambah kolom baru lewat migration manual atau gunakan Alembic.
