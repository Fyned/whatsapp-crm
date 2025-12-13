import { useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import ChatList from '../components/layout/ChatList';
import ChatArea from '../components/layout/ChatArea';
import AddSessionModal from '../components/layout/AddSessionModal';
import RightSidebar from '../components/layout/RightSidebar'; // Yeni ekledik
import { PanelRightOpen, PanelRightClose } from 'lucide-react'; // İkonlar

export default function Dashboard() {
  const [activeSession, setActiveSession] = useState(null);
  const [activeContact, setActiveContact] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false); // Sağ menü durumu

  const handleSessionChange = (session) => {
    setActiveSession(session);
    setActiveContact(null);
    setIsRightSidebarOpen(false);
  };

  const handleContactSelect = (contact) => {
    setActiveContact(contact);
    // Yeni bir kişi seçilince sağ menüyü otomatik açmak istersen burayı true yapabilirsin
    // setIsRightSidebarOpen(true); 
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* 1. Sol Menü (Hatlar) */}
      <Sidebar
        activeSessionId={activeSession?.id}
        onSelectSession={handleSessionChange}
        onAddNew={() => setIsAddModalOpen(true)}
      />

      {/* 2. Orta Menü (Sohbet Listesi) */}
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

      {/* 3. Ana Ekran (Chat Area) */}
      <div className="flex-1 flex flex-col relative">
        {/* Sağ Menü Aç/Kapa Butonu (ChatArea'nın Header'ında da olabilir ama burada global tutuyoruz) */}
        {activeContact && (
            <div className="absolute top-3 right-4 z-50">
                <button 
                    onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
                    className="p-2 bg-white shadow-md rounded-full text-gray-600 hover:text-green-600 border border-gray-200 transition"
                    title="Müşteri Bilgileri"
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

      {/* 4. Sağ Menü (Müşteri Bilgileri) */}
      {isRightSidebarOpen && activeContact && (
        <RightSidebar 
            activeSession={activeSession}
            activeContact={activeContact}
            onClose={() => setIsRightSidebarOpen(false)}
            onUpdate={() => {
                // Burada ChatList'i yenilemek için bir mekanizma kurulabilir
                // Şimdilik sadece sayfayı yenilemeden veriyi güncelledik
                console.log("Kişi güncellendi");
            }}
        />
      )}

      {/* QR Modal */}
      {isAddModalOpen && (
        <AddSessionModal
          onClose={() => setIsAddModalOpen(false)}
        />
      )}
    </div>
  );
}