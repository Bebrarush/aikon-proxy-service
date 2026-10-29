const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';

// Хранилище независимых чатов: conversationId -> массив сообщений
const chatHistories = new Map();
const requestLogs = [];

const logRequest = (method, url, body) => {
    const entry = { time: new Date().toLocaleTimeString(), method, url, body };
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

// 1. Авторизация и сопряжение (Pairing) по спецификации AIKON
    if (req.url.includes('/pair')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            logRequest(req.method, req.url, body);

            // Если телефон запрашивает старт сопряжения (/pair/start)
            if (req.url.includes('/pair/start')) {
                const payload = [
                    "S40/1",
                    "status: ok",
                    "pair: secret-128bit-token-xyz",
                    "code: 123456",
                    ""
                ].join("\n");
                const buffer = Buffer.from(payload, 'utf-8');
                setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
                return res.end(buffer);
            }

            // Когда телефон запрашивает статус/токен (/pair/claim или /pair)
            const payload = [
                "S40/1",
                "status: ok",
                "device: nokia-c6",
                "token: aikon-permanent-access-token-12345",
                ""
            ].join("\n");
            
            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            return res.end(buffer);
        });
        return;
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

// 6. Получение списка сохраненных чатов (/conversations) по спецификации S40/1
    if (req.url.includes('/conversations')) {
        logRequest(req.method, req.url, '');
        const convIds = Array.from(chatHistories.keys());
        
        let bodyContent = "";
        if (convIds.length === 0) {
            bodyContent = "default-chat\tDefault Chat";
        } else {
            bodyContent = convIds.map(id => `${id}\t${id}`).join("\n");
        }

        // Заголовки, пустая строка, затем тело (свободный текст) со списком чатов
        const responseText = [
            "S40/1",
            "status: ok",
            "",
            bodyContent
        ].join("\n");
        
        const buffer = Buffer.from(responseText, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 7. Удаление конкретного чата (/delete)
    if (req.url.includes('/delete')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            logRequest(req.method, req.url, body);
            let targetConv = "";
            const lines = body.split("\n");
            
            for (let line of lines) {
                const lower = line.toLowerCase();
                if (lower.startsWith("conversation:") || lower.startsWith("id:") || lower.startsWith("request:")) {
                    targetConv = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            
            if (!targetConv) {
                try {
                    const json = JSON.parse(body);
                    targetConv = json.conversation || json.id || '';
                } catch (e) {}
            }

            if (targetConv && chatHistories.has(targetConv)) {
                chatHistories.delete(targetConv);
            } else if (body.trim() && chatHistories.has(body.trim())) {
                chatHistories.delete(body.trim());
            }

            const responseText = "S40/1\nstatus: ok\n\nDeleted";
            const buffer = Buffer.from(responseText, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }
    // 3.1. Удаление чата (/delete)
    if (req.url.includes('delete') || req.url.includes('remove')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            logRequest(req.method, req.url, body);
            let convId = "";
            const lines = body.split("\n");
            for (let line of lines) {
                const lower = line.toLowerCase();
                if (lower.startsWith("conversation:") || lower.startsWith("id:")) {
                    const val = line.substring(line.indexOf(":") + 1).trim();
                    if (val) convId = val;
                }
            }
            if (convId && chatHistories.has(convId)) {
                chatHistories.delete(convId);
            }
            const payload = "S40/1\nstatus: ok\n\n";
            const buffer = Buffer.from(payload, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 4. Выгрузка истории конкретного чата (/history) по точной спецификации AIKON
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
            
            // Формат по ARCHITECTURE.md: каждый блок начинается с u N или a N, затем перенос строки, текст и снова перенос строки
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
                "older: 0",
                "",
                historyBody
            ].join("\n");

            const buffer = Buffer.from(responseText, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 5. Основной чат (исправленный формат S40/1 без дублирования и с сохранением контекста)
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
                }

                // Fallback если тело пришло в JSON или плоском тексте
                if (!userMessage) {
                    try {
                        const json = JSON.parse(body);
                        userMessage = json.text || json.prompt || json.message || json.content || '';
                        if (json.conversation) convId = json.conversation;
                        if (json.instructions) systemInstruction = json.instructions;
                    } catch (e) {}
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
                    const fallback = Buffer.from("S40/1\nstatus: error\n\nEmpty message", 'utf-8');
                    setHeaders(200, 'text/plain; charset=utf-8', fallback.length);
                    return res.end(fallback);
                }

                // Работаем с памятью текущего диалога
                if (!chatHistories.has(convId)) {
                    chatHistories.set(convId, []);
                }
                const history = chatHistories.get(convId);
                
                // Добавляем сообщение пользователя в историю
                history.push({ role: "user", content: userMessage });

                // Собираем полный контекст для Ollama
                const ollamaMessages = [];
                if (systemInstruction) {
                    ollamaMessages.push({ role: "system", content: systemInstruction });
                }
                
                // Передаем последние 14 сообщений из истории диалога
                const trimmedHistory = history.slice(-14);
                ollamaMessages.push(...trimmedHistory);

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
                            
                            // Очищаем от эмодзи, которые ломают экран Symbian
                            const aiText = rawAiText.replace(/[\u{1F000}-\u{1F9FF}]/gu, '').trim() || "Привет!";

                            // Сохраняем ответ ИИ в историю текущей сессии
                            history.push({ role: "assistant", content: aiText });

                            // ЧИСТЫЙ СТАНДАРТ S40/1: Без дублирования заголовков message: и text:!
                            const responseText = [
                                "S40/1",
                                "status: ok",
                                "",
                                aiText
                            ].join("\n");
                            
                            const buffer = Buffer.from(responseText, 'utf-8');
                            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
                            res.end(buffer);
                        } catch (e) {
                            const errBuffer = Buffer.from("S40/1\nstatus: error\n\nJSON Parse Error", 'utf-8');
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
