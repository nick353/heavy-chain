#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const PROVIDER = 'runway_mcp_local_worker';
const CONTRACT_VERSION = 'heavy-chain.local-runway-worker.v1';
const RUNWAY_MCP_URL = 'https://mcp.runwayml.com/mcp';
const CODEX_NPX_PATH = '/Applications/Codex.app/Contents/Resources/cua_node/bin/npx';
const MCP_REMOTE_PACKAGE = 'mcp-remote@0.1.37';
const DEFAULT_MCP_REMOTE_CONFIG_DIR = '/Users/nichikatanaka/.mcp-auth';
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

const redactWorkerInputParamsForMetadata = (inputParams) => {
  const redacted = { ...asRecord(inputParams) };
  if (typeof redacted.referenceImage === 'string' && redacted.referenceImage) {
    redacted.hasReferenceImage = true;
    redacted.referenceImageLength = redacted.referenceImage.length;
    delete redacted.referenceImage;
  }
  if (asRecord(redacted.referenceImageHandoff).storagePath) {
    redacted.hasReferenceImage = true;
  }
  if (Array.isArray(redacted.materialReferences)) {
    redacted.materialReferences = redacted.materialReferences.map((reference) => {
      const record = asRecord(reference);
      if (typeof record.imageUrl === 'string' && record.imageUrl) {
        const rest = { ...record };
        delete rest.imageUrl;
        return {
          ...rest,
          hasImage: true,
        };
      }
      return record;
    });
  }
  return redacted;
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

const getReferenceImageHandoffStoragePath = (inputParams) => {
  const handoff = asRecord(inputParams.referenceImageHandoff);
  return typeof handoff.storagePath === 'string' && handoff.storagePath ? handoff.storagePath : null;
};

const hydrateReferenceImageHandoff = async (supabase, inputParams) => {
  const storagePath = getReferenceImageHandoffStoragePath(inputParams);
  if (!storagePath || inputParams.referenceImage) return inputParams;
  const handoff = asRecord(inputParams.referenceImageHandoff);
  const { data, error } = await supabase.storage
    .from(String(handoff.bucket || GENERATED_IMAGES_BUCKET))
    .download(storagePath);
  if (error || !data) {
    throw error || new Error('local_runway_worker_reference_handoff_download_failed');
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return {
    ...inputParams,
    referenceImage: bufferToDataUrl(buffer, normalizeMimeType(handoff.mimeType)),
  };
};

const cleanupReferenceImageHandoff = async (supabase, inputParams) => {
  const storagePath = getReferenceImageHandoffStoragePath(inputParams);
  if (!storagePath) return [];
  const handoff = asRecord(inputParams.referenceImageHandoff);
  const { error } = await supabase.storage
    .from(String(handoff.bucket || GENERATED_IMAGES_BUCKET))
    .remove([storagePath]);
  return error ? [sanitizeError(error)] : [];
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

const readFileDataUrl = async (filePath) => {
  const absolutePath = path.resolve(repoRoot, filePath);
  const buffer = await fs.readFile(absolutePath);
  return bufferToDataUrl(buffer, mimeFromPath(absolutePath));
};

const urlToDataUrl = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`runway_mcp_image_download_failed:${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return bufferToDataUrl(buffer, normalizeMimeType(response.headers.get('content-type') || 'image/png'));
};

const assertRunwayMcpResultJobMatch = (result, expectedJobId, options = {}) => {
  const resultJobId = maybeRunwayMcpResultJobId(result);
  if (resultJobId && resultJobId !== expectedJobId) {
    throw new Error(`runway_mcp_result_job_id_mismatch:${resultJobId}:${expectedJobId}`);
  }
  if (!resultJobId && !options.allowUnmatched) {
    throw new Error(`runway_mcp_result_job_id_missing:${expectedJobId}`);
  }
};

const readRunwayMcpResultImages = async (resultPath, requestedCount, expectedJobId, options = {}) => {
  const absolutePath = path.resolve(repoRoot, resultPath);
  const result = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  assertRunwayMcpResultJobMatch(result, expectedJobId, options);
  if (result.auth_required || result.blocker === 'runway_mcp_auth_required') throw new Error('runway_mcp_auth_required');
  if (result.blocker) throw new Error(String(result.blocker));
  const summaryOutputPath = result.outputPath || result.final_art_path;
  const localPaths = [
    ...(Array.isArray(result.candidate_paths) ? result.candidate_paths : []),
    ...(summaryOutputPath ? [summaryOutputPath] : []),
  ].filter(Boolean);
  const urls = [
    ...(Array.isArray(result.candidate_urls) ? result.candidate_urls : []),
    ...(Array.isArray(result.image_urls) ? result.image_urls : []),
    ...(Array.isArray(result.asset_urls) ? result.asset_urls : []),
    ...(result.final_art_url ? [result.final_art_url] : []),
    ...(result.selected_candidate_url ? [result.selected_candidate_url] : []),
  ].filter((url) => String(url).startsWith('https://'));
  const rawResults = [result.rawTask, result.rawGenerated, result].filter(Boolean);
  const extractedUrls = rawResults
    .map(extractImageFromMcpResult)
    .map((item) => item.url)
    .filter(Boolean);
  const extractedDataUrls = rawResults
    .map(extractImageFromMcpResult)
    .map((item) => item.dataUrl)
    .filter(Boolean);
  const all = [];
  for (const dataUrl of extractedDataUrls) all.push({ dataUrl, source: 'mcp_result_inline_image' });
  for (const localPath of localPaths) all.push({ dataUrl: await readFileDataUrl(localPath), source: String(localPath) });
  for (const url of [...urls, ...extractedUrls]) all.push({ dataUrl: await urlToDataUrl(url), source: url });
  const unique = [];
  const seen = new Set();
  for (const item of all) {
    const digest = sha256(Buffer.from(item.dataUrl));
    if (seen.has(digest)) continue;
    seen.add(digest);
    unique.push(item);
  }
  if (unique.length === 0) throw new Error('runway_mcp_result_has_no_images');
  return unique.slice(0, Math.max(1, requestedCount)).map((item, index) => ({
    dataUrl: item.dataUrl,
    model: result.model || 'runway-mcp',
    taskId: result.taskId || result.rawGenerated?.result?.structuredContent?.taskId || `mcp-result-${index + 1}`,
    tool: 'mcp_result_import',
    source: item.source,
  }));
};

const readJsonFile = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const maybeRunwayMcpResultJobId = (result) => {
  const candidates = [
    result.heavyChainJobId,
    result.heavy_chain_job_id,
    result.generationJobId,
    result.generation_job_id,
    result.jobId,
    result.job_id,
    result.metadata?.heavyChainJobId,
    result.metadata?.generationJobId,
    result.source?.heavyChainJobId,
    result.source?.generationJobId,
  ].filter(Boolean);
  return typeof candidates[0] === 'string' ? candidates[0] : '';
};

const scanRunwayMcpResultFiles = async (watchDir) => {
  const absoluteWatchDir = path.resolve(repoRoot, watchDir);
  let entries = [];
  try {
    entries = await fs.readdir(absoluteWatchDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      await fs.mkdir(absoluteWatchDir, { recursive: true });
      return { resultFiles: [], rejectedFiles: [] };
    }
    throw error;
  }
  const resultFiles = [];
  const rejectedFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.startsWith('.')) continue;
    const filePath = path.join(absoluteWatchDir, entry.name);
    let stats = null;
    try {
      stats = await fs.stat(filePath);
      const result = await readJsonFile(filePath);
      resultFiles.push({
        filePath,
        fileName: entry.name,
        jobId: maybeRunwayMcpResultJobId(result),
        mtimeMs: stats.mtimeMs,
      });
    } catch (error) {
      rejectedFiles.push({
        filePath,
        fileName: entry.name,
        reason: 'json_parse_failed_or_unreadable',
        ageMs: stats ? Date.now() - stats.mtimeMs : null,
        error: sanitizeError(error),
      });
    }
  }
  return {
    resultFiles: resultFiles.sort((left, right) => left.mtimeMs - right.mtimeMs),
    rejectedFiles,
  };
};

const moveFileToDir = async (filePath, targetDir) => {
  const absoluteTargetDir = path.resolve(repoRoot, targetDir);
  await fs.mkdir(absoluteTargetDir, { recursive: true });
  const targetPath = path.join(absoluteTargetDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(filePath)}`);
  try {
    await fs.rename(filePath, targetPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await fs.copyFile(filePath, targetPath);
    await fs.unlink(filePath);
  }
  return targetPath;
};

const resolveMcpResultForJob = async (job, args, watchFiles, claimedFilePaths) => {
  if (args['mcp-result']) return String(args['mcp-result']);
  if (!args['watch-mcp-results']) return '';
  const explicit = watchFiles.find((file) => file.jobId === job.id && !claimedFilePaths.has(file.filePath));
  if (explicit) {
    claimedFilePaths.add(explicit.filePath);
    return explicit.filePath;
  }
  if (args['allow-unmatched-mcp-result']) {
    const unmatched = watchFiles.find((file) => !file.jobId && !claimedFilePaths.has(file.filePath));
    if (unmatched) {
      claimedFilePaths.add(unmatched.filePath);
      return unmatched.filePath;
    }
  }
  return '';
};

const collectStrings = (value, output = []) => {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
};

const responseById = (responses, id) => responses.find((response) => response.id === id);

const startRunwayMcp = () => {
  const mcpRemoteConfigDir = String(
    process.env.MCP_REMOTE_CONFIG_DIR || process.env.RUNWAY_MCP_REMOTE_CONFIG_DIR || DEFAULT_MCP_REMOTE_CONFIG_DIR,
  ).trim();
  const child = spawn(CODEX_NPX_PATH, ['-y', MCP_REMOTE_PACKAGE, RUNWAY_MCP_URL], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_REMOTE_CONFIG_DIR: mcpRemoteConfigDir,
      PATH: `/Applications/Codex.app/Contents/Resources/cua_node/bin:${path.join(repoRoot, 'node_modules/.bin')}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}`,
    },
  });
  const responses = [];
  let stdoutBuffer = '';
  let stderr = '';
  let nextId = 1;
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        responses.push(JSON.parse(trimmed));
      } catch {
        // mcp-remote may log non-JSON text while authenticating.
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const send = (method, params) => {
    const id = nextId;
    nextId += 1;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return id;
  };
  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };
  return { child, responses, send, notify, getStderr: () => stderr };
};

