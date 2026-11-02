const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');

const genAI = new GoogleGenerativeAI("Buat Api Gemini dan isi di sinih");

// Fungsi khusus untuk membaca gambar nota (OCR)
async function prosesOCR(filepath, prompt, retries = 2) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.1-flash-lite",
        systemInstruction: "Anda adalah pembaca nota. Tugas Anda adalah membaca teks di gambar nota dengan teliti dan menuliskannya kembali dengan rapi. Tidak perlu format JSON."
    });

    const imageBase64 = fs.readFileSync(filepath, { encoding: "base64" });

    for (let i = 0; i < retries; i++) {
        try {
            const result = await model.generateContent([
                { text: prompt },
                { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }
            ]);

            const response = await result.response;
            return response.text().trim(); 
        } catch (error) {
            console.log(`Percobaan ${i + 1} gagal:`, error.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    throw new Error("Gagal memproses OCR gambar.");
}

// [BARU] Fungsi khusus untuk memproses teks natural language transaksi (NLP) tanpa gambar
async function prosesTeksNLP(prompt, retries = 2) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.1-flash-lite",
        systemInstruction: "Anda adalah asisten akuntansi yang bertugas mengekstrak pesan teks keuangan menjadi format JSON valid."
    });

    for (let i = 0; i < retries; i++) {
        try {
            const result = await model.generateContent([prompt]);
            const response = await result.response;
            return response.text().trim(); 
        } catch (error) {
            console.log(`Percobaan ${i + 1} gagal:`, error.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    throw new Error("Gagal memproses teks NLP.");
}

module.exports = { prosesOCR, prosesTeksNLP };
