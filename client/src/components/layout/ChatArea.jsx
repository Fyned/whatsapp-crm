import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, DownloadCloud, CheckCheck, Loader2 } from 'lucide-react';

// DİNAMİK URL
const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function ChatArea({ activeSession, activeContact }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true); // Daha fazla mesaj var mı?
  
  // Ref'ler
  const chatContainerRef = useRef(null); // Scroll edilen ana kutu
  const messagesEndRef = useRef(null);   // En alt nokta (otomatik kaydırma için)
  
  // Scroll pozisyonunu korumak için geçici değişkenler
  const prevScrollHeightRef = useRef(null);
  const isLoadingOldRef = useRef(false); // Eski mesaj mı yükleniyor yoksa yeni mi geldi?

  // 1. Aktif kişi değiştiğinde sıfırdan yükle
  useEffect(() => {
    if (activeContact && activeSession) {
      setMessages([]); 
      setHasMore(true);
      fetchMessages(true); // true = İlk yükleme (en alta git)
    }
  }, [activeContact, activeSession]);

  // 2. Realtime Dinleme (Canlı Mesaj)
  useEffect(() => {
    if (!activeSession || !activeContact) return;

    const channel = supabase.channel('chat_updates')
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: `session_id=eq.${activeSession.id}` 
        },
        (payload) => {
          // Gelen mesaj şu an açık olan kişiye mi ait?
          if (payload.new.contact_id === activeContact.phone_number) {
            isLoadingOldRef.current = false; // Yeni mesaj, alta gitmeli
            setMessages((prev) => [...prev, payload.new]);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeSession, activeContact]);

  // 3. Mesajlar değiştiğinde Scroll Yönetimi (SİHİRLİ KISIM)
  useLayoutEffect(() => {
    if (!chatContainerRef.current) return;

    // A) Eğer eski mesajlar yüklendiyse: Scroll'u koru
    if (isLoadingOldRef.current && prevScrollHeightRef.current) {
      const newScrollHeight = chatContainerRef.current.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      chatContainerRef.current.scrollTop = diff; // Fark kadar aşağı it
      isLoadingOldRef.current = false;
    } 
    // B) Eğer yeni mesaj geldiyse veya ilk açılışsa: En alta git
    else {
      // Sadece en alttaysa veya ilk yüklemedeyse kaydır (Opsiyonel kullanıcı deneyimi)
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }); 
    }
  }, [messages]);

  // --- API FONKSİYONLARI ---

  const fetchMessages = async (isInitialLoad = false) => {
    if (loading || !hasMore) return;
    setLoading(true);

    // Scroll yüksekliğini kaydet (Eski mesaj yükleniyorsa)
    if (!isInitialLoad && chatContainerRef.current) {
      prevScrollHeightRef.current = chatContainerRef.current.scrollHeight;
      isLoadingOldRef.current = true;
    }

    // En eski mesajın ID'sini bul (Pagination için referans)
    const oldestMessageId = !isInitialLoad && messages.length > 0 ? messages[0].whatsapp_id : null;

    try {
      const res = await fetch(`${API_URL}/fetch-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: activeSession.session_name,
          contactId: activeContact.phone_number, 
          limit: 20, // Her seferinde 20 mesaj
          beforeId: oldestMessageId
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        if (data.messages.length < 20) setHasMore(false); // Daha az geldiyse bitmiştir

        if (isInitialLoad) {
          setMessages(data.messages);
        } else {
          // Eski mesajları listenin başına ekle
          setMessages(prev => [...data.messages, ...prev]);
        }
      }
    } catch (error) {
      console.error("Geçmiş çekilemedi:", error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const text = newMessage;
    setNewMessage('');
    isLoadingOldRef.current = false; // Yeni mesaj, alta kaymalı

    try {
      await fetch(`${API_URL}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: activeSession.session_name,
          targetNumber: activeContact.phone_number,
          text: text
        }),
      });
    } catch (error) {
      alert('Mesaj gönderilemedi');
    }
  };

  if (!activeContact) {
    return (
      <div className="flex-1 bg-[#efeae2] flex items-center justify-center text-gray-500 border-l border-gray-300">
        <p>Sohbet seçiniz</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#efeae2]">
      {/* Header */}
      <div className="bg-gray-100 border-b p-3 flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center text-gray-600 font-bold overflow-hidden">
            {activeContact.push_name?.charAt(0) || activeContact.phone_number?.charAt(0)}
          </div>
          <div>
            <div className="font-bold text-gray-800">{activeContact.push_name || activeContact.phone_number}</div>
            <div className="text-xs text-gray-500">{activeContact.phone_number}</div>
          </div>
        </div>
      </div>

      {/* Mesaj Alanı */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-2 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat"
      >
        {/* Daha Eski Yükle Butonu */}
        <div className="flex justify-center mb-4">
          {hasMore ? (
            <button 
              onClick={() => fetchMessages(false)} 
              disabled={loading}
              className="flex items-center gap-2 bg-white/80 hover:bg-white text-gray-600 px-3 py-1 rounded-full text-xs shadow-sm transition border border-gray-200"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <DownloadCloud size={14} />}
              <span>Daha Eski Mesajlar</span>
            </button>
          ) : (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
              Sohbetin başlangıcı
            </span>
          )}
        </div>

        {/* Mesajlar */}
        {messages.map((msg) => (
          <div
            key={msg.id} // UUID olduğu için key olarak güvenli
            className={`flex ${msg.is_outbound ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative 
                ${msg.is_outbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}
              `}
            >
              <p className="text-gray-800 break-all whitespace-pre-wrap leading-relaxed">
                {msg.body}
              </p>
              
              <div className="flex justify-end items-center gap-1 mt-1 select-none">
                <span className="text-[10px] text-gray-500">
                  {new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
                {msg.is_outbound && (
                   <CheckCheck size={14} className="text-blue-500" />
                )}
              </div>
            </div>
          </div>
        ))}
        {/* Otomatik scroll için görünmez div */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Alanı */}
      <div className="bg-gray-100 p-3">
        <form onSubmit={sendMessage} className="flex gap-2 items-center">
          <input
            type="text"
            className="flex-1 p-3 rounded-lg border border-gray-300 focus:outline-none focus:border-green-500 bg-white"
            placeholder="Bir mesaj yazın..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <button type="submit" className="p-3 bg-green-600 text-white rounded-full hover:bg-green-700 transition shadow flex items-center justify-center">
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}