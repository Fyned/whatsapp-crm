import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import io from 'socket.io-client';
import { X, Loader2, Smartphone } from 'lucide-react';

const SOCKET_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3006' 
  : `http://${window.location.hostname}:3006`;

export default function AddSessionModal({ onClose }) {
  const [step, setStep] = useState(1); 
  const [phoneNumber, setPhoneNumber] = useState(''); 
  const [qrImage, setQrImage] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const socketRef = useRef(null);
  const targetSessionRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);
    
    // Socket'ten QR gelirse yakala
    socketRef.current.on('qr_code', (data) => {
        if (data.sessionId === targetSessionRef.current) {
            setQrImage(data.qr || data.image);
            setLoading(false);
        }
    });

    socketRef.current.on('session_status', (data) => {
        if (data.sessionId === targetSessionRef.current) {
            if (data.status === 'READY' || data.status === 'CONNECTED') {
                alert("Bağlantı Başarılı!");
                onClose();
                window.location.reload(); 
            }
        }
    });

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, []);

  const handleStart = async () => {
    if (!phoneNumber) return alert("Numara giriniz!");
    setLoading(true); setQrImage(null); setStep(2);
    
    const { data: { user } } = await supabase.auth.getUser();
    targetSessionRef.current = phoneNumber; // Hedef oturumu şimdiden belirle

    try {
        const res = await fetch(`${SOCKET_URL}/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName: phoneNumber, userId: user?.id })
        });
        const data = await res.json();
        
        if(data.success) {
            // --- KRİTİK DÜZELTME: API'den gelen QR'ı kullan ---
            if (data.qr) {
                setQrImage(data.qr);
                setLoading(false);
            }
            socketRef.current.emit('join_session', data.sessionId);
        } else { 
            throw new Error(data.error); 
        }
    } catch (err) { 
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
                    <input type="text" className="w-full border p-3 rounded-xl text-lg" placeholder="+905..." value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} />
                    <button onClick={handleStart} className="w-full bg-green-600 text-white p-3 rounded-xl font-bold">QR Kod Oluştur</button>
                </div>
            )}
            {step === 2 && (
                <div className="text-center">
                    {loading && !qrImage ? <Loader2 className="animate-spin mx-auto text-green-600" size={40}/> : 
                     qrImage ? <img src={qrImage} className="w-[260px] mx-auto border-4 border-white shadow-lg rounded-xl" alt="QR"/> : null}
                    <p className="mt-4 text-gray-500">{qrImage ? "WhatsApp'tan okutun" : "QR Oluşturuluyor..."}</p>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}