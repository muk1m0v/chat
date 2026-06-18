// ============================================================
//  CLIENT-SIDE LOGIC
// ============================================================

// ---------- DOM ----------
const loginModal = document.getElementById('loginModal');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const chatApp = document.getElementById('chatApp');
const userDisplay = document.getElementById('userDisplay');
const messagesWrapper = document.getElementById('messagesWrapper');
const emptyState = document.getElementById('emptyState');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const fileInput = document.getElementById('fileInput');
const colorBtn = document.getElementById('colorBtn');
const colorModal = document.getElementById('colorModal');
const colorList = document.getElementById('colorList');
const closeColor = document.querySelector('.close-color');
const logoutBtn = document.getElementById('logoutBtn');

const contextMenu = document.getElementById('contextMenu');
const deleteMsgBtn = document.getElementById('deleteMsgBtn');

let socket = null;
let currentUser = '';
let currentColor = '';
let selectedMessageId = null; // для удаления
let usersColors = {}; // username -> color

// ---------- Запоминание имени ----------
const savedUsername = localStorage.getItem('chatUsername');
if (savedUsername) {
    loginUsername.value = savedUsername;
    loginPassword.focus();
}

// ---------- Функции ----------
function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
    messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
}

function showLoginError(msg) {
    loginError.textContent = msg;
}

function setInputEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
}

// ---------- Вход ----------
function login() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value.trim();
    if (!username || !password) {
        showLoginError('Заполните все поля');
        return;
    }

    fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentUser = data.username;
            currentColor = data.color;
            localStorage.setItem('chatUsername', currentUser);
            loginModal.style.display = 'none';
            chatApp.style.display = 'flex';
            userDisplay.textContent = currentUser;
            initSocket();
        } else {
            showLoginError(data.message || 'Ошибка входа');
        }
    })
    .catch(err => {
        showLoginError('Ошибка соединения с сервером');
        console.error(err);
    });
}

loginBtn.addEventListener('click', login);
loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
loginUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

// ---------- Выход ----------
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('chatUsername');
    location.reload();
});

// ---------- Инициализация Socket.IO ----------
function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Socket подключен');
        socket.emit('setUsername', currentUser);
        socket.emit('getHistory');
        setInputEnabled(true);
        messageInput.focus();
    });

    socket.on('disconnect', () => {
        console.log('Socket отключен');
        setInputEnabled(false);
    });

    socket.on('history', (messages) => {
        renderMessages(messages);
        // Собираем цвета из сообщений
        messages.forEach(msg => {
            if (msg.username && !usersColors[msg.username]) {
                // запросим цвет у сервера? Но мы можем получить его из users.json только через отдельный API.
                // Для простоты будем использовать рандомный цвет, но лучше сервер будет присылать.
                // Пока сгенерируем локально (но он не будет совпадать с другими клиентами).
                // Решение: сервер при входе возвращает цвет, а при получении сообщения мы уже знаем цвет отправителя? 
                // Лучше добавить событие 'userColor' или передавать цвет в сообщении.
                // Мы модифицируем: при отправке сообщения будем передавать и цвет пользователя.
                // Но для истории – нам нужны цвета. Будем сохранять в БД цвет? Или будем запрашивать у сервера цвет по имени?
                // Сделаем проще: при входе сервер отдаст цвет текущего пользователя, а для других будем получать через отдельный запрос.
                // Но мы можем модифицировать сервер, чтобы он в сообщение добавлял цвет отправителя.
                // Переделаем сервер: при сохранении сообщения будем добавлять поле color.
                // Но так как мы уже написали сервер без цвета, давайте добавим в сервер новое поле.
                // Пока оставим так: цвет будем брать из users.json при входе, и при получении сообщения от других – будем запрашивать цвет через API.
                // Для упрощения: сделаем запрос к серверу за цветом при первом появлении имени.
            }
        });
        // Запросим цвета всех участников
        fetchColors();
    });

    socket.on('newMessage', (msg) => {
        appendMessage(msg);
        // Если нового пользователя нет в списке цветов – запросим
        if (msg.username && !usersColors[msg.username]) {
            fetchColorForUser(msg.username);
        }
    });

    socket.on('messageDeleted', (data) => {
        // Удаляем сообщение из DOM по id
        const msgElement = document.querySelector(`.message[data-id="${data.id}"]`);
        if (msgElement) msgElement.remove();
        // Если удалено последнее сообщение, покажем empty state?
        if (messagesWrapper.children.length === 0) {
            emptyState.style.display = 'flex';
        }
    });

    // Обработка ошибок
    socket.on('connect_error', () => {
        setInputEnabled(false);
    });
}

// ---------- Запрос цветов у сервера (дополнительный эндпоинт) ----------
function fetchColors() {
    // Мы можем добавить маршрут /colors, который возвращает всех пользователей с цветами
    fetch('/colors')
        .then(res => res.json())
        .then(data => {
            if (data.users) {
                data.users.forEach(u => { usersColors[u.username] = u.color; });
                updateColorList();
                // Обновим цвета в уже отрисованных сообщениях
                document.querySelectorAll('.message').forEach(el => {
                    const username = el.dataset.username;
                    if (username && usersColors[username]) {
                        const dot = el.querySelector('.msg-username .color-dot');
                        if (dot) dot.style.backgroundColor = usersColors[username];
                    }
                });
            }
        })
        .catch(err => console.error('Ошибка получения цветов:', err));
}

