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

if (!supabaseUrl || !supabaseKey) console.error('❌ .env EKSİK!');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// GLOBAL
let client = null;
let lastQR = null;
let currentSessionData = { sessionName: null, userId: null };

// --- CLIENT ---
function initializeClient() {
    console.log('🔄 WhatsApp Başlatılıyor...');
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => { console.log('🎫 QR Hazır'); lastQR = qr; io.emit('qr', qr); });
    client.on('ready', async () => { 
        console.log('🚀 WhatsApp BAĞLANDI!'); 
        io.emit('ready', { status: 'ready' });
        if (currentSessionData.sessionName) await updateSessionStatus('CONNECTED');
    });
    client.on('authenticated', () => io.emit('ready', { status: 'authenticated' }));
    client.on('disconnected', async () => {
        console.log('⚠️ Koptu');
        if (currentSessionData.sessionName) await updateSessionStatus('DISCONNECTED');
        try { await client.destroy(); } catch(e) {}
        initializeClient();
    });

    // Gelen mesajı kaydet
    client.on('message', async (msg) => {
        if (!currentSessionData.sessionName) return;
        try {
            const { data: session } = await supabase.from('sessions').select('id').eq('session_name', currentSessionData.sessionName).single();
            if (session) await saveMessagesToDb(session.id, [msg]);
        } catch (e) {}
    });

    client.initialize();
}

// YARDIMCI: DB KAYIT (Toplu)
async function saveMessagesToDb(sessionId, messages) {
    if (!messages || messages.length === 0) return;
    
    const messagesToInsert = messages.map(msg => ({
        session_id: sessionId,
        contact_id: msg.from.replace(/\D/g, '') || msg.to.replace(/\D/g, ''),
        whatsapp_id: msg.id._serialized, // Unique ID
        chat_id: msg.from,
        body: msg.body,
        sender: msg.fromMe ? 'me' : 'customer',
        is_outbound: msg.fromMe,
        timestamp: msg.timestamp,
        created_at: new Date(msg.timestamp * 1000)
    }));

    // Hata olsa bile (örn: duplicate key) devam et
    const { error } = await supabase.from('messages').upsert(messagesToInsert, { onConflict: 'whatsapp_id' });
    if (error) console.error('DB Insert Error:', error.message);
    else console.log(`💾 ${messages.length} mesaj DB'ye yazıldı/güncellendi.`);
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

// --- GARANTİ GEÇMİŞ ÇEKME ---
app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit = 20, beforeId } = req.body;
    console.log(`📥 Fetch İsteği: ${contactId}, Limit: ${limit}, Cursor: ${beforeId}`);

    try {
        // 1. Session ve WhatsApp ID
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) return res.status(400).json({ error: 'Oturum yok' });

        const whatsappId = contactId.includes('@') ? contactId : `${contactId}@c.us`;

        // 2. WHATSAPP'TAN ZORLA ÇEK (Source of Truth)
        // Veritabanına bakmadan önce WhatsApp'tan taze veri çekip DB'yi güncelliyoruz.
        // Bu sayede "DB'de yoktu, eksikti" derdi kalmıyor.
        if (client && client.info) {
            console.log(`🌍 WhatsApp'a gidiliyor...`);
            const chat = await client.getChatById(whatsappId);
            
            // Cursor varsa onu bul, yoksa son 50 mesajı al
            let fetchOptions = { limit: 50 }; // Default: Son 50 mesaj
            
            if (beforeId) {
                // WWebJS cursor mantığı bazen restart'ta kaybolur.
                // O yüzden cursor bulamazsak "daha çok mesaj çek" diyeceğiz.
                // Bu strateji boşlukları doldurur.
                console.log(`🔍 Cursor (${beforeId}) aranıyor...`);
                // Mesajları tarayıp cursor'u bulmaya çalışmıyoruz, direkt geniş aralık çekiyoruz.
                fetchOptions = { limit: 100 }; 
            }

            const waMessages = await chat.fetchMessages(fetchOptions);
            console.log(`📦 WhatsApp'tan ${waMessages.length} mesaj geldi.`);
            
            // DB'ye Yaz
            await saveMessagesToDb(session.id, waMessages);
        } else {
            console.log('⚠️ WhatsApp bağlı değil, sadece DB kullanılacak.');
        }

        // 3. DB'den Geri Oku (PAGINATION)
        // Artık veriler DB'de güncel, standart sorgumuzu yapabiliriz.
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

        const { data: finalMessages } = await query;

        res.json({ 
            success: true, 
            messages: finalMessages ? finalMessages.reverse() : [],
            source: 'hybrid'
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
    if (!client) return res.json({ success: false });
    const chats = await client.getChats();
    res.json({ success: true, chats: chats.map(c => ({ id: c.id._serialized, name: c.name, phone_number: c.id.user, unread: c.unreadCount }))});
});

initializeClient();

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => console.log(`Sunucu ${PORT} portunda aktif.`));