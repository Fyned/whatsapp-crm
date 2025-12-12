import { useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import ChatList from '../components/layout/ChatList';
import ChatArea from '../components/layout/ChatArea';
import AddSessionModal from '../components/layout/AddSessionModal';

export default function Dashboard() {
  const [activeSession, setActiveSession] = useState(null);
  const [activeContact, setActiveContact] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const handleSessionChange = (session) => {
    setActiveSession(session);
    setActiveContact(null);
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Sol Menü */}
      <Sidebar
        activeSessionId={activeSession?.id}
        onSelectSession={handleSessionChange}
        onAddNew={() => setIsAddModalOpen(true)}
      />

      {/* Orta Menü */}
      {activeSession ? (
        <ChatList
          activeSession={activeSession}
          activeContactId={activeContact?.id}
          onSelectContact={(contact) => setActiveContact(contact)}
        />
      ) : (
        <div className="w-80 bg-white border-r flex items-center justify-center text-gray-400 text-sm">
          Hat seçiniz
        </div>
      )}

      {/* Sağ Ekran */}
      <ChatArea
        activeSession={activeSession}
        activeContact={activeContact}
      />

      {/* QR Modal */}
      {isAddModalOpen && (
        <AddSessionModal
          onClose={() => setIsAddModalOpen(false)}
        />
      )}
    </div>
  );
}
