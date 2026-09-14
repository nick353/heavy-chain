import { allowedOrigins, appleReady, createAuth, emailReady, mailFailure, type Env } from './auth.ts';
import { recoveryPage } from './recovery-page.ts';
import { verifyMyProEmail } from './email-verification.ts';
import { exchangeNativeCode, NativeOAuthError } from './native-oauth.ts';
import { withAppleNativeSecret } from './apple-native-secret.ts';
import { validateProviderSession } from './provider-validation.ts';
import { MailBudgetError, mailBudgetConfigured } from './mail-budget.ts';
import { cleanupExpiredAuth } from './housekeeping.ts';
export type { Env } from './auth.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
} });
const emailEndpoints = new Set(['/sign-up/email', '/request-password-reset', '/send-verification-email']);
const MAX_AUTH_BODY_BYTES = 16 * 1024;
// Existing cookies must not prevent fresh consent, recovery or local logout.
const publicAuthPaths = new Set(['/sign-in/email', '/sign-up/email', '/sign-in/social', '/sign-in/native',
  '/reauthenticate/native', '/sign-out', '/request-password-reset', '/reset-password', '/send-verification-email',
  '/verify-email', '/callback/google', '/callback/apple', '/jwks']);
// MyPro uses app sessions/JWTs, not public provider tokens. These library routes
// would expose grants and bypass the once-daily refresh/CAS implementation.
const privateProviderPaths = new Set(['/get-access-token', '/refresh-token', '/account-info']);
const providerFailure = (status: 401 | 503) => json({ code: status === 401
  ? 'PROVIDER_REAUTHENTICATION_REQUIRED' : 'PROVIDER_VALIDATION_UNAVAILABLE' }, status);