const waitForMcpResponse = async (mcp, id, timeoutMs) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const response = responseById(mcp.responses, id);
    if (response) return response;
    if (mcp.child.exitCode !== null) {
      throw new Error(`runway_mcp_remote_exited:${sanitizeError(mcp.getStderr().slice(-1200))}`);
    }
    await sleep(250);
  }
  const stderrTail = sanitizeError(mcp.getStderr().slice(-1200).trim());
  throw new Error(`runway_mcp_timeout:${id}${stderrTail ? `:${stderrTail}` : ''}`);
};

const initializeRunwayMcp = async (mcp) => {
  await sleep(Number(process.env.RUNWAY_MCP_STARTUP_DELAY_MS || 4000));
  const initId = mcp.send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'heavy-chain-local-runway-worker', version: '0.1.0' },
  });
  await waitForMcpResponse(mcp, initId, Number(process.env.RUNWAY_MCP_INIT_TIMEOUT_MS || 180000));
  mcp.notify('notifications/initialized', {});
};

const extractImageFromMcpResult = (result) => {
  const content = result?.result?.content || [];
  const image = content.find((item) => item.type === 'image' && item.data);
  if (image?.data) {
    return {
      dataUrl: `data:${normalizeMimeType(image.mimeType)};base64,${image.data}`,
      mimeType: normalizeMimeType(image.mimeType),
      url: '',
    };
  }
  const structuredUrl = result?.result?.structuredContent?.url;
  const urls = [
    ...(structuredUrl ? [structuredUrl] : []),
    ...collectStrings(result).flatMap((text) => Array.from(text.matchAll(/https?:\/\/[^\s)\]"'`]+/g)).map((match) => match[0])),
  ];
  return { dataUrl: '', mimeType: '', url: [...new Set(urls)][0] || '' };
};

const taskStatusFromMcpResult = (result) => {
  const strings = collectStrings(result).join('\n');
  const structuredKind = result?.result?.structuredContent?.kind || '';
  const statusMatch = strings.match(/"status"\s*:\s*"([A-Z_]+)"/) || strings.match(/\b(PENDING|RUNNING|THROTTLED|SUCCEEDED|FAILED|CANCELLED)\b/);
  return String(statusMatch?.[1] || structuredKind || '').toUpperCase();
};

const fetchImageDataUrl = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`runway_mcp_image_download_failed:${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return bufferToDataUrl(buffer, normalizeMimeType(response.headers.get('content-type') || 'image/png'));
};

const imageFromMcpResult = async (result) => {
  const extracted = extractImageFromMcpResult(result);
  if (extracted.dataUrl) return extracted.dataUrl;
  if (extracted.url) return fetchImageDataUrl(extracted.url);
  return '';
};

const callRunwayMcpDirect = async (job, inputParams, index, artifactDir) => {
  const mcp = startRunwayMcp();
  try {
    await initializeRunwayMcp(mcp);
    const prompt = String(inputParams.prompt || inputParams.promptText || job.optimized_prompt || '').trim();
    if (!prompt) throw new Error('local_runway_worker_prompt_missing');
    const operation = job.feature_type === 'upscale' ? 'upscale_via_reference_image' : 'generate_image';
    const generateId = mcp.send('tools/call', {
      name: 'generate_image',
      arguments: {
        rationale: `Heavy Chain local Runway worker ${operation} for job ${job.id}`,
        operation,
        model: String(inputParams.model || process.env.RUNWAY_MCP_IMAGE_MODEL || 'gpt-image-2'),
        promptText: index > 0 ? `${prompt}\nVariant ${index + 1}` : prompt,
        ratio: ratioFromDimensions(inputParams.width, inputParams.height),
        count: 1,
        referenceImages: inputParams.referenceImage ? [{ uri: inputParams.referenceImage }] : [],
      },
    });
    const generated = await waitForMcpResponse(mcp, generateId, Number(process.env.RUNWAY_MCP_GENERATE_TIMEOUT_MS || 180000));
    await fs.writeFile(path.join(artifactDir, `mcp-generate-${index + 1}.json`), `${JSON.stringify(generated, null, 2)}\n`);
    if (generated.error) throw new Error(`runway_mcp_generate_error:${sanitizeError(JSON.stringify(generated.error))}`);

    let taskResult = generated;
    const structured = generated.result?.structuredContent || {};
    const taskId = structured.taskId || structured.taskIds?.[0] || '';
    const firstImage = await imageFromMcpResult(taskResult);
    if (!firstImage && taskId) {
      const delays = [35000, 45000, 60000, 60000, 60000];
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        await sleep(delays[attempt]);
        const taskCheckId = mcp.send('tools/call', {
          name: 'get_task',
          arguments: {
            rationale: 'Retrieve generated image bytes and asset URL for Heavy Chain local worker.',
            id: taskId,
          },
        });
        taskResult = await waitForMcpResponse(mcp, taskCheckId, Number(process.env.RUNWAY_MCP_TASK_TIMEOUT_MS || 120000));
        await fs.writeFile(path.join(artifactDir, `mcp-task-${index + 1}-${attempt + 1}.json`), `${JSON.stringify(taskResult, null, 2)}\n`);
        const maybeImage = await imageFromMcpResult(taskResult);
        if (maybeImage) {
          return {
            dataUrl: maybeImage,
            model: structured.model || inputParams.model || process.env.RUNWAY_MCP_IMAGE_MODEL || 'gpt-image-2',
            taskId,
            tool: 'generate_image',
          };
        }
        const status = taskStatusFromMcpResult(taskResult);
        if (['FAILED', 'CANCELLED'].includes(status)) throw new Error(`runway_mcp_task_${status.toLowerCase()}:${taskId}`);
      }
    }
    const dataUrl = firstImage || await imageFromMcpResult(taskResult);
    if (!dataUrl) throw new Error(`runway_mcp_task_pending_without_output:${taskId || 'unknown'}:${taskStatusFromMcpResult(taskResult) || 'UNKNOWN'}`);
    return {
      dataUrl,
      model: structured.model || inputParams.model || process.env.RUNWAY_MCP_IMAGE_MODEL || 'gpt-image-2',
      taskId: taskId || crypto.randomUUID(),
      tool: 'generate_image',
    };
  } finally {
    mcp.child.kill('SIGTERM');
  }
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

const fetchJobById = async (supabase, jobId) => {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('id,status,error_message,input_params,completed_at')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

const claimJob = async (supabase, job) => {
  const inputParams = {
    ...asRecord(job.input_params),
    workerClaimedAt: new Date().toISOString(),
    workerContractVersion: CONTRACT_VERSION,
  };
  const persistedInputParams = {
    ...redactWorkerInputParamsForMetadata(inputParams),
    workerClaimedAt: inputParams.workerClaimedAt,
    workerContractVersion: CONTRACT_VERSION,
  };
  const { data, error } = await supabase
    .from('generation_jobs')
    .update({
      status: 'processing',
      input_params: persistedInputParams,
      error_message: null,
    })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('*')
    .single();
  if (error || !data) return null;
  return {
    ...data,
    input_params: inputParams,
  };
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
    ...redactWorkerInputParamsForMetadata(inputParams),
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
  await fs.writeFile(
    path.join(artifactDir, 'job.json'),
    `${JSON.stringify({
      ...claimed,
      input_params: redactWorkerInputParamsForMetadata(claimed.input_params),
    }, null, 2)}\n`,
  );
  const savedImages = [];
  const uploadedPaths = [];

  try {
    inputParams = await hydrateReferenceImageHandoff(supabase, inputParams);
    inputParams = validateJobInput(claimed, inputParams);
    const requestedCount = Math.max(1, Math.min(Number(inputParams.count || 1), 4));
    const workerResults = args['mcp-result']
      ? await readRunwayMcpResultImages(String(args['mcp-result']), requestedCount, claimed.id, {
        allowUnmatched: Boolean(args['allow-unmatched-mcp-result']),
      })
      : null;
    const resultCount = workerResults?.length || requestedCount;
    const images = [];
    for (let index = 0; index < resultCount; index += 1) {
      const result = workerResults?.[index]
        || (args['fixture-image']
        ? await readFixtureDataUrl(String(args['fixture-image']))
        : args['bridge-runway']
          ? await callRunwayBridge(claimed, inputParams, index)
        : args['live-runway']
          ? await callRunwayMcpDirect(claimed, inputParams, index, artifactDir)
          : (() => { throw new Error('live_runway_requires_explicit_flag_fixture_image_or_mcp_result'); })());
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
	          ...redactWorkerInputParamsForMetadata(inputParams),
	          workerCompletedAt: new Date().toISOString(),
	          workerArtifactDir: artifactDir,
	          workerImageIds: images.map((image) => image.id),
	        },
      })
      .eq('id', claimed.id);
    if (completeJobError) {
      const cleanupErrors = [
        ...await cleanupSavedImages(supabase, savedImages, uploadedPaths),
        ...await cleanupReferenceImageHandoff(supabase, inputParams),
      ];
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
	            ...redactWorkerInputParamsForMetadata(inputParams),
	            workerCompletedAt: new Date().toISOString(),
	            workerArtifactDir: artifactDir,
	            workerImageIds: images.map((image) => image.id),
	            usageCompletionError,
          },
        })
        .eq('id', claimed.id);
    }
    const referenceHandoffCleanupErrors = await cleanupReferenceImageHandoff(supabase, inputParams);
    if (referenceHandoffCleanupErrors.length > 0) {
      manifest.referenceHandoffCleanupErrors = referenceHandoffCleanupErrors;
      await fs.writeFile(path.join(artifactDir, 'worker-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return manifest;
  } catch (error) {
    const blocker = sanitizeError(error);
    const cleanupErrors = [
      ...await cleanupSavedImages(supabase, savedImages, uploadedPaths),
      ...await cleanupReferenceImageHandoff(supabase, inputParams),
    ];
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
	          ...redactWorkerInputParamsForMetadata(inputParams),
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
    console.log('Usage: node scripts/local-runway-mcp-worker.mjs [--loop] [--once] [--job-id <id>] [--fixture-image <path>] [--mcp-result <json>] [--watch-mcp-results <dir>] [--live-runway] [--bridge-runway] [--max-jobs 1] [--interval-ms 5000]');
    return;
  }
  const supabase = getSupabaseClient();
  const intervalMs = Math.max(1000, Number(args['interval-ms'] || 5000));
  const loop = Boolean(args.loop);
  do {
    const jobs = await fetchPendingJobs(supabase, args);
    const watchScan = args['watch-mcp-results']
      ? await scanRunwayMcpResultFiles(String(args['watch-mcp-results']))
      : { resultFiles: [], rejectedFiles: [] };
    const watchFiles = watchScan.resultFiles;
    const terminalJob = args['job-id'] && jobs.length === 0
      ? await fetchJobById(supabase, String(args['job-id']))
      : null;
    const claimedFilePaths = new Set();
    const results = [];
    if (args['job-id'] && jobs.length === 0 && (!terminalJob || terminalJob.status !== 'pending')) {
      results.push({
        status: terminalJob ? `job_${terminalJob.status}` : 'job_not_found',
        jobId: String(args['job-id']),
        terminal: true,
        errorMessage: terminalJob?.error_message || null,
      });
    }
    for (const job of jobs) {
      const mcpResultPath = await resolveMcpResultForJob(job, args, watchFiles, claimedFilePaths);
      if (args['watch-mcp-results'] && !mcpResultPath && !args['fixture-image'] && !args['live-runway'] && !args['bridge-runway']) {
        results.push({ status: 'waiting_for_mcp_result', jobId: job.id });
        continue;
      }
      const jobArgs = mcpResultPath ? { ...args, 'mcp-result': mcpResultPath } : args;
      const result = await processJob({ supabase, job, args: jobArgs });
      if (mcpResultPath && args['watch-mcp-results'] && !args['mcp-result']) {
        const targetDir = result.ok
          ? String(args['processed-dir'] || path.join(String(args['watch-mcp-results']), 'processed'))
          : String(args['failed-dir'] || path.join(String(args['watch-mcp-results']), 'failed'));
        result.mcpResultArchivePath = await moveFileToDir(mcpResultPath, targetDir);
      }
      results.push(result);
    }
    const summary = {
      ok: true,
      provider: PROVIDER,
      processed: results.length,
      results,
      liveRunway: Boolean(args['live-runway']),
      bridgeRunway: Boolean(args['bridge-runway']),
      mcpResult: args['mcp-result'] ? String(args['mcp-result']) : null,
      watchMcpResults: args['watch-mcp-results'] ? String(args['watch-mcp-results']) : null,
      watchMcpResultFiles: watchFiles.length,
      watchMcpRejectedFiles: watchScan.rejectedFiles,
      fixture: args['fixture-image'] ? String(args['fixture-image']) : null,
      loop,
      updatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!loop) break;
    if (args['job-id'] && results.some((result) => result.ok || result.terminal || result.status === 'failed' || result.status === 'skipped')) break;
    await sleep(intervalMs);
  } while (true);
};

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, blocker: sanitizeError(error) }, null, 2));
  process.exit(1);
});
