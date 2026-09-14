import { createRemoteJWKSet, jwtVerify } from 'jose';
import { symmetricEncrypt } from 'better-auth/crypto';
import type { Env } from './auth.ts';
import { boundedJSON, readNativeGrant, type NativeGrant } from './native-oauth.ts';
import { withAppleNativeSecret } from './apple-native-secret.ts';
import { credentialFingerprint, PROVIDER_CHECK_INTERVAL } from './provider-state.ts';

type Status = 200 | 401 | 503;
type Account = { id: string; userId: string; providerId: string; issuer: string; accountId: string;
  nativeGrant: string | null; accessToken: string | null; refreshToken: string | null; idToken: string | null };
type State = { credential_fingerprint: string; state: 'ok' | 'checking' | 'unavailable' | 'reauth_required'; next_check_at: number };
const keys = {
  apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
  google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
};
const opaque = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 8192 && /^[\x21-\x7e]+$/.test(value);
const columns = 'id, userId, providerId, issuer, accountId, nativeGrant, accessToken, refreshToken, idToken';
// Include the actual account generation, not just the state-table fingerprint:
// browser OAuth can replace credentials while an upstream check is in flight.
const unchanged = `id = ? AND userId = ? AND providerId = ? AND issuer = ? AND accountId = ?
  AND nativeGrant IS ? AND accessToken IS ? AND refreshToken IS ? AND idToken IS ?`;
const values = (a: Account) => [a.id, a.userId, a.providerId, a.issuer, a.accountId, a.nativeGrant, a.accessToken, a.refreshToken, a.idToken];
const stateStatus = (state: State | null, fingerprint: string, now: number): Status | undefined => {
  if (!state || state.credential_fingerprint !== fingerprint) return undefined;
  if (state.state === 'reauth_required') return 401;
  if (state.next_check_at > now) return state.state === 'ok' ? 200 : 503;
};
async function fingerprint(env: Env, a: Account) {
  return credentialFingerprint(a.nativeGrant ? 'native:' + a.nativeGrant : JSON.stringify([
    'web', a.providerId, a.issuer, a.accountId, a.providerId === 'apple' ? env.APPLE_CLIENT_ID : env.GOOGLE_CLIENT_ID,
    a.accessToken, a.refreshToken, a.idToken,
  ]));
}
async function state(env: Env, accountId: string) {
  return env.AUTH_DB.prepare('SELECT credential_fingerprint, state, next_check_at FROM provider_validation WHERE account_id = ?')
    .bind(accountId).first<State>();
}
/** Called only from Better Auth's successfully verified browser callback hooks.
 * Record code exchange as today's check and retire the older native generation. */
export async function recordBrowserConsent(env: Env, account: { id: string; userId: string;
  accessToken?: string | null; refreshToken?: string | null; idToken?: string | null }) {
  const current = await env.AUTH_DB.prepare(`SELECT ${columns} FROM account WHERE id = ? AND userId = ?
    AND accessToken IS ? AND refreshToken IS ? AND idToken IS ?`)
    .bind(account.id, account.userId, account.accessToken ?? null, account.refreshToken ?? null, account.idToken ?? null).first<Account>();
  if (!current || !current.accessToken) return;
  const next = { ...current, nativeGrant: null };
  const fp = await fingerprint(env, next); const now = Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`UPDATE account SET nativeGrant = NULL WHERE ${unchanged}`).bind(...values(current)),
    env.AUTH_DB.prepare(`INSERT INTO provider_validation (account_id, credential_fingerprint, state, checked_at, next_check_at)
      SELECT id, ?, ?, ?, ? FROM account WHERE ${unchanged}
      ON CONFLICT(account_id) DO UPDATE SET credential_fingerprint = excluded.credential_fingerprint,
        state = excluded.state, check_id = NULL, checked_at = excluded.checked_at, next_check_at = excluded.next_check_at`)
      .bind(fp, opaque(next.refreshToken) ? 'ok' : 'unavailable', now,
        opaque(next.refreshToken) ? now + PROVIDER_CHECK_INTERVAL : now, ...values(next)),
  ]);
}
type Dependencies = { send?: typeof fetch; resolve?: Parameters<typeof jwtVerify>[1] };

/** At most one attempt per credential generation per day, across isolates and
 * ambiguous response/DB failures. Fresh interactive consent starts a generation.
 * Only exact invalid_grant is terminal; outages retain grants and deny with 503. */
