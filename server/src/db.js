require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("HATA: .env dosyasında SUPABASE bilgileri eksik!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("Supabase bağlantısı başlatıldı.");

module.exports = supabase;