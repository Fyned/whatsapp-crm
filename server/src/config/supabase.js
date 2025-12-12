require('dotenv').config(); // .env dosyasını okumak için
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // veya SUPABASE_ANON_KEY, .env dosyamda hangisi yazıyorsa

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL veya Key .env dosyasında bulunamadı!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;