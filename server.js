const http = require('http');
const https = require('https');

const OLLAMA_KEY = process.env.OLLAMA_API_KEY;

const server = http.createServer((req, res) => {
    // Базовые заголовки, запрещающие кэширование и сжатие
    const setHeaders = (statusCode, contentType, length) => {
        res.writeHead(statusCode, {
            'Content-Type': contentType,
            'Content-Length': length,
            'Cache-Control': 'no-store, no-transform',
            'Connection': 'close',
            'Access-Control-Allow-Origin': '*'
        });
    };

    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
        return res.end();
    }

    // 1. Проверка здоровья (/health)
    if (req.url.includes('/health')) {
        const payload = "S40/1\nstatus: ok\nserver: claude-s40-server\nversion: 0.9.2\nmock: false\n";
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 2. Истинный эхо-тест (/echo) — чистое бинарное зеркало байт-в-байт
    if (req.url.includes('/echo')) {
        let bodyChunks = [];
        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', () => {
            const rawBuffer = Buffer.concat(bodyChunks);
            setHeaders(200, 'text/plain; charset=utf-8', rawBuffer.length);
            res.end(rawBuffer);
        });
        return;
    }

// 3. Сопряжение: Шаг 1 — старт (/v1/pair/start)
    if (req.url.includes('/v1/pair/start')) {
        // Возвращаем 6-значный код для экрана телефона и секрет для связки
        const payload = "S40/1\nstatus: ok\npair: aikon-secret-token\ncode: 123456\nexp: 9999999999\n";
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 3.1. Сопряжение: Шаг 2 — подтверждение (/v1/pair/claim)
    if (req.url.includes('/v1/pair/claim')) {
        // Автоматически одобряем устройство и выдаем токен доступа
        const payload = "S40/1\nstatus: ok\ntoken: Besheny0llama228\n";
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }
    // 3.2. Список моделей (/v1/models или /models)
// 3.2. Список моделей (/models или /v1/models)
    if (req.url.includes('/models')) {
        const payload = JSON.stringify({
            status: "ok",
            models: ["gemma4:31b"],
            data: [
                { id: "gemma4:31b", name: "gemma4:31b" }
            ]
        });
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'application/json; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 4. Основной чат (/v1/chat или /chat)
    if (req.url.includes('/chat') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                let userMessage = "";
                const lines = body.split("\n");
                for (let line of lines) {
                    if (line.startsWith("prompt:") || line.startsWith("text:")) {
                        userMessage = line.substring(line.indexOf(":") + 1).trim();
                    }
                }
                if (!userMessage) {
                    try {
                        const json = JSON.parse(body);
                        userMessage = json.text || json.prompt || json.message || '';
                    } catch (e) {}
                }

                if (!userMessage) {
                    const fallback = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
                    setHeaders(200, 'text/plain; charset=utf-8', fallback.length);
                    return res.end(fallback);
                }

                const ollamaData = JSON.stringify({
                    model: "gemma4:31b",
                    messages: [{ role: "user", content: userMessage }],
                    stream: false
                });

                const options = {
                    hostname: 'ollama.com',
                    path: '/api/chat',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OLLAMA_KEY}`
                    }
                };

                const oReq = https.request(options, (oRes) => {
                    let oBody = '';
                    oRes.on('data', c => { oBody += c; });
                    oRes.on('end', () => {
                        try {
                            const resJson = JSON.parse(oBody);
                            const aiText = resJson.message?.content || "Нет ответа от модели.";
                            const responseText = [
                                "S40/1",
                                "status: success",
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

    const defaultBuffer = Buffer.from("S40/1\nstatus: ok\n", 'utf-8');
    setHeaders(200, 'text/plain; charset=utf-8', defaultBuffer.length);
    res.end(defaultBuffer);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Native HTTP Proxy running on port ${PORT}`);
});
