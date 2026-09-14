import type { Env } from './index.ts';
import { requireBrandRole } from './core.ts';
import { principal } from './domain.ts';
import { canonical,isRecord,raster } from './image-ai-contracts.ts';
import { PROTECTED_IMAGE_EDIT_MODE,protectedImageSaveRequestId } from '../../../src/lib/protectedImageEditContract.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_METADATA_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
type Row = { id: string; user_id: string; brand_id: string; job_id?: string; storage_path?: string; input_params?: string; status?: string; feature_type?: string; created_at?: string };
type Params = { title: string; prompt: string | null; metadata: Record<string,unknown>; canvasProjectId: string | null;
  sourceJobId: string | null; contentType: string; checksum: string; imageAI?: Record<string,unknown>;
  contentBytes?: number; parentImageId?: string; generation?: number; modelUsed?: string };

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
function fail(error: string, status: number): Response { return reply({ success: false, error }, status); }
function success(jobId: string, imageId: string, storagePath: string, metadata?: Record<string,unknown>): Response {
  return reply({ success: true, remoteSaveStage: 'completed', remoteCleanupStatus: 'none', remote: { jobId, imageId, storagePath },...(metadata ? { metadata } : {}) });
}
function text(value: unknown, max: number): value is string {
  // eslint-disable-next-line no-control-regex -- control characters are invalid in workspace text.
  return typeof value === 'string' && value.length <= max && !/[\u0000\u007f]/.test(value);
}

// Bound bytes while streaming, including requests without Content-Length.
async function readInput(request: Request, limit: number): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length')) > limit || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function imageBytes(data: string, max: number): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2].length > Math.ceil(max / 3) * 4) return null;
  try {
    const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
    if (!bytes.length || bytes.length > max) return null;
    const starts = (expected: number[]) => expected.every((n, i) => bytes[i] === n);
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    const valid = match[1] === 'image/png' ? starts([137, 80, 78, 71, 13, 10, 26, 10])
      : match[1] === 'image/jpeg' ? starts([255, 216, 255])
      : match[1] === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
      : ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
    return valid ? { bytes, contentType: match[1] } : null;
  } catch { return null; }
}

async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
}

async function imageAISource(env: Env, value: unknown, requestId: string, owner: string, brandId: string) {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId) ||
      !Number.isSafeInteger(value.candidateIndex) || Number(value.candidateIndex) < 0 || Number(value.candidateIndex) > 3 ||
      await protectedImageSaveRequestId(value.requestId,Number(value.candidateIndex)) !== requestId) return null;
  const row = await env.DB.prepare(`SELECT r.job_id,r.model,r.input_metadata,c.image_id FROM heavy_ai_requests r
    JOIN heavy_ai_candidates c ON c.request_id=r.request_id WHERE r.request_id=? AND r.user_id=? AND r.brand_id=?
    AND r.action='edit-image' AND r.state='completed' AND c.candidate_index=? AND c.state='completed'`)
    .bind(value.requestId,owner,brandId,value.candidateIndex).first<{ job_id: string; model: string; input_metadata: string; image_id: string }>();
  if (!row) return null;
  const input = JSON.parse(row.input_metadata); const plan = input.metadata?.protectedEdit;
  if (!isRecord(plan) || plan.mode !== PROTECTED_IMAGE_EDIT_MODE) return null;
  return { row,input,plan,requestId:value.requestId,candidateIndex:Number(value.candidateIndex) };
}

function exactWorkspaceObject(object: R2Object | null,job: Row,params: Params): boolean {
  if (!object || object.customMetadata?.sha256 !== params.checksum || (params.contentBytes !== undefined && object.size !== params.contentBytes)) return false;
  const metadata = object.customMetadata;
  // Legacy completed workspace objects had only sha256. New writes always bind
  // object ownership and request identity; never adopt a foreign collision.
  return !metadata.workspaceRequestId && !params.imageAI ||
    metadata.workspaceRequestId === job.id.slice(3) && metadata.imageId === job.id && metadata.userId === job.user_id && metadata.brandId === job.brand_id;
}

