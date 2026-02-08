import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
    console.error('❌ Supabase URL missing! Set VITE_SUPABASE_URL in your hosting environment.');
}
if (!supabaseAnonKey) {
    console.error('❌ Supabase Anon Key missing! Set VITE_SUPABASE_ANON_KEY in your hosting environment.');
}

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration incomplete.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
