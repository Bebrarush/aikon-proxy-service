const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Переключаем Express в режим работы с сырыми бинарными буферами (Buffer)
// Это на 100% защитит турецкие спецсимволы в /echo от искажения
app.use(express.raw({ type: '*/*', limit: '1mb' }));

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
// ==========================================
// 2. ВСЕЯДНЫЙ ЭХО-ТЕСТ: POST /echo
// Строго по спецификации Эмира (чистый UTF-8 возврат)
// ==========================================
app.post('/echo', (req, res) => {
    // Если express.raw() не смог распарсить тело из-за заголовков Java,
    // мы принудительно собираем сырые данные прямо из потока запроса
    let bodyChunks = [];
    
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        const rawBuffer = Buffer.concat(bodyChunks);
        const echoedText = rawBuffer.toString('utf-8');
        
        console.log(`==> Echo received text: "${echoedText}" (Length: ${rawBuffer.length} bytes)`);

        // По спецификации AIKON: возвращаем строго тот же текст, один-в-один
        res.header("Content-Type", "text/plain; charset=utf-8");
        res.header("Content-Length", rawBuffer.length);
        res.status(200).send(rawBuffer);
    });
});


// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
        // Переводим байты чата в UTF-8 строку для отправки в Ollama
        const rawText = req.body ? req.body.toString('utf-8') : "";
        console.log("==> Raw chat request from Nokia:\n", rawText);
        
        const rawLines = rawText.split("\n");
        let userMessage = "";
        
        // Построчно парсим кастомный текстовый формат мидлета AIKON
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
        
        // Запрос к Ollama Cloud API (Стриминг отключен, Symbian его не поймет)
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
            return res.status(200).send(`S40/1\nstatus: error\n\nOllama API Error`);
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

app.listen(PORT, () => console.log(`AIKON Safe Proxy running on port ${PORT}`));
