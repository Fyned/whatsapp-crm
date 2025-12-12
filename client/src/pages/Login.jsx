import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Dil Değiştirme Fonksiyonu
  const changeLanguage = (lang) => {
    i18n.changeLanguage(lang);
  };

  // GİRİŞ YAPMA
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
    } else {
      // Başarılı ise App.jsx otomatik algılar ve yönlendirir
      // Ama biz yine de manuel tetikleyelim
      navigate('/app/dashboard');
    }
  };

  // KAYIT OLMA (Test amaçlı, ileride kapatabilirsin)
  const handleRegister = async () => {
    setLoading(true);
    setErrorMsg('');
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
    } else {
      alert("Kayıt başarılı! Lütfen e-postanızı onaylayın veya giriş yapın.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        
        {/* Dil Seçeneği */}
        <div className="flex justify-end gap-2 mb-4 text-sm">
          <button onClick={() => changeLanguage('tr')} className={`font-bold ${i18n.language === 'tr' ? 'text-blue-600' : 'text-gray-400'}`}>TR</button>
          <span className="text-gray-300">|</span>
          <button onClick={() => changeLanguage('en')} className={`font-bold ${i18n.language === 'en' ? 'text-blue-600' : 'text-gray-400'}`}>EN</button>
        </div>

        <h2 className="text-2xl font-bold text-center mb-6 text-gray-800">
          {t('login_title')}
        </h2>

        {errorMsg && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded mb-4 text-sm">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">
              {t('email')}
            </label>
            <input
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">
              {t('password')}
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition duration-300 disabled:opacity-50"
          >
            {loading ? t('loading') : t('login_button')}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button 
            onClick={handleRegister}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-blue-600 underline"
          >
            {t('register_button')} (Yeni Hesap Oluştur)
          </button>
        </div>

      </div>
    </div>
  );
}