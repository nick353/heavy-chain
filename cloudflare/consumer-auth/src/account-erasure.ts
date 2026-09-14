import { createAuth, type Env } from './auth.ts';
import { boundedJSON, readNativeGrant } from './native-oauth.ts';
import { withAppleNativeSecret } from './apple-native-secret.ts';

const REQUEST_ID = /^[a-f0-9]{64}$/;
const FRESH_SESSION_MS = 15 * 60 * 1000;
type ManualProvider = 'apple' | 'google';
type ErasureRow = { request_id: string; user_id: string | null; state: 'frozen' | 'deleted'; completed_at: string | null; manual_revocation: string };
type AccountRow = { id: string; accountId: string; providerId: string; accessToken: string | null; refreshToken: string | null; idToken: string | null; nativeGrant: string | null };
export type ErasureResult = { ok: true; requestId: string; state: 'frozen' | 'deleted' | 'cancelled'; subject: string | null; manualRevocation?: ManualProvider[] }
  | { ok: false; error: 'disabled' | 'invalid_request' | 'unauthorized' | 'reauthentication_required'
    | 'request_conflict' | 'not_found' | 'already_accepted' | 'provider_revocation_required' | 'provider_unavailable' | 'storage_unavailable' };
export type ErasureIdentity = { ok: true; issuer: string; subject: string }
  | { ok: false; error: 'disabled' | 'unauthorized' | 'reauthentication_required' | 'storage_unavailable' };

/** Private lifecycle RPC only. Fresh local session proves deletion authority;
 * a missing/revoked upstream grant must not prevent app-data erasure (TN3194).
 * Does not freeze, provision, refresh, expose profile data, or issue a token. */
export async function identifyAuthErasure(env: Env, authorization: string): Promise<ErasureIdentity> {
  if (env.APP_ID !== 'mypro') return { ok: false, error: 'disabled' };
  if (typeof authorization !== 'string' || authorization.length > 4096 || !/^Bearer \S+$/.test(authorization)) return { ok: false, error: 'unauthorized' };
  try {
    const session = await createAuth(env).api.getSession({ headers: new Headers({ authorization }),
      query: { disableCookieCache: true, disableRefresh: true } });
    if (!session || !session.user.emailVerified || new Date(session.session.expiresAt).getTime() <= Date.now()) return { ok: false, error: 'unauthorized' };
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (!Number.isFinite(age) || age < -60_000 || age >= FRESH_SESSION_MS) return { ok: false, error: 'reauthentication_required' };
    return { ok: true, issuer: env.AUTH_BASE_URL, subject: session.user.id };
  } catch { return { ok: false, error: 'storage_unavailable' }; }
}

function manualProviders(row: ErasureRow): ManualProvider[] {
  const value: unknown = JSON.parse(row.manual_revocation);
  if (!Array.isArray(value) || value.some(p => p !== 'apple' && p !== 'google')) throw new Error('invalid_provider_notice');
  return [...new Set(value)] as ManualProvider[];
}
const result = (row: ErasureRow): ErasureResult => {
  const manualRevocation = manualProviders(row);
  return { ok: true, requestId: row.request_id, state: row.state, subject: row.user_id,
    ...(manualRevocation.length ? { manualRevocation } : {}) };
};
async function read(env: Env, requestId: string) {
  return env.AUTH_DB.prepare('SELECT request_id, user_id, state, completed_at, manual_revocation FROM auth_erasure WHERE request_id = ?')
    .bind(requestId).first<ErasureRow>();
}
async function isCancelled(env: Env, requestId: string): Promise<boolean> {
  return Boolean(await env.AUTH_DB.prepare('SELECT request_id FROM auth_erasure_cancellations WHERE request_id = ?')
    .bind(requestId).first());
}
const cancelledResult = (requestId: string): ErasureResult => ({ ok: true, requestId, state: 'cancelled', subject: null });

/** Private MyPro coordinator RPC. The caller must possess the exact durable
 * receipt and admit the cancellation; this is not a public hash-write API.
 * D1's mutual INSERT triggers arbitrate against even an already-running begin.
 * No provider calls, account edits, session revocation or "unfreeze" occur. */
export async function cancelAuthErasure(env: Env, requestId: string): Promise<ErasureResult> {
  if (env.APP_ID !== 'mypro') return { ok: false, error: 'disabled' };
  if (!REQUEST_ID.test(requestId)) return { ok: false, error: 'invalid_request' };
  try {
    if (await read(env, requestId)) return { ok: false, error: 'already_accepted' };
    await env.AUTH_DB.prepare('INSERT OR IGNORE INTO auth_erasure_cancellations (request_id, cancelled_at) VALUES (?, ?)')
      .bind(requestId, new Date().toISOString()).run();
    return await isCancelled(env, requestId) ? cancelledResult(requestId) : { ok: false, error: 'storage_unavailable' };
  } catch {
    // Covers an accepted begin winning the race and a lost cancellation write
    // response. A missing/unavailable read never proves safe cancellation.
    try {
      if (await isCancelled(env, requestId)) return cancelledResult(requestId);
      if (await read(env, requestId)) return { ok: false, error: 'already_accepted' };
    } catch { /* retain unknown result */ }
    return { ok: false, error: 'storage_unavailable' };
  }
}
async function accounts(env: Env, subject: string) {
  return (await env.AUTH_DB.prepare('SELECT id, accountId, providerId, accessToken, refreshToken, idToken, nativeGrant FROM account WHERE userId = ?')
    .bind(subject).all<AccountRow>()).results;
}

