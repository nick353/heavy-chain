import { create } from 'zustand';
import type { BrowserAuthUser as User } from '../lib/browserAuthTypes';
import { auth, withAuthSessionRecovery } from '../lib/auth';
import type { User as DbUser, Brand } from '../types/database';
import {
  beginAuthBrandSelection,
  canSelectConfirmedBrand,
  failAuthBrandSelection,
  INITIAL_AUTH_BRAND_SELECTION_STATE,
  resolveAuthBrandSelection,
  selectCurrentBrand,
  type AuthBrandSelectionState,
} from '../lib/authBrandSelection';
import { cloudflareDataPlane } from '../lib/cloudflareApi';

interface AuthState {
  user: User | null;
  profile: DbUser | null;
  currentBrand: Brand | null;
  accessibleBrands: Brand[];
  brandState: AuthBrandSelectionState;
  isLoading: boolean;
  isInitialized: boolean;
  authRecoveryRequired: boolean;
  
  // Actions
  initialize: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  adoptAuthenticatedSession: (user: User, profile?: DbUser | null) => void;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<DbUser>) => Promise<void>;
  refreshCurrentBrand: () => Promise<Brand | null>;
  clearAuthRecoveryRequired: () => void;
  setCurrentBrand: (brand: Brand | null) => void;
}

const fetchAccessibleBrandsRequest = async (userId: string): Promise<Brand[]> => {
  if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
  const session = await auth.getSession();
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== userId) throw new Error('cloudflare_identity_mismatch');
  return cloudflareDataPlane.listBrands();
};

export const fetchAccessibleBrandsForCurrentUser = async (userId: string): Promise<Brand[]> => (
  withAuthSessionRecovery(() => fetchAccessibleBrandsRequest(userId))
);

const isRecoverableNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Failed to fetch|NetworkError|Load failed|ERR_ABORTED/i.test(message);
};

// Keep the store timeout longer than the browser auth adapter's 10s request
// timeout so service errors are returned and handled instead of being masked
// by an earlier unauthenticated fallback.
const AUTH_SESSION_TIMEOUT_MS = 12_000;
const AUTH_OPERATION_TIMEOUT_MS = 12_000;
const AUTH_PROFILE_TIMEOUT_MS = 10_000;
let authStateListenerRegistered = false;
let activeInitializeToken = 0;
let activeAdmitUser: ((user: User) => Promise<void>) | null = null;
let activeInvalidateAdmission: (() => void) | null = null;

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

export const ensureUserProfile = async (user: User): Promise<DbUser | null> => {
  if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
  const profile = await cloudflareDataPlane.getProfile();
  if (profile.id !== user.id) throw new Error('cloudflare_identity_mismatch');
  return profile;
};

