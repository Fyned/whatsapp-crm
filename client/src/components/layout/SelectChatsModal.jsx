import { useEffect, useState, useRef } from 'react';
import { X, Search, CheckSquare, Square, RefreshCw, Loader2 } from 'lucide-react';
import io from 'socket.io-client'; // Socket ekledik

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
  const [progress, setProgress] = useState(null);

  const socketRef = useRef(null);

  useEffect(() => {
    if (!session) return;
    fetchChats();

    // Socket Bağlantısı
    socketRef.current = io(API_URL, { transports: ['websocket', 'polling'] });

    // 1. Genel Durum
    socketRef.current.on('sync_status', (data) => {
        setStatusMessage(`İşleniyor (${data.current}/${data.total}): ${data.chatName}`);
    });

    // 2. Mesaj Sayacı
    socketRef.current.on('sync_progress', (data) => {
        setProgress(`${data.count} mesaj arşivlendi...`);
    });

    // 3. Bitiş
    socketRef.current.on('sync_complete', (data) => {
        setImporting(false);
        setStatusMessage('');
        setProgress(null);
        alert(`İşlem Tamamlandı! Toplam ${data.total} sohbet başarıyla arşivlendi.`);
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
        alert('Sohbetler alınamadı: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Hata.');
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
    if (selected.size === 0) {
      alert('En az bir sohbet seçmelisiniz.');
      return;
    }
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
      // Cevap hemen döner, asıl iş Socket ile takip edilir.
    } catch (err) {
      console.error(err);
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="font-bold text-gray-800 text-sm">Sohbetleri Seç ve Arşivle</h2>
            <p className="text-xs text-gray-500">Hat: {session?.session_name}</p>
          </div>
          <button onClick={onClose}><X className="text-gray-400 hover:text-red-500" size={18} /></button>
        </div>

        <div className="p-3 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Ara..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-xs focus:outline-none focus:border-green-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto relative">
          {importing && (
             <div className="absolute inset-0 bg-white/90 z-10 flex flex-col items-center justify-center text-center p-6">
                <Loader2 className="animate-spin text-green-600 mb-3" size={40} />
                <h3 className="font-bold text-gray-800">{statusMessage}</h3>
                <p className="text-sm text-gray-500 mt-1 font-mono">{progress}</p>
                <p className="text-xs text-gray-400 mt-4 max-w-xs">
                    Sohbet geçmişi derinlemesine taranıyor. Bu işlem mesaj sayısına göre zaman alabilir. Lütfen pencereyi kapatmayın.
                </p>
             </div>
          )}

          {loading ? (
            <div className="p-10 text-center text-gray-400 text-sm">Yükleniyor...</div>
          ) : (
            filteredChats.map((chat) => {
              const uniqueId = chat.id; 
              const isSelected = selected.has(uniqueId);
              return (
                <button
                  key={uniqueId}
                  onClick={() => toggleSelect(uniqueId)}
                  disabled={importing}
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
            <button onClick={onClose} disabled={importing} className="px-4 py-2 rounded-lg border text-gray-600 hover:bg-gray-100">Vazgeç</button>
            <button onClick={handleImport} disabled={importing || selected.size === 0} className="px-6 py-2 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              {importing ? 'Arşivleniyor...' : 'Arşivlemeyi Başlat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}