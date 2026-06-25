#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const PROVIDER = 'runway_mcp_local_worker';
const CONTRACT_VERSION = 'heavy-chain.local-runway-worker.v1';
const BUCKET = 'generated-images';
const DEFAULT_USER_ID = '86b39a16-3ae0-4717-9e91-4764e8ee7292';
const DEFAULT_BRAND_ID = 'e5571b0b-7af7-4265-9d47-7d90ae4767d3';
const DEFAULT_OUT_DIR = 'output/playwright/hc-10m-real-generation-qa-20260626';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const FEATURE_SPECS = [
  {
    feature: 'campaign-image',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: premium black chain hoodie hero campaign image on a clean stone pedestal, silver chain detail, realistic apparel texture, controlled studio shadows, no visible text, no logo, no watermark.',
    negativePrompt: 'text, logo, watermark, distorted clothing, extra sleeves, blurry, low quality',
    width: 1024,
    height: 1024,
    expected: 'Single premium apparel campaign image. Product is the hero, black hoodie and chain detail are obvious, no text or watermark.',
  },
  {
    feature: 'product-shots',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: ecommerce-ready premium black hoodie product photograph, front view on clean light-gray studio background, visible fabric texture, silver chain motif detail, no model, no text, no watermark.',
    negativePrompt: 'text, logo, watermark, mannequin distortion, blurry, low quality',
    width: 1024,
    height: 1024,
    expected: 'Clean ecommerce product shot with garment shape and fabric detail visible.',
  },
  {
    feature: 'model-matrix',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: realistic fashion model wearing a premium black streetwear hoodie with subtle silver chain graphic, neutral studio catalog pose, full torso visible, natural hands, no text, no watermark.',
    negativePrompt: 'text, logo, watermark, extra fingers, deformed body, distorted garment, blurry',
    width: 1024,
    height: 1024,
    expected: 'Wearable-looking hoodie on model, natural pose, product remains readable.',
  },
  {
    feature: 'design-gacha',
    workspace: 'patterns',
    prompt: 'Heavy Chain 10M QA: standalone premium streetwear hoodie design concept, black base with silver chain graphic placement across chest and sleeves, apparel design mockup style, no readable text, no watermark.',
    negativePrompt: 'text, logo, watermark, messy layout, low quality, illegible garment',
    width: 1024,
    height: 1024,
    expected: 'A fresh design concept that could be sent to Canvas or production planning.',
  },
  {
    feature: 'scene-coordinate',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: black chain hoodie styled in a premium urban concrete lookbook scene, garment clearly visible, coordinated with dark denim and silver accessories, editorial lighting, no text, no watermark.',
    negativePrompt: 'text, logo, watermark, product hidden, distorted clothing, blurry',
    width: 1024,
    height: 1024,
    expected: 'Lookbook/scene coordinate image with outfit context and clear garment identity.',
  },
  {
    feature: 'multilingual-banner',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: premium ecommerce banner for black chain hoodie with clean negative space and a sharp product hero. Include exactly this readable headline text: HEAVY CHAIN. No other words, no watermark.',
    negativePrompt: 'extra text, misspelled text, watermark, clutter, distorted garment, low quality',
    width: 1792,
    height: 1024,
    model: 'gpt-image-2',
    expected: 'Banner composition with readable HEAVY CHAIN text and no extra copy.',
  },
  {
    feature: 'remove-bg',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: isolated premium black chain hoodie product cutout on a clean pure white studio background, crisp edges, transparent-background-ready appearance, no text, no watermark.',
    negativePrompt: 'text, logo, watermark, busy background, rough edges, blurry',
    width: 1024,
    height: 1024,
    expected: 'Background-removal-like output: clean cutout feel and crisp apparel edges.',
  },
  {
    feature: 'colorize',
    workspace: 'patterns',
    prompt: 'Heavy Chain 10M QA: premium hoodie recolor concept preserving the chain design, black fabric shifted to deep burgundy while silver chain accents remain metallic, studio product view, no text, no watermark.',
    negativePrompt: 'text, logo, watermark, color bleeding, distorted garment, blurry',
    width: 1024,
    height: 1024,
    expected: 'Color change is obvious, garment form and chain motif are preserved.',
  },
  {
    feature: 'upscale',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: ultra-sharp high-resolution close product photograph of black hoodie fabric with silver chain embroidery detail, crisp textile fibers, premium ecommerce detail shot, no text, no watermark.',
    negativePrompt: 'text, logo, watermark, soft focus, plastic texture, low detail',
    width: 1024,
    height: 1024,
    expected: 'Upscale/detail-like output with visibly sharper texture and product detail.',
  },
  {
    feature: 'variations',
    workspace: 'studio',
    prompt: 'Heavy Chain 10M QA: one standalone variation of a premium black chain hoodie campaign image, same product identity, different premium studio lighting and background, no collage, no text, no watermark.',
    negativePrompt: 'text, logo, watermark, collage, grid, distorted garment, blurry',
    width: 1024,
    height: 1024,
    expected: 'A distinct but same-product campaign variation, not a grid.',
  },
];