async function boundedRequest(request: Request): Promise<Request | null> {
  if (!request.body) return request;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_AUTH_BODY_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  env = { ...env, [mailFailure]: {} };
  const url = new URL(request.url);
  // Same-origin browser proxy preserves its URL. No arbitrary Host/X-Forwarded-Host trust.
  if (!allowedOrigins(env).includes(url.origin)) return json({ error: 'host_not_allowed' }, 403);
  const origin = request.headers.get('origin');
  const appleCallback = appleReady(env) && request.method === 'POST' && url.pathname === '/api/auth/callback/apple'
    && origin === 'https://appleid.apple.com';
  if (origin && !allowedOrigins(env).includes(origin) && !appleCallback) return json({ error: 'origin_not_allowed' }, 403);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ service: 'consumer-auth', appId: env.APP_ID ?? 'heavy', storage: 'cloudflare-d1', emailConfigured: emailReady(env), emailBudgetConfigured: mailBudgetConfigured(env) });
  }
  if (env.APP_ID === 'mypro' && request.method === 'GET' && ['/reset-password', '/login'].includes(url.pathname)) {
    return recoveryPage(url.pathname === '/login');
  }
  try {
    const auth = createAuth(env, url.origin);
    if (env.APP_ID === 'mypro' && request.method === 'GET' && url.pathname === '/api/auth/verify-email') {
      return await verifyMyProEmail(request, env, allowedOrigins(env));
    }
    if (url.pathname === '/v1/identity' && request.method === 'GET') {
      // App Workers forward only Authorization, never caller-supplied identity fields.
      if (!/^Bearer \S+$/i.test(request.headers.get('authorization') || '')) return json({ error: 'unauthorized' }, 401);
      const session = await auth.api.getSession({ headers: new Headers({ authorization: request.headers.get('authorization')! }),
        query: { disableCookieCache: true, disableRefresh: true } });
      if (!session || !session.user.emailVerified || new Date(session.session.expiresAt).getTime() <= Date.now()) {
        return json({ error: 'unauthorized' }, 401);
      }
      const providerStatus = await validateProviderSession(env, session.user.id, session.session.id);
      if (providerStatus !== 200) return providerFailure(providerStatus);
      return json({ issuer: env.AUTH_BASE_URL, appId: env.APP_ID ?? 'heavy', subject: session.user.id,
        email: session.user.email, emailVerified: true, name: session.user.name });
    }
    if (!url.pathname.startsWith('/api/auth/')) return json({ error: 'not_found' }, 404);
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (env.APP_ID === 'mypro' && privateProviderPaths.has(url.pathname.slice('/api/auth'.length))) return json({ error: 'not_found' }, 404);
    if (emailEndpoints.has(url.pathname.slice('/api/auth'.length)) && !emailReady(env)) {
      return json({ code: 'EMAIL_NOT_CONFIGURED', message: 'メール送信の設定が完了していません。' }, 503);
    }
    if (emailEndpoints.has(url.pathname.slice('/api/auth'.length)) && !mailBudgetConfigured(env)) {
      return json({ code: 'EMAIL_BUDGET_UNAVAILABLE' }, 503);
    }
    const bounded = await boundedRequest(request);
    if (!bounded) return json({ error: 'body_too_large' }, 413);
    const authPath = url.pathname.slice('/api/auth'.length);
    if (env.APP_ID === 'mypro' && !publicAuthPaths.has(authPath) && !authPath.startsWith('/reset-password/')) {
      // This is intentionally outside Better Auth hooks: bearer-to-cookie hook
      // ordering cannot bypass it, and private handler effects happen only after.
      const session = await auth.api.getSession({ headers: bounded.headers,
        query: { disableCookieCache: true, disableRefresh: true } });
      if (session) {
        const status = await validateProviderSession(env, session.user.id, session.session.id);
        if (status !== 200) return providerFailure(status);
      } else if (bounded.headers.has('authorization')) return json({ error: 'unauthorized' }, 401);
    }
    let response: Response;
    if (['/api/auth/sign-in/native', '/api/auth/reauthenticate/native'].includes(url.pathname)) {
      if (env.APP_ID !== 'mypro' || request.method !== 'POST') return json({ error: 'not_found' }, 404);
      if (origin !== env.AUTH_BASE_URL) return json({ error: 'origin_not_allowed' }, 403);
      const input = await bounded.json() as Record<string, unknown>;
      let expectedSubject: string | undefined;
      if (url.pathname === '/api/auth/reauthenticate/native') {
        if (!input || typeof input.expectedSubject !== 'string'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.expectedSubject)) {
          return json({ code: 'INVALID_REAUTHENTICATION' }, 400);
        }
        expectedSubject = input.expectedSubject.toLowerCase();
        delete input.expectedSubject;
      }
      const nativeEnv = input?.provider === 'apple' ? await withAppleNativeSecret(env) : env;
      const login = await exchangeNativeCode(nativeEnv, bounded, input);
      if (expectedSubject) {
        // Only the cryptographically verified provider subject can select this
        // existing app user. Client UUID is a constraint, not identity evidence.
        const bound = await env.AUTH_DB.prepare(`SELECT a.userId FROM account a JOIN user u ON u.id = a.userId
          WHERE a.userId = ? AND a.accountId = ? AND a.providerId = ? AND a.issuer = ? AND u.emailVerified = 1
            AND NOT EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = a.userId)`)
          .bind(expectedSubject, login.grant.subject, login.grant.provider,
            login.grant.provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com').first();
        if (!bound) return json({ code: 'ACCOUNT_MISMATCH' }, 401);
      }
      const nativeRequest = new Request(new URL('/api/auth/sign-in/social', url), { method: 'POST',
        headers: { 'content-type': 'application/json', origin: env.AUTH_BASE_URL,
          'cf-connecting-ip': request.headers.get('cf-connecting-ip') || 'unknown' },
        body: JSON.stringify({ provider: login.grant.provider, idToken: { token: login.idToken, nonce: login.nonce } }) });
      response = await createAuth(nativeEnv, url.origin, login.grant, expectedSubject).handler(nativeRequest);
    } else {
      // ID-token-only sign-in would bypass the one-use code/grant contract.
      // Browser redirect OAuth has no idToken field and remains supported.
      if (env.APP_ID === 'mypro' && url.pathname === '/api/auth/sign-in/social' && request.method === 'POST') {
        const body = await bounded.clone().json() as Record<string, unknown>;
        if (body?.idToken !== undefined) return json({ code: 'NATIVE_CODE_REQUIRED' }, 400);
      }
      response = await auth.handler(bounded);
    }
    if (env[mailFailure]?.error) throw env[mailFailure].error;
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store'); headers.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof MailBudgetError) return json({ code: error.code }, error.code === 'EMAIL_BUDGET_EXHAUSTED' ? 429 : 503);
    if (error instanceof NativeOAuthError) return json({ code: error.code }, error.status);
    return json({ error: 'auth_unavailable' }, 503);
  }
}
export default {
  fetch: handleRequest,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await cleanupExpiredAuth(env);
  },
};