function fetchColorForUser(username) {
    fetch(`/color/${username}`)
        .then(res => res.json())
        .then(data => {
            if (data.color) {
                usersColors[username] = data.color;
                updateColorList();
                // Обновить в DOM
                document.querySelectorAll(`.message[data-username="${username}"]`).forEach(el => {
                    const dot = el.querySelector('.msg-username .color-dot');
                    if (dot) dot.style.backgroundColor = data.color;
                });
            }
        })
        .catch(() => {});
}

// ---------- Отрисовка сообщений ----------
function renderMessages(messages) {
    // Удаляем все, кроме emptyState
    [...messagesWrapper.children].forEach(el => {
        if (el.id !== 'emptyState') el.remove();
    });
    if (!messages || messages.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';
    messages.forEach(msg => appendMessage(msg, false));
    scrollToBottom();
}

function appendMessage(msg, scroll = true) {
    emptyState.style.display = 'none';
    const div = document.createElement('div');
    div.className = `message ${msg.username === currentUser ? 'self' : 'other'}`;
    div.dataset.id = msg.id;
    div.dataset.username = msg.username;

    // Верхняя часть: имя + цвет
    const nameDiv = document.createElement('div');
    nameDiv.className = 'msg-username';
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    const color = usersColors[msg.username] || '#888';
    dot.style.backgroundColor = color;
    nameDiv.appendChild(dot);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = msg.username;
    nameDiv.appendChild(nameSpan);

    // Текст
    const textDiv = document.createElement('div');
    textDiv.className = 'msg-text';
    if (msg.text) textDiv.textContent = msg.text;

    // Медиа
    let mediaDiv = null;
    if (msg.file_url) {
        mediaDiv = document.createElement('div');
        mediaDiv.className = 'msg-media';
        if (msg.file_type === 'image') {
            const img = document.createElement('img');
            img.src = msg.file_url;
            img.alt = 'image';
            mediaDiv.appendChild(img);
        } else if (msg.file_type === 'video') {
            const video = document.createElement('video');
            video.src = msg.file_url;
            video.controls = true;
            video.preload = 'metadata';
            mediaDiv.appendChild(video);
        } else {
            const a = document.createElement('a');
            a.href = msg.file_url;
            a.target = '_blank';
            a.textContent = '📎 Скачать файл';
            mediaDiv.appendChild(a);
        }
    }

    // Мета (время)
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatTime(msg.timestamp);
    meta.appendChild(timeSpan);

    div.appendChild(nameDiv);
    if (textDiv.textContent) div.appendChild(textDiv);
    if (mediaDiv) div.appendChild(mediaDiv);
    div.appendChild(meta);

    // Добавляем слушатель долгого нажатия (для своих сообщений)
    if (msg.username === currentUser) {
        let pressTimer = null;
        div.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // левая кнопка
                pressTimer = setTimeout(() => {
                    showContextMenu(e.clientX, e.clientY, msg.id);
                }, 600);
            }
        });
        div.addEventListener('mouseup', () => clearTimeout(pressTimer));
        div.addEventListener('mouseleave', () => clearTimeout(pressTimer));
        // Для touch
        div.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                const touch = e.touches[0];
                showContextMenu(touch.clientX, touch.clientY, msg.id);
            }, 600);
        });
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('touchmove', () => clearTimeout(pressTimer));
    }

    messagesWrapper.appendChild(div);
    if (scroll) scrollToBottom();
}

// ---------- Контекстное меню ----------
function showContextMenu(x, y, msgId) {
    selectedMessageId = msgId;
    contextMenu.style.display = 'block';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
}

deleteMsgBtn.addEventListener('click', () => {
    if (selectedMessageId && socket) {
        socket.emit('deleteMessage', { id: selectedMessageId, username: currentUser });
        contextMenu.style.display = 'none';
        selectedMessageId = null;
    }
});

document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
    }
});

// ---------- Отправка сообщения ----------
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text && fileInput.files.length === 0) return;
    if (!socket) return;

    // Если есть файлы – загружаем их и отправляем
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.url) {
                socket.emit('sendMessage', {
                    username: currentUser,
                    text: text || '',
                    file_url: data.url,
                    file_type: data.type
                });
                messageInput.value = '';
                fileInput.value = '';
            }
        })
        .catch(err => console.error('Ошибка загрузки файла:', err));
    } else {
        socket.emit('sendMessage', {
            username: currentUser,
            text: text,
            file_url: '',
            file_type: ''
        });
        messageInput.value = '';
    }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// ---------- Кнопка выбора файла ----------
fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        // Автоматически отправим
        sendMessage();
    }
});

// ---------- Цвета ----------
colorBtn.addEventListener('click', () => {
    if (colorModal.style.display === 'block') {
        colorModal.style.display = 'none';
    } else {
        updateColorList();
        colorModal.style.display = 'block';
    }
});
closeColor.addEventListener('click', () => {
    colorModal.style.display = 'none';
});

function updateColorList() {
    colorList.innerHTML = '';
    for (const [username, color] of Object.entries(usersColors)) {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.backgroundColor = color;
        li.appendChild(dot);
        li.appendChild(document.createTextNode(username));
        colorList.appendChild(li);
    }
}

// Закрываем цветовое окно при клике вне
document.addEventListener('click', (e) => {
    if (colorModal.style.display === 'block' && !colorModal.contains(e.target) && e.target !== colorBtn) {
        colorModal.style.display = 'none';
    }
});