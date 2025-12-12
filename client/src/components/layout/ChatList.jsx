import { useState, useEffect } from 'react';
import { User, Search, RefreshCw } from 'lucide-react';
import SelectChatsModal from './SelectChatsModal';

// GARANTİ ÇÖZÜM: IP Adresini direkt yazıyoruz.
const API_URL = "http://16.171.142.245:3006";

export default function ChatList({
  activeSession,
  onSelectContact,
  activeContactId,
}) {
  const [contacts, setContacts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Modal kontrolü
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);

  useEffect(() => {
    if (activeSession) {
      fetchContacts();
    } else {
      setContacts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);

  const fetchContacts = async () => {
    if (!activeSession) return;

    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/session-chats?sessionName=${encodeURIComponent(
          activeSession.session_name
        )}`
      );
      const data = await res.json();
      if (data.success) {
        setContacts(data.chats || []);
      } else {
        console.error('Sohbet listesi hatası:', data.error);
      }
    } catch (err) {
      console.error('Sohbet listesi hatası:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredContacts = contacts.filter(
    (c) =>
      (c.push_name || '')
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      (c.phone_number || '').includes(searchTerm)
  );

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Arama Çubuğu */}
      <div className="p-4 border-b bg-gray-50">
        <div className="relative">
          <Search
            className="absolute left-3 top-2.5 text-gray-400"
            size={18}
          />
          <input
            type="text"
            placeholder="Sohbetlerde ara..."
            className="w-full pl-10 p-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-green-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Başlık + İçe Aktar butonu */}
      <div className="px-4 py-2 border-b bg-white flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">
          Sohbetler ({contacts.length})
        </span>
        <button
          onClick={() => setIsSelectModalOpen(true)}
          disabled={!activeSession}
          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 disabled:opacity-50"
          title="Sohbetleri seç ve içe aktar"
        >
          <RefreshCw size={14} />
          <span>İçe Aktar</span>
        </button>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-400 text-sm">
            Sohbetler yükleniyor...
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="p-4 text-center text-gray-400 text-sm">
            Henüz sohbet bulunamadı.
          </div>
        ) : (
          filteredContacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => onSelectContact(contact)}
              className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition border-b border-gray-50
                ${
                  activeContactId === contact.id
                    ? 'bg-green-50 border-l-4 border-l-green-500'
                    : ''
                }
              `}
            >
              <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-500">
                <User size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-800 truncate">
                  {contact.push_name || contact.phone_number}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {contact.phone_number}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* SEÇİMLİ IMPORT MODALI */}
      {isSelectModalOpen && (
        <SelectChatsModal
          session={activeSession}
          onClose={() => setIsSelectModalOpen(false)}
          onImported={() => {
            fetchContacts(); // Import bitince listeyi yenile
          }}
        />
      )}
    </div>
  );
}