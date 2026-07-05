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
  authRecoveryRequired: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<DbUser>) => Promise<void>;
  refreshCurrentBrand: () => Promise<Brand | null>;
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

const isRecoverableNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Failed to fetch|NetworkError|Load failed|ERR_ABORTED/i.test(message);
};

const AUTH_SESSION_TIMEOUT_MS = 8_000;
const AUTH_PROFILE_TIMEOUT_MS = 10_000;
let authStateListenerRegistered = false;
let authBrandRefreshSeq = 0;
let currentBrandRefreshSeq = 0;
const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
})();

async function withAuthTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const logAuthError = (message: string, error: unknown) => {
  if (!import.meta.env.DEV) return;

  if (isRecoverableNetworkError(error)) {
    console.warn(message, error);
    return;
  }
  console.error(message, error);
};

const getStoredSessionUser = (): User | null => {
  if (typeof window === 'undefined' || !SUPABASE_PROJECT_REF) return null;

  try {
    const key = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
    if (!key) return null;

    const rawSession = window.localStorage.getItem(key);
    if (!rawSession) return null;

    const session = JSON.parse(rawSession) as { access_token?: string; expires_at?: number; user?: User };
    if (!session.access_token) return null;

    const [, payload] = session.access_token.split('.');
    if (!payload) return null;

    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(normalizedPayload.length + ((4 - normalizedPayload.length % 4) % 4), '=');
    const claims = JSON.parse(window.atob(paddedPayload)) as {
      aud?: string;
      email?: string;
      exp?: number;
      role?: string;
      sub?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    };

    const expiresAtMs = (session.expires_at || claims.exp || 0) * 1000;
    if (!claims.sub || expiresAtMs <= Date.now()) return null;
    if (claims.aud && claims.aud !== 'authenticated') return null;
    if (claims.role && claims.role !== 'authenticated') return null;

    return {
      ...(session.user || {}),
      id: claims.sub,
      aud: session.user?.aud || claims.aud || 'authenticated',
      role: session.user?.role || claims.role || 'authenticated',
      email: session.user?.email || claims.email,
      app_metadata: session.user?.app_metadata || claims.app_metadata || {},
      user_metadata: session.user?.user_metadata || claims.user_metadata || {},
      created_at: session.user?.created_at || '',
      updated_at: session.user?.updated_at || '',
    } as User;
  } catch (error) {
    logAuthError('Failed to read stored auth session:', error);
    return null;
  }
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
  authRecoveryRequired: false,

  initialize: async () => {
    try {
      set({ isLoading: true, authRecoveryRequired: false });

      // Set up auth state listener before reading the current session so the UI can recover
      // even when the initial session read is slow or interrupted by browser storage state.
      if (!authStateListenerRegistered) {
        authStateListenerRegistered = true;
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'TOKEN_REFRESHED' && session?.user) {
            set({ user: session.user, authRecoveryRequired: false });
          } else if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
            const { user } = session;
            set({
              user,
              profile: null,
              currentBrand: null,
              authRecoveryRequired: false,
            });

            setTimeout(async () => {
              try {
                const profile = await withAuthTimeout(
                  ensureUserProfile(user),
                  AUTH_PROFILE_TIMEOUT_MS,
                  'auth_profile_timeout',
                );

                if (get().user?.id !== user.id) return;
                set({ user, profile: profile || null, authRecoveryRequired: false });

                const brandRefreshSeq = ++authBrandRefreshSeq;
                const brands = await withAuthTimeout(
                  fetchAccessibleBrandsForCurrentUser(user.id),
                  AUTH_PROFILE_TIMEOUT_MS,
                  'auth_brand_timeout',
                );

                const state = get();
                if (brandRefreshSeq !== authBrandRefreshSeq) return;
                if (state.user?.id !== user.id) return;
                const currentBrand = state.currentBrand && brands.some((brand) => brand.id === state.currentBrand?.id)
                  ? state.currentBrand
                  : brands[0] || null;

                set({
                  user,
                  profile: profile || null,
                  currentBrand,
                  authRecoveryRequired: false,
                });
              } catch (error) {
                logAuthError('Error in auth state change:', error);
                if (get().user?.id !== user.id) return;
                set({
                  user,
                  profile: get().profile,
                  currentBrand: get().currentBrand,
                  authRecoveryRequired: false,
                });
              }
            }, 0);
          } else if (event === 'SIGNED_OUT') {
            set({ user: null, profile: null, currentBrand: null, authRecoveryRequired: false });
          }
        });
      }

      const storedUser = getStoredSessionUser();
      if (storedUser) {
        set({
          user: storedUser,
          profile: null,
          currentBrand: null,
          authRecoveryRequired: false,
        });

        setTimeout(async () => {
          try {
            const profile = await withAuthTimeout(
              ensureUserProfile(storedUser),
              AUTH_PROFILE_TIMEOUT_MS,
              'auth_profile_timeout',
            );

            if (get().user?.id !== storedUser.id) return;
            set({ user: storedUser, profile: profile || null, authRecoveryRequired: false });

            const brandRefreshSeq = ++authBrandRefreshSeq;
            const brands = await withAuthTimeout(
              fetchAccessibleBrandsForCurrentUser(storedUser.id),
              AUTH_PROFILE_TIMEOUT_MS,
              'auth_brand_timeout',
            );

            const state = get();
            if (brandRefreshSeq !== authBrandRefreshSeq) return;
            if (state.user?.id !== storedUser.id) return;
            const currentBrand = state.currentBrand && brands.some((brand) => brand.id === state.currentBrand?.id)
              ? state.currentBrand
              : brands[0] || null;

            set({
              user: storedUser,
              profile: profile || null,
              currentBrand,
              authRecoveryRequired: false,
            });
          } catch (error) {
            logAuthError('Error restoring stored auth user data:', error);
            if (get().user?.id !== storedUser.id) return;
            set({
              user: storedUser,
              profile: get().profile,
              currentBrand: get().currentBrand,
              authRecoveryRequired: false,
            });
          }
        }, 0);
      }
      
      // Get current session
      const { data: { session } } = await withAuthTimeout(
        supabase.auth.getSession(),
        AUTH_SESSION_TIMEOUT_MS,
        'auth_session_timeout',
      );
      
      if (session?.user) {
        const { user } = session;
        set({
          user,
          profile: null,
          currentBrand: null,
          authRecoveryRequired: false,
        });

        setTimeout(async () => {
          try {
            const profile = await withAuthTimeout(
              ensureUserProfile(user),
              AUTH_PROFILE_TIMEOUT_MS,
              'auth_profile_timeout',
            );

            if (get().user?.id !== user.id) return;
            set({ user, profile: profile || null, authRecoveryRequired: false });

            const brandRefreshSeq = ++authBrandRefreshSeq;
            let brands: Brand[] = [];
            let retries = 3;
            while (retries > 0 && brands.length === 0) {
              try {
                brands = await withAuthTimeout(
                  fetchAccessibleBrandsForCurrentUser(user.id),
                  AUTH_PROFILE_TIMEOUT_MS,
                  'auth_brand_timeout',
                );
                break;
              } catch (brandsError) {
                logAuthError(`Failed to fetch brands (retry: ${4 - retries}):`, brandsError);
                retries--;
                if (retries > 0) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
            }

            const state = get();
            if (brandRefreshSeq !== authBrandRefreshSeq) return;
            if (state.user?.id !== user.id) return;
            const currentBrand = state.currentBrand && brands.some((brand) => brand.id === state.currentBrand?.id)
              ? state.currentBrand
              : brands[0] || null;

            set({
              user,
              profile: profile || null,
              currentBrand,
              authRecoveryRequired: false,
            });
          } catch (error) {
            logAuthError('Error fetching user data:', error);
            if (get().user?.id !== user.id) return;
            set({
              user,
              profile: get().profile,
              currentBrand: get().currentBrand,
              authRecoveryRequired: false,
            });
          }
        }, 0);
      } else {
        set({ user: null, profile: null, currentBrand: null, authRecoveryRequired: false });
      }
    } catch (error) {
      logAuthError('Failed to initialize auth:', error);
      const message = error instanceof Error ? error.message : String(error || '');
      set((state) => ({ authRecoveryRequired: message === 'auth_session_timeout' && !state.user }));
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

  refreshCurrentBrand: async () => {
    const { user } = get();
    if (!user) {
      set({ currentBrand: null });
      return null;
    }

    const refreshSeq = ++currentBrandRefreshSeq;
    try {
      const brands = await withAuthTimeout(
        fetchAccessibleBrandsForCurrentUser(user.id),
        AUTH_PROFILE_TIMEOUT_MS,
        'auth_brand_timeout',
      );
      const state = get();
      if (refreshSeq !== currentBrandRefreshSeq) return null;
      if (state.user?.id !== user.id) return null;

      const nextBrand = state.currentBrand && brands.some((brand) => brand.id === state.currentBrand?.id)
        ? state.currentBrand
        : brands[0] || null;

      authBrandRefreshSeq++;
      set({ currentBrand: nextBrand });
      return nextBrand;
    } catch (error) {
      logAuthError('Failed to refresh current brand:', error);
      return null;
    }
  },

  setCurrentBrand: (brand: Brand | null) => {
    authBrandRefreshSeq++;
    currentBrandRefreshSeq++;
    set({ currentBrand: brand });
  },
}));
