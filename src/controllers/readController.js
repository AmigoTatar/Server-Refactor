const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const markRead = async (req, res) => {
    try {
        const userId = req.userId;
        const { type, id } = req.body;

        if (!type || !id) {
            return res.status(400).json({ error: 'Не указан type или id' });
        }

        console.log(`📖 Отметка о прочтении: type=${type}, id=${id}, userId=${userId}`);

        if (type === 'chat') {
            const chatExists = await prisma.chat.findUnique({
                where: { id: parseInt(id) }
            });
            if (!chatExists) {
                return res.status(404).json({ error: 'Чат не найден' });
            }

            const existingMember = await prisma.chatMember.findUnique({
                where: {
                    chatId_userId: {
                        chatId: parseInt(id),
                        userId
                    }
                }
            });

            if (!existingMember) {
                await prisma.chatMember.create({
                    data: {
                        chatId: parseInt(id),
                        userId: userId,
                        lastReadAt: new Date()
                    }
                });
            } else {
                await prisma.chatMember.update({
                    where: {
                        chatId_userId: {
                            chatId: parseInt(id),
                            userId
                        }
                    },
                    data: { lastReadAt: new Date() }
                });
            }

            // Помечаем сообщения как прочитанные
            await prisma.message.updateMany({
                where: {
                    chatId: parseInt(id),
                    senderId: { not: userId },
                    status: 'unread'
                },
                data: { status: 'read' }
            });

        } else if (type === 'channel') {
            const channelId = parseInt(id);
            const channelExists = await prisma.channel.findUnique({
                where: { id: channelId }
            });
            if (!channelExists) {
                return res.status(404).json({ error: 'Канал не найден' });
            }

            const member = await prisma.channelMember.findFirst({
                where: {
                    channelId: channelId,
                    userId: userId
                }
            });

            if (!member) {
                await prisma.channelMember.create({
                    data: {
                        channelId: channelId,
                        userId: userId,
                        role: 'member',
                        lastReadAt: new Date()
                    }
                });
            } else {
                await prisma.channelMember.update({
                    where: { id: member.id },
                    data: { lastReadAt: new Date() }
                });
            }

            await prisma.message.updateMany({
                where: {
                    channelId: channelId,
                    senderId: { not: userId },
                    status: 'unread'
                },
                data: { status: 'read' }
            });

        } else if (type === 'private') {
            const otherUserId = parseInt(id);

            const privateMember = await prisma.privateChatMember.findUnique({
                where: {
                    userId_otherUserId: {
                        userId: userId,
                        otherUserId: otherUserId
                    }
                }
            });

            if (!privateMember) {
                await prisma.privateChatMember.create({
                    data: {
                        userId: userId,
                        otherUserId: otherUserId,
                        lastReadAt: new Date()
                    }
                });
            } else {
                await prisma.privateChatMember.update({
                    where: { id: privateMember.id },
                    data: { lastReadAt: new Date() }
                });
            }

            await prisma.message.updateMany({
                where: {
                    senderId: otherUserId,
                    receiverId: userId,
                    channelId: null,
                    chatId: null,
                    status: { not: 'read' }
                },
                data: { status: 'read' }
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка в markRead:', error);
        res.status(500).json({
            error: 'Failed to mark as read',
            details: error.message
        });
    }
};

module.exports = { markRead };