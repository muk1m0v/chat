const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- ПУТИ ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(__dirname, 'users.json');
const DB_FILE = path.join(__dirname, 'chat.db');

// Создаём папку для загрузок, если её нет
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ---------- НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ФАЙЛОВ ----------
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50 МБ
});

// ---------- SQLITE ----------
const db = new sqlite3.Database(DB_FILE);

// Создаём таблицу сообщений (если ещё не существует)
db.run(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        text TEXT,
        file_url TEXT,
        file_type TEXT,
        timestamp INTEGER
    )
`, (err) => {
    if (err) {
        console.error('Ошибка создания таблицы messages:', err);
    } else {
        console.log('✅ Таблица messages готова (или уже существует)');
        // Добавляем недостающие колонки (миграция)
        db.run(`ALTER TABLE messages ADD COLUMN file_url TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Ошибка добавления file_url:', err);
            } else {
                console.log('✅ Колонка file_url добавлена (или уже существует)');
            }
        });
        db.run(`ALTER TABLE messages ADD COLUMN file_type TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Ошибка добавления file_type:', err);
            } else {
                console.log('✅ Колонка file_type добавлена (или уже существует)');
            }
        });
    }
});

// ---------- ФУНКЦИИ РАБОТЫ С БД ----------
function getMessages(limit = 100) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM messages ORDER BY timestamp ASC LIMIT ?',
            [limit],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

function saveMessage(username, text, file_url, file_type, timestamp) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO messages (username, text, file_url, file_type, timestamp) VALUES (?, ?, ?, ?, ?)',
            [username, text || '', file_url || '', file_type || '', timestamp],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

function deleteMessageById(id, username) {
    return new Promise((resolve, reject) => {
        db.run(
            'DELETE FROM messages WHERE id = ? AND username = ?',
            [id, username],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// ---------- ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ ИЗ JSON ----------
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data).users || [];
        }
    } catch (e) {
        console.error('Ошибка чтения users.json:', e);
    }
    return [];
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function authenticateUser(username, password) {
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        if (!user.color) {
            user.color = getRandomColor();
            fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
        }
        return user;
    }
    return null;
}

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- МАРШРУТЫ ----------
app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = authenticateUser(username, password);
    if (user) {
        res.json({ success: true, username: user.username, color: user.color });
    } else {
        res.status(401).json({ success: false, message: 'Неверное имя или пароль' });
    }
});

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    let fileType = 'file';
    if (req.file.mimetype.startsWith('image/')) fileType = 'image';
    else if (req.file.mimetype.startsWith('video/')) fileType = 'video';
    else if (req.file.mimetype.startsWith('audio/')) fileType = 'audio';
    res.json({ url: fileUrl, type: fileType });
});

app.delete('/message/:id', async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Не указан пользователь' });
    try {
        const changes = await deleteMessageById(id, username);
        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Сообщение не найдено или не принадлежит вам' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/colors', (req, res) => {
    const users = loadUsers();
    res.json({ users: users.map(u => ({ username: u.username, color: u.color })) });
});

app.get('/color/:username', (req, res) => {
    const users = loadUsers();
    const user = users.find(u => u.username === req.params.username);
    if (user) {
        res.json({ color: user.color });
    } else {
        res.status(404).json({ error: 'Пользователь не найден' });
    }
});

// ---------- SOCKET.IO ----------
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');

    let currentUser = null;

    socket.on('setUsername', (username) => {
        currentUser = username;
        console.log(`👤 Пользователь "${username}" вошёл в чат`);
    });

    socket.on('getHistory', async () => {
        try {
            const messages = await getMessages(100);
            socket.emit('history', messages);
        } catch (err) {
            console.error('Ошибка получения истории:', err);
        }
    });

    socket.on('sendMessage', async (data) => {
        const { username, text, file_url, file_type } = data;
        if (!username) return;
        const timestamp = Date.now();
        try {
            const id = await saveMessage(username, text || '', file_url || '', file_type || '', timestamp);
            const msg = { id, username, text, file_url, file_type, timestamp };
            io.emit('newMessage', msg);
        } catch (err) {
            console.error('Ошибка сохранения сообщения:', err);
        }
    });

    socket.on('deleteMessage', async (data) => {
        const { id, username } = data;
        if (!id || !username) return;
        try {
            const changes = await deleteMessageById(id, username);
            if (changes > 0) {
                io.emit('messageDeleted', { id, username });
            }
        } catch (err) {
            console.error('Ошибка удаления:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log(`👋 Пользователь "${currentUser || 'неизвестный'}" отключился`);
    });
});

// ---------- ЗАПУСК ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📁 Статика из: ${PUBLIC_DIR}`);
    console.log(`📂 Загрузки в: ${UPLOAD_DIR}`);
});