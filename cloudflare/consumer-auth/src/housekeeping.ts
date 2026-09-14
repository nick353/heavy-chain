import type { Env } from './auth.ts';

// All configured rules and Better Auth 1.7.2 special rules are <= 60 seconds.
// Keep this in sync if adding a longer rule; the extra five minutes is a margin.
export const AUTH_RATE_WINDOW_SECONDS = 60;
export const CLEANUP_BATCH_SIZE = 100;
export async function cleanupExpiredAuth(env: Pick<Env, 'AUTH_DB'>, now = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_cleanup_time');
  const verificationCutoff = new Date(now - 300_000).toISOString();
  const rateCutoff = now - (AUTH_RATE_WINDOW_SECONDS + 300) * 1000;
  // Actual D1 adapter dates are ISO text; lastRequest is epoch milliseconds.
  // Each statement deletes at most one fixed batch. No session/grant/fence or
  // mail allocation cleanup; a refreshed candidate must still match at deletion.
  await env.AUTH_DB.prepare(`DELETE FROM verification WHERE id IN
    (SELECT id FROM verification WHERE expiresAt < ? ORDER BY expiresAt LIMIT 100)
    AND expiresAt < ?`).bind(verificationCutoff, verificationCutoff).run();
  await env.AUTH_DB.prepare(`DELETE FROM rateLimit WHERE id IN
    (SELECT id FROM rateLimit WHERE lastRequest < ? ORDER BY lastRequest LIMIT 100)
    AND lastRequest < ?`).bind(rateCutoff, rateCutoff).run();
}
