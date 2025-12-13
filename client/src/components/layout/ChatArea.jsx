import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Send, DownloadCloud } from 'lucide-react';

const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function ChatArea({ activeSession, activeContact }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [targetNumber, setTargetNumber] = useState(''); 
  const [oldestMessageId, setOldestMessageId] = useState(null);

  const messagesEndRef = useRef(null);

  const cleanId = (id) => id ? id.toString().replace(/\D/g, '') : '';

  useEffect(() => {
    if (activeContact) {
      const num = cleanId(activeContact.id || activeContact.phone_number);
      setTargetNumber(num);
      setOldestMessageId(null); 
      setMessages([]); 
      fetchInitialMessages(num);
    }
  }, [activeContact]);

  const fetchInitialMessages = async (contactId) => {
      const { data } = await supabase.from('messages')
        .select('*')
        .eq('session_id', activeSession.id)
        .eq('contact_id', contactId)
        .order('timestamp', { ascending: true }); // Eskiden yeniye

      if (data && data.length > 0) {
          setMessages(data);
          setOldestMessageId(data[0].whatsapp_id); 
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      }
  };

  const handleFetchHistory = async () => {
      if (!targetNumber) return;
      setLoadingHistory(true);

      try {
        const res = await fetch(`${API_URL}/fetch-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionName: activeSession.session_name,
                contactId: targetNumber,
                limit: 10, 
                beforeId: oldestMessageId
            })
        });
        
        const data = await res.json();
        
        if (data.success && data.messages.length > 0) {
            setMessages(prev => {
                const existingIds = new Set(prev.map(m => m.whatsapp_id));
                const uniqueNew = data.messages.filter(m => !existingIds.has(m.whatsapp_id));
                return [...uniqueNew, ...prev];
            });
            setOldestMessageId(data.messages[0].whatsapp_id);
        } else {
            alert("Daha eski mesaj bulunamadı.");
        }
      } catch (e) { console.error(e); } 
      finally { setLoadingHistory(false); }
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

  // Realtime
  useEffect(() => {
    if (activeSession && targetNumber) {
      const channel = supabase.channel('chat-room')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${activeSession.id}` },
          (payload) => {
            if (cleanId(payload.new.contact_id) === targetNumber) {
                setMessages(prev => [...prev, payload.new]);
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
            }
          }
        ).subscribe();
      return () => supabase.removeChannel(channel);
    }
  }, [activeSession, targetNumber]);

  if (!activeContact) return <div className="flex-1 bg-[#efeae2] flex items-center justify-center text-gray-500">Sohbet Seçin</div>;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#efeae2]">
      <div className="bg-gray-100 border-b p-3 flex justify-between items-center z-10 shadow-sm">
        <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center font-bold text-gray-600">
                {activeContact.push_name?.charAt(0) || '#'}
            </div>
            <div>
                <div className="font-bold text-gray-800">{activeContact.push_name || activeContact.phone_number}</div>
                <div className="text-xs text-gray-500">{activeContact.phone_number}</div>
            </div>
        </div>
        <button onClick={handleFetchHistory} disabled={loadingHistory} className="flex items-center gap-2 bg-white text-green-700 px-3 py-1.5 rounded-lg border border-green-200 text-xs font-bold hover:bg-green-50 transition shadow-sm disabled:opacity-50">
            {loadingHistory ? <span className="animate-spin">⌛</span> : <DownloadCloud size={16}/>}
            <span>{oldestMessageId ? "Daha Eski (+10)" : "Geçmişi İndir"}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
         {messages.length === 0 && <div className="text-center text-gray-400 text-sm mt-10">Henüz mesaj yok.</div>}
         {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.is_outbound ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative wrap-break-word ${msg.is_outbound ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    <p className="text-gray-800 leading-relaxed">{msg.body}</p>
                    <span className="text-[10px] text-gray-500 block text-right mt-1 opacity-70">
                        {new Date(msg.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                </div>
            </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-gray-100 p-3">
        <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
            <input className="flex-1 p-3 rounded-lg border bg-white focus:outline-none focus:border-green-500" placeholder="Mesaj yaz..." value={newMessage} onChange={e => setNewMessage(e.target.value)}/>
            <button className="p-3 bg-green-600 text-white rounded-full hover:bg-green-700 shadow-md"><Send size={20}/></button>
        </form>
      </div>
    </div>
  );
}