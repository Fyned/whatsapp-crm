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

// 1. SUPABASE AYARLARI
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('HATA: .env dosyasında SUPABASE_URL veya SUPABASE_KEY eksik!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. EXPRESS & SOCKET
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// 3. WHATSAPP CLIENT (Global Değişken)
let client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let lastQR = null; 

// --- API ENDPOINTLERİ ---

app.get('/', (req, res) => res.send('WhatsApp CRM Backend v5 (Hard Reset)'));

// BU KISIM GÜNCELLENDİ: ZORLA YENİDEN BAŞLATMA
app.post('/start-session', async (req, res) => {
    console.log('>>> Session başlatma isteği geldi (Hard Reset)...');
    
    try {
        // 1. Varsa eski QR'ı temizle
        lastQR = null;
        
        // 2. Client çalışıyorsa zorla durdur
        console.log('Eski client kapatılıyor...');
        try {
            await client.destroy();
        } catch (e) {
            console.log('Kapatma hatası (önemsiz):', e.message);
        }

        // 3. Client'ı sıfırdan oluştur
        client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        // 4. Eventleri tekrar bağla (Çünkü client yeniden oluştu)
        setupClientEvents();

        // 5. Başlat
        console.log('Yeni client başlatılıyor...');
        client.initialize();

        res.json({ status: 'Session initiated', message: 'Oturum sıfırlandı ve başlatılıyor' });

    } catch (error) {
        console.error('Session başlatma hatası:', error);
        res.status(500).json({ error: 'Session başlatılamadı' });
    }
});

// History Endpoint
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

        if (cursor) query = query.lt('created_at', cursor);

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });

        res.json({
            messages: data, 
            nextCursor: data.length === limit ? data[data.length - 1].created_at : null
        });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- CLIENT EVENTLERİNİ AYARLAYAN FONKSİYON ---
function setupClientEvents() {
    client.on('qr', (qr) => {
        console.log('>>> YENİ QR KODU ÜRETİLDİ <<<');
        lastQR = qr;
        io.emit('qr', qr); // Socket'e gönder
    });

    client.on('ready', () => {
        console.log('WhatsApp Hazır!');
        lastQR = null;
        io.emit('ready', { status: 'ready' });
    });

    client.on('authenticated', () => {
        console.log('Giriş Başarılı!');
        lastQR = null;
        io.emit('ready', { status: 'authenticated' });
    });

    client.on('message', async (msg) => {
        console.log('Mesaj:', msg.body);
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
        } catch (e) { console.error(e); }
    });
}

// İlk başlatma
setupClientEvents();
// client.initialize(); // Otomatik başlatmıyoruz, istek gelince başlatacağız.

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Frontend bağlandı:', socket.id);
    if (lastQR) socket.emit('qr', lastQR); // Varsa gönder
});

const PORT = process.env.PORT || 3006;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});