const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const supabase = require('../db');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanPhone = (id) => id ? id.replace(/\D/g, '') : null;

class WhatsappManager {
    constructor() {
        this.io = null;
        this.sessions = new Map();
        this.restoreSessions(); 
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

        client.on('qr', async (qr) => {
            console.log(`[${sessionName}] QR Geldi.`);
            try {
                const qrImage = await qrcode.toDataURL(qr);
                if (this.io) this.io.emit('qr', qrImage);
                await supabase.from('sessions').update({ qr_code: qrImage, status: 'QR_READY' }).eq('session_name', sessionName);
            } catch (e) { console.error('QR Error:', e); }
        });

        client.on('ready', async () => {
            console.log(`[${sessionName}] ✅ BAĞLANDI!`);
            if (this.io) this.io.emit('ready', { sessionName });
            await supabase.from('sessions').update({ status: 'CONNECTED', qr_code: null }).eq('session_name', sessionName);
        });

        client.on('message_create', async (msg) => {
            if (msg.from === 'status@broadcast') return;
            await this.saveMessageToDb(sessionName, msg);
        });

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
            
            if (rawContactId.includes('@g.us')) return; 

            const contactName = msg._data?.notifyName || msg._data?.pushname || contactPhone;
            
            await supabase.from('contacts').upsert({
                session_id: session.id,
                phone_number: contactPhone,
                push_name: contactName,
                updated_at: new Date()
            }, { onConflict: 'session_id, phone_number' });

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

    // --- DÜZELTİLEN FONKSİYON: loadHistory ---
    async loadHistory(sessionName, contactNumber, limit = 20, beforeId = null) {
        const client = this.sessions.get(sessionName);
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) throw new Error('Session yok');

        // 1. Sorguyu Hazırla
        let query = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactNumber)
            .order('timestamp', { ascending: false }) // En yeniler en üstte
            .limit(limit);

        // 2. Eğer 'beforeId' varsa, o mesajın zamanını bul ve ondan eskileri getir
        if (beforeId) {
            const { data: refMsg } = await supabase.from('messages')
                .select('timestamp')
                .eq('whatsapp_id', beforeId)
                .single();
            
            if (refMsg) {
                // Bu zamandan KÜÇÜK (daha eski) olanları getir
                query = query.lt('timestamp', refMsg.timestamp);
            }
        }

        const { data: dbMessages } = await query;

        // 3. DB boşsa ve ilk yüklemeyse WhatsApp'tan çek (Sadece ilk yüklemede mantıklı)
        if ((!dbMessages || dbMessages.length === 0) && client && !beforeId) {
            try {
                const chatId = `${contactNumber}@c.us`;
                const chat = await client.getChatById(chatId);
                const fetchedMessages = await chat.fetchMessages({ limit: 30 }); // İlk etapta 30 tane çek
                for (const msg of fetchedMessages) { await this.saveMessageToDb(sessionName, msg); }
                
                // DB'den tekrar çek
                const { data: refreshed } = await supabase.from('messages')
                    .select('*')
                    .eq('session_id', session.id)
                    .eq('contact_id', contactNumber)
                    .order('timestamp', { ascending: false })
                    .limit(limit);
                    
                return { messages: refreshed ? refreshed.reverse() : [] };
            } catch (e) {}
        }

        // Frontend'e kronolojik (Eskiden > Yeniye) gönder
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