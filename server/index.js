const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const whatsappManager = require('./src/core/WhatsappManager');
const supabase = require('./src/db'); 

const app = express();
const server = http.createServer(app);

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Medya Klasörü
const mediaPath = path.join(__dirname, 'public/media');
if (!fs.existsSync(mediaPath)){
    fs.mkdirSync(mediaPath, { recursive: true });
}
app.use('/media', express.static(mediaPath));

whatsappManager.setSocketIO(io);

// --- API ROUTES ---

app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName) return res.status(400).json({ error: 'Session ismi gerekli' });
    try {
        await whatsappManager.startSession(sessionName, userId);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/session-chats', async (req, res) => {
    const { sessionName } = req.query;
    try {
        const chats = await whatsappManager.listChats(sessionName);
        res.json({ success: true, chats });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

app.post('/update-contact', async (req, res) => {
    const { contactId, sessionId, updates } = req.body;
    try {
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionId).single();
        if (!session) return res.status(404).json({ error: 'Oturum bulunamadı' });

        const { error } = await supabase.from('contacts').update(updates).eq('session_id', session.id).eq('phone_number', contactId);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- YENİ EKLENEN: HIZLI YANITLAR (QUICK REPLIES) ---

// 7. Şablonları Getir
app.get('/quick-replies', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('quick_replies')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 8. Şablon Ekle
app.post('/quick-replies', async (req, res) => {
    const { title, message } = req.body;
    try {
        const { error } = await supabase.from('quick_replies').insert([{ title, message }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 9. Şablon Sil
app.post('/delete-quick-reply', async (req, res) => {
    const { id } = req.body;
    try {
        const { error } = await supabase.from('quick_replies').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Sunucusu ${PORT} portunda aktif!`);
});