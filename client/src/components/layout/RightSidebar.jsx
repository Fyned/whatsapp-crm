import { useState, useEffect } from 'react';
import { Save, X, Tag, Mail, StickyNote, User } from 'lucide-react';

// DİNAMİK URL
const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function RightSidebar({ activeSession, activeContact, onClose, onUpdate }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState(''); // Virgülle ayrılmış string olarak alacağız
  const [loading, setLoading] = useState(false);

  // Kontakt değişince form alanlarını doldur
  useEffect(() => {
    if (activeContact) {
      setName(activeContact.push_name || '');
      setEmail(activeContact.email || '');
      setNotes(activeContact.notes || '');
      setTags(activeContact.tags ? activeContact.tags.join(', ') : '');
    }
  }, [activeContact]);

  const handleSave = async () => {
    setLoading(true);
    try {
      // Virgülle ayrılmış etiketleri diziye çevir
      const tagsArray = tags.split(',').map(t => t.trim()).filter(t => t !== '');

      const updates = {
        push_name: name,
        email: email,
        notes: notes,
        tags: tagsArray
      };

      const res = await fetch(`${API_URL}/update-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.session_name,
          contactId: activeContact.phone_number,
          updates: updates
        })
      });

      const data = await res.json();
      if (data.success) {
        alert('Müşteri bilgileri güncellendi!');
        if (onUpdate) onUpdate(); // Ana ekrandaki listeyi yenilemek için
      } else {
        alert('Hata: ' + data.error);
      }
    } catch (error) {
      console.error(error);
      alert('Kaydedilemedi.');
    } finally {
      setLoading(false);
    }
  };

  if (!activeContact) return null;

  return (
    <div className="w-80 bg-white border-l border-gray-200 h-full flex flex-col shadow-xl z-20">
      {/* Header */}
      <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
        <h3 className="font-bold text-gray-700">Müşteri Kartı</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-red-500">
          <X size={20} />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        
        {/* Profil Resmi & Başlık */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 font-bold text-3xl mb-2">
            {activeContact.push_name?.charAt(0) || activeContact.phone_number?.charAt(0)}
          </div>
          <div className="text-sm font-mono text-gray-500">{activeContact.phone_number}</div>
        </div>

        {/* İsim */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
            <User size={12}/> İsim / Takma Ad
          </label>
          <input 
            className="w-full p-2 border rounded-lg text-sm focus:border-green-500 outline-none"
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Müşteri Adı"
          />
        </div>

        {/* E-posta */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
            <Mail size={12}/> E-Posta
          </label>
          <input 
            className="w-full p-2 border rounded-lg text-sm focus:border-green-500 outline-none"
            value={email} onChange={e => setEmail(e.target.value)}
            placeholder="ornek@firma.com"
          />
        </div>

        {/* Etiketler */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
            <Tag size={12}/> Etiketler (Virgülle ayırın)
          </label>
          <input 
            className="w-full p-2 border rounded-lg text-sm focus:border-green-500 outline-none"
            value={tags} onChange={e => setTags(e.target.value)}
            placeholder="VIP, Yeni, Potansiyel..."
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.split(',').map((tag, i) => tag.trim() && (
              <span key={i} className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                {tag.trim()}
              </span>
            ))}
          </div>
        </div>

        {/* Notlar */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-500 flex items-center gap-1">
            <StickyNote size={12}/> Notlar
          </label>
          <textarea 
            className="w-full p-2 border rounded-lg text-sm focus:border-green-500 outline-none h-32 resize-none"
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Müşteri hakkında notlar..."
          />
        </div>

      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-gray-50">
        <button 
          onClick={handleSave} 
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          <Save size={18} />
          {loading ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
      </div>
    </div>
  );
}