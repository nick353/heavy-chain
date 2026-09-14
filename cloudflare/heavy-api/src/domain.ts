import type { Env } from "./index.ts";
import { configuredTokenVerifier, type VerifiedIdentity } from "./auth.ts";

type DomainEnv = Env;

type Identity = VerifiedIdentity;

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  language: string;
  is_admin?: number;
  created_at: string;
  updated_at: string;
}

interface BrandRow {
  id: string;
  owner_id: string;
  name: string;
  logo_url: string | null;
  brand_colors_json: string;
  tone_description: string | null;
  target_audience: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    }),
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

async function authenticate(request: Request, env: DomainEnv): Promise<Identity | Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return errorResponse("unauthorized", 401);
  const configuredVerifier = configuredTokenVerifier(env);
  const verifier = env.MEDIA_TOKEN_VERIFIER
    ? (candidate: Request) => Promise.resolve(env.MEDIA_TOKEN_VERIFIER!(candidate, env))
    : configuredVerifier;
  if (!verifier) return errorResponse("token_verifier_unavailable", 503);
  try {
    const identity = await verifier(request);
    return identity && identity.issuer.length > 0 && identity.subject.length > 0
      ? identity
      : errorResponse("unauthorized", 401);
  } catch {
    return errorResponse("token_verifier_unavailable", 503);
  }
}

export async function principal(request: Request, env: DomainEnv): Promise<string | Response> {
  const identity = await authenticate(request, env);
  if (identity instanceof Response) return identity;
  const existing = await env.DB.prepare(
    `SELECT principal_id FROM user_identities WHERE issuer = ? AND subject = ? LIMIT 1`,
  ).bind(identity.issuer, identity.subject).first<{ principal_id: string }>();
  if (existing) return existing.principal_id;
  if (env.AUTH_SERVICE && identity.verifiedProfile) {
    const now = new Date().toISOString();
    // Immutable verified subject, never an email lookup or user-editable role.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO user_identities (principal_id, issuer, subject, created_at) VALUES (?, ?, ?, ?)`)
        .bind(identity.subject, identity.issuer, identity.subject, now),
      env.DB.prepare(`INSERT OR IGNORE INTO users (id, email, name, created_at, updated_at)
        SELECT principal_id, ?, ?, ?, ? FROM user_identities WHERE issuer = ? AND subject = ?`)
        .bind(identity.verifiedProfile.email, identity.verifiedProfile.name, now, now, identity.issuer, identity.subject),
    ]);
  }
  const mapping = await env.DB.prepare(
    `SELECT principal_id FROM user_identities WHERE issuer = ? AND subject = ? LIMIT 1`,
  ).bind(identity.issuer, identity.subject).first<{ principal_id: string }>();
  return mapping?.principal_id ?? errorResponse("identity_unmapped", 403);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function userPayload(user: UserRow): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    language: user.language,
    is_admin: user.is_admin === 1,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

function brandPayload(brand: BrandRow): Record<string, unknown> {
  let brandColors: unknown = {};
  try { brandColors = JSON.parse(brand.brand_colors_json); } catch { brandColors = {}; }
  return {
    id: brand.id,
    owner_id: brand.owner_id,
    name: brand.name,
    logo_url: brand.logo_url,
    brand_colors: brandColors,
    tone_description: brand.tone_description,
    target_audience: brand.target_audience,
    role: brand.role,
    created_at: brand.created_at,
    updated_at: brand.updated_at,
  };
}

async function getProfile(request: Request, env: DomainEnv): Promise<Response> {
  const id = await principal(request, env);
  if (id instanceof Response) return id;
  const user = await env.DB.prepare(
    `SELECT id, email, name, avatar_url, language, created_at, updated_at,
      EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id = users.id) AS is_admin
      FROM users WHERE id = ? LIMIT 1`,
  ).bind(id).first<UserRow>();
  return user ? jsonResponse(userPayload(user)) : errorResponse("not_found", 404);
}

async function updateProfile(request: Request, env: DomainEnv): Promise<Response> {
  const id = await principal(request, env);
  if (id instanceof Response) return id;
  const input = await readJson(request);
  if (!input) return errorResponse("invalid_json", 400);
  const allowed = new Map<string, string>([
    ["name", "name"], ["avatar_url", "avatar_url"], ["language", "language"],
  ]);
  const changes: Array<{ column: string; value: string | null }> = [];
  for (const [key, value] of Object.entries(input)) {
    const column = allowed.get(key);
    if (!column || (value !== null && typeof value !== "string") ||
        (typeof value === "string" && value.length > 512)) {
      return errorResponse("invalid_profile", 400);
    }
    changes.push({ column, value: value as string | null });
  }
  if (changes.length === 0) return errorResponse("empty_update", 400);
  const assignments = changes.map(({ column }) => `${column} = ?`).join(", ");
  const values = changes.map(({ value }) => value);
  values.push(new Date().toISOString(), id);
  const result = await env.DB.prepare(
    `UPDATE users SET ${assignments}, updated_at = ? WHERE id = ?`,
  ).bind(...values).run();
  if (result.meta.changes === 0) return errorResponse("not_found", 404);
  return getProfile(request, env);
}

