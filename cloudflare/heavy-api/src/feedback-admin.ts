import type { Env } from './index.ts';
import { principal } from './domain.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
type Json = Record<string, unknown>;
interface Feedback extends Json {
  id: string; user_id: string; payload_hash: string; brand_id: string | null;
  screenshot_path: string | null; screenshot_sha256: string | null; screenshot_bytes: number | null;
  screenshot_capture_status: string; submission_state: 'pending' | 'accepted';
  viewport: string; revision: number;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
function error(code: string, status = 400): Response { return json({ error: code }, status); }
function text(value: unknown, max: number, optional = false): value is string {
  return typeof value === 'string' && (optional || value.trim().length > 0) && value.length <= max &&
    // eslint-disable-next-line no-control-regex -- reject non-printing control characters in admin feedback fields.
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
async function readJson(request: Request, limit = 16384): Promise<Json | Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('json_required', 415);
  if (!request.body) return error('invalid_json');
  if (Number(request.headers.get('content-length')) > limit) return error('payload_too_large', 413);
  const reader = request.body.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); return error('payload_too_large', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : error('invalid_json');
  } catch { return error('invalid_json'); }
  finally { reader.releaseLock(); }
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = Uint8Array.from(bytes).buffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), b => b.toString(16).padStart(2, '0')).join('');
}
function png(value: unknown): Uint8Array | null | Response {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return error('screenshot_must_be_png');
  const encoded = value.slice(22);
  if (encoded.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4) return error('screenshot_too_large', 413);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return error('invalid_screenshot');
  try {
    const binary = atob(encoded); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || bytes.length > MAX_SCREENSHOT_BYTES || signature.some((b, i) => bytes[i] !== b) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return error('invalid_screenshot');
    return bytes;
  } catch { return error('invalid_screenshot'); }
}
function page(value: unknown, env: Env): { page_url: string; pathname: string } | Response {
  if (!text(value, 2000)) return error('invalid_page_url');
  const origins = (env.FRONTEND_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  try {
    const url = new URL(value, origins[0]);
    if (!origins.includes(url.origin) || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return error('invalid_page_url');
    // Query/hash can contain invitations, reset codes, or other credentials.
    url.search = ''; url.hash = '';
    return { page_url: url.toString(), pathname: url.pathname };
  } catch { return error('invalid_page_url'); }
}
async function brandAllowed(env: Env, userId: string, brandId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT b.id FROM brands b WHERE b.id = ? AND
    (b.owner_id = ? OR EXISTS (SELECT 1 FROM brand_members m WHERE m.brand_id = b.id
      AND m.user_id = ? AND m.joined_at IS NOT NULL AND m.role IN ('owner','admin','editor','viewer')))`)
    .bind(brandId, userId, userId).first());
}
async function requireAdmin(request: Request, env: Env): Promise<string | Response> {
  const userId = await principal(request, env); if (userId instanceof Response) return userId;
  return await env.DB.prepare('SELECT user_id FROM platform_admins WHERE user_id = ?').bind(userId).first()
    ? userId : error('admin_required', 403);
}
function receipt(row: Feedback): Response {
  return json({ ok: true, feedback: { id: row.id, submission_state: row.submission_state,
    screenshot_capture_status: row.screenshot_capture_status } });
}
async function submit(request: Request, env: Env): Promise<Response> {
  const userId = await principal(request, env); if (userId instanceof Response) return userId;
  const input = await readJson(request, MAX_REQUEST_BYTES); if (input instanceof Response) return input;
  if (!text(input.request_id, 36) || !UUID.test(input.request_id) ||
    typeof input.type !== 'string' || !['lost','cutout','result','save','speed','other'].includes(input.type) || !text(input.message, 4000) ||
    (input.brand_id != null && (typeof input.brand_id !== 'string' || !ID.test(input.brand_id))) ||
    (input.user_agent != null && !text(input.user_agent, 1024, true)) ||
    typeof input.screenshot_capture_status !== 'string' || !['captured','screenshot_capture_failed','screenshot_upload_failed'].includes(input.screenshot_capture_status)) return error('invalid_feedback');
  const location = page(input.page_url, env); if (location instanceof Response) return location;
  const brandId = typeof input.brand_id === 'string' ? input.brand_id : null;
  if (brandId && !await brandAllowed(env, userId, brandId)) return error('brand_forbidden', 403);
  const viewport: Json = {};
  if (input.viewport != null) {
    if (typeof input.viewport !== 'object' || Array.isArray(input.viewport)) return error('invalid_viewport');
    for (const key of ['width', 'height', 'devicePixelRatio']) {
      const n = (input.viewport as Json)[key];
      if (n !== undefined) {
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 32768) return error('invalid_viewport');
        viewport[key] = n;
      }
    }
  }
  const bytes = png(input.screenshot_data_url); if (bytes instanceof Response) return bytes;
  const screenshotHash = bytes ? await sha256(bytes) : null;
  const captureStatus = bytes ? 'captured' : input.screenshot_capture_status === 'captured'
    ? 'screenshot_capture_failed' : String(input.screenshot_capture_status);
  // Ignore caller-supplied user/email/status/roles/path: only verified D1 identity
  // and server-selected object keys are authoritative.
  const payload = { brandId, type: input.type, message: input.message.trim(), ...location,
    viewport, user_agent: input.user_agent ?? null, screenshotHash, captureStatus };
  const hash = await sha256(new TextEncoder().encode(JSON.stringify(payload)));
  const find = () => env.DB.prepare('SELECT * FROM feedback_submissions WHERE user_id = ? AND request_id = ?')
    .bind(userId, input.request_id).first<Feedback>();
  let row = await find();
  if (!row) {
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const since = new Date(Date.now() - 3600000).toISOString();
    try {
      await env.DB.prepare(`INSERT INTO feedback_submissions
        (id,user_id,request_id,payload_hash,brand_id,type,message,email,page_url,pathname,viewport,user_agent,
         screenshot_path,screenshot_sha256,screenshot_bytes,screenshot_capture_status,submission_state,created_at,updated_at)
        SELECT ?,id,?,?,?,?,?,email,?,?,?,?,?,?,?,?,?,?,? FROM users WHERE id = ?
          AND (SELECT count(*) FROM feedback_submissions WHERE user_id = ? AND created_at >= ?) < 20
        ON CONFLICT(user_id,request_id) DO NOTHING`)
        .bind(id, input.request_id, hash, brandId, input.type, payload.message, location.page_url, location.pathname,
          JSON.stringify(viewport), payload.user_agent, bytes ? `feedback/v1/${id}.png` : null,
          screenshotHash, bytes?.byteLength ?? null, captureStatus, bytes ? 'pending' : 'accepted', now, now,
          userId, userId, since).run();
    } catch {
      // A commit response can be lost. Never create another row/key to repair it.
      row = await find(); if (!row) return error('feedback_storage_unavailable', 503);
    }
    row ??= await find();
    if (!row) return error('feedback_rate_limited', 429);
  }
  if (row.payload_hash !== hash) return error('feedback_request_conflict', 409);
  if (row.submission_state === 'accepted') return receipt(row);
  if (!bytes || !row.screenshot_path) return error('feedback_attachment_pending', 503);
  const matches = (object: R2Object | null) => object?.size === bytes.byteLength &&
    object.customMetadata?.sha256 === screenshotHash && object.customMetadata?.feedbackId === row!.id;
  try {
    let object = await env.PRIVATE_MEDIA.head(row.screenshot_path);
    if (!object) {
      try {
        await env.PRIVATE_MEDIA.put(row.screenshot_path, bytes, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png', cacheControl: 'private, no-store' },
          customMetadata: { sha256: screenshotHash!, feedbackId: row.id },
        });
      } catch { /* Resolve the exact key below, including a lost put response. */ }
      object = await env.PRIVATE_MEDIA.head(row.screenshot_path);
    }
    if (!matches(object)) return error(object ? 'feedback_attachment_conflict' : 'feedback_attachment_pending', object ? 409 : 503);
    await env.DB.prepare(`UPDATE feedback_submissions SET submission_state = 'accepted', updated_at = ?
      WHERE id = ? AND user_id = ? AND payload_hash = ? AND submission_state = 'pending'`)
      .bind(new Date().toISOString(), row.id, userId, hash).run();
    row = await find();
    return row?.submission_state === 'accepted' ? receipt(row) : error('feedback_storage_unavailable', 503);
  } catch { return error('feedback_storage_unavailable', 503); }
}
function pagination(url: URL): { limit: number; offset: number } | Response {
  const limit = Number(url.searchParams.get('limit') ?? 100); const offset = Number(url.searchParams.get('offset') ?? 0);
  return Number.isSafeInteger(limit) && limit > 0 && limit <= 100 && Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000
    ? { limit, offset } : error('invalid_pagination');
}
function feedbackPayload(row: Feedback): Json {
  const { payload_hash: _hash, request_id: _request, screenshot_sha256: _sha, screenshot_bytes: _bytes,
    user_email, user_name, brand_name, ...publicRow } = row;
  return { ...publicRow, viewport: JSON.parse(row.viewport), user: { email: user_email ?? row.email, name: user_name ?? null },
    brand: row.brand_id ? { name: brand_name ?? null } : null };
}
async function adminRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const admin = await requireAdmin(request, env); if (admin instanceof Response) return admin;
  const params = pagination(url); if (params instanceof Response) return params;
  if (url.pathname === '/v1/admin/stats' && request.method === 'GET') {
    const row = await env.DB.prepare(`SELECT (SELECT count(*) FROM users) AS totalUsers,
      (SELECT count(*) FROM users WHERE updated_at >= ?) AS activeUsers,
      (SELECT count(*) FROM generated_images) AS totalImages`).bind(new Date(Date.now() - 30 * 86400000).toISOString()).first<Json>();
    const measured = await env.DB.prepare(`SELECT
      COUNT(CASE WHEN attempted_at IS NOT NULL THEN 1 END) AS inferenceAttempts,
      COUNT(CASE WHEN state='completed' THEN 1 END) AS totalUsageUnits,
      COUNT(CASE WHEN attempted_at IS NOT NULL AND estimated_micro_usd IS NULL THEN 1 END) AS unmeasuredInferenceAttempts,
      SUM(estimated_micro_usd)/1000000.0 AS estimatedImageCostUSD, AVG(latency_ms) AS averageImageInferenceMs
      FROM heavy_ai_candidates`).first<Json>();
    // Cost is a model-price estimate, not an invoice. Inference wall time is
    // neither CPU time nor every Edge request. Old ledgers are never imported.
    return json({ ...row, ...measured, totalCost: null, edgeRunCount: null, averageDurationMs: null,
      meteringStatus: 'image_ai_only', activeUsersBasis: 'profile_updated_last_30_days' });
  }
  if (url.pathname === '/v1/admin/users' && request.method === 'GET') {
    const result = await env.DB.prepare(`SELECT u.id,u.email,u.name,u.created_at,
      EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id = u.id) AS is_admin
      FROM users u ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(params.limit, params.offset).all<Json>();
    return json(result.results.map(row => ({ ...row, is_admin: row.is_admin === 1 })));
  }
  if (url.pathname === '/v1/admin/feedback' && request.method === 'GET') {
    const result = await env.DB.prepare(`SELECT f.*,u.email AS user_email,u.name AS user_name,b.name AS brand_name
      FROM feedback_submissions f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN brands b ON b.id = f.brand_id
      ORDER BY f.created_at DESC,f.id DESC LIMIT ? OFFSET ?`).bind(params.limit, params.offset).all<Feedback>();
    return json(result.results.map(feedbackPayload));
  }
  const match = url.pathname.match(/^\/v1\/admin\/feedback\/([^/]+)(\/screenshot)?$/);
  if (match && UUID.test(match[1])) {
    const row = await env.DB.prepare('SELECT * FROM feedback_submissions WHERE id = ?').bind(match[1]).first<Feedback>();
    if (!row) return error('not_found', 404);
    if (match[2] && request.method === 'GET') {
      if (row.submission_state !== 'accepted' || row.screenshot_path !== `feedback/v1/${row.id}.png`) return error('not_found', 404);
      const object = await env.PRIVATE_MEDIA.get(row.screenshot_path);
      if (!object || object.customMetadata?.sha256 !== row.screenshot_sha256 || object.customMetadata?.feedbackId !== row.id || object.size !== row.screenshot_bytes) return error('not_found', 404);
      if (!await env.DB.prepare('SELECT user_id FROM platform_admins WHERE user_id = ?').bind(admin).first()) return error('admin_required', 403);
      // No bearer in a query string or a shareable signed URL. Browser fetches
      // this endpoint with auth, then releases the resulting local blob URL.
      return new Response(object.body, { headers: { 'content-type': 'image/png',
        'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' } });
    }
    if (!match[2] && request.method === 'PATCH') {
      const input = await readJson(request); if (input instanceof Response) return input;
      if (Object.keys(input).some(k => !['status', 'admin_note', 'revision'].includes(k)) ||
        typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
        (input.status !== undefined && (typeof input.status !== 'string' || !['new','in_progress','done'].includes(input.status))) ||
        (input.admin_note !== undefined && input.admin_note !== null && !text(input.admin_note, 8000, true)) ||
        (input.status === undefined && input.admin_note === undefined)) return error('invalid_feedback_update');
      if (row.revision !== input.revision) return error('feedback_update_conflict', 409);
      const nextStatus = input.status ?? row.status; const now = new Date().toISOString();
      const result = await env.DB.prepare(`UPDATE feedback_submissions SET status = ?,admin_note = ?,
        resolved_at = ?,updated_at = ?,revision = revision + 1 WHERE id = ? AND revision = ?
        AND EXISTS(SELECT 1 FROM platform_admins WHERE user_id = ?)`)
        .bind(nextStatus, input.admin_note === undefined ? row.admin_note : input.admin_note,
          nextStatus === 'done' ? row.status === 'done' ? row.resolved_at : now : null, now, row.id, input.revision, admin).run();
      if (result.meta.changes !== 1) return error('feedback_update_conflict', 409);
      const updated = await env.DB.prepare(`SELECT f.*,u.email AS user_email,u.name AS user_name,b.name AS brand_name
        FROM feedback_submissions f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN brands b ON b.id = f.brand_id
        WHERE f.id = ?`).bind(row.id).first<Feedback>();
      return updated ? json(feedbackPayload(updated)) : error('feedback_storage_unavailable', 503);
    }
  }
  if (url.pathname === '/v1/admin/announcements' && request.method === 'POST') {
    const input = await readJson(request); if (input instanceof Response) return input;
    if (!text(input.request_id, 36) || !UUID.test(input.request_id) || !text(input.title, 200) || !text(input.content, 8000) ||
      typeof input.type !== 'string' || !['info','warning','maintenance'].includes(input.type)) return error('invalid_announcement');
    const find = () => env.DB.prepare('SELECT id,title,content,type,created_at FROM admin_announcements WHERE author_id = ? AND request_id = ?')
      .bind(admin, input.request_id).first<Json>();
    const title = input.title.trim(); const content = input.content.trim();
    let row = await find();
    if (!row) {
      try {
        await env.DB.prepare(`INSERT INTO admin_announcements (id,author_id,request_id,title,content,type,created_at)
          SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM platform_admins WHERE user_id = ?)
          ON CONFLICT(author_id,request_id) DO NOTHING`)
          .bind(crypto.randomUUID(), admin, input.request_id, title, content, input.type, new Date().toISOString(), admin).run();
      } catch { /* Read the same request before reporting an unconfirmed commit. */ }
      row = await find();
    }
    if (!row) return error('announcement_storage_unavailable', 503);
    if (row.title !== title || row.content !== content || row.type !== input.type) return error('announcement_request_conflict', 409);
    return json(row);
  }
  return error('not_found', 404);
}

export async function handleFeedbackAdminRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/feedback' && url.pathname !== '/v1/announcements' && !url.pathname.startsWith('/v1/admin/')) return null;
  try {
    if (url.pathname === '/v1/feedback') return request.method === 'POST' ? await submit(request, env) : error('method_not_allowed', 405);
    if (url.pathname === '/v1/announcements') {
      const id = await principal(request, env); if (id instanceof Response) return id;
      if (request.method !== 'GET') return error('method_not_allowed', 405);
      const params = pagination(url); if (params instanceof Response) return params;
      const result = await env.DB.prepare('SELECT id,title,content,type,created_at FROM admin_announcements ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?')
        .bind(params.limit, params.offset).all();
      return json(result.results);
    }
    return await adminRoute(request, env, url);
  } catch { return error('admin_storage_unavailable', 503); }
}
