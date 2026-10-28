const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228"; 

app.use(express.json());

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// 1. Health-check
app.get('/health', (req, res) => {
    res.status(200).json({ status: "ok", server: "Ollama-AIKON-Proxy" });
});

// 2. Логирование и эхо-тест
app.post('/echo', (req, res) => {
    console.log("==> Echo test from Nokia:", req.body);
    res.status(200).json(req.body);
});

// 3. Основной роутинг чата
app.post('/v1/chat', async (req, res) => {
    console.log("==> Incoming requests headers:", req.headers);
    console.log("==> Incoming request body from Nokia:", req.body);

    try {
        const incomingData = req.body;
        // Забираем текст сообщения из любых возможных полей Symbian
        const userMessage = incomingData.text || incomingData.prompt || incomingData.message || "";

        if (!userMessage || userMessage.trim() === "") {
            console.log("Empty message received, sending verification response");
            return res.status(200).json({ status: "ok", error: 0, text: "Connection verified" });
        }

        // Формируем запрос к Ollama
        const ollamaBody = {
            model: "gemma4:31b", 
            messages: [{ role: "user", content: userMessage }],
            stream: false 
        };

        console.log("Sending request to Ollama Cloud...");
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
            console.error(`Ollama Error Status: ${ollamaResponse.status}, Details: ${errText}`);
            // Если Ollama упал, отдаем ошибку текстом в телефон, чтобы не было просто "failed"
            return res.status(200).json({
                status: "error",
                error: 1,
                text: `Ollama API Error: ${ollamaResponse.status}`
            });
        }

        const ollamaData = await ollamaResponse.json();
        console.log("Ollama Raw Response Data:", ollamaData);

        const aiText = ollamaData.message?.content || ollamaData.choices?.[0]?.message?.content || "No response content";
        console.log("Extracted AI Text:", aiText);

        // Отдаем чистую плоскую структуру. Старые клиенты Symbian S60v5 
        // часто ломаются, если в JSON есть лишние вложенные объекты.
        return res.status(200).json({
            text: aiText,
            response: aiText,
            message: aiText,
            status: "ok",
            error: 0
        });

    } catch (error) {
        console.error("Deep Proxy Error:", error);
        return res.status(200).json({
            text: `Server Error: ${error.message}`,
            response: `Server Error: ${error.message}`,
            status: "error",
            error: 1
        });
    }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
