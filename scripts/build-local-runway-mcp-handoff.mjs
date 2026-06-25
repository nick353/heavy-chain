#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SCHEMA = 'heavy-chain.local-runway-mcp-handoff.v1';
const PROVIDER = 'runway_mcp_local_worker';
const CONTRACT_VERSION = 'heavy-chain.local-runway-worker.v1';
const DEFAULT_OUT_DIR = 'output/runway-mcp-handoffs';
const DEFAULT_INBOX_DIR = 'output/runway-mcp-results/inbox';
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

const usage = () => {
  console.log([
    'Usage:',
    '  node scripts/build-local-runway-mcp-handoff.mjs --out output/runway-mcp-handoffs [--max-jobs 5]',
    '  node scripts/build-local-runway-mcp-handoff.mjs --job-id <generation_job_id> --out output/runway-mcp-handoffs',
    '',
    'This is read-only. It creates handoff JSON for an approved Runway MCP client; it does not claim jobs or call Runway.',
  ].join('\n'));
};

const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const normalizeMimeType = (mimeType) => {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return clean.startsWith('image/') ? clean : 'image/png';
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
    case 'image/png':
    default:
      return 'png';
  }
};

const boundedNumber = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(Math.round(numeric), max));
};

const ratioFromDimensions = (width, height) => {
  const w = Number(width || 1024);
  const h = Number(height || 1024);
  if (w > h) return '16:9';
  if (h > w) return '9:16';
  return '1:1';
};

const sanitizeError = (error) => {
  const text = error instanceof Error ? error.message : String(error || 'local_runway_handoff_failed');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/token\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}["']?/gi, 'token=[redacted]')
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
    .slice(0, 900);
};

const assertValidReferenceImage = (value) => {
  if (!value) return;
  const text = String(value);
  const isDataImage = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(text);
  const isHttpsImage = /^https:\/\/[^\s]+$/i.test(text);
  if (!isDataImage && !isHttpsImage) throw new Error('local_runway_worker_reference_image_invalid');
  if (text.length > 1_500_000) throw new Error('local_runway_worker_reference_image_too_large');
};

const getReferenceImageHandoff = (inputParams) => {
  const handoff = asRecord(inputParams.referenceImageHandoff);
  return typeof handoff.storagePath === 'string' && handoff.storagePath
    ? handoff
    : null;
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

const fetchPendingJobs = async (supabase, args) => {
  let query = supabase
    .from('generation_jobs')
    .select('*')
    .eq('status', 'pending')
    .filter('input_params->>provider', 'eq', PROVIDER)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(Number(args['max-jobs'] || 5), 50)));
  if (args['job-id']) query = query.eq('id', String(args['job-id']));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

const validateJob = (job) => {
  const inputParams = asRecord(job.input_params);
  if (!ALLOWED_FEATURES.has(String(job.feature_type || ''))) {
    throw new Error(`local_runway_worker_feature_not_allowed:${job.id}`);
  }
  if (inputParams.provider !== PROVIDER) {
    throw new Error(`local_runway_worker_provider_invalid:${job.id}`);
  }
  if (inputParams.workerContractVersion !== CONTRACT_VERSION) {
    throw new Error(`local_runway_worker_contract_invalid:${job.id}`);
  }
  const prompt = String(inputParams.prompt || job.optimized_prompt || '').trim();
  if (!prompt || prompt.length > 8000) throw new Error(`local_runway_worker_prompt_invalid:${job.id}`);
  assertValidReferenceImage(inputParams.referenceImage);
  return {
    ...inputParams,
    prompt,
    width: boundedNumber(inputParams.width, 1024, 256, 2048),
    height: boundedNumber(inputParams.height, 1024, 256, 2048),
    count: boundedNumber(inputParams.count, 1, 1, 4),
  };
};

