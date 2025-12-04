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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  currentBrand: null,
  isLoading: true,
  isInitialized: false,

  initialize: async () => {
    try {
      set({ isLoading: true });
      
      // Check if Supabase is configured
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        console.warn('Supabase not configured - running in demo mode');
        set({ isLoading: false, isInitialized: true });
        return;
      }
      
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        // Fetch user profile
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();
        
        // Fetch user's brands
        const { data: brands } = await supabase
          .from('brands')
          .select('*')
          .eq('owner_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        
        set({
          user: session.user,
          profile: profile || null,
          currentBrand: brands?.[0] || null,
        });
      }
      
      // Set up auth state listener
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();
          
          const { data: brands } = await supabase
            .from('brands')
            .select('*')
            .eq('owner_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(1);
          
          set({
            user: session.user,
            profile: profile || null,
            currentBrand: brands?.[0] || null,
          });
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
      
      // Create user profile
      if (data.user) {
        await supabase.from('users').insert({
          id: data.user.id,
          email: data.user.email!,
          name,
        });
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

