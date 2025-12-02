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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

console.log("-----------------------------------------");
console.log("SERVER STARTING...");
console.log("GEMINI KEY STATUS:", process.env.GEMINI_API_KEY ? "ADA (Loaded)" : "TIDAK ADA (Missing!)");
console.log("-----------------------------------------");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOTCAHX_API_KEY = process.env.BOTCAHX_API_KEY || "XYCoolcraftNihBoss"; 

let db;
try {
    const dbPath = path.resolve('/tmp/users.db');
    db = new sqlite3.Database(dbPath);
    
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            firstName TEXT,
            lastName TEXT,
            password TEXT
        )`, (err) => {
            if(err) console.error("Gagal buat tabel:", err.message);
        });
    });
} catch (error) {
    console.error("Database Error (Abaikan jika fitur chat yang utama):", error);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/login', (req, res) => {
    if(!db) return res.status(500).json({ error: "Database error (Vercel Limit)" });
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) return res.status(400).json({ error: "User tidak ditemukan" });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: "Password salah" });

        res.cookie('user_session', JSON.stringify({ firstName: user.firstName }), { maxAge: 86400000 });
        res.json({ success: true, user: { firstName: user.firstName } });
    });
});

app.post('/api/register', async (req, res) => {
    if(!db) return res.status(500).json({ error: "Database error" });
    const { username, firstName, lastName, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, firstName, lastName, password) VALUES (?, ?, ?, ?)`, 
            [username, firstName, lastName, hashedPassword], 
            function(err) {
                if (err) return res.status(400).json({ error: "Username sudah ada" });
                res.json({ message: "Berhasil" });
            }
        );
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/me', (req, res) => {
    const cookie = req.cookies.user_session;
    if (cookie) {
        try {
            res.json({ loggedIn: true, user: JSON.parse(cookie) });
        } catch(e) { res.json({ loggedIn: false }); }
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('user_session');
    res.json({ success: true });
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
    console.log("Menerima Request Gemini...");
    
    if (!GEMINI_API_KEY) {
        console.error("FATAL: API Key Kosong");
        return res.status(500).json({ error: "API Key Server belum disetting di Vercel!" });
    }

    try {
        const { message } = req.body;
        const file = req.file;

        console.log("Pesan:", message);
        if(file) console.log("File diterima:", file.mimetype);

        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        
        let result;
        if (file) {
            const imagePart = fileToGenerativePart(file.path, file.mimetype);
            result = await model.generateContent([message || "Jelaskan file ini", imagePart]);
            fs.unlinkSync(file.path);
        } else {
            result = await model.generateContent(message);
        }

        const response = await result.response;
        const text = response.text();
        
        console.log("Sukses generate text");
        res.json({ reply: text });

    } catch (error) {
        console.error("GEMINI ERROR FULL:", error);
        
        res.status(500).json({ 
            error: error.message || "Terjadi kesalahan pada Google AI",
            details: error.toString()
        });
    }
});

app.post('/api/chat', async (req, res) => {
    const { message, model } = req.body;
    let apiUrl = '';
    if (model === 'chatgpt') apiUrl = `https://api.botcahx.eu.org/api/search/openai-chat?text=${encodeURIComponent(message)}&apikey=${BOTCAHX_API_KEY}`;
    if (model === 'bing') apiUrl = `https://api.botcahx.eu.org/api/search/bing-chat?text=${encodeURIComponent(message)}&apikey=${BOTCAHX_API_KEY}`;
    if (model === 'blackbox') apiUrl = `https://api.botcahx.eu.org/api/search/blackbox-chat?text=${encodeURIComponent(message)}&apikey=${BOTCAHX_API_KEY}`;

    try {
        const response = await axios.get(apiUrl, { timeout: 60000 });
        const reply = response.data.message || response.data.result || JSON.stringify(response.data); 
        res.json({ reply });
    } catch (error) {
        res.status(500).json({ error: "Gagal menghubungi BotCahx API" });
    }
});

app.post('/api/image', async (req, res) => {
    const { prompt, model } = req.body; 
    const seed = Math.floor(Math.random() * 1000);
    const safePrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?nologo=true&seed=${seed}&model=${model === 'openai' ? 'flux' : 'turbo'}`;
    res.json({ imageUrl: imageUrl });
});

module.exports = app;

if (require.main === module) {
    app.listen(3000, () => console.log('Server running locally on port 3000'));
}
