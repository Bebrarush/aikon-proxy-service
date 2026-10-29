const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// Глобальные заголовки для совместимости со старыми сетевыми библиотеками Symbian
app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    res.header("Connection", "close"); // Принудительно рвем Keep-Alive
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
// 2. ИСТИННЫЙ ЭХО-ТЕСТ: POST /echo 
// Исправлено: чистый UTF-8 без искажения турецких символов
// ==========================================
app.post('/echo', (req, res) => {
    let bodyChunks = [];
    
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        const rawBuffer = Buffer.concat(bodyChunks);
        
        // Читаем входящие байты строго как UTF-8, чтобы корректно принять турецкие символы
        const incomingText = rawBuffer.toString('utf-8');
        console.log(`==> Echo received: ${rawBuffer.length} bytes from Nokia.`);

        const responseText = [
            "S40/1",
            "status: ok",
            `echo: ${incomingText}`
        ].join("\n");

        // Упаковываем ответ обратно в Buffer с UTF-8 кодировкой
        const finalResponseBuffer = Buffer.from(responseText, 'utf-8');
        
        res.header("Content-Type", "text/plain; charset=utf-8");
        res.header("Content-Length", finalResponseBuffer.length);
        
        res.status(200).send(finalResponseBuffer);
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
            const rawText = Buffer.concat(bodyChunks).toString('utf-8');
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
            
            console.log(`Sending message to Ollama Cloud: "${userMessage}"`);
            
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
                console.error("Ollama API Error status:", ollamaResponse.status);
                return res.status(200).send("S40/1\nstatus: error\n\nOllama API Connection Error");
            }
            
            const ollamaData = await ollamaResponse.json();
            const aiResponseText = ollamaData.message?.content || "Ошибка: пустой ответ от ИИ";
            
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

app.listen(PORT, () => console.log(`AIKON Pure S40/1 UTF-8 Proxy running on port ${PORT}`));
