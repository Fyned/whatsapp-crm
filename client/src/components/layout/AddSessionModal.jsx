import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';

const SOCKET_URL = "http://localhost:3006";

export default function AddSessionModal({ onClose }) {
  const [step, setStep] = useState(1); 
  const [phoneNumber, setPhoneNumber] = useState(''); // sessionName yerine phoneNumber
  const [qrImage, setQrImage] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const socketRef = useRef(null);
  const targetSessionRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);
    
    socketRef.current.on('qr_code', (data) => {
        // Gelen QR kodun bu oturum için olup olmadığını kontrol et
        if (data.sessionId === targetSessionRef.current) {
            const code = data.qr || data.image;
            if (code) {
                setQrImage(code);
                setLoading(false);
            }
        }
    });

    socketRef.current.on('session_status', (data) => {
        if (data.sessionId === targetSessionRef.current) {
            if (data.status === 'READY' || data.status === 'CONNECTED') {
                alert("Hat başarıyla bağlandı! Mesajlar yükleniyor...");
                onClose();
                window.location.reload(); 
            }
        }
    });

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, []);

  const handleStart = async () => {
    if (!phoneNumber) return alert("Lütfen bir numara girin!");
    
    setLoading(true); 
    setQrImage(null); 
    setStep(2);
    
    const { data: { user } } = await supabase.auth.getUser();
    
    // Numarayı olduğu gibi gönderiyoruz (+90555...)
    // Backend bunu dosya sistemi için temizleyecek, veritabanı için olduğu gibi saklayacak.
    try {
        const res = await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                sessionName: phoneNumber, // Backend hala 'sessionName' bekliyor, buraya numarayı atıyoruz
                userId: user?.id 
            })
        });
        const data = await res.json();
        
        if(data.success) {
            targetSessionRef.current = data.sessionId;
            socketRef.current.emit('join_session', data.sessionId);
        } else { 
            throw new Error(data.error); 
        }
    } catch (err) { 
        alert("Hata: " + err.message);
        setLoading(false); 
        setStep(1); 
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col w-[400px] min-h-[450px]">
        
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h2 className="font-bold text-gray-800">Yeni Hat Ekle</h2>
            <button onClick={onClose}><X className="text-gray-400 hover:text-red-500"/></button>
        </div>

        <div className="p-6 flex-1 flex flex-col justify-center">
            
            {step === 1 && (
                <div className="space-y-6">
                    <div className="text-center">
                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 shadow-sm">
                            <Smartphone size={40} />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800">Numaranızı Girin</h3>
                        <p className="text-gray-500 text-sm mt-2">Bağlamak istediğiniz WhatsApp numarasını ülke koduyla yazın.</p>
                    </div>
                    
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">TELEFON NUMARASI</label>
                        <input 
                            type="text" 
                            className="w-full border-2 border-gray-200 p-3 rounded-xl focus:border-green-500 focus:ring-0 outline-none text-lg font-mono placeholder-gray-300 transition" 
                            placeholder="+90 5XX XXX XX XX" 
                            value={phoneNumber} 
                            onChange={e => setPhoneNumber(e.target.value)} 
                            autoFocus 
                        />
                    </div>

                    <button 
                        onClick={handleStart} 
                        disabled={!phoneNumber || phoneNumber.length < 10} 
                        className="w-full bg-green-600 text-white p-4 rounded-xl font-bold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-200"
                    >
                        QR Kodu Oluştur
                    </button>
                </div>
            )}

            {step === 2 && (
                <div className="flex flex-col items-center justify-center space-y-4">
                    {loading && !qrImage ? (
                        <div className="text-center py-10">
                            <Loader2 className="animate-spin text-green-600 mx-auto mb-4" size={48}/> 
                            <p className="text-gray-600 font-medium">QR Kod hazırlanıyor...</p>
                            <p className="text-xs text-gray-400 mt-2">Bu işlem birkaç saniye sürebilir.</p>
                        </div>
                    ) : qrImage ? (
                        <div className="text-center animate-in fade-in zoom-in duration-300">
                            <div className="border-8 border-white shadow-2xl rounded-2xl overflow-hidden inline-block">
                                <img src={qrImage} className="w-[260px] h-[260px]" alt="QR" />
                            </div>
                            <p className="mt-6 text-gray-800 font-bold">WhatsApp'ı açın ve okutun</p>
                            <p className="text-xs text-gray-500">Ayarlar {'>'} Bağlı Cihazlar {'>'} Cihaz Bağla</p>
                        </div>
                    ) : (
                        <div className="text-center">
                             <Loader2 className="animate-spin text-gray-400 mx-auto mb-2" size={32}/>
                             <p className="text-gray-500">Bağlantı bekleniyor...</p>
                        </div>
                    )}
                </div>
            )}

        </div>
      </div>
    </div>
  );
}