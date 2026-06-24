#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const PROVIDER = 'runway_mcp_local_worker';
const CONTRACT_VERSION = 'heavy-chain.local-runway-worker.v1';
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:58744';
const GENERATED_IMAGES_BUCKET = 'generated-images';
const ALLOWED_FEATURES = new Set([
  'campaign-image',
  'design-gacha',
  'product-shots',
  'model-matrix',
  'multilingual-banner',
  'scene-coordinate',
  'remove-bg',
  'remove-background',
  'colorize',
  'upscale',
  'variations',
  'generate-variations',
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
};

const loadEnvFile = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Optional local convenience only.
  }
};

const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const normalizeMimeType = (mimeType) => {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return clean.startsWith('image/') ? clean : 'image/png';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const boundedNumber = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.round(numeric), max));
};

const assertValidReferenceImage = (value) => {
  if (!value) return;
  const text = String(value);
  const isDataImage = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(text);
  const isHttpsImage = /^https:\/\/[^\s]+$/i.test(text);
  if (!isDataImage && !isHttpsImage) throw new Error('local_runway_worker_reference_image_invalid');
  if (text.length > 1_500_000) throw new Error('local_runway_worker_reference_image_too_large');
};

const validateJobInput = (job, inputParams) => {
  if (!ALLOWED_FEATURES.has(String(job.feature_type || ''))) {
    throw new Error('local_runway_worker_feature_not_allowed');
  }
  if (inputParams.provider !== PROVIDER) {
    throw new Error('local_runway_worker_provider_invalid');
  }
  if (inputParams.workerContractVersion !== CONTRACT_VERSION) {
    throw new Error('local_runway_worker_contract_invalid');
  }
  const prompt = String(inputParams.prompt || job.optimized_prompt || '').trim();
  if (!prompt || prompt.length > 8000) throw new Error('local_runway_worker_prompt_invalid');
  assertValidReferenceImage(inputParams.referenceImage);
  return {
    ...inputParams,
    prompt,
    width: boundedNumber(inputParams.width, 1024, 256, 2048),
    height: boundedNumber(inputParams.height, 1024, 256, 2048),
    count: boundedNumber(inputParams.count, 1, 1, 4),
  };
};

const completeUsageEvent = async (supabase, inputParams, status, metadata = {}) => {
  const usageEventId = typeof inputParams.usageEventId === 'string' ? inputParams.usageEventId : null;
  if (!usageEventId) return;
  const { error } = await supabase.rpc('service_complete_usage_event', {
    p_usage_event_id: usageEventId,
    p_status: status,
    p_metadata: metadata,
  });
  if (error) throw error;
};

const cleanupSavedImages = async (supabase, imageIds, storagePaths) => {
  const cleanupErrors = [];
  if (imageIds.length > 0) {
    const { error: deleteImagesError } = await supabase
      .from('generated_images')
      .delete()
      .in('id', imageIds);
    if (deleteImagesError) cleanupErrors.push(sanitizeError(deleteImagesError));
  }
  if (storagePaths.length > 0) {
    const { error: removeStorageError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .remove(storagePaths);
    if (removeStorageError) cleanupErrors.push(sanitizeError(removeStorageError));
  }
  return cleanupErrors;
};

const extensionFromMimeType = (mimeType) => {
  switch (normalizeMimeType(mimeType)) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/png':
    default:
      return 'png';
  }
};

const dataUrlToBuffer = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error('worker_result_missing_data_url');
  const mimeType = normalizeMimeType(match[1]);
  const payload = match[3] || '';
  const buffer = match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
  return { buffer, mimeType };
};

const bufferToDataUrl = (buffer, mimeType) => {
  return `data:${normalizeMimeType(mimeType)};base64,${buffer.toString('base64')}`;
};

const mimeFromPath = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
};

const ratioFromDimensions = (width, height) => {
  const w = Number(width || 1024);
  const h = Number(height || 1024);
  if (w > h) return '16:9';
  if (h > w) return '9:16';
  return '1:1';
};

const sanitizeError = (error) => {
  const text = error instanceof Error ? error.message : String(error || 'local_runway_worker_failed');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/token\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}["']?/gi, 'token=[redacted]')
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
    .slice(0, 900);
};

const getSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('supabase_service_role_env_missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const readFixtureDataUrl = async (fixtureImagePath) => {
  const absolutePath = path.resolve(repoRoot, fixtureImagePath);
  const buffer = await fs.readFile(absolutePath);
  return {
    dataUrl: bufferToDataUrl(buffer, mimeFromPath(absolutePath)),
    model: 'fixture-local-runway-worker',
    taskId: `fixture-${crypto.randomUUID()}`,
    tool: 'fixture',
  };
};

