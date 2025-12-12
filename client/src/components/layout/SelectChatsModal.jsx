import { useEffect, useState } from 'react';
import { X, Search, CheckSquare, Square } from 'lucide-react';

const API_URL = "http://localhost:3006";

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
      const res = await fetch(`${API_URL}/list-chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName: session.session_name }),
      });
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
      const res = await fetch(`${API_URL}/import-chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionName: session.session_name,
          chatIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(
          `Sohbet import tamamlandı. İşlenen sohbet sayısı: ${data.count}/${data.total}`
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
    const name = (c.push_name || c.name || '').toLowerCase();
    const phone = (c.number || '').toLowerCase();
    const term = searchTerm.toLowerCase();
    return name.includes(term) || phone.includes(term);
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="font-bold text-gray-800 text-sm">Sohbetleri Senkronize Et</h2>
            <p className="text-xs text-gray-500">
              Hat: <span className="font-mono">{session?.session_name}</span>
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
            <div className="p-6 text-center text-gray-400 text-sm">
              Sohbetler yükleniyor...
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              Aktif sohbet bulunamadı.
            </div>
          ) : (
            filteredChats.map((chat) => {
              const isSelected = selected.has(chat.chatId);
              const title = chat.push_name || chat.name || chat.number || chat.cleanContactId;
              return (
                <button
                  key={chat.chatId}
                  type="button"
                  onClick={() => toggleSelect(chat.chatId)}
                  className="w-full flex items-center gap-3 px-4 py-2 border-b border-gray-100 hover:bg-gray-50 text-left text-sm"
                >
                  <div className="text-green-600">
                    {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 truncate">{title}</div>
                    <div className="text-[11px] text-gray-500 truncate font-mono">
                      {chat.number || chat.cleanContactId}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex items-center justify-between text-xs">
          <span className="text-gray-500">
            Seçili sohbet: <strong>{selected.size}</strong>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              İptal
            </button>
            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold text-xs hover:bg-green-700 disabled:opacity-50"
            >
              {importing ? 'Aktarılıyor...' : 'Seçilenleri İçe Aktar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
