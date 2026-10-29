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

    // 4. Выгрузка истории конкретного чата (/history)
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
            let historyText = historyMsgs.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join("\n\n");
            if (!historyText) historyText = "История пуста.";

            const responseText = [
                "S40/1",
                "status: ok",
                "",
                historyText
            ].join("\n");

            const buffer = Buffer.from(responseText, 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
            res.end(buffer);
        });
        return;
    }

    // 5. Основной чат
    if (req.url.includes('/chat')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            logRequest(req.method, req.url, body);
            try {
                let userMessage = "";
                let convId = "default-chat";
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
                    if (lower.startsWith("request:") && convId === "default-chat") {
                        const reqVal = line.substring(line.indexOf(":") + 1).trim();
                        if (reqVal) {
                            convId = reqVal.split('-')[1] || reqVal;
                        }
                    }
                }

                if (!userMessage) {
                    try {
                        const json = JSON.parse(body);
                        userMessage = json.text || json.prompt || json.message || json.content || '';
                        if (json.conversation) convId = json.conversation;
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
                    const fallback = Buffer.from("S40/1\nstatus: error\n\nEmpty message received", 'utf-8');
                    setHeaders(200, 'text/plain; charset=utf-8', fallback.length);
                    return res.end(fallback);
                }

                if (!chatHistories.has(convId)) {
                    chatHistories.set(convId, []);
                }
                const history = chatHistories.get(convId);
                history.push({ role: "user", content: userMessage });
                const trimmedHistory = history.slice(-12);

                const ollamaData = JSON.stringify({
                    model: "gemma4:31b",
                    messages: trimmedHistory,
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

                            const responseText = [
                                "S40/1",
                                "status: ok",
                                `message: ${aiText}`,
                                `text: ${aiText}`,
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
