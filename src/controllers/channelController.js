const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');
const { onlineUsers } = require('../socket/socketHandlers');

const deleteFile = (filePath) => {
    if (filePath && filePath.startsWith('/uploads/')) {
        const fullPath = path.join(__dirname, '../../public', filePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    }
};

// --- GET /api/channels ---
const getChannels = async (req, res) => {
    try {
        const userId = req.userId;
        const channelMembers = await prisma.channelMember.findMany({
            where: { userId },
            include: {
                channel: {
                    include: {
                        messages: {
                            orderBy: { createdAt: 'desc' },
                            take: 1,
                            include: {
                                sender: { select: { id: true, username: true } }
                            }
                        }
                    }
                }
            }
        });

        const channels = channelMembers.map(member => {
            const channel = member.channel;
            const lastMessage = channel.messages[0] || null;
            const { messages, ...channelData } = channel;
            return { ...channelData, lastMessage };
        });

        res.json(channels);
    } catch (error) {
        console.error('❌ Ошибка получения каналов:', error);
        res.status(500).json({ error: 'Ошибка загрузки каналов' });
    }
};

// --- GET /api/channels/:channelId ---
const getChannel = async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId);
        const userId = req.userId;

        const member = await prisma.channelMember.findFirst({
            where: { channelId, userId }
        });
        if (!member) {
            return res.status(403).json({ error: 'Вы не участник этого канала' });
        }

        const channel = await prisma.channel.findUnique({
            where: { id: channelId },
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: {
                        sender: { select: { id: true, username: true } }
                    }
                }
            }
        });

        const lastMessage = channel.messages[0] || null;
        const { messages, ...channelData } = channel;
        res.json({ ...channelData, lastMessage });
    } catch (error) {
        console.error('Ошибка получения канала:', error);
        res.status(500).json({ error: 'Ошибка загрузки канала' });
    }
};

// --- POST /api/channels ---
const createChannel = async (req, res) => {
    try {
        const { name, avatar } = req.body;
        const creatorId = req.userId;

        if (!name) {
            return res.status(400).json({ error: 'Название канала обязательно' });
        }

        const userExists = await prisma.user.findUnique({ where: { id: creatorId } });
        if (!userExists) {
            return res.status(400).json({ error: 'Пользователь не найден' });
        }

        const newChannel = await prisma.channel.create({
            data: {
                name: name.trim(),
                avatar: avatar || '📢',
                creatorId,
                lastMessageId: null,
            },
        });

        await prisma.channelMember.create({
            data: {
                channelId: newChannel.id,
                userId: creatorId,
                role: 'admin'
            }
        });

        res.status(201).json(newChannel);
    } catch (error) {
        console.error('Ошибка создания канала:', error);
        res.status(500).json({ error: 'Не удалось создать канал' });
    }
};

// --- PUT /api/channels/:channelId ---
const updateChannel = async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId);
        const userId = req.userId;
        const { name } = req.body;

        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) {
            return res.status(404).json({ error: 'Канал не найден' });
        }

        // Проверка прав (админ или создатель)
        const isAdmin = await prisma.channelMember.findFirst({
            where: { channelId, userId, role: 'admin' }
        });
        if (channel.creatorId !== userId && !isAdmin) {
            return res.status(403).json({ error: 'Только создатель или админ может изменять канал' });
        }

        let avatar = channel.avatar;
        if (req.file) {
            // Удаляем старый аватар
            if (avatar && avatar.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, '../../public', avatar);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            avatar = '/uploads/' + req.file.filename;
        }

        const updatedChannel = await prisma.channel.update({
            where: { id: channelId },
            data: {
                name: name !== undefined ? name.trim() : channel.name,
                avatar,
            },
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    include: { sender: { select: { id: true, username: true } } }
                }
            }
        });

        const lastMessage = updatedChannel.messages[0] || null;
        const { messages, ...channelData } = updatedChannel;
        const result = { ...channelData, lastMessage, type: 'channel' };

        // Отправляем событие всем участникам канала
        const io = req.app.get('io');
        io.to(`channel_${channelId}`).emit('channel_updated', result);

        console.log(`✏️ Канал ${channelId} обновлён, событие разослано`);
        res.json(result);
    } catch (error) {
        console.error('Ошибка обновления канала:', error);
        res.status(500).json({ error: 'Не удалось обновить канал' });
    }
};

// --- DELETE /api/channels/:channelId ---
const deleteChannel = async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId);
        const userId = req.userId;

        console.log(`🗑️ [SERVER] Удаление канала ${channelId} пользователем ${userId}`);

        const channel = await prisma.channel.findUnique({
            where: { id: channelId }
        });
        if (!channel) {
            return res.status(404).json({ error: 'Канал не найден' });
        }
        if (channel.creatorId !== userId) {
            return res.status(403).json({ error: 'Только создатель может удалить канал' });
        }

        // Удаляем всех участников канала (связи)
        await prisma.channelMember.deleteMany({
            where: { channelId }
        });

        // Удаляем сам канал
        await prisma.channel.delete({
            where: { id: channelId }
        });

        // Отправляем событие через сокет
        const io = req.app.get('io');
        io.emit('channel_deleted', { channelId });

        // Также можно отправить каждому участнику лично, чтобы они закрыли комнату
        // Но проще через io.emit – все клиенты получат и обновят списки

        console.log(`🗑️ Канал ${channelId} удалён, событие разослано`);
        res.json({ success: true, message: 'Канал удален' });
    } catch (error) {
        console.error('Ошибка удаления канала:', error);
        res.status(500).json({ error: 'Не удалось удалить канал', details: error.message });
    }
};

