const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Настройки заголовков для старого сетевого стека Symbian
app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    res.header("Connection", "close"); // Разрывает Keep-Alive, предотвращая зависание
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health (Строго plain-text)
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
// Точечно включаем express.raw() прямо в параметрах роута
// ==========================================
app.post('/echo', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    // Теперь req.body ГАРАНТИРОВАННО является сырым бинарным Buffer с турецким текстом
    const rawBuffer = req.body; 
    
    if (!rawBuffer || rawBuffer.length === 0) {
        console.log("==> Echo received empty body via Express parser");
        res.header("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send("");
    }
    
    console.log(`==> Echo success! Returned exactly ${rawBuffer.length} bytes to Nokia.`);

    // Отдаем буфер байт-в-байт без перекодирования в строку JavaScript
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.header("Content-Length", rawBuffer.length);
    
    res.status(200).send(rawBuffer);
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    try {
        const rawBuffer = req.body;
        const rawText = rawBuffer ? rawBuffer.toString('utf-8') : "";
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
            return res.status(200).send("S40/1\nstatus: error\n\nOllama API Error");
        }
        
        const ollamaData = await ollamaResponse.json();
        const aiResponseText = ollamaData.message?.content || "Ошибка генерации";
        
        const nokiaResponse = [
            "S40/1",
            "status: success",
            `text: ${aiResponseText}`,
            "",
            aiResponseText
        ].join("\n");
        
        res.status(200).send(nokiaResponse);
        
    } catch (error) {
        console.error("Proxy error:", error);
        res.header("Content-Type", "text/plain; charset=utf-8");
        res.status(200).send(`S40/1\nstatus: error\n\nProxy crash: ${error.message}`);
    }
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 Stable Proxy Live on port ${PORT}`));