async function commitWorkspaceImage(env: Env,job: Row,params: Params): Promise<void> {
  const path = `generated-images/${job.id}`;
  const imageMetadata = JSON.stringify({ ...params.metadata,title:params.title,localWorkspaceArtifact:true,
    remoteWorkspaceArtifact:true,sourceJobId:params.sourceJobId,storageProvider:'cloudflare_r2',
    ...(params.imageAI ? { contentSha256:params.checksum,contentBytes:params.contentBytes } : {}) });
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO generated_images
      (id,job_id,brand_id,user_id,storage_path,prompt,feature_type,model_used,generation_params,metadata,created_at,parent_image_id,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(job.id,job.id,job.brand_id,job.user_id,path,params.prompt,job.feature_type,params.modelUsed ?? 'marketing-workspace-artifact',
        JSON.stringify({ canvasProjectId:params.canvasProjectId,sourceJobId:params.sourceJobId,...(params.imageAI ? { imageAI:params.imageAI } : {}) }),
        imageMetadata,job.created_at,params.parentImageId ?? null,params.generation ?? 1),
    env.DB.prepare(`UPDATE generation_jobs SET status='completed',completed_at=?,error_message=NULL WHERE id=? AND user_id=?
      AND EXISTS(SELECT 1 FROM generated_images WHERE id=? AND job_id=? AND user_id=? AND brand_id=? AND storage_path=?)`)
      .bind(new Date().toISOString(),job.id,job.user_id,job.id,job.id,job.user_id,job.brand_id,path),
  ]);
}

async function finishProtectedBatch(request: Request,env: Env,job: Row,params: Params): Promise<void> {
  if (!params.imageAI) return;
  const editor = await requireBrandRole(request,env,job.brand_id,'editor');
  if (editor instanceof Response || editor !== job.user_id) return;
  const requestId = String(params.imageAI.requestId);
  const source = await env.DB.prepare('SELECT job_id,candidate_count FROM heavy_ai_requests WHERE request_id=? AND user_id=? AND brand_id=? AND state=\'completed\'')
    .bind(requestId,job.user_id,job.brand_id).first<{ job_id: string; candidate_count: number }>();
  if (!source) return;
  for (let index = 0; index < source.candidate_count; index++) {
    const id = `wa-${await protectedImageSaveRequestId(requestId,index)}`;
    const finalJob = await env.DB.prepare('SELECT id,user_id,brand_id,input_params,status FROM generation_jobs WHERE id=?').bind(id).first<Row>();
    if (!finalJob || finalJob.user_id !== job.user_id || finalJob.brand_id !== job.brand_id || finalJob.status !== 'completed') return;
    const finalParams = JSON.parse(finalJob.input_params ?? '{}') as Params;
    if (finalParams.imageAI?.requestId !== requestId || finalParams.imageAI?.candidateIndex !== index ||
        !exactWorkspaceObject(await env.PRIVATE_MEDIA.head(`generated-images/${id}`),finalJob,finalParams)) return;
    if (!await env.DB.prepare('SELECT id FROM generated_images WHERE id=? AND job_id=? AND user_id=? AND brand_id=? AND storage_path=?')
      .bind(id,id,job.user_id,job.brand_id,`generated-images/${id}`).first()) return;
  }
  const finalEditor = await requireBrandRole(request,env,job.brand_id,'editor');
  if (finalEditor instanceof Response || finalEditor !== job.user_id) return;
  await env.DB.prepare("UPDATE generation_jobs SET status='completed',error_message=NULL,completed_at=? WHERE id=? AND user_id=?")
    .bind(new Date().toISOString(),source.job_id,job.user_id).run();
}

/** Read or repair this exact workspace save, without receiving image bytes or
 * calling AI. Pending saves need current editor rights; completed reads do not. */
export async function readWorkspaceArtifact(request: Request,env: Env,requestId: string): Promise<Response> {
  if (!REQUEST_ID.test(requestId)) return fail('workspace_artifact_not_found',404);
  const owner = await principal(request,env); if (owner instanceof Response) return owner;
  const id = `wa-${requestId.toLowerCase()}`;
  const job = await env.DB.prepare('SELECT id,user_id,brand_id,input_params,status,feature_type,created_at FROM generation_jobs WHERE id=?').bind(id).first<Row>();
  if (!job || job.user_id !== owner) return fail('workspace_artifact_not_found',404);
  const access = await requireBrandRole(request,env,job.brand_id,'viewer'); if (access instanceof Response) return access;
  let params: Params & { workspaceFingerprint?: string };
  try { params = JSON.parse(job.input_params ?? '{}'); } catch { return fail('workspace_artifact_not_found',404); }
  if (!params.workspaceFingerprint || !/^[0-9a-f]{64}$/.test(params.checksum) || !isRecord(params.metadata)) return fail('workspace_artifact_not_found',404);
  if (params.imageAI && !await imageAISource(env,params.imageAI,requestId,owner,job.brand_id)) return fail('workspace_ai_source_unavailable',410);
  const path = `generated-images/${id}`; const object = await env.PRIVATE_MEDIA.head(path);
  if (!object) return fail(job.status === 'completed' ? 'workspace_content_unavailable' : 'workspace_save_pending',job.status === 'completed' ? 410 : 409);
  if (!exactWorkspaceObject(object,job,params)) return fail('workspace_content_identity_mismatch',410);
  if (job.status !== 'completed') {
    const editor = await requireBrandRole(request,env,job.brand_id,'editor'); if (editor instanceof Response) return editor;
    await commitWorkspaceImage(env,job,params);
  }
  const row = await env.DB.prepare('SELECT id,job_id,user_id,brand_id,storage_path FROM generated_images WHERE id=?').bind(id).first<Row>();
  if (!row || row.user_id !== owner || row.brand_id !== job.brand_id || row.job_id !== id || row.storage_path !== path) return fail('workspace_readback_unavailable',503);
  await finishProtectedBatch(request,env,job,params);
  const finalOwner = await requireBrandRole(request,env,job.brand_id,'viewer'); if (finalOwner instanceof Response) return finalOwner;
  if (finalOwner !== owner) return fail('workspace_artifact_not_found',404);
  return success(id,id,path,params.imageAI ? params.metadata : undefined);
}

