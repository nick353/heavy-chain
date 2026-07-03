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

export const fetchAccessibleBrandsForCurrentUser = async (userId: string): Promise<Brand[]> => {
  const { data: ownedBrands, error: ownedError } = await supabase
    .from('brands')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false });

  if (ownedError) throw ownedError;

  const { data: memberships, error: membershipError } = await supabase
    .from('brand_members')
    .select('brand_id')
    .eq('user_id', userId)
    .not('joined_at', 'is', null);

  if (membershipError) throw membershipError;

  const memberBrandIds = Array.from(new Set((memberships || []).map((item) => item.brand_id).filter(Boolean)));
  let memberBrands: Brand[] = [];
  if (memberBrandIds.length > 0) {
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .in('id', memberBrandIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    memberBrands = data || [];
  }

  const byId = new Map<string, Brand>();
  for (const brand of [...(ownedBrands || []), ...memberBrands]) {
    byId.set(brand.id, brand);
  }
  return Array.from(byId.values()).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
};

const fetchFirstAccessibleBrand = async (userId: string): Promise<Brand | null> => {
  const brands = await fetchAccessibleBrandsForCurrentUser(userId);

  return brands?.[0] || null;
};

const isRecoverableNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Failed to fetch|NetworkError|Load failed|ERR_ABORTED/i.test(message);
};

const logAuthError = (message: string, error: unknown) => {
  if (!import.meta.env.DEV) return;

  if (isRecoverableNetworkError(error)) {
    console.warn(message, error);
    return;
  }
  console.error(message, error);
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
              currentBrand = await fetchFirstAccessibleBrand(session.user.id);
              break;
            } catch (brandsError) {
              logAuthError(`Failed to fetch brands (retry: ${4 - retries}):`, brandsError);
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
          logAuthError('Error fetching user data:', error);
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
            
            const currentBrand = await fetchFirstAccessibleBrand(session.user.id);
            
            set({
              user: session.user,
              profile: profile || null,
              currentBrand,
            });
          } catch (error) {
            logAuthError('Error in auth state change:', error);
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
      logAuthError('Failed to initialize auth:', error);
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
