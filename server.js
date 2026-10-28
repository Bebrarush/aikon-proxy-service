const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Отключаем глобальные мидлвари, так как каждый эндпоинт AIKON требует свой тип данных
app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    res.header("Connection", "close"); // Избавляет старый стек Symbian от зависаний
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health (Строго текстовый plain-text)
// ==========================================
app.get('/health', (req, res) => {
    console.log("==> Health probe received from Nokia");
    
    // Строгий текстовый формат протокола S40/1 Эмира
    const responseBody = [
        "S40/1",
        "status: ok",
        "server: claude-s40-server",
        "version: 0.9.2",
        "mock: false"
    ].join("\n");
    
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(responseBody);
});

// ==========================================
// 2. ИСТИННЫЙ ЭХО-ТЕСТ: POST /echo (Потоковый бинарный перехват)
// ==========================================
app.post('/echo', (req, res) => {
    let bodyChunks = [];
    
    // Напрямую выгребаем сырые байты из сокета, минуя парсеры Express
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        const rawBuffer = Buffer.concat(bodyChunks);
        console.log(`==> Echo passed. Received and returned ${rawBuffer.length} bytes.`);

        res.header("Content-Type", "text/plain; charset=utf-8");
        res.header("Content-Length", rawBuffer.length);
        
        // Отправляем буфер один-в-один и жестко закрываем поток
        res.status(200).end(rawBuffer);
    });
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', (req, res) => {
    let bodyChunks = [];
    
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    });

    req.on('end', async () => {
        try {
            const rawText = Buffer.concat(bodyChunks).toString('utf-8');
            console.log("==> Raw chat request from Nokia:\n", rawText);
            
            const rawLines = rawText.split("\n");
            let userMessage = "";
            
            for (let line of rawLines) {
                if (line.startsWith("prompt:") || line.startsWith("text:")) {
                    userMessage = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            
            if (!userMessage) {
                res.header("Content-Type", "text/plain; charset=utf-8");
                return res.status(200).send("S40/1\nstatus: ok\n\n");
            }
            
            console.log(`Sending to Ollama Cloud: "${userMessage}"`);
            
            const ollamaResponse = await fetch("https://ollama.com", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gemma4:31b",
                    messages: [{ role: "user", content: userMessage }],
                    stream: false
                })
            });
            
            res.header("Content-Type", "text/plain; charset=utf-8");
            
            if (!ollamaResponse.ok) {
                return res.status(200).send(`S40/1\nstatus: error\n\nOllama API Error`);
            }
            
            const ollamaData = await ollamaResponse.json();
            const aiResponseText = ollamaData.message?.content || "Ошибка генерации";
            
            const nokiaResponse = [
                "S40/1",
                "status: success",
                "",
                aiResponseText
            ].join("\n");
            
            res.status(200).send(nokiaResponse);
            
        } catch (error) {
            console.error("Proxy error:", error);
            res.header("Content-Type", "text/plain; charset=utf-8");
            res.status(200).send(`S40/1\nstatus: error\n\nProxy error: ${error.message}`);
        }
    });
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 Proxy Live on port ${PORT}`));
