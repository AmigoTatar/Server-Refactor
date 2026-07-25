const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getUnread = async (req, res) => {
    try {
        const userId = req.userId;
        console.log(`📊 Запрос непрочитанных для пользователя ${userId}`);

        // 1. Приватные чаты
        const privateMembers = await prisma.privateChatMember.findMany({
            where: {
                OR: [
                    { userId: userId },
                    { otherUserId: userId }
                ]
            }
        });

        const privateUnreadCounts = {};
        for (const member of privateMembers) {
            const otherUserId = member.userId === userId ? member.otherUserId : member.userId;
            const lastReadTime = member.lastReadAt || new Date(0);

            const unreadCount = await prisma.message.count({
                where: {
                    senderId: otherUserId,
                    receiverId: userId,
                    channelId: null,
                    chatId: null,
                    status: 'unread',
                    createdAt: { gt: lastReadTime }
                }
            });

            if (unreadCount > 0) {
                privateUnreadCounts[`user_${otherUserId}`] = unreadCount;
            }
        }

        // 2. Каналы
        const channelMembers = await prisma.channelMember.findMany({
            where: { userId },
            include: {
                channel: {
                    include: {
                        messages: {
                            where: {
                                senderId: { not: userId },
                                status: 'unread'
                            }
                        }
                    }
                }
            }
        });

        const channelUnreadCounts = {};
        channelMembers.forEach(member => {
            const lastRead = member.lastReadAt || new Date(0);
            const unreadMessages = member.channel.messages.filter(
                msg => new Date(msg.createdAt) > new Date(lastRead)
            );
            const count = unreadMessages.length;
            if (count > 0) {
                channelUnreadCounts[`channel_${member.channelId}`] = count;
            }
        });

        // 3. Групповые чаты
        const chatMembers = await prisma.chatMember.findMany({
            where: { userId },
            include: {
                chat: {
                    include: {
                        messages: {
                            where: {
                                senderId: { not: userId },
                                status: 'unread'
                            }
                        }
                    }
                }
            }
        });

        const chatUnreadCounts = {};
        chatMembers.forEach(member => {
            const lastRead = member.lastReadAt || new Date(0);
            const unreadMessages = member.chat.messages.filter(
                msg => new Date(msg.createdAt) > new Date(lastRead)
            );
            const count = unreadMessages.length;
            if (count > 0) {
                chatUnreadCounts[`chat_${member.chatId}`] = count;
            }
        });

        const allUnreadCounts = {
            ...privateUnreadCounts,
            ...channelUnreadCounts,
            ...chatUnreadCounts
        };

        console.log(`📊 ИТОГОВЫЕ счетчики для пользователя ${userId}:`, allUnreadCounts);
        res.json(allUnreadCounts);
    } catch (error) {
        console.error('❌ Ошибка получения непрочитанных:', error);
        res.status(500).json({ error: 'Failed to get unread counts' });
    }
};

module.exports = { getUnread };