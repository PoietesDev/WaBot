const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage,fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const ExcelJS = require('exceljs');
const qrcode = require('qrcode-terminal');
const crypto = require('crypto');
const db = require('./db/db');
const { compressImage } = require('./imageUtils');
const { prosesOCR, prosesTeksNLP } = require('./geminiService');

const userStates = {}; 
const processedImages = new Set();

const prompt = `Tuliskan isi nota ini dengan format persis seperti ini:
Nama Toko: [Nama Toko]
Kategori: [Tebak kategori pengeluaran yang paling sesuai, contoh: Bahan Baku, Operasional Toko, Perlengkapan, Utilitas, Pemeliharaan]
Tanggal: [Tanggal yang tertulis di nota, jika tidak ada kosongkan]
Total Belanja: Rp[Angka Total]
Daftar Belanja:
* [Nama Barang]: [Qty] x Rp[Harga Satuan]`;

// Fungsi mengecek jumlah total nota di database (Maksimal 50 untuk masa trial)
async function checkNotaLimitFromDB() {
    try {
        const [rows] = await db.execute('SELECT COUNT(*) AS total FROM nota');
        const totalNota = rows[0].total;
        
        // Jika jumlah nota sudah 50 atau lebih, kembalikan false (artinya limit habis)
        if (totalNota >= 6000) {
            return false;
        }
        return true;
    } catch (err) {
        console.error("Gagal mengecek limit nota:", err);
        return true; // Fallback agar bot tidak error jika tabel belum siap
    }
}
// [FITUR BARU] Fungsi AI untuk membaca format teks manual agar lebih humani
async function parseTransaksiNatural(text) {
    const promptNLP = `Analisis pesan keuangan berikut dan ekstrak menjadi format JSON yang valid. 
    Aturan:
    - "jenis": tentukan apakah 'masuk' atau 'keluar'
    - "cabang": nama cabang (default ke "Jogja" jika tidak disebutkan)
    - "nominal": angka bulat (integer) tanpa titik/ribu/k (contoh: 50k jadi 50000, 2 juta jadi 2000000)
    - "kategori": kategori umum pengeluaran/pemasukan
    - "keterangan": catatan singkat barang/keperluan

    Pesan: "${text}"

    Berikan HANYA format JSON murni tanpa teks lain atau markdown block:
    {
      "jenis": "keluar/masuk",
      "cabang": "nama cabang",
      "nominal": 0,
      "kategori": "nama kategori",
      "keterangan": "detail"
    }`;

    try {
        // Menggunakan fungsi khusus teks NLP yang baru
        const hasilAI = await prosesTeksNLP(promptNLP); 
        const cleanJSON = hasilAI.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJSON);
    } catch (err) {
        console.error("Gagal parsing NLP:", err);
        return null;
    }
}
//rekap
async function getFinancialRecap(cabang, targetBulan, range) {
    let dateCondition = "1=1";
    const now = new Date();

    const bulanMap = { 
        "januari": "1", "februari": "2", "maret": "3", "april": "4", "mei": "5", "juni": "6", 
        "juli": "7", "agustus": "8", "september": "9", "oktober": "10", "november": "11", "desember": "12" 
    };

    if (range === 'hari') {
        dateCondition = `DATE(tanggal) = CURDATE()`;
    } else if (range === 'minggu') {
        dateCondition = `YEARWEEK(tanggal, 1) = YEARWEEK(CURDATE(), 1)`;
    } else if (targetBulan && bulanMap[targetBulan.toLowerCase()]) {
        const mNum = bulanMap[targetBulan.toLowerCase()];
        // Hanya memfilter berdasarkan bulan agar tidak terhalang perbedaan tahun
        dateCondition = `MONTH(tanggal) = ${mNum}`;
    } else {
        // Default bulan berjalan
        const month = String(now.getMonth() + 1).padStart(2, '0');
        dateCondition = `MONTH(tanggal) = ${parseInt(month, 10)}`;
    }

    let cabangFilter = cabang ? `AND LOWER(TRIM(cabang)) LIKE '%${cabang.toLowerCase()}%'` : "";
    let cabangFilterNota = cabang ? `AND LOWER(TRIM(n.cabang)) LIKE '%${cabang.toLowerCase()}%'` : "";

    const [notaRes] = await db.execute(`
        SELECT SUM(total_belanja) AS total 
        FROM nota n 
        WHERE ${dateCondition.replace(/tanggal/g, 'n.tanggal')} ${cabangFilterNota}
    `);
    const totalNota = notaRes[0]?.total || 0;

    const [transRes] = await db.execute(`
        SELECT jenis, SUM(nominal) AS total 
        FROM transaksi_umum 
        WHERE ${dateCondition} ${cabangFilter} 
        GROUP BY jenis
    `);

    let totalKasKeluar = 0;
    let totalKasMasuk = 0;

    transRes.forEach(row => {
        if (row.jenis === 'keluar') totalKasKeluar = row.total;
        if (row.jenis === 'masuk') totalKasMasuk = row.total;
    });

    const pengeluaranTotal = parseFloat(totalNota) + parseFloat(totalKasKeluar);
    const pemasukanTotal = parseFloat(totalKasMasuk);
    const posisiSaldo = pemasukanTotal - pengeluaranTotal;

    return {
        pemasukan: pemasukanTotal,
        pengeluaranNota: parseFloat(totalNota),
        pengeluaranKas: parseFloat(totalKasKeluar),
        pengeluaranTotal: pengeluaranTotal,
        saldo: posisiSaldo
    };
}
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ 
        auth: state,
        version: version,
        browser: ["Ubuntu", "Chrome", "20.0.0"] 
        // Opsi printQRInTerminal sudah dihapus dari sini
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Koneksi terputus. Kode Status: ${statusCode}`);

            // Beri jeda waktu (3 detik) agar proses sebelumnya benar-benar mati dan auth_info tidak korup
            setTimeout(() => {
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log('🔄 Menghubungkan ulang ke WhatsApp...');
                    connectToWhatsApp();
                } else {
                    console.log('❌ Perangkat dikeluarkan (Logged Out). Menghapus sesi lama...');
                    if (fs.existsSync('auth_info')) {
                        fs.rmSync('auth_info', { recursive: true, force: true });
                    }
                    console.log('🔄 Memulai ulang untuk menghasilkan QR Code baru...');
                    connectToWhatsApp();
                }
            }, 3000); // Jeda 3 detik sangat krusial di sini!

        } else if (connection === 'open') {
            console.log('✅ Bot Berhasil Terhubung ke WhatsApp dan Siap Digunakan!');
        }
    });
    sock.ev.on('messages.upsert', async m => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const imgMessage = msg.message.imageMessage;
    const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    
    if (imgMessage) {
        // --- CEK LIMIT 50 NOTA DARI TABEL NOTA DATABASE ---
        const isAllowed = await checkNotaLimitFromDB();
        if (!isAllowed) {
            await sock.sendMessage(sender, { text: "Trial sudah selesai, untuk upload nota langsung berlangganan." });
            return;
        }
        // -------------------------------------------------

        const rawPath = `./raw_${Date.now()}.jpg`;
        const compPath = `./comp_${Date.now()}.jpg`;

        try {
            const stream = await downloadContentFromMessage(imgMessage, 'image');
            const buffer = [];
            for await (const chunk of stream) buffer.push(chunk);
            const fullBuffer = Buffer.concat(buffer);
            fs.writeFileSync(rawPath, fullBuffer);

            // Anti-Spam
            const fileHash = crypto.createHash('md5').update(fullBuffer).digest('hex');
            if (processedImages.has(fileHash)) return;
            processedImages.add(fileHash);
            setTimeout(() => processedImages.delete(fileHash), 300000);

            await sock.sendMessage(sender, { text: "⏳ Sedang memproses nota dengan AI..." });

            try {
                await compressImage(rawPath, compPath);
            } catch (err) {
                throw new Error("Gagal mengompres gambar: " + err.message);
            }

            const hasilTeks = await prosesOCR(compPath, prompt);
            const captionImage = imgMessage.caption ? imgMessage.caption.trim() : "";
            const cabang = captionImage !== "" ? captionImage : (textMessage ? textMessage.trim() : "Jogja");

            const tokoMatch = hasilTeks.match(/Nama Toko:\s*(.*)/i);
            const namaToko = tokoMatch ? tokoMatch[1].trim() : "-";

            const tglMatch = hasilTeks.match(/Tanggal:\s*(.*)/i);
            let tanggal = tglMatch ? tglMatch[1].trim() : "";

            if (!tanggal || tanggal === "-" || tanggal.toLowerCase() === "kosong" || tanggal.length < 6) {
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                tanggal = `${y}-${m}-${d}`; 
            }

            const totalMatch = hasilTeks.match(/Total Belanja:\s*(?:Rp)?\s*([\d.]+)/i);
            const totalBelanja = totalMatch ? parseInt(totalMatch[1].replace(/\./g, '')) : 0;

            userStates[sender] = {
                status: 'WAITING_CONFIRMATION',
                cabang: cabang,
                hasilTeks: hasilTeks,
                parsedData: { namaToko, tanggal, totalBelanja, cabang }
            };

            const previewMsg = `🔍 *HASIL BACAAN NOTA (PENDING)*\n\n` +
                `📂 Cabang: ${cabang}\n` +
                `🏪 Toko: ${namaToko}\n` +
                `📅 Tanggal: ${tanggal}\n` +
                `💰 Total: Rp ${totalBelanja.toLocaleString('id-ID')}\n\n` +
                `*Apakah data di atas sudah benar?*\n` +
                `• Ketik *YA* untuk menyimpan ke database.\n` +
                `• Ketik *UBAH TOKO [nama baru]* jika toko salah.\n` +
                `• Ketik *UBAH TANGGAL [YYYY-MM-DD]* jika tanggal salah.\n` +
                `• Ketik *UBAH TOTAL [angka]* jika nominal salah.\n` +
                `• Ketik *BATAL* untuk membatalkan.`;

            await sock.sendMessage(sender, { text: previewMsg });

        } catch (err) {
            console.error("Terjadi Error:", err.message);
            await sock.sendMessage(sender, { text: `❌ Gagal: ${err.message}` });
        } finally {
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
            if (fs.existsSync(compPath)) fs.unlinkSync(compPath);
        }
    }
    else if (userStates[sender] && userStates[sender].status === 'WAITING_CONFIRMATION') {
        const text = textMessage.trim().toLowerCase();
        const state = userStates[sender];

        if (text === 'ya') {
            const success = await simpanKeDatabase(state.hasilTeks, state.cabang);
            
            if (success) {
                await sock.sendMessage(sender, { text: `✅ Berhasil dikonfirmasi dan disimpan ke database untuk cabang ${state.cabang}!` });
            } else {
                await sock.sendMessage(sender, { text: "⚠️ Data terbaca, tapi gagal simpan ke database." });
            }
            
            delete userStates[sender];
            return;
        } 
        else if (text.startsWith('ubah toko ')) {
            const tokoBaru = textMessage.trim().substring(10).trim();
            state.hasilTeks = state.hasilTeks.replace(/Nama Toko:\s*(.*)/i, `Nama Toko: ${tokoBaru}`);
            state.parsedData.namaToko = tokoBaru;
            
            await sock.sendMessage(sender, { text: `✅ Toko diubah menjadi: *${tokoBaru}*.\n\nKetik *YA* jika sudah pas.` });
            return;
        } 
        else if (text.startsWith('ubah tanggal ')) {
            const tanggalBaru = textMessage.trim().substring(13).trim();
            state.hasilTeks = state.hasilTeks.replace(/Tanggal:\s*(.*)/i, `Tanggal: ${tanggalBaru}`);
            state.parsedData.tanggal = tanggalBaru;
            
            await sock.sendMessage(sender, { text: `✅ Tanggal diubah menjadi: *${tanggalBaru}*.\n\nKetik *YA* jika sudah pas.` });
            return;
        }
        else if (text.startsWith('ubah total ')) {
            const totalBaruStr = textMessage.replace(/[^0-9]/g, '');
            const totalBaru = parseInt(totalBaruStr);
            
            if (isNaN(totalBaru)) {
                await sock.sendMessage(sender, { text: "⚠️ Format angka total salah. Contoh: UBAH TOTAL 50000" });
                return;
            }

            state.hasilTeks = state.hasilTeks.replace(/Total Belanja:\s*(?:Rp)?\s*([\d.]+)/i, `Total Belanja: Rp${totalBaru.toLocaleString('id-ID')}`);
            state.parsedData.totalBelanja = totalBaru;

            await sock.sendMessage(sender, { text: `✅ Total diubah menjadi: *Rp ${totalBaru.toLocaleString('id-ID')}*.\n\nKetik *YA* jika sudah pas.` });
            return;
        } 
        else if (text === 'batal') {
            delete userStates[sender];
            await sock.sendMessage(sender, { text: "❌ Proses penyimpanan nota dibatalkan." });
            return;
        } 
        else {
            await sock.sendMessage(sender, { 
                text: "⚠️ Mohon balas dengan:\n• *YA* (untuk simpan)\n• *UBAH TOKO [nama]*\n• *UBAH TANGGAL [YYYY-MM-DD]*\n• *UBAH TOTAL [angka]*\n• *BATAL*" 
            });
            return;
        }
    }
   else if (textMessage && textMessage.toLowerCase().startsWith('laporan')) {
        const parts = textMessage.trim().split(/\s+/); 
        
        if (parts.length >= 3) {
            let rawCabang = parts[1];
            const cabang = rawCabang.charAt(0).toUpperCase() + rawCabang.slice(1).toLowerCase();
            const bulan = parts[2];
            
            await sock.sendMessage(sender, { text: `📊 Sedang menyiapkan laporan untuk ${cabang} bulan ${bulan}...` });
            
            try {
                const filePath = await buatLaporanExcel(cabang, bulan);
                
                if (filePath) {
                    await sock.sendMessage(sender, { 
                        document: { url: filePath }, 
                        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        fileName: `Laporan_${cabang}_${bulan}.xlsx`
                    });
                    fs.unlinkSync(filePath); 
                } else {
                    await sock.sendMessage(sender, { text: `⚠️ Tidak ada data untuk cabang ${cabang} pada bulan ${bulan}.` });
                }
            } catch (err) {
                console.error("Error buat laporan:", err);
                await sock.sendMessage(sender, { text: "❌ Gagal membuat laporan." });
            }
        } else {
            await sock.sendMessage(sender, { text: "⚠️ Format salah. Gunakan: laporan [cabang] [bulan]\nContoh: laporan jogja juli" });
        }
    }
    //rekap
   else if (textMessage && textMessage.toLowerCase().startsWith('rekap')) {
        const parts = textMessage.trim().split(/\s+/);
        let cabangTarget = null;
        let range = 'bulan';
        let targetBulan = null;

        const listBulan = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];

        // Loop untuk memilah argumen (cabang vs bulan vs rentang waktu)
        for (let i = 1; i < parts.length; i++) {
            const p = parts[i].toLowerCase();
            if (p === 'hari') range = 'hari';
            else if (p === 'minggu') range = 'minggu';
            else if (listBulan.includes(p)) targetBulan = p;
            else {
                cabangTarget = parts[i]; // Kata selain itu dianggap nama cabang
            }
        }

        if (textMessage.toLowerCase().includes('hari ini')) range = 'hari';
        else if (textMessage.toLowerCase().includes('minggu ini')) range = 'minggu';

        await sock.sendMessage(sender, { text: "📊 Sedang menghitung rekap keuangan..." });

        try {
            // Parameter dikirim lengkap: cabangTarget, targetBulan, range
            const data = await getFinancialRecap(cabangTarget, targetBulan, range);
            let labelCabang = cabangTarget ? cabangTarget.toUpperCase() : "SEMUA CABANG";
            let labelRange = targetBulan ? targetBulan.toUpperCase() : (range === 'hari' ? 'Hari Ini' : (range === 'minggu' ? 'Minggu Ini' : 'Bulan Ini'));

            const replyText = `📈 *REKAP KEUANGAN (${labelRange})*\n` +
                `📂 Lingkup: ${labelCabang}\n\n` +
                `📥 Total Pemasukan: Rp ${data.pemasukan.toLocaleString('id-ID')}\n` +
                `📤 Pengeluaran Nota OCR: Rp ${data.pengeluaranNota.toLocaleString('id-ID')}\n` +
                `📤 Pengeluaran Kas Umum: Rp ${data.pengeluaranKas.toLocaleString('id-ID')}\n` +
                `──────────────────\n` +
                `💰 *Total Pengeluaran:* Rp ${data.pengeluaranTotal.toLocaleString('id-ID')}\n` +
                `💼 *Posisi Saldo Bersih:* Rp ${data.saldo.toLocaleString('id-ID')}`;

            await sock.sendMessage(sender, { text: replyText });
        } catch (err) {
            console.error("Gagal membuat rekap:", err);
            await sock.sendMessage(sender, { text: "❌ Gagal mengambil data rekap keuangan." });
        }
        return;
    }
   // [FITUR BARU] Menggantikan handler manual kaku dengan pemrosesan bahasa natural
    else if (textMessage) {
        const lowerText = textMessage.toLowerCase();
        
        // Deteksi kata kunci umum transaksi kas masuk/keluar secara fleksibel
        if (lowerText.includes('keluar') || lowerText.includes('masuk') || lowerText.includes('beli') || lowerText.includes('bayar') || lowerText.includes('terima') || lowerText.includes('habis')) {
            await sock.sendMessage(sender, { text: "🤖 Memahami maksud transaksi Anda..." });
            
            // Parsing menggunakan fungsi AI natural language
            const parsed = await parseTransaksiNatural(textMessage);
            
            if (!parsed || isNaN(parsed.nominal) || parsed.nominal <= 0) {
                await sock.sendMessage(sender, { text: "⚠️ Maaf, saya kurang paham maksud transaksinya. Coba jelaskan nominal dan keperluannya lebih detail." });
                return;
            }

            const success = await simpanTransaksiUmum(parsed.jenis, parsed.cabang, parsed.kategori, parsed.nominal, parsed.keterangan);
            if (success) {
                await sock.sendMessage(sender, { 
                    text: `✅ Berhasil dicatat secara otomatis!\n\n` +
                          `📂 Cabang: ${parsed.cabang}\n` +
                          `📌 Jenis: ${parsed.jenis.toUpperCase()}\n` +
                          `🏷️ Kategori: ${parsed.kategori}\n` +
                          `💰 Nominal: Rp ${parsed.nominal.toLocaleString('id-ID')}\n` +
                          `📝 Ket: ${parsed.keterangan}` 
                });
            } else {
                await sock.sendMessage(sender, { text: "❌ Gagal menyimpan transaksi ke database." });
            }
            return;
        }
    }
    
});
}

async function simpanKeDatabase(teks, cabang) {
    try {
        const tokoMatch = teks.match(/Nama Toko:\s*(.*)/i);
        const namaToko = tokoMatch ? tokoMatch[1].trim() : "-";

        // [BARU] Ekstraksi kategori dari teks AI
        const katMatch = teks.match(/Kategori:\s*(.*)/i);
        const kategoriNota = katMatch ? katMatch[1].trim() : "Operasional Umum";

        const tglMatch = teks.match(/Tanggal:\s*(.*)/i);
        let tanggal = "";

        if (tglMatch && tglMatch[1].trim() !== "") {
            let rawTgl = tglMatch[1].trim();
            if (rawTgl.includes(',')) rawTgl = rawTgl.split(',')[0].trim();

            const bulanMapIndo = {
                "januari": "01", "februari": "02", "maret": "03", "april": "04", "mei": "05", "juni": "06",
                "juli": "07", "agustus": "08", "september": "09", "oktober": "10", "november": "11", "desember": "12",
                "jan": "01", "feb": "02", "mar": "03", "apr": "04", "jun": "06", "jul": "07", "agu": "08", "agt": "08", "sep": "09", "okt": "10", "nov": "11", "des": "12"
            };

            let lowerTgl = rawTgl.toLowerCase();
            let foundMonthNum = null;

            for (const [key, val] of Object.entries(bulanMapIndo)) {
                if (lowerTgl.includes(key)) {
                    foundMonthNum = val;
                    break;
                }
            }

            if (foundMonthNum) {
                const numbers = rawTgl.replace(/[^0-9]/g, ' ').trim().split(/\s+/);
                if (numbers.length >= 2) {
                    let d = numbers[0].padStart(2, '0');
                    let y = numbers[1].length === 2 ? "20" + numbers[1] : numbers[1];
                    tanggal = `${y}-${foundMonthNum}-${d}`;
                }
            } else {
                const parts = rawTgl.replace(/[^0-9]/g, '-').split('-').filter(Boolean);
                if (parts.length >= 3) {
                    let p1 = parts[0], p2 = parts[1], p3 = parts[2];
                    if (p1.length === 4) {
                        tanggal = `${p1}-${p2.padStart(2, '0')}-${p3.padStart(2, '0')}`;
                    } else {
                        let y = p3.length === 2 ? "20" + p3 : p3;
                        tanggal = `${y}-${p2.padStart(2, '0')}-${p1.padStart(2, '0')}`;
                    }
                }
            }
        } 

        if (!tanggal || tanggal.length !== 10) {
            const now = new Date();
            tanggal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; 
        }

        const totalMatch = teks.match(/Total Belanja:\s*(?:Rp)?\s*([\d.]+)/i);
        const totalBelanja = totalMatch ? parseInt(totalMatch[1].replace(/\./g, ''), 10) : 0;

        // [BARU] Menyimpan kategori ke dalam query INSERT
        const [result] = await db.execute(
            'INSERT INTO nota (nama_toko, kategori, tanggal, total_belanja, cabang) VALUES (?, ?, ?, ?, ?)',
            [namaToko, kategoriNota, tanggal, totalBelanja, cabang]
        );
        
        const notaId = result.insertId;
        const lines = teks.split('\n');

        for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine.startsWith('*') && !cleanLine.startsWith('-') && !cleanLine.startsWith('•')) continue;

            let nama = "", qty = 1, satuan = "-", harga = 0;
            const parts = cleanLine.replace(/^[*\-•]\s*/, '').split(':');
            
            if (parts.length >= 2) {
                nama = parts[0].trim();
                const sisaTeks = parts.slice(1).join(':').trim();
                let rawQtyStr = "1";
                const qtySatuanMatch = sisaTeks.match(/(\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]*)/i);
                
                if (qtySatuanMatch) {
                    rawQtyStr = qtySatuanMatch[1];
                    if (qtySatuanMatch[2]) satuan = qtySatuanMatch[2].trim();
                }

                if (rawQtyStr.includes('/')) {
                    const [pembilang, penyebut] = rawQtyStr.split('/').map(Number);
                    qty = penyebut !== 0 ? pembilang / penyebut : 0;
                } else {
                    qty = parseFloat(rawQtyStr) || 1;
                }

                const matchHargaSatuan = sisaTeks.match(/x\s*(?:Rp)?\s*([\d.]+)/i);
                const matchTotalBaris = sisaTeks.match(/(?:Rp)?\s*([\d.]+)/g);

                if (matchHargaSatuan) {
                    harga = parseInt(matchHargaSatuan[1].replace(/\./g, ''), 10);
                } else if (matchTotalBaris && matchTotalBaris.length > 0) {
                    const nominalStr = matchTotalBaris[matchTotalBaris.length - 1].replace(/\./g, '');
                    const totalBaris = parseInt(nominalStr, 10) || 0;
                    harga = qty > 0 ? Math.round(totalBaris / qty) : totalBaris;
                }
            }

            if (nama !== "" && harga > 0) {
                await db.execute(
                    'INSERT INTO detail_nota (nota_id, nama_barang, qty, satuan, harga) VALUES (?, ?, ?, ?, ?)',
                    [notaId, nama, qty, satuan, harga]
                );
            }
        }
        return true;
    } catch (err) {
        console.error("Gagal simpan DB:", err);
        return false;
    }
}

async function buatLaporanExcel(cabang, bulan) {
    const bulanMap = { 
        "januari": "1", "februari": "2", "maret": "3", "april": "4", "mei": "5", "juni": "6", 
        "juli": "7", "agustus": "8", "september": "9", "oktober": "10", "november": "11", "desember": "12" 
    };
    
    const targetBulanNum = bulanMap[bulan.toLowerCase()] || "7"; 
    const keywordCabang = `%${cabang.trim().toLowerCase()}%`;

    // 1. Ambil data Nota Belanja (OCR) dengan filter SQL langsung
// 1. Ambil data Nota Belanja (OCR) dengan LEFT JOIN agar data tetap aman tampil
    const queryNota = `
        SELECT DATE_FORMAT(n.tanggal, '%Y-%m-%d') AS tanggal, n.nama_toko, n.kategori, n.cabang, d.nama_barang, d.qty, d.satuan, d.harga, (d.qty * d.harga) as subtotal 
        FROM nota n 
        LEFT JOIN detail_nota d ON n.id = d.nota_id 
        WHERE LOWER(TRIM(n.cabang)) LIKE ? AND MONTH(n.tanggal) = ?`;
    
    const [notaRows] = await db.execute(queryNota, [keywordCabang, parseInt(targetBulanNum, 10)]);

    // 2. Ambil data Transaksi Kas Umum dengan filter SQL langsung
    const queryTrans = `
        SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, jenis, kategori, nominal, keterangan, cabang 
        FROM transaksi_umum 
        WHERE LOWER(TRIM(cabang)) LIKE ? AND MONTH(tanggal) = ?`;

    const [transRows] = await db.execute(queryTrans, [keywordCabang, parseInt(targetBulanNum, 10)]);

    const workbook = new ExcelJS.Workbook();

    // --- SHEET 1: Nota Belanja (OCR) ---
    const wsNota = workbook.addWorksheet('Nota Belanja');
    wsNota.columns = [
        { header: 'Tanggal', key: 'tanggal', width: 15 },
        { header: 'Nama Toko', key: 'nama_toko', width: 25 },
        { header: 'Kategori', key: 'kategori', width: 20 },
        { header: 'Nama Barang', key: 'nama_barang', width: 25 },
        { header: 'Qty', key: 'qty', width: 8 },
        { header: 'Satuan', key: 'satuan', width: 10 },
        { header: 'Harga', key: 'harga', width: 15 },
        { header: 'Subtotal', key: 'subtotal', width: 15 }
    ];

    wsNota.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4F81BD' } };
        cell.alignment = { horizontal: 'center' };
    });

    notaRows.forEach(row => {
        const addedRow = wsNota.addRow(row);
        addedRow.eachCell((cell) => {
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
    });

    const totalRowNota = wsNota.addRow([]);
    totalRowNota.getCell(7).value = "TOTAL:"; 
    totalRowNota.getCell(7).font = { bold: true };
    let totalSumNota = notaRows.reduce((acc, curr) => acc + parseFloat(curr.subtotal || 0), 0);
    totalRowNota.getCell(8).value = totalSumNota; 
    totalRowNota.getCell(8).numFmt = '#,##0'; 
    totalRowNota.getCell(8).font = { bold: true };

    // --- SHEET 2: Kas Umum (Transaksi Manual Masuk/Keluar) ---
    const wsTrans = workbook.addWorksheet('Kas Umum');
    wsTrans.columns = [
        { header: 'Tanggal', key: 'tanggal', width: 15 },
        { header: 'Jenis', key: 'jenis', width: 12 },
        { header: 'Kategori', key: 'kategori', width: 20 },
        { header: 'Nominal', key: 'nominal', width: 15 },
        { header: 'Keterangan', key: 'keterangan', width: 35 }
    ];

    wsTrans.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '00B050' } };
        cell.alignment = { horizontal: 'center' };
    });

    transRows.forEach(row => {
        const addedRow = wsTrans.addRow(row);
        addedRow.eachCell((cell) => {
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
    });

    const totalRowTrans = wsTrans.addRow([]);
    totalRowTrans.getCell(3).value = "TOTAL:"; 
    totalRowTrans.getCell(3).font = { bold: true };
    let totalSumTrans = transRows.reduce((acc, curr) => acc + parseFloat(curr.nominal || 0), 0);
    totalRowTrans.getCell(4).value = totalSumTrans; 
    totalRowTrans.getCell(4).numFmt = '#,##0'; 
    totalRowTrans.getCell(4).font = { bold: true };

    // Jika kedua sheet benar-benar kosong, kembalikan null
    if (notaRows.length === 0 && transRows.length === 0) {
        return null;
    }

    const fileName = `./laporan_${cabang}_${bulan}.xlsx`;
    await workbook.xlsx.writeFile(fileName);
    return fileName;
}

async function simpanTransaksiUmum(jenis, cabang, kategori, nominal, keterangan) {
    try {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        const tanggal = `${y}-${m}-${d}`;

        await db.execute(
            'INSERT INTO transaksi_umum (cabang, jenis, kategori, nominal, keterangan, tanggal) VALUES (?, ?, ?, ?, ?, ?)',
            [cabang, jenis, kategori, nominal, keterangan, tanggal]
        );
        return true;
    } catch (err) {
        console.error("Gagal simpan transaksi umum:", err);
        return false;
    }
}

connectToWhatsApp();
