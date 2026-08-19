import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import {
  withSupabaseSessionRecovery as withSessionRecovery,
} from './supabaseSessionRecovery';

export { isSupabaseAuthFailure } from './supabaseSessionRecovery';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

let refreshSessionInFlight: Promise<Session | null> | null = null;

/** Refresh once per browser client so parallel Gallery/Jobs/Canvas failures do not rotate tokens repeatedly. */
export const refreshSupabaseSession = async () => {
  if (!refreshSessionInFlight) {
    refreshSessionInFlight = supabase.auth.refreshSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return data.session;
      })
      .finally(() => {
        refreshSessionInFlight = null;
      });
  }
  return refreshSessionInFlight;
};

export const withSupabaseSessionRecovery = <T>(operation: () => Promise<T>) => (
  withSessionRecovery(operation, refreshSupabaseSession)
);

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
