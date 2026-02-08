import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

if (!isSupabaseConfigured) {
    if (!supabaseUrl) console.error('❌ Supabase URL missing! Set VITE_SUPABASE_URL in your hosting environment (Vercel/Netlify).');
    if (!supabaseAnonKey) console.error('❌ Supabase Anon Key missing! Set VITE_SUPABASE_ANON_KEY in your hosting environment (Vercel/Netlify).');
}

// Export the client (or null if not configured)
// We cast to any to avoid type errors in services that expect a valid client, 
// as those services now have their own check/catch logic.
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null as any;
