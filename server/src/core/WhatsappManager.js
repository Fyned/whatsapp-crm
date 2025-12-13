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

    // --- GÜNCELLENEN KISIM: OFFLINE MOD DESTEKLİ LIST CHATS ---
    async listChats(sessionName) {
        const client = this.sessions.get(sessionName);
        
        // 1. Seçenek: WhatsApp Bağlıysa Canlı Çek (En güncel veri)
        if (client) {
            try {
                const chats = await client.getChats();
                return chats
                    .filter(c => !c.isGroup)
                    .map(c => ({
                        id: c.id._serialized,
                        phone_number: c.id.user,
                        push_name: c.name || c.id.user,
                        unread: c.unreadCount,
                        timestamp: c.timestamp
                    }));
            } catch (error) {
                console.log(`[${sessionName}] WhatsApp erişim hatası, veritabanına geçiliyor...`);
            }
        }

        // 2. Seçenek: Bağlantı Yoksa Veritabanından Çek (Offline Mod)
        console.log(`[${sessionName}] Offline mod: Veritabanından sohbetler çekiliyor...`);
        
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) return [];

        const { data: contacts } = await supabase
            .from('contacts')
            .select('*')
            .eq('session_id', session.id)
            .order('updated_at', { ascending: false }); // En son konuşulanlar üstte

        if (!contacts) return [];

        // Frontend formatına dönüştür
        return contacts.map(c => ({
            id: c.phone_number + '@c.us',
            phone_number: c.phone_number,
            push_name: c.push_name || c.phone_number,
            unread: 0, // Offline modda okunmamış sayısı veremiyoruz (şimdilik)
            timestamp: new Date(c.updated_at).getTime() / 1000
        }));
    }

    async loadHistory(sessionName, contactNumber, limit = 20, beforeId = null) {
        const client = this.sessions.get(sessionName);
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) throw new Error('Session yok');

        let query = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactNumber)
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (beforeId) {
            const { data: refMsg } = await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single();
            if (refMsg) query = query.lt('timestamp', refMsg.timestamp);
        }

        const { data: dbMessages } = await query;

        // Sadece client varsa ve DB boşsa WhatsApp'tan çekmeyi dene
        if ((!dbMessages || dbMessages.length === 0) && client && !beforeId) {
            try {
                const chatId = `${contactNumber}@c.us`;
                const chat = await client.getChatById(chatId);
                const fetchedMessages = await chat.fetchMessages({ limit: 30 });
                for (const msg of fetchedMessages) { await this.saveMessageToDb(sessionName, msg); }
                
                const { data: refreshed } = await supabase.from('messages')
                    .select('*')
                    .eq('session_id', session.id)
                    .eq('contact_id', contactNumber)
                    .order('timestamp', { ascending: false })
                    .limit(limit);
                    
                return { messages: refreshed ? refreshed.reverse() : [] };
            } catch (e) {}
        }

        return { messages: dbMessages ? dbMessages.reverse() : [] };
    }

    async sendMessage(sessionName, targetNumber, text) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum bağlı değil (Offline)'); // Offline modda mesaj atılamaz
        
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