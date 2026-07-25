const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
                sender: {
                    select: { id: true, username: true, avatar: true }
                }
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

module.exports = { getPinnedMessages };