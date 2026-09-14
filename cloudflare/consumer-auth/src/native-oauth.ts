import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import type { Env } from './auth.ts';
import { credentialFingerprint, PROVIDER_CHECK_INTERVAL } from './provider-state.ts';

type Provider = 'apple' | 'google';
export type NativeGrant = { provider: Provider; subject: string; clientId: string; refreshToken?: string; accessToken: string };
export type NativeLogin = { grant: NativeGrant; idToken: string; nonce?: string };
export class NativeOAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
const invalid = () => new NativeOAuthError('INVALID_NATIVE_CREDENTIAL', 401);
const configured = () => new NativeOAuthError('NATIVE_OAUTH_NOT_CONFIGURED', 503);
const issuer = (provider: Provider) => provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com';
const keys = {
  apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
  google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
};
type KeyResolver = Parameters<typeof jwtVerify>[1];
const opaque = (value: unknown, max = 8192): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
async function sha256(value: string) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
const hex = (value: Uint8Array) => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Trusted configuration only; a mobile request never selects a client/secret/URL. */
function client(env: Env, provider: Provider) {
  if (env.APP_ID !== 'mypro') throw configured();
  if (provider === 'apple') {
    if (!env.APPLE_APP_BUNDLE_IDENTIFIER || !env.APPLE_NATIVE_CLIENT_SECRET) throw configured();
    return { id: env.APPLE_APP_BUNDLE_IDENTIFIER, secret: env.APPLE_NATIVE_CLIENT_SECRET };
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_IOS_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw configured();
  return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
}

async function claims(env: Env, provider: Provider, token: string, audience: string[], nonce: string | undefined, resolve: KeyResolver): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, resolve, { algorithms: ['RS256'],
      issuer: provider === 'apple' ? issuer(provider) : [issuer(provider), 'accounts.google.com'], audience,
      maxTokenAge: '1h', requiredClaims: ['sub', 'iat', 'exp', 'aud', 'iss'] });
    if (!opaque(payload.sub, 255)) throw invalid();
    if (payload.email !== undefined && (typeof payload.email !== 'string' || !payload.email
      || !(payload.email_verified === true || (provider === 'apple' && payload.email_verified === 'true')))) throw invalid();
    if (provider === 'apple') {
      if (!nonce || payload.nonce !== hex(await sha256(nonce))) throw invalid();
    } else if (payload.azp !== undefined && ![env.GOOGLE_IOS_CLIENT_ID, env.GOOGLE_CLIENT_ID].includes(payload.azp as string)) throw invalid();
    return payload;
  } catch { throw invalid(); }
}

export async function boundedJSON(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  let text = ''; let size = 0; const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 16 * 1024) { await reader.cancel(); throw invalid(); }
    text += decoder.decode(value, { stream: true });
  }
  const data: unknown = JSON.parse(text + decoder.decode());
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
  return data as Record<string, unknown>;
}

/** Public route calls this only after host/origin/body checks. Test injection is
 * module-local dependency injection, never an environment or HTTP parameter. */
