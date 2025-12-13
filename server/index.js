const path = require('path');
// .env dosyasını doğru yerden oku
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const whatsappManager = require('./src/core/WhatsappManager');
const supabase = require('./src/db'); // Veritabanı bağlantısını buraya da ekledik

const app = express();
const server = http.createServer(app);

// CORS Ayarları
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
app.use('/media', express.static(mediaPath));

// Socket.io'yu Manager'a tanıt
whatsappManager.setSocketIO(io);

// --- API ROUTES ---

// 1. Oturum Başlat
app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName) return res.status(400).json({ error: 'Session ismi gerekli' });
    try {
        await whatsappManager.startSession(sessionName, userId);
        res.json({ success: true, message: 'İstek alındı' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 2. Sohbetleri Getir
app.get('/session-chats', async (req, res) => {
    const { sessionName } = req.query;
    try {
        const chats = await whatsappManager.listChats(sessionName);
        res.json({ success: true, chats });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 3. Mesaj Geçmişini Getir
app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit, beforeId } = req.body;
    try {
        const result = await whatsappManager.loadHistory(sessionName, contactId, limit, beforeId);
        res.json({ success: true, ...result });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Mesaj Gönder
app.post('/send-message', async (req, res) => {
    const { sessionName, targetNumber, text } = req.body;
    try {
        await whatsappManager.sendMessage(sessionName, targetNumber, text);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. Oturumu Sil
app.post('/delete-session', async (req, res) => {
    const { sessionName } = req.body;
    try {
        await whatsappManager.deleteSession(sessionName);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 6. Kişi Bilgilerini Güncelle (CRM - YENİ EKLENDİ)
app.post('/update-contact', async (req, res) => {
    const { contactId, sessionId, updates } = req.body;
    
    try {
        // Önce Session ID'yi bul
        const { data: session } = await supabase.from('sessions')
            .select('id')
            .eq('session_name', sessionId)
            .single();
            
        if (!session) return res.status(404).json({ error: 'Oturum bulunamadı' });

        // Kişiyi güncelle
        const { error } = await supabase
            .from('contacts')
            .update(updates)
            .eq('session_id', session.id)
            .eq('phone_number', contactId);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// SUNUCUYU BAŞLAT
const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Sunucusu ${PORT} portunda aktif!`);
});