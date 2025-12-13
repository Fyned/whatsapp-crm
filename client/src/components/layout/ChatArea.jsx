import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, DownloadCloud, CheckCheck, Loader2, File, Image } from 'lucide-react';

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

  useEffect(() => {
    if (activeContact && activeSession) {
      setMessages([]); 
      setHasMore(true);
      fetchMessages(true);
    }
  }, [activeContact, activeSession]);

  useEffect(() => {
    if (!activeSession || !activeContact) return;
    const channel = supabase.channel('chat_updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${activeSession.id}` },
        (payload) => {
          if (payload.new.contact_id === activeContact.phone_number) {
            isLoadingOldRef.current = false;
            setMessages((prev) => {
                if (prev.some(m => m.whatsapp_id === payload.new.whatsapp_id)) return prev;
                return [...prev, payload.new];
            });
          }
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSession, activeContact]);

  useLayoutEffect(() => {
    if (!chatContainerRef.current) return;
    if (isLoadingOldRef.current && prevScrollHeightRef.current) {
      const diff = chatContainerRef.current.scrollHeight - prevScrollHeightRef.current;
      chatContainerRef.current.scrollTop = diff; 
      isLoadingOldRef.current = false;
    } else {
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
            if (isInitialLoad) return newMsgs;
            const existingIds = new Set(prev.map(m => m.whatsapp_id));
            return [...newMsgs.filter(m => !existingIds.has(m.whatsapp_id)), ...prev];
        });
      }
    } catch (error) { console.error(error); } finally { setLoading(false); }
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
    } catch (error) { alert('Hata'); }
  };

  // --- MEDYA RENDER FONKSİYONU ---
  const renderMessageContent = (msg) => {
    // 1. Resim (Image)
    if (msg.type === 'image' && msg.media_url) {
        return (
            <div className="mb-1">
                <img 
                    src={`${API_URL}${msg.media_url}`} 
                    alt="Gelen Resim" 
                    className="rounded-lg max-w-full h-auto object-cover max-h-60 cursor-pointer hover:opacity-90 border border-gray-200"
                    onClick={() => window.open(`${API_URL}${msg.media_url}`, '_blank')}
                />
                {msg.body && <p className="mt-1 text-sm">{msg.body}</p>}
            </div>
        );
    }
    // 2. Ses, Video vb. (Şimdilik Dosya Linki)
    if ((msg.type === 'video' || msg.type === 'document' || msg.type === 'audio') && msg.media_url) {
        return (
            <div className="flex items-center gap-2 bg-gray-100 p-2 rounded mb-1 border border-gray-200">
                <File size={20} className="text-gray-500" />
                <a href={`${API_URL}${msg.media_url}`} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs break-all">
                    Dosyayı Görüntüle ({msg.type})
                </a>
            </div>
        );
    }
    // 3. Normal Metin
    return <p className="text-gray-800 break-all whitespace-pre-wrap leading-relaxed">{msg.body}</p>;
  };

  if (!activeContact) return <div className="flex-1 bg-[#efeae2] flex items-center justify-center text-gray-500">Sohbet seçiniz</div>;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#efeae2]">
      <div className="bg-gray-100 border-b p-3 flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-300 rounded-full flex justify-center items-center font-bold text-gray-600">
            {activeContact.push_name?.charAt(0)}
          </div>
          <div>
            <div className="font-bold text-gray-800">{activeContact.push_name}</div>
            <div className="text-xs text-gray-500">{activeContact.phone_number}</div>
          </div>
        </div>
        <button onClick={() => fetchMessages(false)} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-200 rounded-full"><DownloadCloud size={20}/></button>
      </div>

      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
        <div className="flex justify-center mb-4">{!hasMore && <span className="text-[10px] bg-gray-100 px-3 py-1 rounded-full">Sohbet Başı</span>}</div>
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.is_outbound ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative ${msg.is_outbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
              
              {renderMessageContent(msg)}

              <div className="flex justify-end items-center gap-1 mt-1 select-none">
                <span className="text-[10px] text-gray-500">
                  {new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
                {msg.is_outbound && <CheckCheck size={14} className="text-blue-500" />}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-gray-100 p-3">
        <form onSubmit={sendMessage} className="flex gap-2 items-center">
          <input className="flex-1 p-3 rounded-lg border focus:border-green-500 bg-white" placeholder="Mesaj..." value={newMessage} onChange={e => setNewMessage(e.target.value)} />
          <button className="p-3 bg-green-600 text-white rounded-full"><Send size={20}/></button>
        </form>
      </div>
    </div>
  );
}