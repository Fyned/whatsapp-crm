const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');

// --- SUPABASE BAĞLANTISI (SERVICE ROLE) ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ HATA: .env anahtarları eksik!');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// --- SUNUCU AYARLARI ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Büyük veri transferi için limit artırıldı

// GLOBAL DEĞİŞKENLER
let client = null;
let lastQR = null;
let currentSessionData = { sessionName: null, userId: null };

// --- WHATSAPP CLIENT ---
function initializeClient() {
    console.log('🔄 WhatsApp Başlatılıyor...');
    
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log('🎫 QR Kodu Hazır');
        lastQR = qr;
        io.emit('qr', qr);
    });

    client.on('ready', async () => {
        console.log('🚀 WhatsApp BAĞLANDI!');
        lastQR = null;
        io.emit('ready', { status: 'ready' });

        if (currentSessionData.sessionName && currentSessionData.userId) {
            await updateSessionStatus('CONNECTED');
        }
    });

    client.on('authenticated', () => {
        io.emit('ready', { status: 'authenticated' });
    });

    client.on('disconnected', async () => {
        console.log('⚠️ Bağlantı Koptu');
        if (currentSessionData.sessionName) await updateSessionStatus('DISCONNECTED');
        lastQR = null;
        try { await client.destroy(); } catch(e) {}
        initializeClient();
    });

    // Gelen Mesajları Anlık Kaydet
    client.on('message', async (msg) => {
        if (!currentSessionData.sessionName) return;
        try {
            // Önce Session ID'yi bul
            const { data: session } = await supabase
                .from('sessions')
                .select('id')
                .eq('session_name', currentSessionData.sessionName)
                .single();
            
            if (session) {
                await supabase.from('messages').insert({
                    session_id: session.id,
                    contact_id: msg.from.replace(/\D/g, ''), // Sadece numara
                    whatsapp_id: msg.from,
                    chat_id: msg.from, // Geriye dönük uyumluluk
                    body: msg.body,
                    sender: msg.fromMe ? 'me' : 'customer',
                    is_outbound: msg.fromMe,
                    timestamp: msg.timestamp,
                    created_at: new Date()
                });
                
                io.emit('new-message', { chat_id: msg.from, body: msg.body });
            }
        } catch (e) { console.error('Mesaj Kayıt Hatası:', e); }
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
    } catch (e) { console.error('DB Update Error:', e); }
}

// --- API ENDPOINTLERİ ---

// 1. OTURUM BAŞLATMA
app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    if (!sessionName || !userId) return res.status(400).json({ error: 'Eksik Bilgi' });

    currentSessionData = { sessionName, userId };
    lastQR = null;

    if (client) {
        try { await client.destroy(); } catch(e) {}
    }
    initializeClient();
    res.json({ success: true });
});

// 2. SOHBET LİSTESİNİ GETİR (MODAL İÇİN)
app.get('/session-chats', async (req, res) => {
    try {
        if (!client || !client.info) {
            return res.status(400).json({ success: false, error: 'WhatsApp bağlı değil' });
        }
        
        const chats = await client.getChats();
        const formattedChats = chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name,
            push_name: chat.name,
            phone_number: chat.id.user,
            unread: chat.unreadCount,
            isGroup: chat.isGroup
        }));

        res.json({ success: true, chats: formattedChats });
    } catch (error) {
        console.error('Chat List Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. SEÇİLEN SOHBETLERİ İÇERİ AKTAR (SYNC) - EN ÖNEMLİ KISIM
app.post('/sync-chats', async (req, res) => {
    const { sessionName, contactIds, perChatLimit = 20 } = req.body;
    console.log(`>>> SYNC İSTEĞİ: ${contactIds?.length} sohbet aktarılacak.`);

    try {
        // 1. Session ID'yi al
        const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('id')
            .eq('session_name', sessionName)
            .single();

        if (sessionError || !sessionData) throw new Error("Oturum veritabanında bulunamadı");
        const sessionId = sessionData.id;

        let processedCount = 0;
        let totalMessages = 0;

        // 2. Seçilen her sohbet için dön
        for (const chatId of contactIds) {
            try {
                const chat = await client.getChatById(chatId);
                const contactNum = chatId.replace(/\D/g, '');

                // A) Kişiyi 'contacts' tablosuna kaydet
                await supabase.from('contacts').upsert({
                    session_id: sessionId,
                    whatsapp_id: chatId,
                    name: chat.name || contactNum,
                    push_name: chat.name,
                    phone_number: contactNum,
                    unread_count: chat.unreadCount,
                    updated_at: new Date()
                }, { onConflict: 'session_id, whatsapp_id' });

                // B) Mesajları Çek
                const messages = await chat.fetchMessages({ limit: perChatLimit });
                
                // C) Mesajları 'messages' tablosuna kaydet
                const messagesToInsert = messages.map(msg => ({
                    session_id: sessionId,
                    contact_id: contactNum,
                    whatsapp_id: chatId,
                    chat_id: chatId, // Frontend uyumu için
                    body: msg.body,
                    sender: msg.fromMe ? 'me' : 'customer',
                    is_outbound: msg.fromMe,
                    timestamp: msg.timestamp,
                    created_at: new Date(msg.timestamp * 1000)
                }));

                if (messagesToInsert.length > 0) {
                    const { error: msgError } = await supabase.from('messages').upsert(messagesToInsert, { onConflict: 'id' }); // ID çakışması varsa güncelle
                    if (!msgError) totalMessages += messagesToInsert.length;
                }
                
                processedCount++;
                console.log(`✅ ${chat.name} aktarıldı. (${messages.length} mesaj)`);

            } catch (err) {
                console.error(`❌ Sohbet hatası (${chatId}):`, err.message);
            }
        }

        res.json({ success: true, processedChats: processedCount, totalMessages });

    } catch (error) {
        console.error('Sync Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. MESAJ GÖNDERME
app.post('/send-message', async (req, res) => {
    const { targetNumber, text } = req.body;
    try {
        const chatId = targetNumber.includes('@') ? targetNumber : `${targetNumber}@c.us`;
        await client.sendMessage(chatId, text);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. GEÇMİŞ ÇEKME (PAGINATION)
app.get('/fetch-history/:chatId', async (req, res) => {
    // ... Standart history kodları ... (Öncekiyle aynı kalabilir veya basitleştirebilirsin)
    // Şimdilik boş döndürelim, yukarıdaki SYNC asıl işi yapıyor.
    res.json({ messages: [] }); 
});

// Başlat
initializeClient();

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda (Sync Modüllü) çalışıyor.`);
});