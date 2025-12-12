const supabase = require('../db');

// 1. İletişime Geçilen Kişiyi Bul veya Oluştur
async function findOrCreateContact(contactData) {
    const { number, pushname } = contactData;

    // Grup mesajlarını ve geçersiz numaraları filtrele
    if (!number || number.includes('@g.us')) return null;

    const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('phone_number', number)
        .single();

    if (existingContact) return existingContact.id;

    const { data: newContact, error } = await supabase
        .from('contacts')
        .insert([{ 
            phone_number: number, 
            push_name: pushname || 'Bilinmeyen' 
        }])
        .select()
        .single();
    
    if (error) return null;
    return newContact.id;
}

// En Son Mesaj Zamanını Getir
async function getLastMessageTimestamp(sessionId) {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('timestamp')
            .eq('session_id', sessionId)
            .order('timestamp', { ascending: false })
            .limit(1)
            .single();

        if (error || !data) return 0;
        return data.timestamp; 
    } catch (err) {
        return 0;
    }
}

// 2. Mesajı Kaydet (FİLTRELİ)
async function saveMessage(sessionName, msg, direction = 'inbound') {
    try {
        // --- FİLTRELEME BAŞLANGICI ---
        
        // A) Sadece Yazı (chat) mesajlarını al. Resim, Video, Sticker, Ses'i REDDET.
        if (msg.type !== 'chat') {
            // console.log(`[Atlandı] Medya mesajı: ${msg.type}`);
            return; 
        }

        // B) Grup Mesajlarını Reddet (İstersen bunu kaldırabilirsin)
        if (msg.from.includes('@g.us')) return;

        // --- FİLTRELEME BİTİŞİ ---

        const { data: session } = await supabase
            .from('sessions')
            .select('id')
            .eq('session_name', sessionName)
            .single();

        if (!session) return; 

        let contactNumber = msg.from;
        if (contactNumber.includes('@')) {
            contactNumber = contactNumber.split('@')[0];
        }
        
        const pushName = msg._data?.notifyName || 'Bilinmeyen';

        const contactId = await findOrCreateContact({
            number: contactNumber,
            pushname: pushName
        });

        if (!contactId) return;

        const messageData = {
            session_id: session.id,
            contact_id: contactId,
            wam_id: msg.id.id,
            direction: direction,
            type: msg.type,
            body: msg.body,
            timestamp: msg.timestamp,
            ack: msg.ack || 1 
        };

        await supabase.from('messages').upsert(messageData, { onConflict: 'wam_id' });

    } catch (err) {
        // Hata olsa bile sessizce devam et, sistemi çökertme
        // console.error('Kayıt hatası (önemsiz):', err.message);
    }
}

// 3. Akıllı Geçmiş Taraması (LİMİTLİ)
async function syncRecentHistory(client, sessionName) {
    console.log(`[${sessionName}] ⏳ Optimize edilmiş senkronizasyon başlıyor...`);
    
    try {
        const { data: session } = await supabase.from('sessions').select('id').eq('session_name', sessionName).single();
        if (!session) return;

        const lastKnownTimestamp = await getLastMessageTimestamp(session.id);
        
        // 1. Tüm sohbetleri çekme! Sadece aktif olanları çek.
        const chats = await client.getChats();
        
        // OPTİMİZASYON: Sadece en son konuşulan 15 sohbeti işle.
        // Kişisel WhatsApp'ta binlerce sohbet olabilir, hepsini çekersen sistem çöker.
        const recentChats = chats.slice(0, 15); 

        console.log(`[${sessionName}] Toplam ${chats.length} sohbet var, sadece son ${recentChats.length} tanesi işleniyor.`);

        for (const chat of recentChats) {
            if (chat.isGroup) continue;

            // Her sohbetten sadece son 10 mesajı al (Hızlı olsun)
            const messages = await chat.fetchMessages({ limit: 10 });

            for (const msg of messages) {
                if (msg.timestamp <= lastKnownTimestamp) continue; 

                const direction = msg.fromMe ? 'outbound' : 'inbound';
                await saveMessage(sessionName, msg, direction);
            }
            
            // Sohbete nefes aldır (CPU'yu yormamak için 200ms bekle)
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log(`[${sessionName}] ✅ Senkronizasyon tamamlandı!`);

    } catch (err) {
        console.error(`[${sessionName}] Geçmiş tarama hatası:`, err);
    }
}

module.exports = { saveMessage, syncRecentHistory };