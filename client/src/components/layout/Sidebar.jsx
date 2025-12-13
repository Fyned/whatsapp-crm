import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { LogOut, Plus, MessageSquare, Phone, Trash2, RefreshCw, Loader2, QrCode, ArrowDownCircle } from 'lucide-react';

const API_URL = `${window.location.protocol}//${window.location.hostname}:3006`;

export default function Sidebar({ onSelectSession, activeSessionId, onAddNew }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    fetchSessions();
    const channel = supabase.channel('public:sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, fetchSessions)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const fetchSessions = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('sessions').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
    if (data) setSessions(data);
  };

  const handleDelete = async (e, sessionName) => {
    e.stopPropagation();
    if (!window.confirm(`${sessionName} hattını silmek istediğinize emin misiniz?`)) return;
    try {
      await fetch(`${API_URL}/delete-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName }),
      });
    } catch (error) { alert('Hata'); }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  // Statü Ayarları (SYNCING Eklendi)
  const getStatusConfig = (status) => {
    switch (status) {
        case 'CONNECTED': return { color: 'text-green-500', bg: 'bg-green-500/20', icon: <Phone size={16} />, label: 'Bağlı' };
        case 'SYNCING': return { color: 'text-blue-600', bg: 'bg-blue-100', icon: <RefreshCw size={16} className="animate-spin" />, label: 'Geçmiş Alınıyor...' };
        case 'DISCONNECTED': return { color: 'text-red-500', bg: 'bg-red-500/20', icon: <LogOut size={16} />, label: 'Koptu' };
        case 'QR_READY': return { color: 'text-yellow-500', bg: 'bg-yellow-500/20', icon: <QrCode size={16} />, label: 'QR Bekliyor' };
        case 'INITIALIZING': return { color: 'text-blue-500', bg: 'bg-blue-500/20', icon: <Loader2 size={16} className="animate-spin" />, label: 'Başlatılıyor...' };
        default: return { color: 'text-gray-500', bg: 'bg-gray-500/20', icon: <RefreshCw size={16} />, label: status };
    }
  };

  return (
    <div className="w-64 bg-gray-900 text-white h-screen flex flex-col border-r border-gray-700">
      <div className="p-4 border-b border-gray-800 flex items-center gap-2">
        <div className="bg-green-600 p-1.5 rounded-lg"><MessageSquare size={20} className="text-white" /></div>
        <h1 className="font-bold text-lg tracking-tight">WhatsApp CRM</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="flex justify-between items-center px-1 mb-2 mt-2">
          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">Hatlar ({sessions.length})</span>
        </div>

        {sessions.length === 0 && <div className="text-center py-8 px-4 text-gray-500 text-sm border border-gray-800 border-dashed rounded-xl bg-gray-800/30">Henüz hat yok.</div>}

        {sessions.map((session) => {
          const config = getStatusConfig(session.status);
          return (
            <div
              key={session.id}
              onClick={() => onSelectSession(session)}
              className={`group relative w-full flex items-center gap-3 p-3 rounded-xl transition cursor-pointer border border-transparent
                ${activeSessionId === session.id ? 'bg-gray-800 border-gray-700 text-white shadow-lg' : 'hover:bg-gray-800/50 text-gray-400 hover:text-gray-200'}
              `}
            >
              <div className={`p-2 rounded-full ${config.bg} ${config.color}`}>{config.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{session.session_name}</div>
                <div className={`text-[10px] font-medium uppercase tracking-wide ${config.color}`}>{config.label}</div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button onClick={(e) => handleDelete(e, session.session_name)} className="p-1.5 hover:bg-red-500/20 hover:text-red-500 rounded-md transition"><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}

        <button onClick={onAddNew} className="w-full flex items-center justify-center gap-2 p-3 mt-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition shadow-lg shadow-green-900/20">
          <Plus size={18} /><span>Yeni Hat Ekle</span>
        </button>
      </div>

      <div className="p-4 border-t border-gray-800 bg-gray-900">
        <button onClick={handleLogout} className="flex items-center justify-center w-full gap-2 p-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition">
          <LogOut size={16} /><span>Oturumu Kapat</span>
        </button>
      </div>
    </div>
  );
}