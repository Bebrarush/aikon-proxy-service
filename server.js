const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || ''; // Берем настоящий ключ для Ollama Cloud
const CLIENT_SECRET = process.env.ACCESS_TOKEN || 'BeshenyOllama228'; // Наш пароль для клиента

// Хранилище истории диалогов в памяти сервера: conversationId -> массив сообщений
const chatHistories = new Map();

const server = http.createServer((req, res) => {
    const setHeaders = (statusCode, contentType, contentLength) => {
        res.writeHead(statusCode, {
            'Content-Type': contentType,
            'Content-Length': contentLength,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*'
        });
    };

    if (req.method === 'OPTIONS') {
        setHeaders(204, 'text/plain', 0);
        return res.end();
    }

    if (req.url.includes('/pair')) {
        const payload = "S40/1\nstatus: ok\ncode: 123456\n\n";
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    if (req.url.includes('/models')) {
        const bodyData = "gemma4:31b\tGemma 4 31B\t0\t0\tOpenAI\n";
        const payload = "S40/1\nstatus: ok\n\n" + bodyData;
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // Обработка удаления чата
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

    // Основной чат с сохранением истории
    if (req.url.includes('/chat') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
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

                // Инициализируем или получаем историю для этого диалога
                if (!chatHistories.has(convId)) {
                    chatHistories.set(convId, []);
                }
                const history = chatHistories.get(convId);

                // Добавляем сообщение пользователя в историю
                history.push({ role: "user", content: userMessage });

                // Ограничиваем историю последними 10 сообщениями, чтобы не перегружать контекст модели
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

                            // Добавляем ответ ассистента в историю
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

    const defBuf = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
    setHeaders(200, 'text/plain; charset=utf-8', defBuf.length);
    res.end(defBuf);
    // Ловим и логируем вообще любой другой запрос от телефона, чтобы узнать его путь и структуру
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        console.log(`==============================`);
        console.log(`UNKNOWN REQUEST RECEIVED: [${req.method}] ${req.url}`);
        console.log(`BODY: ${JSON.stringify(body)}`);
        console.log(`==============================`);

        const defBuf = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', defBuf.length);
        res.end(defBuf);
    });

});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
