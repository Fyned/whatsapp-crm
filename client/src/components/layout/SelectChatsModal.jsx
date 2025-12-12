import { useEffect, useState } from 'react';
import { X, Search, CheckSquare, Square, RefreshCw } from 'lucide-react';

// AWS veya Localhost ayarı (Vite environment variable'dan veya direkt string)
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3006' 
  : `http://${window.location.hostname}:3006`;

export default function SelectChatsModal({ session, onClose, onImported }) {
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetchChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.session_name]);

  const fetchChats = async () => {
    setLoading(true);
    try {
      // DÜZELTME 1: Doğru endpoint ve GET isteği
      const res = await fetch(
        `${API_URL}/session-chats?sessionName=${encodeURIComponent(session.session_name)}`
      );
      const data = await res.json();
      
      if (data.success) {
        setChats(data.chats || []);
      } else {
        alert('Sohbetler alınamadı: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Sunucu hatası: sohbet listesi alınamadı.');
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
    try {
      // DÜZELTME 2: Doğru endpoint (/sync-chats) ve parametre isimleri
      const res = await fetch(`${API_URL}/sync-chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: session.session_name,
          contactIds: Array.from(selected), // Backend 'contactIds' bekliyor
          perChatLimit: 20 // Varsayılan limit
        }),
      });
      
      const data = await res.json();
      if (data.success) {
        alert(
          `İşlem Tamamlandı!\nİşlenen Sohbet: ${data.processedChats}\nToplam Mesaj: ${data.totalMessages}`
        );
        if (onImported) onImported();
        onClose();
      } else {
        alert('Import hatası: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Sunucu hatası: sohbetler içe aktarılamadı.');
    } finally {
      setImporting(false);
    }
  };

  const filteredChats = chats.filter((c) => {
    const name = (c.push_name || c.phone_number || '').toLowerCase();
    const phone = (c.phone_number || '').toLowerCase();
    const term = searchTerm.toLowerCase();
    return name.includes(term) || phone.includes(term);
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="font-bold text-gray-800 text-sm">Sohbetleri Seç ve Aktar</h2>
            <p className="text-xs text-gray-500">
              Hat: <span className="font-mono font-medium">{session?.session_name}</span>
            </p>
          </div>
          <button onClick={onClose}>
            <X className="text-gray-400 hover:text-red-500" size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="WhatsApp sohbetlerinde ara..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-green-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <RefreshCw className="animate-spin" size={24}/>
              <p>Sohbet listesi WhatsApp'tan çekiliyor...</p>
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              Görüntülenecek sohbet bulunamadı.
            </div>
          ) : (
            filteredChats.map((chat) => {
              // Chat objesinden ID'yi al (formatId ile temizlenmiş id veya chatId)
              // ChatList componentinden gelen yapıda 'id' temizlenmiş id idi.
              const uniqueId = chat.id; 
              const isSelected = selected.has(uniqueId);
              
              return (
                <button
                  key={uniqueId}
                  type="button"
                  onClick={() => toggleSelect(uniqueId)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 text-left text-sm transition
                    ${isSelected ? 'bg-green-50' : 'hover:bg-gray-50'}
                  `}
                >
                  <div className={isSelected ? "text-green-600" : "text-gray-300"}>
                    {isSelected ? <CheckSquare size={20} /> : <Square size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 truncate">
                        {chat.push_name || chat.phone_number}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate font-mono">
                      {chat.phone_number}
                    </div>
                  </div>
                  {chat.unread > 0 && (
                      <span className="bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                          {chat.unread}
                      </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex items-center justify-between text-xs">
          <span className="text-gray-600 font-medium">
            Seçili: <strong className="text-green-600 text-sm">{selected.size}</strong> sohbet
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition"
            >
              Vazgeç
            </button>
            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="px-6 py-2 rounded-lg bg-green-600 text-white font-bold text-xs hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 transition shadow-lg shadow-green-200"
            >
              {importing && <RefreshCw className="animate-spin" size={14}/>}
              {importing ? 'Aktarılıyor...' : 'Aktarımı Başlat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}