export async function exchangeNativeCode(env: Env, request: Request, input: unknown,
  dependencies: { send?: typeof fetch; resolve?: KeyResolver } = {}): Promise<NativeLogin> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(k => !['provider', 'idToken', 'authorizationCode', 'nonce'].includes(k))) throw invalid();
  const { provider, idToken, authorizationCode, nonce } = body;
  if (provider !== 'apple' && provider !== 'google') throw invalid();
  const configuration = client(env, provider);
  if (!opaque(idToken, 10000) || !opaque(authorizationCode, 2048)
    || (provider === 'apple' && (!opaque(nonce, 256) || nonce.length < 16))
    || (provider === 'google' && nonce !== undefined)) throw invalid();
  // Limit BEFORE fetching keys or consuming an upstream code. Cloudflare owns
  // CF-Connecting-IP; requests without it share the strict unknown-IP bucket.
  const key = 'native:' + hex(await sha256(request.headers.get('cf-connecting-ip') || 'unknown'));
  const now = Date.now();
  const limited = await env.AUTH_DB.prepare(`INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN lastRequest < ? THEN 1 ELSE count + 1 END,
      lastRequest = CASE WHEN lastRequest < ? THEN excluded.lastRequest ELSE lastRequest END RETURNING count`)
    .bind(key, key, now, now - 60_000, now - 60_000).first<{ count: number }>();
  if (!limited || limited.count > 5) throw new NativeOAuthError('TOO_MANY_REQUESTS', 429);
  const resolve = dependencies.resolve ?? keys[provider];
  const original = await claims(env, provider, idToken,
    provider === 'apple' ? [configuration.id] : [configuration.id, env.GOOGLE_IOS_CLIENT_ID!], nonce as string | undefined, resolve);
  if (provider === 'apple' && original.c_hash !== undefined
    && original.c_hash !== base64url((await sha256(authorizationCode)).slice(0, 16))) throw invalid();
  // Consumed even on an ambiguous network result: request a NEW provider code,
  // never replay an unknown-effect exchange. Only a hash remains, for ten minutes.
  const digest = 'native-code:' + hex(await sha256(provider + ':' + authorizationCode));
  await env.AUTH_DB.prepare("DELETE FROM verification WHERE id IN (SELECT id FROM verification WHERE identifier LIKE 'native-code:%' AND expiresAt < ? LIMIT 100)")
    .bind(new Date(now).toISOString()).run();
  const reserved = await env.AUTH_DB.prepare('INSERT OR IGNORE INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(digest, digest, 'consumed', new Date(now + 10 * 60_000).toISOString(), new Date(now).toISOString(), new Date(now).toISOString()).run();
  if (reserved.meta.changes !== 1) throw invalid();
  const form = new URLSearchParams({ client_id: configuration.id, client_secret: configuration.secret,
    code: authorizationCode, grant_type: 'authorization_code' });
  if (provider === 'google') form.set('redirect_uri', ''); // Native Google SDK has no web redirect.
  let tokenResponse: Response;
  try { tokenResponse = await (dependencies.send ?? fetch)(provider === 'apple' ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token',
    { method: 'POST', body: form, redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/x-www-form-urlencoded' } }); }
  catch { throw new NativeOAuthError('NATIVE_EXCHANGE_UNAVAILABLE', 503); }
  // workerd rejects redirect:'error' before sending. Manual + exact 200 keeps
  // credentials at the fixed provider endpoint and refuses every redirect.
  if (tokenResponse.status !== 200) { await tokenResponse.body?.cancel(); throw invalid(); }
  let tokens: Record<string, unknown>;
  try { tokens = await boundedJSON(tokenResponse); } catch { throw invalid(); }
  if (!opaque(tokens.id_token, 10000) || !opaque(tokens.access_token)
    || (tokens.refresh_token !== undefined && !opaque(tokens.refresh_token))
    || typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer') throw invalid();
  const exchanged = await claims(env, provider, tokens.id_token, [configuration.id], nonce as string | undefined, resolve);
  if (exchanged.sub !== original.sub) throw invalid();
  // Better Auth repeats signature/email verification before creating an account.
  // Use the exchanged token so the code, session identity and stored grant agree.
  return { idToken: tokens.id_token, ...(typeof nonce === 'string' ? { nonce } : {}), grant: {
    provider, subject: exchanged.sub!, clientId: configuration.id, accessToken: tokens.access_token,
    ...(typeof tokens.refresh_token === 'string' ? { refreshToken: tokens.refresh_token } : {}),
  } };
}

export async function readNativeGrant(env: Env, ciphertext: string, provider: string, subject: string): Promise<NativeGrant> {
  const value = JSON.parse(await symmetricDecrypt({ key: env.AUTH_SECRET, data: ciphertext })) as NativeGrant;
  if (value.provider !== provider || value.subject !== subject || !opaque(value.clientId, 255)
    || !opaque(value.accessToken) || !opaque(value.refreshToken)) throw new Error('native_grant_invalid');
  return value;
}

/** Runs inside Better Auth's session-create BEFORE hook. Storage failure/frozen
 * account means no session token is issued. Never resolve a user by email. */
export async function persistNativeGrant(env: Env, userId: string, grant: NativeGrant) {
  const row = await env.AUTH_DB.prepare('SELECT id, nativeGrant FROM account WHERE userId = ? AND issuer = ? AND providerId = ? AND accountId = ?')
    .bind(userId, issuer(grant.provider), grant.provider, grant.subject).first<{ id: string; nativeGrant: string | null }>();
  if (!row) throw new Error('native_account_missing');
  if (!grant.refreshToken && row.nativeGrant) {
    const previous = await readNativeGrant(env, row.nativeGrant, grant.provider, grant.subject);
    if (previous.clientId === grant.clientId) grant = { ...grant, refreshToken: previous.refreshToken };
  }
  if (!grant.refreshToken) throw new NativeOAuthError('NATIVE_RECONSENT_REQUIRED', 409);
  const ciphertext = await symmetricEncrypt({ key: env.AUTH_SECRET, data: JSON.stringify(grant) });
  const fingerprint = await credentialFingerprint('native:' + ciphertext);
  const now = Date.now();
  const saved = await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`UPDATE account SET nativeGrant = ?, accessToken = NULL, refreshToken = NULL, idToken = NULL,
      accessTokenExpiresAt = NULL, refreshTokenExpiresAt = NULL WHERE id = ? AND userId = ?
      AND NOT EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = ?)`)
      .bind(ciphertext, row.id, userId, userId),
    env.AUTH_DB.prepare(`INSERT INTO provider_validation (account_id, credential_fingerprint, state, checked_at, next_check_at)
      SELECT id, ?, 'ok', ?, ? FROM account WHERE id = ? AND nativeGrant = ?
      ON CONFLICT(account_id) DO UPDATE SET credential_fingerprint = excluded.credential_fingerprint,
        state = 'ok', check_id = NULL, checked_at = excluded.checked_at, next_check_at = excluded.next_check_at`)
      .bind(fingerprint, now, now + PROVIDER_CHECK_INTERVAL, row.id, ciphertext),
  ]);
  if (saved.some(result => result.meta.changes !== 1)) throw new Error('native_grant_not_saved');
}
