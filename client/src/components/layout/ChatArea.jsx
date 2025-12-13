import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, DownloadCloud, CheckCheck, Loader2, FileText, Image, Video, Zap, Save } from 'lucide-react';
import QuickRepliesModal from './QuickRepliesModal';

const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function ChatArea({ activeSession, activeContact }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false); // Kaydetme butonu için state
  const [hasMore, setHasMore] = useState(true); 
  const [isQuickReplyOpen, setIsQuickReplyOpen] = useState(false);
  
  const chatContainerRef = useRef(null); 
  const messagesEndRef = useRef(null);   
  const prevScrollHeightRef = useRef(null);
  const isLoadingOldRef = useRef(false);

  // ... (formatDate, useEffect, useLayoutEffect kısımları AYNI kalabilir)
  // KOD TEKRARINI ÖNLEMEK İÇİN SADECE DEĞİŞEN KISIMLARI VERECEĞİM AMA TAMAMINI İSTERSEN AŞAĞIDA:

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString('tr-TR', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
    });
  };

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
          limit: 50, 
          beforeId: oldestMessageId
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.messages.length < 50) setHasMore(false); 
        setMessages(prev => {
            const newMsgs = data.messages;
            if (isInitialLoad) return newMsgs;
            const existingIds = new Set(prev.map(m => m.whatsapp_id));
            return [...newMsgs.filter(m => !existingIds.has(m.whatsapp_id)), ...prev];
        });
      }
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  // YENİ: MANUEL KAYDETME FONKSİYONU
  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
        // Bu sohbeti tekrar 'syncSelectedChats' ile tetikliyoruz (tek kişilik liste olarak)
        const res = await fetch(`${API_URL}/sync-chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionName: activeSession.session_name,
                contactIds: [activeContact.phone_number]
            })
        });
        const data = await res.json();
        if(data.success) {
            alert('Sohbet arşive kaydedildi.');
            fetchMessages(true); // Ekranı yenile
        } else {
            alert('Hata oluştu.');
        }
    } catch (e) {
        console.error(e);
    } finally {
        setSyncing(false);
    }
  };

  const sendMessage = async (e) => {
    if (e) e.preventDefault();
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

  const handleTemplateSelect = (text) => {
    setNewMessage(text);
    setIsQuickReplyOpen(false);
  };

  const renderMessageContent = (msg) => {
    const fullMediaUrl = msg.media_url ? `${API_URL}${msg.media_url}` : null;

    if (msg.type === 'image' && fullMediaUrl) {
        return (
            <div className="mb-1">
                <img src={fullMediaUrl} alt="Foto" className="rounded-lg max-w-full h-auto object-cover max-h-64 cursor-pointer hover:opacity-90 border border-gray-200" onClick={() => window.open(fullMediaUrl, '_blank')} />
                {msg.body && !msg.body.startsWith('[Dosya:') && <p className="mt-1 text-sm">{msg.body}</p>}
            </div>
        );
    }
    if (msg.type === 'video' && fullMediaUrl) {
        return (<div className="mb-1"><video controls className="max-w-full rounded-lg max-h-64 border border-gray-200"><source src={fullMediaUrl} type={msg.mimetype} /></video></div>);
    }
    if ((msg.type === 'document' || msg.type === 'audio' || msg.type === 'ptt') && fullMediaUrl) {
        const isAudio = msg.type === 'audio' || msg.type === 'ptt';
        return (
            <div onClick={() => window.open(fullMediaUrl, '_blank')} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200 mb-1 hover:bg-gray-100 transition cursor-pointer select-none">
                <div className={`p-2 rounded-full shrink-0 ${isAudio ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>{isAudio ? <Zap size={20} /> : <FileText size={24} />}</div>
                <div className="overflow-hidden min-w-0"><p className="text-sm font-semibold text-gray-800 truncate">{msg.body || (isAudio ? 'Ses Kaydı' : 'Belge')}</p><span className="text-[10px] text-blue-500 font-medium hover:underline block mt-0.5">İndirmek için tıkla</span></div>
            </div>
        );
    }
    return <p className="text-gray-800 break-all whitespace-pre-wrap leading-relaxed">{msg.body}</p>;
  };

  if (!activeContact) return <div className="flex-1 bg-[#efeae2] flex items-center justify-center text-gray-500">Sohbet seçiniz</div>;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#efeae2]">
      {/* Header */}
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
        
        {/* Butonlar Grubu */}
        <div className="flex gap-2">
            {/* KAYDET BUTONU (YENİ) */}
            <button 
                onClick={handleManualSync} 
                disabled={syncing} 
                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-200 rounded-full transition"
                title="Bu sohbeti şimdi arşivle"
            >
                {syncing ? <Loader2 size={20} className="animate-spin"/> : <Save size={20}/>}
            </button>

            <button onClick={() => fetchMessages(false)} disabled={loading} className="p-2 text-gray-500 hover:text-green-600 hover:bg-gray-200 rounded-full">
                <DownloadCloud size={20}/>
            </button>
        </div>
      </div>

      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
        <div className="flex justify-center mb-4">{!hasMore && <span className="text-[10px] bg-gray-100 px-3 py-1 rounded-full">Sohbet Başı</span>}</div>
        {messages.map((msg) => (
          <div key={msg.id} className="flex flex-col">
             <div className="flex justify-center mb-1"><span className="text-[10px] bg-gray-200/60 text-gray-600 px-2 py-0.5 rounded-md backdrop-blur-sm">{formatDate(msg.timestamp)}</span></div>
             <div className={`flex ${msg.is_outbound ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative ${msg.is_outbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                  {renderMessageContent(msg)}
                  <div className="flex justify-end items-center gap-1 mt-1 select-none"><span className="text-[10px] text-gray-500">{new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>{msg.is_outbound && <CheckCheck size={14} className="text-blue-500" />}</div>
                </div>
             </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-gray-100 p-3 flex gap-2 items-center">
        <button onClick={() => setIsQuickReplyOpen(true)} className="p-3 bg-white text-yellow-600 rounded-full hover:bg-yellow-50 border border-gray-200 shadow-sm" title="Hızlı Yanıtlar"><Zap size={20} fill="currentColor" /></button>
        <form onSubmit={sendMessage} className="flex-1 flex gap-2 items-center">
          <input className="flex-1 p-3 rounded-lg border focus:border-green-500 bg-white" placeholder="Mesaj..." value={newMessage} onChange={e => setNewMessage(e.target.value)} />
          <button className="p-3 bg-green-600 text-white rounded-full"><Send size={20}/></button>
        </form>
      </div>

      {isQuickReplyOpen && <QuickRepliesModal onClose={() => setIsQuickReplyOpen(false)} onSelect={handleTemplateSelect} />}
    </div>
  );
}