const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';

// Хранилища в памяти сервера
const chatHistories = new Map();
const requestLogs = []; // Массив для отладки через браузер

const logRequest = (method, url, body) => {
    const entry = { time: new Date().toLocaleTimeString(), method, url, body };
    requestLogs.unshift(entry);
    if (requestLogs.length > 40) requestLogs.pop();
};

const escapeHtml = (str) => {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

const server = http.createServer((req, res) => {
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

    // 0. Страница логов в браузере (на самом верху)
    if (req.url.startsWith('/logs')) {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AIKON Logs</title><meta http-equiv="refresh" content="2"></head><body style="background:#111;color:#0f0;font-family:monospace;padding:20px;"><h2>AIKON Live Logs (Auto-refresh)</h2><hr/>${requestLogs.map(l => `<p>[<b>${l.time}</b>] <b>${l.method}</b> ${l.url}<br>BODY: <pre>${escapeHtml(l.body || '')}</pre></p><hr>`).join('')}</body></html>`;
        const buf = Buffer.from(html, 'utf-8');
        setHeaders(200, 'text/html; charset=utf-8', buf.length);
        return res.end(buf);
    }

    // 1. Эндпоинты сопряжения
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

    // 3. Удаление / очистка чата
    if (req.url.includes('/delete') || req.url.includes('/clear')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            logRequest(req.method, req.url, body);
            let convId = "default";
            const lines = body.split("\n");
            for (let line of lines) {
                if (line.toLowerCase().startsWith("conversation:")) {
                    convId = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            chatHistories.delete(convId);
            const resp = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', resp.length);
            res.end(resp);
        });
        return;
    }

    // 4. Основной чат
    if (req.url.includes('/chat')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            logRequest(req.method, req.url, body);
            try {
                let userMessage = "";
                let convId = "default";
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
                    if (lower.startsWith("request:") && convId === "default") {
                        const reqVal = line.substring(line.indexOf(":") + 1).trim();
                        if (reqVal) {
                            convId = reqVal.split('-')[0] || reqVal;
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
                const trimmedHistory = history.slice(-10);

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

    // 5. Логгер для остальных неизвестных запросов
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
