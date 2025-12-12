import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react'; // YENİ EKLENEN KISIM

// Dinamik URL: Adres çubuğu neyse (localhost veya IP) oraya bağlanır
const SOCKET_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function AddSessionModal({ onClose }) {
  const [step, setStep] = useState(1); 
  const [phoneNumber, setPhoneNumber] = useState(''); 
  const [qrCodeData, setQrCodeData] = useState(null); // Değişken adını düzelttik
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Bağlanıyor...');
  
  const socketRef = useRef(null);
  const targetSessionRef = useRef(null);

  useEffect(() => {
    console.log("Socket bağlanıyor:", SOCKET_URL);
    
    // Socket bağlantısını başlat
    socketRef.current = io(SOCKET_URL, {
        transports: ['websocket', 'polling'], 
        reconnectionAttempts: 5
    });
    
    socketRef.current.on('connect', () => {
        console.log("Socket bağlandı! ID:", socketRef.current.id);
        setConnectionStatus('Sunucuya bağlı, QR bekleniyor...');
    });

    socketRef.current.on('connect_error', (err) => {
        console.error("Socket bağlantı hatası:", err);
        setConnectionStatus('Bağlantı hatası, tekrar deneniyor...');
    });
    
    // Socket'ten QR gelirse yakala
    socketRef.current.on('qr', (data) => {
        console.log("Socket QR Geldi (Ham Veri):", data);
        setQrCodeData(data); // Ham veriyi kaydet
        setLoading(false);
        setConnectionStatus('QR Kodu Hazır');
    });

    // Oturum hazır olunca
    socketRef.current.on('ready', (data) => {
        console.log("Socket Ready:", data);
        alert("WhatsApp Başarıyla Bağlandı!");
        onClose();
        window.location.reload(); 
    });

    return () => { 
        if (socketRef.current) socketRef.current.disconnect(); 
    };
  }, []);

  const handleStart = async () => {
    if (!phoneNumber) return alert("Numara giriniz!");
    
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10) return alert("Geçerli bir numara giriniz.");

    setLoading(true); 
    setQrCodeData(null); 
    setStep(2);
    setConnectionStatus('Oturum başlatılıyor...');
    
    const { data: { user } } = await supabase.auth.getUser();
    targetSessionRef.current = cleanPhone; 

    try {
        const res = await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName: cleanPhone, userId: user?.id })
        });
        
        const data = await res.json();
        console.log("Start Session Yanıtı:", data);
        
        if(data.status === 'Session initiated' || data.success) {
            // Başarılı, QR socket'ten gelecek
        } else { 
            throw new Error(data.error || "Oturum başlatılamadı"); 
        }
    } catch (err) { 
        console.error(err);
        alert("Hata: " + err.message);
        setLoading(false); setStep(1); 
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[400px] min-h-[450px] flex flex-col overflow-hidden">
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h2 className="font-bold text-gray-800">Yeni Hat Ekle</h2>
            <button onClick={onClose}><X className="text-gray-400 hover:text-red-500"/></button>
        </div>
        <div className="p-6 flex-1 flex flex-col justify-center">
            {step === 1 && (
                <div className="space-y-6">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600"><Smartphone size={32} /></div>
                        <h3 className="font-bold">Numaranızı Girin</h3>
                    </div>
                    <input 
                        type="text" 
                        className="w-full border p-3 rounded-xl text-lg" 
                        placeholder="905xxxxxxxxx" 
                        value={phoneNumber} 
                        onChange={e => setPhoneNumber(e.target.value)} 
                    />
                    <button onClick={handleStart} className="w-full bg-green-600 text-white p-3 rounded-xl font-bold hover:bg-green-700 transition">
                        QR Kod Oluştur
                    </button>
                </div>
            )}
            {step === 2 && (
                <div className="text-center space-y-4">
                    {/* Durum Mesajı */}
                    <p className="text-sm font-semibold text-gray-500 bg-gray-100 py-1 px-3 rounded-full inline-block">
                        {connectionStatus}
                    </p>

                    {loading && !qrCodeData ? (
                        <div className="flex flex-col items-center py-8">
                            <Loader2 className="animate-spin text-green-600 mb-4" size={48}/>
                            <p className="text-gray-500">Sunucu ile iletişim kuruluyor...</p>
                        </div>
                    ) : qrCodeData ? (
                        <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                            <div className="p-4 bg-white border-2 border-green-500 rounded-xl shadow-lg">
                                {/* Ham veriyi QR Koda çeviren bileşen */}
                                <QRCodeCanvas 
                                    value={qrCodeData} 
                                    size={256} 
                                    level={"H"}
                                    includeMargin={true}
                                />
                            </div>
                            <p className="mt-6 text-gray-700 font-medium text-lg">
                                WhatsApp uygulamasından okutun
                            </p>
                        </div>
                    ) : (
                        <p className="text-red-500 mt-4">Henüz QR veri gelmedi, bekleniyor...</p>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}