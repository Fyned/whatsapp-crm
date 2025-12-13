import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

// Dinamik URL
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
    socketRef.current = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    
    socketRef.current.on('qr', (data) => {
        console.log("QR Geldi");
        setQrCodeData(data);
        setLoading(false);
        setStatusText('QR kodu okutun...');
    });

    socketRef.current.on('ready', () => {
        // Backend DB'ye yazdıktan sonra bu event gelir
        alert("Hat başarıyla bağlandı!");
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
    setStatusText('Kullanıcı bilgisi alınıyor...');

    // --- KİMLİK DOĞRULAMA (TEST İÇİN KRİTİK) ---
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
        alert("Hata: Kullanıcı bulunamadı. Lütfen sayfayı yenileyip tekrar giriş yapın.");
        window.location.href = '/login';
        return;
    }

    console.log("Gönderilen UserID:", user.id); // Konsolda görmen için

    try {
        await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                sessionName: cleanPhone, 
                userId: user.id // BURASI ÇOK ÖNEMLİ
            })
        });
        setStatusText('Sunucudan yanıt bekleniyor...');
    } catch (err) {
        alert("Hata: " + err.message);
        setStep(1);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-[400px] min-h-[450px] flex flex-col">
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h3 className="font-bold">Yeni Hat Ekle</h3>
            <button onClick={onClose}><X className="text-gray-400"/></button>
        </div>
        <div className="p-6 flex-1 flex flex-col justify-center items-center">
            {step === 1 && (
                <div className="w-full space-y-4">
                    <div className="text-center">
                        <Smartphone className="mx-auto text-green-600 mb-2" size={40}/>
                        <p className="text-gray-600">Telefon Numaranız</p>
                    </div>
                    <input 
                        className="w-full border p-3 rounded-lg text-center text-xl" 
                        placeholder="905xxxxxxxxx"
                        value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                    />
                    <button onClick={handleStart} className="w-full bg-green-600 text-white p-3 rounded-lg font-bold">
                        QR Oluştur
                    </button>
                </div>
            )}
            {step === 2 && (
                <div className="text-center w-full">
                    <p className="mb-4 font-medium text-green-700 bg-green-50 py-1 rounded">{statusText}</p>
                    {qrCodeData ? (
                        <div className="border-4 border-white shadow-lg inline-block rounded-xl overflow-hidden">
                             <QRCodeCanvas value={qrCodeData} size={220} />
                        </div>
                    ) : (
                        <Loader2 className="animate-spin text-gray-400 mx-auto" size={40}/>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}