/** Save a browser result without contacting Supabase or fetching arbitrary URLs. */
export async function saveWorkspaceArtifact(request: Request, env: Env): Promise<Response> {
  if (!/^Bearer\s+\S+$/i.test(request.headers.get('authorization') ?? '')) return fail('unauthorized', 401);
  const maxBytes = Math.min(MAX_IMAGE_BYTES, Number(env.MAX_MEDIA_BYTES) > 0 ? Number(env.MAX_MEDIA_BYTES) : MAX_IMAGE_BYTES);
  const input = await readInput(request, Math.ceil(maxBytes / 3) * 4 + MAX_METADATA_BYTES + 64 * 1024);
  if (!input) return fail('invalid_or_oversized_workspace_artifact', 400);
  const { brandId, featureType, title, imageUrl, requestId } = input;
  if (!text(brandId, 128) || !ID.test(brandId) || !text(featureType, 256) || !featureType ||
      !text(title, 512) || !title || !text(requestId, 36) || !REQUEST_ID.test(requestId)) {
    return fail('invalid_workspace_artifact', 400);
  }
  const owner = await requireBrandRole(request, env, brandId, 'editor');
  if (owner instanceof Response) return owner;
  const source = input.sourceStoragePath;
  if (source !== undefined && source !== null) {
    const match = typeof source === 'string' ? /^generated-images\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(source) : null;
    if (!match) return fail('invalid_source_storage_path', 400);
    const row = await env.DB.prepare('SELECT id, job_id, user_id, brand_id, storage_path FROM generated_images WHERE id = ? AND user_id = ? AND brand_id = ?')
      .bind(match[1], owner, brandId).first<Row>();
    if (!row || row.storage_path !== source || !row.job_id) return fail('source_artifact_not_found', 404);
    const object = await env.PRIVATE_MEDIA.head(source as string);
    if (!object) return fail('source_content_not_found', 404);
    return success(row.job_id, row.id, source as string);
  }
  const prompt = input.prompt ?? null;
  const metadata = input.metadata ?? {};
  if ((prompt !== null && !text(prompt, 20000)) || !metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      new TextEncoder().encode(JSON.stringify(metadata)).length > MAX_METADATA_BYTES || typeof imageUrl !== 'string') {
    return fail('invalid_workspace_artifact', 400);
  }
  for (const field of ['canvasProjectId', 'sourceJobId']) {
    if (input[field] !== undefined && input[field] !== null && (!text(input[field], 128) || !ID.test(input[field] as string))) {
      return fail('invalid_workspace_artifact', 400);
    }
  }
  const image = imageBytes(imageUrl, maxBytes);
  if (!image) return fail('invalid_or_oversized_workspace_image', 400);
  const checksum = await digest(image.bytes);
  const ai = input.imageAI === undefined ? null : await imageAISource(env,input.imageAI,requestId,owner,brandId);
  if (input.imageAI !== undefined && !ai) return fail('workspace_ai_source_unavailable',409);
  if (ai) {
    const dimensions = raster(image.bytes);
    if (!dimensions || dimensions.contentType !== 'image/png' || dimensions.width !== ai.plan.sourceWidth || dimensions.height !== ai.plan.sourceHeight ||
        input.sourceJobId !== ai.row.job_id || featureType !== ai.input.featureType) return fail('workspace_ai_final_contract_mismatch',409);
  }
  const params: Params = {
    title, prompt, metadata, canvasProjectId: input.canvasProjectId ?? null,
    sourceJobId: input.sourceJobId ?? null, contentType: image.contentType, checksum,
    ...(ai ? { imageAI:{ requestId:ai.requestId,candidateIndex:ai.candidateIndex },contentBytes:image.bytes.length,
      parentImageId:ai.row.image_id,generation:ai.input.generation,modelUsed:ai.row.model,
      metadata:{ ...(metadata as Record<string,unknown>),protectedEdit:ai.plan,artifactRole:'protected-edit-final',
        protectedRegionComposited:true,maskApplied:true,provider:'workers_ai',backendProvider:'cloudflare-workers-ai',providerModel:ai.row.model,
        providerRequestId:ai.requestId,providerJobId:ai.row.job_id,providerImageId:ai.row.image_id,
        providerStoragePath:`generated-images/${ai.row.image_id}`,batchId:ai.row.job_id,candidateIndex:ai.candidateIndex } } : {}),
  } as Params;
  if (new TextEncoder().encode(JSON.stringify(params.metadata)).length > MAX_METADATA_BYTES) return fail('invalid_workspace_artifact',400);
  const fingerprint = await digest(new TextEncoder().encode(ai ? canonical({ brandId,featureType,...params }) : JSON.stringify({ brandId, featureType, ...params })));
  const id = `wa-${requestId.toLowerCase()}`;
  const path = `generated-images/${id}`;
  const now = new Date().toISOString();
  // The existing job row is the resumable claim. A repeated request ID may only
  // continue the same owner's identical content; it cannot overwrite another save.
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO generation_jobs
      (id, brand_id, user_id, feature_type, input_params, optimized_prompt, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(id, brandId, owner, featureType, JSON.stringify({ ...params, workspaceFingerprint: fingerprint }), prompt, now).run();
  } catch { return fail('workspace_metadata_unavailable', 503); }
  const job = await env.DB.prepare('SELECT id, user_id, brand_id, input_params, status, feature_type, created_at FROM generation_jobs WHERE id = ?').bind(id).first<Row>();
  let storedFingerprint: unknown;
  try { storedFingerprint = JSON.parse(job?.input_params ?? '{}').workspaceFingerprint; } catch { /* fail closed */ }
  if (!job || job.user_id !== owner || job.brand_id !== brandId || storedFingerprint !== fingerprint) return fail('workspace_request_conflict', 409);
  const readImage = () => env.DB.prepare('SELECT id, job_id, user_id, brand_id, storage_path FROM generated_images WHERE id = ?').bind(id).first<Row>();
  const existing = await readImage();
  if (existing && (existing.user_id !== owner || existing.brand_id !== brandId || existing.job_id !== id || existing.storage_path !== path)) {
    return fail('workspace_request_conflict', 409);
  }
  const stored = await env.PRIVATE_MEDIA.head(path);
  if (stored && !exactWorkspaceObject(stored,job,params)) return fail('workspace_content_identity_mismatch',409);
  if (existing && job.status === 'completed' && exactWorkspaceObject(stored,job,params)) return await readWorkspaceArtifact(request,env,requestId);
  const beforeMediaOwner = await requireBrandRole(request,env,brandId,'editor'); if (beforeMediaOwner instanceof Response) return beforeMediaOwner;
  if (beforeMediaOwner !== owner) return fail('workspace_artifact_not_found',404);
  try {
    if (!stored) await env.PRIVATE_MEDIA.put(path, image.bytes, { httpMetadata: { contentType: image.contentType },
      customMetadata: { sha256: checksum,workspaceRequestId:requestId.toLowerCase(),imageId:id,userId:owner,brandId },onlyIf:{ etagDoesNotMatch:'*' } });
  } catch { return fail('workspace_media_unavailable', 502); }
  if (!exactWorkspaceObject(await env.PRIVATE_MEDIA.head(path),job,params)) return fail('workspace_content_identity_mismatch',409);
  const afterMediaOwner = await requireBrandRole(request,env,brandId,'editor'); if (afterMediaOwner instanceof Response) return afterMediaOwner;
  if (afterMediaOwner !== owner) return fail('workspace_artifact_not_found',404);
  try {
    await commitWorkspaceImage(env,job,params);
  } catch {
    // A lost D1 response is not proof of rollback. Read this exact save back;
    // never delete the object or invent a second save after an uncertain write.
    try {
      const readback = await readWorkspaceArtifact(request,env,requestId);
      if (readback.ok) return readback;
    } catch { /* retained pending job and deterministic object key permit retry */ }
    return fail('workspace_metadata_unavailable', 503);
  }
  return await readWorkspaceArtifact(request,env,requestId);
}
