const express = require('express');
const router = express.Router();
const { getUnread } = require('../controllers/unreadController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, getUnread);

module.exports = router;