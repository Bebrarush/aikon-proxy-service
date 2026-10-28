const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Читаем API-ключ Ollama и ваш кастомный Access Code из переменных окружения Render
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
// Тот самый простой код из букв/цифр, который вы ввели в настройках Nokia
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "BeshenyOllama228"; 

// AIKON отправляет стандартный JSON. Включаем парсинг тела запроса
app.use(express.json());

// Отключаем CORS-ограничения, чтобы старый движок Symbian/Qt не спотыкался
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// ==========================================
// 1. ТЕСТ СВЯЗИ: Эндпоинт верификации сервера (Проверка здоровья)
// ==========================================
app.get('/health', (req, res) => {
    res.status(200).json({
        status: "ok",
        server: "Ollama-AIKON-Proxy",
        version: "0.9.5",
        mock: false
    });
});

// ==========================================
// 2. ЭХО-ТЕСТ: Защита от ошибки "not this server's reply"
// AIKON отправляет POST на /echo и ждет возврата своего же текста обратно
// ==========================================
app.post('/echo', (req, res) => {
    // Возвращаем пришедший JSON в неизменном виде
    res.status(200).json(req.body);
});

// ==========================================
// 3. ОСНОВНОЙ ЧАТ: Обработка запросов к ИИ
// ==========================================
app.post('/v1/chat', async (req, res) => {
    try {
        // Проверяем авторизацию. AIKON шлет токен в заголовке Authorization: Bearer <токен>
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${ACCESS_TOKEN}`) {
            return res.status(403).json({
                status: "error",
                error: 403,
                message: "Forbidden: Invalid Access Code on Nokia"
            });
        }

        const incomingData = req.body;
        // Извлекаем текст. По протоколу AIKON (S40/1) текст лежит в поле .text или .prompt
        const userMessage = incomingData.text || incomingData.prompt || "";

        if (!userMessage || userMessage.trim() === "") {
            return res.status(200).json({
                status: "ok",
                error: 0,
                text: "Привет! Запрос пустой. Напиши что-нибудь."
            });
        }

        // Формируем структуру запроса к официальному Ollama Cloud API
        const ollamaBody = {
            model: "gemma4:31b", // Официальный тег бесплатной Gemma 4
            messages: [
                { role: "user", content: userMessage }
            ],
            stream: false // Symbian S60v5 принципиально не поддерживает потоковый ответ (stream)
        };

        // Отправляем запрос на эндпоинт Ollama Cloud
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
            throw new Error(`Ollama API error: ${ollamaResponse.status} - ${errText}`);
        }

        const ollamaData = await ollamaResponse.json();
        // Извлекаем ответ из структуры Ollama
        const aiText = ollamaData.message?.content || "Не удалось получить ответ от нейросети.";

        // Упаковываем обратно в жесткий формат, который ждет парсер AIKON на Symbian
        res.status(200).json({
            status: "success",
            error: 0,
            text: aiText,
            response: aiText,
            message: aiText
        });

    } catch (error) {
        console.error("Proxy Error:", error);
        // Возвращаем HTTP 200 даже при ошибке, чтобы старый сетевой стек Symbian не "вылетал"
        res.status(200).json({
            status: "error",
            error: 1,
            text: `Ошибка прокси-сервера: ${error.message}`
        });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`AIKON Proxy Server is running on port ${PORT}`);
});
