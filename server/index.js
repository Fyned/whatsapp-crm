const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');

// 1. SUPABASE (SERVICE ROLE - ADMİN YETKİSİ)
// Not: Veritabanına yazabilmek için Service Role şarttır.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('HATA: .env dosyasında SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik!');
    // Kritik hata ama process'i öldürmeyelim, log basıp devam edelim ki PM2 loop'a girmesin
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// 2. EXPRESS & SOCKET
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
let currentSessionData = { sessionName: null, userId: null };

// --- FONKSİYON: WHATSAPP İSTEMCİSİNİ HAZIRLA ---
function initializeClient() {
    console.log('>>> WhatsApp İstemcisi Başlatılıyor...');
    
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // A) QR Kodu Oluşunca
    client.on('qr', (qr) => {
        console.log('>>> QR KODU OLUŞTU (Tarama Bekleniyor)');
        lastQR = qr;
        io.emit('qr', qr);
        
        // Opsiyonel: DB durumunu güncelle
        if (currentSessionData.sessionName) {
            updateSessionInDb('QR_CODE');
        }
    });

    // B) Bağlantı Sağlanınca (READY)
    client.on('ready', async () => {
        console.log('>>> WHATSAPP BAĞLANDI (READY)!');
        lastQR = null;
        io.emit('ready', { status: 'ready' });

        // VERİTABANINA KAYIT (KİLİT NOKTA BURASI)
        if (currentSessionData.sessionName && currentSessionData.userId) {
            await updateSessionInDb('CONNECTED');
        } else {
            console.error('!!! HATA: Session verisi kayıp, DB güncellenemedi !!!');
        }
    });

    // C) Giriş Yapılınca
    client.on('authenticated', () => {
        console.log('>>> Giriş Doğrulandı');
        io.emit('ready', { status: 'authenticated' });
    });

    // D) Bağlantı Kopunca
    client.on('disconnected', async (reason) => {
        console.log('>>> Bağlantı Koptu:', reason);
        if (currentSessionData.sessionName) {
            await updateSessionInDb('DISCONNECTED');
        }
        // Temizlik ve Yeniden Başlatma
        lastQR = null;
        try { await client.destroy(); } catch(e) {}
        initializeClient(); 
    });

    // E) Mesaj Gelince
    client.on('message', async (msg) => {
        // console.log('Mesaj:', msg.body);
        try {
            await supabase.from('messages').insert({
                chat_id: msg.from,
                body: msg.body,
                sender: 'customer',
                is_outbound: false,
                created_at: new Date()
            });
            io.emit('new-message', {
                chat_id: msg.from,
                body: msg.body,
                sender: 'customer',
                created_at: new Date()
            });
        } catch (e) { 
            // console.error(e); 
        }
    });
    
    client.initialize();
}

// YARDIMCI: DB GÜNCELLEME
async function updateSessionInDb(status) {
    try {
        console.log(`>>> DB Güncelleniyor: ${currentSessionData.sessionName} -> ${status}`);
        
        const { error } = await supabase.from('sessions').upsert({
            session_name: currentSessionData.sessionName,
            user_id: currentSessionData.userId,
            status: status,
            updated_at: new Date()
        }, { onConflict: 'session_name' });

        if (error) {
            console.error('!!! SUPABASE YAZMA HATASI !!!', error.message);
            console.error('Hata Detayı:', error);
        } else {
            console.log('>>> DB Güncelleme BAŞARILI.');
        }
    } catch (e) {
        console.error('DB Exception:', e);
    }
}

// --- API ENDPOINTLERİ ---

app.get('/', (req, res) => res.send('WhatsApp Backend Çalışıyor (Final Version)'));

app.post('/start-session', async (req, res) => {
    const { sessionName, userId } = req.body;
    console.log(`>>> START SESSION İSTEĞİ: İsim=${sessionName}, UserID=${userId}`);

    // KİMLİK KONTROLÜ (ZORUNLU)
    if (!sessionName || !userId) {
        console.error('!!! HATA: Eksik bilgi (UserID veya SessionName yok)');
        return res.status(400).json({ error: 'Kullanıcı kimliği eksik. Lütfen tekrar giriş yapın.' });
    }

    // Bilgileri Hafızaya Al
    currentSessionData = { sessionName, userId };
    lastQR = null;

    // Varsa Eski Client'ı Öldür (Hard Reset)
    if (client) {
        console.log('Eski oturum temizleniyor...');
        try { await client.destroy(); } catch(e) {}
    }

    // Sıfırdan Başlat
    initializeClient();

    res.json({ success: true, message: 'İşlem başlatıldı' });
});

app.get('/fetch-history/:chatId', async (req, res) => {
    const { chatId } = req.params;
    const { cursor } = req.query;
    let query = supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', {ascending:false}).limit(10);
    if(cursor) query = query.lt('created_at', cursor);
    const { data, error } = await query;
    if(error) return res.status(500).json({error: error.message});
    res.json({messages: data, nextCursor: data.length === 10 ? data[9].created_at : null});
});

// Sunucuyu Başlat (İlk açılışta boş bir client hazırlayalım)
initializeClient();

// Socket Bağlantısı
io.on('connection', (socket) => {
    console.log('Frontend bağlandı:', socket.id);
    // Yeni bağlanana varsa QR göster
    if (lastQR) socket.emit('qr', lastQR);
});

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});