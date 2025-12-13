import { useEffect, useState, useRef } from 'react';
import { X, Search, CheckSquare, Square, RefreshCw, Loader2, Archive } from 'lucide-react';
import io from 'socket.io-client';

// DİNAMİK URL
const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function SelectChatsModal({ session, onClose, onImported }) {
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  
  // Canlı Durum State'leri
  const [importing, setImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [progressCount, setProgressCount] = useState(0);

  const socketRef = useRef(null);

  useEffect(() => {
    if (!session) return;
    fetchChats();

    socketRef.current = io(API_URL, { transports: ['websocket', 'polling'] });

    socketRef.current.on('sync_status', (data) => {
        setStatusMessage(`İşleniyor (${data.current}/${data.total}): ${data.chatName}`);
        setProgressCount(0); // Yeni sohbete geçince sayacı sıfırla
    });

    socketRef.current.on('sync_progress', (data) => {
        setProgressCount(data.count); // Canlı sayı güncellemesi
    });

    socketRef.current.on('sync_complete', (data) => {
        setImporting(false);
        alert(`İşlem Tamamlandı! Seçilen sohbetler başarıyla arşivlendi.`);
        if (onImported) onImported();
        onClose();
    });

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, [session]);

  const fetchChats = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/whatsapp-chats?sessionName=${encodeURIComponent(session.session_name)}`
      );
      const data = await res.json();
      if (data.success) {
        setChats(data.chats || []);
      } else {
        alert('Hata: ' + data.error);
      }
    } catch (err) {
      alert('Sunucu hatası.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (chatId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0) return alert('Seçim yapınız.');
    setImporting(true);
    setStatusMessage('Başlatılıyor...');
    
    try {
      await fetch(`${API_URL}/sync-chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: session.session_name,
          contactIds: Array.from(selected), 
        }),
      });
    } catch (err) {
      alert('Sunucu hatası.');
      setImporting(false);
    }
  };

  const filteredChats = chats.filter((c) => {
    const name = (c.name || c.phone || '').toLowerCase();
    const phone = (c.phone || '').toLowerCase();
    const term = searchTerm.toLowerCase();
    return name.includes(term) || phone.includes(term);
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col relative overflow-hidden">
        
        {/* Yükleme Ekranı (Overlay) */}
        {importing && (
             <div className="absolute inset-0 bg-white/95 z-50 flex flex-col items-center justify-center text-center p-8 animate-in fade-in">
                <div className="bg-green-100 p-4 rounded-full mb-4 animate-pulse">
                    <Archive className="text-green-600" size={40} />
                </div>
                <h3 className="font-bold text-xl text-gray-800 mb-2">{statusMessage}</h3>
                
                <div className="text-3xl font-mono font-bold text-green-600 mb-2">
                    {progressCount}
                </div>
                <p className="text-sm text-gray-500 font-medium">mesaj arşivlendi</p>

                <p className="text-xs text-gray-400 mt-8 max-w-xs bg-gray-50 p-3 rounded-lg border border-gray-100">
                    ⚠️ Spam koruması için insansı hızda işlem yapılıyor. Lütfen pencereyi kapatmayın.
                </p>
             </div>
        )}

        <div className="p-4 border-b flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="font-bold text-gray-800 text-sm">Arşivlenecek Sohbetleri Seç</h2>
            <p className="text-xs text-gray-500">Hat: {session?.session_name}</p>
          </div>
          <button onClick={onClose}><X className="text-gray-400 hover:text-red-500" size={18} /></button>
        </div>

        <div className="p-3 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Sohbet ara..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-xs focus:outline-none focus:border-green-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <Loader2 className="animate-spin" size={24}/>
              <p>Liste yükleniyor...</p>
            </div>
          ) : (
            filteredChats.map((chat) => {
              const uniqueId = chat.id; 
              const isSelected = selected.has(uniqueId);
              return (
                <button
                  key={uniqueId}
                  onClick={() => toggleSelect(uniqueId)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 text-left text-sm transition ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                >
                  <div className={isSelected ? "text-green-600" : "text-gray-300"}>
                    {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 truncate">{chat.name}</div>
                    <div className="text-[11px] text-gray-500 truncate font-mono">{chat.phone}</div>
                  </div>
                  {chat.unread > 0 && <span className="bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full">{chat.unread}</span>}
                </button>
              );
            })
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 flex items-center justify-between text-xs">
          <span className="text-gray-600 font-medium">Seçili: <strong className="text-green-600">{selected.size}</strong></span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border text-gray-600 hover:bg-gray-100">Vazgeç</button>
            <button onClick={handleImport} disabled={selected.size === 0} className="px-6 py-2 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              Arşivlemeyi Başlat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}