// --- GET /api/channels/:channelId/members ---
const getChannelMembers = async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId);
        const members = await prisma.channelMember.findMany({
            where: { channelId },
            include: {
                user: {
                    select: { id: true, username: true, avatar: true }
                }
            }
        });
        res.json(members);
    } catch (error) {
        console.error('Ошибка получения участников канала:', error);
        res.status(500).json({ error: 'Не удалось получить участников' });
    }
};

const addChannelMember = async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId);
        const { userId } = req.body;
        const currentUserId = req.userId;

        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) {
            return res.status(404).json({ error: 'Канал не найден' });
        }

        const isAdmin = await prisma.channelMember.findFirst({
            where: { channelId, userId: currentUserId, role: 'admin' }
        });
        if (!isAdmin) {
            return res.status(403).json({ error: 'Только админ может добавлять участников' });
        }

        const existing = await prisma.channelMember.findUnique({
            where: { channelId_userId: { channelId, userId } }
        });
        if (existing) {
            return res.status(400).json({ error: 'Пользователь уже участник канала' });
        }

        const member = await prisma.channelMember.create({
            data: { channelId, userId, role: 'member' },
            include: { user: { select: { id: true, username: true, avatar: true } } }
        });

        // 🔥 Отправка сокет-события
        try {
            const io = req.app.get('io');
            const roomName = `channel_${channelId}`;
            io.to(roomName).emit('channel_member_added', {
                channelId,
                member,
                channelName: channel.name
            });

            // Отправляем новому участнику
            const newUserSocketId = onlineUsers.get(userId);
            if (newUserSocketId) {
                // Получаем полные данные канала для нового участника
                const fullChannel = await prisma.channel.findUnique({
                    where: { id: channelId },
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
                io.to(newUserSocketId).emit('channel_created', {
                    ...channelData,
                    lastMessage,
                    members: [member]
                });
                // Подписываем нового участника на комнату
                const socket = io.sockets.sockets.get(newUserSocketId);
                if (socket) socket.join(roomName);
            }
        } catch (socketError) {
            console.error('❌ Ошибка отправки сокет-события при добавлении участника в канал:', socketError);
            // Не прерываем выполнение, чтобы клиент получил успешный ответ
        }

        res.status(201).json(member);
    } catch (error) {
        console.error('Ошибка добавления участника в канал:', error);
        res.status(500).json({ error: 'Не удалось добавить участника', details: error.message });
    }
};

// --- DELETE /api/channels/:channelId/members/:userId ---
const removeChannelMember = async (req, res) => {
    try {
        const channelId = parseInt(req.params.channelId);
        const userId = parseInt(req.params.userId);
        const currentUserId = req.userId;

        console.log(`🗑️ [SERVER] Удаление пользователя ${userId} из канала ${channelId}`);

        const channel = await prisma.channel.findUnique({
            where: { id: channelId }
        });
        if (!channel) {
            return res.status(404).json({ error: 'Канал не найден' });
        }

        // Если пользователь пытается удалить себя (выйти из канала) - разрешаем
        if (userId === currentUserId) {
            // Проверяем, что пользователь не создатель (создатель не может покинуть канал)
            if (userId === channel.creatorId) {
                return res.status(400).json({ error: 'Создатель не может покинуть канал' });
            }
            // Удаляем участника
            const member = await prisma.channelMember.findUnique({
                where: { channelId_userId: { channelId, userId } }
            });
            if (!member) {
                return res.status(404).json({ error: 'Вы не участник канала' });
            }
            await prisma.channelMember.delete({
                where: { channelId_userId: { channelId, userId } }
            });
            // Отправляем событие
            const io = req.app.get('io');
            io.to(`channel_${channelId}`).emit('channel_member_removed', {
                channelId,
                userId,
                channelName: channel.name
            });
            // Отправляем лично покинувшему пользователю
            const removedSocketId = onlineUsers.get(userId);
            if (removedSocketId) {
                io.to(removedSocketId).emit('kicked_from_channel', {
                    channelId,
                    channelName: channel.name
                });
                const socket = io.sockets.sockets.get(removedSocketId);
                if (socket) {
                    socket.leave(`channel_${channelId}`);
                    console.log(`🚪 Пользователь ${userId} покинул канал ${channelId}`);
                }
            }
            return res.json({ success: true, message: 'Вы покинули канал' });
        }

        // Иначе проверяем права админа для удаления других участников
        const isAdmin = await prisma.channelMember.findFirst({
            where: { channelId, userId: currentUserId, role: 'admin' }
        });
        if (!isAdmin) {
            return res.status(403).json({ error: 'Только админ может удалять участников' });
        }

        if (userId === channel.creatorId) {
            return res.status(400).json({ error: 'Нельзя удалить создателя канала' });
        }

        const member = await prisma.channelMember.findUnique({
            where: { channelId_userId: { channelId, userId } }
        });
        if (!member) {
            return res.status(404).json({ error: 'Участник не найден' });
        }

        await prisma.channelMember.delete({
            where: { channelId_userId: { channelId, userId } }
        });

        const io = req.app.get('io');
        io.to(`channel_${channelId}`).emit('channel_member_removed', {
            channelId,
            userId,
            channelName: channel.name
        });

        res.json({ success: true, message: 'Участник удален из канала' });
    } catch (error) {
        console.error('Ошибка удаления участника из канала:', error);
        res.status(500).json({ error: 'Не удалось удалить участника', details: error.message });
    }
};

module.exports = {
    getChannels,
    getChannel,
    createChannel,
    updateChannel,
    deleteChannel,
    getChannelMembers,
    addChannelMember,
    removeChannelMember,
};