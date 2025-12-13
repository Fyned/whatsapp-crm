const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const supabase = require('../db'); // db.js bağlantısı

// Yardımcı: Gecikme fonksiyonu
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Yardımcı: ID'den sadece rakamları al (905551234567)
const cleanPhone = (id) => id ? id.replace(/\D/g, '') : null;

class WhatsappManager {
    constructor() {
        this.io = null;
        this.sessions = new Map();
        // Sunucu yeniden başladığında eski bağlı oturumları otomatik geri yükle
        this.restoreSessions(); 
    }

    setSocketIO(io) {
        this.io = io;
    }

    async restoreSessions() {
        // Status'u CONNECTED olanları bul ve tekrar başlat
        const { data: sessions } = await supabase.from('sessions').select('*').eq('status', 'CONNECTED');
        if (sessions && sessions.length > 0) {
            console.log(`🔄 ${sessions.length} aktif oturum geri yükleniyor...`);
            for (const s of sessions) {
                // isRestoring = true parametresiyle başlat
                this.startSession(s.session_name, s.user_id, true);
            }
        }
    }

    async startSession(sessionName, userId = null, isRestoring = false) {
        if (this.sessions.has(sessionName)) return;

        console.log(`[${sessionName}] Başlatılıyor...`);
        
        // İlk kez başlıyorsa DB'ye kayıt at
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
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            }
        });

        // 1. QR Kod Olayı
        client.on('qr', async (qr) => {
            console.log(`[${sessionName}] QR Kodu Üretildi.`);
            try {
                const qrImage = await qrcode.toDataURL(qr);
                
                // Frontend'e gönder
                if (this.io) this.io.emit('qr', qrImage);
                
                // Veritabanına yaz (Yedek olarak)
                await supabase.from('sessions')
                    .update({ qr_code: qrImage, status: 'QR_READY' })
                    .eq('session_name', sessionName);
            } catch (e) { console.error('QR Error:', e); }
        });

        // 2. Bağlantı Hazır
        client.on('ready', async () => {
            console.log(`[${sessionName}] ✅ BAĞLANDI ve HAZIR!`);
            if (this.io) this.io.emit('ready', { sessionName });
            
            await supabase.from('sessions')
                .update({ status: 'CONNECTED', qr_code: null })
                .eq('session_name', sessionName);
        });

        // 3. Mesaj Yakalama (Canlı Arşiv)
        client.on('message_create', async (msg) => {
            // Durum güncellemelerini (Status) kaydetme
            if (msg.from === 'status@broadcast') return;
            await this.saveMessageToDb(sessionName, msg);
        });

        // 4. Bağlantı Koptu
        client.on('disconnected', async (reason) => {
            console.log(`[${sessionName}] Bağlantı koptu:`, reason);
            await supabase.from('sessions').update({ status: 'DISCONNECTED' }).eq('session_name', sessionName);
            // Client'ı bellekten silme işlemini hemen yapma, yeniden bağlanmayı deneyebilir.
            // Ama biz şimdilik temizliyoruz:
            this.sessions.delete(sessionName);
        });

        try {
            await client.initialize();
            this.sessions.set(sessionName, client);
        } catch (err) {
            console.error(`[${sessionName}] Başlatma hatası:`, err.message);
        }
    }

    // --- VERİTABANI KAYIT MANTIĞI ---

    async saveMessageToDb(sessionName, msg) {
        try {
            // Session ID'yi al
            const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
            if (!session) return;

            const isOutbound = msg.fromMe;
            // Eğer mesajı biz attıysak alıcı (to), karşı taraf attıysa gönderen (from) bizim için 'contact'tır.
            const rawContactId = isOutbound ? msg.to : msg.from;
            const contactPhone = cleanPhone(rawContactId);
            
            // Grup mesajlarını şimdilik atla
            if (rawContactId.includes('@g.us')) return;

            // 1. Önce Kişiyi (Contact) oluştur veya güncelle
            // Mesajda isim varsa al, yoksa numarayı isim yap
            const contactName = msg._data?.notifyName || msg._data?.pushname || contactPhone;
            
            await supabase.from('contacts').upsert({
                session_id: session.id,
                phone_number: contactPhone,
                push_name: contactName,
                updated_at: new Date()
            }, { onConflict: 'session_id, phone_number' });

            // 2. Mesajı Kaydet
            const messageData = {
                session_id: session.id,
                contact_id: contactPhone, // Frontend bu alanı kullanıyor
                whatsapp_id: msg.id._serialized,
                body: msg.body,
                type: msg.type,
                is_outbound: isOutbound,
                timestamp: msg.timestamp,
                created_at: new Date(msg.timestamp * 1000)
            };

            const { error } = await supabase.from('messages').upsert(messageData, { onConflict: 'whatsapp_id' });
            
            if (error) console.error('Mesaj DB Hatası:', error.message);
            // else console.log(`[${sessionName}] Mesaj kaydedildi.`);

        } catch (err) {
            console.error('Save Msg Error:', err);
        }
    }

    // --- API İŞLEMLERİ ---

    async listChats(sessionName) {
        const client = this.sessions.get(sessionName);
        if (!client) return [];
        
        const chats = await client.getChats();
        // Sadece grupları değil, bireysel sohbetleri filtrele
        return chats
            .filter(c => !c.isGroup)
            .map(c => ({
                id: c.id._serialized,
                phone_number: c.id.user,
                push_name: c.name || c.id.user,
                unread: c.unreadCount,
                timestamp: c.timestamp
            }));
    }

    async loadHistory(sessionName, contactNumber, limit = 20, beforeId = null) {
        const client = this.sessions.get(sessionName);
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        
        if (!session) throw new Error('Session veritabanında bulunamadı');

        // A. Önce Veritabanından Çek
        let query = supabase.from('messages')
            .select('*')
            .eq('session_id', session.id)
            .eq('contact_id', contactNumber)
            .order('timestamp', { ascending: false }) // En yeniler en üstte
            .limit(limit);

        const { data: dbMessages } = await query;

        // B. Veritabanı boşsa veya yetersizse WhatsApp'tan çekip doldur
        if ((!dbMessages || dbMessages.length < 5) && client) {
            try {
                const chatId = `${contactNumber}@c.us`;
                const chat = await client.getChatById(chatId);
                const fetchedMessages = await chat.fetchMessages({ limit: 50 }); // Geçmişten 50 mesaj al
                
                // Hepsini kaydet
                for (const msg of fetchedMessages) {
                    await this.saveMessageToDb(sessionName, msg);
                }
                
                // DB'den tekrar çek (En temiz yöntem)
                const { data: refreshedData } = await query;
                return { messages: refreshedData ? refreshedData.reverse() : [] };
            } catch (e) {
                console.log("WhatsApp geçmiş çekme hatası (Normal olabilir):", e.message);
            }
        }

        // Frontend'de eskiden yeniye göstermek için reverse yapıyoruz
        return { messages: dbMessages ? dbMessages.reverse() : [] };
    }

    async sendMessage(sessionName, targetNumber, text) {
        const client = this.sessions.get(sessionName);
        if (!client) throw new Error('Oturum bağlı değil');
        
        const chatId = targetNumber.includes('@') ? targetNumber : `${targetNumber}@c.us`;
        const msg = await client.sendMessage(chatId, text);
        
        // Gönderdiğimiz mesajı da veritabanına kaydedelim
        await this.saveMessageToDb(sessionName, msg);
    }

    async deleteSession(sessionName) {
        const client = this.sessions.get(sessionName);
        if (client) {
            try { await client.logout(); } catch(e){}
            try { await client.destroy(); } catch(e){}
            this.sessions.delete(sessionName);
        }
        // DB'den sil (Cascade ile mesajlar da silinir)
        await supabase.from('sessions').delete().eq('session_name', sessionName);
    }
}

module.exports = new WhatsappManager();