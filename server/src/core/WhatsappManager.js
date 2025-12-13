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
        const { data: sessions } = await supabase.from('sessions').select('*');
        if (sessions && sessions.length > 0) {
            console.log(`🔄 ${sessions.length} oturum kontrol ediliyor...`);
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
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
            }
        });

        client.on('qr', async (qr) => {
            try {
                const qrImage = await qrcode.toDataURL(qr);
                if (this.io) this.io.emit('qr', { sessionName, qr: qrImage });
                await supabase.from('sessions').update({ qr_code: qrImage, status: 'QR_READY' }).eq('session_name', sessionName);
            } catch (e) {}
        });

        client.on('ready', async () => {
            console.log(`[${sessionName}] ✅ BAĞLANDI!`);
            await supabase.from('sessions').update({ status: 'CONNECTED', qr_code: null }).eq('session_name', sessionName);
            if (this.io) this.io.emit('ready', { sessionName });
        });

        client.on('message_create', async (msg) => {
            if (msg.from === 'status@broadcast') return;
            await this.saveMessageToDb(sessionName, msg);
        });

        client.on('disconnected', async () => {
            await supabase.from('sessions').update({ status: 'DISCONNECTED' }).eq('session_name', sessionName);
            try { await client.destroy(); } catch(e) {}
            this.sessions.delete(sessionName);
            await sleep(5000);
            const { data: s } = await supabase.from('sessions').select('user_id').eq('session_name', sessionName).single();
            this.startSession(sessionName, s?.user_id, false);
        });

        try {
            await client.initialize();
            this.sessions.set(sessionName, client);
        } catch (err) {
            setTimeout(() => this.startSession(sessionName, userId, false), 10000);
        }
    }

    async getRawChats(sessionName) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum bağlı değil');
        const chats = await client.getChats();
        return chats.filter(c => !c.isGroup).map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            phone: c.id.user,
            unread: c.unreadCount
        }));
    }

    // --- GELİŞTİRİLMİŞ SYNC FONKSİYONU ---
    async syncSelectedChats(sessionName, contactIds) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum bağlı değil');

        // Arka planda başlat (API'yi bekletmemek için)
        this.processFullSync(client, sessionName, contactIds);

        return { success: true, message: 'İşlem başlatıldı.' };
    }

    async processFullSync(client, sessionName, contactIds) {
        for (const [index, contactId] of contactIds.entries()) {
            try {
                const chatId = contactId.includes('@') ? contactId : `${contactId}@c.us`;
                const chat = await client.getChatById(chatId);
                const contactName = chat.name || chat.id.user;

                // Socket: "Başladı"
                if(this.io) this.io.emit('sync_status', {
                    current: index + 1,
                    total: contactIds.length,
                    chatName: contactName,
                    message: `${contactName} arşivleniyor...`
                });

                let lastMsgId = null;
                let totalFetchedForChat = 0;
                let keepFetching = true;
                
                // SONSUZ DÖNGÜ KORUMASI: Daha önce çektiğimiz mesaj ID'lerini burada tutuyoruz.
                // Eğer API bize aynı mesajları tekrar verirse, döngüyü kıracağız.
                const processedIds = new Set();

                while (keepFetching) {
                    // İnsansı Bekleme (1-2 saniye)
                    await sleep(Math.floor(Math.random() * 1000) + 1000);

                    const options = { limit: 50 }; // 50'şer paket
                    if (lastMsgId) {
                        options.before = lastMsgId;
                    }

                    const messages = await chat.fetchMessages(options);

                    if (!messages || messages.length === 0) {
                        console.log(`[Sync] ${contactName}: Mesaj bitti.`);
                        keepFetching = false;
                        break;
                    }

                    // --- KRİTİK KONTROL (Infinite Loop Killer) ---
                    // Eğer çektiğimiz paketteki tüm mesajları zaten bu turda işlediysek, 
                    // demek ki WhatsApp aynı yeri döndürüyor. Çık.
                    const newMessages = messages.filter(m => !processedIds.has(m.id._serialized));
                    if (newMessages.length === 0) {
                        console.log(`[Sync] ${contactName}: Tekrar eden veri algılandı, döngü kırılıyor.`);
                        keepFetching = false;
                        break;
                    }

                    // En eski mesajın ID'sini al (Bir sonraki tur için referans)
                    // messages[0] en eski mesajdır.
                    lastMsgId = messages[0].id._serialized;

                    for (const msg of messages) {
                        processedIds.add(msg.id._serialized); // Set'e ekle
                        await this.saveMessageToDb(sessionName, msg);
                    }

                    totalFetchedForChat += messages.length;

                    // CANLI SAYI BİLDİRİMİ
                    if(this.io) this.io.emit('sync_progress', {
                        chatName: contactName,
                        count: totalFetchedForChat
                    });

                    console.log(`[Sync] ${contactName}: Toplam ${totalFetchedForChat} mesaj çekildi.`);
                }

            } catch (e) {
                console.error(`[Sync Hata] ${contactId}:`, e.message);
            }
        }

        if(this.io) this.io.emit('sync_complete', { total: contactIds.length });
        console.log(`[${sessionName}] Toplu işlem bitti.`);
    }

    async saveMessageToDb(sessionName, msg) {
        try {
            // Veritabanı Var Mı Kontrolü (Hız)
            const { data: existing } = await supabase.from('messages').select('id').eq('whatsapp_id', msg.id._serialized).maybeSingle();
            if (existing) return;

            const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
            if (!session) return;

            const isOutbound = msg.fromMe;
            const rawContactId = isOutbound ? msg.to : msg.from;
            const contactPhone = cleanPhone(rawContactId);
            
            if (rawContactId.includes('@g.us')) return; 

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
                        if (!finalBody) finalBody = media.filename || `[Dosya]`;
                    }
                } catch (e) {}
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

    // --- API HELPER (Diğerleri aynı) ---
    async listChats(sessionName) {
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

    async loadHistory(sessionName, contactNumber, limit = 50, beforeId = null) {
        const client = this.sessions.get(sessionName);
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) throw new Error('Session yok');

        let query = supabase.from('messages').select('*').eq('session_id', session.id).eq('contact_id', contactNumber).order('timestamp', { ascending: false }).limit(limit);
        if (beforeId) {
            const { data: refMsg } = await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single();
            if (refMsg) query = query.lt('timestamp', refMsg.timestamp);
        }
        const { data: dbMessages } = await query;

        if ((!dbMessages || dbMessages.length < limit) && client && !beforeId) {
            try {
                const chatId = `${contactNumber}@c.us`;
                const chat = await client.getChatById(chatId);
                const fetchedMessages = await chat.fetchMessages({ limit: limit + 30 });
                for (const msg of fetchedMessages) { await this.saveMessageToDb(sessionName, msg); }
                const { data: refreshed } = await supabase.from('messages').select('*').eq('session_id', session.id).eq('contact_id', contactNumber).order('timestamp', { ascending: false }).limit(limit).lt('timestamp', beforeId ? (await supabase.from('messages').select('timestamp').eq('whatsapp_id', beforeId).single()).data.timestamp : 99999999999);
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