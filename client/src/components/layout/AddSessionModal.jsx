import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';

// Dinamik URL (Otomatik IP algılar)
const SOCKET_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function AddSessionModal({ onClose }) {
  const [step, setStep] = useState(1);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [qrCodeData, setQrCodeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  
  const socketRef = useRef(null);

  useEffect(() => {
    // Socket Bağlantısı
    socketRef.current = io(SOCKET_URL, { 
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5
    });
    
    socketRef.current.on('connect_error', (err) => {
        console.error("Socket bağlantı hatası:", err);
    });

    socketRef.current.on('qr', (data) => {
        console.log("QR Kod Alındı");
        setQrCodeData(data); // Backend zaten 'data:image/png...' gönderiyor
        setLoading(false);
        setStatusText('Lütfen WhatsApp > Bağlı Cihazlar menüsünden okutun.');
    });

    socketRef.current.on('ready', () => {
        alert("✅ Hat başarıyla bağlandı!");
        onClose();
        window.location.reload();
    });

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, []);

  const handleStart = async () => {
    if (!phoneNumber) return alert("Numara giriniz");
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    setLoading(true);
    setQrCodeData(null);
    setStep(2);
    setStatusText('WhatsApp sunucusuna bağlanılıyor...');

    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
        alert("Oturum süreniz dolmuş, lütfen tekrar giriş yapın.");
        window.location.href = '/login';
        return;
    }

    try {
        await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                sessionName: cleanPhone, 
                userId: user.id 
            })
        });
        setStatusText('QR Kod oluşturuluyor, lütfen bekleyin...');
    } catch (err) {
        console.error(err);
        alert("Sunucuya bağlanılamadı. Backend'in çalıştığından emin olun.");
        setStep(1);
        setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-[400px] min-h-[450px] flex flex-col">
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h3 className="font-bold text-gray-800">Yeni Hat Ekle</h3>
            <button onClick={onClose}><X className="text-gray-400 hover:text-red-500"/></button>
        </div>
        <div className="p-6 flex-1 flex flex-col justify-center items-center">
            {step === 1 && (
                <div className="w-full space-y-4">
                    <div className="text-center">
                        <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Smartphone className="text-green-600" size={40}/>
                        </div>
                        <p className="text-gray-600 text-sm">Bağlamak istediğiniz telefon numarasını girin.</p>
                    </div>
                    <input 
                        className="w-full border p-3 rounded-lg text-center text-xl tracking-wider focus:outline-none focus:border-green-500" 
                        placeholder="905xxxxxxxxx"
                        value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                    />
                    <button onClick={handleStart} className="w-full bg-green-600 hover:bg-green-700 text-white p-3 rounded-lg font-bold transition shadow-lg shadow-green-200">
                        Başlat & QR Oluştur
                    </button>
                </div>
            )}
            {step === 2 && (
                <div className="text-center w-full flex flex-col items-center">
                    <p className={`mb-4 font-medium text-sm py-2 px-4 rounded-lg w-full ${loading ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'}`}>
                        {statusText}
                    </p>
                    
                    {qrCodeData ? (
                        <div className="border-4 border-white shadow-xl inline-block rounded-xl overflow-hidden animate-in fade-in zoom-in duration-300">
                             {/* DÜZELTME BURADA: QRCodeCanvas yerine doğrudan resim */}
                             <img src={qrCodeData} alt="WhatsApp QR" width="240" height="240" />
                        </div>
                    ) : (
                        <div className="py-10">
                            <Loader2 className="animate-spin text-green-600 mx-auto" size={48}/>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}