async function listBrands(request: Request, env: DomainEnv): Promise<Response> {
  const id = await principal(request, env);
  if (id instanceof Response) return id;
  const result = await env.DB.prepare(
    `SELECT b.id, b.owner_id, b.name, b.logo_url, b.brand_colors_json,
      b.tone_description, b.target_audience,
      CASE WHEN b.owner_id = ? THEN 'owner' ELSE bm.role END AS role,
      b.created_at, b.updated_at
     FROM brands b
     LEFT JOIN brand_members bm ON bm.brand_id = b.id AND bm.user_id = ? AND bm.joined_at IS NOT NULL
     WHERE b.owner_id = ? OR bm.user_id = ?
     ORDER BY b.created_at DESC`,
  ).bind(id, id, id, id).all<BrandRow>();
  return jsonResponse((result.results ?? []).map(brandPayload));
}

async function createBrand(request: Request, env: DomainEnv): Promise<Response> {
  const id = await principal(request, env);
  if (id instanceof Response) return id;
  const input = await readJson(request);
  if (!input || typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 256) {
    return errorResponse("invalid_brand", 400);
  }
  const now = new Date().toISOString();
  const brandId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO brands
      (id, owner_id, name, logo_url, brand_colors_json, tone_description, target_audience, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    brandId, id, input.name.trim(),
    typeof input.logo_url === "string" ? input.logo_url : null,
    typeof input.brand_colors === "object" && input.brand_colors !== null ? JSON.stringify(input.brand_colors) : "{}",
    typeof input.tone_description === "string" ? input.tone_description : null,
    typeof input.target_audience === "string" ? input.target_audience : null,
    now, now,
  ).run();
  const created = await env.DB.prepare(
    `SELECT id, owner_id, name, logo_url, brand_colors_json, tone_description, target_audience,
      'owner' AS role, created_at, updated_at FROM brands WHERE id = ? AND owner_id = ? LIMIT 1`,
  ).bind(brandId, id).first<BrandRow>();
  return created ? jsonResponse(brandPayload(created), 201) : errorResponse("metadata_unavailable", 503);
}

async function updateBrand(request: Request, env: DomainEnv, brandID: string): Promise<Response> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(brandID)) return errorResponse("not_found", 404);
  const ownerID = await principal(request, env);
  if (ownerID instanceof Response) return ownerID;
  const owned = await env.DB.prepare(
    `SELECT id FROM brands WHERE id = ? AND owner_id = ? LIMIT 1`,
  ).bind(brandID, ownerID).first<{ id: string }>();
  if (!owned) return errorResponse("not_found", 404);

  const input = await readJson(request);
  if (!input) return errorResponse("invalid_brand", 400);
  const changes: Array<{ column: string; value: string | null }> = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === "name") {
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) return errorResponse("invalid_brand", 400);
      changes.push({ column: "name", value: value.trim() });
    } else if (["logo_url", "tone_description", "target_audience"].includes(key)) {
      if (value !== null && (typeof value !== "string" || value.length > 20000)) return errorResponse("invalid_brand", 400);
      changes.push({ column: key, value: value as string | null });
    } else if (key === "brand_colors") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return errorResponse("invalid_brand", 400);
      let encoded: string;
      try { encoded = JSON.stringify(value); } catch { return errorResponse("invalid_brand", 400); }
      if (encoded.length > 8192) return errorResponse("invalid_brand", 400);
      changes.push({ column: "brand_colors_json", value: encoded });
    } else {
      return errorResponse("invalid_brand", 400);
    }
  }
  if (changes.length === 0) return errorResponse("empty_update", 400);
  const assignments = changes.map(({ column }) => `${column} = ?`).join(", ");
  const values = changes.map(({ value }) => value);
  values.push(new Date().toISOString(), brandID, ownerID);
  const result = await env.DB.prepare(
    `UPDATE brands SET ${assignments}, updated_at = ? WHERE id = ? AND owner_id = ?`,
  ).bind(...values).run();
  if (result.meta.changes === 0) return errorResponse("not_found", 404);
  const updated = await env.DB.prepare(
    `SELECT id, owner_id, name, logo_url, brand_colors_json, tone_description, target_audience,
      'owner' AS role, created_at, updated_at FROM brands WHERE id = ? AND owner_id = ? LIMIT 1`,
  ).bind(brandID, ownerID).first<BrandRow>();
  return updated ? jsonResponse(brandPayload(updated)) : errorResponse("metadata_unavailable", 503);
}

/** Returns null for paths still handled by the media handler. */
export async function handleDomainRequest(request: Request, env: DomainEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/v1/profile" && request.method === "GET") return getProfile(request, env);
  if (url.pathname === "/v1/profile" && (request.method === "PATCH" || request.method === "PUT")) {
    return updateProfile(request, env);
  }
  if (url.pathname === "/v1/brands" && request.method === "GET") return listBrands(request, env);
  if (url.pathname === "/v1/brands" && request.method === "POST") return createBrand(request, env);
  const brand = url.pathname.match(/^\/v1\/brands\/([^/]+)$/);
  if (brand && request.method === "PATCH") return updateBrand(request, env, decodeURIComponent(brand[1]));
  return null;
}