async function validateAccount(env: Env, a: Account, dependencies: Dependencies): Promise<Status> {
  if (a.providerId === 'credential') return 200;
  if (a.providerId !== 'apple' && a.providerId !== 'google') return 401;
  const provider = a.providerId;
  if (a.issuer !== (provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com')) return 401;
  const fp = await fingerprint(env, a); const now = Date.now();
  const cached = stateStatus(await state(env, a.id), fp, now);
  if (cached !== undefined) return cached;
  const checkId = crypto.randomUUID();
  const claimed = await env.AUTH_DB.prepare(`INSERT INTO provider_validation
    (account_id, credential_fingerprint, check_id, state, checked_at, next_check_at)
    SELECT id, ?, ?, 'checking', NULL, ? FROM account WHERE ${unchanged}
    AND NOT EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = ?)
    ON CONFLICT(account_id) DO UPDATE SET credential_fingerprint = excluded.credential_fingerprint,
      check_id = excluded.check_id, state = 'checking', checked_at = NULL, next_check_at = excluded.next_check_at
    WHERE provider_validation.credential_fingerprint != excluded.credential_fingerprint
      OR (provider_validation.next_check_at <= ? AND provider_validation.state != 'reauth_required')`)
    .bind(fp, checkId, now + PROVIDER_CHECK_INTERVAL, ...values(a), a.userId, now).run();
  if (claimed.meta.changes !== 1) return currentStatus(env, a);
  const owned = `EXISTS (SELECT 1 FROM provider_validation WHERE account_id = ?
    AND credential_fingerprint = ? AND check_id = ? AND state = 'checking')`;
  const ownedValues = [a.id, fp, checkId];
  const settle = (result: 'unavailable' | 'reauth_required') => env.AUTH_DB.prepare(`UPDATE provider_validation
    SET state = ?, checked_at = ?, check_id = NULL WHERE account_id = ? AND credential_fingerprint = ?
      AND check_id = ? AND state = 'checking' AND EXISTS (SELECT 1 FROM account WHERE ${unchanged})`)
    .bind(result, Date.now(), ...ownedValues, ...values(a));
  async function reauthenticate(): Promise<Status> {
    // Same transaction and exact grant + claim: a stale negative result cannot
    // delete sessions issued by a concurrent fresh native or browser login.
    const result = await env.AUTH_DB.batch([
      env.AUTH_DB.prepare(`DELETE FROM session WHERE userId = ? AND ${owned}
        AND EXISTS (SELECT 1 FROM account WHERE ${unchanged})`).bind(a.userId, ...ownedValues, ...values(a)),
      settle('reauth_required'),
    ]);
    return result[1].meta.changes === 1 ? 401 : currentStatus(env, a);
  }
  try {
    let grant: NativeGrant | undefined;
    if (a.nativeGrant) grant = await readNativeGrant(env, a.nativeGrant, provider, a.accountId);
    const refresh = grant?.refreshToken ?? a.refreshToken;
    if (!opaque(refresh)) return await reauthenticate();
    const nativeEnv = provider === 'apple' && grant ? await withAppleNativeSecret(env) : env;
    const clientId = provider === 'google' ? env.GOOGLE_CLIENT_ID
      : grant ? env.APPLE_APP_BUNDLE_IDENTIFIER : env.APPLE_CLIENT_ID;
    const secret = provider === 'google' ? env.GOOGLE_CLIENT_SECRET
      : grant ? nativeEnv.APPLE_NATIVE_CLIENT_SECRET : env.APPLE_CLIENT_SECRET;
    if (!clientId || !secret || (grant && grant.clientId !== clientId)) throw new Error('configuration');
    const response = await (dependencies.send ?? fetch)(provider === 'apple'
      ? 'https://appleid.apple.com/auth/token' : 'https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: refresh }),
    });
    if (response.status !== 200 && response.status !== 400) { await response.body?.cancel(); throw new Error('upstream'); }
    const tokens = await boundedJSON(response);
    if (response.status === 400 && tokens.error === 'invalid_grant') return await reauthenticate();
    if (response.status !== 200 || !opaque(tokens.access_token)
      || (tokens.refresh_token !== undefined && !opaque(tokens.refresh_token))
      || typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer'
      || !Number.isSafeInteger(tokens.expires_in) || (tokens.expires_in as number) <= 0 || (tokens.expires_in as number) > 31_536_000) throw new Error('upstream');
    if (tokens.id_token !== undefined) {
      if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 10000) throw new Error('identity');
      const { payload } = await jwtVerify(tokens.id_token, dependencies.resolve ?? keys[provider], {
        algorithms: ['RS256'], issuer: provider === 'apple' ? 'https://appleid.apple.com'
          : ['https://accounts.google.com', 'accounts.google.com'], audience: clientId,
        requiredClaims: ['sub', 'iss', 'aud', 'iat', 'exp'], maxTokenAge: '1h',
      });
      // Refresh confirms a previously verified identity; it is not a new login
      // and has no fresh interactive nonce. Never adopt a new provider subject.
      if (payload.sub !== a.accountId || (provider === 'google' && payload.azp !== undefined
        && ![env.GOOGLE_CLIENT_ID, env.GOOGLE_IOS_CLIENT_ID].includes(payload.azp as string))) throw new Error('identity');
    }
    const next: Account = { ...a };
    if (grant) next.nativeGrant = await symmetricEncrypt({ key: env.AUTH_SECRET, data: JSON.stringify({ ...grant,
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? refresh }) });
    else {
      next.accessToken = tokens.access_token; next.refreshToken = (tokens.refresh_token as string | undefined) ?? refresh;
      next.idToken = (tokens.id_token as string | undefined) ?? a.idToken;
    }
    const nextFp = await fingerprint(env, next);
    const result = await env.AUTH_DB.batch([
      env.AUTH_DB.prepare(`UPDATE account SET nativeGrant = ?, accessToken = ?, refreshToken = ?, idToken = ?,
        accessTokenExpiresAt = ?, updatedAt = ? WHERE ${unchanged} AND ${owned}
        AND NOT EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = ?)`)
        .bind(next.nativeGrant, next.accessToken, next.refreshToken, next.idToken,
          grant ? null : new Date(Date.now() + (tokens.expires_in as number) * 1000).toISOString(), new Date().toISOString(),
          ...values(a), ...ownedValues, a.userId),
      env.AUTH_DB.prepare(`UPDATE provider_validation SET credential_fingerprint = ?, state = 'ok',
        check_id = NULL, checked_at = ? WHERE account_id = ? AND credential_fingerprint = ? AND check_id = ?
        AND state = 'checking' AND EXISTS (SELECT 1 FROM account WHERE ${unchanged})`)
        .bind(nextFp, Date.now(), ...ownedValues, ...values(next)),
    ]);
    return result.every(r => r.meta.changes === 1) ? 200 : currentStatus(env, a);
  } catch {
    // If a commit succeeded but its reply was lost, this conditional update is
    // a no-op; the readback sees 'ok'. No provider request is replayed.
    await settle('unavailable').run();
    return currentStatus(env, a);
  }
}

