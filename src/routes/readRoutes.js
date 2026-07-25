const express = require('express');
const router = express.Router();
const { markRead } = require('../controllers/readController');
const { authenticateToken } = require('../middleware/auth');

router.post('/', authenticateToken, markRead);

module.exports = router;