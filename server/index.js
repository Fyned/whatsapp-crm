const path = require('path');
// .env dosyasını doğru yerden oku (server klasörünün bir üstünde)
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const whatsappManager = require('./src/core/WhatsappManager');

const app = express();
const server = http.createServer(app);

// CORS Ayarları (Tüm portlardan gelen isteklere izin ver)
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Socket.io'yu Manager'a tanıt (QR kodları ve durum güncellemeleri için)
whatsappManager.setSocketIO(io);

// --- API ENDPOINTLERİ ---

// 1. Yeni Oturum Başlatma (QR Oluşturur)
app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName) return res.status(400).json({ error: 'Session ismi gerekli' });

    try {
        await whatsappManager.startSession(sessionName, userId);
        res.json({ success: true, message: 'Oturum başlatma isteği alındı' });
    } catch (error) {
        console.error("Start Session Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Sohbet Listesini Getir
app.get('/session-chats', async (req, res) => {
    const { sessionName } = req.query;
    try {
        const chats = await whatsappManager.listChats(sessionName);
        res.json({ success: true, chats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Mesaj Geçmişini Getir
app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit, beforeId } = req.body;
    try {
        const result = await whatsappManager.loadHistory(sessionName, contactId, limit, beforeId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error("Fetch History Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Mesaj Gönder
app.post('/send-message', async (req, res) => {
    const { sessionName, targetNumber, text } = req.body;
    try {
        await whatsappManager.sendMessage(sessionName, targetNumber, text);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Oturumu Sil
app.post('/delete-session', async (req, res) => {
    const { sessionName } = req.body;
    try {
        await whatsappManager.deleteSession(sessionName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Sunucu ${PORT} portunda çalışıyor.`);
});