import { signJWT, verifyJWT } from 'better-auth/crypto';
import type { Env } from './auth.ts';

const PURPOSE = 'mypro-email-verification';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bindVerificationLink(env: Env, user: { id: string; email: string }, link: string): Promise<string> {
  if (env.APP_ID !== 'mypro') return link;
  const url = new URL(link);
  url.searchParams.set('token', await signJWT({ sub: user.id, email: user.email.toLowerCase(),
    iss: env.AUTH_BASE_URL, aud: PURPOSE }, env.AUTH_SECRET, 3600));
  return url.href;
}

// Better Auth 1.7.2's default email-only verification updates by email. After
// account erasure/re-registration an old link can target the new user. MyPro's
// configured autoSignInAfterVerification=false path uses a subject-bound token
// and one atomic ID+email UPDATE instead; no password/session crypto is replaced.
export async function verifyMyProEmail(request: Request, env: Env, origins: string[]): Promise<Response> {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  const invalid = () => Response.json({ error: 'invalid_verification' }, { status: 400, headers });
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token || token.length > 4096) return invalid();
  let callback: URL | null = null;
  if (url.searchParams.has('callbackURL')) {
    // Better Auth emits relative '/' when no callback was supplied at signup.
    // Resolve against the clean canonical origin, never the token-bearing URL.
    try { callback = new URL(url.searchParams.get('callbackURL')!, env.AUTH_BASE_URL + '/'); } catch { return invalid(); }
    if (!origins.includes(callback.origin) || callback.username || callback.password) return invalid();
  }
  const claims = await verifyJWT<{ sub?: unknown; email?: unknown; iss?: unknown; aud?: unknown; exp?: unknown }>(token, env.AUTH_SECRET);
  if (!claims || typeof claims.sub !== 'string' || !UUID.test(claims.sub) || typeof claims.email !== 'string'
    || claims.email.length > 320 || claims.iss !== env.AUTH_BASE_URL || claims.aud !== PURPOSE
    || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) return invalid();
  const updated = await env.AUTH_DB.prepare(`UPDATE user SET emailVerified = 1, updatedAt = ?
    WHERE id = ? AND email = ? AND NOT EXISTS (SELECT 1 FROM auth_erasure WHERE user_id = user.id)
    RETURNING id`).bind(new Date().toISOString(), claims.sub, claims.email).first<{ id: string }>();
  if (!updated) return invalid();
  return callback ? new Response(null, { status: 302, headers: { ...headers, location: callback.href } })
    : Response.json({ status: true }, { headers });
}
