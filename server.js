const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Читаем переменные окружения из панели Render.com
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228"; 

// Настройка низкоуровневых заголовков для сетевого стека Symbian S60v5
app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    res.header("Connection", "close"); // Принудительно рвем Keep-Alive, избавляя от зависания "testing..."
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health (Строго по спецификации AIKON)
// ==========================================
app.get('/health', (req, res) => {
    console.log("==> Health probe received from Nokia");
    
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
// 2. ИСТИННЫЙ ЭХО-ТЕСТ: POST /echo 
// Побайтовое зеркало без префиксов. Проходит тесты UTF-8 upload/download
// ==========================================
app.post('/echo', (req, res) => {
    let bodyChunks = [];
    
    // Перехватываем сырой поток байтов напрямую из сокета до любых интерпретаций Node.js
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        const rawBuffer = Buffer.concat(bodyChunks);
        console.log(`==> Echo mirroring exactly: ${rawBuffer.length} bytes for Turkish test string.`);

        // По архитектуре AIKON: отдаем назад ровно те байты, что прислал DataOutputStream.writeUTF()
        // Без префиксов S40/1 и без echo: , чтобы длины upload/download совпали до бита!
        res.header("Content-Type", "text/plain; charset=utf-8");
        res.header("Content-Length", rawBuffer.length);
        
        res.status(200).send(rawBuffer);
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
            // Конвертируем бинарный пакет в текст для отправки в Ollama
            const rawText = Buffer.concat(bodyChunks).toString('utf-8');
            console.log("==> Raw chat request from Nokia:\n", rawText);
            
            const rawLines = rawText.split("\n");
            let userMessage = "";
            
            for (let line of rawLines) {
                if (line.startsWith("prompt:") || line.startsWith("text:")) {
                    userMessage = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            
            // Если запрос пустой или проверочный от телефона
            if (!userMessage) {
                res.header("Content-Type", "text/plain; charset=utf-8");
                return res.status(200).send("S40/1\nstatus: ok\n\n");
            }
            
            console.log(`Sending message to Ollama Cloud: "${userMessage}"`);
            
            // Отправляем структурированный JSON в Ollama API
            const ollamaResponse = await fetch("https://ollama.com", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gemma4:31b",
                    messages: [{ role: "user", content: userMessage }],
                    stream: false // Symbian S60v5 принципиально не поддерживает стриминг чата
                })
            });
            
            res.header("Content-Type", "text/plain; charset=utf-8");
            
            if (!ollamaResponse.ok) {
                console.error("Ollama API Error status:", ollamaResponse.status);
                return res.status(200).send("S40/1\nstatus: error\n\nOllama API Connection Error");
            }
            
            const ollamaData = await ollamaResponse.json();
            const aiResponseText = ollamaData.message?.content || "Ошибка: пустой ответ от ИИ";
            
            // Упаковываем ответ строго в плоский формат S40/1, который ждет клиент AIKON
            const nokiaResponse = [
                "S40/1",
                "status: success",
                `text: ${aiResponseText}`,
                "",
                aiResponseText
            ].join("\n");
            
            console.log("==> Sending AI response text back to Symbian.");
            res.status(200).send(nokiaResponse);
            
        } catch (error) {
            console.error("Proxy error in chat endpoint:", error);
            res.header("Content-Type", "text/plain; charset=utf-8");
            res.status(200).send(`S40/1\nstatus: error\n\nProxy server crash: ${error.message}`);
        }
    });
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 Safe Proxy running on port ${PORT}`));
