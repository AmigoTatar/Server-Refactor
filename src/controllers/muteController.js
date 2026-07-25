const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getMuteStatus = async (req, res) => {
    try {
        const userId = req.userId;
        const { type, id } = req.query;

        if (!type || !id) {
            return res.status(400).json({ error: 'Не указан type или id' });
        }

        let muted = false;

        if (type === 'private') {
            const otherUserId = parseInt(id);
            const member = await prisma.privateChatMember.findUnique({
                where: {
                    userId_otherUserId: {
                        userId: userId,
                        otherUserId: otherUserId
                    }
                }
            });
            if (member) muted = member.muted || false;
        } else if (type === 'channel') {
            const channelId = parseInt(id);
            const member = await prisma.channelMember.findUnique({
                where: {
                    channelId_userId: {
                        channelId: channelId,
                        userId: userId
                    }
                }
            });
            if (member) muted = member.muted || false;
        } else if (type === 'chat') {
            const chatId = parseInt(id);
            const member = await prisma.chatMember.findUnique({
                where: {
                    chatId_userId: {
                        chatId: chatId,
                        userId: userId
                    }
                }
            });
            if (member) muted = member.muted || false;
        }

        res.json({ muted });
    } catch (error) {
        console.error('❌ Ошибка получения статуса "Не беспокоить":', error);
        res.status(500).json({ error: 'Не удалось получить статус' });
    }
};

const toggleMute = async (req, res) => {
    try {
        const userId = req.userId;
        const { type, id } = req.body;

        if (!type || !id) {
            return res.status(400).json({ error: 'Не указан type или id' });
        }

        let result;

        if (type === 'private') {
            const otherUserId = parseInt(id);
            const member = await prisma.privateChatMember.findUnique({
                where: {
                    userId_otherUserId: {
                        userId: userId,
                        otherUserId: otherUserId
                    }
                }
            });
            if (!member) {
                return res.status(404).json({ error: 'Чат не найден' });
            }
            result = await prisma.privateChatMember.update({
                where: { id: member.id },
                data: { muted: !member.muted }
            });
        } else if (type === 'channel') {
            const channelId = parseInt(id);
            const member = await prisma.channelMember.findUnique({
                where: {
                    channelId_userId: {
                        channelId: channelId,
                        userId: userId
                    }
                }
            });
            if (!member) {
                return res.status(404).json({ error: 'Вы не участник канала' });
            }
            result = await prisma.channelMember.update({
                where: { id: member.id },
                data: { muted: !member.muted }
            });
        } else if (type === 'chat') {
            const chatId = parseInt(id);
            const member = await prisma.chatMember.findUnique({
                where: {
                    chatId_userId: {
                        chatId: chatId,
                        userId: userId
                    }
                }
            });
            if (!member) {
                return res.status(404).json({ error: 'Вы не участник чата' });
            }
            result = await prisma.chatMember.update({
                where: { id: member.id },
                data: { muted: !member.muted }
            });
        } else {
            return res.status(400).json({ error: 'Неизвестный тип чата' });
        }

        res.json({ success: true, muted: result.muted, type, id });
    } catch (error) {
        console.error('❌ Ошибка изменения режима "Не беспокоить":', error);
        res.status(500).json({ error: 'Не удалось изменить режим' });
    }
};

module.exports = { getMuteStatus, toggleMute };