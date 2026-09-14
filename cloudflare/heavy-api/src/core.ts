import type { Env } from "./index.ts";
import { principal } from "./domain.ts";
import { handleImageAIAction } from './image-ai.ts';

type CoreEnv = Env;
type JsonRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_PAGE_SIZE = 100;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_TEXT_LENGTH = 20000;
const DEFAULT_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_MEDIA_READ_SECRET_LENGTH = 32;

interface GenerationJobRow {
  id: string;
  brand_id: string;
  user_id: string;
  feature_type: string;
  input_params: string;
  optimized_prompt: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface GeneratedImageRow {
  id: string;
  job_id: string | null;
  brand_id: string;
  user_id: string;
  storage_path: string;
  thumbnail_path: string | null;
  version: number;
  parent_image_id: string | null;
  is_favorite: number;
  prompt: string | null;
  negative_prompt: string | null;
  feature_type: string | null;
  style_preset: string | null;
  model_used: string | null;
  generation_params: string;
  metadata: string;
  image_url: string | null;
  created_at: string;
  expires_at: string | null;
}

interface ShareLinkRow {
  id: string;
  image_id: string;
  created_by: string;
  token: string;
  expires_at: string;
  created_at: string;
}

interface CanvasDocumentRow {
  id: string;
  owner_id: string;
  brand_id: string;
  title: string;
  snapshot: string;
  snapshot_version: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

// Keep the permission predicate inside the write as well as at the HTTP
// boundary: role changes between admission and D1 must not commit a save.
const CANVAS_EDITOR_PREDICATE = `EXISTS (
  SELECT 1 FROM brands b WHERE b.id = ? AND (b.owner_id = ? OR EXISTS (
    SELECT 1 FROM brand_members bm WHERE bm.brand_id = b.id AND bm.user_id = ?
      AND bm.joined_at IS NOT NULL AND bm.role IN ('owner','admin','editor')
  ))
)`;

const sameCanvasJson = (left: unknown, right: unknown): boolean => {
  const remaining: Array<[unknown,unknown]> = [[left,right]];
  while (remaining.length) {
    const [a,b] = remaining.pop()!;
    if (a === b) continue;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(b,key)) return false;
      remaining.push([(a as JsonRecord)[key],(b as JsonRecord)[key]]);
    }
  }
  return true;
};

interface FolderRow {
  id: string;
  brand_id: string;
  parent_folder_id: string | null;
  name: string;
  created_at: string;
}

interface ImageFolderRow {
  image_id: string;
  folder_id: string;
}

interface TagRow {
  id: string;
  brand_id: string;
  name: string;
  created_at: string;
}

interface ImageTagRow {
  image_id: string;
  tag_id: string;
}

interface StylePresetRow {
  id: string;
  brand_id: string;
  name: string;
  prompt_template: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

interface BrandMemberRow {
  user_id: string;
  role: "owner" | "admin" | "editor" | "viewer";
  joined_at: string;
  profile_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

interface InvitationRow {
  id: string;
  brand_id: string;
  creator_id: string;
  email: string | null;
  code: string;
  role: "admin" | "editor" | "viewer";
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

const PROVIDER_ACTIONS = new Set([
  "remove-background",
  "colorize",
  "upscale",
  "generate-variations",
  "generate-image",
  "edit-image",
  "optimize-prompt",
  "design-gacha",
  "product-shots",
  "model-matrix",
  "multilingual-banner",
  "bulk-download",
]);

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9]{32,128}$/;

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

async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<JsonRecord | null> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) return null;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const encoded = JSON.stringify(value);
    return encoded.length <= maxBytes ? value as JsonRecord : null;
  } catch {
    return null;
  }
}

function validID(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function boundedText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  // eslint-disable-next-line no-control-regex -- control characters are intentionally rejected from persisted text.
  return typeof value === "string" && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "invalid";
}

function jsonText(value: unknown, fallback: Record<string, unknown> = {}): string | "invalid" {
  const candidate = value === undefined || value === null ? fallback : value;
  if (typeof candidate !== "object" || candidate === null) return "invalid";
  try {
    const encoded = JSON.stringify(candidate);
    return encoded.length <= MAX_JSON_BYTES ? encoded : "invalid";
  } catch {
    return "invalid";
  }
}

function canvasSnapshotText(value: unknown): string | "invalid" {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid";
  const objects = (value as JsonRecord).objects;
  if (!Array.isArray(objects)) return "invalid";
  for (const object of objects) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return "invalid";
    if ((object as JsonRecord).type !== "image") continue;
    const src = (object as JsonRecord).src;
    if (typeof src !== "string") return "invalid";
    const trimmed = src.trim().toLowerCase();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:") || trimmed.startsWith("local-canvas-asset://")) {
      return "invalid";
    }
  }
  try {
    const encoded = JSON.stringify(value);
    return encoded.length <= MAX_JSON_BYTES ? encoded : "invalid";
  } catch {
    return "invalid";
  }
}

function parseStored(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value); } catch { return fallback; }
}

