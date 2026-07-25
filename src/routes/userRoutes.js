const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { 
    getUsers, 
    updateProfile, 
    updateAvatar 
} = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

// Настройка multer для аватарки
const uploadDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 МБ
});

// Маршруты
router.get('/', authenticateToken, getUsers);
router.put('/profile', authenticateToken, updateProfile);
router.put('/avatar', authenticateToken, upload.single('avatar'), updateAvatar);

module.exports = router;