// Apple TN3194 requires app-data deletion even without a revocable grant.
// In that case preserve provider-only manual instructions in the receipt.
// Never count deleting our DB row as revoking a grant at Apple/Google.
async function revocationInput(env: Env, account: AccountRow): Promise<{ url: string; body: URLSearchParams } | null | 'missing'> {
  if (account.providerId === 'credential') return null;
  if (account.nativeGrant) {
    let grant;
    try { grant = await readNativeGrant(env, account.nativeGrant, account.providerId, account.accountId); }
    catch { return 'missing'; } // Unusable ciphertext still permits app deletion with manual guidance.
    if (grant.provider === 'google') {
      if (grant.clientId !== env.GOOGLE_CLIENT_ID) return 'missing';
      return { url: 'https://oauth2.googleapis.com/revoke', body: new URLSearchParams({ token: grant.refreshToken! }) };
    }
    if (grant.clientId !== env.APPLE_APP_BUNDLE_IDENTIFIER) return 'missing';
    const nativeEnv = await withAppleNativeSecret(env);
    if (!nativeEnv.APPLE_NATIVE_CLIENT_SECRET) return 'missing';
    return { url: 'https://appleid.apple.com/auth/revoke', body: new URLSearchParams({ client_id: grant.clientId,
      client_secret: nativeEnv.APPLE_NATIVE_CLIENT_SECRET, token: grant.refreshToken!, token_type_hint: 'refresh_token' }) };
  }
  const token = account.refreshToken || account.accessToken;
  if (!token) return 'missing';
  if (account.providerId === 'google') return { url: 'https://oauth2.googleapis.com/revoke', body: new URLSearchParams({ token }) };
  if (account.providerId !== 'apple' || !env.APPLE_CLIENT_ID || !env.APPLE_CLIENT_SECRET) return 'missing';
  // Current provider credentials are the web Service ID. Native grant exchange
  // requires separate reviewed audience/secret support before admission here.
  try {
    const payload = JSON.parse(atob(account.idToken!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { aud?: unknown };
    if (payload.aud !== env.APPLE_CLIENT_ID) return 'missing';
  } catch { return 'missing'; }
  return { url: 'https://appleid.apple.com/auth/revoke', body: new URLSearchParams({
    client_id: env.APPLE_CLIENT_ID, client_secret: env.APPLE_CLIENT_SECRET, token,
    token_type_hint: account.refreshToken ? 'refresh_token' : 'access_token',
  }) };
}

/** Only exported through a named Worker RPC entrypoint, never public HTTP. */
export async function beginAuthErasure(env: Env, authorization: string, requestId: string): Promise<ErasureResult> {
  if (env.APP_ID !== 'mypro') return { ok: false, error: 'disabled' };
  if (!REQUEST_ID.test(requestId) || typeof authorization !== 'string' || authorization.length > 4096) return { ok: false, error: 'invalid_request' };
  if (!/^Bearer \S+$/.test(authorization)) return { ok: false, error: 'unauthorized' };
  try {
    if (await isCancelled(env, requestId)) return cancelledResult(requestId);
    const identity = await identifyAuthErasure(env, authorization);
    if (!identity.ok) return identity;
    const existing = await read(env, requestId);
    if (existing) return existing.user_id === identity.subject ? result(existing) : { ok: false, error: 'request_conflict' };
    const linked = await accounts(env, identity.subject);
    if (linked.some(account => !['credential', 'apple', 'google'].includes(account.providerId)))
      return { ok: false, error: 'provider_revocation_required' };
    const inputs = await Promise.all(linked.map(account => revocationInput(env, account)));
    const manual = [...new Set(linked.filter((_, index) => inputs[index] === 'missing').map(account => account.providerId))];
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare("INSERT INTO auth_erasure (request_id, user_id, state, created_at, manual_revocation) VALUES (?, ?, 'frozen', ?, ?)")
        .bind(requestId, identity.subject, new Date().toISOString(), JSON.stringify(manual)),
      env.AUTH_DB.prepare('DELETE FROM session WHERE userId = ?').bind(identity.subject),
    ]);
    const frozen = await read(env, requestId);
    return frozen ? result(frozen) : { ok: false, error: 'storage_unavailable' };
  } catch {
    // The transaction might have committed. The trusted coordinator reconciles
    // this exact request through authErasureStatus; never opens a second request.
    try { if (await isCancelled(env, requestId)) return cancelledResult(requestId); } catch { /* preserve uncertainty */ }
    return { ok: false, error: 'storage_unavailable' };
  }
}

