const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';

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
        if (req.url.includes('/clear-logs')) {
            requestLogs.length = 0;
            res.writeHead(302, { 'Location': '/logs' });
            return res.end();
        }
        if (req.url.includes('/clear-memory')) {
            chatHistories.clear();
            imageStore.clear();
            lastUploadedImageId = null;
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
            const payload = "S40/1\nstatus: ok\n\n" + convData;
            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 4. Загрузка изображения (/image) по эталонной структуре Эмира
    if (req.url.includes('/image')) {
        req.setTimeout(60000);
        res.setTimeout(60000);
        
        let chunks = [];
        req.on('data', chunk => {
            chunks.push(chunk);
            req.setTimeout(60000);
        
        });
        req.on('end', () => {
            const imageBuffer = Buffer.concat(chunks);
            logRequest(req.method, req.url, `[Binary JPEG Image: ${imageBuffer.length} bytes]`);

            const imageId = `img-${Date.now()}`;
            imageStore.set(imageId, imageBuffer);
            lastUploadedImageId = imageId;

            // Эталонная структура ответа клиенту AIKON для загрузки картинок
            const payload = [
                "S40/1",
                "status: ok",
                `conversation: ${imageId}`,
                ""
                
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
