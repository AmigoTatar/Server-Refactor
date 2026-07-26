const express = require('express');
const router = express.Router();
const {
    getMessages,
    getPinnedMessages,
    togglePin,
    editMessage,
    toggleReaction,
    searchMessages
} = require('../controllers/messageController');
const { authenticateToken } = require('../middleware/auth');
const { validateSearch } = require('../middleware/validation');

// Все роуты требуют аутентификации
router.use(authenticateToken);

// Получение сообщений
router.get('/', getMessages);

// Поиск
router.get('/search', validateSearch, searchMessages);

// Закрепления
router.get('/pinned', getPinnedMessages);
router.post('/:messageId/pin', togglePin);

// Редактирование
router.put('/:id', editMessage);

// Реакции
router.post('/:messageId/reactions', toggleReaction);

module.exports = router;