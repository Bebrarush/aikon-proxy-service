const http = require('http');
const https = require('https');

const OLLAMA_KEY = process.env.OLLAMA_API_KEY;

const server = http.createServer((req, res) => {
    // Функция для отправки строго структурированных ответов с Content-Length
    const sendResponse = (statusCode, data, isText = false) => {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        const buffer = Buffer.from(payload, 'utf-8');
        
        res.writeHead(statusCode, {
            'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
            'Content-Length': buffer.length,
            'Connection': 'close', // Жестко рвем соединение, чтобы Symbian не ждал Keep-Alive
            'Access-Control-Allow-Origin': '*'
        });
        res.end(buffer);
    };

    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
        return res.end();
    }

    // 1. Проверка здоровья (/health)
    if (req.url.includes('/health')) {
        return sendResponse(200, {
            server: "aikon",
            version: "0.18.0",
            status: "ok",
            mock: false
        });
    }

    // 2. Эхо-тест (/echo) — зеркальный возврат байт-в-байт
    if (req.url.includes('/echo')) {
        let bodyChunks = [];
        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', () => {
            const rawBuffer = Buffer.concat(bodyChunks);
            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Length': rawBuffer.length,
                'Connection': 'close',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(rawBuffer);
        });
        return;
    }

    // 3. Сопряжение (/pair)
    if (req.url.includes('/pair')) {
        return sendResponse(200, {
            status: "success",
            pairing: "success",
            authenticated: true,
            token_valid: true,
            access_token: "Besheny0llama228",
            credits: 99999,
            models: ["gemma4:31b"]
        });
    }

    // 4. Основной чат (/v1/chat)
    if (req.url.includes('/chat') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const incomingData = JSON.parse(body || '{}');
                const userMessage = incomingData.text || incomingData.prompt || incomingData.message || '';
                
                if (!userMessage) {
                    return sendResponse(200, { status: "success" });
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
                            return sendResponse(200, {
                                status: "success",
                                error: null,
                                text: aiText,
                                response: aiText,
                                message: aiText
                            });
                        } catch (e) {
                            return sendResponse(200, { status: "error", text: "Ошибка парсинга ответа Ollama" });
                        }
                    });
                });

                oReq.on('error', (err) => {
                    return sendResponse(200, { status: "error", text: `Ошибка сети Ollama: ${err.message}` });
                });

                oReq.write(ollamaData);
                oReq.end();

            } catch (err) {
                return sendResponse(200, { status: "error", text: `Ошибка прокси: ${err.message}` });
            }
        });
        return;
    }

    // Дефолтная заглушка
    return sendResponse(200, { status: "success", message: "AIKON proxy active" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Native HTTP Proxy running on port ${PORT}`);
});
