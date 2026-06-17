import { createClient } from '@supabase/supabase-js';

const productionFallbackSupabaseUrl = 'https://ghwjymozrwmcrpjqvbmo.supabase.co';
const productionFallbackSupabaseAnonKey = 'sb_publishable_TD0eBipIwCZEF7pcNsoB8A_YfotVpaV';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (import.meta.env.PROD ? productionFallbackSupabaseUrl : undefined);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || (import.meta.env.PROD ? productionFallbackSupabaseAnonKey : undefined);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Helper function to get current user
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
};

// Helper function to get current session
export const getCurrentSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
};
