// server/src/socket/socketHandlers.js
const jwt = require('jsonwebtoken');

// Хранилище онлайн-пользователей (глобальное)
const onlineUsers = new Map();

const setupSocket = (io, prisma) => {
    // --- Аутентификация ---
    io.use((socket, next) => {
        const token = (socket.handshake.auth && socket.handshake.auth.token) ||
            (socket.handshake.headers['authorization'] && socket.handshake.headers['authorization'].split(' ')[1]);

        if (!token) {
            return next(new Error('Authentication error: Token missing'));
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) return next(new Error('Authentication error: Invalid token'));
            socket.userId = Number(decoded.userId);
            next();
        });
    });

    // --- Подключение ---
    io.on('connection', (socket) => {
        const currentUserId = socket.userId;
        console.log(`📡 Пользователь ${currentUserId} подключился: ${socket.id}`);

        onlineUsers.set(currentUserId, socket.id);
        io.emit('user_status_change', { userId: currentUserId, status: 'online' });

        // === 1. ПРИСОЕДИНЕНИЕ К КОМНАТЕ ===
        socket.on('join_chat', (chatId) => {
            if (!chatId) return;
            socket.join(String(chatId));
            console.log(`🚪 Сокет ${socket.id} (юзер ${currentUserId}) в комнате: ${chatId}`);
        });

        // === 2. ОТПРАВКА СООБЩЕНИЯ (с подробными логами) ===
socket.on('send_message', async (messageData) => {
    try {
        console.log('📨 [send_message] START от', currentUserId, 'data:', messageData);

        const { text, mediaUrl, mediaType, activeChatId, isForwarded } = messageData;
        if (!text && !mediaUrl) {
            console.log('❌ [send_message] пустое сообщение');
            return;
        }
        if (text && text.length > 10000) {
            console.log('❌ [send_message] слишком длинное');
            return;
        }
        if (!activeChatId) {
            console.log('❌ [send_message] нет activeChatId');
            return;
        }

        const senderId = currentUserId;
        let receiverId = null;
        let channelId = null;
        let chatId = null;

        // Определяем тип чата
        if (activeChatId.startsWith('user_')) {
            receiverId = parseInt(activeChatId.replace('user_', ''), 10);
            if (isNaN(receiverId)) return;
            console.log(`📨 [send_message] Приватный чат с ${receiverId}`);
        } else if (activeChatId.startsWith('channel_')) {
            channelId = parseInt(activeChatId.replace('channel_', ''), 10);
            if (isNaN(channelId)) return;
            console.log(`📨 [send_message] Канал ${channelId}`);
            const member = await prisma.channelMember.findFirst({
                where: { channelId, userId: senderId }
            });
            if (!member) {
                socket.emit('error', { message: 'Вы не участник канала' });
                return;
            }
            if (member.role !== 'admin') {
                socket.emit('error', { message: 'Только администраторы могут писать в канал' });
                return;
            }
        } else if (activeChatId.startsWith('chat_')) {
            chatId = parseInt(activeChatId.replace('chat_', ''), 10);
            if (isNaN(chatId)) return;
            console.log(`📨 [send_message] Групповой чат ${chatId}`);
            const isMember = await prisma.chatMember.findFirst({
                where: { chatId, userId: senderId }
            });
            if (!isMember) {
                console.log(`❌ [send_message] Юзер ${senderId} не участник группы ${chatId}`);
                return;
            }
        } else {
            console.log(`❌ [send_message] Неизвестный тип чата: ${activeChatId}`);
            return;
        }

        // Сохраняем сообщение
        const savedMessage = await prisma.message.create({
            data: {
                text: text || null,
                mediaUrl: mediaUrl || null,
                mediaType: mediaType || null,
                senderId: senderId,
                receiverId: receiverId,
                channelId: channelId,
                chatId: chatId,
                isForwarded: isForwarded || false,
                status: 'unread'
            },
            include: {
                sender: { select: { id: true, username: true } }
            }
        });

        const newMessage = {
            id: savedMessage.id,
            text: savedMessage.text,
            mediaUrl: savedMessage.mediaUrl,
            mediaType: savedMessage.mediaType,
            status: savedMessage.status,
            createdAt: savedMessage.createdAt,
            senderId: savedMessage.senderId,
            receiverId: savedMessage.receiverId,
            channelId: savedMessage.channelId,
            chatId: savedMessage.chatId,
            sender: savedMessage.sender,
            activeChatId: activeChatId,
            isForwarded: savedMessage.isForwarded || false
        };

        console.log(`✅ [send_message] Сохранено сообщение ${savedMessage.id}`);

        // --- Рассылка ---
        if (chatId) {
            console.log(`📤 [send_message] Групповой чат ${chatId}, ищем участников...`);
            const members = await prisma.chatMember.findMany({
                where: { chatId },
                select: { userId: true }
            });
            console.log(`📤 [send_message] Найдено участников: ${members.length}`, members);

            // Отправляем в комнату всем, кто в ней
            io.to(`chat_${chatId}`).emit('receive_message', newMessage);
            console.log(`📤 [send_message] Отправлено в комнату chat_${chatId}`);

            // Отправляем каждому участнику отдельно (для обновления сайдбара и счётчиков)
            for (const member of members) {
                const socketId = onlineUsers.get(member.userId);
                console.log(`📤 [send_message] Участник ${member.userId}, socketId: ${socketId}, senderId: ${senderId}`);
                if (socketId && member.userId !== senderId) {
                    io.to(socketId).emit('receive_message', newMessage);
                    io.to(socketId).emit('chat_updated', {
                        chatId,
                        lastMessage: newMessage
                    });
                    const unreadCount = await prisma.message.count({
                        where: {
                            chatId,
                            senderId: { not: member.userId },
                            status: 'unread'
                        }
                    });
                    io.to(socketId).emit('unread_updated', {
                        type: 'chat',
                        id: chatId,
                        count: unreadCount
                    });
                    console.log(`📤 [send_message] Отправлено участнику ${member.userId}, unread: ${unreadCount}`);
                } else {
                    console.log(`📤 [send_message] Пропускаю участника ${member.userId} (это отправитель или не в сети)`);
                }
            }
        } else if (channelId) {
            // === КАНАЛЫ ===
            console.log(`📤 [send_message] Канал ${channelId}, рассылка участникам...`);
            
            // Отправляем в комнату всем, кто в ней
            io.to(`channel_${channelId}`).emit('receive_message', newMessage);
            console.log(`📤 [send_message] Отправлено в комнату channel_${channelId}`);

            // Получаем всех участников канала
            const members = await prisma.channelMember.findMany({
                where: { channelId },
                select: { userId: true }
            });
            console.log(`📤 [send_message] Найдено участников канала: ${members.length}`, members);

            for (const member of members) {
                const socketId = onlineUsers.get(member.userId);
                console.log(`📤 [send_message] Участник ${member.userId}, socketId: ${socketId}`);
                if (socketId && member.userId !== senderId) {
                    io.to(socketId).emit('receive_message', newMessage);
                    io.to(socketId).emit('channel_updated', {
                        channelId,
                        lastMessage: newMessage
                    });
                    const unreadCount = await prisma.message.count({
                        where: {
                            channelId,
                            senderId: { not: member.userId },
                            status: 'unread'
                        }
                    });
                    io.to(socketId).emit('unread_updated', {
                        type: 'channel',
                        id: channelId,
                        count: unreadCount
                    });
                    console.log(`📤 [send_message] Отправлено участнику ${member.userId}, unread: ${unreadCount}`);
                } else {
                    console.log(`📤 [send_message] Пропускаю участника ${member.userId} (отправитель или не в сети)`);
                }
            }
        } else if (receiverId) {
            // === ПРИВАТНЫЙ ЧАТ ===
            socket.emit('receive_message', newMessage);
            const targetSocketId = onlineUsers.get(receiverId);
            if (targetSocketId) {
                io.to(targetSocketId).emit('receive_message', newMessage);
                const unreadCount = await prisma.message.count({
                    where: {
                        senderId: senderId,
                        receiverId: receiverId,
                        channelId: null,
                        chatId: null,
                        status: 'unread'
                    }
                });
                io.to(targetSocketId).emit('unread_updated', {
                    type: 'private',
                    id: senderId,
                    count: unreadCount
                });
            }
        }

        console.log(`✅ [send_message] Сообщение ${savedMessage.id} разослано`);
    } catch (error) {
        console.error('❌ [send_message] Ошибка:', error);
    }
});
        // === 3. УДАЛЕНИЕ СООБЩЕНИЯ ===
        socket.on('delete_message', async ({ messageId, activeChatId }) => {
            try {
                const message = await prisma.message.findUnique({
                    where: { id: Number(messageId) }
                });
                if (!message || message.senderId !== socket.userId) return;

                await prisma.reaction.deleteMany({ where: { messageId: Number(messageId) } });
                await prisma.thread.deleteMany({ where: { messageId: Number(messageId) } });

                const updatedMessage = await prisma.message.update({
                    where: { id: Number(messageId) },
                    data: {
                        text: "Сообщение удалено",
                        mediaUrl: null,
                        mediaType: null,
                        isDeleted: true,
                        isForwarded: false
                    }
                });

                const deletePayload = {
                    messageId: updatedMessage.id,
                    activeChatId,
                    isDeleted: true
                };

                if (activeChatId?.startsWith('channel_')) {
                    const channelId = parseInt(activeChatId.replace('channel_', ''), 10);
                    io.to(`channel_${channelId}`).emit('message_deleted', deletePayload);
                } else if (activeChatId?.startsWith('chat_')) {
                    const chatId = parseInt(activeChatId.replace('chat_', ''), 10);
                    io.to(`chat_${chatId}`).emit('message_deleted', deletePayload);
                } else if (activeChatId?.startsWith('user_')) {
                    const receiverId = parseInt(activeChatId.replace('user_', ''), 10);
                    socket.emit('message_deleted', deletePayload);
                    const targetSocketId = onlineUsers.get(receiverId);
                    if (targetSocketId) {
                        io.to(targetSocketId).emit('message_deleted', deletePayload);
                    }
                }
            } catch (err) {
                console.error('❌ Ошибка delete_message:', err);
            }
        });

        // === 4. ПРОЧТЕНИЕ СООБЩЕНИЙ ===
        socket.on('read_messages', async ({ activeChatId }) => {
            if (!activeChatId) return;
            const myId = socket.userId;
            console.log(`👁️ Юзер ${myId} прочитал ${activeChatId}`);

            if (activeChatId === 'chat_general' || activeChatId === 'null') return;

            let type, id;
            if (activeChatId.startsWith('channel_')) {
                type = 'channel';
                id = parseInt(activeChatId.replace('channel_', ''), 10);
            } else if (activeChatId.startsWith('chat_')) {
                type = 'chat';
                id = parseInt(activeChatId.replace('chat_', ''), 10);
            } else if (activeChatId.startsWith('user_')) {
                type = 'private';
                id = parseInt(activeChatId.replace('user_', ''), 10);
            } else return;
            if (isNaN(id)) return;

            try {
                if (type === 'chat') {
                    const existing = await prisma.chatMember.findUnique({
                        where: { chatId_userId: { chatId: id, userId: myId } }
                    });
                    if (!existing) {
                        await prisma.chatMember.create({
                            data: { chatId: id, userId: myId, lastReadAt: new Date() }
                        });
                    } else {
                        await prisma.chatMember.update({
                            where: { chatId_userId: { chatId: id, userId: myId } },
                            data: { lastReadAt: new Date() }
                        });
                    }
                    await prisma.message.updateMany({
                        where: { chatId: id, senderId: { not: myId }, status: 'unread' },
                        data: { status: 'read' }
                    });
                    io.to(`chat_${id}`).emit('messages_read_update', {
                        activeChatId: `chat_${id}`,
                        readerId: myId
                    });
                } else if (type === 'channel') {
                    const member = await prisma.channelMember.findFirst({
                        where: { channelId: id, userId: myId }
                    });
                    if (!member) {
                        await prisma.channelMember.create({
                            data: { channelId: id, userId: myId, role: 'member', lastReadAt: new Date() }
                        });
                    } else {
                        await prisma.channelMember.update({
                            where: { id: member.id },
                            data: { lastReadAt: new Date() }
                        });
                    }
                    await prisma.message.updateMany({
                        where: { channelId: id, senderId: { not: myId }, status: 'unread' },
                        data: { status: 'read' }
                    });
                    io.to(`channel_${id}`).emit('messages_read_update', {
                        activeChatId: `channel_${id}`,
                        readerId: myId
                    });
                } else if (type === 'private') {
                    const privateMember = await prisma.privateChatMember.findUnique({
                        where: { userId_otherUserId: { userId: myId, otherUserId: id } }
                    });
                    if (!privateMember) {
                        await prisma.privateChatMember.create({
                            data: { userId: myId, otherUserId: id, lastReadAt: new Date() }
                        });
                    } else {
                        await prisma.privateChatMember.update({
                            where: { id: privateMember.id },
                            data: { lastReadAt: new Date() }
                        });
                    }
                    await prisma.message.updateMany({
                        where: {
                            senderId: id,
                            receiverId: myId,
                            channelId: null,
                            chatId: null,
                            status: { not: 'read' }
                        },
                        data: { status: 'read' }
                    });
                    const targetSocketId = onlineUsers.get(id);
                    if (targetSocketId) {
                        io.to(targetSocketId).emit('messages_read_update', {
                            activeChatId: `user_${myId}`,
                            readerId: myId
                        });
                    }
                }
            } catch (err) {
                console.error('❌ Ошибка read_messages:', err);
            }
        });

        // === 5. ПЕЧАТАНИЕ ===
        socket.on('typing', (data) => {
            if (!data || !data.activeChatId) return;
            const { activeChatId } = data;
            const senderId = socket.userId;
            console.log(`📝 Печатает ${senderId} в ${activeChatId}`);

            if (activeChatId === 'chat_general') {
                socket.to('chat_general').emit('typing', { senderId, isGeneral: true, activeChatId });
            } else if (activeChatId.startsWith('channel_') || activeChatId.startsWith('chat_')) {
                socket.to(activeChatId).emit('typing', { senderId, isGeneral: false, activeChatId });
            } else if (activeChatId.startsWith('user_')) {
                const targetUserId = parseInt(activeChatId.replace('user_', ''), 10);
                if (!isNaN(targetUserId)) {
                    const targetSocketId = onlineUsers.get(targetUserId);
                    if (targetSocketId) {
                        io.to(targetSocketId).emit('typing', {
                            senderId,
                            isGeneral: false,
                            activeChatId: `user_${senderId}`
                        });
                    }
                }
            }
        });

        socket.on('stop_typing', (data) => {
            if (!data || !data.activeChatId) return;
            const { activeChatId } = data;
            const senderId = socket.userId;
            if (activeChatId === 'chat_general') {
                socket.to('chat_general').emit('stop_typing', { activeChatId });
            } else if (activeChatId.startsWith('channel_') || activeChatId.startsWith('chat_')) {
                socket.to(activeChatId).emit('stop_typing', { activeChatId });
            } else if (activeChatId.startsWith('user_')) {
                const targetUserId = parseInt(activeChatId.replace('user_', ''), 10);
                if (!isNaN(targetUserId)) {
                    const targetSocketId = onlineUsers.get(targetUserId);
                    if (targetSocketId) {
                        io.to(targetSocketId).emit('stop_typing', {
                            activeChatId: `user_${senderId}`
                        });
                    }
                }
            }
        });

        // === 6. УДАЛЕНИЕ УЧАСТНИКА ===
        socket.on('remove_member', async (data) => {
            const { chatId, userId, chatType } = data;
            console.log(`🗑️ [SERVER] remove_member: chatId=${chatId}, userId=${userId}, chatType=${chatType}`);

            try {
                let cleanId, roomName;
                if (chatId.startsWith('chat_')) {
                    cleanId = parseInt(chatId.replace('chat_', ''), 10);
                    roomName = `chat_${cleanId}`;
                } else if (chatId.startsWith('channel_')) {
                    cleanId = parseInt(chatId.replace('channel_', ''), 10);
                    roomName = `channel_${cleanId}`;
                } else return;

                if (chatType === 'group') {
                    const member = await prisma.chatMember.findUnique({
                        where: { chatId_userId: { chatId: cleanId, userId } }
                    });
                    if (!member) return;
                    await prisma.chatMember.delete({
                        where: { chatId_userId: { chatId: cleanId, userId } }
                    });
                    io.to(roomName).emit('chat_member_removed', {
                        chatId: cleanId,
                        userId,
                        chatName: 'Групповой чат'
                    });
                    const removedUserSocketId = onlineUsers.get(userId);
                    if (removedUserSocketId) {
                        io.to(removedUserSocketId).emit('chat_member_removed', {
                            chatId: cleanId,
                            userId,
                            chatName: 'Групповой чат'
                        });
                    }
                } else if (chatType === 'channel') {
                    const member = await prisma.channelMember.findUnique({
                        where: { channelId_userId: { channelId: cleanId, userId } }
                    });
                    if (!member) return;
                    await prisma.channelMember.delete({
                        where: { channelId_userId: { channelId: cleanId, userId } }
                    });
                    io.to(roomName).emit('channel_member_removed', {
                        channelId: cleanId,
                        userId,
                        channelName: 'Канал'
                    });
                    const removedUserSocketId = onlineUsers.get(userId);
                    if (removedUserSocketId) {
                        io.to(removedUserSocketId).emit('kicked_from_channel', {
                            channelId: cleanId,
                            channelName: 'Канал'
                        });
                    }
                }
            } catch (err) {
                console.error('❌ Ошибка remove_member:', err);
            }
        });

        // === 7. ДОБАВЛЕНИЕ УЧАСТНИКА ===
        socket.on('add_member', async (data) => {
            const { chatId, userId, chatType } = data;
            console.log(`➕ [SERVER] add_member: chatId=${chatId}, userId=${userId}, chatType=${chatType}`);

            try {
                let cleanId, roomName;
                if (chatId.startsWith('chat_')) {
                    cleanId = parseInt(chatId.replace('chat_', ''), 10);
                    roomName = `chat_${cleanId}`;
                } else if (chatId.startsWith('channel_')) {
                    cleanId = parseInt(chatId.replace('channel_', ''), 10);
                    roomName = `channel_${cleanId}`;
                } else return;

                if (chatType === 'group') {
                    const existing = await prisma.chatMember.findUnique({
                        where: { chatId_userId: { chatId: cleanId, userId } }
                    });
                    if (!existing) {
                        const member = await prisma.chatMember.create({
                            data: { chatId: cleanId, userId },
                            include: { user: { select: { id: true, username: true, avatar: true } } }
                        });
                        const fullChat = await prisma.chat.findUnique({
                            where: { id: cleanId },
                            include: {
                                messages: {
                                    orderBy: { createdAt: 'desc' },
                                    take: 1,
                                    include: { sender: { select: { id: true, username: true } } }
                                },
                                members: {
                                    include: { user: { select: { id: true, username: true, avatar: true } } }
                                }
                            }
                        });
                        const lastMessage = fullChat.messages[0] || null;
                        const chatData = {
                            id: cleanId,
                            name: fullChat.name,
                            avatar: fullChat.avatar,
                            creatorId: fullChat.creatorId,
                            members: fullChat.members,
                            lastMessage,
                            type: 'group'
                        };
                        io.to(roomName).emit('chat_member_added', {
                            chatId: cleanId,
                            member,
                            chatName: fullChat.name,
                            chatAvatar: fullChat.avatar,
                            lastMessage,
                            chatData
                        });
                        const newUserSocketId = onlineUsers.get(userId);
                        if (newUserSocketId) {
                            io.to(newUserSocketId).emit('chat_member_added', {
                                chatId: cleanId,
                                member,
                                chatName: fullChat.name,
                                chatAvatar: fullChat.avatar,
                                lastMessage,
                                chatData
                            });
                        }
                    }
                } else if (chatType === 'channel') {
                    const existing = await prisma.channelMember.findUnique({
                        where: { channelId_userId: { channelId: cleanId, userId } }
                    });
                    if (!existing) {
                        const member = await prisma.channelMember.create({
                            data: { channelId: cleanId, userId, role: 'member' },
                            include: { user: { select: { id: true, username: true, avatar: true } } }
                        });
                        const fullChannel = await prisma.channel.findUnique({
                            where: { id: cleanId },
                            include: {
                                messages: {
                                    orderBy: { createdAt: 'desc' },
                                    take: 1,
                                    include: { sender: { select: { id: true, username: true } } }
                                }
                            }
                        });
                        const lastMessage = fullChannel.messages[0] || null;
                        const { messages, ...channelData } = fullChannel;
                        io.to(roomName).emit('channel_member_added', {
                            channelId: cleanId,
                            member,
                            channelName: fullChannel.name
                        });
                        const newUserSocketId = onlineUsers.get(userId);
                        if (newUserSocketId) {
                            io.to(newUserSocketId).emit('channel_created', {
                                ...channelData,
                                lastMessage,
                                members: [member]
                            });
                        }
                    }
                }
            } catch (err) {
                console.error('❌ Ошибка add_member:', err);
            }
        });

        // === 8. УДАЛЕНИЕ КАНАЛА ===
        socket.on('delete_channel', async ({ channelId }) => {
            try {
                const userId = socket.userId;
                const channel = await prisma.channel.findUnique({ where: { id: channelId } });
                if (!channel || channel.creatorId !== userId) return;
                await prisma.channel.delete({ where: { id: channelId } });
                io.emit('channel_deleted', { channelId });
            } catch (err) {
                console.error('❌ Ошибка delete_channel:', err);
            }
        });

        // === 9. ТРЕДЫ ===
        socket.on('create_thread', async ({ messageId, text, activeChatId }) => {
            try {
                const userId = socket.userId;
                if (!text?.trim()) return;
                const message = await prisma.message.findUnique({ where: { id: messageId } });
                if (!message) return;
                const thread = await prisma.thread.create({
                    data: { messageId, userId, text: text.trim() },
                    include: { user: { select: { id: true, username: true, avatar: true } } }
                });
                io.to(activeChatId || 'chat_general').emit('thread_created', {
                    thread,
                    messageId,
                    activeChatId
                });
            } catch (err) {
                console.error('❌ Ошибка create_thread:', err);
            }
        });

        // === 10. РЕАКЦИИ ===
       socket.on('toggle_reaction', async ({ messageId, type, activeChatId }) => {
    try {
        const userId = socket.userId;
        if (!type) return;
        const existing = await prisma.reaction.findUnique({
            where: { messageId_userId: { messageId, userId } }
        });
        if (existing) {
            await prisma.reaction.delete({
                where: { messageId_userId: { messageId, userId } }
            });
        } else {
            await prisma.reaction.create({
                data: { messageId, userId, type }
            });
        }
        const allReactions = await prisma.reaction.findMany({
            where: { messageId },
            include: { user: { select: { id: true, username: true } } }
        });
        // Отправляем в нужную комнату
        io.to(activeChatId || 'chat_general').emit('reaction_updated', {
            messageId,
            reactions: allReactions
        });
    } catch (err) {
        console.error('❌ Ошибка toggle_reaction:', err);
    }
});

        // === 11. УДАЛЕНИЕ ГРУППЫ (через сокет) ===
        socket.on('delete_group', async ({ chatId }) => {
            try {
                const userId = socket.userId;
                const chat = await prisma.chat.findUnique({ where: { id: chatId } });
                if (!chat || chat.creatorId !== userId) return;
                await prisma.chat.delete({ where: { id: chatId } });
                io.emit('chat_deleted', { chatId });
            } catch (err) {
                console.error('❌ Ошибка delete_group:', err);
            }
        });

        // === 12. ОТКЛЮЧЕНИЕ ===
        socket.on('disconnect', () => {
            const userId = socket.userId;
            console.log(`🔌 Пользователь ${userId} отключился`);
            if (userId && onlineUsers.get(userId) === socket.id) {
                onlineUsers.delete(userId);
                io.emit('user_status_change', { userId, status: 'offline' });
            }
        });
    });
};

module.exports = { setupSocket, onlineUsers };