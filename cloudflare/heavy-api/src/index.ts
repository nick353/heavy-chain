const DEFAULT_MAX_MEDIA_BYTES = 10 * 1024 * 1024;
import { handleDomainRequest } from "./domain.ts";
import { handleCoreRequest, handleMediaReadGateway } from "./core.ts";
import { configuredTokenVerifier } from "./auth.ts";
import { saveWorkspaceArtifact,readWorkspaceArtifact } from "./workspace.ts";
import { handleFeedbackAdminRequest } from "./feedback-admin.ts";
import { handleImageAIRead } from "./image-ai.ts";
import { readWorkspaceExecutionSteps } from './workspace-execution.ts';
const MAX_IDENTITY_PART_LENGTH = 512;
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
const MAX_CONTENT_TYPE_LENGTH = 128;
const MEDIA_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MediaState = "pending" | "ready" | "failed";

export interface TokenIdentity {
  issuer: string;
  subject: string;
}

export type TokenVerifier = (
  request: Request,
  env: Env,
) => TokenIdentity | null | Promise<TokenIdentity | null>;

export interface Env {
  AUTH_SERVICE?: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
  PRIVATE_MEDIA: R2Bucket;
  /** Optional test seam. Production requires the bound consumer-auth verifier. */
  MEDIA_TOKEN_VERIFIER?: TokenVerifier;
  AUTH_ISSUER?: string;
  /** Comma-separated exact browser origins allowed to call this Worker. */
  FRONTEND_ORIGINS?: string;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  /** `workers_ai` is the default. `openai` is opt-in and requires a server secret. */
  AI_IMAGE_PROVIDER?: string;
  AI_IMAGE_ENABLED?: string;
  AI_IMAGE_ALLOWED_ACTIONS?: string;
  /** Bounded provider observation timeout; inference remains single-shot. */
  AI_IMAGE_TIMEOUT_MS?: string;
  AI_MONTHLY_IMAGE_UNITS?: string;
  /** Shared account-wide monthly admission cap across all brands. */
  AI_ACCOUNT_MONTHLY_IMAGE_UNITS?: string;
  AI_DAILY_IMAGE_UNITS?: string;
  AI_DAILY_ESTIMATED_NEURONS?: string;
  /** Explicit opt-in for public share-link reads and creation. */
  PUBLIC_SHARE_ENABLED?: string;
  /** HTTPS origin of the frontend route used in generated share URLs. */
  PUBLIC_APP_ORIGIN?: string;
  /** Scaffold-only override; do not treat this as a Cloudflare account limit. */
  MAX_MEDIA_BYTES?: string;
  /** Server-only HMAC secret for short-lived browser media read URLs. */
  MEDIA_READ_SECRET?: string;
  /** Server-only OpenAI Images API credentials. Never expose through VITE_*. */
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_API_KEY?: string;
  OPENAI_IMAGE_BASE_URL?: string;
  OPENAI_IMAGE_MODEL?: string;
  OPENAI_IMAGE_EDIT_MODEL?: string;
}

interface MediaAsset {
  id: string;
  owner_issuer: string;
  owner_subject: string;
  client_request_id: string;
  object_key: string;
  content_type: string;
  declared_size_bytes: number;
  stored_size_bytes: number | null;
  checksum_sha256: string | null;
  state: MediaState;
  created_at: string;
  updated_at: string;
}

interface AllocationInput {
  clientRequestId: string;
  contentType: string;
  declaredSizeBytes: number;
}

function jsonResponse(body: Record<string, unknown>, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}

function allowedBrowserOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return null;
  const configured = (env.FRONTEND_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return configured.includes(origin) ? origin : null;
}

function withCors(request: Request, env: Env, response: Response): Response {
  const origin = allowedBrowserOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-expose-headers", "etag");
  headers.append("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsPreflight(request: Request, env: Env): Response {
  if (!allowedBrowserOrigin(request, env)) return errorResponse("cors_origin_not_allowed", 403);
  return withCors(request, env, new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, idempotency-key",
      "access-control-max-age": "600",
    },
  }));
}

function maxMediaBytes(env: Env): number {
  const configured = Number(env.MAX_MEDIA_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_MEDIA_BYTES;
}

function isValidIdentity(identity: TokenIdentity | null): identity is TokenIdentity {
  return Boolean(
    identity &&
      typeof identity.issuer === "string" &&
      typeof identity.subject === "string" &&
      identity.issuer.length > 0 &&
      identity.issuer.length <= MAX_IDENTITY_PART_LENGTH &&
      identity.subject.length > 0 &&
      identity.subject.length <= MAX_IDENTITY_PART_LENGTH,
  );
}

async function authenticate(request: Request, env: Env): Promise<TokenIdentity | Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    return errorResponse("unauthorized", 401);
  }

  const configuredVerifier = configuredTokenVerifier(env);
  const verifier = env.MEDIA_TOKEN_VERIFIER
    ? (candidate: Request) => Promise.resolve(env.MEDIA_TOKEN_VERIFIER!(candidate, env))
    : configuredVerifier;
  if (!verifier) {
    return errorResponse("token_verifier_unavailable", 503);
  }

  try {
    const identity = await verifier(request);
    return isValidIdentity(identity) ? identity : errorResponse("unauthorized", 401);
  } catch {
    return errorResponse("token_verifier_unavailable", 503);
  }
}

