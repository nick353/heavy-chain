#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CODEX_NPX_PATH = '/Applications/Codex.app/Contents/Resources/cua_node/bin/npx';
const MCP_REMOTE_PACKAGE = 'mcp-remote@0.1.37';
const RUNWAY_MCP_URL = 'https://mcp.runwayml.com/mcp';
const DEFAULT_CALLBACK_PORT = '15555';
const DEFAULT_INBOX_DIR = 'output/runway-mcp-results/inbox';

const args = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(repoRoot, String(args.manifest || ''));
const inboxDir = path.resolve(repoRoot, String(args['inbox-dir'] || DEFAULT_INBOX_DIR));
const outDir = path.resolve(repoRoot, String(args.out || path.join('output/playwright', `g617-runway-mcp-generate-${dateStamp(new Date())}`)));
const maxJobs = args['max-jobs'] ? Number(args['max-jobs']) : Infinity;
const selectedFeatures = new Set(String(args.features || '').split(',').map((item) => item.trim()).filter(Boolean));
const callbackPort = String(args['callback-port'] || DEFAULT_CALLBACK_PORT);
const pollAttempts = Number(args['poll-attempts'] || 10);
const pollDelayMs = Number(args['poll-delay-ms'] || 30000);

if (!manifestPath || manifestPath === repoRoot) {
  throw new Error('manifest_required');
}

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(inboxDir, { recursive: true });

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const jobs = (manifest.jobs || [])
  .filter((job) => selectedFeatures.size === 0 || selectedFeatures.has(job.feature))
  .slice(0, Number.isFinite(maxJobs) ? maxJobs : undefined);

const mcp = startRunwayMcp();
const runProof = {
  schema: 'heavy-chain.g617-runway-mcp-generation.v1',
  capturedAt: new Date().toISOString(),
  manifestPath: path.relative(repoRoot, manifestPath),
  runId: manifest.runId,
  noDirectRunwayApi: true,
  callbackPort,
  inboxDir: path.relative(repoRoot, inboxDir),
  jobs: [],
  ok: false,
  failed: [],
};

try {
  await initializeRunwayMcp(mcp);
  for (const job of jobs) {
    const result = await generateJob(job);
    runProof.jobs.push(result);
    await fs.writeFile(path.join(outDir, 'progress.json'), `${JSON.stringify(runProof, null, 2)}\n`);
    if (!result.ok && args['stop-on-error'] !== 'false') break;
  }
  runProof.ok = runProof.jobs.length === jobs.length && runProof.jobs.every((job) => job.ok);
  runProof.failed = runProof.jobs.filter((job) => !job.ok).map((job) => job.id);
} finally {
  mcp.child.kill('SIGTERM');
  await fs.writeFile(path.join(outDir, 'proof.json'), `${JSON.stringify(runProof, null, 2)}\n`);
}

console.log(JSON.stringify({
  ok: runProof.ok,
  outDir: path.relative(repoRoot, outDir),
  proof: path.relative(repoRoot, path.join(outDir, 'proof.json')),
  processed: runProof.jobs.length,
  failed: runProof.failed,
}, null, 2));

process.exit(runProof.ok ? 0 : 1);

async function generateJob(job) {
  const startedAt = new Date().toISOString();
  const artifactDir = path.join(outDir, job.feature);
  await fs.mkdir(artifactDir, { recursive: true });
  const model = String(args.model || job.model || defaultModelForFeature(job.feature));
  const ratio = String(job.ratio || ratioFromDimensions(job.width, job.height));
  const promptText = String(job.prompt || '').trim();
  const base = {
    id: job.id,
    feature: job.feature,
    model,
    ratio,
    startedAt,
    ok: false,
    resultJsonPath: job.resultJsonPath || path.relative(repoRoot, path.join(inboxDir, `${job.id}.json`)),
  };
  try {
    const generate = await callTool('generate_image', {
      rationale: `Heavy Chain G617 same-run fresh generation for ${job.feature}; save result JSON for local worker import.`,
      model,
      promptText,
      ratio,
      count: 1,
    }, Number(args['generate-timeout-ms'] || 180000));
    await fs.writeFile(path.join(artifactDir, 'mcp-generate.json'), `${JSON.stringify(generate, null, 2)}\n`);
    if (generate.error || generate.result?.isError) {
      throw new Error(`runway_generate_error:${extractText(generate).slice(0, 700)}`);
    }

    let rawTask = generate;
    let taskId = extractTaskId(generate);
    let imageUrls = extractUrls(generate);
    let status = taskStatus(generate);
    for (let attempt = 1; imageUrls.length === 0 && taskId && attempt <= pollAttempts; attempt += 1) {
      await sleep(pollDelayMs);
      rawTask = await callTool('get_task', {
        rationale: `Retrieve completed Runway image for Heavy Chain G617 ${job.feature}.`,
        id: taskId,
      }, Number(args['task-timeout-ms'] || 120000));
      await fs.writeFile(path.join(artifactDir, `mcp-task-${attempt}.json`), `${JSON.stringify(rawTask, null, 2)}\n`);
      imageUrls = extractUrls(rawTask);
      status = taskStatus(rawTask);
      if (rawTask.error || rawTask.result?.isError) throw new Error(`runway_task_error:${extractText(rawTask).slice(0, 700)}`);
      if (['FAILED', 'CANCELLED'].includes(status)) throw new Error(`runway_task_${status.toLowerCase()}:${taskId}`);
    }

    if (!taskId) taskId = extractTaskId(rawTask);
    if (imageUrls.length === 0) throw new Error(`runway_task_no_image:${taskId || 'no-task-id'}:${status || 'UNKNOWN'}`);

    const resultJson = {
      schema: 'heavy-chain.runway-mcp-result.v1',
      createdAt: new Date().toISOString(),
      heavyChainJobId: job.id,
      generationJobId: job.id,
      feature: job.feature,
      model,
      taskId,
      candidate_urls: imageUrls,
      image_urls: imageUrls,
      rawGenerated: generate,
      rawTask,
      source: {
        runId: manifest.runId,
        manifestPath: path.relative(repoRoot, manifestPath),
        tool: 'generate_image',
        callbackPort,
      },
    };
    const resultPath = path.resolve(repoRoot, job.resultJsonPath || path.join(inboxDir, `${job.id}.json`));
    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.writeFile(resultPath, `${JSON.stringify(resultJson, null, 2)}\n`);
    return {
      ...base,
      ok: true,
      taskId,
      status,
      imageUrls,
      completedAt: new Date().toISOString(),
      resultJsonPath: path.relative(repoRoot, resultPath),
    };
  } catch (error) {
    const blocker = sanitizeError(error);
    const blockerPath = path.join(artifactDir, 'blocker.json');
    await fs.writeFile(blockerPath, `${JSON.stringify({ ...base, blocker, completedAt: new Date().toISOString() }, null, 2)}\n`);
    return {
      ...base,
      ok: false,
      blocker,
      completedAt: new Date().toISOString(),
      blockerPath: path.relative(repoRoot, blockerPath),
    };
  }
}

