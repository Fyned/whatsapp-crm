import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, MoreVertical, Phone, DownloadCloud, History } from 'lucide-react';

export default function ChatArea({ activeSession, activeContact }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  const [loadingHistory, setLoadingHistory] = useState(false);
  const [targetNumber, setTargetNumber] = useState('');

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Yardımcı: sadece rakam
  const cleanId = (id) => (id ? id.toString().replace(/\D/g, '') : '');

  // Aktif kişi değişince state reset
  useEffect(() => {
    if (activeContact) {
      const num = cleanId(activeContact.id || activeContact.phone_number);
      setTargetNumber(num);
      setMessages([]);
    }
  }, [activeContact]);

  // Mesajları çek + realtime dinle
  useEffect(() => {
    if (activeSession && activeContact) {
      fetchMessages();

      const channel = supabase
        .channel('chat-room')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `session_id=eq.${activeSession.id}`,
          },
          (payload) => {
            const newMsg = payload.new;

            const msgOwner = cleanId(newMsg.contact_id);
            const currentChatOwner = cleanId(
              activeContact.id || activeContact.phone_number
            );

            if (msgOwner === currentChatOwner) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                const updated = [...prev, newMsg];
                updated.sort((a, b) => a.timestamp - b.timestamp);
                return updated;
              });
              setTimeout(scrollToBottom, 100);
            }
          }
        )
        .subscribe();

      return () => supabase.removeChannel(channel);
    }
  }, [activeSession, activeContact]);

  // Supabase'ten mesaj çek
  const fetchMessages = async () => {
    if (!activeSession || !activeContact) return;

    const contactIdClean = cleanId(
      activeContact.id || activeContact.phone_number
    );

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', activeSession.id)
      .eq('contact_id', contactIdClean)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Mesaj sorgu hatası:', error.message);
      return;
    }

    if (data) {
      setMessages(data);
      setTimeout(scrollToBottom, 100);
    }
  };

  // "Geçmişten 10 Mesaj Daha Yükle" butonu
  const handleFetchHistory = async () => {
    if (!activeSession || !targetNumber) {
      return alert('Geçmiş için aktif sohbet ve numara gerekli.');
    }

    const nextLimit = (messages?.length || 0) + 10;

    setLoadingHistory(true);
    try {
      const res = await fetch('http://localhost:3006/fetch-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: activeSession.session_name,
          contactId: targetNumber,
          limit: nextLimit,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // data.count = WhatsApp tarafından çekilen toplam satır
        await fetchMessages();
      } else {
        alert('Hata: ' + data.error);
      }
    } catch (e) {
      console.error(e);
      alert('Sunucu bağlantı hatası.');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeSession || !targetNumber) return;

    const txt = newMessage;
    setNewMessage('');

    try {
      await fetch('http://localhost:3006/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: activeSession.session_name,
          targetNumber: targetNumber,
          text: txt,
        }),
      });
    } catch (err) {
      console.error(err);
      alert('Mesaj gönderilemedi.');
    }
  };

  if (!activeContact) {
    return (
      <div className="flex-1 bg-[#efeae2] flex items-center justify-center text-gray-500">
        <p>Mesajlaşmaya başlamak için soldan bir kişi seçin.</p>
      </div>
    );
  }

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
              <div className="font-bold text-gray-800">
                {activeContact.push_name ||
                  activeContact.name ||
                  activeContact.phone_number}
              </div>
              <div className="text-xs text-gray-500">
                {activeContact.phone_number}
              </div>
            </div>
          </div>
          <div className="flex gap-3 text-gray-600">
            <Phone
              size={20}
              className="cursor-pointer hover:text-green-600"
            />
            <MoreVertical
              size={20}
              className="cursor-pointer hover:text-gray-800"
            />
          </div>
        </div>

        {/* GEÇMİŞ YÜKLEME PANELİ */}
        <div className="bg-white p-2 flex items-center justify-between px-4 shadow-inner">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <History size={16} />
            <span className="font-medium hidden md:inline">
              Geçmiş:
            </span>
            <input
              className="border rounded px-2 py-1 w-32 text-gray-700 bg-gray-50 text-xs font-mono"
              value={targetNumber}
              disabled
              title="İşlem yapılan numara"
            />
          </div>
          <button
            onClick={handleFetchHistory}
            disabled={loadingHistory}
            className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 border border-green-200 text-xs font-bold transition disabled:opacity-50"
          >
            {loadingHistory ? (
              <span className="animate-spin">⌛</span>
            ) : (
              <DownloadCloud size={14} />
            )}
            <span>Geçmişten 10 Mesaj Daha Yükle</span>
          </button>
        </div>
      </div>

      {/* MESAJ ALANI */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
        {messages.length === 0 && (
          <div className="text-center mt-10 opacity-80">
            <div className="bg-white px-4 py-2 rounded-lg shadow inline-block text-xs text-gray-500">
              Henüz görüntülenen mesaj yok. <br />
              “Geçmişten 10 Mesaj Daha Yükle” butonuna basarak eski
              mesajları çekebilirsiniz.
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.direction === 'outbound'
                ? 'justify-end'
                : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative wrap-break-word
                ${
                  msg.direction === 'outbound'
                    ? 'bg-[#d9fdd3] rounded-tr-none'
                    : 'bg-white rounded-tl-none'
                }
              `}
            >
              <p className="text-gray-800 leading-relaxed wrap-break-word">
                {msg.body}
              </p>
              <span className="text-[10px] text-gray-500 block text-right mt-1 opacity-70">
                {new Date(msg.timestamp * 1000).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* MESAJ YAZMA */}
      <div className="bg-gray-100 p-3">
        <form
          onSubmit={handleSendMessage}
          className="flex gap-2 items-center"
        >
          <input
            className="flex-1 p-3 rounded-lg border border-gray-300 focus:outline-none focus:border-green-500 bg-white"
            placeholder="Bir mesaj yazın..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <button className="p-3 bg-green-600 text-white rounded-full hover:bg-green-700 shadow-md transition transform active:scale-95">
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