const promptForApprovedClient = (handoff) => {
  const resultFileName = `${handoff.heavyChainJobId}.json`;
  const lines = [
    'Use the approved Runway MCP client to generate images for this Heavy Chain job.',
    '',
    `Job ID: ${handoff.heavyChainJobId}`,
    `Tool: ${handoff.runway.tool}`,
    `Prompt: ${handoff.promptText}`,
    `Ratio: ${handoff.ratio}`,
    `Count: ${handoff.count}`,
  ];
  if (handoff.referenceImage) {
    lines.push(
      '',
      'Reference image handling:',
      `- Local reference file: ${handoff.referenceImage.localPath}`,
      `- MIME type: ${handoff.referenceImage.mimeType}`,
      `- SHA-256: ${handoff.referenceImage.sha256}`,
      '- Upload this file to Runway first with the approved MCP upload flow.',
      '- Use the returned Runway-hosted asset URL as referenceImages[0].url.',
      '- Do not pass Supabase signed URLs, data URLs, local filesystem paths, or Heavy Chain Storage paths directly to Runway referenceImages.',
    );
  }
  lines.push(
    '',
    'After generation succeeds, save a JSON file for the Heavy Chain worker with these required fields:',
    `- heavyChainJobId: "${handoff.heavyChainJobId}"`,
    `- generationJobId: "${handoff.generationJobId}"`,
    '- model: the Runway model name',
    '- candidate_paths: local absolute image paths, or candidate_urls/image_urls, or inline MCP image content',
    '',
    `Write the result JSON to: ${path.join(handoff.resultDrop.inboxDir, resultFileName)}`,
    'Do not use mcp-remote localhost OAuth, direct Runway API, billing, purchase, checkout, or external publish actions.',
  );
  return lines.join('\n');
};

const buildHandoff = async (supabase, job, args, outDir) => {
  const inputParams = validateJob(job);
  const tool = 'generate_image';
  const ratio = ratioFromDimensions(inputParams.width, inputParams.height);
  const inboxDir = String(args['inbox-dir'] || DEFAULT_INBOX_DIR);
  const referenceImage = await writeReferenceImageFile(supabase, job, inputParams, outDir);
  const handoff = {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    heavyChainJobId: job.id,
    generationJobId: job.id,
    brandId: job.brand_id,
    userId: job.user_id,
    featureType: job.feature_type,
    provider: PROVIDER,
    workerContractVersion: CONTRACT_VERSION,
    promptText: inputParams.prompt,
    negativePrompt: inputParams.negativePrompt || null,
    width: inputParams.width,
    height: inputParams.height,
    ratio,
    count: inputParams.count,
    referenceImage,
    referenceImages: referenceImage
      ? [{
        source: 'runway_hosted_asset_required',
        tag: String(inputParams.referenceType || 'reference'),
        localPath: referenceImage.localPath,
        mimeType: referenceImage.mimeType,
        sha256: referenceImage.sha256,
      }]
      : [],
    runway: {
      tool,
      operation: job.feature_type === 'upscale' ? 'upscale_via_reference_image' : 'generate_image',
      rationale: `Heavy Chain approved MCP client generation for job ${job.id}`,
      referenceImagePolicy: referenceImage ? 'upload_reference_to_runway_first' : 'none',
    },
    resultDrop: {
      inboxDir,
      requiredJobIdField: 'heavyChainJobId',
      resultFileName: `${job.id}.json`,
    },
    safety: {
      readOnlyHandoff: true,
      noJobClaim: true,
      noDirectRunwayApi: true,
      noMcpRemoteLocalhostOauth: true,
      noBillingPurchaseCheckoutOrPublish: true,
      noSupabaseSignedUrlInRunwayReferenceImages: true,
      noDataUrlInRunwayReferenceImages: true,
    },
  };
  return {
    ...handoff,
    approvedClientPrompt: promptForApprovedClient(handoff),
  };
};

