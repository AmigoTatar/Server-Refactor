const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const { onlineUsers } = require('../socket/socketHandlers');

const deleteFileIfExists = (filePath) => {
    if (filePath && filePath.startsWith('/uploads/')) {
        const fullPath = path.join(__dirname, '../../public', filePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    }
};

// 1. Получить все групповые чаты пользователя
const getChats = async (req, res) => {
    try {
        const userId = req.userId;

        const chats = await prisma.chat.findMany({
            where: {
                members: {
                    some: { userId: userId }
                }
            },
            include: {
                members: {
                    include: {
                        user: {
                            select: { id: true, username: true, avatar: true }
                        }
                    }
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const formattedChats = chats.map(chat => ({
            id: `chat_${chat.id}`,
            dbId: chat.id,
            name: chat.name,
            avatar: chat.avatar || '💬',
            creatorId: chat.creatorId,
            members: chat.members,
            lastMessage: chat.messages[0] || null,
            unreadCount: 0,
            type: 'group'
        }));

        res.json(formattedChats);
    } catch (error) {
        console.error('Ошибка получения групповых чатов:', error);
        res.status(500).json({ error: 'Не удалось загрузить чаты' });
    }
};

// 2. Создать групповой чат
const createChat = async (req, res) => {
    try {
        const { name, avatar, memberIds } = req.body;
        const creatorId = req.userId;

        if (!name) {
            return res.status(400).json({ error: 'Название чата обязательно' });
        }

        const chat = await prisma.chat.create({
            data: {
                name: name.trim(),
                avatar: avatar || '💬',
                creatorId: creatorId
            }
        });

        await prisma.chatMember.create({
            data: {
                chatId: chat.id,
                userId: creatorId
            }
        });

        if (memberIds && Array.isArray(memberIds)) {
            for (const userId of memberIds) {
                if (userId !== creatorId) {
                    await prisma.chatMember.create({
                        data: {
                            chatId: chat.id,
                            userId: userId
                        }
                    });
                }
            }
        }

        const newChat = await prisma.chat.findUnique({
            where: { id: chat.id },
            include: {
                members: {
                    include: {
                        user: {
                            select: { id: true, username: true, avatar: true }
                        }
                    }
                }
            }
        });

        // Отправляем событие всем клиентам (или только участникам)
        const io = req.app.get('io');
        const chatData = {
            id: `chat_${newChat.id}`,
            dbId: newChat.id,
            name: newChat.name,
            avatar: newChat.avatar || '💬',
            creatorId: newChat.creatorId,
            members: newChat.members,
            type: 'group'
        };
        io.emit('chat_created', chatData);

        console.log(`👥 Создан новый групповой чат ${chat.id}, событие разослано`);

        res.status(201).json(chatData);
    } catch (error) {
        console.error('Ошибка создания группового чата:', error);
        res.status(500).json({ error: 'Не удалось создать чат' });
    }
};

// 3. Обновить групповой чат (название, аватар)
const updateChat = async (req, res) => {
    try {
        const chatId = parseInt(req.params.chatId);
        const userId = req.userId;
        const { name } = req.body;

        const chat = await prisma.chat.findUnique({
            where: { id: chatId }
        });

        if (!chat) {
            return res.status(404).json({ error: 'Чат не найден' });
        }

        if (chat.creatorId !== userId) {
            return res.status(403).json({ error: 'Только создатель может изменять чат' });
        }

        let avatar = chat.avatar;
        if (req.file) {
            if (avatar && avatar.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, '../../public', avatar);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            avatar = '/uploads/' + req.file.filename;
        }

        const updatedChat = await prisma.chat.update({
            where: { id: chatId },
            data: {
                name: name !== undefined ? name.trim() : chat.name,
                avatar: avatar,
            },
            include: {
                members: {
                    include: {
                        user: {
                            select: { id: true, username: true, avatar: true }
                        }
                    }
                }
            }
        });

        const io = req.app.get('io');
        const chatData = { ...updatedChat, type: 'group' };
        io.to(`chat_${chatId}`).emit('chat_updated', chatData);

        console.log(`✏️ Группа ${chatId} обновлена, событие разослано`);
        res.json(chatData);
    } catch (error) {
        console.error('Ошибка обновления чата:', error);
        res.status(500).json({ error: 'Не удалось обновить чат' });
    }
};

// 4. Удалить групповой чат
const deleteChat = async (req, res) => {
    try {
        const chatId = parseInt(req.params.chatId);
        const userId = req.userId;

        console.log(`🗑️ [SERVER] Удаление группового чата ${chatId} пользователем ${userId}`);

        const chat = await prisma.chat.findUnique({
            where: { id: chatId }
        });

        if (!chat) {
            return res.status(404).json({ error: 'Чат не найден' });
        }

        if (chat.creatorId !== userId) {
            return res.status(403).json({ error: 'Только создатель может удалить чат' });
        }

        // Удаляем всех участников чата (связи)
        await prisma.chatMember.deleteMany({
            where: { chatId }
        });

        await prisma.chat.delete({
            where: { id: chatId }
        });

        const io = req.app.get('io');
        io.emit('chat_deleted', { chatId });

        console.log(`🗑️ Групповой чат ${chatId} удалён, событие разослано`);
        res.json({ success: true, message: 'Чат удален' });
    } catch (error) {
        console.error('Ошибка удаления группового чата:', error);
        res.status(500).json({ error: 'Не удалось удалить чат' });
    }
};

// 5. Получить участников группового чата
const getChatMembers = async (req, res) => {
    try {
        const chatId = parseInt(req.params.chatId);
        if (isNaN(chatId)) {
            return res.status(400).json({ error: 'Неверный ID чата' });
        }

        const members = await prisma.chatMember.findMany({
            where: { chatId: chatId },
            include: {
                user: {
                    select: { id: true, username: true, avatar: true }
                }
            }
        });

        res.json(members);
    } catch (error) {
        console.error('Ошибка получения участников чата:', error);
        res.status(500).json({ error: 'Не удалось получить участников' });
    }
};

// 6. Добавить участника в групповой чат
const addChatMember = async (req, res) => {
    try {
        const chatId = parseInt(req.params.chatId);
        const { userId } = req.body;
        const currentUserId = req.userId;

        const chat = await prisma.chat.findUnique({
            where: { id: chatId }
        });

        if (!chat) {
            return res.status(404).json({ error: 'Чат не найден' });
        }

        const existingMember = await prisma.chatMember.findUnique({
            where: {
                chatId_userId: {
                    chatId: chatId,
                    userId: userId
                }
            }
        });

        if (existingMember) {
            return res.status(400).json({ error: 'Пользователь уже участник чата' });
        }

        const member = await prisma.chatMember.create({
            data: {
                chatId: chatId,
                userId: userId
            },
            include: {
                user: {
                    select: { id: true, username: true, avatar: true }
                }
            }
        });

        // Получаем полные данные чата
        const fullChat = await prisma.chat.findUnique({
            where: { id: chatId },
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: { sender: { select: { id: true, username: true } } }
                },
                members: {
                    include: {
                        user: {
                            select: { id: true, username: true, avatar: true }
                        }
                    }
                }
            }
        });

        const lastMessage = fullChat.messages[0] || null;
        const chatData = {
            id: chatId,
            name: fullChat.name,
            avatar: fullChat.avatar,
            creatorId: fullChat.creatorId,
            members: fullChat.members,
            lastMessage: lastMessage,
            type: 'group'
        };

        // Получаем io из app
        const io = req.app.get('io');
        const roomName = `chat_${chatId}`;

        // Отправляем всем в комнате
        io.to(roomName).emit('chat_member_added', {
            chatId: chatId,
            member: member,
            chatName: fullChat.name,
            chatAvatar: fullChat.avatar,
            lastMessage: lastMessage,
            chatData: chatData
        });

        // Отправляем новому участнику отдельно и подписываем его
        const newUserSocketId = onlineUsers.get(userId);
        if (newUserSocketId) {
            io.to(newUserSocketId).emit('chat_member_added', {
                chatId: chatId,
                member: member,
                chatName: fullChat.name,
                chatAvatar: fullChat.avatar,
                lastMessage: lastMessage,
                chatData: chatData
            });
            // Подписываем нового участника на комнату
            const socket = io.sockets.sockets.get(newUserSocketId);
            if (socket) {
                socket.join(roomName);
                console.log(`🚪 Новый участник ${userId} подписан на ${roomName}`);
            }
        }

        console.log(`✅ Участник ${userId} добавлен в группу ${chatId}`);
        res.status(201).json(member);
    } catch (error) {
        console.error('❌ Ошибка добавления участника в чат:', error);
        res.status(500).json({ error: 'Не удалось добавить участника', details: error.message });
    }
};

// 7. Удалить участника из группового чата
const removeChatMember = async (req, res) => {
    try {
        const chatId = parseInt(req.params.chatId);
        const userId = parseInt(req.params.userId);
        const currentUserId = req.userId;

        const chat = await prisma.chat.findUnique({
            where: { id: chatId }
        });

        if (!chat) {
            return res.status(404).json({ error: 'Чат не найден' });
        }

        if (userId === chat.creatorId) {
            return res.status(400).json({ error: 'Нельзя удалить создателя чата' });
        }

        // Проверяем, существует ли участник
        const member = await prisma.chatMember.findUnique({
            where: {
                chatId_userId: {
                    chatId: chatId,
                    userId: userId
                }
            }
        });

        if (!member) {
            return res.status(404).json({ error: 'Участник не найден' });
        }

        await prisma.chatMember.delete({
            where: {
                chatId_userId: {
                    chatId: chatId,
                    userId: userId
                }
            }
        });

        // Отправка через сокет
        const io = req.app.get('io');
        const roomName = `chat_${chatId}`;

        io.to(roomName).emit('chat_member_removed', {
            chatId: chatId,
            userId: userId,
            chatName: chat.name
        });

        // Лично удалённому пользователю
        const removedSocketId = onlineUsers.get(userId);
        if (removedSocketId) {
            io.to(removedSocketId).emit('chat_member_removed', {
                chatId: chatId,
                userId: userId,
                chatName: chat.name
            });
            // Отписываем от комнаты
            const socket = io.sockets.sockets.get(removedSocketId);
            if (socket) {
                socket.leave(roomName);
                console.log(`🚪 Пользователь ${userId} отписан от ${roomName}`);
            }
        }

        console.log(`🗑️ Участник ${userId} удалён из группы ${chatId}`);
        res.json({ success: true, message: 'Участник удален из чата' });
    } catch (error) {
        console.error('❌ Ошибка удаления участника из чата:', error);
        res.status(500).json({ error: 'Не удалось удалить участника' });
    }
};

module.exports = {
    getChats,
    createChat,
    updateChat,
    deleteChat,
    getChatMembers,
    addChatMember,
    removeChatMember
};