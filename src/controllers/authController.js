const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// РЕГИСТРАЦИЯ
// ==========================================
const register = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // === ВАЛИДАЦИЯ ===
        if (!username || !email || !password) {
            return res.status(400).json({
                error: 'Заполните все поля!',
                fields: ['username', 'email', 'password']
            });
        }

        // Проверка длины username (минимум 3 символа)
        const trimmedUsername = username.trim();
        if (trimmedUsername.length < 3) {
            return res.status(400).json({
                error: 'Имя пользователя должно содержать минимум 3 символа'
            });
        }

        // Проверка email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Введите корректный email адрес'
            });
        }

        // === СЛОЖНЫЙ ПАРОЛЬ ===
        const passwordErrors = [];
        if (password.length < 8) {
            passwordErrors.push('минимум 8 символов');
        }
        if (!/[A-Z]/.test(password)) {
            passwordErrors.push('хотя бы одну заглавную букву');
        }
        if (!/[a-z]/.test(password)) {
            passwordErrors.push('хотя бы одну строчную букву');
        }
        if (!/[0-9]/.test(password)) {
            passwordErrors.push('хотя бы одну цифру');
        }
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            passwordErrors.push('хотя бы один специальный символ (!@#$%^&*)');
        }

        if (passwordErrors.length > 0) {
            return res.status(400).json({
                error: `Пароль должен содержать: ${passwordErrors.join(', ')}`
            });
        }

        // Проверка на занятость username
        const existingUser = await prisma.user.findFirst({
            where: { username: trimmedUsername }
        });

        if (existingUser) {
            return res.status(400).json({ error: 'Этот никнейм уже занят!' });
        }

        // Проверка на занятость email
        const existingEmail = await prisma.user.findFirst({
            where: { email: email.toLowerCase() }
        });

        if (existingEmail) {
            return res.status(400).json({ error: 'Этот email уже зарегистрирован!' });
        }

        // Хеширование пароля
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Создание пользователя
        const newUser = await prisma.user.create({
            data: {
                username: trimmedUsername,
                email: email.toLowerCase(),
                password: hashedPassword,
                avatar: '👤'
            }
        });

        // Генерация токена
        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
                avatar: newUser.avatar || '👤'
            }
        });

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
};

// ==========================================
// ВХОД (ЛОГИН)
// ==========================================
const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Заполните все поля!' });
        }

        const user = await prisma.user.findFirst({
            where: { username: username.trim() }
        });

        if (!user) {
            return res.status(400).json({ error: 'Неверный никнейм или пароль!' });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);
        if (!isPasswordCorrect) {
            return res.status(400).json({ error: 'Неверный никнейм или пароль!' });
        }

        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username
            }
        });
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Ошибка сервера при входе' });
    }
};

module.exports = { register, login };