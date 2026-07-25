
const express = require('express');
const router = express.Router();
const { toggleMute, getMuteStatus } = require('../controllers/muteController');
const { authenticateToken } = require('../middleware/auth');

router.post('/', authenticateToken, toggleMute);
router.get('/status', authenticateToken, getMuteStatus);      // для /mute/status
router.get('/mute-status', authenticateToken, getMuteStatus); // для /mute-status

module.exports = router;