// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

const app = express();

const upload = multer({ dest: '/tmp/' }); 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "MASUKKAN_KEY_GEMINI_DISINI_JIKA_LOKAL"; 
const BOTCAHX_API_KEY = process.env.BOTCAHX_API_KEY || "XYCoolcraftNihBoss"; 

const dbPath = path.resolve('/tmp/users.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("DB Error:", err.message);
    else console.log('Connected to SQLite at /tmp/');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        firstName TEXT,
        lastName TEXT,
        password TEXT
    )`);
});

app.post('/api/register', async (req, res) => {
    const { username, firstName, lastName, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, firstName, lastName, password) VALUES (?, ?, ?, ?)`, 
            [username, firstName, lastName, hashedPassword], 
            function(err) {
                if (err) return res.status(400).json({ error: "Username sudah ada / Error DB" });
                res.json({ message: "Registrasi berhasil!" });
            }
        );
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.post('/api/login', (req, res) => {
    const { username, password, remember } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: "User tidak ditemukan (Ingat: DB mereset di Vercel)" });
        
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: "Password salah" });

        const maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        res.cookie('user_session', JSON.stringify({ 
            id: user.id, 
            username: user.username, 
            firstName: user.firstName 
        }), { maxAge: maxAge, httpOnly: true });

        res.json({ success: true, user: { firstName: user.firstName } });
    });
});

app.get('/api/me', (req, res) => {
    const cookie = req.cookies.user_session;
    if (cookie) res.json({ loggedIn: true, user: JSON.parse(cookie) });
    else res.json({ loggedIn: false });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('user_session');
    res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
    const { message, model } = req.body;
    let apiUrl = '';

    if (model === 'chatgpt') apiUrl = `https://api.botcahx.eu.org/api/search/openai-chat?text=${encodeURIComponent(message)}&apikey=${BOTCAHX_API_KEY}`;
    if (model === 'bing') apiUrl = `https://api.botcahx.eu.org/api/search/bing-chat?text=${encodeURIComponent(message)}&apikey=${BOTCAHX_API_KEY}`;
    if (model === 'blackbox') apiUrl = `https://api.botcahx.eu.org/api/search/blackbox-chat?text=${encodeURIComponent(message)}&apikey=${BOTCAHX_API_KEY}`;

    try {
        const response = await axios.get(apiUrl, { timeout: 120000 });
        const reply = response.data.message || response.data.result || JSON.stringify(response.data); 
        res.json({ reply });
    } catch (error) {
        res.status(500).json({ error: "Gagal menghubungi AI Server." });
    }
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

function fileToGenerativePart(path, mimeType) {
    return {
      inlineData: {
        data: fs.readFileSync(path).toString("base64"),
        mimeType
      },
    };
}

app.post('/api/gemini', upload.single('file'), async (req, res) => {
    const { message } = req.body;
    const file = req.file;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        let result;
        if (file) {
            const imagePart = fileToGenerativePart(file.path, file.mimetype);
            result = await model.generateContent([message, imagePart]);
            fs.unlinkSync(file.path);
        } else {
            result = await model.generateContent(message);
        }
        const response = await result.response;
        res.json({ reply: response.text() });
    } catch (error) {
        res.status(500).json({ error: "Gemini Error: " + error.message });
    }
});

app.post('/api/image', async (req, res) => {
    const { prompt, model } = req.body; 
    const seed = Math.floor(Math.random() * 1000);
    const safePrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?nologo=true&seed=${seed}&model=${model === 'openai' ? 'flux' : 'turbo'}`;
    setTimeout(() => { res.json({ imageUrl: imageUrl }); }, 1500);
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
