# 🎙️ Transkrip Rapat Offline & Audio (Groq Whisper AI)

Aplikasi desktop modern berbasis **PyWebView** untuk mengubah rekaman audio rapat offline menjadi transkrip lengkap berbahasa Indonesia dengan penanda waktu (*timestamp*) per kalimat.

---

### ✨ Fitur Unggulan:
1. **Dukungan Audio Panjang (2 Jam atau Lebih)**:
   - Secara otomatis memotong audio panjang menjadi bagian 10 menit agar tidak terkena limit upload file (25 MB) di Groq.
   - Tetap menjaga kontinuitas waktu global dari menit awal hingga akhir (misal `[00:00:15]` sampai `[01:45:20]`).
2. **Format Transkrip Jelas & Rapi**:
   - Setiap percakapan otomatis di-enter dan diberi *timestamp*:
     ```text
     [00:00:15] Halo Pak nama saya alzha
     [00:00:20] Halo juga, nama saya denis
     ```
   - Tidak diringkas atau dipotong (100% *verbatim*).
3. **Format Audio Fleksibel**:
   - Mendukung format: `.mp3`, `.m4a`, `.wav`, `.aac`, `.mp4` (video rapat diambil suaranya), `.flac`, `.ogg`.
4. **Antarmuka Desktop Modern (PyWebView)**:
   - Tampilan dark mode bersih, responsif, dan elegan.
   - Bilah progres transkripsi *real-time* per potongan audio.
   - Hasil transkrip langsung muncul baris demi baris saat sedang diproses.
5. **Pencarian & Ekspor Sekali Klik**:
   - Kotak pencarian (*Search Bar*) untuk memfilter isi pembicaraan di rapat panjang.
   - Tombol **Salin Semua Transkrip** (ke clipboard).
   - Tombol simpan **.TXT** dan format **.MD** (Markdown).
   - Otomatis tersimpan ke folder `output/`.

---

### 🚀 Cara Menjalankan:
1. **Klik dua kali (Double-click)** file:
   ```text
   run.bat
   ```
2. Aplikasi akan terbuka.
3. Klik kotak **File Audio Rekaman** untuk memilih file suara rapat Anda (dari HP, recorder, atau laptop).
4. Klik tombol **▶️ Mulai Transkripsi**.