function jobPayload(row: GenerationJobRow): Record<string, unknown> {
  return {
    id: row.id,
    brand_id: row.brand_id,
    user_id: row.user_id,
    feature_type: row.feature_type,
    input_params: parseStored(row.input_params, {}),
    optimized_prompt: row.optimized_prompt,
    status: row.status,
    error_message: row.error_message,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function imagePayload(row: GeneratedImageRow): Record<string, unknown> {
  return {
    id: row.id,
    job_id: row.job_id,
    brand_id: row.brand_id,
    user_id: row.user_id,
    // Cloudflare-owned generated images are addressed by the Worker-managed
    // R2 key. Do not expose a legacy Supabase path as the canonical target.
    storage_path: generatedImageObjectKey(row.id),
    thumbnail_path: row.thumbnail_path,
    version: row.version,
    parent_image_id: row.parent_image_id,
    is_favorite: Boolean(row.is_favorite),
    prompt: row.prompt,
    negative_prompt: row.negative_prompt,
    feature_type: row.feature_type,
    style_preset: row.style_preset,
    model_used: row.model_used,
    generation_params: parseStored(row.generation_params, {}),
    metadata: parseStored(row.metadata, {}),
    image_url: row.image_url,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

function publicShareEnabled(env: CoreEnv): boolean {
  return env.PUBLIC_SHARE_ENABLED?.trim().toLowerCase() === "true";
}

function publicAppOrigin(env: CoreEnv): string | null {
  const configured = env.PUBLIC_APP_ORIGIN?.trim();
  if (configured) {
    try {
      const origin = new URL(configured);
      if (origin.protocol === "https:" && origin.username === "" && origin.password === "" &&
          origin.search === "" && origin.hash === "") {
        return origin.toString().replace(/\/$/, "");
      }
    } catch {
      return null;
    }
  }
  return null;
}

function sharedImageContentURL(request: Request, token: string): string {
  const url = new URL(request.url);
  url.pathname = `/v1/shared-images/${encodeURIComponent(token)}/content`;
  url.search = "";
  return url.toString();
}

function sharedImagePayload(row: GeneratedImageRow, share: ShareLinkRow, request: Request): Record<string, unknown> {
  return {
    success: true,
    image: {
      id: row.id,
      imageUrl: sharedImageContentURL(request, share.token),
      prompt: row.prompt,
      negativePrompt: row.negative_prompt,
      featureType: row.feature_type,
      stylePreset: row.style_preset,
      modelUsed: row.model_used,
      generationParams: parseStored(row.generation_params, {}),
      metadata: parseStored(row.metadata, {}),
      createdAt: row.created_at,
    },
    share: {
      token: share.token,
      expiresAt: share.expires_at,
      createdAt: share.created_at,
    },
  };
}

async function readShareLink(env: CoreEnv, token: string): Promise<ShareLinkRow | null> {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  return env.DB.prepare(
    `SELECT id, image_id, created_by, token, expires_at, created_at
     FROM share_links WHERE token = ? LIMIT 1`,
  ).bind(token).first<ShareLinkRow>();
}

async function readSharedImageRow(env: CoreEnv, imageID: string): Promise<GeneratedImageRow | null> {
  return env.DB.prepare(
    `SELECT id, job_id, brand_id, user_id, storage_path, thumbnail_path, version,
      parent_image_id, is_favorite, prompt, negative_prompt, feature_type,
      style_preset, model_used, generation_params, metadata, image_url,
      created_at, expires_at FROM generated_images WHERE id = ? LIMIT 1`,
  ).bind(imageID).first<GeneratedImageRow>();
}

async function readPublicSharedImage(request: Request, env: CoreEnv, token: string): Promise<Response> {
  if (!publicShareEnabled(env)) return errorResponse("external_public_sharing_disabled", 403);
  const share = await readShareLink(env, token);
  if (!share) return errorResponse("share_link_not_found", 404);
  if (new Date(share.expires_at).getTime() <= Date.now()) return errorResponse("share_link_expired", 410);
  const image = await readSharedImageRow(env, share.image_id);
  return image ? jsonResponse(sharedImagePayload(image, share, request)) : errorResponse("shared_image_not_found", 404);
}

async function readPublicSharedImageContent(request: Request, env: CoreEnv, token: string): Promise<Response> {
  if (!publicShareEnabled(env)) return errorResponse("external_public_sharing_disabled", 403);
  const share = await readShareLink(env, token);
  if (!share) return errorResponse("share_link_not_found", 404);
  if (new Date(share.expires_at).getTime() <= Date.now()) return errorResponse("share_link_expired", 410);
  const image = await readSharedImageRow(env, share.image_id);
  if (!image) return errorResponse("shared_image_not_found", 404);
  let object: R2ObjectBody | null;
  try {
    object = await env.PRIVATE_MEDIA.get(generatedImageObjectKey(image.id));
  } catch {
    return errorResponse("media_storage_unavailable", 502);
  }
  if (!object) return errorResponse("shared_image_content_not_found", 404);
  const headers = mediaContentHeaders(object);
  headers.set("cache-control", "private, max-age=60");
  return new Response(object.body, { status: 200, headers });
}

async function createShareLink(request: Request, env: CoreEnv): Promise<Response> {
  if (!publicShareEnabled(env)) return errorResponse("external_public_sharing_disabled", 403);
  const input = await readJson(request);
  const imageID = input?.imageId;
  const expiresInDays = input?.expiresInDays === undefined ? 7 : input.expiresInDays;
  if (!validID(imageID) || typeof expiresInDays !== "number" || !Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
    return errorResponse("invalid_share_link", 400);
  }
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const image = await readSharedImageRow(env, imageID);
  if (!image) return errorResponse("not_found", 404);
  if (!roleAtLeast(await brandRole(env, userID, image.brand_id), "editor")) return errorResponse("image_forbidden", 403);
  const appOrigin = publicAppOrigin(env);
  if (!appOrigin) return errorResponse("public_app_origin_not_configured", 503);
  const token = crypto.randomUUID().replace(/-/g, "");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000).toISOString();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO share_links (id, image_id, created_by, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, imageID, userID, token, expiresAt, createdAt).run();
  } catch {
    return errorResponse("share_link_conflict", 409);
  }
  return jsonResponse({
    success: true,
    shareUrl: `${appOrigin}/share/${token}`,
    token,
    expiresAt,
    expiresInDays,
  }, 201);
}

function canvasPayload(row: CanvasDocumentRow): Record<string, unknown> {
  return {
    id: row.id,
    owner_id: row.owner_id,
    brand_id: row.brand_id,
    title: row.title,
    snapshot: parseStored(row.snapshot, {}),
    snapshot_version: row.snapshot_version,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function folderPayload(row: FolderRow): Record<string, unknown> {
  return {
    id: row.id,
    brand_id: row.brand_id,
    parent_folder_id: row.parent_folder_id,
    name: row.name,
    created_at: row.created_at,
  };
}

async function brandRole(env: CoreEnv, userID: string, brandID: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT CASE WHEN b.owner_id = ? THEN 'owner' ELSE bm.role END AS role
     FROM brands b
     LEFT JOIN brand_members bm ON bm.brand_id = b.id AND bm.user_id = ? AND bm.joined_at IS NOT NULL
     WHERE b.id = ? AND (b.owner_id = ? OR bm.user_id = ?) LIMIT 1`,
  ).bind(userID, userID, brandID, userID, userID).first<{ role: string | null }>();
  return row?.role ?? null;
}

function roleAtLeast(role: string | null, required: "viewer" | "editor"): boolean {
  if (!role) return false;
  if (required === "viewer") return ["viewer", "editor", "admin", "owner"].includes(role);
  return ["editor", "admin", "owner"].includes(role);
}

export async function requireBrandRole(request: Request, env: CoreEnv, brandID: string, required: "viewer" | "editor"): Promise<string | Response> {
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  if (!roleAtLeast(await brandRole(env, userID, brandID), required)) return errorResponse("brand_forbidden", 403);
  return userID;
}

function pagination(url: URL): { limit: number; offset: number } | Response {
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 20;
  const offset = url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : 0;
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_PAGE_SIZE &&
    Number.isSafeInteger(offset) && offset >= 0 ? { limit, offset } : errorResponse("invalid_pagination", 400);
}

async function readFolder(env: CoreEnv, folderID: string): Promise<FolderRow | null> {
  return env.DB.prepare(
    `SELECT id, brand_id, parent_folder_id, name, created_at FROM folders WHERE id = ? LIMIT 1`,
  ).bind(folderID).first<FolderRow>();
}

async function validFolderParent(env: CoreEnv, folderID: string, brandID: string, parentID: string | null): Promise<boolean> {
  if (parentID === null) return true;
  if (!validID(parentID) || parentID === folderID) return false;
  const seen = new Set<string>();
  let cursor: string | null = parentID;
  for (let depth = 0; depth < MAX_PAGE_SIZE && cursor; depth += 1) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const parent = await readFolder(env, cursor);
    if (!parent || parent.brand_id !== brandID) return false;
    if (parent.id === folderID) return false;
    cursor = parent.parent_folder_id;
  }
  return cursor === null;
}

async function listFolders(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const brandID = url.searchParams.get("brand_id");
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(
    `SELECT id, brand_id, parent_folder_id, name, created_at FROM folders
     WHERE brand_id = ? ORDER BY name ASC LIMIT ? OFFSET ?`,
  ).bind(brandID, MAX_PAGE_SIZE, 0).all<FolderRow>();
  return jsonResponse((result.results ?? []).map(folderPayload));
}

async function createFolder(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  const name = boundedText(input?.name, 256);
  const parentID = input?.parent_folder_id === undefined || input.parent_folder_id === null
    ? null : (validID(input.parent_folder_id) ? input.parent_folder_id : "invalid");
  if (!input || !validID(input.brand_id) || name === null || name === "invalid" || name.trim().length === 0 ||
      parentID === "invalid") return errorResponse("invalid_folder", 400);
  const access = await requireBrandRole(request, env, input.brand_id, "editor");
  if (access instanceof Response) return access;
  if (!(await validFolderParent(env, "new-folder", input.brand_id, parentID))) return errorResponse("invalid_folder_parent", 400);
  const id = input.id === undefined ? crypto.randomUUID() : (validID(input.id) ? input.id : "invalid");
  if (id === "invalid") return errorResponse("invalid_folder", 400);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO folders (id, brand_id, parent_folder_id, name, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, input.brand_id, parentID, name.trim(), now).run();
  } catch {
    return errorResponse("folder_conflict", 409);
  }
  const created = await readFolder(env, id);
  return created ? jsonResponse(folderPayload(created), 201) : errorResponse("metadata_unavailable", 503);
}

async function updateFolder(request: Request, env: CoreEnv, folderID: string): Promise<Response> {
  if (!validID(folderID)) return errorResponse("not_found", 404);
  const current = await readFolder(env, folderID);
  if (!current) return errorResponse("not_found", 404);
  const access = await requireBrandRole(request, env, current.brand_id, "editor");
  if (access instanceof Response) return access;
  const input = await readJson(request);
  const name = input?.name === undefined ? current.name : boundedText(input.name, 256);
  const parentID = input?.parent_folder_id === undefined ? current.parent_folder_id
    : (input.parent_folder_id === null ? null : (validID(input.parent_folder_id) ? input.parent_folder_id : "invalid"));
  if (!input || name === null || name === "invalid" || name.trim().length === 0 || parentID === "invalid" ||
      !(await validFolderParent(env, folderID, current.brand_id, parentID))) return errorResponse("invalid_folder", 400);
  const result = await env.DB.prepare(
    `UPDATE folders SET name = ?, parent_folder_id = ? WHERE id = ? AND brand_id = ?`,
  ).bind(name.trim(), parentID, folderID, current.brand_id).run();
  return result.meta.changes > 0
    ? jsonResponse(folderPayload({ ...current, name: name.trim(), parent_folder_id: parentID }))
    : errorResponse("not_found", 404);
}

async function deleteFolder(request: Request, env: CoreEnv, folderID: string): Promise<Response> {
  if (!validID(folderID)) return errorResponse("not_found", 404);
  const current = await readFolder(env, folderID);
  if (!current) return errorResponse("not_found", 404);
  const access = await requireBrandRole(request, env, current.brand_id, "editor");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(`DELETE FROM folders WHERE id = ? AND brand_id = ?`).bind(folderID, current.brand_id).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

async function listImageFolders(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const brandID = url.searchParams.get("brand_id");
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(
    `SELECT image_id, folder_id FROM image_folders
     WHERE folder_id IN (SELECT id FROM folders WHERE brand_id = ?)
     ORDER BY folder_id, image_id LIMIT 1000`,
  ).bind(brandID).all<ImageFolderRow>();
  return jsonResponse(result.results ?? []);
}

async function readTag(env: CoreEnv, tagID: string): Promise<TagRow | null> {
  return env.DB.prepare(
    `SELECT id, brand_id, name, created_at FROM tags WHERE id = ? LIMIT 1`,
  ).bind(tagID).first<TagRow>();
}

function tagPayload(row: TagRow): Record<string, unknown> {
  return { id: row.id, brand_id: row.brand_id, name: row.name, created_at: row.created_at };
}

async function listTags(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const brandID = url.searchParams.get("brand_id");
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(
    `SELECT id, brand_id, name, created_at FROM tags WHERE brand_id = ? ORDER BY name ASC LIMIT 1000`,
  ).bind(brandID).all<TagRow>();
  return jsonResponse((result.results ?? []).map(tagPayload));
}

async function createTag(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  const name = boundedText(input?.name, 256);
  if (!input || !validID(input.brand_id) || name === null || name === "invalid" || name.trim().length === 0) {
    return errorResponse("invalid_tag", 400);
  }
  const access = await requireBrandRole(request, env, input.brand_id, "editor");
  if (access instanceof Response) return access;
  const id = input.id === undefined ? crypto.randomUUID() : (validID(input.id) ? input.id : "invalid");
  if (id === "invalid") return errorResponse("invalid_tag", 400);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO tags (id, brand_id, name, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(id, input.brand_id, name.trim(), now).run();
  } catch {
    return errorResponse("tag_conflict", 409);
  }
  const created = await readTag(env, id);
  return created ? jsonResponse(tagPayload(created), 201) : errorResponse("metadata_unavailable", 503);
}

async function imageTagContext(request: Request, env: CoreEnv, imageID: string, tagID: string): Promise<{ userID: string; brandID: string } | Response> {
  if (!validID(imageID) || !validID(tagID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const image = await env.DB.prepare(
    `SELECT id, brand_id FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(imageID, userID).first<{ id: string; brand_id: string }>();
  const tag = await readTag(env, tagID);
  if (!image || !tag || tag.brand_id !== image.brand_id) return errorResponse("not_found", 404);
  const access = await requireBrandRole(request, env, image.brand_id, "editor");
  if (access instanceof Response) return access;
  return { userID, brandID: image.brand_id };
}

async function listImageTags(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const imageID = url.searchParams.get("image_id");
  if (!validID(imageID)) return errorResponse("invalid_image_id", 400);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const image = await env.DB.prepare(
    `SELECT id, brand_id FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(imageID, userID).first<{ id: string; brand_id: string }>();
  if (!image || !(await brandRole(env, userID, image.brand_id))) return errorResponse("not_found", 404);
  const result = await env.DB.prepare(
    `SELECT image_id, tag_id FROM image_tags WHERE image_id = ? ORDER BY tag_id ASC`,
  ).bind(imageID).all<ImageTagRow>();
  return jsonResponse((result.results ?? []).map((row) => row.tag_id));
}

async function addImageTag(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  if (!input || !validID(input.image_id) || !validID(input.tag_id)) return errorResponse("invalid_image_tag", 400);
  const context = await imageTagContext(request, env, input.image_id, input.tag_id);
  if (context instanceof Response) return context;
  try {
    await env.DB.prepare(
      `INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)`,
    ).bind(input.image_id, input.tag_id).run();
  } catch {
    return errorResponse("image_tag_conflict", 409);
  }
  return jsonResponse({ image_id: input.image_id, tag_id: input.tag_id }, 201);
}

async function deleteImageTag(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const imageID = url.searchParams.get("image_id");
  const tagID = url.searchParams.get("tag_id");
  if (!validID(imageID) || !validID(tagID)) return errorResponse("invalid_image_tag", 400);
  const context = await imageTagContext(request, env, imageID, tagID);
  if (context instanceof Response) return context;
  const result = await env.DB.prepare(
    `DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?`,
  ).bind(imageID, tagID).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

async function deleteTag(request: Request, env: CoreEnv, tagID: string): Promise<Response> {
  if (!validID(tagID)) return errorResponse("not_found", 404);
  const tag = await readTag(env, tagID);
  if (!tag) return errorResponse("not_found", 404);
  const access = await requireBrandRole(request, env, tag.brand_id, "editor");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(`DELETE FROM tags WHERE id = ? AND brand_id = ?`).bind(tagID, tag.brand_id).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

async function readStylePreset(env: CoreEnv, presetID: string): Promise<StylePresetRow | null> {
  return env.DB.prepare(
    `SELECT id, brand_id, name, prompt_template, settings, created_at, updated_at
     FROM style_presets WHERE id = ? LIMIT 1`,
  ).bind(presetID).first<StylePresetRow>();
}

function stylePresetPayload(row: StylePresetRow): Record<string, unknown> {
  return {
    id: row.id,
    brand_id: row.brand_id,
    name: row.name,
    prompt_template: row.prompt_template,
    settings: parseStored(row.settings, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listStylePresets(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const brandID = url.searchParams.get("brand_id");
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(
    `SELECT id, brand_id, name, prompt_template, settings, created_at, updated_at
     FROM style_presets WHERE brand_id = ? ORDER BY created_at DESC LIMIT 1000`,
  ).bind(brandID).all<StylePresetRow>();
  return jsonResponse((result.results ?? []).map(stylePresetPayload));
}

async function createStylePreset(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  const name = boundedText(input?.name, 256);
  const promptTemplate = input?.prompt_template === undefined ? "{prompt}" : boundedText(input.prompt_template, 20000);
  const settings = jsonText(input?.settings);
  if (!input || !validID(input.brand_id) || name === null || name === "invalid" || name.trim().length === 0 ||
      promptTemplate === "invalid" || settings === "invalid") return errorResponse("invalid_style_preset", 400);
  const access = await requireBrandRole(request, env, input.brand_id, "editor");
  if (access instanceof Response) return access;
  const id = input.id === undefined ? crypto.randomUUID() : (validID(input.id) ? input.id : "invalid");
  if (id === "invalid") return errorResponse("invalid_style_preset", 400);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO style_presets (id, brand_id, name, prompt_template, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.brand_id, name.trim(), promptTemplate ?? "{prompt}", settings, now, now).run();
  } catch {
    return errorResponse("style_preset_conflict", 409);
  }
  const created = await readStylePreset(env, id);
  return created ? jsonResponse(stylePresetPayload(created), 201) : errorResponse("metadata_unavailable", 503);
}

async function updateStylePreset(request: Request, env: CoreEnv, presetID: string): Promise<Response> {
  if (!validID(presetID)) return errorResponse("not_found", 404);
  const current = await readStylePreset(env, presetID);
  if (!current) return errorResponse("not_found", 404);
  const access = await requireBrandRole(request, env, current.brand_id, "editor");
  if (access instanceof Response) return access;
  const input = await readJson(request);
  const name = input?.name === undefined ? current.name : boundedText(input.name, 256);
  const promptTemplate = input?.prompt_template === undefined ? current.prompt_template : boundedText(input.prompt_template, 20000);
  const settings = input?.settings === undefined ? current.settings : jsonText(input.settings);
  if (!input || name === null || name === "invalid" || name.trim().length === 0 ||
      promptTemplate === null || promptTemplate === "invalid" || settings === "invalid") {
    return errorResponse("invalid_style_preset", 400);
  }
  const result = await env.DB.prepare(
    `UPDATE style_presets SET name = ?, prompt_template = ?, settings = ?, updated_at = ?
     WHERE id = ? AND brand_id = ?`,
  ).bind(name.trim(), promptTemplate, settings, new Date().toISOString(), presetID, current.brand_id).run();
  if (result.meta.changes === 0) return errorResponse("not_found", 404);
  const updated = await readStylePreset(env, presetID);
  return updated ? jsonResponse(stylePresetPayload(updated)) : errorResponse("metadata_unavailable", 503);
}

async function deleteStylePreset(request: Request, env: CoreEnv, presetID: string): Promise<Response> {
  if (!validID(presetID)) return errorResponse("not_found", 404);
  const current = await readStylePreset(env, presetID);
  if (!current) return errorResponse("not_found", 404);
  const access = await requireBrandRole(request, env, current.brand_id, "editor");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(`DELETE FROM style_presets WHERE id = ? AND brand_id = ?`).bind(presetID, current.brand_id).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

function managerRole(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

async function requireBrandManager(request: Request, env: CoreEnv, brandID: string): Promise<{ userID: string; role: string } | Response> {
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const role = await brandRole(env, userID, brandID);
  return managerRole(role) ? { userID, role: role! } : errorResponse("brand_forbidden", 403);
}

function memberPayload(row: BrandMemberRow): Record<string, unknown> {
  return {
    user_id: row.user_id,
    role: row.role,
    joined_at: row.joined_at,
    user: {
      id: row.profile_id,
      name: row.name,
      email: row.email,
      avatar_url: row.avatar_url,
    },
  };
}

function invitationPayload(row: InvitationRow): Record<string, unknown> {
  return {
    id: row.id,
    brand_id: row.brand_id,
    email: row.email,
    code: row.code,
    role: row.role,
    expires_at: row.expires_at,
    used_at: row.used_at,
    created_at: row.created_at,
  };
}

async function listBrandMembers(request: Request, env: CoreEnv, brandID: string): Promise<Response> {
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const owner = await env.DB.prepare(
    `SELECT b.owner_id AS user_id, 'owner' AS role, b.created_at AS joined_at,
      u.id AS profile_id, u.name, u.email, u.avatar_url
     FROM brands b JOIN users u ON u.id = b.owner_id
     WHERE b.id = ? LIMIT 1`,
  ).bind(brandID).first<BrandMemberRow>();
  if (!owner) return errorResponse("not_found", 404);
  const members = await env.DB.prepare(
    `SELECT bm.user_id, bm.role, bm.joined_at,
      u.id AS profile_id, u.name, u.email, u.avatar_url
     FROM brand_members bm JOIN users u ON u.id = bm.user_id
     WHERE bm.brand_id = ? AND bm.joined_at IS NOT NULL
     ORDER BY bm.joined_at ASC`,
  ).bind(brandID).all<BrandMemberRow>();
  const rows = [owner, ...(members.results ?? []).filter((row) => row.user_id !== owner.user_id)];
  return jsonResponse(rows.map(memberPayload));
}

async function listInvitations(request: Request, env: CoreEnv, brandID: string): Promise<Response> {
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandManager(request, env, brandID);
  if (access instanceof Response) return access;
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT id, brand_id, creator_id, email, code, role, expires_at, used_at, created_at
     FROM invitations
     WHERE brand_id = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1000`,
  ).bind(brandID, now).all<InvitationRow>();
  return jsonResponse((result.results ?? []).map(invitationPayload));
}

async function readInvitation(env: CoreEnv, idOrCode: string, byCode = false): Promise<InvitationRow | null> {
  const column = byCode ? "code" : "id";
  return env.DB.prepare(
    `SELECT id, brand_id, creator_id, email, code, role, expires_at, used_at, created_at
     FROM invitations WHERE ${column} = ? LIMIT 1`,
  ).bind(idOrCode).first<InvitationRow>();
}

async function createInvitation(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  if (!input || !validID(input.brand_id)) return errorResponse("invalid_invitation", 400);
  const access = await requireBrandManager(request, env, input.brand_id);
  if (access instanceof Response) return access;
  const emailValue = input.email === undefined || input.email === null ? null : boundedText(input.email, 512);
  const role = input.role === undefined ? "editor" : input.role;
  if (emailValue === "invalid" || (typeof emailValue === "string" && emailValue.trim().length === 0) ||
      !["admin", "editor", "viewer"].includes(String(role))) {
    return errorResponse("invalid_invitation", 400);
  }
  const id = input.id === undefined ? crypto.randomUUID() : (validID(input.id) ? input.id : "invalid");
  if (id === "invalid") return errorResponse("invalid_invitation", 400);
  const code = crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO invitations
       (id, brand_id, creator_id, email, code, role, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.brand_id, access.userID,
      typeof emailValue === "string" ? emailValue.trim() : null, code, role, expiresAt, createdAt).run();
  } catch {
    return errorResponse("invitation_conflict", 409);
  }
  const created = await readInvitation(env, id);
  return created ? jsonResponse(invitationPayload(created), 201) : errorResponse("metadata_unavailable", 503);
}

async function revokeInvitation(request: Request, env: CoreEnv, invitationID: string): Promise<Response> {
  if (!validID(invitationID)) return errorResponse("not_found", 404);
  const invitation = await readInvitation(env, invitationID);
  if (!invitation) return errorResponse("not_found", 404);
  const access = await requireBrandManager(request, env, invitation.brand_id);
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(
    `DELETE FROM invitations WHERE id = ? AND brand_id = ?`,
  ).bind(invitationID, invitation.brand_id).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

async function updateBrandMemberRole(request: Request, env: CoreEnv, brandID: string, memberID: string): Promise<Response> {
  if (!validID(brandID) || !validID(memberID)) return errorResponse("not_found", 404);
  const access = await requireBrandManager(request, env, brandID);
  if (access instanceof Response) return access;
  const input = await readJson(request);
  if (!input || !["admin", "editor", "viewer"].includes(String(input.role))) {
    return errorResponse("invalid_member_role", 400);
  }
  const result = await env.DB.prepare(
    `UPDATE brand_members SET role = ?
     WHERE brand_id = ? AND user_id = ? AND joined_at IS NOT NULL
       AND user_id <> (SELECT owner_id FROM brands WHERE id = ?)`,
  ).bind(input.role, brandID, memberID, brandID).run();
  return result.meta.changes > 0 ? jsonResponse({ user_id: memberID, role: input.role }) : errorResponse("not_found", 404);
}

async function removeBrandMember(request: Request, env: CoreEnv, brandID: string, memberID: string): Promise<Response> {
  if (!validID(brandID) || !validID(memberID)) return errorResponse("not_found", 404);
  const access = await requireBrandManager(request, env, brandID);
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(
    `DELETE FROM brand_members
     WHERE brand_id = ? AND user_id = ? AND user_id <> (SELECT owner_id FROM brands WHERE id = ?)`,
  ).bind(brandID, memberID, brandID).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

async function acceptInvitation(request: Request, env: CoreEnv, code: string): Promise<Response> {
  if (!/^[A-Z0-9_-]{8,64}$/i.test(code)) return errorResponse("invalid_invitation", 400);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const invitation = await readInvitation(env, code, true);
  if (!invitation || invitation.used_at || new Date(invitation.expires_at).getTime() <= Date.now()) {
    return errorResponse("invitation_unavailable", 410);
  }
  const user = await env.DB.prepare(`SELECT id, email FROM users WHERE id = ? LIMIT 1`).bind(userID).first<{ id: string; email: string }>();
  if (!user) return errorResponse("not_found", 404);
  if (invitation.email && invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return errorResponse("invitation_email_mismatch", 403);
  }
  const existing = await env.DB.prepare(
    `SELECT user_id FROM brand_members WHERE brand_id = ? AND user_id = ? AND joined_at IS NOT NULL LIMIT 1`,
  ).bind(invitation.brand_id, userID).first<{ user_id: string }>();
  if (existing) return errorResponse("already_member", 409);
  try {
    await env.DB.prepare(
      `INSERT INTO brand_members (id, brand_id, user_id, role, invited_at, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), invitation.brand_id, userID, invitation.role, invitation.created_at, new Date().toISOString()).run();
    const usedAt = new Date().toISOString();
    const used = await env.DB.prepare(
      `UPDATE invitations SET used_at = ? WHERE id = ? AND used_at IS NULL`,
    ).bind(usedAt, invitation.id).run();
    if (used.meta.changes === 0) return errorResponse("invitation_unavailable", 409);
  } catch {
    return errorResponse("invitation_conflict", 409);
  }
  return jsonResponse({ brand_id: invitation.brand_id, role: invitation.role }, 201);
}

async function invokeProviderAction(request: Request, env: CoreEnv, action: string): Promise<Response> {
  if (!PROVIDER_ACTIONS.has(action)) return errorResponse("provider_action_not_allowed", 404);
  return handleImageAIAction(request,env,action);
}

async function listGenerationJobs(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const brandID = url.searchParams.get("brand_id");
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const page = pagination(url);
  if (page instanceof Response) return page;
  const result = await env.DB.prepare(
    `SELECT id, brand_id, user_id, feature_type, input_params, optimized_prompt,
      status, error_message, created_at, completed_at
     FROM generation_jobs WHERE brand_id = ? AND user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(brandID, access, page.limit, page.offset).all<GenerationJobRow>();
  return jsonResponse((result.results ?? []).map(jobPayload));
}

async function readGenerationJob(request: Request, env: CoreEnv, jobID: string): Promise<Response> {
  if (!validID(jobID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const row = await env.DB.prepare(
    `SELECT id, brand_id, user_id, feature_type, input_params, optimized_prompt,
      status, error_message, created_at, completed_at
     FROM generation_jobs WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(jobID, userID).first<GenerationJobRow>();
  return row ? jsonResponse(jobPayload(row)) : errorResponse("not_found", 404);
}

async function createGenerationJob(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  if (!input || !validID(input.brand_id) || typeof input.feature_type !== "string" ||
      input.feature_type.length === 0 || input.feature_type.length > 256) return errorResponse("invalid_generation_job", 400);
  const access = await requireBrandRole(request, env, input.brand_id, "editor");
  if (access instanceof Response) return access;
  const id = input.id === undefined ? crypto.randomUUID() : (validID(input.id) ? input.id : "invalid");
  const inputParams = jsonText(input.input_params);
  const prompt = boundedText(input.optimized_prompt, 20000);
  const status = input.status === undefined ? "pending" : input.status;
  if (id === "invalid" || inputParams === "invalid" || prompt === "invalid" ||
      !["pending", "processing", "completed", "failed"].includes(String(status))) {
    return errorResponse("invalid_generation_job", 400);
  }
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO generation_jobs
       (id, brand_id, user_id, feature_type, input_params, optimized_prompt, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.brand_id, access, input.feature_type, inputParams, prompt, status, now).run();
  } catch {
    return errorResponse("generation_job_conflict", 409);
  }
  return readGenerationJob(request, env, id);
}

async function updateGenerationJob(request: Request, env: CoreEnv, jobID: string): Promise<Response> {
  if (!validID(jobID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const input = await readJson(request);
  const status = input?.status;
  const errorMessage = boundedText(input?.error_message, 4000);
  if (!input || !["pending", "processing", "completed", "failed"].includes(String(status)) || errorMessage === "invalid") {
    return errorResponse("invalid_generation_job", 400);
  }
  const completedAt = status === "completed" || status === "failed" ? new Date().toISOString() : null;
  const result = await env.DB.prepare(
    `UPDATE generation_jobs SET status = ?, error_message = ?, completed_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(status, errorMessage, completedAt, jobID, userID).run();
  return result.meta.changes > 0 ? readGenerationJob(request, env, jobID) : errorResponse("not_found", 404);
}

async function listGeneratedImages(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const brandID = url.searchParams.get("brand_id");
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const page = pagination(url);
  if (page instanceof Response) return page;
  const favorite = url.searchParams.get("favorite");
  if (favorite !== null && favorite !== "true" && favorite !== "false") return errorResponse("invalid_favorite", 400);
  const favoriteClause = favorite === null ? "" : " AND is_favorite = ?";
  const assetPurpose = url.searchParams.get("asset_purpose");
  if (assetPurpose !== null && assetPurpose !== "print-design") return errorResponse("invalid_asset_purpose", 400);
  const hasJob = url.searchParams.get("has_job");
  if (hasJob !== null && hasJob !== "true" && hasJob !== "false") return errorResponse("invalid_has_job", 400);
  const featureType = url.searchParams.get("feature_type");
  if (featureType !== null && (boundedText(featureType, 256) === "invalid" || !featureType.trim())) return errorResponse("invalid_feature_type", 400);
  const jobID = url.searchParams.get("job_id");
  if (jobID !== null && !validID(jobID)) return errorResponse("invalid_job_id", 400);
  const order = url.searchParams.get("order");
  if (order !== null && order !== "oldest" && order !== "newest") return errorResponse("invalid_order", 400);
  const sortDirection = order === "oldest" ? "ASC" : "DESC";
  // Apply picker filters before pagination so older matching artwork is not
  // hidden by a page of unrelated images. Keep both brand and user predicates.
  const purposeClause = assetPurpose === null ? "" : " AND CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.assetPurpose') ELSE NULL END = ?";
  const jobClause = hasJob === null ? "" : hasJob === "true" ? " AND job_id IS NOT NULL" : " AND job_id IS NULL";
  const featureClause = featureType === null ? "" : " AND feature_type = ?";
  const jobIDClause = jobID === null ? "" : " AND job_id = ?";
  const values: unknown[] = [brandID, access];
  if (favorite !== null) values.push(favorite === "true" ? 1 : 0);
  if (assetPurpose !== null) values.push(assetPurpose);
  if (featureType !== null) values.push(featureType);
  if (jobID !== null) values.push(jobID);
  values.push(page.limit, page.offset);
  const result = await env.DB.prepare(
    `SELECT id, job_id, brand_id, user_id, storage_path, thumbnail_path, version,
      parent_image_id, is_favorite, prompt, negative_prompt, feature_type,
      style_preset, model_used, generation_params, metadata, image_url,
      created_at, expires_at FROM generated_images
     WHERE brand_id = ? AND user_id = ?${favoriteClause}${purposeClause}${jobClause}${featureClause}${jobIDClause}
       AND CASE WHEN json_valid(metadata) THEN COALESCE(json_extract(metadata,'$.artifactRole'),'') ELSE '' END <> 'provider-intermediate'
     ORDER BY created_at ${sortDirection}, id ${sortDirection} LIMIT ? OFFSET ?`,
  ).bind(...values).all<GeneratedImageRow>();
  return jsonResponse((result.results ?? []).map(imagePayload));
}

async function readGeneratedImage(request: Request, env: CoreEnv, imageID: string): Promise<Response> {
  if (!validID(imageID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const row = await env.DB.prepare(
    `SELECT id, job_id, brand_id, user_id, storage_path, thumbnail_path, version,
      parent_image_id, is_favorite, prompt, negative_prompt, feature_type,
      style_preset, model_used, generation_params, metadata, image_url,
      created_at, expires_at FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(imageID, userID).first<GeneratedImageRow>();
  return row ? jsonResponse(imagePayload(row)) : errorResponse("not_found", 404);
}

async function createGeneratedImage(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  if (!input || !validID(input.brand_id) || typeof input.storage_path !== "string" ||
      input.storage_path.length === 0 || input.storage_path.length > 2048 ||
      // eslint-disable-next-line no-control-regex -- storage paths reject control characters and traversal markers.
      /[\u0000-\u001f\u007f]|\.\.(?:\/|$)/.test(input.storage_path)) return errorResponse("invalid_generated_image", 400);
  const access = await requireBrandRole(request, env, input.brand_id, "editor");
  if (access instanceof Response) return access;
  const id = input.id === undefined ? crypto.randomUUID() : (validID(input.id) ? input.id : "invalid");
  const jobID = input.job_id === undefined || input.job_id === null ? null : (validID(input.job_id) ? input.job_id : "invalid");
  const parentImageID = input.parent_image_id === undefined || input.parent_image_id === null
    ? null : (validID(input.parent_image_id) ? input.parent_image_id : "invalid");
  const textFields = ["thumbnail_path", "prompt", "negative_prompt", "feature_type", "style_preset", "model_used", "image_url"];
  const fields = new Map<string, string | null>();
  for (const field of textFields) {
    const value = boundedText(input[field], field === "image_url" ? 4096 : 20000);
    if (value === "invalid") return errorResponse("invalid_generated_image", 400);
    fields.set(field, value);
  }
  const generationParams = jsonText(input.generation_params);
  const metadata = jsonText(input.metadata);
  const version = input.version === undefined ? 1 : input.version;
  const favorite = input.is_favorite === true ? 1 : 0;
  if (id === "invalid" || jobID === "invalid" || parentImageID === "invalid" || generationParams === "invalid" || metadata === "invalid" ||
      typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || version > 100000 ||
      boundedText(input.expires_at, 64) === "invalid") return errorResponse("invalid_generated_image", 400);
  if (jobID) {
    const job = await env.DB.prepare(
      `SELECT id FROM generation_jobs WHERE id = ? AND brand_id = ? AND user_id = ? LIMIT 1`,
    ).bind(jobID, input.brand_id, access).first<{ id: string }>();
    if (!job) return errorResponse("invalid_generated_image", 400);
  }
  if (parentImageID) {
    const parent = await env.DB.prepare(
      `SELECT id FROM generated_images WHERE id = ? AND brand_id = ? AND user_id = ? LIMIT 1`,
    ).bind(parentImageID, input.brand_id, access).first<{ id: string }>();
    if (!parent) return errorResponse("invalid_generated_image", 400);
  }
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO generated_images
       (id, job_id, brand_id, user_id, storage_path, thumbnail_path, version,
        parent_image_id, is_favorite, prompt, negative_prompt, feature_type,
        style_preset, model_used, generation_params, metadata, image_url, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, jobID, input.brand_id, access, input.storage_path,
      fields.get("thumbnail_path"), version, parentImageID,
      favorite, fields.get("prompt"), fields.get("negative_prompt"), fields.get("feature_type"),
      fields.get("style_preset"), fields.get("model_used"), generationParams, metadata, fields.get("image_url"),
      now, boundedText(input.expires_at, 64)).run();
  } catch {
    return errorResponse("generated_image_conflict", 409);
  }
  return readGeneratedImage(request, env, id);
}

async function updateGeneratedImage(request: Request, env: CoreEnv, imageID: string): Promise<Response> {
  if (!validID(imageID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const input = await readJson(request);
  if (!input || (typeof input.is_favorite !== "boolean" && typeof input.library_title !== "string")) return errorResponse("invalid_generated_image", 400);
  if (typeof input.library_title === "string") {
    const title = boundedText(input.library_title, 200);
    if (title === null || title === "invalid" || title.trim().length === 0) return errorResponse("invalid_generated_image", 400);
    const existing = await env.DB.prepare(
      `SELECT metadata FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
    ).bind(imageID, userID).first<{ metadata: string }>();
    if (!existing) return errorResponse("not_found", 404);
    const metadata = parseStored(existing.metadata, {});
    const nextMetadata: JsonRecord = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as JsonRecord), libraryTitle: title.trim() }
      : { libraryTitle: title.trim() };
    const encoded = jsonText(nextMetadata);
    if (encoded === "invalid") return errorResponse("invalid_generated_image", 400);
    const result = await env.DB.prepare(
      `UPDATE generated_images SET metadata = ? WHERE id = ? AND user_id = ?`,
    ).bind(encoded, imageID, userID).run();
    return result.meta.changes > 0 ? readGeneratedImage(request, env, imageID) : errorResponse("not_found", 404);
  }
  const result = await env.DB.prepare(
    `UPDATE generated_images SET is_favorite = ? WHERE id = ? AND user_id = ?`,
  ).bind(input.is_favorite ? 1 : 0, imageID, userID).run();
  return result.meta.changes > 0 ? readGeneratedImage(request, env, imageID) : errorResponse("not_found", 404);
}

async function deleteGeneratedImage(request: Request, env: CoreEnv, imageID: string): Promise<Response> {
  if (!validID(imageID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;

  const owned = await env.DB.prepare(
    `SELECT id FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(imageID, userID).first<{ id: string }>();
  if (!owned) return errorResponse("not_found", 404);

  // The D1 row and its private R2 object are one user-visible artifact. Remove
  // the object first so an R2 failure leaves the row retryable instead of
  // silently orphaning data that the UI still presents as deletable.
  try {
    await env.PRIVATE_MEDIA.delete(generatedImageObjectKey(imageID));
  } catch {
    return errorResponse("media_storage_unavailable", 502);
  }

  const result = await env.DB.prepare(`DELETE FROM generated_images WHERE id = ? AND user_id = ?`).bind(imageID, userID).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

function generatedImageMaxBytes(env: CoreEnv): number {
  const configured = Number(env.MAX_MEDIA_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_GENERATED_IMAGE_BYTES;
}

function generatedImageObjectKey(imageID: string): string {
  return `generated-images/${imageID}`;
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    // Reject alternate spellings that decode to the same bytes because the
    // final base64url character contains unused padding bits. Without this
    // canonical check, a token with a modified last character could still
    // verify as the original HMAC signature.
    if (base64UrlEncode(bytes) !== value) return null;
    return bytes;
  } catch {
    return null;
  }
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function mediaReadSecret(env: CoreEnv): string | null {
  const secret = env.MEDIA_READ_SECRET?.trim();
  return secret && secret.length >= MIN_MEDIA_READ_SECRET_LENGTH ? secret : null;
}

async function mediaReadSignature(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    asArrayBuffer(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    asArrayBuffer(new TextEncoder().encode(payload)),
  ));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

interface MediaReadToken {
  image_id: string;
  user_id: string;
  bucket: "generated-images";
  object_path: string;
  expires_at: number;
}

const mediaReadTokenPayload = (token: string): { encoded: string; signature: Uint8Array } | null => {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 4096 || parts[1].length > 256) return null;
  const signature = base64UrlDecode(parts[1]);
  return signature ? { encoded: parts[0], signature } : null;
};

async function verifyMediaReadToken(token: string, env: CoreEnv): Promise<MediaReadToken | null> {
  const secret = mediaReadSecret(env);
  const parts = mediaReadTokenPayload(token);
  if (!secret || !parts) return null;
  const expected = await mediaReadSignature(secret, parts.encoded);
  if (!sameBytes(expected, parts.signature)) return null;
  const bytes = base64UrlDecode(parts.encoded);
  if (!bytes) return null;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<MediaReadToken>;
  if (!validID(candidate.image_id) || !validID(candidate.user_id) || candidate.bucket !== "generated-images" ||
      candidate.object_path !== generatedImageObjectKey(candidate.image_id) ||
      typeof candidate.expires_at !== "number" || !Number.isSafeInteger(candidate.expires_at) ||
      candidate.expires_at <= Math.floor(Date.now() / 1000)) return null;
  return candidate as MediaReadToken;
}

async function createMediaReadToken(
  input: Omit<MediaReadToken, "expires_at">,
  expiresIn: number,
  env: CoreEnv,
): Promise<string | null> {
  const secret = mediaReadSecret(env);
  if (!secret) return null;
  const payload: MediaReadToken = { ...input, expires_at: Math.floor(Date.now() / 1000) + expiresIn };
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await mediaReadSignature(secret, encoded));
  return `${encoded}.${signature}`;
}

function mediaContentHeaders(object: R2ObjectBody): Headers {
  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return headers;
}

async function readGeneratedImageForOwner(env: CoreEnv, imageID: string, userID: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(imageID, userID).first<{ id: string }>();
  if (!row) return errorResponse("not_found", 404);
  let object: R2ObjectBody | null;
  try {
    object = await env.PRIVATE_MEDIA.get(generatedImageObjectKey(imageID));
  } catch {
    return errorResponse("media_storage_unavailable", 502);
  }
  if (!object) return errorResponse("not_found", 404);
  return new Response(object.body, { status: 200, headers: mediaContentHeaders(object) });
}

/**
 * Browser-safe R2 read gateway. The first request is authenticated and
 * returns a short-lived capability URL; the follow-up request carries only
 * the HMAC capability, so an image element does not need a bearer header.
 */
export async function handleMediaReadGateway(request: Request, env: CoreEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/media/read") return null;
  if (request.method !== "GET") return errorResponse("method_not_allowed", 405);
  if (!mediaReadSecret(env)) return errorResponse("media_read_gateway_unavailable", 503);

  const capability = url.searchParams.get("token");
  if (capability) {
    const token = await verifyMediaReadToken(capability, env);
    if (!token) return errorResponse("invalid_media_token", 401);
    return readGeneratedImageForOwner(env, token.image_id, token.user_id);
  }

  const bucket = url.searchParams.get("bucket");
  const objectPath = url.searchParams.get("path");
  const expiresIn = Number(url.searchParams.get("expiresIn") ?? "3600");
  const imageMatch = objectPath?.match(/^generated-images\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/);
  if (bucket !== "generated-images" || !imageMatch || generatedImageObjectKey(imageMatch[1]) !== objectPath ||
      !Number.isSafeInteger(expiresIn) || expiresIn < 60 || expiresIn > 3600) {
    return errorResponse("invalid_media_read_request", 400);
  }

  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const row = await env.DB.prepare(
    `SELECT id FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(imageMatch[1], userID).first<{ id: string }>();
  if (!row) return errorResponse("not_found", 404);

  const token = await createMediaReadToken({
    image_id: imageMatch[1],
    user_id: userID,
    bucket: "generated-images",
    object_path: objectPath,
  }, expiresIn, env);
  if (!token) return errorResponse("media_read_gateway_unavailable", 503);
  const readUrl = new URL(request.url);
  readUrl.search = "";
  readUrl.searchParams.set("token", token);
  return jsonResponse({
    provider: "cloudflare_r2",
    bucket: "generated-images",
    objectPath,
    url: readUrl.toString(),
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
  });
}

async function ownedGeneratedImage(request: Request, env: CoreEnv, imageID: string): Promise<string | Response> {
  if (!validID(imageID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const row = await env.DB.prepare(
    `SELECT id FROM generated_images WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(imageID, userID).first<{ id: string }>();
  return row ? userID : errorResponse("not_found", 404);
}

async function uploadGeneratedImageContent(request: Request, env: CoreEnv, imageID: string): Promise<Response> {
  const owner = await ownedGeneratedImage(request, env, imageID);
  if (owner instanceof Response) return owner;
  const rawContentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!rawContentType.startsWith("image/")) return errorResponse("content_type_mismatch", 415);
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return errorResponse("invalid_media_body", 400);
  }
  if (body.byteLength === 0) return errorResponse("invalid_media_body", 400);
  if (body.byteLength > generatedImageMaxBytes(env)) return errorResponse("media_too_large", 413);
  try {
    await env.PRIVATE_MEDIA.put(generatedImageObjectKey(imageID), body, {
      httpMetadata: { contentType: rawContentType },
    });
  } catch {
    return errorResponse("media_storage_unavailable", 502);
  }
  return jsonResponse({ id: imageID, ownerId: owner, state: "ready", storedSizeBytes: body.byteLength });
}

async function readGeneratedImageContent(request: Request, env: CoreEnv, imageID: string): Promise<Response> {
  const owner = await ownedGeneratedImage(request, env, imageID);
  if (owner instanceof Response) return owner;
  let object: R2ObjectBody | null;
  try {
    object = await env.PRIVATE_MEDIA.get(generatedImageObjectKey(imageID));
  } catch {
    return errorResponse("media_storage_unavailable", 502);
  }
  if (!object) return errorResponse("not_found", 404);
  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}

async function listCanvasDocuments(request: Request, env: CoreEnv, url: URL): Promise<Response> {
  const brandID = url.searchParams.get("brand_id");
  if (!validID(brandID)) return errorResponse("invalid_brand_id", 400);
  const access = await requireBrandRole(request, env, brandID, "viewer");
  if (access instanceof Response) return access;
  const result = await env.DB.prepare(
    `SELECT id, owner_id, brand_id, title, snapshot, snapshot_version, revision, created_at, updated_at
     FROM canvas_documents WHERE brand_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).bind(brandID, 100, 0).all<CanvasDocumentRow>();
  return jsonResponse((result.results ?? []).map(canvasPayload));
}

async function readCanvasDocument(request: Request, env: CoreEnv, documentID: string): Promise<Response> {
  if (!validID(documentID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const row = await env.DB.prepare(
    `SELECT id, owner_id, brand_id, title, snapshot, snapshot_version, revision, created_at, updated_at
     FROM canvas_documents WHERE id = ? LIMIT 1`,
  ).bind(documentID).first<CanvasDocumentRow>();
  if (!row || !roleAtLeast(await brandRole(env, userID, row.brand_id), "viewer")) return errorResponse("not_found", 404);
  return jsonResponse(canvasPayload(row));
}

async function createCanvasDocument(request: Request, env: CoreEnv): Promise<Response> {
  const input = await readJson(request);
  if (!input || !validID(input.brand_id)) return errorResponse("invalid_canvas_document", 400);
  const access = await requireBrandRole(request, env, input.brand_id, "editor");
  if (access instanceof Response) return access;
  const id = input.id === undefined ? crypto.randomUUID() : (validID(input.id) ? input.id : "invalid");
  const title = boundedText(input.title, 160) ?? "無題のプロジェクト";
  const snapshot = canvasSnapshotText(input.snapshot);
  if (id === "invalid" || title === "invalid" || snapshot === "invalid") return errorResponse("invalid_canvas_document", 400);
  const now = new Date().toISOString();
  let writeFailed = false;
  try {
    await env.DB.prepare(
      `INSERT INTO canvas_documents
       (id, owner_id, brand_id, title, snapshot, snapshot_version, revision, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, 0, ?, ? WHERE ${CANVAS_EDITOR_PREDICATE}
       ON CONFLICT(id) DO NOTHING`,
    ).bind(id, access, input.brand_id, title, snapshot, now, now, input.brand_id, access, access).run();
  } catch {
    // A lost D1 response may have committed. Reconcile this exact immutable
    // identity below; never generate a replacement ID or overwrite the row.
    writeFailed = true;
  }
  const freshAccess = await requireBrandRole(request, env, input.brand_id, "editor");
  if (freshAccess instanceof Response) return freshAccess;
  if (freshAccess !== access) return errorResponse("unauthorized", 401);
  let row: CanvasDocumentRow | null;
  try {
    row = await env.DB.prepare(`SELECT id, owner_id, brand_id, title, snapshot, snapshot_version, revision, created_at, updated_at
      FROM canvas_documents WHERE id = ? LIMIT 1`).bind(id).first<CanvasDocumentRow>();
  } catch { return errorResponse("canvas_document_unavailable", 503); }
  if (!row) return errorResponse(writeFailed ? "canvas_document_unavailable" : "canvas_document_not_created", 503);
  if (row.owner_id !== access || row.brand_id !== input.brand_id || row.title !== title ||
      !sameCanvasJson(parseStored(row.snapshot,null),JSON.parse(snapshot))) return errorResponse("canvas_document_conflict", 409);
  return readCanvasDocument(request, env, id);
}

async function updateCanvasDocument(request: Request, env: CoreEnv, documentID: string): Promise<Response> {
  if (!validID(documentID)) return errorResponse("not_found", 404);
  const input = await readJson(request);
  const expectedRevision = input?.expected_revision;
  const title = boundedText(input?.title, 160);
  const snapshot = canvasSnapshotText(input?.snapshot);
  if (!input || typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      title === "invalid" || snapshot === "invalid") return errorResponse("invalid_canvas_document", 400);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const current = await env.DB.prepare(`SELECT brand_id FROM canvas_documents WHERE id = ? LIMIT 1`).bind(documentID).first<{ brand_id: string }>();
  if (!current || !roleAtLeast(await brandRole(env, userID, current.brand_id), "editor")) return errorResponse("not_found", 404);
  let changes = 0;
  try {
    const result = await env.DB.prepare(
      `UPDATE canvas_documents SET title = ?, snapshot = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND brand_id = ? AND revision = ? AND ${CANVAS_EDITOR_PREDICATE}`,
    ).bind(title ?? "無題のプロジェクト", snapshot, new Date().toISOString(), documentID, current.brand_id, expectedRevision,
      current.brand_id,userID,userID).run();
    changes = result.meta.changes;
  } catch { return errorResponse("canvas_document_unavailable", 503); }
  const freshAccess = await requireBrandRole(request, env, current.brand_id, "editor");
  if (freshAccess instanceof Response) return freshAccess;
  return changes > 0 ? readCanvasDocument(request, env, documentID) : errorResponse("revision_conflict", 409);
}

async function deleteCanvasDocument(request: Request, env: CoreEnv, documentID: string): Promise<Response> {
  if (!validID(documentID)) return errorResponse("not_found", 404);
  const userID = await principal(request, env);
  if (userID instanceof Response) return userID;
  const result = await env.DB.prepare(`DELETE FROM canvas_documents WHERE id = ? AND owner_id = ?`).bind(documentID, userID).run();
  return result.meta.changes > 0 ? new Response(null, { status: 204 }) : errorResponse("not_found", 404);
}

/** Returns null when the request belongs to another Worker surface. */
export async function handleCoreRequest(request: Request, env: CoreEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const sharedImageContent = url.pathname.match(/^\/v1\/shared-images\/([^/]+)\/content$/);
  if (sharedImageContent && request.method === "GET") {
    return readPublicSharedImageContent(request, env, decodeURIComponent(sharedImageContent[1]));
  }
  if (url.pathname === "/v1/shared-images" && request.method === "GET") {
    return readPublicSharedImage(request, env, url.searchParams.get("token")?.trim() ?? "");
  }
  if (url.pathname === "/v1/share-links" && request.method === "POST") return createShareLink(request, env);
  if (url.pathname === "/v1/generation-jobs" && request.method === "GET") return listGenerationJobs(request, env, url);
  if (url.pathname === "/v1/generation-jobs" && request.method === "POST") return createGenerationJob(request, env);
  const job = url.pathname.match(/^\/v1\/generation-jobs\/([^/]+)$/);
  if (job && request.method === "GET") return readGenerationJob(request, env, decodeURIComponent(job[1]));
  if (job && request.method === "PATCH") return updateGenerationJob(request, env, decodeURIComponent(job[1]));
  if (url.pathname === "/v1/generated-images" && request.method === "GET") return listGeneratedImages(request, env, url);
  if (url.pathname === "/v1/generated-images" && request.method === "POST") return createGeneratedImage(request, env);
  if (url.pathname === "/v1/folders" && request.method === "GET") return listFolders(request, env, url);
  if (url.pathname === "/v1/folders" && request.method === "POST") return createFolder(request, env);
  const folder = url.pathname.match(/^\/v1\/folders\/([^/]+)$/);
  if (folder && request.method === "PATCH") return updateFolder(request, env, decodeURIComponent(folder[1]));
  if (folder && request.method === "DELETE") return deleteFolder(request, env, decodeURIComponent(folder[1]));
  if (url.pathname === "/v1/image-folders" && request.method === "GET") return listImageFolders(request, env, url);
  if (url.pathname === "/v1/tags" && request.method === "GET") return listTags(request, env, url);
  if (url.pathname === "/v1/tags" && request.method === "POST") return createTag(request, env);
  const tag = url.pathname.match(/^\/v1\/tags\/([^/]+)$/);
  if (tag && request.method === "DELETE") return deleteTag(request, env, decodeURIComponent(tag[1]));
  if (url.pathname === "/v1/image-tags" && request.method === "GET") return listImageTags(request, env, url);
  if (url.pathname === "/v1/image-tags" && request.method === "POST") return addImageTag(request, env);
  if (url.pathname === "/v1/image-tags" && request.method === "DELETE") return deleteImageTag(request, env, url);
  if (url.pathname === "/v1/style-presets" && request.method === "GET") return listStylePresets(request, env, url);
  if (url.pathname === "/v1/style-presets" && request.method === "POST") return createStylePreset(request, env);
  const stylePreset = url.pathname.match(/^\/v1\/style-presets\/([^/]+)$/);
  if (stylePreset && request.method === "PATCH") return updateStylePreset(request, env, decodeURIComponent(stylePreset[1]));
  if (stylePreset && request.method === "DELETE") return deleteStylePreset(request, env, decodeURIComponent(stylePreset[1]));
  const members = url.pathname.match(/^\/v1\/brands\/([^/]+)\/members$/);
  if (members && request.method === "GET") return listBrandMembers(request, env, decodeURIComponent(members[1]));
  const member = url.pathname.match(/^\/v1\/brands\/([^/]+)\/members\/([^/]+)$/);
  if (member && request.method === "PATCH") return updateBrandMemberRole(request, env, decodeURIComponent(member[1]), decodeURIComponent(member[2]));
  if (member && request.method === "DELETE") return removeBrandMember(request, env, decodeURIComponent(member[1]), decodeURIComponent(member[2]));
  const brandInvitations = url.pathname.match(/^\/v1\/brands\/([^/]+)\/invitations$/);
  if (brandInvitations && request.method === "GET") return listInvitations(request, env, decodeURIComponent(brandInvitations[1]));
  if (brandInvitations && request.method === "POST") return createInvitation(request, env);
  const invitationAccept = url.pathname.match(/^\/v1\/invitations\/([^/]+)\/accept$/);
  if (invitationAccept && request.method === "POST") return acceptInvitation(request, env, decodeURIComponent(invitationAccept[1]));
  const invitation = url.pathname.match(/^\/v1\/invitations\/([^/]+)$/);
  if (invitation && request.method === "DELETE") return revokeInvitation(request, env, decodeURIComponent(invitation[1]));
  const providerAction = url.pathname.match(/^\/v1\/provider-actions\/([^/]+)$/);
  if (providerAction && request.method === "POST") return invokeProviderAction(request, env, decodeURIComponent(providerAction[1]));
  const imageContent = url.pathname.match(/^\/v1\/generated-images\/([^/]+)\/content$/);
  if (imageContent && request.method === "PUT") return uploadGeneratedImageContent(request, env, decodeURIComponent(imageContent[1]));
  if (imageContent && request.method === "GET") return readGeneratedImageContent(request, env, decodeURIComponent(imageContent[1]));
  const image = url.pathname.match(/^\/v1\/generated-images\/([^/]+)$/);
  if (image && request.method === "GET") return readGeneratedImage(request, env, decodeURIComponent(image[1]));
  if (image && request.method === "PATCH") return updateGeneratedImage(request, env, decodeURIComponent(image[1]));
  if (image && request.method === "DELETE") return deleteGeneratedImage(request, env, decodeURIComponent(image[1]));
  if (url.pathname === "/v1/canvas-documents" && request.method === "GET") return listCanvasDocuments(request, env, url);
  if (url.pathname === "/v1/canvas-documents" && request.method === "POST") return createCanvasDocument(request, env);
  const canvas = url.pathname.match(/^\/v1\/canvas-documents\/([^/]+)$/);
  if (canvas && request.method === "GET") return readCanvasDocument(request, env, decodeURIComponent(canvas[1]));
  if (canvas && request.method === "PATCH") return updateCanvasDocument(request, env, decodeURIComponent(canvas[1]));
  if (canvas && request.method === "DELETE") return deleteCanvasDocument(request, env, decodeURIComponent(canvas[1]));
  return null;
}
