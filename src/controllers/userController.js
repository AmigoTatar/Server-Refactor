const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');

// 1. Получить список всех пользователей (кроме себя)
const getUsers = async (req, res) => {
    try {
        const currentUserId = req.userId;

        const users = await prisma.user.findMany({
            where: {
                NOT: { id: currentUserId }
            },
            select: {
                id: true,
                username: true,
                avatar: true
            }
        });

        // Форматируем с последним сообщением
        const formattedUsers = await Promise.all(users.map(async (u) => {
            const lastMessage = await prisma.message.findFirst({
                where: {
                    OR: [
                        { senderId: currentUserId, receiverId: u.id },
                        { senderId: u.id, receiverId: currentUserId }
                    ],
                    channelId: null,
                    chatId: null
                },
                orderBy: { createdAt: 'desc' },
                include: {
                    sender: { select: { id: true, username: true } }
                }
            });

            return {
                id: `user_${u.id}`,
                dbId: u.id,
                name: u.username,
                avatar: u.avatar || '👤',
                unreadCount: 0,
                messages: [],
                lastMessage: lastMessage || null
            };
        }));

        res.json(formattedUsers);
    } catch (error) {
        console.error('Ошибка при получении списка пользователей:', error);
        res.status(500).json({ error: 'Не удалось загрузить список контактов' });
    }
};

// 2. Обновить имя пользователя
// --- Обновление имени ---
const updateProfile = async (req, res) => {
    try {
        const userId = req.userId;
        const { username } = req.body;

        if (!username || username.trim().length < 3) {
            return res.status(400).json({
                error: 'Имя должно содержать минимум 3 символа'
            });
        }

        const existingUser = await prisma.user.findFirst({
            where: {
                username: username.trim(),
                NOT: { id: userId }
            }
        });

        if (existingUser) {
            return res.status(400).json({
                error: 'Это имя уже занято'
            });
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                username: username.trim()
            },
            select: {
                id: true,
                username: true,
                avatar: true
            }
        });

        // ✅ ОТПРАВЛЯЕМ СОБЫТИЕ
        const io = req.app.get('io');
        io.emit('user_updated', {
            userId: userId,
            username: updatedUser.username,
            avatar: updatedUser.avatar
        });
        console.log(`👤 Профиль пользователя ${userId} обновлён, событие отправлено`);

        res.json({
            success: true,
            user: updatedUser
        });
    } catch (error) {
        console.error('❌ Ошибка обновления профиля:', error);
        res.status(500).json({
            error: 'Не удалось обновить профиль'
        });
    }
};

// --- Обновление аватарки ---
const updateAvatar = async (req, res) => {
    try {
        const userId = req.userId;
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        const avatarUrl = `/uploads/${req.file.filename}`;

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                avatar: avatarUrl
            },
            select: {
                id: true,
                username: true,
                avatar: true
            }
        });

        // ✅ ОТПРАВЛЯЕМ СОБЫТИЕ
        const io = req.app.get('io');
        io.emit('user_updated', {
            userId: userId,
            username: updatedUser.username,
            avatar: updatedUser.avatar
        });
        console.log(`🖼️ Аватар пользователя ${userId} обновлён, событие отправлено`);

        res.json({
            success: true,
            user: updatedUser
        });
    } catch (error) {
        console.error('❌ Ошибка загрузки аватарки:', error);
        res.status(500).json({
            error: 'Не удалось загрузить аватарку'
        });
    }
};

module.exports = { getUsers, updateProfile, updateAvatar };