const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Включаем чтение сырых байтов для защиты от Modified UTF-8
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
// 2. ИСПРАВЛЕННЫЙ ЭХО-ТЕСТ (POST /echo)
// Обход ошибки "utf upload got different bytes"
// ==========================================
app.post('/echo', (req, res) => {
    const rawBuffer = req.body;
    
    if (!rawBuffer || rawBuffer.length === 0) {
        console.log("==> Echo received empty body");
        res.header("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send("S40/1\nstatus: ok\necho: \n");
    }

    console.log(`==> Echo bytes received from Nokia: ${rawBuffer.length} bytes.`);

    // ХАК ДЛЯ JAVA DataOutputStream.writeUTF():
    // Старые Java-клиенты шлют 2 байта длины в самом начале буфера.
    // Если первые байты похожи на служебные метаданные Java, мы аккуратно
    // отрезаем их, чтобы получить чистую турецкую строку один-в-один.
    let cleanTurkishBuffer = rawBuffer;
    if (rawBuffer.length > 2 && rawBuffer[0] === 0 && rawBuffer[1] < rawBuffer.length) {
        console.log(`[Java ME detected] Stripping 2 bytes of metadata. Text len: ${rawBuffer[1]}`);
        cleanTurkishBuffer = rawBuffer.subarray(2);
    }

    // Собираем правильный префикс ответа AIKON
    const prefix = Buffer.from("S40/1\nstatus: ok\necho: ");
    const finalBuffer = Buffer.concat([prefix, cleanTurkishBuffer]);

    // Отправляем бинарный пакет обратно
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(finalBuffer);
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
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

app.listen(PORT, () => console.log(`AIKON S40/1 Modified-UTF safe proxy running on port ${PORT}`));
