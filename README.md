# 🤖 WhatsApp Accounting & OCR Automation Bot
[English](#english) | [Bahasa Indonesia](#bahasa-indonesia)

---

<a name="english"></a>
## 🇬🇧 English

An intelligent Node.js-based WhatsApp bot designed to automate financial bookkeeping for multi-branch businesses using OCR technology and interactive chat commands.

### 📸 App Preview / Screenshots
*(Add your screenshots below)*
<p align="center">
  <img src="path/to/your-screenshot.png" alt="WhatsApp Bot Preview" width="700">
</p>

### ✨ Core Features
* **OCR Receipt Scanning:** Automatically extracts transaction details (items, prices, totals) from user-submitted receipt images.
* **Interactive Correction:** Allows users to review and correct OCR extraction errors directly via WhatsApp chat before saving.
* **Database Integration:** Securely stores verified transactions into a robust database with branch tracking.
* **Smart Reporting:** Generates instant financial summaries on-demand (e.g., typing `rekap jogja juli` retrieves branch-specific monthly reports).

### 🛠️ Tech Stack
* **Backend:** Node.js, Express.js
* **WhatsApp Integration:** Baileys / WhatsApp Web API
* **OCR Engine:** OCR.space API / Custom OCR Processor
* **Database:** MySQL / MongoDB

### 🔄 System Workflow
1. **Send Receipt:** User sends a receipt photo to the WhatsApp bot.
2. **OCR Processing:** Bot extracts text and items from the image.
3. **Review & Correct:** Bot replies with a preview; user can make quick corrections via chat if needed.
4. **Save to DB:** Confirmed data is securely saved to the database.
5. **Get Report:** User requests automated reports anytime using natural text commands (e.g., `rekap jogja juli`).

### 🚀 How to Run Locally
1. Clone this repository:
   bash
   git clone
   npm install
   npm start

<a name="bahasa-indonesia"></a> 
## Bahasa Indonesia

Bot WhatsApp cerdas berbasis Node.js yang dirancang untuk mengotomatisasi pencatatan akuntansi keuangan bisnis multi-cabang menggunakan teknologi OCR dan perintah chat interaktif.

📸 Pratinjau Aplikasi / Screenshot
(Tambahkan tangkapan layar aplikasi Anda di bawah ini)

✨ Fitur Utama
Pemindaian Nota OCR: Mengekstrak detail transaksi (nama barang, harga, total) secara otomatis dari foto struk/nota yang dikirimkan pengguna.

Koreksi Interaktif: Memungkinkan pengguna meninjau dan memperbaiki hasil baca OCR langsung via chat WhatsApp sebelum disimpan.

Integrasi Database: Menyimpan transaksi yang telah diverifikasi secara aman ke dalam database lengkap dengan pelacakan cabang.

Laporan Pintar: Menghasilkan ringkasan keuangan instan sesuai permintaan (contoh: mengetik rekap jogja juli untuk menarik laporan bulanan cabang tertentu).

🛠️ Teknologi yang Digunakan
Backend: Node.js, Express.js

Integrasi WhatsApp: Baileys / WhatsApp Web API

Mesin OCR: OCR.space API / Custom OCR Processor

Database: MySQL / MongoDB

🔄 Alur Kerja Sistem (Workflow)
Kirim Nota: Pengguna mengirim foto nota/struk belanja ke bot WhatsApp.

Proses OCR: Bot membaca teks dan data dari gambar tersebut.

Tinjau & Koreksi: Bot membalas dengan pratinjau; pengguna dapat melakukan koreksi via chat jika ada data yang keliru.

Simpan ke DB: Data yang sudah dikonfirmasi disimpan secara permanen ke database.

Minta Laporan: Pengguna dapat meminta rekap laporan kapan saja menggunakan format teks (contoh: rekap jogja juli).

🚀 Cara Menjalankan Secara Lokal
Clone repositori ini:

Bash
git clone [https://github.com/PoietesDev/whatsapp-accounting-bot.git](https://github.com/PoietesDev/WaBot.git)
Masuk ke direktori proyek:

Bash
cd whatsapp-accounting-bot
Install dependensi:

Bash
npm install
Buat dan sesuaikan file .env untuk konfigurasi Anda (lihat contoh di .env.example).

Jalankan aplikasi:

Bash
npm start

<FollowUp>Apakah Anda ingin kita lanjutkan dengan merancang struktur file kode atau skrip untuk bot WhatsApp ini?</FollowUp>