function isResponse(value: TokenIdentity | Response): value is Response {
  return value instanceof Response;
}

function allowedContentType(contentType: string): boolean {
  return contentType.startsWith("image/") || contentType === "application/pdf";
}

function normalizedContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const contentType = value.trim().toLowerCase();
  if (
    contentType.length === 0 ||
    contentType.length > MAX_CONTENT_TYPE_LENGTH ||
    !allowedContentType(contentType)
  ) {
    return null;
  }
  return contentType;
}

function parseAllocation(value: unknown, limit: number): AllocationInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const clientRequestId = input.clientRequestId;
  const contentType = normalizedContentType(input.contentType);
  const declaredSizeBytes = input.declaredSizeBytes;
  if (
    typeof clientRequestId !== "string" ||
    clientRequestId.length === 0 ||
    clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH ||
    !contentType ||
    typeof declaredSizeBytes !== "number" ||
    !Number.isSafeInteger(declaredSizeBytes) ||
    declaredSizeBytes <= 0 ||
    declaredSizeBytes > limit
  ) {
    return null;
  }
  return { clientRequestId, contentType, declaredSizeBytes };
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function findByRequest(
  env: Env,
  identity: TokenIdentity,
  clientRequestId: string,
): Promise<MediaAsset | null> {
  return env.DB.prepare(
    `SELECT id, owner_issuer, owner_subject, client_request_id, object_key,
      content_type, declared_size_bytes, stored_size_bytes, checksum_sha256,
      state, created_at, updated_at
     FROM media_assets
     WHERE owner_issuer = ? AND owner_subject = ? AND client_request_id = ?
     LIMIT 1`,
  )
    .bind(identity.issuer, identity.subject, clientRequestId)
    .first<MediaAsset>();
}

async function findById(
  env: Env,
  identity: TokenIdentity,
  id: string,
): Promise<MediaAsset | null> {
  return env.DB.prepare(
    `SELECT id, owner_issuer, owner_subject, client_request_id, object_key,
      content_type, declared_size_bytes, stored_size_bytes, checksum_sha256,
      state, created_at, updated_at
     FROM media_assets
     WHERE id = ? AND owner_issuer = ? AND owner_subject = ?
     LIMIT 1`,
  )
    .bind(id, identity.issuer, identity.subject)
    .first<MediaAsset>();
}

function allocationResponse(asset: MediaAsset, status: number): Response {
  return jsonResponse(
    {
      id: asset.id,
      state: asset.state,
      contentType: asset.content_type,
      declaredSizeBytes: asset.declared_size_bytes,
    },
    status,
  );
}

async function allocateMedia(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (isResponse(auth)) return auth;

  const input = parseAllocation(await readJson(request), maxMediaBytes(env));
  if (!input) return errorResponse("invalid_media_request", 400);

  const existing = await findByRequest(env, auth, input.clientRequestId);
  if (existing) {
    if (
      existing.content_type !== input.contentType ||
      existing.declared_size_bytes !== input.declaredSizeBytes
    ) {
      return errorResponse("idempotency_conflict", 409);
    }
    return allocationResponse(existing, 200);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const objectKey = `media/v1/${id}`;
  try {
    await env.DB.prepare(
      `INSERT INTO media_assets
        (id, owner_issuer, owner_subject, client_request_id, object_key,
         content_type, declared_size_bytes, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(
        id,
        auth.issuer,
        auth.subject,
        input.clientRequestId,
        objectKey,
        input.contentType,
        input.declaredSizeBytes,
        now,
        now,
      )
      .run();
  } catch {
    const concurrent = await findByRequest(env, auth, input.clientRequestId);
    if (concurrent) return allocationResponse(concurrent, 200);
    return errorResponse("metadata_unavailable", 503);
  }

  const created = await findById(env, auth, id);
  return created ? allocationResponse(created, 201) : errorResponse("metadata_unavailable", 503);
}

function requestContentType(request: Request): string | null {
  const raw = request.headers.get("content-type");
  if (!raw) return null;
  return normalizedContentType(raw.split(";", 1)[0]);
}

function declaredContentLength(request: Request): number | null | "invalid" {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : "invalid";
}

async function markFailed(env: Env, identity: TokenIdentity, asset: MediaAsset): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE media_assets
       SET state = 'failed', updated_at = ?
       WHERE id = ? AND owner_issuer = ? AND owner_subject = ?`,
    )
      .bind(new Date().toISOString(), asset.id, identity.issuer, identity.subject)
      .run();
  } catch {
    // A later reconciliation pass must handle a row that could not be marked failed.
  }
}

async function uploadMedia(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (isResponse(auth)) return auth;
  if (!MEDIA_ID_PATTERN.test(id)) return errorResponse("not_found", 404);

  const asset = await findById(env, auth, id);
  if (!asset) return errorResponse("not_found", 404);
  if (asset.state === "failed") return errorResponse("media_not_uploadable", 409);

  const contentType = requestContentType(request);
  if (!contentType || contentType !== asset.content_type) {
    return errorResponse("content_type_mismatch", 415);
  }

  const contentLength = declaredContentLength(request);
  if (contentLength === "invalid") return errorResponse("invalid_content_length", 400);
  if (contentLength !== null && contentLength > maxMediaBytes(env)) {
    return errorResponse("media_too_large", 413);
  }
  if (contentLength !== null && contentLength !== asset.declared_size_bytes) {
    return errorResponse("declared_size_mismatch", 400);
  }

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return errorResponse("invalid_media_body", 400);
  }
  if (body.byteLength > maxMediaBytes(env)) return errorResponse("media_too_large", 413);
  if (body.byteLength !== asset.declared_size_bytes) {
    return errorResponse("declared_size_mismatch", 400);
  }

  try {
    await env.PRIVATE_MEDIA.put(asset.object_key, body, {
      httpMetadata: { contentType: asset.content_type },
    });
  } catch {
    await markFailed(env, auth, asset);
    return errorResponse("media_storage_unavailable", 502);
  }

  try {
    await env.DB.prepare(
      `UPDATE media_assets
       SET state = 'ready', stored_size_bytes = ?, updated_at = ?
       WHERE id = ? AND owner_issuer = ? AND owner_subject = ?`,
    )
      .bind(body.byteLength, new Date().toISOString(), asset.id, auth.issuer, auth.subject)
      .run();
  } catch {
    // The object may now be orphaned; leave the row pending for reconciliation.
    return errorResponse("metadata_unavailable", 503);
  }

  return jsonResponse({ id: asset.id, state: "ready", storedSizeBytes: body.byteLength });
}

