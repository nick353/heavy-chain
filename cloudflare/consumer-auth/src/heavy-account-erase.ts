import type { createAuth, Env } from './auth.ts';

/** A deletion must come from a sign-in made within this window, not a weeks-old remembered session. */
export const HEAVY_ERASE_FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Heavy Chain self-service deletion, called by heavy-api over the service binding with the user's own session.
 * dryRun only checks the session; otherwise the user row goes and sessions, linked Google/Apple accounts and
 * provider state cascade with it. Pending email codes for the address are removed as well.
 */
export async function eraseHeavyAccount(request: Request, env: Env, auth: ReturnType<typeof createAuth>): Promise<Response> {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/i.test(authorization) || authorization.length > 4096) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => null) as { dryRun?: unknown } | null;
  if (typeof body?.dryRun !== 'boolean') return json({ error: 'invalid_request' }, 400);
  const session = await auth.api.getSession({ headers: new Headers({ authorization }),
    query: { disableCookieCache: true, disableRefresh: true } });
  if (!session || new Date(session.session.expiresAt).getTime() <= Date.now()) return json({ error: 'unauthorized' }, 401);
  const age = Date.now() - new Date(session.session.createdAt).getTime();
  if (!Number.isFinite(age) || age < -60_000 || age >= HEAVY_ERASE_FRESH_SESSION_MS) return json({ error: 'reauthentication_required' }, 403);
  if (body.dryRun) return new Response(null, { status: 204 });
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM verification WHERE instr(identifier, ?) > 0').bind(session.user.email),
    env.AUTH_DB.prepare('DELETE FROM "user" WHERE id = ?').bind(session.user.id),
  ]);
  return new Response(null, { status: 204 });
}
