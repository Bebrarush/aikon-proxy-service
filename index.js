const http = require('http');
const https = require('https');

// Извлекаем токен Ollama из настроек сервера
const OLLAMA_KEY = process.env.OLLAMA_API_KEY; 

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Ответ для проверки сопряжения телефона (Pairing)
  if (req.method === 'GET' || req.url.includes('pair')) {
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: "success", error: null, code: 0,
      authenticated: true, token_valid: true, pairing: "success",
      credits: 99999, models: ["gemma4:31b"]
    }));
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const incomingData = JSON.parse(body || '{}');
        const userMessage = incomingData.text || incomingData.prompt || incomingData.query || "";

        if (!userMessage) {
          res.writeHead(200);
          return res.end(JSON.stringify({ status: "success", pairing: "success", credits: 99999 }));
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
              const aiText = resJson.message?.content || "Нет ответа.";
              res.writeHead(200);
              res.end(JSON.stringify({ status: "success", error: null, text: aiText, response: aiText, message: aiText }));
            } catch (e) {
              res.writeHead(200);
              res.end(JSON.stringify({ status: "error", text: "Ошибка парсинга Ollama" }));
            }
          });
        });
        oReq.write(ollamaData);
        oReq.end();

      } catch (err) {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "error", text: err.message }));
      }
    });
  }
});

// Render сам выдает порт через переменную окружения PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Proxy running on port ${PORT}`); });
