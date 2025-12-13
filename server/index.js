const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs'); // Dosya sistemi için eklendi
const whatsappManager = require('./src/core/WhatsappManager');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- MEDYA KLASÖRÜNÜ DIŞA AÇ ---
const mediaPath = path.join(__dirname, 'public/media');
if (!fs.existsSync(mediaPath)){
    fs.mkdirSync(mediaPath, { recursive: true });
}
// '/media' adresine gelen istekleri 'public/media' klasöründen sun
app.use('/media', express.static(mediaPath));

whatsappManager.setSocketIO(io);

// --- API ROUTES (Değişmedi) ---
app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName) return res.status(400).json({ error: 'Session ismi gerekli' });
    try {
        await whatsappManager.startSession(sessionName, userId);
        res.json({ success: true, message: 'İstek alındı' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/session-chats', async (req, res) => {
    const { sessionName } = req.query;
    try {
        const chats = await whatsappManager.listChats(sessionName);
        res.json({ success: true, chats });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit, beforeId } = req.body;
    try {
        const result = await whatsappManager.loadHistory(sessionName, contactId, limit, beforeId);
        res.json({ success: true, ...result });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/send-message', async (req, res) => {
    const { sessionName, targetNumber, text } = req.body;
    try {
        await whatsappManager.sendMessage(sessionName, targetNumber, text);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/delete-session', async (req, res) => {
    const { sessionName } = req.body;
    try {
        await whatsappManager.deleteSession(sessionName);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Sunucusu ${PORT} portunda aktif!`);
});