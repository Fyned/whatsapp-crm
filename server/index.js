const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');

// --- SUPABASE & SERVER ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) console.error('❌ HATA: .env eksik!');

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// GLOBAL
let client = null;
let lastQR = null;
let currentSessionData = { sessionName: null, userId: null };

// --- CLIENT SETUP ---
function initializeClient() {
    console.log('🔄 WhatsApp Başlatılıyor...');
    
    // Puppeteer ayarlarını güçlendirdik
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    client.on('qr', (qr) => {
        console.log('🎫 QR Hazır');
        lastQR = qr;
        io.emit('qr', qr);
    });

    client.on('ready', async () => {
        console.log('🚀 WhatsApp BAĞLANDI!');
        io.emit('ready', { status: 'ready' });
        if (currentSessionData.sessionName) await updateSessionStatus('CONNECTED');
    });

    client.on('authenticated', () => io.emit('ready', { status: 'authenticated' }));
    
    client.on('disconnected', async () => {
        console.log('⚠️ Bağlantı Koptu');
        if (currentSessionData.sessionName) await updateSessionStatus('DISCONNECTED');
        try { await client.destroy(); } catch(e) {}
        initializeClient();
    });

    client.on('message', async (msg) => {
        if (!currentSessionData.sessionName) return;
        try {
            const { data: session } = await supabase.from('sessions').select('id').eq('session_name', currentSessionData.sessionName).single();
            if (session) {
                await saveMessagesToDb(session.id, [msg]);
                io.emit('new-message', { chat_id: msg.from, body: msg.body });
            }
        } catch (e) {}
    });

    client.initialize();
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

// Mesajları DB'ye kaydeden yardımcı fonksiyon
async function saveMessagesToDb(sessionId, messages) {
    if (!messages.length) return;
    
    const messagesToInsert = messages.map(msg => ({
        session_id: sessionId,
        contact_id: msg.from.replace(/\D/g, '') || msg.to.replace(/\D/g, ''), // Hem gelen hem giden için numara
        whatsapp_id: msg.id._serialized,
        chat_id: msg.from, 
        body: msg.body,
        sender: msg.fromMe ? 'me' : 'customer',
        is_outbound: msg.fromMe,
        timestamp: msg.timestamp,
        created_at: new Date(msg.timestamp * 1000)
    }));

    // ID çakışması varsa güncelleme yapma (ignore)
    const { error } = await supabase.from('messages').upsert(messagesToInsert, { onConflict: 'whatsapp_id' });
    if (error) console.error('DB Insert Error:', error.message);
}

// --- API ENDPOINTLERİ ---

app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName || !userId) return res.status(400).json({ error: 'Eksik Bilgi' });
    currentSessionData = { sessionName, userId };
    lastQR = null;
    if (client) { try { await client.destroy(); } catch(e) {} }
    initializeClient();
    res.json({ success: true });
});

// --- GARANTİLİ GEÇMİŞ İNDİRME ---
app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit = 20, beforeId } = req.body;
    console.log(`📥 Geçmiş İsteği: ${contactId}, Limit: ${limit}, Cursor: ${beforeId || 'Yok'}`);

    try {
        // 1. Session ID
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) return res.status(400).json({ error: 'Oturum yok' });

        // 2. Önce DB'den çek
        let query = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactId)
            .order('timestamp', { ascending: false }) // En yeni -> En eski
            .limit(limit);

        if (beforeId) {
            const { data: refMsg } = await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single();
            if (refMsg) query = query.lt('timestamp', refMsg.timestamp);
        }

        const { data: dbMessages } = await query;

        // 3. Eğer DB'de yeterli veri varsa, WhatsApp'a gitme
        if (dbMessages && dbMessages.length >= limit) {
            console.log(`✅ DB'den ${dbMessages.length} mesaj döndü.`);
            return res.json({ success: true, messages: dbMessages.reverse(), source: 'db' });
        }

        // 4. DB yetersiz, WhatsApp'tan ZORLA çek
        if (!client || !client.info) return res.json({ success: true, messages: dbMessages ? dbMessages.reverse() : [] });

        const chatId = contactId.includes('@') ? contactId : `${contactId}@c.us`;
        const chat = await client.getChatById(chatId);

        // KADEMELİ FETCH STRATEJİSİ:
        // Eğer cursor varsa ama WWebJS bulamıyorsa, "öncekileri" getiremez.
        // Bu yüzden "son X mesajı" getir diyerek aralığı genişletiyoruz.
        // Örneğin: Önce 50 çek, yetmediyse 200 çek, yetmediyse 500 çek.
        
        let fetchCount = 50;
        if (beforeId) fetchCount = 200; // Eğer geçmişe gidiyorsak daha büyük parça al
        
        console.log(`🌍 WhatsApp'tan son ${fetchCount} mesaj çekiliyor...`);
        const waMessages = await chat.fetchMessages({ limit: fetchCount });

        // DB'ye Kaydet
        await saveMessagesToDb(session.id, waMessages);

        // Tekrar DB'den Sorgula (Artık veriler DB'de olmalı)
        // Cursor mantığını koruyarak tekrar sorguluyoruz
        let finalQuery = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactId)
            .order('timestamp', { ascending: false })
            .limit(limit); // Frontend ne kadar istediyse o kadar dön

        if (beforeId) {
             const { data: refMsg2 } = await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single();
             if (refMsg2) finalQuery = finalQuery.lt('timestamp', refMsg2.timestamp);
        }

        const { data: finalMessages } = await finalQuery;

        console.log(`✅ WhatsApp sync sonrası ${finalMessages?.length} mesaj dönüyor.`);
        
        res.json({ 
            success: true, 
            messages: finalMessages ? finalMessages.reverse() : [],
            source: 'whatsapp_sync'
        });

    } catch (error) {
        console.error('Fetch Error:', error);
        res.status(500).json({ error: error.message });
    }
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
    try {
        if (!client) return res.json({ success: false });
        const chats = await client.getChats();
        res.json({ success: true, chats: chats.map(c => ({
            id: c.id._serialized, name: c.name, phone_number: c.id.user, unread: c.unreadCount
        }))});
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/sync-chats', async(req,res) => res.json({success:true})); // Placeholder

initializeClient();

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => console.log(`Sunucu ${PORT} portunda aktif.`));