export async function authErasureStatus(env: Env, requestId: string): Promise<ErasureResult> {
  if (env.APP_ID !== 'mypro') return { ok: false, error: 'disabled' };
  if (!REQUEST_ID.test(requestId)) return { ok: false, error: 'invalid_request' };
  try {
    const row = await read(env, requestId);
    return row ? result(row) : await isCancelled(env, requestId) ? cancelledResult(requestId) : { ok: false, error: 'not_found' };
  }
  catch { return { ok: false, error: 'storage_unavailable' }; }
}

/** Caller MUST first durably confirm MyPro D1/R2 erasure. The data-plane
 * coordinator owns this precondition; no public HTTP bridge may call finish. */
export async function finishAuthErasure(env: Env, requestId: string, send: typeof fetch = fetch): Promise<ErasureResult> {
  if (env.APP_ID !== 'mypro') return { ok: false, error: 'disabled' };
  if (!REQUEST_ID.test(requestId)) return { ok: false, error: 'invalid_request' };
  try {
    const row = await read(env, requestId);
    if (!row) return await isCancelled(env, requestId) ? cancelledResult(requestId) : { ok: false, error: 'not_found' };
    if (row.state === 'deleted') return result(row);
    for (const account of await accounts(env, row.user_id!)) {
      const input = await revocationInput(env, account);
      if (input === 'missing') {
        if (account.providerId !== 'apple' && account.providerId !== 'google') return { ok: false, error: 'provider_revocation_required' };
        // Preserve guidance atomically with removing an unrevocable credential.
        // json_each merges concurrent finish passes without dropping notices.
        await env.AUTH_DB.batch([
          env.AUTH_DB.prepare(`UPDATE auth_erasure SET manual_revocation =
            (SELECT json_group_array(value) FROM (SELECT value FROM json_each(manual_revocation) UNION SELECT ?))
            WHERE request_id = ? AND state = 'frozen'`).bind(account.providerId, requestId),
          env.AUTH_DB.prepare('DELETE FROM account WHERE id = ? AND userId = ?').bind(account.id, row.user_id),
        ]);
        continue;
      }
      if (!input) continue;
      let response: Response;
      try { response = await send(input.url, { method: 'POST', body: input.body, redirect: 'manual',
        signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/x-www-form-urlencoded' } }); }
      catch { return { ok: false, error: 'provider_unavailable' }; }
      // A lost successful Google response can be followed by invalid_token.
      // Google also uses it for an expired token: it does NOT prove that every
      // upstream grant was revoked. Finish app deletion with durable manual
      // guidance instead of retrying forever or claiming automatic revocation.
      if (response.status === 400 && account.providerId === 'google') {
        let failure;
        try { failure = await boundedJSON(response); }
        catch { return { ok: false, error: 'provider_unavailable' }; }
        if (failure.error !== 'invalid_token') return { ok: false, error: 'provider_unavailable' };
        await env.AUTH_DB.batch([
          env.AUTH_DB.prepare(`UPDATE auth_erasure SET manual_revocation =
            (SELECT json_group_array(value) FROM (SELECT value FROM json_each(manual_revocation) UNION SELECT 'google'))
            WHERE request_id = ? AND state = 'frozen'`).bind(requestId),
          env.AUTH_DB.prepare('DELETE FROM account WHERE id = ? AND userId = ?').bind(account.id, row.user_id),
        ]);
        continue;
      }
      // Apple documents200 for an already-invalid grant. Other errors/redirects
      // remain pending and never cause credential removal.
      if (response.status !== 200) { await response.body?.cancel(); return { ok: false, error: 'provider_unavailable' }; }
      await response.body?.cancel();
      // Persist each accepted revocation before advancing to another account.
      await env.AUTH_DB.prepare('DELETE FROM account WHERE id = ? AND userId = ?').bind(account.id, row.user_id).run();
    }
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare('DELETE FROM verification WHERE value = ? OR identifier = (SELECT email FROM user WHERE id = ?)')
        .bind(row.user_id, row.user_id),
      env.AUTH_DB.prepare('DELETE FROM user WHERE id = ?').bind(row.user_id),
      env.AUTH_DB.prepare("UPDATE auth_erasure SET user_id = NULL, state = 'deleted', completed_at = ? WHERE request_id = ? AND state = 'frozen'")
        .bind(new Date().toISOString(), requestId),
    ]);
    const completed = await read(env, requestId);
    return completed?.state === 'deleted' ? result(completed) : { ok: false, error: 'storage_unavailable' };
  } catch { return { ok: false, error: 'storage_unavailable' }; }
}