const WORKSPACE_CONFIG = {
  patterns: {
    workflowVersion: 'pattern-preview-local-v1',
    sourceLabel: '柄・グラフィック',
    sourceResumePath: '/patterns',
    taskCode: 'PatternPreview',
  },
  studio: {
    workflowVersion: 'studio-selection-local-v1',
    sourceLabel: 'Fashion Studio',
    sourceResumePath: '/studio',
    taskCode: 'FashionStudio',
  },
};

const args = parseArgs(process.argv.slice(2));
await loadEnvFile(path.join(repoRoot, '.env.production.local'));

const mode = String(args.mode || 'enqueue');
const outDir = path.resolve(repoRoot, String(args.outDir || DEFAULT_OUT_DIR));
const runId = String(args.runId || `hc-10m-real-generation-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const manifestPath = path.resolve(outDir, String(args.manifest || 'run-manifest.json'));
const brandId = String(args.brandId || process.env.HC_QA_BRAND_ID || DEFAULT_BRAND_ID);
const userId = String(args.userId || process.env.HC_QA_USER_ID || DEFAULT_USER_ID);
const supabase = getSupabaseClient();

if (mode === 'enqueue') {
  await enqueueJobs();
} else if (mode === 'readback') {
  await readbackJobs();
} else if (mode === 'cleanup') {
  await cleanupJobs();
} else {
  throw new Error(`unknown_mode:${mode}`);
}

async function enqueueJobs() {
  await fs.mkdir(outDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const rows = FEATURE_SPECS.map((spec) => {
    const config = WORKSPACE_CONFIG[spec.workspace] || WORKSPACE_CONFIG.studio;
    const requestId = crypto.randomUUID();
    const marker = `${runId}:${spec.feature}`;
    return {
      brand_id: brandId,
      user_id: userId,
      feature_type: spec.feature,
      optimized_prompt: `${spec.prompt}\nMarker: ${marker}`,
      status: 'pending',
      error_message: null,
      input_params: {
        prompt: `${spec.prompt}\nMarker: ${marker}`,
        negativePrompt: spec.negativePrompt,
        width: spec.width,
        height: spec.height,
        count: 1,
        featureType: spec.feature,
        provider: PROVIDER,
        workerContractVersion: CONTRACT_VERSION,
        requestId,
        requestedAt: createdAt,
        verificationRunId: runId,
        verificationFeature: spec.feature,
        expectedVisualOutcome: spec.expected,
        model: spec.model || null,
        source: 'hc_10m_real_generation_qa',
        sourceWorkspace: spec.workspace,
        workflowVersion: config.workflowVersion,
        sourceLabel: config.sourceLabel,
        sourceResumePath: config.sourceResumePath,
        sourceMode: 'local-workflow-intake',
        generationIntent: {
          feature: spec.feature,
          prompt: `${spec.prompt}\nMarker: ${marker}`,
          href: `/generate?feature=${encodeURIComponent(spec.feature)}`,
          label: `${spec.feature} 10M real generation QA`,
          sourceWorkspace: spec.workspace,
          workflowVersion: config.workflowVersion,
          sourceLabel: config.sourceLabel,
          sourceResumePath: config.sourceResumePath,
          sourceMode: 'local-workflow-intake',
          aspectRatio: ratioFromDimensions(spec.width, spec.height),
        },
        lightchainCompat: {
          lightchainFeatureId: `hc-10m-${spec.feature}`,
          lightchainFeatureTitle: `Heavy Chain 10M QA ${spec.feature}`,
          lightchainTaskCodes: [config.taskCode],
        },
      },
    };
  });

  const { data, error } = await supabase
    .from('generation_jobs')
    .insert(rows)
    .select('id, feature_type, status, input_params, created_at');
  if (error) throw error;

  const jobs = (data || []).map((job) => {
    const input = asRecord(job.input_params);
    return {
      id: job.id,
      feature: job.feature_type,
      status: job.status,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      width: input.width,
      height: input.height,
      ratio: ratioFromDimensions(input.width, input.height),
      model: input.model || defaultModelForFeature(job.feature_type),
      expected: input.expectedVisualOutcome,
      createdAt: job.created_at,
      resultJsonPath: path.join('output/runway-mcp-results/inbox', `${job.id}.json`),
    };
  });
  const manifest = {
    schema: 'heavy-chain.10m-real-generation-qa.v1',
    runId,
    brandId,
    userId,
    createdAt,
    outDir: path.relative(repoRoot, outDir),
    jobs,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, mode, manifestPath, runId, jobCount: jobs.length, jobs }, null, 2));
}

async function readbackJobs() {
  const manifest = await readManifest();
  const jobIds = manifest.jobs.map((job) => job.id);
  const { data: jobs, error: jobsError } = await supabase
    .from('generation_jobs')
    .select('id, status, feature_type, error_message, input_params, completed_at, created_at')
    .in('id', jobIds);
  if (jobsError) throw jobsError;

  const { data: images, error: imagesError } = await supabase
    .from('generated_images')
    .select('id, job_id, feature_type, storage_path, image_url, prompt, model_used, metadata, created_at')
    .in('job_id', jobIds);
  if (imagesError) throw imagesError;

  const storage = [];
  for (const image of images || []) {
    if (!image.storage_path) continue;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(image.storage_path, 300);
    storage.push({
      imageId: image.id,
      jobId: image.job_id,
      feature: image.feature_type,
      storagePath: image.storage_path,
      signedUrlOk: Boolean(data?.signedUrl && !error),
      error: error?.message || null,
    });
  }

  const readback = {
    schema: 'heavy-chain.10m-real-generation-qa-readback.v1',
    capturedAt: new Date().toISOString(),
    runId: manifest.runId,
    counts: {
      jobs: jobs?.length || 0,
      completedJobs: (jobs || []).filter((job) => job.status === 'completed').length,
      failedJobs: (jobs || []).filter((job) => job.status === 'failed').length,
      images: images?.length || 0,
      storage: storage.length,
      signedUrlOk: storage.filter((row) => row.signedUrlOk).length,
    },
    jobs: (jobs || []).map(projectJob),
    images: (images || []).map(projectImage),
    storage,
  };
  const outPath = path.join(outDir, String(args.out || 'readback.json'));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(readback, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, mode, outPath, counts: readback.counts }, null, 2));
}

async function cleanupJobs() {
  const manifest = await readManifest();
  const jobIds = manifest.jobs.map((job) => job.id);
  const { data: images, error: imagesError } = await supabase
    .from('generated_images')
    .select('id, storage_path')
    .in('job_id', jobIds);
  if (imagesError) throw imagesError;
  const imageIds = (images || []).map((image) => image.id).filter(Boolean);
  const storagePaths = (images || []).map((image) => image.storage_path).filter(Boolean);
  const cleanup = {
    schema: 'heavy-chain.10m-real-generation-qa-cleanup.v1',
    capturedAt: new Date().toISOString(),
    runId: manifest.runId,
    attempted: true,
    imageIds,
    storagePaths,
    errors: [],
  };

  if (imageIds.length) {
    const { error } = await supabase.from('generated_images').delete().in('id', imageIds);
    if (error) cleanup.errors.push(`generated_images:${error.message}`);
  }
  if (storagePaths.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(storagePaths);
    if (error) cleanup.errors.push(`storage:${error.message}`);
  }
  await supabase.from('lightchain_task_steps').delete().in('job_id', jobIds).then(({ error }) => {
    if (error) cleanup.errors.push(`lightchain_task_steps:${error.message}`);
  });
  await supabase.from('generation_jobs').delete().in('id', jobIds).then(({ error }) => {
    if (error) cleanup.errors.push(`generation_jobs:${error.message}`);
  });

  const { data: remainingJobs } = await supabase.from('generation_jobs').select('id').in('id', jobIds);
  const { data: remainingImages } = imageIds.length
    ? await supabase.from('generated_images').select('id').in('id', imageIds)
    : { data: [] };
  cleanup.remaining = {
    jobs: remainingJobs?.length || 0,
    images: remainingImages?.length || 0,
  };
  cleanup.passed = cleanup.errors.length === 0 && cleanup.remaining.jobs === 0 && cleanup.remaining.images === 0;

  const outPath = path.join(outDir, String(args.out || 'cleanup.json'));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(cleanup, null, 2)}\n`);
  console.log(JSON.stringify({ ok: cleanup.passed, mode, outPath, remaining: cleanup.remaining, errors: cleanup.errors }, null, 2));
  if (!cleanup.passed) process.exit(1);
}

