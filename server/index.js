// 1. AYARLAR VE IMPORTLAR
const path = require('path');
// .env dosyasını iki üst dizinden (root) veya mevcut dizinden okumayı dene
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); // Yedek olarak standart konum

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// 2. SUPABASE BAĞLANTISI
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('HATA: .env dosyasında SUPABASE_URL veya SUPABASE_KEY eksik!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 3. EXPRESS VE SOCKET.IO KURULUMU
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// 4. WHATSAPP CLIENT KURULUMU
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// 5. API ENDPOINTLERİ

// Test Endpoint
app.get('/', (req, res) => {
    res.send('WhatsApp CRM Backend Çalışıyor v3');
});

// EKSİK OLAN START SESSION ENDPOINT'İ (DÜZELTİLDİ)
app.post('/start-session', async (req, res) => {
    try {
        console.log('Session başlatma isteği geldi...');
        // Client zaten hazırsa veya başlatılıyorsa
        try {
             // Eğer initialize edilmemişse initialize etmeyi dene
             // Not: whatsapp-web.js'de durumu kontrol etmek biraz trickli olabilir, 
             // en basiti initialize() çağırıp hata verirse yakalamaktır.
             await client.initialize();
        } catch (error) {
            // Zaten initialize edilmiş olabilir, devam et.
            console.log('Client zaten initialize edilmiş veya bir hata oluştu:', error.message);
        }
        
        res.json({ status: 'Session initated' });
    } catch (error) {
        console.error('Session başlatma hatası:', error);
        res.status(500).json({ error: 'Session başlatılamadı' });
    }
});

// GEÇMİŞ MESAJLARI PARÇA PARÇA GETİREN ENDPOINT (PAGINATION)
app.get('/fetch-history/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const { cursor } = req.query; 
        const limit = 10; 

        let query = supabase
            .from('messages')
            .select('*')
            .eq('chat_id', chatId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (cursor) {
            query = query.lt('created_at', cursor);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Supabase fetch hatası:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({
            messages: data, 
            nextCursor: data.length === limit ? data[data.length - 1].created_at : null
        });

    } catch (err) {
        console.error('Sunucu hatası:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 6. WHATSAPP EVENT HANDLERS

// QR Kodu Oluşunca
client.on('qr', (qr) => {
    console.log('QR Kodu alındı');
    // qrcode.generate(qr, { small: true }); // Terminalde görmek istersen aç
    io.emit('qr', qr); 
});

// Hazır Olunca
client.on('ready', () => {
    console.log('WhatsApp İstemcisi Hazır!');
    io.emit('ready', { status: 'ready' });
});

// Authenticated
client.on('authenticated', () => {
    console.log('Giriş başarılı!');
    io.emit('ready', { status: 'authenticated' });
});

// Mesaj Gelince
client.on('message', async (msg) => {
    console.log('Yeni mesaj:', msg.body);
    
    try {
        const { error } = await supabase.from('messages').insert({
            chat_id: msg.from,
            body: msg.body,
            sender: 'customer',
            is_outbound: false,
            media_url: null,
            media_type: msg.type,
            created_at: new Date()
        });

        if (error) console.error('Mesaj kaydetme hatası:', error);
        
        io.emit('new-message', {
            chat_id: msg.from,
            body: msg.body,
            sender: 'customer',
            created_at: new Date()
        });
        
    } catch (e) {
        console.error('Mesaj işleme hatası:', e);
    }
});

// 7. SOCKET.IO BAĞLANTILARI
io.on('connection', (socket) => {
    console.log('Frontend bağlandı:', socket.id);
    socket.on('disconnect', () => {
        console.log('Frontend ayrıldı:', socket.id);
    });
});

// 8. SUNUCUYU BAŞLAT
const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});