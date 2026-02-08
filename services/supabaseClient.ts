import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    if (!supabaseUrl) console.error('❌ Supabase URL missing! Set VITE_SUPABASE_URL in your hosting environment (Vercel/Netlify).');
    if (!supabaseAnonKey) console.error('❌ Supabase Anon Key missing! Set VITE_SUPABASE_ANON_KEY in your hosting environment (Vercel/Netlify).');
    // We export a dummy client that will fail gracefully if used, or we keep the throw. 
    // Let's keep the throw but make it highly visible.
    throw new Error('Supabase Configuration Error: Credentials missing. Check console for details.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
