import { useState, useEffect } from 'react';
import { X, Plus, Trash2, MessageSquareText } from 'lucide-react';

const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function QuickRepliesModal({ onClose, onSelect }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchReplies();
  }, []);

  const fetchReplies = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/quick-replies`);
      const data = await res.json();
      if (data.success) setReplies(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newTitle || !newMessage) return alert('Başlık ve mesaj zorunludur.');
    try {
      await fetch(`${API_URL}/quick-replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, message: newMessage })
      });
      setNewTitle('');
      setNewMessage('');
      setIsAdding(false);
      fetchReplies();
    } catch (e) { alert('Hata oluştu'); }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Silmek istediğinize emin misiniz?')) return;
    try {
      await fetch(`${API_URL}/delete-quick-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      fetchReplies();
    } catch (e) { alert('Hata'); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-700 flex items-center gap-2">
            <MessageSquareText size={20}/> Hızlı Yanıtlar
          </h3>
          <button onClick={onClose}><X className="text-gray-400 hover:text-red-500"/></button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isAdding && (
            <div className="bg-green-50 p-4 rounded-lg border border-green-200 mb-4">
              <input 
                className="w-full mb-2 p-2 border rounded text-sm" 
                placeholder="Başlık (Örn: IBAN)" 
                value={newTitle} onChange={e => setNewTitle(e.target.value)}
              />
              <textarea 
                className="w-full mb-2 p-2 border rounded text-sm resize-none h-20" 
                placeholder="Mesaj içeriği..." 
                value={newMessage} onChange={e => setNewMessage(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setIsAdding(false)} className="px-3 py-1 text-sm text-gray-500 hover:bg-gray-100 rounded">İptal</button>
                <button onClick={handleAdd} className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700">Kaydet</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center text-gray-400 text-sm">Yükleniyor...</div>
          ) : replies.length === 0 && !isAdding ? (
            <div className="text-center text-gray-400 text-sm py-10">Henüz kayıtlı şablon yok.</div>
          ) : (
            replies.map(reply => (
              <div 
                key={reply.id} 
                onClick={() => onSelect(reply.message)}
                className="group border border-gray-100 rounded-lg p-3 hover:bg-gray-50 hover:border-green-200 cursor-pointer transition relative"
              >
                <div className="font-bold text-gray-800 text-sm mb-1">{reply.title}</div>
                <div className="text-xs text-gray-500 line-clamp-2">{reply.message}</div>
                
                <button 
                  onClick={(e) => handleDelete(reply.id, e)}
                  className="absolute top-3 right-3 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 rounded-b-xl">
          <button 
            onClick={() => setIsAdding(true)}
            className="w-full py-2 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-green-500 hover:text-green-600 transition flex items-center justify-center gap-2 text-sm font-bold"
          >
            <Plus size={18} /> Yeni Şablon Ekle
          </button>
        </div>
      </div>
    </div>
  );
}