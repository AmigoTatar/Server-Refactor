const express = require('express');
const router = express.Router();
const {
    getMessages,
    getPinnedMessages,
    togglePin,
    editMessage,
    toggleReaction
} = require('../controllers/messageController');
const { authenticateToken } = require('../middleware/auth');

// Все роуты требуют аутентификации
router.use(authenticateToken);

// Получение сообщений
router.get('/', getMessages);

// Закрепления
router.get('/pinned', getPinnedMessages);
router.post('/:messageId/pin', togglePin);

// Редактирование
router.put('/:id', editMessage);

// Реакции
router.post('/:messageId/reactions', toggleReaction);

module.exports = router;