const callRunwayBridge = async (job, inputParams, index) => {
  const bridgeUrl = String(process.env.RUNWAY_MCP_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
  const token = String(process.env.RUNWAY_MCP_BRIDGE_TOKEN || '').trim();
  if (!token) throw new Error('runway_mcp_bridge_token_missing');

  const action = job.feature_type === 'upscale' ? 'image-upscale' : 'text-to-image';
  const endpoint = action === 'image-upscale' ? '/image-upscale' : '/text-to-image';
  const prompt = String(inputParams.prompt || inputParams.promptText || job.optimized_prompt || '').trim();
  if (!prompt) throw new Error('local_runway_worker_prompt_missing');

  const body = action === 'image-upscale'
    ? {
        prompt,
        image: inputParams.referenceImage ? { dataUrl: inputParams.referenceImage } : undefined,
        mimeType: 'image/png',
        rationale: `Heavy Chain local Runway worker upscale for job ${job.id}`,
      }
    : {
        promptText: index > 0 ? `${prompt}\nVariant ${index + 1}` : prompt,
        width: Number(inputParams.width || 1024),
        height: Number(inputParams.height || 1024),
        ratio: ratioFromDimensions(inputParams.width, inputParams.height),
        count: 1,
        referenceImages: inputParams.referenceImage
          ? [{ uri: inputParams.referenceImage, tag: String(inputParams.referenceType || 'reference') }]
          : [],
        rationale: `Heavy Chain local Runway worker generation for job ${job.id}`,
      };

  const response = await fetch(`${bridgeUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    throw new Error(`runway_mcp_local_bridge_failed:${response.status}:${sanitizeError(asRecord(payload).error || text)}`);
  }
  const dataUrl = payload.dataUrl || (payload.base64 ? `data:${normalizeMimeType(payload.mimeType)};base64,${payload.base64}` : '');
  if (!dataUrl) throw new Error('runway_mcp_local_bridge_empty_image');
  return {
    dataUrl,
    model: payload.model || 'runway-mcp',
    taskId: payload.taskId || crypto.randomUUID(),
    tool: payload.tool || endpoint.slice(1),
  };
};

const fetchPendingJobs = async (supabase, args) => {
  let query = supabase
    .from('generation_jobs')
    .select('*')
    .eq('status', 'pending')
    .filter('input_params->>provider', 'eq', PROVIDER)
    .order('created_at', { ascending: true })
    .limit(Number(args['max-jobs'] || 1));
  if (args['job-id']) query = query.eq('id', String(args['job-id']));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

const claimJob = async (supabase, job) => {
  const inputParams = {
    ...asRecord(job.input_params),
    workerClaimedAt: new Date().toISOString(),
    workerContractVersion: CONTRACT_VERSION,
  };
  const { data, error } = await supabase
    .from('generation_jobs')
    .update({
      status: 'processing',
      input_params: inputParams,
      error_message: null,
    })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('*')
    .single();
  if (error || !data) return null;
  return data;
};

const saveGeneratedImage = async ({ supabase, job, inputParams, result, index, artifactDir }) => {
  const { buffer, mimeType } = dataUrlToBuffer(result.dataUrl);
  const imageSha256 = sha256(buffer);
  const extension = extensionFromMimeType(mimeType);
  const storagePath = `${job.user_id}/${job.brand_id}/local-runway-worker/${job.id}/${index + 1}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const title = `${job.feature_type} Runway worker ${index + 1}`;
  const metadata = {
    ...inputParams,
    title,
    artifactKind: 'runway_local_worker_image',
    localRunwayMcpWorker: true,
    lane: 'runway_mcp_local',
    noHostedBridge: true,
    workerContractVersion: CONTRACT_VERSION,
    sourceJobId: job.id,
    workerResultIndex: index,
    workerTaskId: result.taskId,
    workerTool: result.tool,
    imageSha256,
    imageBytes: buffer.byteLength,
    artifactDir,
  };

  const { data: image, error: imageError } = await supabase
    .from('generated_images')
    .insert({
      job_id: job.id,
      brand_id: job.brand_id,
      user_id: job.user_id,
      storage_path: storagePath,
      image_url: null,
      prompt: String(inputParams.prompt || job.optimized_prompt || ''),
      negative_prompt: inputParams.negativePrompt || null,
      feature_type: job.feature_type,
      model_used: result.model,
      generation_params: {
        provider: PROVIDER,
        workerContractVersion: CONTRACT_VERSION,
        width: inputParams.width || null,
        height: inputParams.height || null,
        count: inputParams.count || null,
      },
      metadata,
    })
    .select('*')
    .single();
  if (imageError || !image) throw imageError ?? new Error('generated_image_insert_failed');

  await fs.writeFile(
    path.join(artifactDir, `image-${index + 1}.json`),
    `${JSON.stringify({ storagePath, imageId: image.id, imageSha256, model: result.model, taskId: result.taskId }, null, 2)}\n`,
  );
  return image;
};

const processJob = async ({ supabase, job, args }) => {
  const claimed = await claimJob(supabase, job);
  if (!claimed) return { status: 'skipped', jobId: job.id, reason: 'claim_lost' };
  let inputParams = asRecord(claimed.input_params);
  const artifactDir = path.resolve(repoRoot, 'output/runway-local-worker', claimed.id);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, 'job.json'), `${JSON.stringify(claimed, null, 2)}\n`);
  const savedImages = [];
  const uploadedPaths = [];

  try {
    inputParams = validateJobInput(claimed, inputParams);
    const requestedCount = Math.max(1, Math.min(Number(inputParams.count || 1), 4));
    const images = [];
    for (let index = 0; index < requestedCount; index += 1) {
      const result = args['fixture-image']
        ? await readFixtureDataUrl(String(args['fixture-image']))
        : args['live-runway']
          ? await callRunwayBridge(claimed, inputParams, index)
          : (() => { throw new Error('live_runway_requires_explicit_flag_or_fixture_image'); })();
      const image = await saveGeneratedImage({ supabase, job: claimed, inputParams, result, index, artifactDir });
      images.push(image);
      savedImages.push(image.id);
      if (image.storage_path) uploadedPaths.push(image.storage_path);
    }

    const manifest = {
      ok: true,
      stage: 'local_runway_worker',
      lane: 'runway_mcp_local',
      status: 'completed',
      jobId: claimed.id,
      imageIds: images.map((image) => image.id),
      generatedAt: new Date().toISOString(),
      artifactDir,
    };
    await fs.writeFile(path.join(artifactDir, 'worker-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const { error: completeJobError } = await supabase
      .from('generation_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        input_params: {
          ...inputParams,
          workerCompletedAt: new Date().toISOString(),
          workerArtifactDir: artifactDir,
          workerImageIds: images.map((image) => image.id),
        },
      })
      .eq('id', claimed.id);
    if (completeJobError) {
      const cleanupErrors = await cleanupSavedImages(supabase, savedImages, uploadedPaths);
      throw new Error(`job_completed_update_failed:${sanitizeError(completeJobError)}:${cleanupErrors.join('|')}`);
    }
    try {
      await completeUsageEvent(supabase, inputParams, 'succeeded', {
        provider: PROVIDER,
        jobId: claimed.id,
        imageIds: images.map((image) => image.id),
      });
    } catch (usageError) {
      const usageCompletionError = sanitizeError(usageError);
      manifest.usageCompletionError = usageCompletionError;
      await fs.writeFile(path.join(artifactDir, 'worker-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      await supabase
        .from('generation_jobs')
        .update({
          input_params: {
            ...inputParams,
            workerCompletedAt: new Date().toISOString(),
            workerArtifactDir: artifactDir,
            workerImageIds: images.map((image) => image.id),
            usageCompletionError,
          },
        })
        .eq('id', claimed.id);
    }
    return manifest;
  } catch (error) {
    const blocker = sanitizeError(error);
    const cleanupErrors = await cleanupSavedImages(supabase, savedImages, uploadedPaths);
    try {
      await completeUsageEvent(supabase, inputParams, 'failed', {
        provider: PROVIDER,
        jobId: claimed.id,
        error: blocker,
        cleanupErrors,
      });
    } catch (usageError) {
      cleanupErrors.push(`usage_completion:${sanitizeError(usageError)}`);
    }
    const failed = {
      ok: false,
      stage: 'local_runway_worker',
      lane: 'runway_mcp_local',
      status: 'failed',
      jobId: claimed.id,
      blocker,
      cleanupErrors,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(artifactDir, 'worker-failed.json'), `${JSON.stringify(failed, null, 2)}\n`);
    const { error: failJobError } = await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: blocker,
        completed_at: new Date().toISOString(),
        input_params: {
          ...inputParams,
          workerFailedAt: new Date().toISOString(),
          workerArtifactDir: artifactDir,
          workerBlocker: blocker,
          workerCleanupErrors: cleanupErrors,
        },
      })
      .eq('id', claimed.id);
    if (failJobError) {
      failed.cleanupErrors.push(`job_failed_update:${sanitizeError(failJobError)}`);
      await fs.writeFile(path.join(artifactDir, 'worker-failed-update-error.json'), `${JSON.stringify(failed, null, 2)}\n`);
    }
    return failed;
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(path.resolve(repoRoot, '.env.production.local'));
  if (args.help || args.h) {
    console.log('Usage: node scripts/local-runway-mcp-worker.mjs [--loop] [--once] [--job-id <id>] [--fixture-image <path>] [--live-runway] [--max-jobs 1] [--interval-ms 5000]');
    return;
  }
  const supabase = getSupabaseClient();
  const intervalMs = Math.max(1000, Number(args['interval-ms'] || 5000));
  const loop = Boolean(args.loop) && !args['job-id'];
  do {
    const jobs = await fetchPendingJobs(supabase, args);
    const results = [];
    for (const job of jobs) {
      results.push(await processJob({ supabase, job, args }));
    }
    const summary = {
      ok: true,
      provider: PROVIDER,
      processed: results.length,
      results,
      liveRunway: Boolean(args['live-runway']),
      fixture: args['fixture-image'] ? String(args['fixture-image']) : null,
      loop,
      updatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!loop) break;
    await sleep(intervalMs);
  } while (true);
};

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, blocker: sanitizeError(error) }, null, 2));
  process.exit(1);
});