function startRunwayMcp() {
  const child = spawn(CODEX_NPX_PATH, ['-y', MCP_REMOTE_PACKAGE, RUNWAY_MCP_URL, callbackPort, '--auth-timeout', '60'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MCP_REMOTE_CONFIG_DIR: process.env.MCP_REMOTE_CONFIG_DIR || '/Users/nichikatanaka/.mcp-auth',
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
      try {
        responses.push(JSON.parse(line.trim()));
      } catch {
        // mcp-remote logs are on stderr, but keep stdout parsing defensive.
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
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
}

async function initializeRunwayMcp(mcp) {
  const initId = mcp.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'heavy-chain-g617-runway-mcp-generation', version: '0.1.0' },
  });
  await waitForMcpResponse(mcp, initId, Number(args['init-timeout-ms'] || 180000));
  mcp.notify('notifications/initialized', {});
}

async function callTool(name, toolArgs, timeoutMs) {
  const id = mcp.send('tools/call', { name, arguments: toolArgs });
  return waitForMcpResponse(mcp, id, timeoutMs);
}

async function waitForMcpResponse(mcp, id, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const response = mcp.responses.find((item) => item.id === id);
    if (response) return response;
    if (mcp.child.exitCode !== null) {
      throw new Error(`runway_mcp_remote_exited:${sanitizeError(mcp.getStderr().slice(-1600))}`);
    }
    await sleep(250);
  }
  throw new Error(`runway_mcp_timeout:${id}:${sanitizeError(mcp.getStderr().slice(-1600))}`);
}

function extractText(result) {
  return collectStrings(result).join('\n');
}

function extractTaskId(result) {
  const structured = result?.result?.structuredContent || {};
  const candidates = [
    structured.taskId,
    ...(Array.isArray(structured.taskIds) ? structured.taskIds : []),
    ...collectStrings(result).flatMap((text) => Array.from(text.matchAll(/(?:taskId|task_id|id)["':\s]+([a-zA-Z0-9_-]{8,})/g)).map((match) => match[1])),
  ].filter(Boolean);
  return typeof candidates[0] === 'string' ? candidates[0] : '';
}

function extractUrls(result) {
  const structured = result?.result?.structuredContent || {};
  const candidates = [
    structured.url,
    structured.assetUrl,
    structured.imageUrl,
    ...(Array.isArray(structured.urls) ? structured.urls : []),
    ...(Array.isArray(structured.imageUrls) ? structured.imageUrls : []),
    ...collectStrings(result).flatMap((text) => Array.from(text.matchAll(/https?:\/\/[^\s)\]"'`]+/g)).map((match) => match[0])),
  ].filter((url) => typeof url === 'string' && /^https:\/\//.test(url));
  return [...new Set(candidates.map((url) => url.replace(/[),.]+$/g, '')))];
}

function taskStatus(result) {
  const structured = result?.result?.structuredContent || {};
  const text = extractText(result);
  const match = text.match(/"status"\s*:\s*"([A-Z_]+)"/) || text.match(/\b(PENDING|RUNNING|THROTTLED|SUCCEEDED|FAILED|CANCELLED)\b/);
  return String(structured.status || match?.[1] || '').toUpperCase();
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function defaultModelForFeature(feature) {
  return feature === 'multilingual-banner' ? 'gpt-image-2' : 'nano-banana-pro';
}

function ratioFromDimensions(width, height) {
  const w = Number(width || 1024);
  const h = Number(height || 1024);
  if (w > h) return '16:9';
  if (h > w) return '9:16';
  return '1:1';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeError(error) {
  const text = error instanceof Error ? error.message : String(error || 'runway_mcp_generation_failed');
  return text
    .replace(/client_id=[^&\s]+/g, 'client_id=[redacted]')
    .replace(/code_challenge=[^&\s]+/g, 'code_challenge=[redacted]')
    .replace(/state=[^&\s]+/g, 'state=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .slice(0, 1200);
}

function dateStamp(date) {
  return date.toISOString().replace(/[-:.]/g, '').slice(0, 15);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
