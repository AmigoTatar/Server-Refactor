const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }
        const fileUrl = `/uploads/${req.file.filename}`;
        return res.json({ fileUrl });
    } catch (err) {
        console.error('Ошибка загрузки файла на сервере:', err);
        return res.status(500).json({ error: 'Ошибка сервера при сохранении файла' });
    }
};

module.exports = { uploadFile };