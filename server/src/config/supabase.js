require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// ÖNEMLİ: Eğer Service Role Key varsa onu kullan (Yönetici Modu), yoksa normal Key'i kullan.
// Backend işlemleri için Service Role şarttır, yoksa RLS engeline takılır.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = supabase;