const dataUrlToBuffer = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error('local_runway_handoff_reference_data_url_invalid');
  const mimeType = normalizeMimeType(match[1]);
  const payload = match[3] || '';
  const buffer = match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
  return { buffer, mimeType };
};

const fetchHttpsImage = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`local_runway_handoff_reference_fetch_failed:${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mimeType: normalizeMimeType(response.headers.get('content-type')) };
};

const readReferenceImageBytes = async (supabase, inputParams) => {
  const handoff = getReferenceImageHandoff(inputParams);
  if (handoff) {
    const bucket = String(handoff.bucket || 'generated-images');
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(String(handoff.storagePath));
    if (error || !data) throw error || new Error('local_runway_handoff_reference_handoff_download_failed');
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      mimeType: normalizeMimeType(handoff.mimeType),
      source: 'supabase_reference_handoff',
      storagePath: String(handoff.storagePath),
      bucket,
    };
  }
  if (inputParams.referenceImage) {
    const text = String(inputParams.referenceImage);
    const image = text.startsWith('data:')
      ? dataUrlToBuffer(text)
      : await fetchHttpsImage(text);
    return {
      ...image,
      source: text.startsWith('data:') ? 'input_data_url' : 'input_https_url',
    };
  }
  return null;
};

const writeReferenceImageFile = async (supabase, job, inputParams, outDir) => {
  const reference = await readReferenceImageBytes(supabase, inputParams);
  if (!reference) return null;
  const digest = sha256(reference.buffer);
  const mimeType = normalizeMimeType(reference.mimeType);
  const extension = extensionFromMimeType(mimeType);
  const referencesDir = path.resolve(repoRoot, outDir, 'references');
  await fs.mkdir(referencesDir, { recursive: true });
  const filePath = path.join(referencesDir, `${job.id}-${digest.slice(0, 12)}.${extension}`);
  await fs.writeFile(filePath, reference.buffer);
  return {
    source: reference.source,
    localPath: filePath,
    mimeType,
    bytes: reference.buffer.byteLength,
    sha256: digest,
    runwayAssetRequired: true,
    ...(reference.bucket ? { bucket: reference.bucket } : {}),
    ...(reference.storagePath ? { storagePath: reference.storagePath } : {}),
  };
};

const writeHandoff = async (handoff, outDir) => {
  const absoluteOutDir = path.resolve(repoRoot, outDir);
  await fs.mkdir(absoluteOutDir, { recursive: true });
  const filePath = path.join(absoluteOutDir, `${handoff.heavyChainJobId}.json`);
  const promptPath = path.join(absoluteOutDir, `${handoff.heavyChainJobId}.prompt.txt`);
  await fs.writeFile(filePath, `${JSON.stringify(handoff, null, 2)}\n`);
  await fs.writeFile(promptPath, `${handoff.approvedClientPrompt}\n`);
  return { filePath, promptPath, sha256: crypto.createHash('sha256').update(JSON.stringify(handoff)).digest('hex') };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }
  await loadEnvFile(path.resolve(repoRoot, '.env.production.local'));
  const outDir = String(args.out || DEFAULT_OUT_DIR);
  const supabase = getSupabaseClient();
  const jobs = await fetchPendingJobs(supabase, args);
  const outputs = [];
  for (const job of jobs) {
    const handoff = await buildHandoff(supabase, job, args, outDir);
    outputs.push({
      jobId: job.id,
      ...(await writeHandoff(handoff, outDir)),
    });
  }
  console.log(JSON.stringify({
    ok: true,
    schema: SCHEMA,
    provider: PROVIDER,
    outDir: path.resolve(repoRoot, outDir),
    inboxDir: String(args['inbox-dir'] || DEFAULT_INBOX_DIR),
    jobCount: jobs.length,
    outputs,
    readOnly: true,
    updatedAt: new Date().toISOString(),
  }, null, 2));
};

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, blocker: sanitizeError(error) }, null, 2));
  process.exit(1);
});
