const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Включаем чтение сырых бинарных данных (Buffer) вместо строк.
// Это на 100% защитит турецкие спецсимволы в /echo от искажения.
app.use(express.raw({ type: '*/*', limit: '1mb' }));

// Глобальные заголовки для совместимости со старыми J2ME/Symbian клиентами
app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health (Строго по протоколу S40/1)
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
// 2. ЭХО-ТЕСТ С ТУРЕЦКИМИ СИМВОЛАМИ: POST /echo
// Работает как идеальное зеркало: отдает байты назад один в один
// ==========================================
// ==========================================
// 2. ИСПРАВЛЕННЫЙ ЭХО-ТЕСТ: POST /echo
// Склеивает маркер S40/1 и сырые турецкие байты без искажения кодировки
// ==========================================
app.post('/echo', (req, res) => {
    const rawBuffer = req.body;
    
    // Подготавливаем правильный текстовый заголовок протокола AIKON
    const prefixBuffer = Buffer.from("S40/1\n\n", "utf-8");
    
    let finalResponseBuffer;
    if (rawBuffer && rawBuffer.length > 0) {
        console.log(`==> Echo received ${rawBuffer.length} bytes of Turkish test string`);
        // Безопасно склеиваем заголовок протокола и сырые байты от телефона
        finalResponseBuffer = Buffer.concat([prefixBuffer, rawBuffer]);
    } else {
        console.log("==> Echo received empty body");
        finalResponseBuffer = prefixBuffer;
    }

    // Отправляем готовый буфер обратно в Symbian
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(finalResponseBuffer);
});


// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
        // Так как мы используем express.raw, переводим буфер чата в обычную UTF-8 строку
        const rawText = req.body ? req.body.toString('utf-8') : "";
        console.log("==> Raw chat request text from Nokia:\n", rawText);

        const rawLines = rawText.split("\n");
        let userMessage = "";

        // Построчно парсим кастомный текстовый формат мидлета AIKON
        for (let line of rawLines) {
            if (line.startsWith("prompt:") || line.startsWith("text:")) {
                userMessage = line.substring(line.indexOf(":") + 1).trim();
            }
        }

        // Если это проверочный пустой POST-запрос, просто подтверждаем связь
        if (!userMessage) {
            res.header("Content-Type", "text/plain; charset=utf-8");
            return res.status(200).send("S40/1\nstatus: ok\n\n");
        }

        console.log(`Sending message to Ollama: "${userMessage}"`);

        // Формируем стандартный JSON-запрос к Ollama Cloud API
        const ollamaBody = {
            model: "gemma4:31b",
            messages: [{ role: "user", content: userMessage }],
            stream: false // Отключаем потоковую передачу, Symbian ее не поймет
        };

        const ollamaResponse = await fetch("https://ollama.com", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OLLAMA_API_KEY}`
            },
            body: JSON.stringify(ollamaBody)
        });

        res.header("Content-Type", "text/plain; charset=utf-8");

        if (!ollamaResponse.ok) {
            const errText = await ollamaResponse.text();
            console.error(`Ollama error: ${ollamaResponse.status}`);
            return res.status(200).send(`S40/1\nstatus: error\n\nOllama Error: ${ollamaResponse.status}`);
        }

        const ollamaData = await ollamaResponse.json();
        const aiResponseText = ollamaData.message?.content || "Ошибка генерации";

        // Упаковываем ответ обратно в текстовый протокол S40/1 для Nokia
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
