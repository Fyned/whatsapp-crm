const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) console.error('❌ HATA: .env eksik!');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let client = null;
let lastQR = null;
let currentSessionData = { sessionName: null, userId: null };

function initializeClient() {
    console.log('🔄 WhatsApp Başlatılıyor...');
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', (qr) => { lastQR = qr; io.emit('qr', qr); });
    client.on('ready', async () => { 
        console.log('🚀 WhatsApp BAĞLANDI!'); 
        io.emit('ready', { status: 'ready' });
        if (currentSessionData.sessionName) await updateSessionStatus('CONNECTED');
    });
    client.on('authenticated', () => io.emit('ready', { status: 'authenticated' }));
    client.on('disconnected', async () => {
        if (currentSessionData.sessionName) await updateSessionStatus('DISCONNECTED');
        try { await client.destroy(); } catch(e) {}
        initializeClient();
    });

    client.on('message', async (msg) => {
        if (!currentSessionData.sessionName) return;
        try {
            const { data: session } = await supabase.from('sessions').select('id').eq('session_name', currentSessionData.sessionName).single();
            if (session) await saveMessagesToDb(session.id, [msg]);
        } catch (e) {}
    });

    client.initialize();
}

// --- BU FONKSİYON GÜNCELLENDİ (CONTACT FIX) ---
async function saveMessagesToDb(sessionId, messages) {
    if (!messages || messages.length === 0) return;
    
    // 1. Önce bu mesajların sahiplerini (Contacts) oluştur/güncelle
    // Böylece "Foreign Key" hatası almayız.
    for (const msg of messages) {
        const contactNum = msg.from.replace(/\D/g, '') || msg.to.replace(/\D/g, '');
        const contactWid = msg.from.includes('@') ? msg.from : msg.to; // Grup değilse
        
        // Basit bir Upsert (İsim vs. tam çekmek için getContact kullanılabilir ama şimdilik ID yetiyor)
        await supabase.from('contacts').upsert({
            session_id: sessionId,
            whatsapp_id: contactWid,
            phone_number: contactNum,
            name: contactNum, // İsim yoksa numara yaz
            updated_at: new Date()
        }, { onConflict: 'session_id, whatsapp_id' });
    }

    // 2. Şimdi Mesajları Kaydet
    const messagesToInsert = messages.map(msg => ({
        session_id: sessionId,
        contact_id: msg.from.replace(/\D/g, '') || msg.to.replace(/\D/g, ''),
        whatsapp_id: msg.id._serialized,
        chat_id: msg.from,
        body: msg.body,
        sender: msg.fromMe ? 'me' : 'customer',
        is_outbound: msg.fromMe,
        timestamp: msg.timestamp,
        created_at: new Date(msg.timestamp * 1000)
    }));

    const { error } = await supabase.from('messages').upsert(messagesToInsert, { onConflict: 'whatsapp_id' });
    if (error) console.error('DB Insert Error:', error.message);
}

async function updateSessionStatus(status) {
    try {
        await supabase.from('sessions').upsert({
            session_name: currentSessionData.sessionName,
            user_id: currentSessionData.userId,
            status: status,
            updated_at: new Date()
        }, { onConflict: 'session_name' });
    } catch (e) {}
}

app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName || !userId) return res.status(400).json({ error: 'Eksik Bilgi' });
    currentSessionData = { sessionName, userId };
    if (client) { try { await client.destroy(); } catch(e) {} }
    initializeClient();
    res.json({ success: true });
});

app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit = 20, beforeId } = req.body;
    
    try {
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) return res.status(400).json({ error: 'Oturum yok' });

        // A) DB Kontrol
        let query = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactId)
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (beforeId) {
            const { data: refMsg } = await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single();
            if (refMsg) query = query.lt('timestamp', refMsg.timestamp);
        }

        const { data: dbMessages } = await query;
        if (dbMessages && dbMessages.length >= limit) {
            return res.json({ success: true, messages: dbMessages.reverse(), source: 'db' });
        }

        // B) WhatsApp Sync
        if (client && client.info) {
            const chatId = contactId.includes('@') ? contactId : `${contactId}@c.us`;
            const chat = await client.getChatById(chatId);
            
            let fetchCount = beforeId ? 100 : 50;
            const waMessages = await chat.fetchMessages({ limit: fetchCount });
            
            await saveMessagesToDb(session.id, waMessages); // Buradaki yeni save fonksiyonu hatayı önleyecek
        }

        // C) Final DB Çekimi
        let finalQuery = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactId)
            .order('timestamp', { ascending: false })
            .limit(limit);
            
        if (beforeId) {
             const { data: refMsg2 } = await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single();
             if (refMsg2) finalQuery = finalQuery.lt('timestamp', refMsg2.timestamp);
        }

        const { data: finalMessages } = await finalQuery;
        res.json({ success: true, messages: finalMessages ? finalMessages.reverse() : [] });

    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/send-message', async (req, res) => {
    try {
        const { targetNumber, text } = req.body;
        const chatId = targetNumber.includes('@') ? targetNumber : `${targetNumber}@c.us`;
        await client.sendMessage(chatId, text);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/session-chats', async (req, res) => {
    if (!client) return res.json({ success: false });
    const chats = await client.getChats();
    res.json({ success: true, chats: chats.map(c => ({ id: c.id._serialized, name: c.name, phone_number: c.id.user, unread: c.unreadCount }))});
});

initializeClient();
const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => console.log(`Sunucu ${PORT} portunda aktif.`));