const http = require('http');
const https = require('https');

const OLLAMA_KEY = process.env.OLLAMA_API_KEY; 

const server = http.createServer((req, res) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // 1. РОУТ /health — Проверка версии и статуса сервера
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, corsHeaders);
    return res.end(JSON.stringify({
      server: "aikon",
      version: "0.18.0",
      mock: false,
      tls_version: "TLS 1.0"
    }));
  }

  // 2. КРИТИЧЕСКИЙ РОУТ /echo — Зеркальный ответ (Probe)
  if (req.url === '/echo' && req.method === 'POST') {
    let echoBody = '';
    req.on('data', chunk => { echoBody += chunk.toString(); });
    req.on('end', () => {
      // По протоколу AIKON сервер должен вернуть строго входящий текст один в один
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain; charset=utf-8' // Важно: plain текст или JSON структуры эха
      });
      return res.end(echoBody);
    });
    return;
  }

  // 3. РОУТ СОПРЯЖЕНИЯ /v1/pair/start и /v1/pair/claim
  if (req.url.includes('/v1/pair/')) {
    res.writeHead(200, corsHeaders);
    return res.end(JSON.stringify({
      status: "ok",
      pairing: "success",
      authenticated: true,
      token_valid: true,
      access_token: "BeshenyOllama228",
      token: "BeshenyOllama228",
      user_id: "1",
      credits: 99999
    }));
  }

  // 4. ОСНОВНОЙ РОУТ ЧАТА /v1/chat — Сюда телефон присылает сообщения
  if (req.url === '/v1/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const incomingData = JSON.parse(body || '{}');
        const userMessage = incomingData.text || incomingData.prompt || incomingData.message || "";

        if (!userMessage) {
          res.writeHead(200, corsHeaders);
          return res.end(JSON.stringify({ status: "success" }));
        }

        // Собираем запрос к вашей Gemma в Ollama Cloud
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
              
              // Возвращаем в формате AIKON
              res.writeHead(200, corsHeaders);
              res.end(JSON.stringify({
                status: "success",
                error: null,
                text: aiText,
                response: aiText
              }));
            } catch (e) {
              res.writeHead(200, corsHeaders);
              res.end(JSON.stringify({ status: "error", text: "Ошибка Ollama Cloud" }));
            }
          });
        });
        oReq.write(ollamaData);
        oReq.end();

      } catch (err) {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ status: "error", text: err.message }));
      }
    });
    return;
  }

  // Дефолтный ответ-заглушка на случай других запросов
  res.writeHead(200, corsHeaders);
  res.end(JSON.stringify({ status: "success", message: "AIKON proxy backend is running" }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server matches AIKON protocol on port ${PORT}`); });
