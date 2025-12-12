// 1. AYARLAR VE IMPORTLAR
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
require('dotenv').config(); 

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

// GLOBAL DEĞİŞKENLER (QR HAFIZASI)
let lastQR = null; // Son üretilen QR kodunu burada tutacağız
let isClientReady = false;

// 5. API ENDPOINTLERİ

app.get('/', (req, res) => {
    res.send('WhatsApp CRM Backend Çalışıyor v4 (QR Fix)');
});

// START SESSION ENDPOINT'İ (GÜNCELLENDİ)
app.post('/start-session', async (req, res) => {
    try {
        console.log('Session başlatma isteği geldi...');
        
        // Eğer zaten hazırsa hemen bildir
        if (isClientReady) {
            io.emit('ready', { status: 'already-ready' });
            return res.json({ status: 'already-ready', message: 'Client zaten hazır' });
        }

        // Eğer hafızada geçerli bir QR varsa, isteği atana hemen gönder (Tren kaçmasın)
        if (lastQR) {
            console.log('Hafızadaki QR kodu tekrar gönderiliyor...');
            io.emit('qr', lastQR);
        }

        try {
             await client.initialize();
        } catch (error) {
            // "Client already initialized" hatası alırsak sorun yok, devam et
            console.log('Client durumu:', error.message);
        }
        
        res.json({ status: 'Session initiated' });
    } catch (error) {
        console.error('Session başlatma hatası:', error);
        res.status(500).json({ error: 'Session başlatılamadı' });
    }
});

// PAGINATION ENDPOINT
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
            return res.status(500).json({ error: error.message });
        }

        res.json({
            messages: data, 
            nextCursor: data.length === limit ? data[data.length - 1].created_at : null
        });

    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 6. WHATSAPP EVENT HANDLERS

client.on('qr', (qr) => {
    console.log('QR Kodu alındı (Yeni)');
    lastQR = qr; // QR'ı hafızaya kaydet
    isClientReady = false;
    io.emit('qr', qr); 
});

client.on('ready', () => {
    console.log('WhatsApp İstemcisi Hazır!');
    lastQR = null; // Bağlandık, artık QR'a gerek yok
    isClientReady = true;
    io.emit('ready', { status: 'ready' });
});

client.on('authenticated', () => {
    console.log('Giriş başarılı!');
    lastQR = null;
    isClientReady = true;
    io.emit('ready', { status: 'authenticated' });
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp bağlantısı koptu:', reason);
    lastQR = null;
    isClientReady = false;
    // Client'ı temizleyip yeniden başlatmaya hazırla
    client.destroy();
    client.initialize();
});

client.on('message', async (msg) => {
    console.log('Yeni mesaj:', msg.body);
    try {
        const { error } = await supabase.from('messages').insert({
            chat_id: msg.from,
            body: msg.body,
            sender: 'customer',
            is_outbound: false,
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
    
    // Yeni bağlanan kişiye (sayfayı yenileyene) varsa hemen son durumu at
    if (lastQR) {
        socket.emit('qr', lastQR);
    }
    if (isClientReady) {
        socket.emit('ready', { status: 'already-ready' });
    }

    socket.on('disconnect', () => {
        console.log('Frontend ayrıldı:', socket.id);
    });
});

// 8. SUNUCUYU BAŞLAT
const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});