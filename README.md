# E.C.H.O Monitoring

Dashboard web untuk monitoring sistem E.C.H.O dengan feed kamera wajah asli.

Panel `Live Eye Tracking` sekarang memakai kamera browser dan MediaPipe FaceMesh,
dengan logika rasio iris/kelopak yang diselaraskan dari `coba_mata_lis_control.py`.

## Fokus tampilan

- Monitoring live eye tracking dari kamera asli, bukan animasi mata.
- Status pasien, arah pandangan, confidence, blink rate, dan latency.
- Output pesan pasien non-verbal.
- Status kamera, unit proses, layar, dan speaker.
- Alert prioritas dan activity log.

## Cara membuka dashboard web

Kamera browser biasanya perlu `localhost` atau HTTPS. Jalankan server lokal dari folder project:

```bash
python -m http.server 8000
```

Lalu buka:

```text
http://localhost:8000
```

Izinkan akses kamera saat browser meminta izin. Library MediaPipe dimuat dari CDN, jadi perangkat perlu koneksi internet saat pertama kali membuka dashboard.

Kontrol web sama seperti program Python:

- Tekan `b` sambil melihat bawah.
- Tekan `c` sambil melihat tengah/center.
- Tekan `t` sambil melihat atas.
- Tekan `s` untuk mulai Program E setelah semua kalibrasi selesai.
- Tekan `r` untuk mengulang kalibrasi.

Di panel `Pesan Pasien` juga tersedia tombol `Bawah`, `Tengah`, `Atas`,
`Mulai`, dan `Ulang` jika keyboard tidak nyaman dipakai.

## Cara menjalankan tracking mata Python

Install dependency:

```bash
pip install opencv-python mediapipe
```

Jalankan:

```bash
python coba_mata_lis_control.py
```

Kalibrasi dilakukan di awal:

- Tekan `b` sambil melihat bawah.
- Tekan `c` sambil melihat tengah/center.
- Tekan `t` sambil melihat atas.
- Tiap pengambilan data berlangsung 3-15 detik, default 4 detik.
- Tekan `s` untuk mulai Program E setelah semua kalibrasi selesai.

Saat Program E berjalan, arah aktif hanya `ATAS` dan `BAWAH`.
Merem 5 detik mengirim `YES`, kedip cepat 2 kali mengirim `NO`.
