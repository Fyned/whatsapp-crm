import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, DownloadCloud, CheckCheck, Loader2, MessageSquare } from 'lucide-react';

// DİNAMİK URL
const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function ChatArea({ activeSession, activeContact }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true); 
  
  const chatContainerRef = useRef(null); 
  const messagesEndRef = useRef(null);   
  
  const prevScrollHeightRef = useRef(null);
  const isLoadingOldRef = useRef(false);

  // Tarih Formatlayıcı
  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 1. Sıfırdan Yükleme
  useEffect(() => {
    if (activeContact && activeSession) {
      setMessages([]); 
      setHasMore(true);
      fetchMessages(true);
    }
  }, [activeContact, activeSession]);

  // 2. Realtime Dinleme
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
          if (payload.new.contact_id === activeContact.phone_number) {
            isLoadingOldRef.current = false;
            // Ekranda zaten varsa ekleme (Double check)
            setMessages((prev) => {
                if (prev.some(m => m.whatsapp_id === payload.new.whatsapp_id)) return prev;
                return [...prev, payload.new];
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeSession, activeContact]);

  // 3. Scroll Pozisyonunu Koru
  useLayoutEffect(() => {
    if (!chatContainerRef.current) return;

    if (isLoadingOldRef.current && prevScrollHeightRef.current) {
      const newScrollHeight = chatContainerRef.current.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      chatContainerRef.current.scrollTop = diff; 
      isLoadingOldRef.current = false;
    } 
    else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }); 
    }
  }, [messages]);

  const fetchMessages = async (isInitialLoad = false) => {
    if (loading || (!hasMore && !isInitialLoad)) return;
    setLoading(true);

    if (!isInitialLoad && chatContainerRef.current) {
      prevScrollHeightRef.current = chatContainerRef.current.scrollHeight;
      isLoadingOldRef.current = true;
    }

    const oldestMessageId = !isInitialLoad && messages.length > 0 ? messages[0].whatsapp_id : null;

    try {
      const res = await fetch(`${API_URL}/fetch-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: activeSession.session_name,
          contactId: activeContact.phone_number, 
          limit: 20, 
          beforeId: oldestMessageId
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        if (data.messages.length < 20) setHasMore(false); 

        setMessages(prev => {
            const newMsgs = data.messages;
            // Çift mesaj kontrolü (Set kullanarak)
            if (isInitialLoad) return newMsgs;
            
            // Eski mesajları eklerken, zaten listede olanları filtrele
            const existingIds = new Set(prev.map(m => m.whatsapp_id));
            const uniqueNew = newMsgs.filter(m => !existingIds.has(m.whatsapp_id));
            
            return [...uniqueNew, ...prev];
        });
      }
    } catch (error) {
      console.error("Hata:", error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const text = newMessage;
    setNewMessage('');
    isLoadingOldRef.current = false; 

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
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat"
      >
        {/* En Üst Kısım: Buton veya Başlangıç Kutusu */}
        <div className="flex justify-center mb-6">
          {hasMore ? (
            <button 
              onClick={() => fetchMessages(false)} 
              disabled={loading}
              className="flex items-center gap-2 bg-white/90 hover:bg-white text-gray-600 px-4 py-1.5 rounded-full text-xs shadow-md transition border border-gray-200"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <DownloadCloud size={14} />}
              <span>Daha Eski Mesajlar</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2 bg-[#fff5c4] px-6 py-4 rounded-xl shadow-sm border border-[#ffeeba]">
              <div className="bg-[#ffd900] p-2 rounded-full text-yellow-900">
                  <MessageSquare size={18} />
              </div>
              <span className="text-xs font-bold text-yellow-800 uppercase tracking-wide">
                Mesajlaşmanın Başlangıcı
              </span>
              <span className="text-[10px] text-yellow-700">
                Daha eski bir mesaj bulunmuyor.
              </span>
            </div>
          )}
        </div>

        {/* Mesajlar */}
        {messages.map((msg) => (
          <div key={msg.id} className="flex flex-col mb-2">
             
             {/* Tarih ve Saat Her Mesajın Üstünde */}
             <div className="flex justify-center mb-1">
                <span className="text-[10px] bg-gray-200/60 text-gray-600 px-2 py-0.5 rounded-md backdrop-blur-sm">
                    {formatDate(msg.timestamp)}
                </span>
             </div>

             <div className={`flex ${msg.is_outbound ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative 
                    ${msg.is_outbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}
                  `}
                >
                  <p className="text-gray-800 break-all whitespace-pre-wrap leading-relaxed">
                    {msg.body}
                  </p>
                  
                  {/* Tik İşareti (Sadece giden mesajda) */}
                  {msg.is_outbound && (
                    <div className="flex justify-end mt-1">
                       <CheckCheck size={14} className="text-blue-500" />
                    </div>
                  )}
                </div>
             </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
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