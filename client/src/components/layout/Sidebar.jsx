import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { LogOut, Plus, MessageSquare, Phone, Trash2 } from 'lucide-react';

export default function Sidebar({
  onSelectSession,
  activeSessionId,
  onAddNew,
}) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    fetchSessions();

    const channel = supabase
      .channel('public:sessions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions' },
        fetchSessions
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const fetchSessions = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .in('status', ['CONNECTED', 'DISCONNECTED'])
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Session sorgu hatası:', error.message);
      return;
    }

    if (data) setSessions(data);
  };

  const handleDelete = async (e, sessionName) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `${sessionName} hattını silmek istediğinize emin misiniz?`
      )
    )
      return;

    try {
      await fetch('http://localhost:3006/delete-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName }),
      });
    } catch (error) {
      alert('Silme işlemi başarısız oldu.');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="w-64 bg-gray-900 text-white h-screen flex flex-col border-r border-gray-700">
      <div className="p-4 border-b border-gray-800 flex items-center gap-2">
        <div className="bg-green-600 p-1.5 rounded-lg">
          <MessageSquare size={20} className="text-white" />
        </div>
        <h1 className="font-bold text-lg tracking-tight">
          WhatsApp CRM
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="flex justify-between items-center px-1 mb-2 mt-2">
          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider">
            Hatlar ({sessions.length})
          </span>
        </div>

        {sessions.length === 0 && (
          <div className="text-center py-8 px-4 text-gray-500 text-sm border border-gray-800 border-dashed rounded-xl bg-gray-800/30">
            Henüz bağlı hat yok.
          </div>
        )}

        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelectSession(session)}
            className={`group relative w-full flex items-center gap-3 p-3 rounded-xl transition cursor-pointer border border-transparent
              ${
                activeSessionId === session.id
                  ? 'bg-gray-800 border-gray-700 text-white shadow-lg'
                  : 'hover:bg-gray-800/50 text-gray-400 hover:text-gray-200'
              }
            `}
          >
            <div
              className={`p-2 rounded-full ${
                session.status === 'CONNECTED'
                  ? 'bg-green-500/20 text-green-500'
                  : 'bg-red-500/20 text-red-500'
              }`}
            >
              <Phone size={16} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">
                {session.display_name || session.session_name}
              </div>
              <div
                className={`text-[10px] font-medium uppercase tracking-wide ${
                  session.status === 'CONNECTED'
                    ? 'text-green-500'
                    : 'text-red-500'
                }`}
              >
                {session.status}
              </div>
            </div>

            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button
                onClick={(e) => handleDelete(e, session.session_name)}
                className="p-1.5 hover:bg-red-500/20 hover:text-red-500 rounded-md transition"
                title="Hattı Sil"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={onAddNew}
          className="w-full flex items-center justify-center gap-2 p-3 mt-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition shadow-lg shadow-green-900/20"
        >
          <Plus size={18} />
          <span>Yeni Hat Ekle</span>
        </button>
      </div>

      <div className="p-4 border-t border-gray-800 bg-gray-900">
        <button
          onClick={handleLogout}
          className="flex items-center justify-center w-full gap-2 p-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
        >
          <LogOut size={16} />
          <span>Oturumu Kapat</span>
        </button>
      </div>
    </div>
  );
}
