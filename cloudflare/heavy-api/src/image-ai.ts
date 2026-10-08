import type { Env } from './index.ts';
import { principal } from './domain.ts';
import { requireBrandRole, handleMediaReadGateway } from './core.ts';
import { IMAGE_MODEL, IMAGE_ACTIONS, ImageInputError, boundedImageJSON, decodeImage, imageEstimate,
  isRecord, modelMultipart, normalizedImageRequestDigest, parseImageInput, sha256, type AuthorizedSourceAsset,
  type ImageAction, type ImageInput, type Json } from './image-ai-contracts.ts';
import { CLAUDE_TEXT_ACTIONS, ClaudeTextError, claudeConfigured, runClaudeTextAction, type ClaudeTextAction } from './claude-text.ts';
import { MAX_OPENAI_IMAGE_TIMEOUT_MS, OpenAIImageError, OPENAI_IMAGE_BACKEND, OPENAI_IMAGE_EDIT_MODELS, OPENAI_IMAGE_MODEL_LABELS, OPENAI_IMAGE_MODELS, OPENAI_IMAGE_PROVIDER, openAIExpectedDimensions, openAIModelForEndpoint, resolveOpenAIModel, runOpenAIImage } from './openai-image.ts';
import { CLAUDE_TEXT_MODELS, defaultClaudeModel } from './claude-text.ts';
import { prepareHeavyGeneration, recordHeavyRequestAttestation, recordHeavyTermsAcceptance, resolveHeavyEntitlement, resolveHeavyEntitlementStatus, resolveHeavyGenerationAccess,
  type HeavyEntitlementReason } from './heavy-entitlement.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MODEL_TIMEOUT_MS = 45_000;
const MAX_MODEL_TIMEOUT_MS = 90_000;
const modelTimeoutMs = (env: Env, provider: ProviderKind) => {
  const value = Number(env.AI_IMAGE_TIMEOUT_MS);
  const maximum = provider === 'openai' ? MAX_OPENAI_IMAGE_TIMEOUT_MS : MAX_MODEL_TIMEOUT_MS;
  return Number.isSafeInteger(value) && value >= DEFAULT_MODEL_TIMEOUT_MS && value <= MAX_OPENAI_IMAGE_TIMEOUT_MS
    ? Math.min(value,maximum)
    : DEFAULT_MODEL_TIMEOUT_MS;
};
const STALE_MS = 4 * DEFAULT_MODEL_TIMEOUT_MS + 30_000;
// The 210s stale window covers one 180s OpenAI observation plus 30s grace.
// Serial candidates must each get that window; Workers AI retains its current
// request-age behavior. Admission and reconciliation use the same clock.
const activeSinceSQL = `CASE WHEN json_extract(r.input_metadata,'$.provider')='openai'
  THEN COALESCE((SELECT MAX(c.attempted_at) FROM heavy_ai_candidates c WHERE c.request_id=r.request_id),r.created_at)
  ELSE r.created_at END`;
type Row = { request_id: string; user_id: string; brand_id: string; action: ImageAction; fingerprint: string;
  execution_id: string; model: string; job_id: string; input_metadata: string; quota_units: number; candidate_count: number;
  reserved_centi_neurons: number; terms_acceptance_id: string | null; rights_attestation_id: string | null;
  request_binding: string | null; preparation_id: string | null; utc_month: string; utc_day: string; state: string; error_code: string | null;
  created_at: string; updated_at: string };
type Output = { request_id: string; candidate_index: number; image_id: string; state: string; descriptor: string; seed: number;
  content_type: string | null; content_bytes: number | null; sha256: string | null; width: number | null; height: number | null;
  estimated_micro_usd: number | null; estimated_neurons: number | null; latency_ms: number | null; attempted_at: string | null; error_code: string | null };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
const fail = (error: string, status: number) => reply({ success: false, error }, status);
const read = (env: Env, id: string) => env.DB.prepare('SELECT * FROM heavy_ai_requests WHERE request_id=?').bind(id).first<Row>();
const outputs = async (env: Env, id: string) => (await env.DB.prepare('SELECT * FROM heavy_ai_candidates WHERE request_id=? ORDER BY candidate_index').bind(id).all<Output>()).results;
const limit = (value: string | undefined, fallback: number, max: number) => {
  const number = Number(value); return value !== undefined && Number.isSafeInteger(number) && number >= 0 && number <= max ? number : fallback;
};
const limits = (env: Env) => ({ monthly: limit(env.AI_MONTHLY_IMAGE_UNITS, 25, 10000), accountMonthly: limit(env.AI_ACCOUNT_MONTHLY_IMAGE_UNITS ?? env.AI_MONTHLY_IMAGE_UNITS, 25, 10000), daily: limit(env.AI_DAILY_IMAGE_UNITS, 100, 10000),
  dailyNeuronCenti: limit(env.AI_DAILY_ESTIMATED_NEURONS, 5000, 1000000) * 100, concurrent: 2 });
type ProviderKind = 'workers_ai' | 'openai';
type ProviderConfig = { provider: ProviderKind; backendProvider: string; model: string };
type SourceCandidate = { id?: string; storagePath?: string; revision?: number | string; contentDigest?: string };

// OpenAI is the server default; Workers AI remains an explicit fallback only.
const configuredProvider = (env: Env): ProviderKind => env.AI_IMAGE_PROVIDER?.trim() === 'workers_ai' ? 'workers_ai' : 'openai';
const providerConfig = (env: Env, action: ImageAction, body: Json): ProviderConfig => {
  const provider = configuredProvider(env);
  const hasReferences = action === 'model-matrix'
    ? Boolean(body.imageUrl || body.modelReferenceImageUrl)
    : action === 'generate-image' && Array.isArray(body.imageUrls) && body.imageUrls.length > 0;
  const effectiveAction: ImageAction = action === 'edit-image' || hasReferences ? 'edit-image' : 'generate-image';
  const requested = typeof body.generationProvider === 'string' ? body.generationProvider.trim() : '';
  if (requested && !['workers_ai', 'openai'].includes(requested)) {
    throw new ImageInputError('image_provider_not_supported', 422);
  }
  if (requested && requested !== provider) throw new ImageInputError('image_provider_not_enabled', 422);
  if (provider === OPENAI_IMAGE_PROVIDER) {
    try {
      // An explicit generationModel must be supported; the settings-screen choice (preferredImageModel) falls back to the default.
      const explicit = body.generationModel ?? body.providerModel;
      const preferred = typeof body.preferredImageModel === 'string' ? body.preferredImageModel.trim() : '';
      const model = explicit ? resolveOpenAIModel(env, effectiveAction, explicit)
        : openAIModelForEndpoint(env, effectiveAction === 'edit-image', preferred || null);
      return { provider, backendProvider: OPENAI_IMAGE_BACKEND, model };
    } catch (error) {
      if (error instanceof Error && error.message === 'openai_image_model_not_supported') {
        throw new ImageInputError('image_model_not_supported', 422);
      }
      throw error;
    }
  }
  const requestedModel = body.generationModel ?? body.providerModel;
  if (requestedModel && requestedModel !== IMAGE_MODEL) throw new ImageInputError('image_model_not_supported', 422);
  return { provider, backendProvider: 'cloudflare-workers-ai', model: IMAGE_MODEL };
};

