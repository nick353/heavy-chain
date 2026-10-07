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
import { isHeavyWorkspaceBrandName } from '../lib/heavyWorkspace';

interface AuthState {
  user: User | null;
  profile: DbUser | null;
  currentBrand: Brand | null;
  accessibleBrands: Brand[];
  brandState: AuthBrandSelectionState;
  isLoading: boolean;
  isInitialized: boolean;
  authRecoveryRequired: boolean;
  /** True when the auth probe failed transiently; never treated as logout. */
  authServiceUnavailable: boolean;
  
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
  /** Resolve the private Heavy workspace without presenting a brand picker. */
  ensureHeavyWorkspace: () => Promise<Brand | null>;
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
  return /Failed to fetch|NetworkError|Load failed|ERR_ABORTED|AbortError/i.test(message);
};

const isAuthServiceUnavailable = (error: unknown) => {
  const candidate = error as { status?: unknown; code?: unknown } | null;
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return isRecoverableNetworkError(error)
    || (status !== null && status >= 500)
    || /auth_unavailable|auth_session_timeout|timed?\s*out|service\s+unavailable/i.test(`${code} ${message}`);
};

// Keep route hydration aligned with the browser auth adapter.  A valid cookie
// can survive a direct route load while the profile/brand read is still
// settling; a shorter timeout made that valid session appear unauthenticated.
const AUTH_SESSION_TIMEOUT_MS = 32_000;
const AUTH_OPERATION_TIMEOUT_MS = 32_000;
const AUTH_PROFILE_TIMEOUT_MS = 32_000;
const AUTH_EMPTY_SESSION_RETRY_DELAY_MS = 250;
// Heavy image routes may mount several shared workbenches at once. Keep the
// first-login workspace bootstrap single-flight so a slow brand read cannot
// create duplicate personal workspaces from concurrent effects.
const heavyWorkspaceRequests = new Map<string, Promise<Brand | null>>();
let authStateListenerRegistered = false;
// getSession() emits SIGNED_IN from the browser adapter. initialize() admits
// that same session explicitly, so suppress the notification in this narrow
// window to avoid racing duplicate profile/brand hydration requests.
let authInitializationInFlight = false;
let activeInitializeToken = 0;
let activeAdmitUser: ((user: User) => Promise<void>) | null = null;
let activeInvalidateAdmission: (() => void) | null = null;

