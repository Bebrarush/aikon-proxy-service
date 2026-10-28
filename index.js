const http = require('http');
const https = require('https');

const OLLAMA_KEY = process.env.OLLAMA_API_KEY; 

const server = http.createServer((req, res) => {
  // Базовые заголовки, обязательные для старых Java/Symbian парсеров
  const sendResponse = (statusCode, data, isText = false) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const buffer = Buffer.from(payload, 'utf-8');

    res.writeHead(statusCode, {
      'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Length': buffer.length,
      'Connection': 'close', // Заставляем старый стек закрывать сессию и не виснуть
      'Access-Control-Allow-Origin': '*'
    });
    res.end(buffer);
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST' });
    return res.end();
  }

  // 1. РОУТ /health (Убираем краш приложения)
  if (req.url === '/health') {
    return sendResponse(200, {
      status: "ok",
      server: "aikon",
      version: "0.18.0"
    });
  }

  // 2. РОУТ /echo (Обязательное условие сопряжения)
  if (req.url === '/echo' && req.method === 'POST') {
    let echoBody = '';
    req.on('data', chunk => { echoBody += chunk.toString(); });
    req.on('end', () => {
      return sendResponse(200, echoBody, true);
    });
    return;
  }

  // 3. РОУТЫ СОПРЯЖЕНИЯ
  if (req.url.includes('/v1/pair/')) {
    return sendResponse(200, {
      status: "ok",
      pairing: "success",
      authenticated: true,
      token_valid: true,
      access_token: "BeshenyOllama228",
      credits: 99999,
      models: ["gemma4:31b"]
    });
  }

  // 4. ОТПРАВКА СООБЩЕНИЙ В OLLAMA
  if (req.url === '/v1/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const incomingData = JSON.parse(body || '{}');
        const userMessage = incomingData.text || incomingData.prompt || incomingData.message || "";

        if (!userMessage) {
          return sendResponse(200, { status: "success" });
        }

        const ollamaData = JSON.stringify({
          model: "gemma4:31b",
          messages: [{ role: "user", content: userMessage }],
          stream: false
        });

        const options = {
          hostname: 'ollama.com',
          path: '/api/chat',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OLLAMA_KEY}`
          }
        };

        const oReq = https.request(options, (oRes) => {
          let oBody = '';
          oRes.on('data', c => oBody += c);
          oRes.on('end', () => {
            try {
              const resJson = JSON.parse(oBody);
              const aiText = resJson.message?.content || "Нет ответа от Gemma.";
              
              return sendResponse(200, {
                status: "success",
                error: null,
                text: aiText,
                response: aiText
              });
            } catch (e) {
              return sendResponse(200, { status: "error", text: "Ошибка Ollama Cloud" });
            }
          });
        });
        oReq.write(ollamaData);
        oReq.end();

      } catch (err) {
        return sendResponse(200, { status: "error", text: err.message });
      }
    });
    return;
  }

  // Заглушка
  return sendResponse(200, { status: "success", message: "Proxy active" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Proxy running on port ${PORT}`); });
