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
let selectedMessageId = null;
let usersColors = {};

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

// ---------- Вход (ручной или автоматический) ----------
function performLogin(username, password, callback) {
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
            localStorage.setItem('chatPassword', password);
            loginModal.style.display = 'none';
            chatApp.style.display = 'flex';
            userDisplay.textContent = currentUser;
            if (callback) callback();
            initSocket();
        } else {
            if (callback) callback(false);
            showLoginError(data.message || 'Ошибка входа');
        }
    })
    .catch(err => {
        showLoginError('Ошибка соединения с сервером');
        console.error(err);
        if (callback) callback(false);
    });
}

function login() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value.trim();
    if (!username || !password) {
        showLoginError('Заполните все поля');
        return;
    }
    performLogin(username, password);
}

loginBtn.addEventListener('click', login);
loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
loginUsername.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

// ---------- Автоматический вход при загрузке ----------
function autoLogin() {
    const savedUsername = localStorage.getItem('chatUsername');
    const savedPassword = localStorage.getItem('chatPassword');
    if (savedUsername && savedPassword) {
        performLogin(savedUsername, savedPassword, (success) => {
            if (!success) {
                localStorage.removeItem('chatUsername');
                localStorage.removeItem('chatPassword');
                loginModal.style.display = 'flex';
            }
        });
    } else {
        loginModal.style.display = 'flex';
    }
}

// ---------- Выход ----------
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('chatUsername');
    localStorage.removeItem('chatPassword');
    location.reload();
});

// ---------- Инициализация Socket.IO ----------
function initSocket() {
    if (socket) {
        socket.disconnect();
    }
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
        fetchColors();
    });

    socket.on('newMessage', (msg) => {
        appendMessage(msg);
        if (msg.username && !usersColors[msg.username]) {
            fetchColorForUser(msg.username);
        }
    });

    socket.on('messageDeleted', (data) => {
        const msgElement = document.querySelector(`.message[data-id="${data.id}"]`);
        if (msgElement) msgElement.remove();
        if (messagesWrapper.children.length === 0) {
            emptyState.style.display = 'flex';
        }
    });

    socket.on('connect_error', () => {
        setInputEnabled(false);
    });
}

// ---------- Запрос цветов ----------
function fetchColors() {
    fetch('/colors')
        .then(res => res.json())
        .then(data => {
            if (data.users) {
                data.users.forEach(u => { usersColors[u.username] = u.color; });
                updateColorList();
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

    const textDiv = document.createElement('div');
    textDiv.className = 'msg-text';
    if (msg.text) textDiv.textContent = msg.text;

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

    // Долгое нажатие для удаления (только свои сообщения)
    if (msg.username === currentUser) {
        let pressTimer = null;
        div.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                pressTimer = setTimeout(() => {
                    showContextMenu(e.clientX, e.clientY, msg.id);
                }, 600);
            }
        });
        div.addEventListener('mouseup', () => clearTimeout(pressTimer));
        div.addEventListener('mouseleave', () => clearTimeout(pressTimer));
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

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
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

document.addEventListener('click', (e) => {
    if (colorModal.style.display === 'block' && !colorModal.contains(e.target) && e.target !== colorBtn) {
        colorModal.style.display = 'none';
    }
});

// ---------- Запуск авто-входа ----------
autoLogin();