async function readManifest() {
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
}

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('supabase_service_role_env_missing');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadEnvFile(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] && !isPlaceholder(process.env[key])) continue;
      if (isPlaceholder(rawValue)) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Local env file is optional for CI-style use.
  }
}

function isPlaceholder(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  return /\b(PROJECT_REF|YOUR_|REPLACE_ME|example\.com)\b/i.test(text)
    || /^repl[a-z0-9_:-]*$/i.test(text);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function ratioFromDimensions(width, height) {
  const w = Number(width || 1024);
  const h = Number(height || 1024);
  if (w > h) return '16:9';
  if (h > w) return '9:16';
  return '1:1';
}

function defaultModelForFeature(feature) {
  return feature === 'multilingual-banner' ? 'gpt-image-2' : 'nano-banana-pro';
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function projectJob(row) {
  const input = asRecord(row.input_params);
  return {
    id: row.id,
    feature: row.feature_type,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    marker: input.verificationRunId || null,
    expected: input.expectedVisualOutcome || null,
    workerImageIds: Array.isArray(input.workerImageIds) ? input.workerImageIds : [],
    workerArtifactDir: input.workerArtifactDir || null,
  };
}

function projectImage(row) {
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    jobId: row.job_id,
    feature: row.feature_type,
    storagePath: row.storage_path,
    hasImageUrl: Boolean(row.image_url),
    modelUsed: row.model_used,
    createdAt: row.created_at,
    imageSha256: metadata.imageSha256 || null,
    workerTaskId: metadata.workerTaskId || null,
    source: metadata.source || null,
    artifactKind: metadata.artifactKind || null,
  };
}
