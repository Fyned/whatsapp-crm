import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import './i18n'; 

// SAYFALAR
import Login from './pages/Login'; 
import Dashboard from './pages/Dashboard'; 

// Landing Page (DÜZELTME BURADA: bg-linear-to-br)
const LandingPage = () => (
  <div className="flex flex-col items-center justify-center h-screen bg-linear-to-br from-gray-900 to-gray-800 text-white">
    <h1 className="text-5xl font-bold mb-4">🚀 WhatsApp CRM</h1>
    <p className="text-xl text-gray-300 mb-8">Müşterilerinizi tek ekrandan yönetin.</p>
    <a href="/login" className="px-6 py-3 bg-green-500 hover:bg-green-600 rounded-lg font-bold transition">Panele Giriş Yap</a>
  </div>
);

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div className="text-center mt-20">Yükleniyor...</div>;

  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/app/dashboard" />} />
        <Route path="/app/dashboard" element={session ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="/app" element={<Navigate to="/app/dashboard" />} />
      </Routes>
    </Router>
  );
}

export default App;