import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { User as DbUser, Brand } from '../types/database';

interface AuthState {
  user: User | null;
  profile: DbUser | null;
  currentBrand: Brand | null;
  isLoading: boolean;
  isInitialized: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<DbUser>) => Promise<void>;
  setCurrentBrand: (brand: Brand | null) => void;
}

const fetchFirstAccessibleBrand = async (): Promise<Brand | null> => {
  const { data: brands, error } = await supabase
    .from('brands')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return brands?.[0] || null;
};

export const ensureUserProfile = async (user: User, name?: string | null): Promise<DbUser | null> => {
  const { data: profile, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (profile) return profile;

  const { data: createdProfile, error: upsertError } = await supabase
    .from('users')
    .upsert({
      id: user.id,
      email: user.email!,
      name: name ?? user.user_metadata?.name ?? user.user_metadata?.full_name ?? null,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    }, { onConflict: 'id' })
    .select('*')
    .maybeSingle();

  if (upsertError) throw upsertError;
  return createdProfile;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  currentBrand: null,
  isLoading: true,
  isInitialized: false,

  initialize: async () => {
    try {
      set({ isLoading: true });
      
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        try {
          const profile = await ensureUserProfile(session.user);
          
          let currentBrand: Brand | null = null;
          let retries = 3;
          while (retries > 0 && !currentBrand) {
            try {
              currentBrand = await fetchFirstAccessibleBrand();
              break;
            } catch (brandsError) {
              console.error('Failed to fetch brands (retry:', 4 - retries, '):', brandsError);
              retries--;
              if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
          }
          
          set({
            user: session.user,
            profile: profile || null,
            currentBrand,
          });
        } catch (error) {
          console.error('Error fetching user data:', error);
          set({
            user: session.user,
            profile: null,
            currentBrand: null,
          });
        }
      }
      
      // Set up auth state listener
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          try {
            const profile = await ensureUserProfile(session.user);
            
            const currentBrand = await fetchFirstAccessibleBrand();
            
            set({
              user: session.user,
              profile: profile || null,
              currentBrand,
            });
          } catch (error) {
            console.error('Error in auth state change:', error);
            set({
              user: session.user,
              profile: null,
              currentBrand: null,
            });
          }
        } else if (event === 'SIGNED_OUT') {
          set({ user: null, profile: null, currentBrand: null });
        }
      });
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
  },

  signInWithEmail: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  signUpWithEmail: async (email: string, password: string, name: string) => {
    set({ isLoading: true });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });
      if (error) throw error;
      
      if (data.user) {
        const { error: profileError } = await supabase.from('users').upsert({
          id: data.user.id,
          email: data.user.email!,
          name,
          avatar_url: data.user.user_metadata?.avatar_url ?? null,
        }, { onConflict: 'id' });

        if (profileError) throw profileError;
      }
    } finally {
      set({ isLoading: false });
    }
  },

  signInWithGoogle: async () => {
    set({ isLoading: true });
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  signInWithApple: async () => {
    set({ isLoading: true });
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  signOut: async () => {
    set({ isLoading: true });
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      set({ user: null, profile: null, currentBrand: null });
    } finally {
      set({ isLoading: false });
    }
  },

  updateProfile: async (updates: Partial<DbUser>) => {
    const { user } = get();
    if (!user) throw new Error('Not authenticated');
    
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id);
    
    if (error) throw error;
    
    set((state) => ({
      profile: state.profile ? { ...state.profile, ...updates } : null,
    }));
  },

  setCurrentBrand: (brand: Brand | null) => {
    set({ currentBrand: brand });
  },
}));
