const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';

// Хранилище загруженных картинок (ID -> Buffer)
const imageStore = new Map();
// Последнее загруженное изображение для текущей сессии
let lastUploadedImageId = null;

// Хранилище независимых чатов: conversationId -> массив сообщений
const chatHistories = new Map();
const requestLogs = [];

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

const server = http.createServer((req, res) => {
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
        if (req.url.includes('/clear-logs')) {
            requestLogs.length = 0;
            res.writeHead(302, { 'Location': '/logs' });
            return res.end();
        }
        if (req.url.includes('/clear-memory')) {
            chatHistories.clear();
            res.writeHead(302, { 'Location': '/logs' });
            return res.end();
        }

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AIKON Logs</title><meta http-equiv="refresh" content="3"></head>
        <body style="background:#111;color:#0f0;font-family:monospace;padding:20px;">
            <h2>AIKON Control Panel & Logs</h2>
            <div style="margin-bottom: 20px;">
                <a href="/logs/clear-logs" style="background:#333;color:#ff5555;padding:8px 15px;text-decoration:none;border:1px solid #ff5555;margin-right:10px;">Очистить логи</a>
                <a href="/logs/clear-memory" style="background:#333;color:#ffaa00;padding:8px 15px;text-decoration:none;border:1px solid #ffaa00;">Сбросить все чаты ИИ</a>
            </div>
            <hr style="border-color:#333;"/>
            ${requestLogs.map(l => `<p>[<b>${l.time}</b>] <b>${l.method}</b> ${l.url}<br>BODY: <pre style="white-space:pre-wrap;">${escapeHtml(l.body || '')}</pre></p><hr style="border-color:#222;">`).join('')}
        </body></html>`;
        const buf = Buffer.from(html, 'utf-8');
        setHeaders(200, 'text/html; charset=utf-8', buf.length);
        return res.end(buf);
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
            // Чистый формат без дополнительных pins/models в теле ответа:
            const payload = "S40/1\nstatus: ok\n\n" + convData;
            
            logResponse('/conversations (response)', payload);

            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }


// 4. Выгрузка сообщений сохранённого чата в окно с чатом
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

            // ПРАВИЛЬНО: отдаем historyBody после заголовков!
            const responseText = [
                "S40/1",
                "status: ok",
                `conversation: ${convId}`,
                "",
                historyBody
            ].join("\n");
            
            

            const buffer = Buffer.from(responseText, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

// 2. Обработка отправки сообщения (/chat)
    if (req.url.includes('/chat')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            logRequest(req.method, req.url, body);
            
            let userMessage = '';
            let convId = '';
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
                if (lower.startsWith("request:") && (!convId || convId === "default-chat")) {
                    const reqVal = line.substring(line.indexOf(":") + 1).trim();
                    if (reqVal) {
                        convId = reqVal.split('-')[1] || reqVal;
                    }
                }
            }

            if (!convId) {
                convId = `chat-${Date.now()}`;
            }

            if (!chatHistories.has(convId)) {
                chatHistories.set(convId, []);
            }
            let history = chatHistories.get(convId);

            if (userMessage) {
                history.push({ role: 'user', content: userMessage });
            }

            // --- СВЯЗКА С КАРТИНКОЙ ---
            let ollamaImages = [];
            if (lastUploadedImageId && imageStore.has(lastUploadedImageId)) {
                const imgBuf = imageStore.get(lastUploadedImageId);
                ollamaImages.push(imgBuf.toString('base64')); // Переводим бинарник в Base64
                imageStore.delete(lastUploadedImageId);       // Очищаем буфер
                lastUploadedImageId = null;
            }

            const ollamaPayload = {
                model: "gemma4:31b",
                messages: history,
                stream: false
            };

            // Если картинка была загружена, цепляем её к последнему сообщению пользователя
            if (ollamaImages.length > 0 && history.length > 0) {
                history[history.length - 1].images = ollamaImages;
            }
            // ---------------------------

            let aiText = "Ошибка ответа модели";
            try {
                // === ВОТ ТУТ НАХОДИТСЯ FETCH К OLLAMA ===
                const ollamaRes = await fetch('http://localhost:11434/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ollamaPayload)
                });
                const data = await ollamaRes.json();
                if (data.message && data.message.content) {
                    aiText = data.message.content;
                }
            } catch (err) {
                console.error("Ollama error:", err);
            }

            history.push({ role: 'assistant', content: aiText });

            const responseText = [
                "S40/1",
                "status: ok",
                `conversation: ${convId}`,
                "",
                aiText
            ].join("\n");

            const buffer = Buffer.from(responseText, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }
    // Удаление конкретного чата (/delete)
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
    // 4. Загрузка изображения (/image)
    if (req.url.includes('/image')) {
        let chunks = [];
        req.on('data', chunk => {
            chunks.push(chunk);
        });
        req.on('end', () => {
            const imageBuffer = Buffer.concat(chunks);
            logRequest(req.method, req.url, `[Binary JPEG Image: ${imageBuffer.length} bytes]`);

            const imageId = `img-${Date.now()}`;
            imageStore.set(imageId, imageBuffer);
            lastUploadedImageId = imageId; // запоминаем последнюю картинку

            const payload = [
                "S40/1",
                "status: ok",
                `conversation: ${imageId}`,
                "",
                `Image uploaded successfully`
            ].join("\n");

            logResponse('/image (response)', payload);

            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 6. Логгер для прочих запросов
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
