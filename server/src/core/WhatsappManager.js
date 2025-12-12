const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const supabase = require('../config/supabase');

// Yardımcı: sadece rakam
const formatId = (id) => {
    if (!id) return null;
    return id.toString().replace(/\D/g, '');
};

// Yardımcı: gecikme
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class WhatsappManager {
    constructor() {
        this.io = null;
        this.sessions = new Map(); // session_name -> Client
    }

    setSocketIO(io) {
        this.io = io;
    }

    // Supabase'ten session kaydını getir
    async getSessionRecord(sessionName) {
        const { data, error } = await supabase
            .from('sessions')
            .select('id')
            .eq('session_name', sessionName)
            .maybeSingle();

        if (error) {
            console.error(`[${sessionName}] Supabase session sorgu hatası:`, error.message);
            return null;
        }

        return data || null;
    }

    // WhatsApp client başlat
    async startSession(sessionName) {
        console.log(`[${sessionName}] Başlatılıyor...`);

        // --- GÜNCELLEME: Çökme Önleyici Kontrol ---
        if (this.sessions.has(sessionName)) {
            console.log(`[${sessionName}] Zaten listede var, durum kontrol ediliyor...`);
            const existingClient = this.sessions.get(sessionName);
            
            // Eğer tarayıcı kapanmışsa veya hata vermişse temizleyip yeniden başlatalım
            try {
                await existingClient.destroy();
            } catch (e) {
                console.log(`[${sessionName}] Eski client kapatılırken hata (önemsiz): ${e.message}`);
            }
            this.sessions.delete(sessionName);
        }
        // -------------------------------------------

        // Dosya adı güvenliği (+ işaretini vs temizle)
        const cleanClientId = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: cleanClientId }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Bellek yönetimi için önemli
                    '--disable-gpu'
                ],
            },
        });

        // QR
        client.on('qr', async (qr) => {
            console.log(`[${sessionName}] QR Oluştu.`);
            qrcodeTerminal.generate(qr, { small: true });

            try {
                const qrImage = await qrcode.toDataURL(qr);
                if (this.io) {
                    this.io.emit('qr_code', {
                        sessionId: sessionName,
                        qr: qrImage,
                        image: qrImage,
                    });
                }
                await this.updateSession(sessionName, {
                    qr_code: qrImage,
                    status: 'QR_BEKLEMEDE',
                });
            } catch (err) {
                console.error(`[${sessionName}] QR işleme hatası:`, err.message);
            }
        });

        // Hazır
        client.on('ready', async () => {
            console.log(`[${sessionName}] HAZIR!`);
            if (this.io) {
                this.io.emit('session_status', {
                    sessionId: sessionName,
                    status: 'READY',
                });
            }
            await this.updateSession(sessionName, {
                status: 'CONNECTED',
                qr_code: null,
            });
        });

        client.on('authenticated', async () => {
            await this.updateSession(sessionName, { status: 'AUTHENTICATED' });
        });

        client.on('disconnected', async (reason) => {
            console.log(`[${sessionName}] Koptu:`, reason);
            if (this.io) {
                this.io.emit('session_status', {
                    sessionId: sessionName,
                    status: 'DISCONNECTED',
                });
            }
            await this.updateSession(sessionName, { status: 'DISCONNECTED' });
            
            // Client'ı tamamen yok et
            try { await client.destroy(); } catch(e) {}
            this.sessions.delete(sessionName);
        });

        // Mesaj create (gelen + giden)
        client.on('message_create', (msg) => {
            this.handleMessageCreate(sessionName, msg).catch((err) => {
                console.error(`[${sessionName}] Mesaj işleme hatası:`, err.message);
            });
        });

        try {
            await client.initialize();
            this.sessions.set(sessionName, client);
        } catch (error) {
            console.error(
                `[${sessionName}] Başlatma hatası:`,
                error.message
            );
            // Hata durumunda session'ı temizle ki bir dahaki sefere tekrar deneyebilsin
            this.sessions.delete(sessionName);
        }
    }

    // Realtime mesaj kaydı
    async handleMessageCreate(sessionName, msg) {
        if (msg.from === 'status@broadcast') return;

        const sessionRecord = await this.getSessionRecord(sessionName);
        if (!sessionRecord) return;

        const chat = await msg.getChat();
        const contact = await chat.getContact();

        const cleanContactId = formatId(chat.id._serialized);
        if (!cleanContactId) return;

        const direction = msg.fromMe ? 'outbound' : 'inbound';
        
        // Logu sadeleştirdim
        console.log(`[MSG] ${cleanContactId}: Yeni mesaj.`);

        await this.upsertContact(sessionRecord.id, cleanContactId, contact);

        const messageRow = {
            contact_id: cleanContactId,
            session_id: sessionRecord.id,
            whatsapp_id: msg.id.id,
            body: msg.body,
            direction,
            timestamp: msg.timestamp,
        };

        const { error } = await supabase
            .from('messages')
            .upsert([messageRow], { onConflict: 'whatsapp_id' });

        if (error) {
            console.error('Supabase Yazma Hatası (messages realtime):', error.message);
        }
    }

    // Contact upsert (tek yerden)
    async upsertContact(sessionDbId, cleanContactId, contact) {
        try {
            const payload = {
                id: cleanContactId,
                session_id: sessionDbId,
                phone_number:
                    contact.number ||
                    formatId(contact.id?._serialized) ||
                    cleanContactId,
                push_name: contact.pushname || contact.name || null,
            };

            const { error } = await supabase
                .from('contacts')
                .upsert([payload], { onConflict: 'id' });

            if (error) {
                console.error('Supabase Contacts Upsert Hatası:', error.message);
            }
        } catch (err) {
            console.error('Supabase Contacts Upsert Hatası:', err.message);
        }
    }

    // FRONTEND: "Geçmişten X Mesaj Daha Yükle"
    async loadHistory(sessionName, targetNumber, totalLimit = 20) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum aktif değil');

        const sessionRecord = await this.getSessionRecord(sessionName);
        if (!sessionRecord) throw new Error('Session kaydı bulunamadı');

        let chatId = targetNumber.replace(/\D/g, '');
        if (!chatId) throw new Error('Geçersiz numara');
        if (!chatId.includes('@')) chatId = `${chatId}@c.us`;

        console.log(`[GEÇMİŞ] ${chatId} çekiliyor... limit=${totalLimit}`);

        const chat = await client.getChatById(chatId);

        try {
            // Mümkün olduğunca eski mesajı local cache'e çek
            await chat.syncHistory();
        } catch (err) {
            console.warn(`[${sessionName}] syncHistory uyarısı:`, err.message);
        }

        const limit = parseInt(totalLimit, 10) || 10;
        const messages = await chat.fetchMessages({ limit });

        const contact = await chat.getContact();
        const cleanContactId = formatId(chat.id._serialized);

        await this.upsertContact(sessionRecord.id, cleanContactId, contact);

        if (!messages || messages.length === 0) {
            return { count: 0 };
        }

        const rows = messages.map((msg) => ({
            contact_id: cleanContactId,
            session_id: sessionRecord.id,
            whatsapp_id: msg.id.id,
            body: msg.body,
            direction: msg.fromMe ? 'outbound' : 'inbound',
            timestamp: msg.timestamp,
        }));

        const { error } = await supabase
            .from('messages')
            .upsert(rows, { onConflict: 'whatsapp_id' });

        if (error) {
            console.error('Supabase Yazma Hatası (messages loadHistory):', error.message);
        }

        return {
            count: rows.length,
            lastTimestamp: rows[rows.length - 1].timestamp,
        };
    }

    // Aktif sohbet listesini WhatsApp'tan getir (soldaki liste için)
    async listChats(sessionName) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum aktif değil');

        const chats = await client.getChats();
        // Grup olmayan son 100 sohbeti al
        const privateChats = chats.filter((c) => !c.isGroup).slice(0, 100);

        const result = [];

        for (const chat of privateChats) {
            try {
                const contact = await chat.getContact();
                const cleanContactId = formatId(chat.id._serialized);
                if (!cleanContactId) continue;

                result.push({
                    id: cleanContactId,
                    phone_number: contact.number || cleanContactId,
                    push_name: contact.pushname || contact.name || null,
                    last_activity: chat.timestamp || null,
                    unread: chat.unreadCount || 0,
                    // Modal'da kullanmak için ekstra bilgi
                    chatId: chat.id._serialized 
                });

                // Çok hızlı taramayıp, ufak bir gecikme verelim (CPU koruması)
                await sleep(20);
            } catch (err) {
                console.warn('Sohbet listelerken hata:', err.message);
            }
        }

        result.sort(
            (a, b) => (b.last_activity || 0) - (a.last_activity || 0)
        );

        return result;
    }

    // Sync butonu: Seçilen sohbetler için toplu senkron
    async syncChats(sessionName, contactIds = [], perChatLimit = 10, perChatDelayMs = 400) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum aktif değil');

        const sessionRecord = await this.getSessionRecord(sessionName);
        if (!sessionRecord) throw new Error('Session kaydı bulunamadı');

        const limitPerChat = parseInt(perChatLimit, 10) || 10;
        let targetChats = [];

        // Eğer ID listesi boşsa, tüm sohbetleri (ilk 50) al
        if (!contactIds || contactIds.length === 0) {
             const chats = await client.getChats();
             targetChats = chats.filter((c) => !c.isGroup).slice(0, 50);
        } else {
            // Seçilenleri bul
            for (const raw of contactIds) {
                // contactIds, 'cleanId' (sadece rakam) gelebilir veya raw gelebilir.
                // Whatsapp-web.js için '@c.us' formatına çevirmemiz lazım.
                const digits = formatId(raw);
                if (!digits) continue;
                
                const chatId = `${digits}@c.us`;
                try {
                    const chat = await client.getChatById(chatId);
                    targetChats.push(chat);
                } catch (err) {
                    console.warn(`[${sessionName}] Chat bulunamadı: ${chatId}`);
                }
            }
        }

        let totalMessages = 0;
        let processedChats = 0;

        for (const chat of targetChats) {
            try {
                const contact = await chat.getContact();
                const cleanContactId = formatId(chat.id._serialized);
                if (!cleanContactId) continue;

                // Önce kişiyi kaydet
                await this.upsertContact(sessionRecord.id, cleanContactId, contact);

                // Geçmişi senkronize etmeyi dene
                try { await chat.syncHistory(); } catch (err) {}

                // Mesajları çek
                const messages = await chat.fetchMessages({ limit: limitPerChat });

                if (messages && messages.length > 0) {
                    const rows = messages.map((msg) => ({
                        contact_id: cleanContactId,
                        session_id: sessionRecord.id,
                        whatsapp_id: msg.id.id,
                        body: msg.body,
                        direction: msg.fromMe ? 'outbound' : 'inbound',
                        timestamp: msg.timestamp,
                    }));

                    const { error } = await supabase
                        .from('messages')
                        .upsert(rows, { onConflict: 'whatsapp_id' });

                    if (!error) totalMessages += rows.length;
                }

                processedChats += 1;
                
                // Anti-ban beklemesi
                await sleep(perChatDelayMs);
            } catch (err) {
                console.error(`[${sessionName}] Sohbet senkron hatası:`, err.message);
            }
        }

        return { processedChats, totalMessages };
    }

    // Mesaj gönderme
    async sendMessage(sessionName, targetNumber, content) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum yok');

        let chatId = targetNumber.replace(/\D/g, '');
        if (!chatId) throw new Error('Geçersiz numara');

        if (!chatId.includes('@')) {
            chatId = `${chatId}@c.us`;
        }

        await client.sendMessage(chatId, content);
    }

    async updateSession(sessionName, data) {
        try {
            await supabase
                .from('sessions')
                .update(data)
                .eq('session_name', sessionName);
        } catch (err) {
            console.error('Session update hatası:', err.message);
        }
    }
}

module.exports = new WhatsappManager();