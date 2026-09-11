import type { BrowserAuthEvent as AuthChangeEvent, BrowserAuthSession as Session, BrowserAuthUser as User } from './browserAuthTypes';

type Listener = (event: AuthChangeEvent, session: Session | null) => void | Promise<void>;
type AuthPayload = { user: { id: string; email: string; name: string; emailVerified: boolean; createdAt: string }; session: { token: string; expiresAt: string } };

/** Transitional UI shapes only. All requests use the same-origin Cloudflare proxy. */
export function createCloudflareBrowserAuth(
  fetchImpl: typeof fetch = fetch,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
) {
  const listeners = new Set<Listener>();
  let cached: Session | null = null; let cacheUntil = 0; let revision = 0;
  let loading: Promise<Session | null> | null = null;
  const notify = (event: AuthChangeEvent, session: Session | null) => {
    for (const listener of listeners) void Promise.resolve(listener(event, session)).catch(() => {});
  };
  const invalidate = () => { revision++; cacheUntil = 0; loading = null; };
  const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('heavy-cloudflare-auth') : null;
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(`${origin}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(typeof data?.message === 'string' ? data.message : '認証サービスに接続できませんでした。'), { code: data?.code || data?.error, status: response.status });
    return data as T;
  };
  const toUser = (user: AuthPayload['user']): User => ({
    id: user.id, email: user.email, aud: 'authenticated', created_at: user.createdAt,
    app_metadata: { provider: 'cloudflare' }, user_metadata: { name: user.name },
    email_confirmed_at: user.emailVerified ? user.createdAt : undefined,
  });
  const load = async (force = false): Promise<Session | null> => {
    if (!force && cacheUntil > Date.now()) return cached;
    if (loading) return loading;
    const generation = revision;
    const operation = request<AuthPayload | null>('/get-session').then(data => {
      if (generation !== revision) return cached;
      const expiry = data ? Date.parse(data.session.expiresAt) : 0;
      const previous = cached;
      cached = data && data.user.emailVerified && typeof data.session.token === 'string' && expiry > Date.now() ? {
        access_token: data.session.token, refresh_token: '', token_type: 'bearer',
        expires_at: Math.floor(expiry / 1000), expires_in: Math.floor((expiry - Date.now()) / 1000), user: toUser(data.user),
      } : null;
      cacheUntil = Math.min(Date.now() + 60000, expiry || Date.now() + 15000);
      // A cache-expiry read can return the same session cookie without any
      // auth transition. Emitting TOKEN_REFRESHED for that read makes the
      // auth store discard its confirmed brand fence while a long provider
      // request is still running. Only a real token transition needs an auth
      // event; SIGNED_OUT remains observable even when the session was cached.
      const event = cached
        ? previous
          ? previous.access_token !== cached.access_token ? 'TOKEN_REFRESHED' : null
          : 'SIGNED_IN'
        : 'SIGNED_OUT';
      if (event) notify(event, cached);
      return cached;
    }).finally(() => { if (loading === operation) loading = null; });
    loading = operation; return operation;
  };
  if (channel) channel.onmessage = () => { invalidate(); void load(true).catch(() => {}); };
  const changed = () => channel?.postMessage('session-changed');
  const sessionResult = async (force = false) => {
    try { return { data: { session: await load(force) }, error: null }; }
    catch (error) { return { data: { session: null }, error: error as Error }; }
  };
  return {
    getSession: () => sessionResult(),
    refreshSession: () => sessionResult(true),
    async getUser() { const result = await sessionResult(true); return { data: { user: result.data.session?.user ?? null }, error: result.error }; },
    onAuthStateChange(listener: Listener) {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    },
    async signInWithPassword(input: { email: string; password: string }) {
      try {
        await request('/sign-in/email', input); invalidate();
        const session = await load(true);
        if (!session) throw new Error('ログイン状態を確認できませんでした。');
        changed(); return { data: { session, user: session.user }, error: null };
      } catch (error) { return { data: { session: null, user: null }, error: error as Error }; }
    },
    async signUp(input: { email: string; password: string; options?: { data?: { name?: string } } }): Promise<{ data: { user: User | null; session: Session | null }; error: Error | null }> {
      try {
        const result = await request<{ user: AuthPayload['user'] }>('/sign-up/email', {
          email: input.email, password: input.password, name: input.options?.data?.name || input.email.split('@')[0], callbackURL: `${origin}/login?verified=1`,
        });
        return { data: { user: toUser(result.user), session: null }, error: null };
      } catch (error) { return { data: { user: null, session: null }, error: error as Error }; }
    },
    async signOut() {
      invalidate();
      try {
        await request('/sign-out', {}); invalidate(); cached = null; notify('SIGNED_OUT', null); changed();
        return { error: null };
      } catch (error) { return { error: error as Error }; }
    },
    async resetPasswordForEmail(email: string, options?: { redirectTo?: string }) {
      try { await request('/request-password-reset', { email, redirectTo: options?.redirectTo || `${origin}/reset-password` }); return { data: {}, error: null }; }
      catch (error) { return { data: null, error: error as Error }; }
    },
    async completePasswordReset(token: string, password: string) {
      await request('/reset-password', { token, newPassword: password }); invalidate(); cached = null; notify('SIGNED_OUT', null); changed();
    },
    async signInWithOAuth(input: { provider: 'google' | 'apple'; options?: { redirectTo?: string } }) {
      try {
        const result = await request<{ url: string }>('/sign-in/social', { provider: input.provider, callbackURL: input.options?.redirectTo || `${origin}/auth/callback` });
        const target = new URL(result.url);
        if (target.protocol !== 'https:') throw new Error('認証先URLが不正です。');
        window.location.assign(target.toString()); return { error: null };
      } catch (error) { return { error: error as Error }; }
    },
    dispose() { channel?.close(); listeners.clear(); invalidate(); cached = null; },
  };
}