const isHeavyWorkspaceBrand = (brand: Brand): boolean => isHeavyWorkspaceBrandName(brand.name);

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
  authServiceUnavailable: false,

  initialize: async () => {
    const initializeToken = ++activeInitializeToken;
    let admissionSequence = 0;

    const invalidateAdmission = () => {
      admissionSequence += 1;
    };

    const admitUser = (user: User) => {
      const sequence = ++admissionSequence;
      const admissionGeneration = clearBrandAuthority(user.id);
      set({ user, profile: null, authRecoveryRequired: false, authServiceUnavailable: false });
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
            set({ user, profile: profile || null, authRecoveryRequired: false, authServiceUnavailable: false });
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
      return admission;
    };

    activeAdmitUser = admitUser;
    activeInvalidateAdmission = invalidateAdmission;

    try {
      authInitializationInFlight = true;
      set({ isLoading: true, authRecoveryRequired: false, authServiceUnavailable: false });
      if (!authStateListenerRegistered) {
        authStateListenerRegistered = true;
        auth.onAuthStateChange((event, session) => {
          if (session?.user && ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
            if (authInitializationInFlight && event === 'SIGNED_IN') return;
            // A same-token revalidation is deliberately silent. The browser
            // adapter only emits TOKEN_REFRESHED when the opaque session token
            // actually rotates, but keep this guard here as a second fence so
            // a cache-expiry read can never clear a confirmed brand while a
            // long-running generation or route transition is in flight.
            if (event === 'TOKEN_REFRESHED' && get().user?.id === session.user.id) return;
            void activeAdmitUser?.(session.user);
          } else if (event === 'SIGNED_OUT') {
            activeInvalidateAdmission?.();
            clearBrandAuthority(null);
            set({ user: null, profile: null, authRecoveryRequired: false, authServiceUnavailable: false });
          }
        });
      }

      let { data: { session }, error } = await withAuthTimeout(
        auth.getSession(),
        AUTH_SESSION_TIMEOUT_MS,
        'auth_session_timeout',
      );
      if (error) throw error;
      // A just-issued HttpOnly cookie can arrive one event loop tick after a
      // direct route navigation (especially through the Zeabur auth proxy).
      // Re-read the same cookie once before treating the browser as anonymous.
      // This keeps the Lightchain shell continuous without persisting a token
      // or weakening the definitive anonymous boundary.
      if (!session) {
        await new Promise((resolve) => setTimeout(resolve, AUTH_EMPTY_SESSION_RETRY_DELAY_MS));
        const retry = await withAuthTimeout(
          auth.refreshSession(),
          AUTH_SESSION_TIMEOUT_MS,
          'auth_session_retry_timeout',
        );
        if (retry.error) throw retry.error;
        session = retry.data.session;
      }
      if (session?.user) {
        // A valid browser session is enough to unlock the protected shell.
        // Profile and brand hydration continues under the same user/brand
        // fence, but must not make every direct route wait for a potentially
        // slow API read before the user can move between Lightchain screens.
        void admitUser(session.user);
        if (initializeToken === activeInitializeToken) {
          set({ isLoading: false, isInitialized: true, authRecoveryRequired: false, authServiceUnavailable: false });
        }
      } else {
        invalidateAdmission();
        clearBrandAuthority(null);
        set({ user: null, profile: null, authRecoveryRequired: false, authServiceUnavailable: false });
      }
    } catch (error) {
      logAuthError('Failed to initialize auth:', error);
      const serviceUnavailable = isAuthServiceUnavailable(error);
      set((state) => ({
        currentBrand: null,
        accessibleBrands: [],
        brandState: beginAuthBrandSelection(state.brandState, state.user?.id ?? null),
        // A transient 5xx/transport failure must not redirect a user to the
        // login page.  Keep the route mounted and let the retry boundary
        // recover the same host-only cookie.  Only a definitive anonymous
        // result converges to login.
        authRecoveryRequired: !state.user && !serviceUnavailable,
        authServiceUnavailable: serviceUnavailable,
      }));
    } finally {
      authInitializationInFlight = false;
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
        authServiceUnavailable: false,
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
      authServiceUnavailable: false,
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
      set({ user: null, profile: null, authRecoveryRequired: false, authServiceUnavailable: false });
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

  ensureHeavyWorkspace: async () => {
    const { user } = get();
    if (!user) return null;
    const existing = heavyWorkspaceRequests.get(user.id);
    if (existing) return existing;

    const request = (async (): Promise<Brand | null> => {
      await get().refreshCurrentBrand();
      const stateAfterRefresh = get();
      const existingHeavy = stateAfterRefresh.accessibleBrands.find(isHeavyWorkspaceBrand) ?? null;
      if (existingHeavy?.id) {
        // Heavy and Light are separate visible products.  Never let a
        // previously selected Light brand become Heavy's implicit workspace.
        set({ currentBrand: existingHeavy });
        return existingHeavy;
      }
      // A transient auth/API failure must never be interpreted as a usable
      // workspace. Bootstrap only after the authoritative list read has
      // completed successfully (empty or non-empty) and no Heavy workspace
      // was found.
      if (stateAfterRefresh.user?.id !== user.id
        || !['success_empty', 'success_nonempty'].includes(stateAfterRefresh.brandState.status)) {
        return null;
      }
      if (!cloudflareDataPlane) return null;

      let created: Brand;
      try {
        created = await cloudflareDataPlane.createBrand({
          name: 'Heavy Chain Workspace',
          brand_colors: { primary: '#101820', secondary: '#7dd3fc' },
          tone_description: 'Private workspace for Heavy Chain image generation',
          target_audience: null,
        });
      } catch (error) {
        logAuthError('Failed to bootstrap Heavy workspace:', error);
        return null;
      }
      if (get().user?.id !== user.id) return null;
      await get().refreshCurrentBrand();
      const latest = get();
      const resolvedHeavy = latest.accessibleBrands.find((brand) => brand.id === created?.id)
        ?? latest.accessibleBrands.find(isHeavyWorkspaceBrand)
        ?? null;
      if (!resolvedHeavy?.id || !canSelectConfirmedBrand(latest.brandState, user.id, resolvedHeavy.id)) return null;
      set({ currentBrand: resolvedHeavy });
      return resolvedHeavy;
    })().finally(() => {
      heavyWorkspaceRequests.delete(user.id);
    });
    heavyWorkspaceRequests.set(user.id, request);
    return request;
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
