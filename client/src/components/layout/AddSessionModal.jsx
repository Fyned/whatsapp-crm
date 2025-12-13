import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';

const SOCKET_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function AddSessionModal({ onClose, initialSessionName = null }) {
  // Eğer isim geldiyse direkt 2. adıma (QR) geç, yoksa 1. adım (Numara Gir)
  const [step, setStep] = useState(initialSessionName ? 2 : 1);
  const [phoneNumber, setPhoneNumber] = useState(initialSessionName || '');
  const [qrCodeData, setQrCodeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState(initialSessionName ? 'Mevcut oturum kontrol ediliyor...' : '');
  
  const socketRef = useRef(null);

  // Veritabanından mevcut QR'ı kontrol et (Hızlı açılış için)
  useEffect(() => {
    if (initialSessionName) {
        supabase.from('sessions').select('qr_code').eq('session_name', initialSessionName).single()
            .then(({ data }) => {
                if (data && data.qr_code) {
                    setQrCodeData(data.qr_code);
                    setLoading(false);
                    setStatusText('QR Kodu Okutunuz');
                } else {
                    // QR yoksa yeniden başlatmayı tetikle
                    handleStart(); 
                }
            });
    }
  }, [initialSessionName]);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    
    socketRef.current.on('qr', (data) => {
        // Gelen QR bizim numaramıza mı ait?
        // Data formatı { sessionName: '...', qr: '...' } olmalı (Backend'i buna göre güncelledik)
        // Eğer backend sadece 'qr string' atıyorsa (eski versiyon), o zaman kontrolsüz kabul et.
        const incomingSession = data.sessionName || phoneNumber; 
        if (incomingSession === phoneNumber) {
            setQrCodeData(data.qr || data); 
            setLoading(false);
            setStatusText('Lütfen QR Kodu okutun...');
        }
    });

    socketRef.current.on('ready', (data) => {
        if (!data.sessionName || data.sessionName === phoneNumber) {
            alert("✅ Hat başarıyla bağlandı!");
            onClose();
            // window.location.reload(); // Gerek yok, Sidebar realtime güncelleniyor
        }
    });

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, [phoneNumber]);

  const handleStart = async () => {
    if (!phoneNumber) return alert("Numara giriniz");
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    setPhoneNumber(cleanPhone);
    
    setLoading(true);
    setQrCodeData(null);
    setStep(2);
    setStatusText('WhatsApp sunucusuna bağlanılıyor...');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return window.location.href = '/login';

    try {
        await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName: cleanPhone, userId: user.id })
        });
        setStatusText('QR Kod oluşturuluyor, bekleyiniz...');
    } catch (err) {
        alert("Hata: " + err.message);
        setStep(1);
        setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-[400px] min-h-[450px] flex flex-col">
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h3 className="font-bold text-gray-800">{initialSessionName ? 'Oturumu Yenile' : 'Yeni Hat Ekle'}</h3>
            <button onClick={onClose}><X className="text-gray-400 hover:text-red-500"/></button>
        </div>
        <div className="p-6 flex-1 flex flex-col justify-center items-center">
            {step === 1 && (
                <div className="w-full space-y-4">
                    <div className="text-center">
                        <Smartphone className="mx-auto text-green-600 mb-2" size={40}/>
                        <p className="text-gray-600">Telefon Numaranız</p>
                    </div>
                    <input className="w-full border p-3 rounded-lg text-center text-xl" placeholder="905xxxxxxxxx" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}/>
                    <button onClick={handleStart} className="w-full bg-green-600 text-white p-3 rounded-lg font-bold hover:bg-green-700 transition">QR Oluştur</button>
                </div>
            )}
            {step === 2 && (
                <div className="text-center w-full">
                    <p className="mb-4 font-medium text-green-700 bg-green-50 py-1 rounded">{statusText}</p>
                    {qrCodeData ? (
                        <div className="border-4 border-white shadow-lg inline-block rounded-xl overflow-hidden animate-in fade-in zoom-in">
                             <img src={qrCodeData} alt="WhatsApp QR" width="250" height="250" />
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