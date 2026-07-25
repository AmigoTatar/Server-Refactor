const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { onlineUsers } = require('../socket/socketHandlers');

// ==============================================
// ПОЛУЧЕНИЕ СООБЩЕНИЙ (с пагинацией)
// ==============================================
const getMessages = async (req, res) => {
    try {
        const { activeChatId, cursorMessageId } = req.query;
        const currentUserId = req.userId;

        if (!activeChatId) {
            return res.status(400).json({ error: "Параметр activeChatId обязателен" });
        }

        const limit = 30;
        let whereClause = {};

        if (activeChatId === 'chat_general') {
            whereClause = { receiverId: null, channelId: null };
        } else if (activeChatId.startsWith('channel_')) {
            const channelDbId = parseInt(activeChatId.replace('channel_', ''), 10);
            if (isNaN(channelDbId)) return res.status(400).json({ error: "Невалидный ID канала" });
            whereClause = { channelId: channelDbId };
        } else if (activeChatId.startsWith('user_')) {
            const targetUserId = parseInt(activeChatId.replace('user_', ''), 10);
            if (isNaN(targetUserId)) return res.status(400).json({ error: "Невалидный ID собеседника" });
            whereClause = {
                channelId: null,
                OR: [
                    { senderId: currentUserId, receiverId: targetUserId },
                    { senderId: targetUserId, receiverId: currentUserId }
                ]
            };
        } else if (activeChatId.startsWith('chat_')) {
            const chatDbId = parseInt(activeChatId.replace('chat_', ''), 10);
            if (isNaN(chatDbId)) return res.status(400).json({ error: "Невалидный ID группового чата" });
            whereClause = { chatId: chatDbId };
        } else {
            return res.status(400).json({ error: "Неизвестный формат чата" });
        }

        let queryOptions = {
            where: whereClause,
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                sender: { select: { id: true, username: true } },
                threads: {
                    include: { user: { select: { id: true, username: true, avatar: true } } },
                    orderBy: { createdAt: 'asc' }
                },
                reactions: {
                    include: { user: { select: { id: true, username: true } } }
                }
            }
        };

        if (cursorMessageId) {
            const cursorId = Number(cursorMessageId);
            if (!isNaN(cursorId)) {
                queryOptions.cursor = { id: cursorId };
                queryOptions.skip = 1;
            }
        }

        const messages = await prisma.message.findMany(queryOptions);
        const orderedMessages = messages.reverse();

        return res.json({
            messages: orderedMessages,
            hasMore: messages.length === limit
        });
    } catch (error) {
        console.error('Ошибка при получении сообщений:', error);
        return res.status(500).json({ error: 'Ошибка сервера при загрузке истории чата' });
    }
};