async function currentStatus(env: Env, previous: Account): Promise<Status> {
  const current = await env.AUTH_DB.prepare(`SELECT ${columns} FROM account WHERE id = ? AND userId = ?`)
    .bind(previous.id, previous.userId).first<Account>();
  if (!current) return 401;
  return stateStatus(await state(env, current.id), await fingerprint(env, current), Date.now()) ?? 503;
}

/** Called before protected HTTP effects and service identity admission. Erasure
 * is deliberately separate: revoked/missing grants must not prevent deletion. */
export async function validateProviderSession(env: Env, userId: string, sessionId: string, dependencies: Dependencies = {}): Promise<Status> {
  if (env.APP_ID !== 'mypro') return 200;
  const accounts = await env.AUTH_DB.prepare(`SELECT ${columns} FROM account WHERE userId = ?`).bind(userId).all<Account>();
  if (!accounts.results.length) return 401;
  for (const account of accounts.results) {
    const status = await validateAccount(env, account, dependencies);
    if (status !== 200) return status;
  }
  // Logout/erasure can happen while waiting for the provider. Never admit from
  // the pre-await session snapshot after that session has been removed.
  const current = await env.AUTH_DB.prepare(`SELECT expiresAt FROM session WHERE id = ? AND userId = ?
    AND NOT EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = ?)`).bind(sessionId, userId, userId).first<{ expiresAt: string }>();
  return current && Date.parse(current.expiresAt) > Date.now() ? 200 : 401;
}