async function readMedia(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await authenticate(request, env);
  if (isResponse(auth)) return auth;
  if (!MEDIA_ID_PATTERN.test(id)) return errorResponse("not_found", 404);

  const asset = await findById(env, auth, id);
  if (!asset) return errorResponse("not_found", 404);
  if (asset.state !== "ready") return errorResponse("media_not_ready", 409);

  let object: R2ObjectBody | null;
  try {
    object = await env.PRIVATE_MEDIA.get(asset.object_key);
  } catch {
    return errorResponse("media_storage_unavailable", 502);
  }
  if (!object) return errorResponse("not_found", 404);

  const headers = new Headers();
  headers.set("content-type", asset.content_type);
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return corsPreflight(request, env);
  const respond = (response: Response): Response => withCors(request, env, response);
  if (request.method === "GET" && url.pathname === "/v1/health") {
    return respond(jsonResponse({ status: "ok", service: "heavy-api", media: "private-r2" }));
  }
  const feedbackAdminResponse = await handleFeedbackAdminRequest(request, env);
  if (feedbackAdminResponse) return respond(feedbackAdminResponse);
  const domainResponse = await handleDomainRequest(request, env);
  if (domainResponse) return respond(domainResponse);
  const mediaReadGatewayResponse = await handleMediaReadGateway(request, env);
  if (mediaReadGatewayResponse) return respond(mediaReadGatewayResponse);
  const workspaceRead = /^\/v1\/workspace-artifacts\/([^/]+)$/.exec(url.pathname);
  if (url.pathname === '/v1/workspace-execution-steps' && request.method === 'GET') {
    try { return respond(await readWorkspaceExecutionSteps(request, env)); }
    catch { return respond(errorResponse('workspace_execution_unavailable', 503)); }
  }
  if (workspaceRead && request.method === 'GET') {
    try { return respond(await readWorkspaceArtifact(request,env,workspaceRead[1])); }
    catch { return respond(errorResponse('workspace_storage_unavailable',503)); }
  }
  if (url.pathname === "/v1/workspace-artifacts" && request.method === "POST") {
    try { return respond(await saveWorkspaceArtifact(request, env)); }
    catch { return respond(errorResponse("workspace_storage_unavailable", 503)); }
  }
  const imageRead = await handleImageAIRead(request, env);
  if (imageRead) return withCors(request, env, imageRead);
  const coreResponse = await handleCoreRequest(request, env);
  if (coreResponse) return respond(coreResponse);
  if (url.pathname === "/v1/media" && request.method === "POST") {
    return respond(await allocateMedia(request, env));
  }

  const match = url.pathname.match(/^\/v1\/media\/([^/]+)\/content$/);
  if (!match) return respond(errorResponse("not_found", 404));
  if (request.method === "PUT") return respond(await uploadMedia(request, env, match[1]));
  if (request.method === "GET") return respond(await readMedia(request, env, match[1]));
  return respond(errorResponse("method_not_allowed", 405));
}

const worker = { fetch: handleRequest };
export default worker;
