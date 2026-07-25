const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('./src/middleware/auth');
const { getMuteStatus } = require('./src/controllers/muteController');

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
const app = express();
const server = http.createServer(app);

// ==========================================
// ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
// ==========================================
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.$connect()
    .then(() => console.log('✅ Подключение к PostgreSQL успешно!'))
    .catch((err) => {
        console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
        process.exit(1);
    });

app.set('prisma', prisma);

// ==========================================
// БЕЗОПАСНОСТЬ И НАСТРОЙКИ
// ==========================================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: ["http://localhost:5173", "http://localhost:5001"],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==========================================
// СТАТИКА (uploads)
// ==========================================
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// ==========================================
// RATE LIMITING
// ==========================================
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Слишком много запросов, попробуйте позже' },
    standardHeaders: true,
    legacyHeaders: false
});

const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Слишком много запросов на прочтение' },
    standardHeaders: true,
    legacyHeaders: false
});

const reactionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Слишком много реакций, подождите' },
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    message: { error: 'Слишком много попыток входа. Попробуйте через 5 минут.' },
    standardHeaders: true,
    legacyHeaders: false
});

const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Слишком много поисковых запросов, подождите' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', globalLimiter);
app.use('/api/read', readLimiter);
app.use('/api/messages/:messageId/reactions', reactionLimiter);
app.use('/api/messages/search', searchLimiter);
app.use('/api/auth/login', authLimiter);

// ==========================================
// ПОДКЛЮЧЕНИЕ РОУТОВ
// ==========================================
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const channelRoutes = require('./src/routes/channelRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const messageRoutes = require('./src/routes/messageRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const readRoutes = require('./src/routes/readRoutes');
const unreadRoutes = require('./src/routes/unreadRoutes');
const muteRoutes = require('./src/routes/muteRoutes');

// Импортируем мидлварь и контроллеры для дополнительных роутов

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/read', readRoutes);
app.use('/api/unread', unreadRoutes);
app.use('/api/mute', muteRoutes);

// ==========================================
// ДОПОЛНИТЕЛЬНЫЕ РОУТЫ (для совместимости с фронтендом)
// ==========================================
app.get('/api/mute-status', authenticateToken, getMuteStatus);


// ==========================================
// СОКЕТЫ
// ==========================================
const { Server } = require('socket.io');
const { setupSocket } = require('./src/socket/socketHandlers');

const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173", "http://localhost:5001"],
        methods: ["GET", "POST"]
    },
    transports: ['websocket']
});
app.set('io', io);
setupSocket(io, prisma);

// ==========================================
// ЗАПУСК СЕРВЕРА
// ==========================================
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
    console.log(`🚀 Сервер успешно запущен на http://localhost:${PORT}`);
});

// ==========================================
// ОБРАБОТКА НЕПРЕДВИДЕННЫХ ОШИБОК
// ==========================================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});