export const useAuthStore = create<AuthState>((set, get) => {
  const clearBrandAuthority = (userId: string | null) => {
    const brandState = beginAuthBrandSelection(get().brandState, userId);
    set({ currentBrand: null, accessibleBrands: [], brandState });
    return brandState.requestGeneration;
  };

  const refreshBrandAuthority = async (userId: string): Promise<Brand | null> => {
    if (get().user?.id !== userId) return null;
    const previousState = get();
    const previousBrand = canSelectConfirmedBrand(
      previousState.brandState,
      userId,
      previousState.currentBrand?.id ?? null,
    )
      ? previousState.currentBrand
      : null;
    const requestGeneration = clearBrandAuthority(userId);
    try {
      const brands = await withAuthTimeout(
        fetchAccessibleBrandsForCurrentUser(userId),
        AUTH_PROFILE_TIMEOUT_MS,
        'auth_brand_timeout',
      );
      const state = get();
      if (state.user?.id !== userId || state.brandState.requestGeneration !== requestGeneration) return null;
      const brandState = resolveAuthBrandSelection(
        state.brandState,
        userId,
        requestGeneration,
        brands,
      );
      const currentBrand = selectCurrentBrand(previousBrand, brands);
      set({
        accessibleBrands: [...brands],
        currentBrand: brandState.status === 'success_nonempty' ? currentBrand : null,
        brandState,
      });
      return brandState.status === 'success_nonempty' ? currentBrand : null;
    } catch (error) {
      logAuthError('Failed to refresh current brand:', error);
      const state = get();
      if (state.user?.id !== userId || state.brandState.requestGeneration !== requestGeneration) return null;
      set({
        currentBrand: null,
        accessibleBrands: [],
        brandState: failAuthBrandSelection(state.brandState, userId, requestGeneration, error),
      });
      return null;
    }
  };

  return ({
  user: null,
  profile: null,
  currentBrand: null,
  accessibleBrands: [],
  brandState: INITIAL_AUTH_BRAND_SELECTION_STATE,
  isLoading: true,
  isInitialized: false,
  authRecoveryRequired: false,

  initialize: async () => {
    const initializeToken = ++activeInitializeToken;
    let admissionSequence = 0;
    let latestAdmission: Promise<void> = Promise.resolve();

    const invalidateAdmission = () => {
      admissionSequence += 1;
      latestAdmission = Promise.resolve();
    };

    const admitUser = (user: User) => {
      const sequence = ++admissionSequence;
      const admissionGeneration = clearBrandAuthority(user.id);
      set({ user, profile: null, authRecoveryRequired: false });
      const admission = new Promise<void>((resolve) => {
        setTimeout(async () => {
          try {
            const profile = await withAuthTimeout(
              ensureUserProfile(user),
              AUTH_PROFILE_TIMEOUT_MS,
              'auth_profile_timeout',
            );
            if (sequence !== admissionSequence || get().user?.id !== user.id || get().brandState.requestGeneration !== admissionGeneration) {
              resolve();
              return;
            }
            set({ user, profile: profile || null, authRecoveryRequired: false });
            await refreshBrandAuthority(user.id);
          } catch (error) {
            logAuthError('Error refreshing authenticated user data:', error);
            if (sequence !== admissionSequence || get().user?.id !== user.id || get().brandState.requestGeneration !== admissionGeneration) {
              resolve();
              return;
            }
            set((state) => ({
              user,
              profile: state.profile?.id === user.id ? state.profile : null,
              currentBrand: null,
              accessibleBrands: [],
              brandState: failAuthBrandSelection(
                state.brandState,
                user.id,
                state.brandState.requestGeneration,
                error,
              ),
            }));
          } finally {
            resolve();
          }
        }, 0);
      });
      latestAdmission = admission;
      return admission;
    };

    activeAdmitUser = admitUser;
    activeInvalidateAdmission = invalidateAdmission;

    try {
      set({ isLoading: true, authRecoveryRequired: false });
      if (!authStateListenerRegistered) {
        authStateListenerRegistered = true;
        auth.onAuthStateChange((event, session) => {
          if (session?.user && ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
            void activeAdmitUser?.(session.user);
          } else if (event === 'SIGNED_OUT') {
            activeInvalidateAdmission?.();
            clearBrandAuthority(null);
            set({ user: null, profile: null, authRecoveryRequired: false });
          }
        });
      }

      const { data: { session }, error } = await withAuthTimeout(
        auth.getSession(),
        AUTH_SESSION_TIMEOUT_MS,
        'auth_session_timeout',
      );
      if (error) throw error;
      if (session?.user) {
        const initialAdmission = admitUser(session.user);
        let observedAdmission = initialAdmission;
        await observedAdmission;
        while (latestAdmission !== observedAdmission) {
          observedAdmission = latestAdmission;
          await observedAdmission;
        }
      } else {
        invalidateAdmission();
        clearBrandAuthority(null);
        set({ user: null, profile: null, authRecoveryRequired: false });
      }
    } catch (error) {
      logAuthError('Failed to initialize auth:', error);
      set((state) => ({
        currentBrand: null,
        accessibleBrands: [],
        brandState: beginAuthBrandSelection(state.brandState, state.user?.id ?? null),
        authRecoveryRequired: !state.user,
      }));
    } finally {
      if (initializeToken === activeInitializeToken) {
        set({ isLoading: false, isInitialized: true });
      }
    }
  },

  signInWithEmail: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const { data, error } = await withAuthTimeout(
        auth.signInWithPassword({
          email,
          password,
        }),
        AUTH_OPERATION_TIMEOUT_MS,
        'auth_sign_in_timeout',
      );
      if (error) throw error;
      if (!data.session?.user) throw new Error('auth_session_missing_after_sign_in');

      // Do not depend on the asynchronous SIGNED_IN listener before the
      // caller navigates to a protected route. Without this synchronous
      // admission, ProtectedRoute can briefly observe user=null and send a
      // successful email login back to /login.
      set({
        user: data.session.user,
        profile: null,
        currentBrand: null,
        accessibleBrands: [],
        brandState: beginAuthBrandSelection(get().brandState, data.session.user.id),
        authRecoveryRequired: false,
      });
      return data.session.user;
    } finally {
      set({ isLoading: false });
    }
  },

  signUpWithEmail: async (email: string, password: string, name: string) => {
    set({ isLoading: true });
    try {
      const { error } = await withAuthTimeout(
        auth.signUp({
          email,
          password,
          options: {
            data: { name },
          },
        }),
        AUTH_OPERATION_TIMEOUT_MS,
        'auth_sign_up_timeout',
      );
      if (error) throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  signInWithGoogle: async () => {
    set({ isLoading: true });
    try {
      const { error } = await withAuthTimeout(
        auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        }),
        AUTH_OPERATION_TIMEOUT_MS,
        'auth_oauth_timeout',
      );
      if (error) throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  signInWithApple: async () => {
    set({ isLoading: true });
    try {
      const { error } = await withAuthTimeout(
        auth.signInWithOAuth({
          provider: 'apple',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        }),
        AUTH_OPERATION_TIMEOUT_MS,
        'auth_oauth_timeout',
      );
      if (error) throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  adoptAuthenticatedSession: (user: User, profile: DbUser | null = null) => {
    const brandState = beginAuthBrandSelection(get().brandState, user.id);
    set({
      user,
      profile,
      currentBrand: null,
      accessibleBrands: [],
      brandState,
      authRecoveryRequired: false,
      isLoading: false,
      isInitialized: true,
    });
  },

  signOut: async () => {
    // Revoke the in-memory brand authority before the provider call resolves.
    // A sign-out timeout or error must not leave a previously confirmed brand
    // usable while the auth transition is still in flight.
    clearBrandAuthority(null);
    set({ isLoading: true });
    try {
      const { error } = await withAuthTimeout(
        auth.signOut(),
        AUTH_OPERATION_TIMEOUT_MS,
        'auth_sign_out_timeout',
      );
      if (error) throw error;
      set({ user: null, profile: null, authRecoveryRequired: false });
    } finally {
      set({ isLoading: false });
    }
  },

  updateProfile: async (updates: Partial<DbUser>) => {
    const { user } = get();
    if (!user) throw new Error('Not authenticated');

    if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
    const requestGeneration = get().brandState.requestGeneration;
    const unsupported = Object.keys(updates).filter((key) => !['name', 'avatar_url', 'language'].includes(key));
    if (unsupported.length > 0) throw new Error(`cloudflare_profile_field_unsupported:${unsupported.join(',')}`);
    const profile = await cloudflareDataPlane.updateProfile({
      name: updates.name ?? get().profile?.name ?? null,
      avatar_url: updates.avatar_url ?? get().profile?.avatar_url ?? null,
      language: updates.language ?? get().profile?.language ?? 'ja',
    });
    if (profile.id !== user.id) throw new Error('cloudflare_identity_mismatch');
    if (get().user?.id !== user.id || get().brandState.requestGeneration !== requestGeneration) throw new Error('cloudflare_profile_context_changed');
    set({ profile });
  },

  refreshCurrentBrand: async () => {
    const { user } = get();
    if (!user) {
      clearBrandAuthority(null);
      return null;
    }
    return refreshBrandAuthority(user.id);
  },

  clearAuthRecoveryRequired: () => {
    set({ authRecoveryRequired: false });
  },

  setCurrentBrand: (brand: Brand | null) => {
    const state = get();
    if (!brand) {
      set({ currentBrand: null });
      return;
    }
    if (!canSelectConfirmedBrand(state.brandState, state.user?.id ?? null, brand.id)) return;
    const confirmedBrand = state.accessibleBrands.find((candidate) => candidate.id === brand.id);
    if (confirmedBrand) set({ currentBrand: confirmedBrand });
  },
  });
});
