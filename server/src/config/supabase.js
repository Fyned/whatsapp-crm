const path = require('path');
// .env dosyasını 2 üst dizinden (ana proje klasöründen) bulmaya çalış
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { createClient } = require('@supabase/supabase-js');

// Hem VITE_ prefixli hem normal değişkenleri kontrol et
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    // Hata fırlatmak yerine null döndür ki tüm sunucuyu çökertmesin
    console.error("UYARI: src/config/supabase.js içinde Supabase URL veya Key bulunamadı!");
}

const supabase = supabaseUrl && supabaseKey 
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
      })
    : null;

module.exports = supabase;