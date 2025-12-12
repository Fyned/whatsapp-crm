require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const supabase = require('./src/config/supabase');
const whatsappManager = require('./src/core/WhatsappManager');

const app = express();
const port = 3006;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

whatsappManager.setSocketIO(io);

// --- API ROTALARI ---

// 1) Oturum başlatma
app.post('/start-session', async (req, res) => {
    try {
        const { sessionName, userId } = req.body;
        if (!sessionName) {
            return res
                .status(400)
                .json({ success: false, error: 'sessionName gerekli' });
        }

        const { data: existing, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('session_name', sessionName)
            .maybeSingle();

        if (error) {
            console.error(
                'Supabase session sorgu hatası:',
                error.message
            );
            return res
                .status(500)
                .json({ success: false, error: 'Veritabanı hatası' });
        }

        if (!existing) {
            const { error: insertError } = await supabase
                .from('sessions')
                .insert([
                    {
                        session_name: sessionName,
                        status: 'INITIALIZING',
                        user_id: userId || null,
                    },
                ]);

            if (insertError) {
                console.error(
                    'Supabase session insert hatası:',
                    insertError.message
                );
                return res
                    .status(500)
                    .json({ success: false, error: 'Veritabanı hatası' });
            }
        }

        await whatsappManager.startSession(sessionName);
        res.json({ success: true, sessionId: sessionName });
    } catch (err) {
        console.error('start-session hata:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2) Geçmiş çekme (+10 mantığı)
// Frontend limit = mevcut mesaj sayısı + 10
app.post('/fetch-history', async (req, res) => {
    const { sessionName, contactId, limit } = req.body;

    if (!sessionName || !contactId) {
        return res.status(400).json({
            success: false,
            error: 'sessionName ve contactId gerekli',
        });
    }

    try {
        const result = await whatsappManager.loadHistory(
            sessionName,
            contactId,
            limit || 10
        );
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Geçmiş Çekme Hatası:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3) Mesaj gönderme
app.post('/send-message', async (req, res) => {
    const { sessionName, targetNumber, text } = req.body;

    if (!sessionName || !targetNumber || !text) {
        return res.status(400).json({
            success: false,
            error: 'sessionName, targetNumber ve text gerekli',
        });
    }

    try {
        await whatsappManager.sendMessage(sessionName, targetNumber, text);
        res.json({ success: true });
    } catch (err) {
        console.error('Mesaj Gönderme Hatası:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4) Oturum silme
app.post('/delete-session', async (req, res) => {
    const { sessionName } = req.body;
    if (!sessionName) {
        return res
            .status(400)
            .json({ success: false, error: 'sessionName gerekli' });
    }

    const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('session_name', sessionName);

    if (error) {
        console.error('Session silme hatası:', error.message);
        return res
            .status(500)
            .json({ success: false, error: error.message });
    }

    res.json({ success: true });
});

// 5) Aktif sohbetleri WhatsApp'tan listele (ChatList için)
app.get('/session-chats', async (req, res) => {
    const { sessionName } = req.query;
    if (!sessionName) {
        return res
            .status(400)
            .json({ success: false, error: 'sessionName gerekli' });
    }

    try {
        const chats = await whatsappManager.listChats(sessionName);
        res.json({ success: true, chats });
    } catch (err) {
        console.error('session-chats hata:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6) Sync butonu: tüm sohbetleri (veya seçilenleri) senkronize et
app.post('/sync-chats', async (req, res) => {
    const { sessionName, contactIds, perChatLimit } = req.body;

    if (!sessionName) {
        return res
            .status(400)
            .json({ success: false, error: 'sessionName gerekli' });
    }

    try {
        const result = await whatsappManager.syncChats(
            sessionName,
            contactIds || [],
            perChatLimit || 10,
            400
        );
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('sync-chats hata:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SOCKET ---

io.on('connection', (socket) => {
    console.log('Frontend Bağlandı:', socket.id);

    socket.on('join_session', (sessionId) => {
        socket.join(sessionId);
        console.log(`Socket odaya katıldı: ${sessionId}`);
    });
});

// --- BOOTSTRAP: Supabase'teki CONNECTED hatları ayağa kaldır ---

async function bootstrapSessions() {
    try {
        const { data, error } = await supabase
            .from('sessions')
            .select('session_name, status')
            .in('status', ['CONNECTED', 'AUTHENTICATED']);

        if (error) {
            console.error('Session bootstrap hatası:', error.message);
            return;
        }

        if (!data || data.length === 0) {
            console.log('Session bootstrap: kayıtlı hat yok.');
            return;
        }

        console.log(`Session bootstrap: ${data.length} hat bulundu.`);
        for (const row of data) {
            console.log(
                `Session bootstrap: "${row.session_name}" (${row.status}) için WhatsApp client başlatılıyor...`
            );
            whatsappManager.startSession(row.session_name);
        }
    } catch (err) {
        console.error('Session bootstrap genel hata:', err.message);
    }
}

// --- SUNUCUYU BAŞLAT ---

server.listen(port, () => {
    console.log(`✅ SUNUCU ÇALIŞIYOR: http://localhost:${port}`);
    bootstrapSessions();
});
