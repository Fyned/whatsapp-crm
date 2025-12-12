const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');

// --- KRİTİK AYAR: SERVICE ROLE KEY KULLANIMI ---
const supabaseUrl = process.env.SUPABASE_URL;
// Yazma yetkisi için Service Role Key'i öncelikli kullan
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('HATA: .env dosyasında SUPABASE URL veya KEY eksik!');
    process.exit(1);
}

// Supabase'i başlat
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// Express & Socket
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// Global Değişkenler
let client = null;
let lastQR = null;
let currentSessionData = { sessionName: null, userId: null };

// --- CLIENT HAZIRLAMA FONKSİYONU ---
function initializeClient() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // 1. QR Kodu Geldiğinde
    client.on('qr', (qr) => {
        console.log('>>> QR KODU OLUŞTU');
        lastQR = qr;
        io.emit('qr', qr);
    });

    // 2. Bağlantı Sağlandığında (EN ÖNEMLİ KISIM)
    client.on('ready', async () => {
        console.log('>>> WHATSAPP BAĞLANDI (READY)');
        lastQR = null;
        io.emit('ready', { status: 'ready' });

        // Veritabanına Yaz
        if (currentSessionData.sessionName && currentSessionData.userId) {
            console.log(`>>> DB KAYDI BAŞLIYOR: ${currentSessionData.sessionName}`);
            
            const { error } = await supabase.from('sessions').upsert({
                session_name: currentSessionData.sessionName,
                user_id: currentSessionData.userId,
                status: 'CONNECTED',
                updated_at: new Date()
            }, { onConflict: 'session_name' });

            if (error) {
                console.error('!!! DB KAYIT HATASI !!!', error);
            } else {
                console.log('>>> DB KAYDI BAŞARILI: CONNECTED');
            }
        } else {
            console.error('!!! HATA: Session verisi eksik, DB ye yazılamadı !!!', currentSessionData);
        }
    });

    // 3. Giriş Yapıldığında
    client.on('authenticated', () => {
        console.log('>>> Giriş Doğrulandı');
        io.emit('ready', { status: 'authenticated' });
    });

    // 4. Bağlantı Koptuğunda
    client.on('disconnected', async (reason) => {
        console.log('>>> Bağlantı Koptu:', reason);
        
        if (currentSessionData.sessionName) {
            await supabase.from('sessions').update({ status: 'DISCONNECTED' })
                .eq('session_name', currentSessionData.sessionName);
        }
        
        // Yeniden başlatmaya hazırla
        lastQR = null;
        client.destroy();
        initializeClient(); 
    });
    
    // Mesaj dinleme vb. buraya eklenebilir...
    client.initialize();
}

// --- API ENDPOINTLERİ ---

app.get('/', (req, res) => res.send('WhatsApp Backend v7 (Final Fix)'));

app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    console.log(`>>> İSTEK GELDİ: ${sessionName}, UserID: ${userId}`);

    if (!sessionName || !userId) {
        return res.status(400).json({ error: 'Session Name veya User ID eksik' });
    }

    currentSessionData = { sessionName, userId };
    lastQR = null;

    // Eğer eski client varsa kapat
    if (client) {
        console.log('Eski oturum kapatılıyor...');
        try { await client.destroy(); } catch(e) {}
    }

    // Sıfırdan başlat
    console.log('Yeni oturum başlatılıyor...');
    initializeClient();

    res.json({ success: true, message: 'Başlatılıyor...' });
});

// History Endpoint (Standart)
app.get('/fetch-history/:chatId', async (req, res) => {
    const { chatId } = req.params;
    const { cursor } = req.query;
    let query = supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', {ascending:false}).limit(10);
    if(cursor) query = query.lt('created_at', cursor);
    const { data, error } = await query;
    if(error) return res.status(500).json({error: error.message});
    res.json({messages: data, nextCursor: data.length === 10 ? data[9].created_at : null});
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor. Service Role Aktif.`);
});