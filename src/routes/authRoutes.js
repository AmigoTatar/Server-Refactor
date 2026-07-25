const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const { validateRegister } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    message: { error: 'Слишком много попыток входа. Попробуйте через 5 минут.' },
    standardHeaders: true,
    legacyHeaders: false
});

router.post('/register', validateRegister, register);
router.post('/login', authLimiter, login);

module.exports = router;