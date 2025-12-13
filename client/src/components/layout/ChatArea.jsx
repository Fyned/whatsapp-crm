import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, DownloadCloud, CheckCheck } from 'lucide-react';

// DİNAMİK URL
const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function ChatArea({ activeSession, activeContact }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef(null);

  // Aktif kişi veya oturum değiştiğinde mesajları sıfırla ve çek
  useEffect(() => {
    if (activeContact && activeSession) {
      setMessages([]); 
      fetchMessages();
    }
  }, [activeContact, activeSession]);

  // Realtime Dinleme (Canlı Mesaj Akışı)
  useEffect(() => {
    if (!activeSession || !activeContact) return;

    const channel = supabase.channel('chat_updates')
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: `session_id=eq.${activeSession.id}` // Sadece bu oturuma ait mesajlar
        },
        (payload) => {
          // Gelen mesaj şu an açık olan kişiye mi ait?
          if (payload.new.contact_id === activeContact.phone_number) {
            setMessages((prev) => [...prev, payload.new]);
            scrollToBottom();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSession, activeContact]);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/fetch-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: activeSession.session_name,
          contactId: activeContact.phone_number, 
          limit: 50
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages);
        scrollToBottom();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const text = newMessage;
    setNewMessage(''); // Inputu hemen temizle

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

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
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
        <button 
          onClick={fetchMessages} 
          disabled={loading} 
          className="text-gray-500 hover:text-green-600 p-2 rounded-full hover:bg-gray-200 transition"
          title="Geçmişi Yenile"
        >
          <DownloadCloud size={20} />
        </button>
      </div>

      {/* Mesaj Alanı */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.is_outbound ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative 
                ${msg.is_outbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}
              `}
            >
              {/* DÜZELTME: break-words yerine break-all kullanıldı */}
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