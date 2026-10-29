const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || ''; // Настоящий ключ для Ollama Cloud

// Хранилище истории диалогов в памяти сервера: conversationId -> массив сообщений
const chatHistories = new Map();

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

    // 1. Эндпоинты сопряжения (pairing)
    if (req.url.includes('/pair')) {
        const payload = "S40/1\nstatus: ok\ncode: 123456\n\n";
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 2. Список моделей
    if (req.url.includes('/models')) {
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
            let convId = "default";
            const lines = body.split("\n");
            for (let line of lines) {
                if (line.toLowerCase().startsWith("conversation:")) {
                    convId = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            chatHistories.delete(convId);
            console.log(`CHAT DELETED FOR ID: ${convId}`);
            const resp = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
            setHeaders(200, 'text/plain; charset=utf-8', resp.length);
            res.end(resp);
        });
        return;
    }

    // 4. Основной чат (/chat)
    if (req.url.includes('/chat')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                console.log("RAW CHAT BODY FROM NOKIA:", JSON.stringify(body));
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

                console.log("EXTRACTED USER MESSAGE:", userMessage);

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
                            console.log("OLLAMA RESPONSE:", oBody);
                            const resJson = JSON.parse(oBody);
                            const rawAiText = resJson.message?.content || resJson.response || "Нет ответа от модели.";
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
                            console.error("Ollama JSON Parse Error:", e);
                            const errBuffer = Buffer.from("S40/1\nstatus: error\n\nOllama JSON Parse Error", 'utf-8');
                            setHeaders(200, 'text/plain; charset=utf-8', errBuffer.length);
                            res.end(errBuffer);
                        }
                    });
                });

                oReq.on('error', (err) => {
                    console.error("Ollama Net Error:", err);
                    const errBuffer = Buffer.from(`S40/1\nstatus: error\n\nOllama Net Error: ${err.message}`, 'utf-8');
                    setHeaders(200, 'text/plain; charset=utf-8', errBuffer.length);
                    res.end(errBuffer);
                });

                oReq.write(ollamaData);
                oReq.end();

            } catch (err) {
                console.error("Proxy Error:", err);
                const errBuffer = Buffer.from(`S40/1\nstatus: error\n\nProxy Error: ${err.message}`, 'utf-8');
                setHeaders(200, 'text/plain; charset=utf-8', errBuffer.length);
                res.end(errBuffer);
            }
        });
        return; // Обязательный return, чтобы синхронный поток не шел дальше вниз!
    }
    // Массив для хранения последних 30 запросов для отладки в браузере
const requestLogs = [];
const logRequest = (method, url, body) => {
    const entry = { time: new Date().toLocaleTimeString(), method, url, body };
    requestLogs.unshift(entry);
    if (requestLogs.length > 30) requestLogs.pop();
};

    // 5. Логгер для любых других неизвестных запросов (вместо падений)
    let unknownBody = '';
    req.on('data', chunk => { unknownBody += chunk.toString(); });
    req.on('end', () => {
        console.log(`UNKNOWN ROUTE: [${req.method}] ${req.url} | BODY: ${JSON.stringify(unknownBody)}`);
        const defBuf = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', defBuf.length);
        res.end(defBuf);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
