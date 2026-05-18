# E.C.H.O Monitoring

Dashboard web untuk monitoring sistem E.C.H.O dengan feed kamera wajah asli dan backend SQLite untuk menyimpan data tracking pasien.

Panel `Live Eye Tracking` sekarang memakai kamera browser dan MediaPipe FaceMesh,
dengan logika rasio iris/kelopak yang diselaraskan dari `coba_mata_lis_control.py`.

## Fokus tampilan

- Monitoring live eye tracking dari kamera asli, bukan animasi mata.
- Panel kamera di kiri dengan tombol fullscreen/minimize.
- Panel kanan untuk profil pasien, simpan kalibrasi manual, output pesan, dan kontrol Program E.
- Sidebar `Cari Pasien` untuk memuat pasien tersimpan dari backend.

## Data yang disimpan backend

Backend menyimpan data ke `backend/data/echo_monitoring.sqlite3`:

- Profil pasien (`nama`, `jenis kelamin`, `NIK`, ruang, bed, catatan).
- Data kalibrasi pasien (`coordinates`, threshold, sample Bawah/Tengah/Atas, dan measurement pendukung).
- Sesi tracking per pasien.
- Snapshot tracking berkala: arah pandangan, confidence, status mata, eye gap, gaze ratio, FPS, latency, blink count, dan output aktif.
- Event pesan pasien seperti `YES`, `NO`, dan arah pandangan yang terdeteksi.

## Cara membuka dashboard web

Kamera browser biasanya perlu `localhost` atau HTTPS. Jalankan backend dari folder root project:

```bash
python backend/server.py
```

Lalu buka:

```text
http://localhost:8000
```

Server backend juga melayani file frontend, jadi cukup satu proses. Izinkan akses kamera saat browser meminta izin. Library MediaPipe dimuat dari CDN, jadi perangkat perlu koneksi internet saat pertama kali membuka dashboard.

Kontrol web sama seperti program Python:

- Tekan `b` sambil melihat bawah.
- Tekan `c` sambil melihat tengah/center.
- Tekan `t` sambil melihat atas.
- Isi profil di panel kanan dan klik `Simpan Kalibrasi`.
- Tekan `s` atau tombol `Mulai` setelah data kalibrasi tersimpan.
- Tekan `r` untuk mengulang kalibrasi.

Di panel kanan juga tersedia tombol `Bawah`, `Tengah`, `Atas`, `Mulai`, dan `Ulang`.

## Flow profil pasien dan kalibrasi tersimpan

Pasien baru:

- Jalankan kalibrasi Bawah, Tengah, dan Atas.
- Isi `Nama`, `Jenis Kelamin`, dan `NIK` di panel kanan kamera.
- Klik `Simpan Kalibrasi`.
- Backend menyimpan profil pasien dan data kalibrasi.
- Klik `Mulai` untuk menjalankan Program E.

Pasien lama:

- Gunakan `Cari Pasien` di sidebar.
- Cari berdasarkan nama atau NIK.
- Pilih pasien dari hasil pencarian.
- Dashboard pindah ke panel kanan `Data Pasien`, menampilkan status backend dan koordinat kalibrasi tersimpan.
- Dashboard memuat data kalibrasi tersimpan dan langsung membuka sesi tracking baru tanpa perlu kalibrasi ulang.

## API backend

Endpoint utama:

- `GET /api/health`
- `GET /api/patients`
- `POST /api/patients`
- `GET /api/patients/{id}/sessions`
- `POST /api/patients/{id}/sessions`
- `GET /api/sessions/{id}/tracking-events`
- `POST /api/sessions/{id}/tracking-events`
- `GET /api/sessions/{id}/summary`

`GET /api/patients?q=kata-kunci` bisa dipakai untuk mencari pasien berdasarkan nama, NIK, atau kode pasien.

## Cara menjalankan tracking mata Python

Install dependency:

```bash
pip install opencv-python mediapipe
```

Jalankan:

```bash
python backend/coba_mata_lis_control.py
```

Kalibrasi dilakukan di awal:

- Tekan `b` sambil melihat bawah.
- Tekan `c` sambil melihat tengah/center.
- Tekan `t` sambil melihat atas.
- Tiap pengambilan data berlangsung 3-15 detik, default 4 detik.
- Tekan `s` untuk mulai Program E setelah semua kalibrasi selesai.

Saat Program E berjalan, arah aktif hanya `ATAS` dan `BAWAH`.
Merem 5 detik mengirim `YES`, kedip cepat 2 kali mengirim `NO`.
