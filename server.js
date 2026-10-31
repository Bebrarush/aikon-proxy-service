const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const activeApiKey = userApiKey || REAL_OLLAMA_KEY;
// Хранилище независимых чатов: conversationId -> массив сообщений
const chatHistories = new Map();
const requestLogs = [];

// Хранилище загруженных картинок (ID -> Buffer) и указатель на последнюю
const imageStore = new Map();
let lastUploadedImageId = null;

const logRequest = (method, url, body) => {
    const entry = { time: new Date().toLocaleTimeString(), method, url, body };
    requestLogs.unshift(entry);
    if (requestLogs.length > 40) requestLogs.pop();
};

const logResponse = (url, responseBody) => {
    const entry = { time: new Date().toLocaleTimeString(), method: 'OUT ->', url, body: responseBody };
    requestLogs.unshift(entry);
    if (requestLogs.length > 40) requestLogs.pop();
};

const escapeHtml = (str) => {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

const bufferSplit = (buf, separator) => {
    let result = [];
    let index = 0;
    let match;
    while ((match = buf.indexOf(separator, index)) !== -1) {
        result.push(buf.slice(index, match));
        index = match + separator.length;
    }
    result.push(buf.slice(index));
    return result;
};

const crypto = require('crypto');

// Функция генерации «родного» ID чата для совместимости с мидлетом
const generateAikonChatId = () => {
    const uuidPart = crypto.randomBytes(8).toString('hex'); // например, e55da462b3768114
    return uuidPart;
};

const server = http.createServer((req, res) => {
    // Нормализация URL для защиты от HTTP 400 на шлюзе Render (двойные слэши)
    req.url = req.url.replace(/\/\//g, '/');

    if (req.url === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }

    const setHeaders = (statusCode, contentType, contentLength) => {
        if (!res.headersSent) {
            res.writeHead(statusCode, {
                'Content-Type': contentType,
                'Content-Length': contentLength,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            });
        }
    };

    if (req.method === 'OPTIONS') {
        setHeaders(204, 'text/plain', 0);
        return res.end();
    }

    // 0. Страница логов с кнопками управления в браузере
    if (req.url.startsWith('/logs')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const pass = urlParams.get('pass');

        // Проверяем админ-пароль для доступа к логам
        if (pass !== ADMIN_PASSWORD) {
            const errBuf = Buffer.from('Access Denied: Admin Password Required', 'utf-8');
            setHeaders(403, 'text/plain; charset=utf-8', errBuf.length);
            return res.end(errBuf);
        }

        // Если пароль верный — отдаем логи
        const logsHtml = requestLogs.map(l => `[${l.time}] ${l.method} ${l.url} - ${l.details}`).join('\n');
        const buf = Buffer.from(logsHtml, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buf.length);
        return res.end(buf);
    }
        if (req.url.includes('/clear-memory')) {
            chatHistories.clear();
            imageStore.clear();
            lastUploadedImageId = null;
            res.writeHead(302, { 'Location': '/logs' });
            return res.end();
        }

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AIKON Logs</title></head>
    <body style="background:#111;color:#0f0;font-family:monospace;padding:20px;">
    <h2>AIKON Control Panel & Logs</h2>
    <div style="margin-bottom:20px;">
        <a href="/logs/clear-logs" style="background:#333;color:#ff5555;padding:8px 15px;text-decoration:none;border:1px solid #ff5555;margin-right:10px;">Очистить логи</a>
        <a href="/logs/clear-memory" style="background:#333;color:#ffaa00;padding:8px 15px;text-decoration:none;border:1px solid #ffaa00;">Сбросить все чаты ИИ</a>
    </div>
    <hr style="border-color:#333;">
    ${requestLogs.map(l => `<p><b>${l.time}</b> <b>${l.method}</b> ${l.url}<br>BODY: <pre style="white-space:pre-wrap;">${escapeHtml(l.body || '')}</pre></p><hr style="border-color:#222;">`).join('')}
    </body></html>`;
    
    const buf = Buffer.from(html, 'utf-8');
    setHeaders(200, 'text/html; charset=utf-8', buf.length);
    return res.end(buf);
}
    
// Веб-панель, aikon-совместимый дубликат
    if (req.url === '/' || req.url === '/web' || req.url.startsWith('/?chat=')) {
        // Парсим выбранный чат из query-параметров, если он передан
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const activeChatId = urlParams.get('chat') || 'default-chat';

        let chatOptions = '';
        for (let [id] of chatHistories.entries()) {
            const selected = (id === activeChatId) ? 'selected' : '';
            chatOptions += `<option value="${id}" ${selected}>${id}</option>`;
        }
        chatOptions = `<option value="__new__">➕ [ Создать новый чат ]</option>`;
        for (let [id] of chatHistories.entries()) {
            const selected = (id === activeChatId) ? 'selected' : '';
            chatOptions += `<option value="${id}" ${selected}>${id}</option>`;
        }
        if (!chatOptions) {
            chatOptions = `<option value="default-chat">default-chat (по умолчанию)</option>`;
        }

        // Получаем историю сообщений для выбранного чата
        const messages = chatHistories.get(activeChatId) || [];
        let historyHtml = '';
        for (let msg of messages) {
            const roleTag = msg.role === 'user' ? 'ВЫ:' : 'GEMMA 31B:';
            historyHtml += `<p><b>${roleTag}</b><br><pre style="white-space:pre-wrap; border:1px solid #333; padding:10px; background:#000;">${escapeHtml(msg.content)}</pre></p>`;
        }
        if (!historyHtml) {
        	historyHtml = `<p style="color:#555;">[История этого чата пока пуста]</p>`;
        }

        let responseHtml = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>AIKON</title>
            <style>
                body { background: #111; color: #0f0; font-family: monospace; padding: 20px; max-width: 650px; margin: auto; }
                input, textarea, select, button { background: #000; color: #0f0; border: 1px solid #0f0; font-family: monospace; padding: 8px; margin: 5px 0; width: 100%; box-sizing: border-box; }
                button { background: #0f0; color: #000; font-weight: bold; cursor: pointer; }
                button:hover { background: #0aa; }
                .box { border: 1px solid #333; padding: 15px; margin-bottom: 20px; }
            </style>
            <script>
                function changeChat(select) {
                    window.location.href = '/?chat=' + select.value;
                }
                window.onload = function() {
                    if(localStorage.getItem('aikon_pass')) {
                        document.getElementById('adminPass').value = localStorage.getItem('aikon_pass');
                    }
                    if(localStorage.getItem('aikon_user_key')) {
                        document.getElementById('userApiKey').value = localStorage.getItem('aikon_user_key');
                    }
                }
                function savePass(input) {
                    localStorage.setItem('aikon_pass', input.value);
                }
                function saveUserKey(input) {
                    localStorage.setItem('aikon_user_key', input.value);
                }
            </script>
            
        </head>
        <body>
            <h2>AIKON</h2>
            <!-- Ссылка на логи убрана с главного экрана для безопасности -->
            
            <div class="box">
                <form action="/web-upload" method="POST" enctype="multipart/form-data">
                    <label>Ключ-пароль администратора (опционально для логов/админки):</label>
                    <input type="password" id="adminPass" name="adminPass" placeholder="Введите админ-пароль..." oninput="savePass(this)">

                    <label>Ваш API-ключ (для запросов к ИИ):</label>
                    <input type="password" id="userApiKey" name="userApiKey" placeholder="Введите ваш API-ключ..." oninput="saveUserKey(this)">

                    <label>Выберите активный чат:</label>
                    <select name="chatSelector" onchange="changeChat(this)">
                        ${chatOptionsHtml}
                    </select>
                    
                    <input type="hidden" name="conversationId" value="${activeChatId}">
                    
                    <label>Сообщение / Запрос к нейросети:</label>
                    <textarea name="prompt" rows="3" placeholder="Введите текст сообщения..."></textarea>
                    
                    <label>Прикрепить картинку (опционально):</label>
                    <input type="file" name="image">
                    
                    <button type="submit">ОТПРАВИТЬ ЗАПРОС</button>
                </form>
            </div>

            <div class="box">
                <h3>История чата: ${escapeHtml(activeChatId)}</h3>
                <hr style="border-color:#333;">
                ${historyHtml}
            </div>
        </body>
        </html>`;
        
        const buf = Buffer.from(responseHtml, 'utf-8');
        setHeaders(200, 'text/html; charset=utf-8', buf.length);
        return res.end(buf);
    }
// 0.2. Обработчик загрузки из веб-терминала (/web-upload) с автогенерацией ID для новых чатов
    if (req.url === '/web-upload' && req.method === 'POST') {
        let bodyChunks = [];
        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', async () => {
            const buffer = Buffer.concat(bodyChunks);
            logRequest(req.method, req.url, `[Web Multipart Payload: ${buffer.length} bytes]`);

            try {
                const boundaryMatch = req.headers['content-type'] ? req.headers['content-type'].match(/boundary=(?:"([^"]+)"|([^\s]+))/) : null;
                const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;

                let conversationId = 'default-chat';
                let promptText = 'Опиши изображение';
                let adminPass = '';
                let userApiKey = '';
                let imageBuffer = null;

                if (boundary) {
                    const parts = bufferSplit(buffer, Buffer.from('--' + boundary));
                    for (let part of parts) {
                        const partStr = part.toString('utf-8');

                        // Универсальный поиск полей формы
                        if (partStr.includes('name="adminPass"')) {
                            const match = partStr.split('\r\n\r\n')[1];
                            if (match) adminPass = match.replace(/\r\n--.*/g, '').trim();
                        }
                        if (partStr.includes('name="conversationId"')) {
                            const match = partStr.split('\r\n\r\n')[1];
                            if (match) conversationId = match.replace(/\r\n--.*/g, '').trim();
                        }
                        if (partStr.includes('name="prompt"')) {
                            const match = partStr.split('\r\n\r\n')[1];
                            if (match) promptText = match.replace(/\r\n--.*/g, '').trim();
                        }
                        if (partStr.includes('name="image"') && partStr.includes('filename=')) {
                            const headerEndIndex = part.indexOf(Buffer.from('\r\n\r\n'));
                            if (headerEndIndex !== -1) {
                                let rawFile = part.slice(headerEndIndex + 4);
                                if (rawFile[rawFile.length - 1] === 0x0a && rawFile[rawFile.length - 2] === 0x0d) {
                                    rawFile = rawFile.slice(0, rawFile.length - 2);
                                }
                                imageBuffer = rawFile;
                            }
                        }
                    }
                }
                // Отладка: посмотрим, что реально пришло из формы и с чем мы сравниваем
                console.log("DEBUG AUTH -> Received pass:", JSON.stringify(adminPass), "| Expected:", JSON.stringify(ADMIN_PASSWORD));

                if (!adminPass || adminPass !== ADMIN_PASSWORD) {
                    const errBuf = Buffer.from(`S40/1\nstatus: error\n\nAccess Denied: Invalid Admin Password (Got: "${adminPass}")`, 'utf-8');
                    setHeaders(403, 'text/plain; charset=utf-8', errBuf.length);
                    return res.end(errBuf);
                }
                                // Внутри обработчика POST /web-upload после парсинга multipart:
                if (adminPass !== ADMIN_PASSWORD) {
                    const errBuf = Buffer.from(`S40/1\nstatus: error\n\nAccess Denied: Invalid Admin Password`, 'utf-8');
                    setHeaders(403, 'text/plain; charset=utf-8', errBuf.length);
                    return res.end(errBuf);
                }

                // ШАГ 2 (ПРОДОЛЖЕНИЕ): Если выбран пункт создания нового чата, генерируем канонический ID
                if (!conversationId || conversationId === '__new__' || conversationId === 'default-chat') {
                    // Генерируем чистый короткий uuidPart, который так нравится мидлету
                    conversationId = generateAikonChatId(); 
                    logRequest('NEW-CHAT', '/web-upload', `[Generated short web chat ID: ${conversationId}]`);
                }


                // Сохраняем картинку, если она есть
                let assignedImageId = null;
                if (imageBuffer && imageBuffer.length > 100) {
                    assignedImageId = `img-${Date.now()}`;
                    imageStore.set(assignedImageId, imageBuffer);
                    lastUploadedImageId = assignedImageId;
                }

                // Остальная логика отправки в Ollama и сохранения истории...

                // Сохраняем сообщение в историю чата
                if (!chatHistories.has(conversationId)) {
                    chatHistories.set(conversationId, []);
                }
                const history = chatHistories.get(conversationId);
                history.push({ role: "user", content: promptText });

                // Формируем запрос к Ollama
                const ollamaMessages = [...history.slice(-12)];
                if (assignedImageId && imageStore.has(assignedImageId)) {
                    const imgBuf = imageStore.get(assignedImageId);
                    ollamaMessages[ollamaMessages.length - 1].images = [imgBuf.toString('base64')];
                    imageStore.delete(assignedImageId);
                    lastUploadedImageId = null;
                }

                const ollamaData = JSON.stringify({
                    model: "gemma4:31b",
                    messages: ollamaMessages,
                    stream: false
                });

                const options = {
                    hostname: 'ollama.com',
                    path: '/api/chat',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${REAL_OLLAMA_KEY}`
                    }
                };

                // Делаем запрос к реальной нейросети
                const aiResponseText = await new Promise((resolve) => {
                    const oReq = https.request(options, (oRes) => {
                        let oBody = '';
                        oRes.on('data', c => { oBody += c; });
                        oRes.on('end', () => {
                            try {
                                const resJson = JSON.parse(oBody);
                                const text = resJson.message?.content || resJson.response || "Нет ответа от модели.";
                                resolve(text);
                            } catch (e) {
                                resolve("Ошибка парсинга ответа от Ollama JSON.");
                            }
                        });
                    });
                    oReq.on('error', (err) => resolve(`Ошибка сети до Ollama: ${err.message}`));
                    oReq.write(ollamaData);
                    oReq.end();
                });

                history.push({ role: "assistant", content: aiResponseText });

                // Отрисовываем красивый ответ в том же зеленом терминальном стиле Opera Mini
                const htmlResponse = `<!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>AIKON Ответ нейросети</title>
                    <style>
                        body { background: #111; color: #0f0; font-family: monospace; padding: 20px; max-width: 600px; margin: auto; }
                        pre { white-space: pre-wrap; word-break: break-all; border: 1px solid #333; padding: 15px; background: #000; }
                        a { color: #0f0; }
                    </style>
                </head>
                <body>
                    <h2>Результат обработки запроса</h2>
                    <p><b>Чат:</b> ${escapeHtml(conversationId)}</p>
                    <p><b>Ваш запрос:</b> ${escapeHtml(promptText)}</p>
                    <p><b>Ответ модели Gemma 4 31B:</b></p>
                    <pre>${escapeHtml(aiResponseText)}</pre>
                    <br>
                    <p><a href="/">&larr; Вернуться к загрузке новой картинки</a> | <a href="/logs">Логи сервера</a></p>
                </body>
                </html>`;

                const bufResp = Buffer.from(htmlResponse, 'utf-8');
                setHeaders(200, 'text/html; charset=utf-8', bufResp.length);
                return res.end(bufResp);

            } catch (err) {
                const errBuf = Buffer.from(`S40/1\nstatus: error\n\nMultipart Parse Error: ${err.message}`, 'utf-8');
                setHeaders(500, 'text/plain; charset=utf-8', errBuf.length);
                return res.end(errBuf);
            }
        });
        return;
    }
    

    // 1. Сопряжение
    if (req.url.includes('/pair')) {
        logRequest(req.method, req.url, "[PAIRING]");
        const payload = "S40/1\nstatus: ok\ncode: 123456\n\n";
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 2. Список моделей
    if (req.url.includes('/models')) {
        logRequest(req.method, req.url, "[MODELS LIST]");
        const bodyData = "gemma4:31b\tGemma 4 31B\t0\t0\tOpenAI\n";
        const payload = "S40/1\nstatus: ok\n\n" + bodyData;
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 3. Список сохраненных чатов (/conversations)
    if (req.url.includes('/conversations')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            logRequest(req.method, req.url, body);
            let convData = "";
            for (let [id, msgs] of chatHistories.entries()) {
                const title = msgs.length > 0 && msgs[0].role === 'user' 
                    ? msgs[0].content.substring(0, 25).replace(/\t/g, ' ') 
                    : `Чат ${id.substring(0, 6)}`;
                const count = msgs.length;
                const timestamp = Date.now();
                convData += `0\t${id}\t${timestamp}\t${count}\tgemma4:31b\t${title}\n`;
            }
            const payload = "S40/1\nstatus: ok\n\n" + convData;
            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

// 4. Загрузка изображения (/image) с накопительным буфером и сессиями по IP/клиенту
    if (!global.imageSessions) {
        global.imageSessions = new Map();
    }

    if (req.url.includes('/image')) {
        req.setTimeout(60000);
        res.setTimeout(60000);
        
        let bodyChunks = [];
        req.on('data', chunk => {
            bodyChunks.push(chunk);
            req.setTimeout(60000);
        });

        req.on('end', () => {
            const receivedChunk = Buffer.concat(bodyChunks);
            
            // Используем IP клиента как уникальный ключ сессии передачи файла
            const clientId = req.socket.remoteAddress || 'default-client';

            if (!global.imageSessions.has(clientId)) {
                global.imageSessions.set(clientId, { chunks: [], timer: null });
            }

            const session = global.imageSessions.get(clientId);
            session.chunks.push(receivedChunk);

            const totalSize = session.chunks.reduce((acc, c) => acc + c.length, 0);
            logRequest(req.method, req.url, `[Binary JPEG Chunk: ${receivedChunk.length} bytes | Total accumulated for client: ${totalSize} bytes]`);

            // Сбрасываем таймер для этой конкретной сессии
            if (session.timer) {
                clearTimeout(session.timer);
            }

            // Таймер на 15 секунд: если за 15 секунд больше нет чанков от этого клиента — склеиваем файл
            session.timer = setTimeout(() => {
                if (session.chunks.length === 0) return;

                const fullImageBuffer = Buffer.concat(session.chunks);
                global.imageSessions.delete(clientId);

                const imageId = `img-${Date.now()}`;
                imageStore.set(imageId, fullImageBuffer);
                lastUploadedImageId = imageId;

                logRequest('ASSEMBLY', '/image', `[Full Image Assembled Successfully: ${fullImageBuffer.length} bytes, ID: ${imageId}]`);
            }, 15000);

            // Сразу отвечаем клиенту текущим ID, чтобы мидлет не висел
            const assignedId = lastUploadedImageId || `img-${Date.now()}`;
            const payload = [
                "S40/1",
                "status: ok",
                "",
                assignedId
            ].join("\n");

            logResponse('/image (response)', payload);
            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 5. Выгрузка истории конкретного чата (/history)
    if (req.url.includes('/history')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            logRequest(req.method, req.url, body);
            let convId = "default-chat";
            const lines = body.split("\n");
            for (let line of lines) {
                if (line.toLowerCase().startsWith("conversation:")) {
                    const val = line.substring(line.indexOf(":") + 1).trim();
                    if (val) convId = val;
                }
            }

            const historyMsgs = chatHistories.get(convId) || [];
            let historyBody = "";
            for (let m of historyMsgs) {
                const text = m.content;
                const utf16Length = text.length; 
                const prefix = m.role === 'user' ? 'u' : 'a';
                historyBody += `${prefix} ${utf16Length}\n${text}\n`;
            }

            const responseText = [
                "S40/1",
                "status: ok",
                `conversation: ${convId}`,
                "",
                historyBody
            ].join("\n");
            
            logResponse('/history (response)', responseText);

            const buffer = Buffer.from(responseText, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 6. Удаление чата (/delete)
    if (req.url.includes('/delete')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            logRequest(req.method, req.url, body);
            let convId = '';
            const lines = body.split("\n");
            for (let line of lines) {
                if (line.toLowerCase().startsWith("conversation:")) {
                    convId = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            if (convId && chatHistories.has(convId)) {
                chatHistories.delete(convId);
            }
            const payload = "S40/1\nstatus: ok\n\n";
            logResponse('/delete (response)', payload);
            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 7. Основной чат (/chat) без задвоения текста ответа
    if (req.url.includes('/chat')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            logRequest(req.method, req.url, body);
            try {
                let userMessage = "";
                let convId = "default-chat";
                let systemInstruction = "";
                const lines = body.split("\n");
                
                for (let line of lines) {
                    const lower = line.toLowerCase();
                    if (lower.startsWith("prompt:") || lower.startsWith("text:") || lower.startsWith("message:") || lower.startsWith("content:")) {
                        userMessage = line.substring(line.indexOf(":") + 1).trim();
                    }
                    if (lower.startsWith("conversation:")) {
                        const val = line.substring(line.indexOf(":") + 1).trim();
                        if (val) convId = val;
                    }
                    if (lower.startsWith("instructions:") || lower.startsWith("system:") || lower.startsWith("notes:")) {
                        const val = line.substring(line.indexOf(":") + 1).trim();
                        if (val) systemInstruction = val;
                    }
                    if (lower.startsWith("request:") && convId === "default-chat") {
                        const reqVal = line.substring(line.indexOf(":") + 1).trim();
                        if (reqVal) {
                            convId = reqVal.split('-')[1] || reqVal;
                        }
                    }
                }

                if (!userMessage) {
                    const validLines = lines.map(l => l.trim()).filter(l => l && !l.startsWith("S40") && !l.includes(":"));
                    if (validLines.length > 0) {
                        userMessage = validLines[validLines.length - 1];
                    } else {
                        userMessage = body.trim();
                    }
                }

                if (!userMessage) {
                    const fallback = Buffer.from("S40/1\nstatus: error\n\nEmpty message received", 'utf-8');
                    setHeaders(200, 'text/plain; charset=utf-8', fallback.length);
                    return res.end(fallback);
                }

                if (!chatHistories.has(convId)) {
                    chatHistories.set(convId, []);
                }
                const history = chatHistories.get(convId);
                history.push({ role: "user", content: userMessage });

                const ollamaMessages = [];
                if (systemInstruction) {
                    ollamaMessages.push({ role: "system", content: systemInstruction });
                }
                const trimmedHistory = history.slice(-12);
                ollamaMessages.push(...trimmedHistory);

                // Интеграция картинки к последнему сообщению
                let ollamaImages = [];
                if (lastUploadedImageId && imageStore.has(lastUploadedImageId)) {
                    const imgBuf = imageStore.get(lastUploadedImageId);
                    ollamaImages.push(imgBuf.toString('base64'));
                    imageStore.delete(lastUploadedImageId);
                    lastUploadedImageId = null;
                }

                if (ollamaImages.length > 0 && ollamaMessages.length > 0) {
                    ollamaMessages[ollamaMessages.length - 1].images = ollamaImages;
                }

                const ollamaData = JSON.stringify({
                    model: "gemma4:31b",
                    messages: ollamaMessages,
                    stream: false
                });

                const options = {
                    hostname: 'ollama.com',
                    path: '/api/chat',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${REAL_OLLAMA_KEY}`
                    }
                };

                const oReq = https.request(options, (oRes) => {
                    let oBody = '';
                    oRes.on('data', c => { oBody += c; });
                    oRes.on('end', () => {
                        try {
                            const resJson = JSON.parse(oBody);
                            const rawAiText = resJson.message?.content || resJson.response || "Нет ответа.";
                            const aiText = rawAiText.replace(/[\u{1F000}-\u{1F9FF}]/gu, '').trim() || "Привет!";

                            history.push({ role: "assistant", content: aiText });

                            // Чистый ответ без задвоения полей (как в стабильной рабочей версии)
                            const responseText = [
                                "S40/1",
                                "status: ok",
                                `conversation: ${convId}`,
                                "",
                                aiText
                            ].join("\n");

                            logResponse('/v1/chats (response)', responseText);
                            
                            const buffer = Buffer.from(responseText, 'utf-8');
                            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
                            res.end(buffer);
                        } catch (e) {
                            const errBuffer = Buffer.from("S40/1\nstatus: error\n\nOllama JSON Parse Error", 'utf-8');
                            setHeaders(200, 'text/plain; charset=utf-8', errBuffer.length);
                            res.end(errBuffer);
                        }
                    });
                });

                oReq.on('error', (err) => {
                    const errBuffer = Buffer.from(`S40/1\nstatus: error\n\nOllama Net Error: ${err.message}`, 'utf-8');
                    setHeaders(200, 'text/plain; charset=utf-8', errBuffer.length);
                    res.end(errBuffer);
                });

                oReq.write(ollamaData);
                oReq.end();

            } catch (err) {
                const errBuffer = Buffer.from(`S40/1\nstatus: error\n\nProxy Error: ${err.message}`, 'utf-8');
                setHeaders(200, 'text/plain; charset=utf-8', errBuffer.length);
                res.end(errBuffer);
            }
        });
        return;
    }

    // 8. Логгер для прочих запросов
    let unknownBody = '';
    req.on('data', chunk => { unknownBody += chunk.toString(); });
    req.on('end', () => {
        logRequest(req.method, req.url, unknownBody);
        const defBuf = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', defBuf.length);
        res.end(defBuf);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
