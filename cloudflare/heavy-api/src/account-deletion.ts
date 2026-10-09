import type { Env } from "./index.ts";
import { principal } from "./domain.ts";

/**
 * Self-service account deletion (privacy policy: everything is removed; backups expire within 28 days).
 * Order: auth freshness check → private R2 objects → D1 rows in one batch → the auth user itself.
 * Every step is idempotent, so a failure part-way is fixed by retrying the same request.
 */
export const ACCOUNT_DELETION_CONFIRMATION = "DELETE_ACCOUNT";
const OWNED_BRANDS = "SELECT id FROM brands WHERE owner_id = ?1";
const OBJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/;

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const fail = (error: string, status: number) => json({ error }, status);

/** Calls consumer-auth's /v1/account/erase with the caller's own session. */
async function authErase(request: Request, env: Env, dryRun: boolean): Promise<Response> {
  const issuer = env.AUTH_ISSUER?.trim();
  if (!env.AUTH_SERVICE || !issuer) return fail("account_deletion_unavailable", 503);
  let response: Response;
  try {
    response = await env.AUTH_SERVICE.fetch(new Request(`${issuer}/v1/account/erase`, {
      method: "POST",
      headers: { authorization: request.headers.get("authorization") ?? "", "content-type": "application/json" },
      body: JSON.stringify({ dryRun }),
      signal: AbortSignal.timeout(8000),
    }));
  } catch {
    return fail("account_deletion_unavailable", 503);
  }
  if (response.status === 204) return response;
  if (response.status === 401) return fail("unauthorized", 401);
  if (response.status === 403) return fail("reauthentication_required", 403);
  return fail("account_deletion_unavailable", 503);
}

async function objectKeys(env: Env, userID: string, issuer: string, subject: string): Promise<string[]> {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && OBJECT_KEY.test(value) && !value.includes("..")) keys.add(value);
  };
  const images = await env.DB.prepare(
    `SELECT id, storage_path, thumbnail_path FROM generated_images WHERE user_id = ?1 OR brand_id IN (${OWNED_BRANDS})`,
  ).bind(userID).all<{ id: string; storage_path: string | null; thumbnail_path: string | null }>();
  for (const row of images.results) {
    add(`generated-images/${row.id}`); add(`generated-thumbnails/${row.id}.webp`); add(row.storage_path); add(row.thumbnail_path);
  }
  const candidates = await env.DB.prepare(
    `SELECT c.image_id FROM heavy_ai_candidates c JOIN heavy_ai_requests r ON r.request_id = c.request_id
     WHERE c.image_id IS NOT NULL AND (r.user_id = ?1 OR r.brand_id IN (${OWNED_BRANDS}))`,
  ).bind(userID).all<{ image_id: string }>();
  for (const row of candidates.results) add(`generated-images/${row.image_id}`);
  const feedback = await env.DB.prepare(
    `SELECT screenshot_path, audio_path FROM feedback_submissions WHERE user_id = ?1`,
  ).bind(userID).all<{ screenshot_path: string | null; audio_path: string | null }>();
  for (const row of feedback.results) { add(row.screenshot_path); add(row.audio_path); }
  const media = await env.DB.prepare(
    `SELECT object_key FROM media_assets WHERE owner_issuer = ? AND owner_subject = ?`,
  ).bind(issuer, subject).all<{ object_key: string }>();
  for (const row of media.results) add(row.object_key);
  return [...keys];
}

function deleteRows(env: Env, userID: string, issuer: string, subject: string) {
  const owned = `brand_id IN (${OWNED_BRANDS})`;
  // The account_erasures marker unlocks the append-only evidence tables for this user only (migration 0018).
  // RESTRICT references and guarded tables go first; deleting the brands and the user then cascades the rest.
  return env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO account_erasures (user_id, started_at) VALUES (?, ?)`).bind(userID, new Date().toISOString()),
    env.DB.prepare(`DELETE FROM heavy_generation_preparations WHERE user_id = ?1 OR ${owned}`).bind(userID),
    env.DB.prepare(`DELETE FROM design_assistant_requests WHERE owner_id = ?1 OR ${owned}
      OR project_id IN (SELECT id FROM canvas_documents WHERE owner_id = ?1 OR ${owned})`).bind(userID),
    env.DB.prepare(`DELETE FROM heavy_request_rights_attestations WHERE user_id = ?1 OR ${owned}`).bind(userID),
    env.DB.prepare(`DELETE FROM heavy_terms_acceptances WHERE user_id = ?1`).bind(userID),
    env.DB.prepare(`DELETE FROM canvas_documents WHERE owner_id = ?1 OR ${owned}`).bind(userID),
    env.DB.prepare(`DELETE FROM invitations WHERE creator_id = ?1`).bind(userID),
    env.DB.prepare(`DELETE FROM admin_announcements WHERE author_id = ?1`).bind(userID),
    env.DB.prepare(`DELETE FROM brands WHERE owner_id = ?1`).bind(userID),
    env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(userID),
    env.DB.prepare(`DELETE FROM user_identities WHERE principal_id = ?1`).bind(userID),
    env.DB.prepare(`DELETE FROM media_assets WHERE owner_issuer = ? AND owner_subject = ?`).bind(issuer, subject),
    env.DB.prepare(`DELETE FROM account_erasures WHERE user_id = ?`).bind(userID),
  ]);
}

export async function deleteAccount(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (body?.confirmation !== ACCOUNT_DELETION_CONFIRMATION) return fail("account_deletion_unconfirmed", 400);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const identity = await env.DB.prepare(`SELECT issuer, subject FROM user_identities WHERE principal_id = ? LIMIT 1`)
    .bind(userID).first<{ issuer: string; subject: string }>();
  if (!identity) return fail("identity_unmapped", 403);
  if (await env.DB.prepare(`SELECT 1 FROM platform_admins WHERE user_id = ? LIMIT 1`).bind(userID).first()) {
    return fail("account_deletion_admin", 409);
  }
  // Deleting a brand removes everyone's work in it, so shared brands must be handed over or emptied first.
  const shared = await env.DB.prepare(
    `SELECT 1 FROM brand_members m JOIN brands b ON b.id = m.brand_id WHERE b.owner_id = ?1 AND m.user_id <> ?1 LIMIT 1`,
  ).bind(userID).first();
  if (shared) return fail("account_deletion_shared_brand", 409);

  const check = await authErase(request, env, true);
  if (check.status !== 204) return check;

  try {
    const keys = await objectKeys(env, userID, identity.issuer, identity.subject);
    for (let i = 0; i < keys.length; i += 1000) await env.PRIVATE_MEDIA.delete(keys.slice(i, i + 1000));
  } catch {
    return fail("media_storage_unavailable", 502);
  }
  try {
    await deleteRows(env, userID, identity.issuer, identity.subject);
  } catch {
    return fail("account_deletion_unavailable", 503);
  }
  const erased = await authErase(request, env, false);
  return erased.status === 204 ? new Response(null, { status: 204 }) : erased;
}

/** Returns null when the request belongs to another route. */
export async function handleAccountDeletionRequest(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/v1/account/delete" || request.method !== "POST") return null;
  return deleteAccount(request, env);
}
