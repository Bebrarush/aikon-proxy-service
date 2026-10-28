const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Переключаем обратно на текстовый парсер. Никаких бинарных буферов!
app.use(express.text({ type: '*/*' }));

// Настройка заголовков для принудительного текстового UTF-8 режима J2ME/Symbian
app.use((req, res, next) => {
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.header("Cache-Control", "no-store");
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health
// ==========================================
app.get('/health', (req, res) => {
    console.log("==> Health probe from Nokia");
    const responseBody = [
        "S40/1",
        "status: ok",
        "server: claude-s40-server",
        "version: 0.9.2",
        "mock: false"
    ].join("\n");
    
    res.status(200).send(responseBody);
});

// ==========================================
// 2. ТЕКСТОВЫЙ ЭХО-ТЕСТ С СЕРВЕРНЫМ UTF-8: POST /echo
// ==========================================
app.post('/echo', (req, res) => {
    const incomingText = req.body || "";
    console.log("==> Echo raw body text from Nokia:", incomingText);

    // Собираем строго оригинальный текстовый ответ протокола AIKON
    const responseBody = [
        "S40/1",
        "status: ok",
        `echo: ${incomingText.trim()}`
    ].join("\n");

    res.status(200).send(responseBody);
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
        const rawText = req.body || "";
        console.log("==> Raw chat request text from Nokia:\n", rawText);

        const rawLines = rawText.split("\n");
        let userMessage = "";

        // Ищем строку ввода
        for (let line of rawLines) {
            if (line.startsWith("prompt:") || line.startsWith("text:")) {
                userMessage = line.substring(line.indexOf(":") + 1).trim();
            }
        }

        if (!userMessage) {
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

        if (!ollamaResponse.ok) {
            return res.status(200).send(`S40/1\nstatus: error\n\nOllama Error: ${ollamaResponse.status}`);
        }

        const ollamaData = await ollamaResponse.json();
        const aiResponseText = ollamaData.message?.content || "Ошибка генерации";

        // Возвращаем текст ответа в Symbian
        const nokiaResponse = [
            "S40/1",
            "status: success",
            "",
            aiResponseText
        ].join("\n");

        res.status(200).send(nokiaResponse);

    } catch (error) {
        console.error("Proxy error:", error);
        res.status(200).send(`S40/1\nstatus: error\n\nProxy server error: ${error.message}`);
    }
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 safe textual proxy running on port ${PORT}`));
