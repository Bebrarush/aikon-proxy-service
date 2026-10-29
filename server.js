const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const REAL_OLLAMA_KEY = process.env.OLLAMA_API_KEY || ''; // Берем настоящий ключ для Ollama Cloud
const CLIENT_SECRET = process.env.ACCESS_TOKEN || 'BeshenyOllama228'; // Наш пароль для клиента

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

    // 1. Эндпоинты сопряжения (pairing)
    if (req.url.includes('/pair')) {
        const payload = "S40/1\nstatus: ok\ncode: 123456\n\n";
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 2. Список моделей (/models или /v1/models)
    if (req.url.includes('/models')) {
        const bodyData = "gemma4:31b\tGemma 4 31B\t0\t0\tOpenAI\n";
        const payload = "S40/1\nstatus: ok\n\n" + bodyData;
        const buffer = Buffer.from(payload, 'utf-8');
        setHeaders(200, 'text/plain; charset=utf-8', buffer.length);
        return res.end(buffer);
    }

    // 3. Основной чат (/v1/chat или /chat)
    if (req.url.includes('/chat') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                console.log("RAW CHAT BODY FROM NOKIA:", JSON.stringify(body));
                
                let userMessage = "";
                const lines = body.split("\n");
                for (let line of lines) {
                    const lower = line.toLowerCase();
                    if (lower.startsWith("prompt:") || lower.startsWith("text:") || lower.startsWith("message:") || lower.startsWith("content:")) {
                        userMessage = line.substring(line.indexOf(":") + 1).trim();
                    }
                }

                if (!userMessage) {
                    try {
                        const json = JSON.parse(body);
                        userMessage = json.text || json.prompt || json.message || json.content || '';
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
                            console.log("OLLAMA RESPONSE:", oBody);
                            const resJson = JSON.parse(oBody);
                            const aiText = resJson.message?.content || resJson.response || "Нет ответа от модели.";
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
        return;
    }

    // Дефолтный ответ
    const defBuf = Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8');
    setHeaders(200, 'text/plain; charset=utf-8', defBuf.length);
    res.end(defBuf);
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
