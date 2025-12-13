import { useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import ChatList from '../components/layout/ChatList';
import ChatArea from '../components/layout/ChatArea';
import AddSessionModal from '../components/layout/AddSessionModal';
import RightSidebar from '../components/layout/RightSidebar';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';

export default function Dashboard() {
  const [activeSession, setActiveSession] = useState(null);
  const [activeContact, setActiveContact] = useState(null);
  
  // Modal Yönetimi
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [qrSessionName, setQrSessionName] = useState(null); // Düzenlenecek/QR gösterilecek session

  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);

  const handleSessionChange = (session) => {
    setActiveSession(session);
    setActiveContact(null);
    setIsRightSidebarOpen(false);
  };

  const handleContactSelect = (contact) => {
    setActiveContact(contact);
  };

  // Yeni Hat Ekleme
  const openNewSessionModal = () => {
    setQrSessionName(null); // Yeni
    setIsAddModalOpen(true);
  };

  // Mevcut Hattın QR'ını Göster
  const openQrModal = (sessionName) => {
    setQrSessionName(sessionName); // Mevcut
    setIsAddModalOpen(true);
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar
        activeSessionId={activeSession?.id}
        onSelectSession={handleSessionChange}
        onAddNew={openNewSessionModal}
        onShowQR={openQrModal} // Bu prop'u ekledik
      />

      {activeSession ? (
        <ChatList
          activeSession={activeSession}
          activeContactId={activeContact?.id}
          onSelectContact={handleContactSelect}
        />
      ) : (
        <div className="w-80 bg-white border-r flex items-center justify-center text-gray-400 text-sm">
          Hat seçiniz
        </div>
      )}

      <div className="flex-1 flex flex-col relative">
        {activeContact && (
            <div className="absolute top-3 right-4 z-50">
                <button 
                    onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
                    className="p-2 bg-white shadow-md rounded-full text-gray-600 hover:text-green-600 border border-gray-200 transition"
                >
                    {isRightSidebarOpen ? <PanelRightClose size={20}/> : <PanelRightOpen size={20}/>}
                </button>
            </div>
        )}

        <ChatArea
            activeSession={activeSession}
            activeContact={activeContact}
        />
      </div>

      {isRightSidebarOpen && activeContact && (
        <RightSidebar 
            activeSession={activeSession}
            activeContact={activeContact}
            onClose={() => setIsRightSidebarOpen(false)}
        />
      )}

      {/* QR MODAL */}
      {isAddModalOpen && (
        <AddSessionModal
          onClose={() => setIsAddModalOpen(false)}
          initialSessionName={qrSessionName} // Varsa ismi gönder
        />
      )}
    </div>
  );
}