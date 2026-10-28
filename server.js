const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228";

// Отключаем глобальные мидлвари Express, так как каждый эндпоинт 
// старого мидлета AIKON требует своего уникального разбора данных.
app.use((req, res, next) => {
  res.header("Cache-Control", "no-store");
  res.header("Connection", "close"); // Разрывает Keep-Alive, спасая Symbian от зависания
  next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: GET /health (Строго текстовый plain-text)
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
// 2. ИСТИННЫЙ ЭХО-ТЕСТ: POST /echo (Потоковый бинарный перехват)
// ==========================================
// ==========================================
// 2. ИСПРАВЛЕННЫЙ ЭХО-ТЕСТ: POST /echo 
// Собирает точную структуру S40/1 строго в бинарном виде
// ==========================================
app.post('/echo', (req, res) => {
  let bodyChunks = [];
  
  // Выгребаем турецкие байты от телефона
  req.on('data', chunk => {
    bodyChunks.push(chunk);
  });
  
  req.on('end', () => {
    const rawBuffer = Buffer.concat(bodyChunks);
    
    // Переводим входящий турецкий буфер в строку UTF-8
    const incomingText = rawBuffer.length > 0 ? rawBuffer.toString('utf-8').trim() : "";
    console.log("==> Echo string from Nokia:", incomingText);
    
    // Собираем точную текстовую структуру, которую парсит NetworkEngine.java
    const responseText = [
      "S40/1",
      "status: ok",
      `echo: ${incomingText}`
    ].join("\n");
    
    // Переводим готовый текст в бинарный буфер UTF-8 для отправки
    const finalBuffer = Buffer.from(responseText, "utf-8");
    
    // Отправляем обратно в Symbian
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.header("Content-Length", finalBuffer.length);
    res.header("Connection", "close");
    
    res.status(200).end(finalBuffer);
  });
});


// ==========================================
// 3. ОСНОВНОЙ ЧАТ: POST /v1/chat (Всеядный текстовый формат)
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
      
      // Построчно вытаскиваем текст запроса, который прислал Symbian
      for (let line of rawLines) {
        if (line.startsWith("prompt:") || line.startsWith("text:")) {
          userMessage = line.substring(line.indexOf(":") + 1).trim();
        }
      }
      
      // Если запрос пустой или проверочный от клиента при инициализации чата
      if (!userMessage) {
        res.header("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send("S40/1\nstatus: ok\n\n");
      }
      
      console.log(`Sending to Ollama Cloud: "${userMessage}"`);
      
      // Запрос к Ollama API (Стриминг отключен, так как Symbian его не переварит)
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
        console.error("Ollama returned error status:", ollamaResponse.status);
        return res.status(200).send("S40/1\nstatus: error\n\nOllama Cloud API Error");
      }
      
      const ollamaData = await ollamaResponse.json();
      const aiResponseText = ollamaData.message?.content || "Ошибка: пустой ответ от ИИ";
      
      // ФОРМИРУЕМ СТРОГИЙ ТЕКСТОВЫЙ ОТВЕТ ДЛЯ ВНУТРЕННЕГО ПАРСЕРА NOKIA.
      // Дублируем текст и в плоском виде, и по ключам response/text, 
      // чтобы подойти под регулярное выражение абсолютно любой сборки мидлета AIKON.
      const nokiaResponse = [
        "S40/1",
        "status: success",
        `text: ${aiResponseText}`,
        `response: ${aiResponseText}`,
        "",
        aiResponseText
      ].join("\n");
      
      console.log("==> Sending structured text back to Nokia.");
      res.status(200).send(nokiaResponse);
      
    } catch (error) {
      console.error("Proxy error в чате:", error);
      res.header("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(`S40/1\nstatus: error\n\nProxy server crash: ${error.message}`);
    }
  });
});

app.listen(PORT, () => console.log(`AIKON Pure S40/1 Universal Proxy Live on port ${PORT}`));
