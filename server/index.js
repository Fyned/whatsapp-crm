const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');

// --- AYARLAR ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ HATA: .env eksik!');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// GLOBAL DEĞİŞKENLER
let client = null;
let lastQR = null;
let currentSessionData = { sessionName: null, userId: null };

// --- CLIENT ---
function initializeClient() {
    console.log('🔄 WhatsApp Başlatılıyor...');
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
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
                const contactId = msg.from.replace(/\D/g, '');
                await supabase.from('messages').insert({
                    session_id: session.id,
                    contact_id: contactId,
                    whatsapp_id: msg.from, // Düzeltme: Unique ID
                    chat_id: msg.from,
                    body: msg.body,
                    sender: msg.fromMe ? 'me' : 'customer',
                    is_outbound: msg.fromMe,
                    timestamp: msg.timestamp,
                    created_at: new Date()
                });
                io.emit('new-message', { chat_id: msg.from, body: msg.body });
            }
        } catch (e) { }
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

// --- API ---

app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName || !userId) return res.status(400).json({ error: 'Eksik Bilgi' });
    currentSessionData = { sessionName, userId };
    lastQR = null;
    if (client) { try { await client.destroy(); } catch(e) {} }
    initializeClient();
    res.json({ success: true });
});

app.get('/session-chats', async (req, res) => {
    if (!client || !client.info) return res.status(400).json({ error: 'WhatsApp bağlı değil' });
    const chats = await client.getChats();
    res.json({ success: true, chats: chats.map(c => ({
        id: c.id._serialized, name: c.name, push_name: c.name, phone_number: c.id.user, unread: c.unreadCount
    }))});
});

app.post('/sync-chats', async (req, res) => {
    res.json({ success: true }); // Sync arka planda (Opsiyonel)
});

// --- DÜZELTİLMİŞ HISTORY ENDPOINT (PAGINATION FIX) ---
app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit = 20, beforeId } = req.body;
    
    try {
        // 1. Session ID
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) return res.status(400).json({ error: 'Oturum yok' });

        // 2. Önce DB'den çek
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

        // 3. Yeterliyse dön
        if (dbMessages && dbMessages.length >= limit) {
            return res.json({ success: true, messages: dbMessages.reverse(), source: 'db' });
        }

        // 4. Yetersizse WhatsApp'tan Çek
        console.log(`📥 Geçmiş İndiriliyor: ${contactId}`);
        if (!client || !client.info) return res.json({ success: true, messages: dbMessages ? dbMessages.reverse() : [] });

        const whatsappId = contactId.includes('@') ? contactId : `${contactId}@c.us`;
        const chat = await client.getChatById(whatsappId);
        
        // --- AKILLI FETCH STRATEJİSİ ---
        let fetchOptions = { limit: 50 }; // Standart

        if (beforeId) {
            // Referans mesajı (cursor) cache'te var mı?
            const cursorMsg = chat.messages.find(m => m.id._serialized === beforeId);
            
            if (cursorMsg) {
                console.log("✅ Cursor mesajı cache'te bulundu, ondan öncesi çekiliyor.");
                fetchOptions = { limit: limit, before: cursorMsg };
            } else {
                console.log("⚠️ Cursor mesajı cache'te yok (Restart sonrası), geniş arama yapılıyor...");
                // Eğer cursor yoksa, WWebJS "öncekileri" bulamaz. 
                // Mecburen son 100 mesajı çekip DB'ye basacağız, böylece aradaki boşluk dolar.
                fetchOptions = { limit: 100 }; 
            }
        }

        const waMessages = await chat.fetchMessages(fetchOptions);
        
        // Gelenleri DB'ye Kaydet
        const messagesToInsert = waMessages.map(msg => ({
            session_id: session.id,
            contact_id: contactId,
            whatsapp_id: msg.id._serialized,
            chat_id: msg.from,
            body: msg.body,
            sender: msg.fromMe ? 'me' : 'customer',
            is_outbound: msg.fromMe,
            timestamp: msg.timestamp,
            created_at: new Date(msg.timestamp * 1000)
        }));

        if (messagesToInsert.length > 0) {
            await supabase.from('messages').upsert(messagesToInsert, { onConflict: 'whatsapp_id' });
        }

        // DB'den tekrar çek (Tutarlılık ve sıralama için)
        // Bu sefer limit kısıtlamasını biraz gevşetip cursor ile çekelim
        let finalQuery = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactId)
            .order('timestamp', { ascending: false })
            .limit(limit + 10);
            
        if (beforeId) {
             const { data: refMsg2 } = await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single();
             if (refMsg2) finalQuery = finalQuery.lt('timestamp', refMsg2.timestamp);
        }

        const { data: finalMessages } = await finalQuery;

        res.json({ 
            success: true, 
            messages: finalMessages ? finalMessages.reverse() : [],
            source: 'whatsapp'
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

initializeClient();

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => console.log(`Sunucu ${PORT} portunda aktif.`));