// ==============================================
// ПОЛУЧЕНИЕ ЗАКРЕПЛЁННЫХ
// ==============================================
const getPinnedMessages = async (req, res) => {
    try {
        const { channelId, chatId, privateUserId } = req.query;
        const userId = req.userId;

        let where = { isPinned: true, isDeleted: false };

        if (channelId) {
            where.channelId = parseInt(channelId);
        } else if (chatId) {
            where.chatId = parseInt(chatId);
        } else if (privateUserId) {
            const otherUserId = parseInt(privateUserId);
            where.OR = [
                { senderId: userId, receiverId: otherUserId },
                { senderId: otherUserId, receiverId: userId }
            ];
            where.channelId = null;
            where.chatId = null;
        } else {
            return res.status(400).json({ error: 'Не указан channelId, chatId или privateUserId' });
        }

        const pinnedMessages = await prisma.message.findMany({
            where,
            include: {
                sender: { select: { id: true, username: true, avatar: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        res.json(pinnedMessages);
    } catch (error) {
        console.error('❌ Ошибка получения закрепленных:', error);
        res.status(500).json({ error: 'Ошибка получения закрепленных сообщений' });
    }
};

// ==============================================
// ПЕРЕКЛЮЧЕНИЕ ЗАКРЕПЛЕНИЯ
// ==============================================
const togglePin = async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const userId = req.userId;

        const message = await prisma.message.findUnique({
            where: { id: messageId },
            include: {
                chat: true,
                channel: true,
                sender: { select: { id: true, username: true, avatar: true } }
            }
        });

        if (!message) {
            return res.status(404).json({ error: 'Сообщение не найдено' });
        }

        let canPin = false;

        if (message.senderId === userId) canPin = true;

        if (!canPin && message.channelId) {
            const channel = await prisma.channel.findUnique({ where: { id: message.channelId } });
            if (channel && channel.creatorId === userId) canPin = true;
            if (!canPin) {
                const isAdmin = await prisma.channelMember.findFirst({
                    where: { channelId: message.channelId, userId, role: 'admin' }
                });
                if (isAdmin) canPin = true;
            }
        }

        if (!canPin && message.chatId) {
            const chat = await prisma.chat.findUnique({ where: { id: message.chatId } });
            if (chat && chat.creatorId === userId) canPin = true;
        }

        if (!canPin) {
            return res.status(403).json({ error: 'Нет прав на закрепление' });
        }

        const updatedMessage = await prisma.message.update({
            where: { id: messageId },
            data: { isPinned: !message.isPinned },
            include: {
                sender: { select: { id: true, username: true, avatar: true } }
            }
        });

        // Отправка через сокет
        const io = req.app.get('io');
        let roomName = null;
        if (message.channelId) {
            roomName = `channel_${message.channelId}`;
        } else if (message.chatId) {
            roomName = `chat_${message.chatId}`;
        } else if (message.receiverId) {
            // Приватный чат: отправляем обоим
            const senderSocket = onlineUsers.get(message.senderId);
            const receiverSocket = onlineUsers.get(message.receiverId);
            if (senderSocket) {
                io.to(senderSocket).emit('message_pinned', {
                    messageId: updatedMessage.id,
                    isPinned: updatedMessage.isPinned,
                    message: updatedMessage
                });
            }
            if (receiverSocket) {
                io.to(receiverSocket).emit('message_pinned', {
                    messageId: updatedMessage.id,
                    isPinned: updatedMessage.isPinned,
                    message: updatedMessage
                });
            }
            // Для приватных чатов также отправляем в комнату user_... (если есть)
            roomName = `user_${message.receiverId}`;
        }

        if (roomName) {
            io.to(roomName).emit('message_pinned', {
                messageId: updatedMessage.id,
                isPinned: updatedMessage.isPinned,
                message: updatedMessage
            });
        }

        res.json({ success: true, isPinned: updatedMessage.isPinned, message: updatedMessage });
    } catch (error) {
        console.error('❌ Ошибка закрепления:', error);
        res.status(500).json({ error: 'Не удалось закрепить сообщение' });
    }
};

// ==============================================
// РЕДАКТИРОВАНИЕ СООБЩЕНИЯ
// ==============================================
const editMessage = async (req, res) => {
    try {
        const messageId = parseInt(req.params.id);
        const userId = req.userId;
        const { text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Текст сообщения обязателен' });
        }

        const message = await prisma.message.findUnique({
            where: { id: messageId }
        });

        if (!message) {
            return res.status(404).json({ error: 'Сообщение не найдено' });
        }

        if (message.senderId !== userId) {
            return res.status(403).json({ error: 'Вы не можете редактировать это сообщение' });
        }

        const updatedMessage = await prisma.message.update({
            where: { id: messageId },
            data: {
                text: text.trim(),
                edited: true
            },
            include: {
                sender: { select: { id: true, username: true, avatar: true } }
            }
        });

        // Отправка через сокет
        const io = req.app.get('io');
        let roomName = null;
        if (message.channelId) {
            roomName = `channel_${message.channelId}`;
        } else if (message.chatId) {
            roomName = `chat_${message.chatId}`;
        } else if (message.receiverId) {
            roomName = `user_${message.receiverId}`;
        }

        if (roomName) {
            io.to(roomName).emit('message_edited', {
                messageId: updatedMessage.id,
                text: updatedMessage.text,
                edited: updatedMessage.edited
            });
        }

        res.json({ success: true, message: updatedMessage });
    } catch (error) {
        console.error('❌ Ошибка редактирования:', error);
        res.status(500).json({ error: 'Не удалось отредактировать1 сообщение' });
    }
};

// ==============================================
// РЕАКЦИИ
// ==============================================
const toggleReaction = async (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const userId = req.userId;
        const { type } = req.body;

        if (!type) {
            return res.status(400).json({ error: 'Тип реакции обязателен' });
        }

        const existingReaction = await prisma.reaction.findUnique({
            where: {
                messageId_userId: {
                    messageId: messageId,
                    userId: userId
                }
            }
        });

        let reaction;
        let action;

        if (existingReaction) {
            await prisma.reaction.delete({
                where: {
                    messageId_userId: {
                        messageId: messageId,
                        userId: userId
                    }
                }
            });
            action = 'removed';
            reaction = null;
        } else {
            reaction = await prisma.reaction.create({
                data: {
                    messageId: messageId,
                    userId: userId,
                    type: type
                },
                include: {
                    user: { select: { id: true, username: true } }
                }
            });
            action = 'added';
        }

        const allReactions = await prisma.reaction.findMany({
            where: { messageId: messageId },
            include: {
                user: { select: { id: true, username: true } }
            }
        });

        const io = req.app.get('io');
        const message = await prisma.message.findUnique({
            where: { id: messageId },
            select: { channelId: true, chatId: true, receiverId: true, senderId: true }
        });

        let roomName = null;
        if (message?.channelId) {
            roomName = `channel_${message.channelId}`;
        } else if (message?.chatId) {
            roomName = `chat_${message.chatId}`;
        } else if (message?.receiverId) {
            roomName = `user_${message.receiverId}`;
        }

        if (roomName) {
            io.to(roomName).emit('reaction_updated', {
                messageId,
                reactions: allReactions,
                action,
                reaction
            });
        } else {
            io.emit('reaction_updated', {
                messageId,
                reactions: allReactions,
                action,
                reaction
            });
        }

        res.json({
            success: true,
            action,
            reaction,
            reactions: allReactions
        });
    } catch (error) {
        console.error('Ошибка при работе с реакцией:', error);
        res.status(500).json({ error: 'Не удалось обработать реакцию' });
    }
};

module.exports = {
    getMessages,
    getPinnedMessages,
    togglePin,
    editMessage,
    toggleReaction
};