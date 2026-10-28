const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Переключаем сервер в режим работы с сырыми байтами (Buffer).
// Никакого автоматического перевода в строки во время приема!
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
// 2. ИДЕАЛЬНЫЙ БИНАРНЫЙ ЭХО-ТЕСТ: POST /echo
// Защита от "character encoding error". Собирает ответ побайтово!
// ==========================================
app.post('/echo', (req, res) => {
    const rawBuffer = req.body; // Это чистые байты, присланные Nokia
    
    // Создаем бинарные префиксы
    const prefix = Buffer.from("S40/1\nstatus: ok\necho: ");
    
    let finalBuffer;
    if (rawBuffer && rawBuffer.length > 0) {
        console.log(`==> Echo received ${rawBuffer.length} bytes of raw Turkish symbols.`);
        // Склеиваем байты заголовка и байты турецкого текста ОДИН-В-ОДИН
        finalBuffer = Buffer.concat([prefix, rawBuffer]);
    } else {
        console.log("==> Echo received empty body");
        finalBuffer = Buffer.from("S40/1\nstatus: ok\necho: \n");
    }

    // Отдаем бинарный массив обратно. Node.js не сможет изменить кодировку турецких букв!
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(finalBuffer);
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
        // Переводим байты чата в UTF-8 строку (для Ollama нам нужен текст)
        const rawText = req.body ? req.body.toString('utf-8') : "";
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
            return res.status(200).send(`S40/1\nstatus: error\n\nOllama Error: ${ollamaResponse.status}`);
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
        res.status(200).send(`S40/1\nstatus: error\n\nProxy server error: ${error.message}`);
    }
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 encoding-safe proxy running on port ${PORT}`));
