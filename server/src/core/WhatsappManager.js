const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const supabase = require('../db');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

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
        // Tüm oturumları kontrol et
        const { data: sessions } = await supabase.from('sessions').select('*');
        if (sessions && sessions.length > 0) {
            console.log(`🔄 ${sessions.length} oturum durumu kontrol ediliyor...`);
            for (const s of sessions) {
                // Sadece explicit olarak silinmemişse başlat
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
            console.log(`[${sessionName}] QR Kodu Hazır.`);
            try {
                const qrImage = await qrcode.toDataURL(qr);
                if (this.io) this.io.emit('qr', qrImage);
                
                await supabase.from('sessions')
                    .update({ qr_code: qrImage, status: 'QR_READY' })
                    .eq('session_name', sessionName);
            } catch (e) { console.error('QR Error:', e); }
        });

        client.on('ready', async () => {
            console.log(`[${sessionName}] ✅ BAĞLANDI!`);
            if (this.io) this.io.emit('ready', { sessionName });
            await supabase.from('sessions')
                .update({ status: 'CONNECTED', qr_code: null })
                .eq('session_name', sessionName);
            
            // Bağlanınca hızlı bir sync yap
            this.syncRecentChats(client, sessionName);
        });

        client.on('message_create', async (msg) => {
            if (msg.from === 'status@broadcast') return;
            await this.saveMessageToDb(sessionName, msg);
        });

        // BAĞLANTI KOPUNCA - ASLA SİLME, YENİDEN BAŞLAT
        client.on('disconnected', async (reason) => {
            console.log(`[${sessionName}] Koptu (${reason}). Yeniden bağlanıyor...`);
            
            await supabase.from('sessions').update({ status: 'DISCONNECTED' }).eq('session_name', sessionName);
            
            try { await client.destroy(); } catch(e) {}
            this.sessions.delete(sessionName);

            // 5 saniye bekle ve sonsuz döngüde yeniden başlat
            await sleep(5000);
            
            const { data: s } = await supabase.from('sessions').select('user_id').eq('session_name', sessionName).single();
            this.startSession(sessionName, s?.user_id, false);
        });

        try {
            await client.initialize();
            this.sessions.set(sessionName, client);
        } catch (err) {
            console.error(`[${sessionName}] Hata:`, err.message);
            // Hata olsa bile yeniden dene
            setTimeout(() => this.startSession(sessionName, userId, false), 10000);
        }
    }

    // --- DOSYA KAYDETME VE MESAJ İŞLEME ---
    async saveMessageToDb(sessionName, msg) {
        try {
            // Önce var mı diye bak (Tekrarı önle)
            const { data: existing } = await supabase.from('messages').select('id').eq('whatsapp_id', msg.id._serialized).maybeSingle();
            if (existing) return;

            const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
            if (!session) return;

            const isOutbound = msg.fromMe;
            const rawContactId = isOutbound ? msg.to : msg.from;
            const contactPhone = cleanPhone(rawContactId);
            
            if (rawContactId.includes('@g.us')) return; 

            // Medya İndirme
            let mediaUrl = null;
            let mimetype = null;
            let finalBody = msg.body;
            
            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const extension = mime.extension(media.mimetype) || 'bin';
                        const fileName = `${msg.id.id}.${extension}`;
                        const filePath = path.join(__dirname, '../../public/media', fileName);
                        
                        const dir = path.dirname(filePath);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                        fs.writeFileSync(filePath, media.data, 'base64');
                        
                        mediaUrl = `/media/${fileName}`;
                        mimetype = media.mimetype;
                        
                        if (!finalBody) finalBody = media.filename || `[Dosya: ${extension}]`;
                    }
                } catch (e) {
                    console.error('Medya hatası:', e.message);
                }
            }

            const contactName = msg._data?.notifyName || msg._data?.pushname || contactPhone;
            
            await supabase.from('contacts').upsert({
                session_id: session.id,
                phone_number: contactPhone,
                push_name: contactName,
                updated_at: new Date()
            }, { onConflict: 'session_id, phone_number' });

            await supabase.from('messages').insert({
                session_id: session.id,
                contact_id: contactPhone,
                whatsapp_id: msg.id._serialized,
                body: finalBody,
                type: msg.type,
                media_url: mediaUrl,
                mimetype: mimetype,
                is_outbound: isOutbound,
                timestamp: msg.timestamp,
                created_at: new Date(msg.timestamp * 1000)
            });

        } catch (err) { 
            if (err.code !== '23505') console.error('DB Hata:', err.message); 
        }
    }

    // --- HIZLI SYNC ---
    async syncRecentChats(client, sessionName) {
        try {
            const chats = await client.getChats();
            const recentChats = chats.slice(0, 5); 
            for (const chat of recentChats) {
                const messages = await chat.fetchMessages({ limit: 10 });
                for (const msg of messages) {
                    await this.saveMessageToDb(sessionName, msg);
                }
                await sleep(500);
            }
        } catch (e) {}
    }

    async listChats(sessionName) {
        // Offline Mod: Her zaman önce DB'ye bakabiliriz veya hibrit yapabiliriz.
        // En garantisi Client varsa onu kullanmak, yoksa DB'ye düşmek.
        const client = this.sessions.get(sessionName);
        if (client) {
            try {
                const chats = await client.getChats();
                return chats.filter(c => !c.isGroup).map(c => ({
                    id: c.id._serialized,
                    phone_number: c.id.user,
                    push_name: c.name || c.id.user,
                    unread: c.unreadCount,
                    timestamp: c.timestamp
                }));
            } catch (e) {}
        }
        
        // Client yoksa DB'den getir (Offline)
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) return [];
        const { data: contacts } = await supabase.from('contacts').select('*').eq('session_id', session.id).order('updated_at', { ascending: false });
        if (!contacts) return [];
        return contacts.map(c => ({
            id: c.phone_number + '@c.us',
            phone_number: c.phone_number,
            push_name: c.push_name || c.phone_number,
            unread: 0,
            timestamp: new Date(c.updated_at).getTime() / 1000
        }));
    }

    // Diğer metodlar aynı...
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

        if ((!dbMessages || dbMessages.length === 0) && client && !beforeId) {
            try {
                const chatId = `${contactNumber}@c.us`;
                const chat = await client.getChatById(chatId);
                const fetchedMessages = await chat.fetchMessages({ limit: 20 });
                for (const msg of fetchedMessages) { await this.saveMessageToDb(sessionName, msg); }
                
                const { data: refreshed } = await supabase.from('messages').select('*').eq('session_id', session.id).eq('contact_id', contactNumber).order('timestamp', { ascending: false }).limit(limit);
                return { messages: refreshed ? refreshed.reverse() : [] };
            } catch (e) {}
        }
        return { messages: dbMessages ? dbMessages.reverse() : [] };
    }

    async sendMessage(sessionName, targetNumber, text) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Offline');
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