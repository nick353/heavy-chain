import type { Env } from './index.ts';
import { principal } from './domain.ts';
import { requireBrandRole, handleMediaReadGateway } from './core.ts';
import { IMAGE_MODEL, IMAGE_ACTIONS, ImageInputError, boundedImageJSON, canonical, decodeImage, imageEstimate,
  isRecord, modelMultipart, parseImageInput, sha256, type ImageAction, type ImageInput, type Json } from './image-ai-contracts.ts';
import { OPENAI_IMAGE_BACKEND, OPENAI_IMAGE_PROVIDER, openAIExpectedDimensions, resolveOpenAIModel, runOpenAIImage } from './openai-image.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MODEL_TIMEOUT_MS = 45_000;
const MAX_MODEL_TIMEOUT_MS = 90_000;
const modelTimeoutMs = (env: Env) => {
  const value = Number(env.AI_IMAGE_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value >= DEFAULT_MODEL_TIMEOUT_MS && value <= MAX_MODEL_TIMEOUT_MS
    ? value
    : DEFAULT_MODEL_TIMEOUT_MS;
};
const STALE_MS = 4 * DEFAULT_MODEL_TIMEOUT_MS + 30_000;
type Row = { request_id: string; user_id: string; brand_id: string; action: ImageAction; fingerprint: string;
  execution_id: string; model: string; job_id: string; input_metadata: string; quota_units: number; candidate_count: number;
  utc_month: string; utc_day: string; state: string; error_code: string | null; created_at: string; updated_at: string };
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

const configuredProvider = (env: Env): ProviderKind => env.AI_IMAGE_PROVIDER?.trim() === OPENAI_IMAGE_PROVIDER ? 'openai' : 'workers_ai';
const providerConfig = (env: Env, action: ImageAction, body: Json): ProviderConfig => {
  const provider = configuredProvider(env);
  const effectiveAction: ImageAction = action === 'generate-image' && Array.isArray(body.imageUrls) && body.imageUrls.length
    ? 'edit-image' : action;
  const requested = typeof body.generationProvider === 'string' ? body.generationProvider.trim() : '';
  if (requested && requested !== provider) throw new ImageInputError('image_provider_not_enabled', 422);
  if (provider === OPENAI_IMAGE_PROVIDER) {
    try {
      return { provider, backendProvider: OPENAI_IMAGE_BACKEND,
        model: resolveOpenAIModel(env, effectiveAction, body.generationModel ?? body.providerModel) };
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
const enabled = (env: Env, action: string, provider: ProviderKind) => env.AI_IMAGE_ENABLED === 'true' &&
  (provider === 'openai' ? true : !!env.AI) &&
  (env.AI_IMAGE_ALLOWED_ACTIONS ?? '').split(',').map(v => v.trim()).includes(action);

async function canContinue(request: Request, env: Env, row: Row): Promise<Response | null> {
  const owner = await requireBrandRole(request, env, row.brand_id, 'editor');
  if (owner instanceof Response) return owner;
  return owner === row.user_id && await read(env,row.request_id) ? null : fail('image_request_not_found',404);
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
  for (const output of current.filter(o => o.state === 'storing')) {
    try { await commitStoredCandidate(env,row,output); } catch { /* exact pending object remains recoverable */ }
  }
  const stale = Date.now() - Date.parse(row.created_at) > STALE_MS;
  if (finish || stale) {
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
  const editor = row.state === 'completed' ? owner : await requireBrandRole(request,env,row.brand_id,'editor');
  if (!(editor instanceof Response) && editor === row.user_id) row = await reconcile(env,row);
  const current = await outputs(env,row.request_id); const completed: Json[] = [];
  const input = JSON.parse(row.input_metadata) as Json;
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
    ? runOpenAIImage(env, action, input, index)
    : env.AI!.run(IMAGE_MODEL,{ multipart: modelMultipart(input,input.candidates[index]) });
  // A timeout is UNKNOWN, never a safe retry. Workers AI binding has no abort
  // or provider job lookup in this contract. Losing the observer is not cancel.
  try { return await Promise.race([inference,new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('image_outcome_unknown')),modelTimeoutMs(env)); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function handleImageAIAction(request: Request, env: Env, action: string): Promise<Response> {
  if (!IMAGE_ACTIONS.has(action)) return fail('image_action_not_implemented',503);
  let row: Row | null = null;
  try {
    const user = await principal(request,env); if (user instanceof Response) return user;
    const raw = await boundedImageJSON(request); const typedAction = action as ImageAction;
    const input = parseImageInput(typedAction,raw); const provider = providerConfig(env,typedAction,raw);
    const owner = await requireBrandRole(request,env,input.brandId,'editor'); if (owner instanceof Response) return owner;
    if (owner !== user) return fail('unauthorized',401);
    const id = request.headers.get('idempotency-key')?.toLowerCase(); if (!id || !UUID.test(id)) return fail('image_request_id_required',400);
    const fingerprint = await sha256(canonical({ action,body: raw }));
    row = await read(env,id);
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
    const metadata = JSON.stringify({ provider: provider.provider, backendProvider: provider.backendProvider, prompt: input.prompt, featureType: input.featureType, width: input.width, height: input.height,
      metadata: input.metadata, parentImageId: input.parentImageId, generation: input.generation, inputImageCount: input.references.length,
      referenceDimensions: input.references.map(r => ({ width: r.width,height: r.height })) });
    const admission = env.DB.prepare(`INSERT OR IGNORE INTO heavy_ai_requests
      (request_id,user_id,brand_id,action,fingerprint,execution_id,model,job_id,input_metadata,quota_units,candidate_count,reserved_centi_neurons,utc_month,utc_day,state,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'running',?,?
      WHERE COALESCE((SELECT SUM(quota_units) FROM heavy_ai_requests WHERE utc_month=?),0)+? <= ?
      AND COALESCE((SELECT admitted_units FROM heavy_ai_daily WHERE utc_day=?),0)+? <= ?
      AND COALESCE((SELECT admitted_centi_neurons FROM heavy_ai_daily WHERE utc_day=?),0)+? <= ?
      AND (SELECT COUNT(*) FROM heavy_ai_requests WHERE state='running' AND created_at>?) < ?
      AND NOT EXISTS(SELECT 1 FROM heavy_ai_requests WHERE user_id=? AND state='running' AND created_at>?)`)
      .bind(id,user,input.brandId,action,fingerprint,executionId,provider.model,jobId,metadata,count,count,reservedNeuronCenti,utcMonth,utcDay,now,now,
        utcMonth,count,quota.accountMonthly,utcDay,count,quota.daily,utcDay,reservedNeuronCenti,quota.dailyNeuronCenti,
        new Date(Date.now()-STALE_MS).toISOString(),quota.concurrent,user,new Date(Date.now()-STALE_MS).toISOString());
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
      const denied = await canContinue(request,env,row); if (denied) { await reconcile(env,row,true); return denied; }
      const changed = await env.DB.prepare("UPDATE heavy_ai_candidates SET state='running',attempted_at=? WHERE request_id=? AND candidate_index=? AND state='planned'")
        .bind(new Date().toISOString(),id,index).run();
      if (changed.meta.changes !== 1) break;
      const started = Date.now(); let output: unknown;
      try { output = await runModel(env,typedAction,input,index,provider); }
      catch {
        await env.DB.prepare("UPDATE heavy_ai_candidates SET state='unknown',error_code='image_outcome_unknown',latency_ms=? WHERE request_id=? AND candidate_index=? AND state='running'")
          .bind(Date.now()-started,id,index).run();
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
        await env.DB.prepare("UPDATE heavy_ai_candidates SET state='failed',error_code='image_provider_invalid_output',latency_ms=? WHERE request_id=? AND candidate_index=?")
          .bind(latency,id,index).run();
        break;
      }
      const estimate = imageEstimate(input); const checksum = await sha256(image.bytes); const imageId = `${jobId}-${index}`;
      const providerTaskId = isRecord(output) && typeof output.providerTaskId === 'string' ? output.providerTaskId : null;
      const descriptor = isRecord(input.candidates[index].descriptor)
        ? { ...input.candidates[index].descriptor, ...(providerTaskId ? { providerTaskId } : {}) }
        : input.candidates[index].descriptor;
      // Record immutable output identity BEFORE writing R2, so a lost R2 or D1
      // response can finish this save without paying for another inference.
      await env.DB.prepare(`UPDATE heavy_ai_candidates SET state='storing',content_type=?,content_bytes=?,sha256=?,width=?,height=?,
        estimated_micro_usd=?,estimated_neurons=?,latency_ms=?,descriptor=? WHERE request_id=? AND candidate_index=? AND state='running'`)
        .bind(image.contentType,image.bytes.length,checksum,image.width,image.height,estimate.microUSD,estimate.neurons,latency,JSON.stringify(descriptor),id,index).run();
      const access = await canContinue(request,env,row); if (access) { await reconcile(env,row,true); return access; }
      try {
        await env.PRIVATE_MEDIA.put(`generated-images/${imageId}`,image.bytes,{ onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: image.contentType },
          customMetadata: { sha256: checksum,requestId: id,imageId } });
      } catch { /* HEAD the same immutable target even if the PUT response was lost. */ }
      const afterStore = await canContinue(request,env,row); if (afterStore) return afterStore;
      const candidate = (await outputs(env,id))[index];
      if (!candidate || !await commitStoredCandidate(env,row,candidate)) break;
    }
    row = await reconcile(env,row,true);
    return receipt(request,env,row);
  } catch (error) {
    if (error instanceof ImageInputError) return fail(error.message,error.status);
    // Never automatically submit again after an admission/provider/storage fault.
    return fail(row ? 'image_receipt_readback_required' : 'image_service_unavailable',503);
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

export async function handleImageAIRead(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url); const match = url.pathname.match(/^\/v1\/image-ai\/requests\/([^/]+)$/);
  if (match && request.method === 'GET') {
    const user = await principal(request,env); if (user instanceof Response) return user;
    if (!UUID.test(match[1])) return fail('image_request_not_found',404);
    const row = await read(env,match[1].toLowerCase());
    return row?.user_id === user ? receipt(request,env,row) : fail('image_request_not_found',404);
  }
  if (url.pathname === '/v1/image-ai/usage' && request.method === 'GET') {
    const brand = url.searchParams.get('brand_id'); if (!brand) return fail('invalid_brand_id',400);
    const owner = await requireBrandRole(request,env,brand,'viewer'); if (owner instanceof Response) return owner;
    return reply(await imageUsage(env,brand));
  }
  return null;
}
