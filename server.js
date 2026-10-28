const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Читаем API-ключ Ollama и ваш кастомный Access Code из переменных окружения Render
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228"; 

// Глобальные заголовки для совместимости со старыми сетевыми библиотеками Symbian
app.use((req, res, next) => {
    res.header("Cache-Control", "no-store");
    res.header("Connection", "close"); // Принудительно рвем Keep-Alive, чтобы убрать зависания
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health (Строго по протоколу S40/1)
// ==========================================
app.get('/health', (req, res) => {
    console.log("==> Health probe received from Nokia");
    
    // Текстовая структура оригинального бэкенда AIKON
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
// Ручной бинарный перехват сокета и склейка буферов для обхода ошибок кодировки
// ==========================================
app.post('/echo', (req, res) => {
    let bodyChunks = [];
    
    // Напрямую выкачиваем сырые байты из сетевого потока, защищая турецкие символы
    req.on('data', chunk => {
        bodyChunks.push(chunk);
    });

    req.on('end', () => {
        const rawBuffer = Buffer.concat(bodyChunks);
        console.log(`==> Echo successfully received from socket: ${rawBuffer.length} bytes.`);

        // Готовим бинарный префикс протокола, который жестко требует NetworkEngine
        const prefixBuffer = Buffer.from("S40/1\nstatus: ok\necho: ", "utf-8");
        
        let finalResponseBuffer;
        
        if (rawBuffer && rawBuffer.length > 0) {
            // Безопасно склеиваем маркер протокола и турецкие байты один-в-один на уровне байт
            finalResponseBuffer = Buffer.concat([prefixBuffer, rawBuffer]);
        } else {
            console.log("==> Warning: Echo socket stream was empty!");
            finalResponseBuffer = Buffer.from("S40/1\nstatus: ok\necho: \n", "utf-8");
        }
        
        // Отправляем собранный пакет обратно в Symbian
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
            
            // Построчно парсим кастомный текстовый формат мидлета
            for (let line of rawLines) {
                if (line.startsWith("prompt:") || line.startsWith("text:")) {
                    userMessage = line.substring(line.indexOf(":") + 1).trim();
                }
            }
            
            // Если запрос пустой (проверочный от телефона)
            if (!userMessage) {
                res.header("Content-Type", "text/plain; charset=utf-8");
                return res.status(200).send("S40/1\nstatus: ok\n\n");
            }
            
            console.log(`Sending message to Ollama Cloud: "${userMessage}"`);
            
            // Формируем стандартный JSON-запрос к Ollama Cloud API
            const ollamaResponse = await fetch("https://ollama.com", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OLLAMA_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gemma4:31b",
                    messages: [{ role: "user", content: userMessage }],
                    stream: false // Отключаем потоковую передачу, Symbian её не потянет
                })
            });
            
            res.header("Content-Type", "text/plain; charset=utf-8");
            
            if (!ollamaResponse.ok) {
                console.error("Ollama API Error status:", ollamaResponse.status);
                return res.status(200).send("S40/1\nstatus: error\n\nOllama API Connection Error");
            }
            
            const ollamaData = await ollamaResponse.json();
            const aiResponseText = ollamaData.message?.content || "Ошибка: пустой ответ от ИИ";
            
            // Упаковываем ответ обратно в текстовый протокол S40/1 для парсера Nokia
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
