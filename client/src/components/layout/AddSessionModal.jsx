import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';

// DİNAMİK URL AYARI (ÖNEMLİ)
// Tarayıcı adres çubuğundaki IP/Domain neyse onu alır ve 3006 portuna yönlendirir.
// Bu sayede IP değişse bile kod bozulmaz.
const SOCKET_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function AddSessionModal({ onClose }) {
  const [step, setStep] = useState(1); 
  const [phoneNumber, setPhoneNumber] = useState(''); 
  const [qrImage, setQrImage] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const socketRef = useRef(null);
  const targetSessionRef = useRef(null);

  useEffect(() => {
    // Socket bağlantısını başlat
    socketRef.current = io(SOCKET_URL, {
        transports: ['websocket', 'polling'], // Bağlantı garantisi için
        reconnectionAttempts: 5 // Koparsa 5 kere tekrar dene
    });
    
    // Socket'ten QR gelirse yakala
    socketRef.current.on('qr', (qrCodeData) => {
        // Backend bazen direkt string (raw qr) bazen de obje { qr: ... } gönderir
        // Gelen veriyi kontrol edip state'e atıyoruz.
        // Not: QR kütüphanesi backend'de terminale basıyor, frontend'e raw data gelebilir.
        // Eğer backend resim (data:image...) göndermiyorsa, frontend'de qrcode.react gerekebilir.
        // Ancak senin backend kodunda "qrcode-terminal" var, frontend'e ne gönderdiğine bağlı.
        // Mevcut yapıda backend'den "qr" event'i ile raw string geliyor varsayıyoruz.
        // Eğer backend resim gönderiyorsa (base64), direkt src'ye koyabiliriz.
        
        // Önceki loglarına göre backend şunu yapıyor: io.emit('qr', qr);
        // Bu raw string'dir. Frontend'de bunu QR resmine çevirmek gerekir.
        // FAKAT senin backendinde "qrcode" paketi de var, belki base64 dönüyordur.
        // Garanti olsun diye gelen veriyi logluyoruz:
        console.log("Socket QR Geldi:", qrCodeData);
        
        // Eğer gelen veri "data:image" ile başlıyorsa direkt resimdir.
        // Değilse (raw string ise) bunu işlemek için bir kütüphane gerekir.
        // Şimdilik senin "qrcode" kütüphanesini kullandığını varsayarak:
        if (typeof qrCodeData === 'string' && qrCodeData.startsWith('data:image')) {
             setQrImage(qrCodeData);
        } else {
             // Eğer raw string geliyorsa ve QR componenti yoksa, 
             // Geçici olarak API'den dönen görseli bekleyeceğiz veya qrcode kütüphanesi ekleyeceğiz.
             // Şimdilik string'i olduğu gibi state'e atıyoruz, aşağıda kontrol edeceğiz.
             setQrImage(qrCodeData); 
        }
        setLoading(false);
    });

    // Oturum durumunu dinle
    socketRef.current.on('ready', (data) => {
        console.log("Socket Ready:", data);
        alert("Bağlantı Başarılı!");
        onClose();
        window.location.reload(); 
    });

    return () => { 
        if (socketRef.current) socketRef.current.disconnect(); 
    };
  }, []);

  const handleStart = async () => {
    if (!phoneNumber) return alert("Numara giriniz!");
    
    // Numarayı temizle (Sadece rakamlar)
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10) return alert("Geçerli bir numara giriniz.");

    setLoading(true); 
    setQrImage(null); 
    setStep(2);
    
    const { data: { user } } = await supabase.auth.getUser();
    targetSessionRef.current = cleanPhone; 

    try {
        // API isteğini dinamik URL'e at
        const res = await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName: cleanPhone, userId: user?.id })
        });
        
        const data = await res.json();
        console.log("Start Session Yanıtı:", data);
        
        if(data.status === 'Session initiated' || data.success) {
            // Eğer backend API yanıtında QR dönerse onu kullan
            if (data.qr) {
                setQrImage(data.qr);
                setLoading(false);
            }
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
                <div className="text-center">
                    {loading && !qrImage ? (
                        <div className="flex flex-col items-center">
                            <Loader2 className="animate-spin text-green-600 mb-2" size={40}/>
                            <p className="text-sm text-gray-500">Sunucuya bağlanılıyor...</p>
                        </div>
                    ) : qrImage ? (
                        <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                            {/* Eğer QR bir resim verisiyse (data:image...) direkt göster, değilse raw string ise QRCode bileşeni gerekir. 
                                Şimdilik backend yapını tam bilmediğimiz için (önceki kodlarda base64 dönüştürme vardı) img etiketi kullanıyoruz. 
                                Eğer resim kırık görünürse Backend tarafında 'qrcode' paketi ile toDataURL yapılması gerekir. */}
                            <img 
                                src={qrImage} 
                                className="w-[260px] mx-auto border-4 border-white shadow-lg rounded-xl" 
                                alt="WhatsApp QR Kodu"
                                onError={(e) => {
                                    e.target.style.display='none';
                                    alert("QR kodu formatı geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.");
                                }}
                            />
                            <p className="mt-4 text-gray-500 font-medium">WhatsApp uygulamasından okutun</p>
                        </div>
                    ) : (
                        <p className="text-red-500">QR Kod alınamadı.</p>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}