const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Читаем переменные окружения из панели Render.com
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228"; 

// Настройка низкоуровневых заголовков для сетевого стека Symbian S60v5
app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    res.header("Connection", "close"); // Принудительно рвем Keep-Alive, избавляя от зависания "testing..."
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health (Строго по спецификации AIKON)
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
// Железобетонное бинарное слияние префикса и сырого UTF-8 потока
// ==========================================
app.post('/echo', (req, res) => {
    let bodyChunks = [];
    
    // Выгребаем сырые байты из сокета в первозданном виде
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        const rawBuffer = Buffer.concat(bodyChunks);
        console.log(`==> Echo received raw buffer: ${rawBuffer.length} bytes.`);

        // Создаем бинарный маркер протокола, который требует телефон на первой строчке
        const prefixBuffer = Buffer.from("S40/1\nstatus: ok\necho: ", "utf-8");
        
        let finalResponseBuffer;
        
        if (rawBuffer && rawBuffer.length > 0) {
            // СКЛЕИВАЕМ БАЙТЫ: [Префикс протокола] + [Сырые нетронутые байты телефона]
            // Это исключает любую возможность "different bytes" для турецкого текста
            finalResponseBuffer = Buffer.concat([prefixBuffer, rawBuffer]);
        } else {
            console.log("==> Echo received empty body");
            finalResponseBuffer = Buffer.from("S40/1\nstatus: ok\necho: \n", "utf-8");
        }
        
        // Отправляем как plain/text, но в виде готового бинарного массива
        res.header("Content-Type", "text/plain; charset=utf-8");
        res.header("Content-Length", finalResponseBuffer.length);
        res.header("Connection", "close"); // Жестко рвем Keep-Alive
        
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
            // Конвертируем бинарный пакет в текст для отправки в Ollama
            const rawText = Buffer.concat(bodyChunks).toString('utf-8');
            console.log("==> Raw chat request from Nokia:\n", rawText);
            
            const rawLines = rawText.split("\n");
            let userMessage = "";
            
            for (let line of rawLines) {
                if (line.startsWith("prompt:") || line.startsWith("text:")) {
                    userMessage = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            
            // Если запрос пустой или проверочный от телефона
            if (!userMessage) {
                res.header("Content-Type", "text/plain; charset=utf-8");
                return res.status(200).send("S40/1\nstatus: ok\n\n");
            }
            
            console.log(`Sending message to Ollama Cloud: "${userMessage}"`);
            
            // Отправляем структурированный JSON в Ollama API
            const ollamaResponse = await fetch("https://ollama.com", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gemma4:31b",
                    messages: [{ role: "user", content: userMessage }],
                    stream: false // Symbian S60v5 принципиально не поддерживает стриминг чата
                })
            });
            
            res.header("Content-Type", "text/plain; charset=utf-8");
            
            if (!ollamaResponse.ok) {
                console.error("Ollama API Error status:", ollamaResponse.status);
                return res.status(200).send("S40/1\nstatus: error\n\nOllama API Connection Error");
            }
            
            const ollamaData = await ollamaResponse.json();
            const aiResponseText = ollamaData.message?.content || "Ошибка: пустой ответ от ИИ";
            
            // Упаковываем ответ строго в плоский формат S40/1, который ждет клиент AIKON
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

app.listen(PORT, () => console.log(`AIKON Pure S40/1 Safe Proxy running on port ${PORT}`));
