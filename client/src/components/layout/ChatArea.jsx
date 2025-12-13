import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, MoreVertical, Phone, DownloadCloud, History } from 'lucide-react';

const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function ChatArea({ activeSession, activeContact }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Pagination State
  const [targetNumber, setTargetNumber] = useState(''); 
  const [oldestMessageId, setOldestMessageId] = useState(null); // Cursor

  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null); // Scroll pozisyonunu korumak için

  const cleanId = (id) => id ? id.toString().replace(/\D/g, '') : '';

  // Kişi değiştiğinde sıfırla
  useEffect(() => {
    if (activeContact) {
      const num = cleanId(activeContact.id || activeContact.phone_number);
      setTargetNumber(num);
      setOldestMessageId(null); 
      setMessages([]); 
      // İlk 20 mesajı otomatik çek (Opsiyonel, manuel de olabilir)
      // fetchHistory(num, null); 
    }
  }, [activeContact]);

  // Realtime Dinleme (Yeni mesajlar için)
  useEffect(() => {
    if (activeSession && activeContact) {
      const channel = supabase.channel('chat-room')
        .on('postgres_changes', { 
            event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${activeSession.id}` 
          },
          (payload) => {
            const newMsg = payload.new;
            const msgOwner = cleanId(newMsg.contact_id);
            if (msgOwner === targetNumber) {
                setMessages((prev) => [...prev, newMsg]);
                setTimeout(scrollToBottom, 100);
            }
          }
        ).subscribe();

      // Sayfa açılınca mevcut mesajları DB'den çek (Basit başlangıç)
      fetchInitialMessages();

      return () => supabase.removeChannel(channel);
    }
  }, [activeSession, activeContact, targetNumber]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchInitialMessages = async () => {
      // Sadece DB'deki son mesajları getirir
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', activeSession.id)
        .eq('contact_id', targetNumber)
        .order('timestamp', { ascending: true }); // Eskiden yeniye

      if (data && data.length > 0) {
          setMessages(data);
          setOldestMessageId(data[0].whatsapp_id); // En eski mesajın ID'si (Cursor)
          setTimeout(scrollToBottom, 100);
      }
  };

  // --- GEÇMİŞİ İNDİR / DAHA FAZLA YÜKLE ---
  const handleFetchHistory = async () => {
      if (!targetNumber) return;
      setLoadingHistory(true);

      // Scroll pozisyonunu kaydet (Eski mesajlar yüklenince zıplamasın diye)
      const scrollContainer = chatContainerRef.current;
      const scrollHeightBefore = scrollContainer ? scrollContainer.scrollHeight : 0;
      const scrollTopBefore = scrollContainer ? scrollContainer.scrollTop : 0;

      try {
        const res = await fetch(`${API_URL}/fetch-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionName: activeSession.session_name,
                contactId: targetNumber,
                limit: 10, // +10 Mesaj isteği
                beforeId: oldestMessageId // Cursor: Bundan eskileri getir
            })
        });
        
        const data = await res.json();
        
        if (data.success && data.messages.length > 0) {
            // Gelen mesajları mevcutların BAŞINA ekle
            setMessages(prev => {
                // Çakışmaları önle (Aynı ID varsa ekleme)
                const existingIds = new Set(prev.map(m => m.whatsapp_id));
                const uniqueNewMessages = data.messages.filter(m => !existingIds.has(m.whatsapp_id));
                return [...uniqueNewMessages, ...prev];
            });

            // Yeni "En Eski" ID'yi güncelle
            setOldestMessageId(data.messages[0].whatsapp_id);

            // Scroll ayarı: Kullanıcıyı, yüklediği yerde tut
            // (Tam mükemmel olması için useLayoutEffect gerekir ama setTimeout iş görür)
            setTimeout(() => {
                if(scrollContainer) {
                    const scrollHeightAfter = scrollContainer.scrollHeight;
                    scrollContainer.scrollTop = scrollHeightAfter - scrollHeightBefore + scrollTopBefore;
                }
            }, 50);

        } else {
            alert("Daha eski mesaj bulunamadı veya sunucu erişimi yok.");
        }
      } catch (e) { 
          console.error(e);
          alert("Bağlantı hatası.");
      } finally { 
          setLoadingHistory(false); 
      }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const txt = newMessage;
    setNewMessage(''); 
    try {
        await fetch(`${API_URL}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionName: activeSession.session_name,
                targetNumber: targetNumber, 
                text: txt
            })
        });
    } catch (err) { alert("Mesaj gönderilemedi."); }
  };

  if (!activeContact) return <div className="flex-1 bg-[#efeae2] flex items-center justify-center text-gray-500">Sohbet Seçin</div>;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#efeae2]">
      {/* ÜST BAR */}
      <div className="bg-gray-100 border-b shadow-sm z-10">
        <div className="p-3 flex justify-between items-center border-b border-gray-200">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center font-bold text-gray-600">
                    {activeContact.push_name?.charAt(0) || '#'}
                </div>
                <div>
                    <div className="font-bold text-gray-800">{activeContact.push_name || activeContact.phone_number}</div>
                    <div className="text-xs text-gray-500">{activeContact.phone_number}</div>
                </div>
            </div>
            {/* GEÇMİŞİ İNDİR BUTONU */}
            <button 
                onClick={handleFetchHistory} 
                disabled={loadingHistory}
                className="flex items-center gap-2 bg-white text-green-700 px-3 py-1.5 rounded-lg border border-green-200 text-xs font-bold hover:bg-green-50 transition shadow-sm disabled:opacity-50"
            >
                {loadingHistory ? <span className="animate-spin">⌛</span> : <DownloadCloud size={16}/>}
                <span>{oldestMessageId ? "+10 Mesaj Daha" : "Geçmişi İndir"}</span>
            </button>
        </div>
      </div>

      {/* MESAJ ALANI */}
      <div 
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat"
        ref={chatContainerRef}
      >
        {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === 'outbound' || msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative wrap-break-word ${msg.sender === 'me' ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    <p className="text-gray-800 leading-relaxed">{msg.body}</p>
                    <span className="text-[10px] text-gray-500 block text-right mt-1 opacity-70">
                        {new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                </div>
            </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* MESAJ YAZMA */}
      <div className="bg-gray-100 p-3">
        <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
            <input className="flex-1 p-3 rounded-lg border bg-white focus:outline-none focus:border-green-500" placeholder="Bir mesaj yazın..." value={newMessage} onChange={e => setNewMessage(e.target.value)}/>
            <button className="p-3 bg-green-600 text-white rounded-full hover:bg-green-700 shadow-md"><Send size={20}/></button>
        </form>
      </div>
    </div>
  );
}