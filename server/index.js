const path = require('path');
// .env dosyasını garantiye alıyoruz
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');

// --- 1. TEST EDİLMİŞ BAĞLANTI AYARLARI ---
const supabaseUrl = process.env.SUPABASE_URL;
// Test dosyasında çalışan anahtarı kullanıyoruz:
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ KRİTİK HATA: .env dosyasında anahtarlar eksik!');
    // Hata olsa bile sunucuyu çökertmiyoruz, log basıyoruz.
} else {
    console.log('✅ Supabase Bağlantısı Hazır (Service Role)');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// --- 2. SUNUCU AYARLARI ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// GLOBAL DEĞİŞKENLER
let client = null;
let lastQR = null;
// Simülasyon için session verilerini hafızada tutuyoruz
let currentSessionData = { sessionName: null, userId: null };

// --- 3. WHATSAPP MANTIĞI ---
function initializeClient() {
    console.log('🔄 WhatsApp Motoru Başlatılıyor...');
    
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // QR KODU GELDİĞİNDE
    client.on('qr', (qr) => {
        console.log('🎫 QR Kodu Üretildi (Okutma Bekleniyor)');
        lastQR = qr;
        io.emit('qr', qr);
        
        // Opsiyonel: DB'ye QR durumunu yaz (Test amaçlı)
        if (currentSessionData.sessionName) {
            saveToDb('QR_CODE'); 
        }
    });

    // BAĞLANTI SAĞLANDIĞINDA (READY) - KRİTİK NOKTA
    client.on('ready', async () => {
        console.log('🚀 WHATSAPP BAĞLANDI (READY)!');
        lastQR = null;
        io.emit('ready', { status: 'ready' });

        // test-db.js'deki çalışan kodun aynısı:
        if (currentSessionData.sessionName && currentSessionData.userId) {
            console.log(`💾 Veritabanına kayıt atılıyor... [User: ${currentSessionData.userId}]`);
            await saveToDb('CONNECTED');
        } else {
            console.error('❌ HATA: Session verisi hafızada yok! DB güncellenemedi.');
        }
    });

    // GİRİŞ YAPILDIĞINDA
    client.on('authenticated', () => {
        console.log('🔑 Giriş Doğrulandı');
        io.emit('ready', { status: 'authenticated' });
    });

    // BAĞLANTI KOPTUĞUNDA
    client.on('disconnected', async (reason) => {
        console.log('⚠️ Bağlantı Koptu:', reason);
        if (currentSessionData.sessionName) {
            await saveToDb('DISCONNECTED');
        }
        lastQR = null;
        try { await client.destroy(); } catch(e) {}
        // Otomatik yeniden başlatmayı şimdilik kapalı tutalım, manuel başlatsın.
    });

    client.on('message', async (msg) => {
        // Mesaj gelirse kaydet (Basit versiyon)
        try {
            await supabase.from('messages').insert({
                chat_id: msg.from, body: msg.body, sender: 'customer', is_outbound: false, created_at: new Date()
            });
            io.emit('new-message', { chat_id: msg.from, body: msg.body, sender: 'customer', created_at: new Date() });
        } catch (e) {}
    });

    client.initialize();
}

// --- 4. VERİTABANI KAYIT FONKSİYONU (TEST EDİLMİŞ) ---
async function saveToDb(status) {
    try {
        const { data, error } = await supabase.from('sessions').upsert({
            session_name: currentSessionData.sessionName,
            user_id: currentSessionData.userId,
            status: status,
            updated_at: new Date()
        }, { onConflict: 'session_name' }).select();

        if (error) {
            console.error('❌ DB YAZMA HATASI:', error.message);
        } else {
            console.log('✅ DB BAŞARIYLA GÜNCELLENDİ:', status);
            // Frontend'in listeyi yenilemesi için sinyal gönder
            io.emit('session-updated', { sessionName: currentSessionData.sessionName, status });
        }
    } catch (e) {
        console.error('❌ DB Exception:', e);
    }
}

// --- 5. API ENDPOINTLERİ ---

app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    console.log(`\n>>> YENİ İSTEK: /start-session`);
    console.log(`    Session: ${sessionName}`);
    console.log(`    UserID : ${userId}`);

    // KİMLİK KONTROLÜ
    if (!sessionName || !userId) {
        console.error('❌ EKSİK BİLGİ: UserID gelmedi!');
        return res.status(400).json({ error: 'UserID eksik. Tekrar giriş yapın.' });
    }

    // Hafızaya al
    currentSessionData = { sessionName, userId };
    lastQR = null;

    // Temizle ve Başlat
    if (client) {
        console.log('🧹 Eski oturum temizleniyor...');
        try { await client.destroy(); } catch(e) {}
    }

    initializeClient();
    res.json({ success: true, message: 'Başlatılıyor' });
});

app.get('/', (req, res) => res.send('WhatsApp Backend Hazır'));

// History Endpoint
app.get('/fetch-history/:chatId', async (req, res) => {
    // ... (Eski kodun aynısı, history çekmek için)
    const { chatId } = req.params;
    const { data } = await supabase.from('messages').select('*').eq('chat_id', chatId).limit(10);
    res.json({messages: data || []});
});

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Sunucu ${PORT} portunda dinliyor.`);
});