const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// КРИТИЧЕСКИ: Переключаем Express на чтение чистых сырых байтов (Buffer)
// Это спасет турецкие символы в /echo от автоматической порчи со стороны Node.js
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
    res.status(200).send(Buffer.from(responseBody, 'utf-8'));
});

// ==========================================
// 2. ИСТИННЫЙ БИНАРНЫЙ ЭХО-ТЕСТ: POST /echo
// Идеально обходит "character encoding error"
// ==========================================
app.post('/echo', (req, res) => {
    const rawBuffer = req.body; // Чистые, нетронутые байты от телефона (ISO-8859-9)

    console.log(`==> Echo probe received. Size: ${rawBuffer ? rawBuffer.length : 0} bytes.`);

    // Создаем бинарный префикс строго в формате протокола S40/1
    const prefixBuffer = Buffer.from("S40/1\nstatus: ok\necho: ", "utf-8");

    let finalBuffer;
    if (rawBuffer && rawBuffer.length > 0) {
        // Склеиваем байты протокола и оригинальные байты телефона БЕЗ ПЕРЕКОДИРОВАНИЯ В СТРОКИ
        finalBuffer = Buffer.concat([prefixBuffer, rawBuffer]);
    } else {
        finalBuffer = Buffer.concat([prefixBuffer, Buffer.from("\n", "utf-8")]);
    }

    // Возвращаем как поток сырых данных, телефон сам прочитает его в правильной кодировке!
    res.header("Content-Type", "application/octet-stream");
    res.status(200).send(finalBuffer);
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
        // Переводим байты чата в UTF-8 строку для Ollama
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
            return res.status(200).send(Buffer.from("S40/1\nstatus: ok\n\n", 'utf-8'));
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
            return res.status(200).send(Buffer.from(`S40/1\nstatus: error\n\nOllama Error: ${ollamaResponse.status}`, 'utf-8'));
        }

        const ollamaData = await ollamaResponse.json();
        const aiResponseText = ollamaData.message?.content || "Ошибка генерации";

        const nokiaResponse = [
            "S40/1",
            "status: success",
            "",
            aiResponseText
        ].join("\n");

        res.status(200).send(Buffer.from(nokiaResponse, 'utf-8'));

    } catch (error) {
        console.error("Proxy error:", error);
        res.header("Content-Type", "text/plain; charset=utf-8");
        res.status(200).send(Buffer.from(`S40/1\nstatus: error\n\nProxy server error: ${error.message}`, 'utf-8'));
    }
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 safe binary proxy running on port ${PORT}`));
