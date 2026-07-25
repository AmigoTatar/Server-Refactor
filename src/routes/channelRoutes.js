const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const {
    getChannels,
    getChannel,
    createChannel,
    updateChannel,
    deleteChannel,
    getChannelMembers,
    addChannelMember,
    removeChannelMember,
} = require('../controllers/channelController');

// Настройка multer для аватарок каналов
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

// Все маршруты требуют аутентификации
router.use(authenticateToken);

// CRUD каналов
router.get('/', getChannels);
router.get('/:channelId', getChannel);
router.post('/', createChannel);
router.put('/:channelId', upload.single('avatar'), updateChannel);
router.delete('/:channelId', deleteChannel);

// Участники
router.get('/:channelId/members', getChannelMembers);
router.post('/:channelId/members', addChannelMember);
router.delete('/:channelId/members/:userId', removeChannelMember);

module.exports = router;