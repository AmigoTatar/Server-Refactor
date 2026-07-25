const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    console.log('📡 [JWT Проверка] Получен заголовок:', authHeader);

    if (!authHeader) {
        return res.status(401).json({ error: 'Доступ запрещен. Токен отсутствует.' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        console.error('❌ [JWT Ошибка] Некорректный формат заголовка');
        return res.status(400).json({ error: 'Некорректный формат авторизации' });
    }

    const token = parts[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('❌ [JWT Ошибка]', err.message);
            return res.status(403).json({ error: 'Невалидный или просроченный токен' });
        }
        req.userId = Number(decoded.userId);
        next();
    });
};

module.exports = { authenticateToken };