const sourceDigest = (metadata: unknown, candidateDigest: unknown): string | null => {
  const fromCandidate = typeof candidateDigest === 'string' ? candidateDigest.trim().toLowerCase() : '';
  if (/^[0-9a-f]{64}$/.test(fromCandidate)) return fromCandidate;
  if (!isRecord(metadata)) return null;
  for (const key of ['sha256', 'contentDigest', 'content_digest', 'contentSha256']) {
    const value = metadata[key];
    if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value.trim())) return value.trim().toLowerCase();
  }
  return null;
};

const sourceCandidates = (body: Json): SourceCandidate[] => {
  const values: unknown[] = [];
  for (const key of ['authorizedSourceAssets', 'sourceAssets', 'sourceAssetRefs']) {
    if (Array.isArray(body[key])) values.push(...body[key]);
  }
  const readbackValues = [body.sourceReadback,
    isRecord(body.generationIntent) ? body.generationIntent.sourceReadback : null]
    .filter(isRecord);
  for (const value of readbackValues) {
    const id = [value.sourceImageId, value.imageId, value.assetId].find(item => typeof item === 'string' && item.trim());
    const storagePath = [value.sourceStoragePath, value.storagePath].find(item => typeof item === 'string' && item.trim());
    if (id || storagePath) values.push({
      id: typeof id === 'string' ? id : undefined,
      storagePath: typeof storagePath === 'string' ? storagePath : undefined,
      revision: value.sourceRevision ?? value.revision,
      contentDigest: value.sourceContentDigest ?? value.contentDigest,
    });
  }
  if (!values.length) return [];
  return values.map((value): SourceCandidate => {
    if (!isRecord(value)) throw new ImageInputError('invalid_authorized_source_asset', 422);
    const id = [value.id, value.assetId, value.sourceAssetId, value.sourceImageId, value.imageId]
      .find(item => typeof item === 'string' && item.trim());
    const storagePath = [value.storagePath, value.sourceStoragePath]
      .find(item => typeof item === 'string' && item.trim());
    const revision = value.revision ?? value.sourceRevision;
    const contentDigest = value.contentDigest ?? value.content_digest ?? value.sha256 ?? value.contentSha256;
    if (id !== undefined && typeof id !== 'string') throw new ImageInputError('invalid_authorized_source_asset', 422);
    if (storagePath !== undefined && typeof storagePath !== 'string') throw new ImageInputError('invalid_authorized_source_asset', 422);
    if (!id && !storagePath) throw new ImageInputError('invalid_authorized_source_asset', 422);
    if (revision !== undefined && typeof revision !== 'string' && !(typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0)) {
      throw new ImageInputError('invalid_authorized_source_asset', 422);
    }
    if (contentDigest !== undefined && (typeof contentDigest !== 'string' || !/^[0-9a-f]{64}$/i.test(contentDigest))) {
      throw new ImageInputError('invalid_authorized_source_asset', 422);
    }
    return { id: typeof id === 'string' ? id.trim() : undefined, storagePath: typeof storagePath === 'string' ? storagePath.trim() : undefined,
      revision: revision as number | string | undefined, contentDigest: typeof contentDigest === 'string' ? contentDigest.toLowerCase() : undefined };
  });
};

/** Resolve source identities from Heavy-owned rows, never from caller claims. */
async function resolveAuthorizedSourceAssets(env: Env, userId: string, brandId: string, body: Json): Promise<AuthorizedSourceAsset[]> {
  const candidates = sourceCandidates(body);
  const resolved: AuthorizedSourceAsset[] = [];
  for (const candidate of candidates) {
    const row = await env.DB.prepare(`SELECT gi.id,gi.version,gi.storage_path,gi.metadata,c.sha256 AS candidate_sha256
      FROM generated_images gi LEFT JOIN heavy_ai_candidates c ON c.image_id=gi.id
      WHERE gi.user_id=? AND gi.brand_id=? AND (gi.id=? OR gi.storage_path=?) LIMIT 1`)
      .bind(userId, brandId, candidate.id ?? '', candidate.storagePath ?? '').first<{ id: string; version: number; storage_path: string; metadata: string | null; candidate_sha256: string | null }>();
    if (!row) throw new ImageInputError('authorized_source_asset_not_found', 409);
    let metadata: unknown = null;
    try { metadata = row.metadata ? JSON.parse(row.metadata) : null; } catch { metadata = null; }
    let contentDigest = sourceDigest(metadata, row.candidate_sha256);
    // Older ordinary workspace uploads stored their server checksum in R2,
    // but not in generated_images metadata. Resolve only the owned row's path;
    // never trust a client checksum or fetch a caller-selected remote URL.
    if (!contentDigest && row.storage_path.startsWith('generated-images/')) {
      const object = await env.PRIVATE_MEDIA.head(row.storage_path);
      contentDigest = sourceDigest(null, object?.customMetadata?.sha256);
    }
    if (!contentDigest) throw new ImageInputError('authorized_source_asset_digest_unavailable', 409);
    if (candidate.revision !== undefined && String(candidate.revision) !== String(row.version)) {
      throw new ImageInputError('authorized_source_asset_revision_mismatch', 409);
    }
    if (candidate.contentDigest && candidate.contentDigest !== contentDigest) {
      throw new ImageInputError('authorized_source_asset_digest_mismatch', 409);
    }
    resolved.push({ id: row.id, revision: row.version, contentDigest });
  }
  const deduped = new Map(resolved.map(asset => [`${asset.id}:${asset.revision}:${asset.contentDigest}`, asset]));
  return [...deduped.values()];
}

async function normalizedRequest(env: Env, userId: string, action: ImageAction, body: Json, input: ImageInput, provider: ProviderConfig) {
  const sourceAssets = await resolveAuthorizedSourceAssets(env, userId, input.brandId, body);
  return normalizedImageRequestDigest(action, body, input, provider, sourceAssets);
}

const entitlementFailureStatus = (reason: HeavyEntitlementReason): number => (
  reason.includes('unconfigured') || reason.includes('unavailable') ? 503 : 403
);
const enabled = (env: Env, action: string, provider: ProviderKind) => env.AI_IMAGE_ENABLED === 'true' &&
  (provider === 'openai' ? true : !!env.AI) &&
  (env.AI_IMAGE_ALLOWED_ACTIONS ?? '').split(',').map(v => v.trim()).includes(action);

async function canContinue(request: Request, env: Env, row: Row, enforceEntitlement = false): Promise<Response | null> {
  const owner = await requireBrandRole(request, env, row.brand_id, 'editor');
  if (owner instanceof Response) return owner;
  if (owner !== row.user_id || !await read(env,row.request_id)) return fail('image_request_not_found',404);
  // `requireBrandRole` above is the generation authorization boundary.  Do
  // not re-introduce the retired terms/rights ceremony during a later storage
  // or readback step; those checks made a valid login-only job unreadable.
  void enforceEntitlement;
  return null;
}

