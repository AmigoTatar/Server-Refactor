const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const {
    getChats,
    createChat,
    updateChat,
    deleteChat,
    getChatMembers,
    addChatMember,
    removeChatMember
} = require('../controllers/chatController');

// Настройка multer для аватара группы
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
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Маршруты
router.get('/', authenticateToken, getChats);
router.post('/', authenticateToken, createChat);
router.put('/:chatId', authenticateToken, upload.single('avatar'), updateChat);
router.delete('/:chatId', authenticateToken, deleteChat);
router.get('/:chatId/members', authenticateToken, getChatMembers);
router.post('/:chatId/members', authenticateToken, addChatMember);
router.delete('/:chatId/members/:userId', authenticateToken, removeChatMember);

module.exports = router;