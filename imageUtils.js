const sharp = require('sharp');
const fs = require('fs');

async function compressImage(inputPath, outputPath) {
    try {
        await sharp(inputPath)
            .resize(1024, 1024, { fit: 'inside' }) // Maksimal 1024px agar hemat token
            .jpeg({ quality: 70 })                // Kualitas 70% sudah cukup untuk OCR
            .toFile(outputPath);
        return outputPath;
    } catch (error) {
        console.error("Gagal kompres gambar:", error);
        throw error;
    }
}

module.exports = { compressImage };