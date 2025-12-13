const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const supabase = require('../db');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanPhone = (id) => id ? id.replace(/\D/g, '') : null;

class WhatsappManager {
    constructor() {
        this.io = null;
        this.sessions = new Map();
        this.restoreSessions(); // Sunucu açılınca eski oturumları topla
    }

    setSocketIO(io) { this.io = io; }

    async restoreSessions() {
        const { data: sessions } = await supabase.from('sessions').select('*').eq('status', 'CONNECTED');
        if (sessions && sessions.length > 0) {
            console.log(`🔄 ${sessions.length} oturum geri yükleniyor...`);
            for (const s of sessions) {
                this.startSession(s.session_name, s.user_id, true);
            }
        }
    }

    async startSession(sessionName, userId = null, isRestoring = false) {
        if (this.sessions.has(sessionName)) return;

        console.log(`[${sessionName}] Başlatılıyor...`);
        
        if (!isRestoring) {
            // DB'ye ilk kayıt
            await supabase.from('sessions').upsert({
                session_name: sessionName,
                user_id: userId,
                status: 'INITIALIZING'
            }, { onConflict: 'session_name' });
        }

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: sessionName }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            }
        });

        // 1. QR Kod
        client.on('qr', async (qr) => {
            console.log(`[${sessionName}] QR Kod Üretildi.`);
            try {
                // Base64 Resim oluşturuyoruz
                const qrImage = await qrcode.toDataURL(qr);
                
                // Frontend'e gönder
                if (this.io) this.io.emit('qr', qrImage);
                
                // DB'ye kaydet
                await supabase.from('sessions')
                    .update({ qr_code: qrImage, status: 'QR_READY' })
                    .eq('session_name', sessionName);
            } catch (e) { console.error('QR Hatası:', e); }
        });

        // 2. Bağlandı
        client.on('ready', async () => {
            console.log(`[${sessionName}] ✅ BAĞLANDI!`);
            if (this.io) this.io.emit('ready', { sessionName });
            
            await supabase.from('sessions')
                .update({ status: 'CONNECTED', qr_code: null })
                .eq('session_name', sessionName);
        });

        // 3. Mesaj Geldi/Gitti
        client.on('message_create', async (msg) => {
            if (msg.from === 'status@broadcast') return;
            await this.saveMessageToDb(sessionName, msg);
        });

        // 4. Koptu
        client.on('disconnected', async () => {
            console.log(`[${sessionName}] Koptu.`);
            await supabase.from('sessions').update({ status: 'DISCONNECTED' }).eq('session_name', sessionName);
            this.sessions.delete(sessionName);
        });

        try {
            await client.initialize();
            this.sessions.set(sessionName, client);
        } catch (err) {
            console.error(`[${sessionName}] Başlatma hatası:`, err.message);
        }
    }

    // --- DB KAYIT ---
    async saveMessageToDb(sessionName, msg) {
        try {
            const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
            if (!session) return;

            const isOutbound = msg.fromMe;
            const rawContactId = isOutbound ? msg.to : msg.from;
            const contactPhone = cleanPhone(rawContactId);
            
            if (rawContactId.includes('@g.us')) return; // Grup engelle

            const contactName = msg._data?.notifyName || msg._data?.pushname || contactPhone;
            
            // Kişiyi kaydet
            await supabase.from('contacts').upsert({
                session_id: session.id,
                phone_number: contactPhone,
                push_name: contactName,
                updated_at: new Date()
            }, { onConflict: 'session_id, phone_number' });

            // Mesajı kaydet
            await supabase.from('messages').upsert({
                session_id: session.id,
                contact_id: contactPhone,
                whatsapp_id: msg.id._serialized,
                body: msg.body,
                type: msg.type,
                is_outbound: isOutbound,
                timestamp: msg.timestamp,
                created_at: new Date(msg.timestamp * 1000)
            }, { onConflict: 'whatsapp_id' });

        } catch (err) { console.error('DB Kayıt Hatası:', err); }
    }

    // --- API HELPER ---
    async listChats(sessionName) {
        const client = this.sessions.get(sessionName);
        if (!client) return [];
        const chats = await client.getChats();
        return chats.filter(c => !c.isGroup).map(c => ({
            id: c.id._serialized,
            phone_number: c.id.user,
            push_name: c.name || c.id.user,
            unread: c.unreadCount,
            timestamp: c.timestamp
        }));
    }

    async loadHistory(sessionName, contactNumber, limit = 20) {
        const client = this.sessions.get(sessionName);
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) throw new Error('Session yok');

        // Önce DB'den çek
        let query = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactNumber)
            .order('timestamp', { ascending: false })
            .limit(limit);

        const { data: dbMessages } = await query;

        // DB boşsa WhatsApp'tan çek
        if ((!dbMessages || dbMessages.length < 5) && client) {
            try {
                const chatId = `${contactNumber}@c.us`;
                const chat = await client.getChatById(chatId);
                const fetchedMessages = await chat.fetchMessages({ limit: 50 });
                for (const msg of fetchedMessages) { await this.saveMessageToDb(sessionName, msg); }
                
                const { data: refreshed } = await query;
                return { messages: refreshed ? refreshed.reverse() : [] };
            } catch (e) {}
        }
        return { messages: dbMessages ? dbMessages.reverse() : [] };
    }

    async sendMessage(sessionName, targetNumber, text) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum yok');
        const chatId = `${targetNumber}@c.us`;
        const msg = await client.sendMessage(chatId, text);
        await this.saveMessageToDb(sessionName, msg);
    }

    async deleteSession(sessionName) {
        const client = this.sessions.get(sessionName);
        if (client) {
            try { await client.logout(); } catch(e){}
            try { await client.destroy(); } catch(e){}
            this.sessions.delete(sessionName);
        }
        await supabase.from('sessions').delete().eq('session_name', sessionName);
    }
}

module.exports = new WhatsappManager();