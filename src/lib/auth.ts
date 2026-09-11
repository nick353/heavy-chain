import type { BrowserAuthSession as Session } from './browserAuthTypes';
import { withAuthSessionRecovery as recoverAuthSession } from './authSessionRecovery';
import { createCloudflareBrowserAuth } from './cloudflareBrowserAuth';

export { isAuthFailure } from './authSessionRecovery';

export const cloudflareAuthEnabled = true;
export const auth = createCloudflareBrowserAuth();
export const completePasswordReset = (token: string, password: string) => auth.completePasswordReset(token, password);

let refreshSessionInFlight: Promise<Session | null> | null = null;

/** Refresh once per browser client so parallel reads do not rotate tokens repeatedly. */
export const refreshAuthSession = async () => {
  if (!refreshSessionInFlight) {
    refreshSessionInFlight = auth.refreshSession()
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

export const withAuthSessionRecovery = <T>(operation: () => Promise<T>) => (
  recoverAuthSession(operation, refreshAuthSession)
);

/** Perform a credential-free, read-only Auth availability check for recovery UX. */
export const probeAuthService = async (options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}) => {
  const response = await (options.fetchImpl || fetch)('/api/auth/ok', { signal: options.signal, credentials: 'omit' });
  if (!response.ok) throw new Error('認証サービスに接続できませんでした。');
};

export const getCurrentUser = async () => {
  const { data: { user }, error } = await auth.getUser();
  if (error) throw error;
  return user;
};

export const getCurrentSession = async () => {
  const { data: { session }, error } = await auth.getSession();
  if (error) throw error;
  return session;
};
