const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Переключаем Express на прием сырого текста, так как AIKON шлет кастомный текстовый формат
app.use(express.text({ type: '*/*' }));

// Настройка заголовков под старые J2ME/Symbian клиенты
app.use((req, res, next) => {
    res.header("Content-Type", "text/plain; charset=utf-8");
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
    
    res.status(200).send(responseBody);
});

// В самом верху файла, где подключаются мидлвари, добавьте поддержку сырых буферов:
app.use(express.raw({ type: '*/*', limit: '1mb' })); 

// ==========================================
// 2. БИНАРНОЕ ЗЕРКАЛО ДЛЯ ЭХО-ТЕСТА (POST /echo)
// Идеально передает любые турецкие символы байт-в-байт
// ==========================================
app.post('/echo', (req, res) => {
    // req.body теперь является сырым бинарным Buffer
    const bufferData = req.body;
    
    console.log(`==> Echo probe received. Size: ${bufferData.length} bytes`);
    
    // Устанавливаем заголовок plain-текста
    res.header("Content-Type", "text/plain; charset=utf-8");
    
    // Отправляем буфер обратно без перекодирования в строку
    res.status(200).send(bufferData);
});



// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    console.log("==> Raw chat request text from Nokia:\n", req.body);

    try {
        const rawLines = (req.body || "").split("\n");
        let userMessage = "";

        // Парсим построчный формат S40/1 вручную
        for (let line of rawLines) {
            if (line.startsWith("prompt:") || line.startsWith("text:")) {
                userMessage = line.substring(line.indexOf(":") + 1).trim();
            }
        }

        // Если это проверочный или пустой запрос, отдаем пустой окей-статус
        if (!userMessage) {
            return res.status(200).send("S40/1\nstatus: ok\n\n");
        }

        // Формируем JSON-запрос к Ollama Cloud API
        const ollamaBody = {
            model: "gemma4:31b",
            messages: [{ role: "user", content: userMessage }],
            stream: false
        };

        const ollamaResponse = await fetch("https://ollama.com", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OLLAMA_API_KEY}`
            },
            body: JSON.stringify(ollamaBody)
        });

        if (!ollamaResponse.ok) {
            const errText = await ollamaResponse.text();
            return res.status(200).send(`S40/1\nstatus: error\n\nOllama Error: ${ollamaResponse.status}`);
        }

        const ollamaData = await ollamaResponse.json();
        const aiResponseText = ollamaData.message?.content || "Ошибка генерации";

        // Отправляем ответ в телефон обратно в текстовом формате S40/1
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

app.listen(PORT, () => console.log(`Pure S40/1 protocol proxy running on port ${PORT}`));
