const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Переключаем Express в режим работы с сырыми бинарными буферами (Buffer)
app.use(express.raw({ type: '*/*', limit: '1mb' }));

app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health
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
// 2. БИНАРНОЕ ЗЕРКАЛО ДЛЯ ЭХО-ТЕСТА (POST /echo)
// На 100% убирает "character encoding error"
// ==========================================
app.post('/echo', (req, res) => {
    const rawBuffer = req.body;
    
    if (!rawBuffer || rawBuffer.length === 0) {
        console.log("==> Echo received empty body");
        res.header("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send("");
    }

    console.log(`==> Echo probe triggered. Mirroring ${rawBuffer.length} raw bytes directly back.`);

    // ХАК: Мы просто возвращаем буфер байтов ТЕЛЕФОНУ ОДИН В ОДИН.
    // Телефон получает обратно свои же Modified UTF-8 байты, проверка
    // длины и структуры потока сходится идеально, и мидлет пропускает нас дальше!
    res.header("Content-Type", "application/octet-stream");
    res.status(200).send(rawBuffer);
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
        const rawText = req.body ? req.body.toString('utf-8') : "";
        console.log("==> Raw chat request text from Nokia:\n", rawText);

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

        // Запрос к Ollama Cloud API
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
            return res.status(200).send(`S40/1\nstatus: error\n\nOllama Error: ${ollamaResponse.status}`);
        }

        const ollamaData = await ollamaResponse.json();
        const aiResponseText = ollamaData.message?.content || "Ошибка генерации";

        // Форматируем ответ в понятную Symbian-клиенту структуру S40/1
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
        res.status(200).send(`S40/1\nstatus: error\n\nProxy server error: ${error.message}`);
    }
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 safe proxy running on port ${PORT}`));
