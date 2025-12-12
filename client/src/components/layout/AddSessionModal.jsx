import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react'; // Kütüphane eklendi

// DİNAMİK URL
const SOCKET_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function AddSessionModal({ onClose }) {
  const [step, setStep] = useState(1); 
  const [phoneNumber, setPhoneNumber] = useState(''); 
  const [qrCodeData, setQrCodeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  
  const socketRef = useRef(null);

  useEffect(() => {
    // Socket Başlat
    socketRef.current = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5
    });
    
    // QR Geldiğinde
    socketRef.current.on('qr', (data) => {
        console.log("QR Verisi Alındı:", data);
        setQrCodeData(data);
        setLoading(false);
        setStatusText('QR Kodu Hazır. Okutunuz.');
    });

    // Hazır Olduğunda
    socketRef.current.on('ready', () => {
        alert("Bağlantı Başarılı! Panel Yenileniyor...");
        onClose();
        window.location.reload();
    });

    return () => { 
        if (socketRef.current) socketRef.current.disconnect(); 
    };
  }, []);

  const handleStart = async () => {
    if (!phoneNumber) return alert("Lütfen numara giriniz!");
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10) return alert("Geçersiz numara.");

    setLoading(true);
    setQrCodeData(null);
    setStep(2);
    setStatusText('Sunucuya bağlanılıyor...');
    
    // KİMLİK KONTROLÜ (ZORUNLU)
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
        alert("Oturum hatası: Kullanıcı bulunamadı. Lütfen tekrar giriş yapın.");
        window.location.href = '/login';
        return;
    }

    try {
        const res = await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                sessionName: cleanPhone, 
                userId: user.id // ID'yi kesinlikle gönderiyoruz
            })
        });
        
        const data = await res.json();
        if (data.success) {
            setStatusText('QR Kodu oluşturuluyor, bekleyin...');
        } else {
            throw new Error(data.error || "Bilinmeyen hata");
        }
    } catch (err) { 
        console.error(err);
        alert("Sunucu Hatası: " + err.message);
        setLoading(false); 
        setStep(1); 
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[400px] min-h-[480px] flex flex-col overflow-hidden">
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h2 className="font-bold text-gray-800">Yeni Hat Ekle</h2>
            <button onClick={onClose}><X className="text-gray-400 hover:text-red-500"/></button>
        </div>
        <div className="p-6 flex-1 flex flex-col justify-center">
            {step === 1 && (
                <div className="space-y-6">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600">
                            <Smartphone size={32} />
                        </div>
                        <h3 className="font-bold text-gray-700">Numaranızı Girin</h3>
                        <p className="text-xs text-gray-400 mt-1">Başında 90 olacak şekilde giriniz</p>
                    </div>
                    <input 
                        type="text" 
                        className="w-full border p-3 rounded-xl text-lg text-center tracking-wider" 
                        placeholder="905xxxxxxxxx" 
                        value={phoneNumber} 
                        onChange={e => setPhoneNumber(e.target.value)} 
                    />
                    <button 
                        onClick={handleStart} 
                        className="w-full bg-green-600 text-white p-3 rounded-xl font-bold hover:bg-green-700 transition shadow-lg shadow-green-200"
                    >
                        QR Kod Oluştur
                    </button>
                </div>
            )}
            {step === 2 && (
                <div className="text-center flex flex-col items-center h-full justify-center">
                    <p className="text-sm font-medium text-green-600 mb-4 bg-green-50 px-3 py-1 rounded-full">
                        {statusText}
                    </p>

                    {loading && !qrCodeData ? (
                        <div className="py-10">
                            <Loader2 className="animate-spin text-gray-400 mb-2" size={48}/>
                        </div>
                    ) : qrCodeData ? (
                        <div className="p-3 bg-white border-4 border-gray-100 rounded-xl shadow-sm animate-in zoom-in duration-300">
                            <QRCodeCanvas 
                                value={qrCodeData} 
                                size={220} 
                                level={"L"}
                                marginSize={1}
                            />
                        </div>
                    ) : (
                        <p className="text-red-400 text-sm">QR bekleniyor...</p>
                    )}
                    
                    <p className="mt-6 text-xs text-gray-400">
                        WhatsApp {'>'} Ayarlar {'>'} Bağlı Cihazlar {'>'} Cihaz Bağla
                    </p>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}