function rowNormalizedInput(row: Row): Json | undefined {
  try {
    const parsed: unknown = JSON.parse(row.input_metadata);
    return isRecord(parsed) && isRecord(parsed.normalizedInput) ? parsed.normalizedInput : undefined;
  } catch {
    return undefined;
  }
}

async function rowEntitlement(env: Env, row: Row) {
  return resolveHeavyGenerationAccess({
    userId: row.user_id,
    brandId: row.brand_id,
    action: row.action,
    requestId: row.request_id,
    inputDigest: row.fingerprint,
    normalizedInput: rowNormalizedInput(row),
    preparationId: row.preparation_id ?? undefined,
  });
}

/** Reconcile only this attempt's exact immutable object and SQL rows. No AI call. */
async function commitStoredCandidate(env: Env, row: Row, output: Output): Promise<boolean> {
  if (!output.sha256 || !output.content_type || !output.content_bytes) return false;
  const path = `generated-images/${output.image_id}`;
  const object = await env.PRIVATE_MEDIA.head(path);
  if (!object || object.size !== output.content_bytes || object.customMetadata?.sha256 !== output.sha256 ||
      object.customMetadata?.requestId !== row.request_id || object.customMetadata?.imageId !== output.image_id) return false;
  const input = JSON.parse(row.input_metadata) as Json;
  const descriptor = JSON.parse(output.descriptor) as Json;
  const provider = input.provider === 'openai' ? 'openai' : 'workers_ai';
  const backendProvider = typeof input.backendProvider === 'string' ? input.backendProvider :
    provider === 'openai' ? OPENAI_IMAGE_BACKEND : 'cloudflare-workers-ai';
  const metadata = JSON.stringify({ ...(input.metadata as Json), ...descriptor, provider,
    ...(isRecord((input.metadata as Json).protectedEdit) ? { artifactRole:'provider-intermediate',requiresProtectedComposite:true } : {}),
    feature: input.featureType, source: row.action, bodyTypes: [descriptor.bodyType].filter(Boolean), ageGroups: [descriptor.ageGroup].filter(Boolean),
    backendProvider, providerModel: row.model, requestId: row.request_id,
    storageProvider: 'cloudflare_r2', sha256: output.sha256, contentBytes: output.content_bytes,
    inputImageCount: input.inputImageCount, referenceDimensions: input.referenceDimensions,
    sourceMetadataVersion: 1, persistenceStatus: 'completed' });
  // Revalidate immediately before the durable D1 commit.  A receipt/readback
  // retry must not adopt a stored object after Heavy entitlement has changed.
  const entitlement = await rowEntitlement(env, row);
  if (!entitlement.allowed) return false;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO generated_images
      (id,job_id,brand_id,user_id,storage_path,version,parent_image_id,prompt,feature_type,model_used,generation_params,metadata,created_at)
      SELECT ?,job_id,brand_id,user_id,?,?,?,?,?,?,?,?,created_at FROM heavy_ai_requests
      WHERE request_id=? AND user_id=?`)
      .bind(output.image_id,path,input.generation,input.parentImageId,input.prompt,input.featureType,row.model,
        JSON.stringify({ width: output.width, height: output.height, seed: output.seed, candidateIndex: output.candidate_index }),metadata,row.request_id,row.user_id),
    env.DB.prepare(`UPDATE heavy_ai_candidates SET state='completed',error_code=NULL WHERE request_id=? AND candidate_index=?
      AND EXISTS(SELECT 1 FROM generated_images WHERE id=? AND user_id=? AND brand_id=? AND storage_path=? AND job_id=?)`)
      .bind(row.request_id,output.candidate_index,output.image_id,row.user_id,row.brand_id,path,row.job_id),
  ]);
  const stored = await env.DB.prepare('SELECT id,job_id,user_id,brand_id,storage_path FROM generated_images WHERE id=?').bind(output.image_id)
    .first<{ id: string; job_id: string; user_id: string; brand_id: string; storage_path: string }>();
  return stored?.user_id === row.user_id && stored.brand_id === row.brand_id && stored.job_id === row.job_id && stored.storage_path === path;
}

async function reconcile(env: Env, row: Row, finish = false): Promise<Row> {
  if (row.state === 'completed') return row;
  let current = await outputs(env,row.request_id);
  if (current.every(o => !['planned','running','storing'].includes(o.state))) {
    // A concurrent GET may already have made this request terminal while the
    // connected observer held an older row. Preserve that exact decision.
    const terminal = await read(env,row.request_id);
    if (terminal && ['completed','unknown','failed'].includes(terminal.state)) return terminal;
  }
  for (const output of current.filter(o => o.state === 'storing')) {
    try { await commitStoredCandidate(env,row,output); } catch { /* exact pending object remains recoverable */ }
  }
  const input = JSON.parse(row.input_metadata) as Json;
  const lastAttempt = input.provider === 'openai'
    ? current.reduce((latest,o) => o.attempted_at && o.attempted_at > latest ? o.attempted_at : latest,row.created_at)
    : row.created_at;
  const stale = Date.now() - Date.parse(lastAttempt) > STALE_MS;
  if (finish || stale) {
    const entitlement = await rowEntitlement(env, row);
    if (!entitlement.allowed) return (await read(env,row.request_id)) ?? row;
    await env.DB.batch([
      env.DB.prepare("UPDATE heavy_ai_candidates SET state='unknown',error_code='image_outcome_unknown' WHERE request_id=? AND state='running'").bind(row.request_id),
      env.DB.prepare("UPDATE heavy_ai_candidates SET state='failed',error_code='image_batch_not_submitted' WHERE request_id=? AND state='planned'").bind(row.request_id),
    ]);
  }
  current = await outputs(env,row.request_id);
  const allComplete = current.length === row.candidate_count && current.every(o => o.state === 'completed');
  const needsComposite = isRecord((JSON.parse(row.input_metadata) as Json).metadata) &&
    isRecord(((JSON.parse(row.input_metadata) as Json).metadata as Json).protectedEdit);
  const unsettled = current.some(o => ['planned','running'].includes(o.state));
  const state = allComplete ? 'completed' : unsettled ? 'running' : current.some(o => ['storing','unknown'].includes(o.state)) ? 'unknown' : 'failed';
  const code = allComplete ? null : current.find(o => o.error_code && o.error_code !== 'image_batch_not_submitted')?.error_code ?? 'image_persistence_pending';
  const now = new Date().toISOString();
  const entitlement = await rowEntitlement(env, row);
  if (!entitlement.allowed) return (await read(env,row.request_id)) ?? row;
  await env.DB.batch([
    env.DB.prepare('UPDATE heavy_ai_requests SET state=?,error_code=?,quota_units=?,updated_at=? WHERE request_id=?')
      .bind(state,code,current.filter(o => o.state !== 'failed').length,now,row.request_id),
    env.DB.prepare('UPDATE generation_jobs SET status=?,error_message=?,completed_at=? WHERE id=? AND user_id=?')
      .bind(allComplete ? needsComposite ? 'processing' : 'completed' : state === 'running' ? 'processing' : 'failed',
        allComplete && needsComposite ? 'protected_image_final_save_pending' : code,state === 'running' || allComplete && needsComposite ? null : now,row.job_id,row.user_id),
  ]);
  return (await read(env,row.request_id)) ?? row;
}

async function receipt(request: Request, env: Env, row: Row): Promise<Response> {
  // Readers must still own the request AND retain their current brand role.
  const owner = await requireBrandRole(request,env,row.brand_id,'viewer');
  if (owner instanceof Response) return owner;
  if (owner !== row.user_id) return fail('image_request_not_found',404);
  const input = JSON.parse(row.input_metadata) as Json;
  // A completed request already has a durable, request-bound attestation and
  // persisted provider output.  The short-lived preparation proof gates
  // admission, but must not make a completed artifact unreadable after its
  // five-minute preparation window; viewer/editor role and the attestation
  // binding below remain mandatory for every read.
  const entitlement = resolveHeavyGenerationAccess({
    userId: row.user_id,
    brandId: row.brand_id,
    action: row.action,
    requestId: row.request_id,
    inputDigest: row.fingerprint,
    normalizedInput: isRecord(input.normalizedInput) ? input.normalizedInput : rowNormalizedInput(row),
  });
  if (!entitlement.allowed) return fail(entitlement.reason ?? 'heavy_generation_disabled', entitlementFailureStatus(entitlement.reason ?? 'heavy_generation_disabled'));
  const editor = row.state === 'completed' ? owner : await requireBrandRole(request,env,row.brand_id,'editor');
  if (!(editor instanceof Response) && editor === row.user_id) row = await reconcile(env,row);
  const current = await outputs(env,row.request_id); const completed: Json[] = [];
  const provider = input.provider === 'openai' ? 'openai' : 'workers_ai';
  const backendProvider = typeof input.backendProvider === 'string' ? input.backendProvider :
    provider === 'openai' ? OPENAI_IMAGE_BACKEND : 'cloudflare-workers-ai';
  for (const output of current.filter(o => o.state === 'completed')) {
    const path = `generated-images/${output.image_id}`;
    const object = await env.PRIVATE_MEDIA.head(path);
    const image = await env.DB.prepare('SELECT id FROM generated_images WHERE id=? AND user_id=? AND brand_id=? AND job_id=? AND storage_path=?')
      .bind(output.image_id,row.user_id,row.brand_id,row.job_id,path).first();
    if (!image || !object || object.size !== output.content_bytes || object.customMetadata?.sha256 !== output.sha256 ||
      object.customMetadata?.requestId !== row.request_id || object.customMetadata?.imageId !== output.image_id) return fail('image_result_unavailable',410);
    const url = new URL('/v1/media/read',request.url); url.searchParams.set('bucket','generated-images'); url.searchParams.set('path',path); url.searchParams.set('expiresIn','3600');
    const signed = await handleMediaReadGateway(new Request(url,{ headers: request.headers }),env);
    if (!signed?.ok) return signed ?? fail('image_readback_unavailable',503);
    const media = await signed.json() as { url: string };
    const descriptor = JSON.parse(output.descriptor) as Json;
    const providerTaskId = isRecord(descriptor) && typeof descriptor.providerTaskId === 'string' ? descriptor.providerTaskId : null;
    completed.push({ ...JSON.parse(output.descriptor), id: output.image_id, imageId: output.image_id, jobId: row.job_id,
      imageUrl: media.url, storagePath: path, persistenceStatus: 'completed', provider, modelUsed: row.model,
      providerModel: row.model, providerTaskId, candidateIndex: output.candidate_index,
      seed: output.seed, width: output.width, height: output.height });
  }
  // Do not disclose a late result after logout / membership revocation.
  const finalOwner = await requireBrandRole(request,env,row.brand_id,'viewer');
  if (finalOwner instanceof Response) return finalOwner;
  if (finalOwner !== row.user_id) return fail('image_request_not_found',404);
  const success = row.state === 'completed' && completed.length === row.candidate_count;
  const known = current.filter(o => o.estimated_micro_usd !== null);
  const payload: Json = { success, requestId: row.request_id, jobId: row.job_id, state: row.state,
    createdAt:row.created_at,featureType:input.featureType,metadata:input.metadata,
    protectedEdit:(input.metadata as Json).protectedEdit,requiresProtectedComposite:isRecord((input.metadata as Json).protectedEdit),
    status: row.state, provider, backendProvider, providerModel: row.model,
    persistenceStatus: success ? 'completed' : completed.length ? 'partial' : row.state === 'running' ? 'processing' : 'failed',
    requestedCandidateCount: row.candidate_count, persistedCandidateCount: completed.length, cleanupStatus: 'none',
    inputImageCount: (JSON.parse(row.input_metadata) as Json).inputImageCount,
    images: completed, failedCandidates: current.filter(o => o.state !== 'completed').map(o => ({ candidateIndex: o.candidate_index, state: o.state, error: o.error_code })),
    recovery: row.state === 'running' ? 'read_same_request' : row.state === 'unknown' ? 'reconcile_only_no_reinference' : 'terminal',
    usage: { attemptedImages: current.filter(o => o.attempted_at).length, knownEstimateCount: known.length,
      unknownEstimateCount: current.filter(o => o.attempted_at && o.estimated_micro_usd === null).length,
      estimatedMicroUSD: known.length ? known.reduce((sum,o) => sum + o.estimated_micro_usd!,0) : null,
      estimatedNeurons: known.length ? known.reduce((sum,o) => sum + o.estimated_neurons!,0) : null, billing: 'estimate_not_invoice' },
    error: success ? undefined : row.error_code ?? 'image_processing' };
  if (row.action === 'model-matrix') payload.matrix = completed;
  if (completed[0]) Object.assign(payload,{ imageUrl: completed[0].imageUrl, imageId: completed[0].imageId, storagePath: completed[0].storagePath });
  // A receipt is readable even when its inference failed. The success field is
  // the result contract; HTTP 200 here is not a claim of a usable generation.
  return reply(payload);
}

async function runModel(env: Env, action: ImageAction, input: ImageInput, index: number, provider: ProviderConfig): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inference = provider.provider === 'openai'
    ? runOpenAIImage(env, action, input, index, fetch, provider.model)
    : env.AI!.run(IMAGE_MODEL,{ multipart: modelMultipart(input,input.candidates[index]) });
  // A timeout is UNKNOWN, never a safe retry. Workers AI binding has no abort
  // or provider job lookup in this contract. Losing the observer is not cancel.
  try { return await Promise.race([inference,new Promise((_,reject) => { timer = setTimeout(() => reject(
    provider.provider === 'openai' ? new OpenAIImageError('timeout') : new Error('image_outcome_unknown'),
  ),modelTimeoutMs(env,provider.provider)); })]); }
  finally { if (timer) clearTimeout(timer); }
}


/** Claude text actions: synchronous JSON, no quota rows, no media writes. */
async function handleClaudeTextAction(request: Request, env: Env, action: ClaudeTextAction): Promise<Response> {
  try {
    const user = await principal(request,env); if (user instanceof Response) return user;
    const raw = await boundedImageJSON(request);
    const brandId = typeof raw.brandId === 'string' ? raw.brandId : '';
    if (!brandId) return fail('brand_id_required',400);
    const owner = await requireBrandRole(request,env,brandId,'editor'); if (owner instanceof Response) return owner;
    if (owner !== user) return fail('unauthorized',401);
    if (!(env.AI_IMAGE_ALLOWED_ACTIONS ?? '').split(',').map(v => v.trim()).includes(action)) return fail('claude_text_not_enabled',503);
    if (!claudeConfigured(env)) return fail('claude_api_key_missing',503);
    return reply(await runClaudeTextAction(env,action,raw));
  } catch (error) {
    if (error instanceof ClaudeTextError) return fail(error.code,error.status);
    if (error instanceof ImageInputError) return fail(error.message,error.status);
    return fail('claude_text_failed',500);
  }
}

export async function handleImageAIAction(request: Request, env: Env, action: string): Promise<Response> {
  if (!IMAGE_ACTIONS.has(action)) return fail('image_action_not_implemented',503);
  if (CLAUDE_TEXT_ACTIONS.has(action)) return handleClaudeTextAction(request,env,action as ClaudeTextAction);
  let row: Row | null = null;
  try {
    const user = await principal(request,env); if (user instanceof Response) return user;
    const raw = await boundedImageJSON(request); const typedAction = action as ImageAction;
    const provider = providerConfig(env,typedAction,raw);
    const input = parseImageInput(typedAction,raw,provider);
    const owner = await requireBrandRole(request,env,input.brandId,'editor'); if (owner instanceof Response) return owner;
    if (owner !== user) return fail('unauthorized',401);
    const id = request.headers.get('idempotency-key')?.toLowerCase(); if (!id || !UUID.test(id)) return fail('image_request_id_required',400);
    const preparationId = typeof raw.preparationId === 'string' ? raw.preparationId.trim() : '';
    const preparationDigest = typeof raw.inputDigest === 'string' ? raw.inputDigest.trim().toLowerCase() : '';
    const normalized = await normalizedRequest(env,user,typedAction,raw,input,provider);
    const fingerprint = normalized.digest;
    if (preparationDigest && preparationDigest !== fingerprint) return fail('heavy_input_digest_mismatch',409);
    row = await read(env,id);
    // A caller reusing an owned idempotency key with changed normalized input
    // is a request conflict, not a new entitlement attempt.  No side effect
    // is possible on this branch; exact retries still pass the entitlement
    // check below before the receipt/readback path.
    if (row && row.user_id === user && row.brand_id === input.brandId && row.fingerprint !== fingerprint) {
      return fail('image_request_conflict',409);
    }
    const entitlement = resolveHeavyGenerationAccess({
      userId: user,
      brandId: input.brandId,
      action,
      requestId: id,
      inputDigest: fingerprint,
      normalizedInput: normalized.normalized,
    });
    if (!entitlement.allowed) return fail(entitlement.reason ?? 'heavy_generation_disabled', entitlementFailureStatus(entitlement.reason ?? 'heavy_generation_disabled'));
    // Current entitlement is checked before an idempotent receipt as well as
    // before a new admission; old rows cannot bypass the active policy.
    if (row) return row.user_id === user && row.brand_id === input.brandId && row.fingerprint === fingerprint
      ? receipt(request,env,row) : fail('image_request_conflict',409);
    if (!enabled(env,action,provider.provider)) return fail('image_ai_not_enabled',503);
    if (provider.provider === 'openai' && !env.OPENAI_IMAGE_API_KEY?.trim() && !env.OPENAI_API_KEY?.trim()) {
      return fail('openai_image_api_key_missing',503);
    }
    if (!env.MEDIA_READ_SECRET || env.MEDIA_READ_SECRET.length < 32) return fail('media_read_gateway_unavailable',503);
    if (input.parentImageId && !await env.DB.prepare('SELECT id FROM generated_images WHERE id=? AND user_id=? AND brand_id=?')
      .bind(input.parentImageId,user,input.brandId).first()) return fail('parent_image_not_found',404);
    const now = new Date().toISOString(); const utcMonth = now.slice(0,7); const utcDay = now.slice(0,10); const jobId = `ai-${id}`;
    const executionId = crypto.randomUUID(); const quota = limits(env); const count = input.candidates.length;
    const reservedNeuronCenti = Math.round(imageEstimate(input).neurons * 100) * count;
    for (let index = 0; index < count; index++) {
      if (await env.DB.prepare('SELECT id FROM generated_images WHERE id=?').bind(`${jobId}-${index}`).first() ||
          await env.PRIVATE_MEDIA.head(`generated-images/${jobId}-${index}`)) return fail('image_request_conflict',409);
    }
    const metadata = JSON.stringify({ inputDigest: fingerprint, normalizedInput: normalized.normalized,
      provider: provider.provider, backendProvider: provider.backendProvider, prompt: input.prompt, featureType: input.featureType, width: input.width, height: input.height,
      metadata: input.metadata, parentImageId: input.parentImageId, generation: input.generation, inputImageCount: input.references.length,
      referenceDimensions: input.references.map(r => ({ width: r.width,height: r.height })),
      termsAcceptanceId: entitlement.termsAcceptanceId, rightsAttestationId: entitlement.rightsAttestationId,
      requestBinding: entitlement.requestBinding });
    const admission = env.DB.prepare(`INSERT OR IGNORE INTO heavy_ai_requests
      (request_id,user_id,brand_id,action,fingerprint,execution_id,model,job_id,input_metadata,quota_units,candidate_count,reserved_centi_neurons,
       terms_acceptance_id,rights_attestation_id,request_binding,preparation_id,utc_month,utc_day,state,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'running',?,?
      WHERE COALESCE((SELECT SUM(quota_units) FROM heavy_ai_requests WHERE utc_month=?),0)+? <= ?
      AND COALESCE((SELECT admitted_units FROM heavy_ai_daily WHERE utc_day=?),0)+? <= ?
      AND COALESCE((SELECT admitted_centi_neurons FROM heavy_ai_daily WHERE utc_day=?),0)+? <= ?
      AND (SELECT COUNT(*) FROM heavy_ai_requests r WHERE state='running' AND (${activeSinceSQL})>?) < ?
      AND NOT EXISTS(SELECT 1 FROM heavy_ai_requests r WHERE user_id=? AND state='running' AND (${activeSinceSQL})>?)`)
      .bind(id,user,input.brandId,action,fingerprint,executionId,provider.model,jobId,metadata,count,count,reservedNeuronCenti,
        entitlement.termsAcceptanceId,entitlement.rightsAttestationId,entitlement.requestBinding,preparationId,utcMonth,utcDay,now,now,
        utcMonth,count,quota.accountMonthly,utcDay,count,quota.daily,utcDay,reservedNeuronCenti,quota.dailyNeuronCenti,
        new Date(Date.now()-STALE_MS).toISOString(),quota.concurrent,user,new Date(Date.now()-STALE_MS).toISOString());
    const admissionEntitlement = resolveHeavyGenerationAccess({
      userId: user, brandId: input.brandId, action, requestId: id, inputDigest: fingerprint, normalizedInput: normalized.normalized,
    });
    if (!admissionEntitlement.allowed) return fail(admissionEntitlement.reason ?? 'heavy_generation_disabled', entitlementFailureStatus(admissionEntitlement.reason ?? 'heavy_generation_disabled'));
    let admissionError = false;
    try {
      await env.DB.batch([admission,
        env.DB.prepare(`INSERT OR IGNORE INTO generation_jobs (id,brand_id,user_id,feature_type,input_params,optimized_prompt,status,created_at)
          SELECT job_id,brand_id,user_id,?,input_metadata,?,'processing',created_at FROM heavy_ai_requests WHERE request_id=? AND execution_id=?`)
          .bind(input.featureType,input.prompt,id,executionId),
        ...input.candidates.map((candidate,index) => env.DB.prepare(`INSERT OR IGNORE INTO heavy_ai_candidates
          (request_id,candidate_index,image_id,state,descriptor,seed) SELECT request_id,?,?,'planned',?,? FROM heavy_ai_requests WHERE request_id=? AND execution_id=?`)
          .bind(index,`${jobId}-${index}`,JSON.stringify(candidate.descriptor),candidate.seed,id,executionId)),
      ]);
    } catch { admissionError = true; /* A lost batch response is reconciled before any inference. */ }
    row = await read(env,id);
    if (!row) return fail(admissionError ? 'image_admission_unavailable' : 'image_quota_or_concurrency_limit',admissionError ? 503 : 429);
    if (row.user_id !== user || row.brand_id !== input.brandId || row.fingerprint !== fingerprint) return fail('image_request_conflict',409);
    if (row.execution_id !== executionId) return receipt(request,env,row);
    const planned = await outputs(env,id);
    if (planned.length !== count || !await env.DB.prepare('SELECT id FROM generation_jobs WHERE id=? AND user_id=?').bind(jobId,user).first()) return fail('image_admission_unavailable',503);
    for (let index = 0; index < count; index++) {
      const denied = await canContinue(request,env,row,true); if (denied) { await reconcile(env,row,true); return denied; }
      const changed = await env.DB.prepare("UPDATE heavy_ai_candidates SET state='running',attempted_at=? WHERE request_id=? AND candidate_index=? AND state='planned'")
        .bind(new Date().toISOString(),id,index).run();
      if (changed.meta.changes !== 1) break;
      const beforeProvider = resolveHeavyGenerationAccess({
        userId: user, brandId: input.brandId, action, requestId: id, inputDigest: fingerprint, normalizedInput: normalized.normalized,
      });
      if (!beforeProvider.allowed) { await reconcile(env,row,true); return fail(beforeProvider.reason ?? 'heavy_generation_disabled', entitlementFailureStatus(beforeProvider.reason ?? 'heavy_generation_disabled')); }
      const started = Date.now(); let output: unknown;
      try { output = await runModel(env,typedAction,input,index,provider); }
      catch (error) {
        const beforeUnknown = await canContinue(request,env,row,true); if (beforeUnknown) { await reconcile(env,row,true); return beforeUnknown; }
        const providerError = error instanceof OpenAIImageError ? error : null;
        const state = providerError?.category === 'request_rejected' ? 'failed' : 'unknown';
        const descriptor = isRecord(input.candidates[index].descriptor)
          ? {...input.candidates[index].descriptor,...(providerError ? {providerError:providerError.diagnostics} : {})}
          : input.candidates[index].descriptor;
        await env.DB.prepare("UPDATE heavy_ai_candidates SET state=?,error_code=?,latency_ms=?,descriptor=? WHERE request_id=? AND candidate_index=? AND state='running'")
          .bind(state,providerError?.errorCode ?? 'image_outcome_unknown',Date.now()-started,JSON.stringify(descriptor),id,index).run();
        break;
      }
      const latency = Date.now()-started;
      let image;
      try {
        if (!isRecord(output) || typeof output.image !== 'string') throw new Error('invalid');
        image = decodeImage(output.image,false);
        const expected = provider.provider === 'openai' ? openAIExpectedDimensions(input.width,input.height) : [input.width,input.height];
        if (image.width !== expected[0] || image.height !== expected[1]) throw new Error('dimensions');
      } catch {
        const beforeInvalid = await canContinue(request,env,row,true); if (beforeInvalid) { await reconcile(env,row,true); return beforeInvalid; }
        const providerError = provider.provider === 'openai' ? new OpenAIImageError('unusable_response',200,undefined,
          isRecord(output) && typeof output.providerTaskId === 'string' ? output.providerTaskId : undefined) : null;
        const descriptor = isRecord(input.candidates[index].descriptor)
          ? {...input.candidates[index].descriptor,...(providerError ? {providerError:providerError.diagnostics} : {})}
          : input.candidates[index].descriptor;
        await env.DB.prepare("UPDATE heavy_ai_candidates SET state=?,error_code='image_provider_invalid_output',latency_ms=?,descriptor=? WHERE request_id=? AND candidate_index=? AND state='running'")
          .bind(providerError ? 'unknown' : 'failed',latency,JSON.stringify(descriptor),id,index).run();
        break;
      }
      const estimate = imageEstimate(input); const checksum = await sha256(image.bytes); const imageId = `${jobId}-${index}`;
      const providerTaskId = isRecord(output) && typeof output.providerTaskId === 'string' ? output.providerTaskId : null;
      const descriptor = isRecord(input.candidates[index].descriptor)
        ? { ...input.candidates[index].descriptor, ...(providerTaskId ? { providerTaskId } : {}) }
        : input.candidates[index].descriptor;
      // Record immutable output identity BEFORE writing R2, so a lost R2 or D1
      // response can finish this save without paying for another inference.
      const beforeOutputRecord = resolveHeavyGenerationAccess({
        userId: user, brandId: input.brandId, action, requestId: id, inputDigest: fingerprint, normalizedInput: normalized.normalized,
      });
      if (!beforeOutputRecord.allowed) { await reconcile(env,row,true); return fail(beforeOutputRecord.reason ?? 'heavy_generation_disabled', entitlementFailureStatus(beforeOutputRecord.reason ?? 'heavy_generation_disabled')); }
      const recorded = await env.DB.prepare(`UPDATE heavy_ai_candidates SET state='storing',content_type=?,content_bytes=?,sha256=?,width=?,height=?,
        estimated_micro_usd=?,estimated_neurons=?,latency_ms=?,descriptor=? WHERE request_id=? AND candidate_index=? AND state='running'`)
        .bind(image.contentType,image.bytes.length,checksum,image.width,image.height,estimate.microUSD,estimate.neurons,latency,JSON.stringify(descriptor),id,index).run();
      if (recorded.meta.changes !== 1) break;
      const access = await canContinue(request,env,row,true); if (access) { await reconcile(env,row,true); return access; }
      try {
        await env.PRIVATE_MEDIA.put(`generated-images/${imageId}`,image.bytes,{ onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: image.contentType },
          customMetadata: { sha256: checksum,requestId: id,imageId } });
      } catch { /* HEAD the same immutable target even if the PUT response was lost. */ }
      const afterStore = await canContinue(request,env,row,true); if (afterStore) return afterStore;
      const candidate = (await outputs(env,id))[index];
      const beforeCommit = resolveHeavyGenerationAccess({
        userId: user, brandId: input.brandId, action, requestId: id, inputDigest: fingerprint, normalizedInput: normalized.normalized,
      });
      if (!beforeCommit.allowed) { await reconcile(env,row,true); return fail(beforeCommit.reason ?? 'heavy_generation_disabled', entitlementFailureStatus(beforeCommit.reason ?? 'heavy_generation_disabled')); }
      if (!candidate || !await commitStoredCandidate(env,row,candidate)) break;
    }
    const beforeReconcile = resolveHeavyGenerationAccess({
      userId: user, brandId: input.brandId, action, requestId: id, inputDigest: fingerprint, normalizedInput: normalized.normalized,
    });
    if (!beforeReconcile.allowed) return fail(beforeReconcile.reason ?? 'heavy_generation_disabled', entitlementFailureStatus(beforeReconcile.reason ?? 'heavy_generation_disabled'));
    row = await reconcile(env,row,true);
    return receipt(request,env,row);
  } catch (error) {
    if (error instanceof ImageInputError) return fail(error.message,error.status);
    // Never automatically submit again after an admission/provider/storage fault.
    return fail(row ? 'image_receipt_readback_required' : 'image_service_unavailable',503);
  }
}

const entitlementActionPath = (pathname: string): 'prepare' | 'acceptance' | 'attestation' | null => {
  if (pathname === '/v1/heavy/entitlement/prepare') return 'prepare';
  if (pathname === '/v1/heavy/entitlement/acceptance' || pathname === '/v1/heavy/acceptance') return 'acceptance';
  if (pathname === '/v1/heavy/entitlement/attestation' || pathname === '/v1/heavy/attestation') return 'attestation';
  if (pathname === '/v1/heavy/entitlement') return 'attestation';
  return null;
};

const jsonErrorStatus = (reason: HeavyEntitlementReason): number => (
  reason.includes('mismatch') || reason.includes('conflict') ? 409 : entitlementFailureStatus(reason)
);

/** Explicit Heavy-only terms and request-attestation API. */
export async function handleHeavyEntitlementAction(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const mode = entitlementActionPath(new URL(request.url).pathname);
  if (!mode) return null;
  try {
    const user = await principal(request, env); if (user instanceof Response) return user;
    const raw = await boundedImageJSON(request);
    const brandValue = raw.brandId ?? raw.brand_id;
    const brandId = typeof brandValue === 'string' ? brandValue.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(brandId)) return fail('invalid_heavy_entitlement_scope', 400);
    const owner = await requireBrandRole(request, env, brandId, 'editor');
    if (owner instanceof Response) return owner;
    if (owner !== user) return fail('unauthorized', 401);
    const actionValue = raw.action ?? raw.providerAction;
    const action = typeof actionValue === 'string' ? actionValue.trim() : '';
    if (!IMAGE_ACTIONS.has(action)) return fail('invalid_heavy_entitlement_scope', 400);
    const requestIdValue = raw.requestId ?? request.headers.get('idempotency-key');
    const requestId = typeof requestIdValue === 'string' ? requestIdValue.toLowerCase() : '';
    if (!UUID.test(requestId)) return fail('image_request_id_required', 400);
    const preparationId = typeof raw.preparationId === 'string' ? raw.preparationId.trim() : '';
    const submittedInputDigest = typeof raw.inputDigest === 'string' ? raw.inputDigest.trim().toLowerCase() : '';
    if (mode === 'prepare') {
      const providerBody = isRecord(raw.input) ? raw.input : isRecord(raw.body) ? raw.body : null;
      if (!providerBody) return fail('heavy_input_digest_required', 400);
      const providerBrand = providerBody.brandId ?? providerBody.brand_id;
      if (providerBrand !== brandId) return fail('invalid_heavy_entitlement_scope', 400);
      const typedAction = action as ImageAction;
      const provider = providerConfig(env, typedAction, providerBody);
      const parsed = parseImageInput(typedAction, providerBody, provider);
    const normalized = await normalizedRequest(env, user, typedAction, providerBody, parsed, provider);
      if (submittedInputDigest && submittedInputDigest !== normalized.digest) return fail('heavy_input_digest_mismatch', 409);
      const result = await prepareHeavyGeneration(env, {
        userId: user, brandId, action, requestId, inputDigest: normalized.digest, normalizedInput: normalized.normalized,
      });
      if (!result.ok) return fail(result.reason, jsonErrorStatus(result.reason));
      return reply({ success: true, preparationId: result.preparation.preparationId,
        inputDigest: result.preparation.inputDigest, expiresAt: result.preparation.expiresAt,
        termsVersion: result.preparation.policy.termsVersion,
        termsDocumentVersion: result.preparation.policy.termsDocumentVersion,
        termsDocumentDigest: result.preparation.policy.termsDocumentDigest,
        rightsVersion: result.preparation.policy.rightsVersion,
        rightsDocumentVersion: result.preparation.policy.rightsDocumentVersion,
        rightsDocumentDigest: result.preparation.policy.rightsDocumentDigest });
    }
    if (mode === 'acceptance') {
      if (!preparationId) return fail('heavy_preparation_required', 403);
      if (!submittedInputDigest) return fail('heavy_input_digest_required', 400);
      const result = await recordHeavyTermsAcceptance(env, {
        ...raw,
        userId: user, brandId, action, requestId, preparationId, inputDigest: submittedInputDigest,
        termsAccepted: raw.termsAccepted,
      });
      if (!result.ok) return fail(result.reason, jsonErrorStatus(result.reason));
      return reply({ success: true, acceptanceId: result.acceptanceId, acceptedAt: result.acceptedAt,
        termsVersion: result.policy.termsVersion, documentVersion: result.policy.termsDocumentVersion,
        documentDigest: result.policy.termsDocumentDigest, rightsVersion: result.policy.rightsVersion,
        rightsDocumentVersion: result.policy.rightsDocumentVersion, rightsDocumentDigest: result.policy.rightsDocumentDigest });
    }
    if (!preparationId) return fail('heavy_preparation_required', 403);
    const providerBody = isRecord(raw.input) ? raw.input : isRecord(raw.body) ? raw.body : null;
    if (!providerBody) return fail('heavy_input_digest_required', 400);
    const providerBrand = providerBody.brandId ?? providerBody.brand_id;
    if (providerBrand !== brandId) return fail('invalid_heavy_entitlement_scope', 400);
    const typedAction = action as ImageAction;
    const provider = providerConfig(env, typedAction, providerBody);
    const parsed = parseImageInput(typedAction, providerBody, provider);
    const normalized = await normalizedRequest(env, user, typedAction, providerBody, parsed, provider);
    if (submittedInputDigest && submittedInputDigest !== normalized.digest) return fail('heavy_input_digest_mismatch', 409);
    const result = await recordHeavyRequestAttestation(env, {
      ...raw,
      userId: user,
      brandId,
      action,
      requestId,
      preparationId,
      inputDigest: normalized.digest,
      normalizedInput: normalized.normalized,
      termsAccepted: raw.termsAccepted,
      rightsAttested: raw.rightsAttested,
    });
    if (!result.ok) return fail(result.reason, jsonErrorStatus(result.reason));
    return reply({ success: true, requestId, inputDigest: normalized.digest,
      termsAcceptanceId: result.acceptanceId, rightsAttestationId: result.attestationId ?? null, termsVersion: result.policy.termsVersion,
      documentVersion: result.policy.termsDocumentVersion, documentDigest: result.policy.termsDocumentDigest,
      rightsVersion: result.policy.rightsVersion, rightsDocumentVersion: result.policy.rightsDocumentVersion,
      rightsDocumentDigest: result.policy.rightsDocumentDigest, requestScopedAttestationRequired: false });
  } catch (error) {
    if (error instanceof ImageInputError) return fail(error.message, error.status);
    return fail('heavy_entitlement_unavailable', 503);
  }
}

export async function imageUsage(env: Env, brandId: string): Promise<Json> {
  const now = new Date(); const month = now.toISOString().slice(0,7); const quota = limits(env);
  const provider = configuredProvider(env);
  const imageModel = provider === 'openai' ? resolveOpenAIModel(env,'generate-image') : IMAGE_MODEL;
  const used = await env.DB.prepare(`SELECT COALESCE(SUM(r.quota_units),0) AS allocated FROM heavy_ai_requests r WHERE brand_id=? AND utc_month=?`)
    .bind(brandId,month).first<{ allocated: number }>();
  const sums = await env.DB.prepare(`SELECT COUNT(*) AS plannedImages,
    SUM(CASE WHEN c.state='completed' THEN 1 ELSE 0 END) AS completedImages,
    SUM(CASE WHEN c.state IN ('planned','running') THEN 1 ELSE 0 END) AS runningImages,
    SUM(CASE WHEN c.state IN ('storing','unknown') THEN 1 ELSE 0 END) AS uncertainImages,
    SUM(CASE WHEN c.attempted_at IS NOT NULL THEN 1 ELSE 0 END) AS attemptedImages,
    SUM(CASE WHEN c.attempted_at IS NOT NULL AND c.estimated_micro_usd IS NULL THEN 1 ELSE 0 END) AS unknownEstimateCount,
    SUM(c.estimated_micro_usd) AS estimatedMicroUSD, SUM(c.estimated_neurons) AS estimatedNeurons,
    AVG(c.latency_ms) AS averageInferenceMs
    FROM heavy_ai_candidates c JOIN heavy_ai_requests r ON r.request_id=c.request_id WHERE r.brand_id=? AND r.utc_month=?`)
    .bind(brandId,month).first<Json>();
  const accountUsed = await env.DB.prepare(`SELECT COALESCE(SUM(quota_units),0) AS allocated FROM heavy_ai_requests WHERE utc_month=?`)
    .bind(month).first<{ allocated: number }>();
  return { ...sums, periodStart: `${month}-01T00:00:00.000Z`, periodEnd: new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString(),
    monthlyQuota: quota.monthly, remainingUnits: Math.max(0,quota.monthly-(used?.allocated ?? 0)), accountMonthlyQuota: quota.accountMonthly,
    accountRemainingUnits: Math.max(0,quota.accountMonthly-(accountUsed?.allocated ?? 0)), planName: '内部Free枠',
    billing: 'estimate_not_invoice', providerBilling: null, accountFreeAllocationRemaining: null,
    measurementScope: 'cloudflare_image_ai_only', provider, backendProvider: provider === 'openai' ? OPENAI_IMAGE_BACKEND : 'cloudflare-workers-ai', imageModel,
    imageAIEnabled: env.AI_IMAGE_ENABLED === 'true',
    dailyWorkerAdmissionLimit: quota.daily, dailyWorkerEstimatedNeuronLimit: quota.dailyNeuronCenti / 100, accountWideBudgetGuaranteed: false };
}

/** Models whose provider key is registered on this Worker; the settings screen lists only these. */
export function availableAIModels(env: Env): Json {
  const provider = configuredProvider(env);
  const openAIReady = provider === 'openai' && Boolean(env.OPENAI_IMAGE_API_KEY?.trim() || env.OPENAI_API_KEY?.trim());
  const imageModels = provider === 'workers_ai'
    ? (env.AI ? [{ id: IMAGE_MODEL, label: 'FLUX.2 klein（Cloudflare）', generate: true, edit: true }] : [])
    : openAIReady ? Object.entries(OPENAI_IMAGE_MODEL_LABELS).map(([id, label]) => ({
      id, label, generate: OPENAI_IMAGE_MODELS.has(id), edit: OPENAI_IMAGE_EDIT_MODELS.has(id) })) : [];
  const textReady = Boolean(env.ANTHROPIC_API_KEY?.trim());
  return {
    success: true,
    image: { provider, models: imageModels,
      defaults: provider === 'workers_ai' ? { generate: IMAGE_MODEL, edit: IMAGE_MODEL }
        : { generate: openAIModelForEndpoint(env, false), edit: openAIModelForEndpoint(env, true) } },
    text: { provider: 'anthropic', models: textReady ? CLAUDE_TEXT_MODELS : [], default: textReady ? defaultClaudeModel(env) : null },
  };
}

export async function handleImageAIRead(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url); const match = url.pathname.match(/^\/v1\/image-ai\/requests\/([^/]+)$/);
  if (match && request.method === 'GET') {
    const user = await principal(request,env); if (user instanceof Response) return user;
    if (!UUID.test(match[1])) return fail('image_request_not_found',404);
    const row = await read(env,match[1].toLowerCase());
    return row?.user_id === user ? receipt(request,env,row) : fail('image_request_not_found',404);
  }
  if (url.pathname === '/v1/ai/models' && request.method === 'GET') {
    const user = await principal(request,env); if (user instanceof Response) return user;
    return reply(availableAIModels(env));
  }
  if (url.pathname === '/v1/image-ai/usage' && request.method === 'GET') {
    const brand = url.searchParams.get('brand_id'); if (!brand) return fail('invalid_brand_id',400);
    const owner = await requireBrandRole(request,env,brand,'viewer'); if (owner instanceof Response) return owner;
    return reply(await imageUsage(env,brand));
  }
  if (url.pathname === '/v1/heavy/entitlement' && request.method === 'GET') {
    const user = await principal(request,env); if (user instanceof Response) return user;
    const brand = url.searchParams.get('brand_id')?.trim();
    const action = url.searchParams.get('action')?.trim() || 'generate-image';
    if (!brand || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(brand) || !IMAGE_ACTIONS.has(action)) {
      return fail('invalid_heavy_entitlement_scope',400);
    }
    const owner = await requireBrandRole(request,env,brand,'viewer'); if (owner instanceof Response) return owner;
    if (owner !== user) return fail('unauthorized',401);
    return reply({ success: true, ...await resolveHeavyEntitlementStatus(env, { userId: user, brandId: brand, action }) });
  }
  return null;
}
