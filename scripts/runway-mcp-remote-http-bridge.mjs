#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNWAY_MCP_URL = 'https://mcp.runwayml.com/mcp';
const CODEX_NPX_PATH = '/Applications/Codex.app/Contents/Resources/cua_node/bin/npx';
const DEFAULT_PORT = 58744;
const DEFAULT_IMAGE_MODEL = 'gen-4';
const DEFAULT_UPSCALE_MODEL = 'magnific_precision_upscaler_v2';
const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024;
const DEFAULT_MCP_REMOTE_PACKAGE = 'mcp-remote@0.1.37';
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const args = parseArgs(process.argv.slice(2));
const token = String(process.env.RUNWAY_MCP_BRIDGE_TOKEN || '').trim();
const host = String(args.host || process.env.RUNWAY_MCP_BRIDGE_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1')).trim();
const port = Number(args.port || process.env.RUNWAY_MCP_BRIDGE_PORT || process.env.PORT || DEFAULT_PORT);
const maxBodyBytes = positiveInteger(
  process.env.RUNWAY_MCP_BRIDGE_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES,
  'RUNWAY_MCP_BRIDGE_MAX_BODY_BYTES',
);
const mcpRemoteConfigDir = String(process.env.RUNWAY_MCP_REMOTE_CONFIG_DIR || process.env.MCP_REMOTE_CONFIG_DIR || '').trim();
const activeMcpChildren = new Set();
let shuttingDown = false;

if (!token) {
  console.error('RUNWAY_MCP_BRIDGE_TOKEN is required.');
  process.exit(1);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('A valid --port or RUNWAY_MCP_BRIDGE_PORT is required.');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return jsonResponse(res, 200, {
        ok: true,
        service: 'runway-mcp-remote-http-bridge',
      });
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      requireBridgeAuth(req);
      return jsonResponse(res, 200, {
        ok: true,
        service: 'runway-mcp-remote-http-bridge',
        host,
        port,
        auth_cache_configured: Boolean(mcpRemoteConfigDir),
        token_present: true,
      });
    }

    if (req.method !== 'POST') {
      return jsonResponse(res, 405, { error: 'method_not_allowed' });
    }

    requireBridgeAuth(req);
    const payload = asRecord(await readJson(req)) || {};

    if (url.pathname === '/tools') {
      const mcp = startMcp();
      try {
        await initialize(mcp);
        const tools = await listTools(mcp);
        return jsonResponse(res, 200, {
          ok: true,
          tools: tools.map(projectTool),
        });
      } finally {
        await stopMcp(mcp);
      }
    }

    if (url.pathname === '/text-to-image') {
      const result = await callRunwayImageTool('text-to-image', payload);
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/image-upscale') {
      const result = await callRunwayImageTool('image-upscale', payload);
      return jsonResponse(res, 200, result);
    }

    return jsonResponse(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = sanitizeSecretText(error instanceof Error ? error.message : String(error || 'bridge_failed'));
    return jsonResponse(res, mapErrorStatus(message, error), { error: message });
  }
});

server.once('error', (error) => {
  console.error(`Runway MCP remote HTTP bridge failed to listen: ${sanitizeSecretText(error.message)}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Runway MCP remote HTTP bridge listening on http://${host}:${port}`);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--port' && next) {
      parsed.port = next;
      index += 1;
    } else if (arg === '--host' && next) {
      parsed.host = next;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: RUNWAY_MCP_BRIDGE_TOKEN=... node scripts/runway-mcp-remote-http-bridge.mjs [--host 127.0.0.1] [--port 58744]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [...activeMcpChildren]) {
    await stopChild(child);
  }
  await new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
  });
  process.exit(exitCode);
}

function requireBridgeAuth(req) {
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!supplied || supplied !== token) {
    throw httpError('unauthorized_bridge_request', 401);
  }
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapErrorStatus(message, error = null) {
  if (Number.isInteger(error?.status)) return error.status;
  if (/unauthorized|auth_required|consent|login/i.test(message)) return 401;
  if (/\b(401|403)\b/.test(message)) return 401;
  if (/subscription|billing|payment|credits?|quota|plan|upgrade|paid|hard limit|insufficient_quota/i.test(message)) return 402;
  if (/\b402\b/.test(message)) return 402;
  if (/not_found/i.test(message)) return 404;
  if (/payload_too_large/i.test(message)) return 413;
  if (/required|invalid|empty_request|tool_unavailable/i.test(message)) return 400;
  return 502;
}

async function readJson(req) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw httpError('payload_too_large', 413);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBodyBytes) {
      req.destroy?.();
      throw httpError('payload_too_large', 413);
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw httpError('invalid_json_body', 400);
  }
}

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(redactForResponse(data), null, 2)}\n`);
}

function startMcp() {
  const childEnv = { ...process.env };
  delete childEnv.RUNWAY_MCP_BRIDGE_TOKEN;
  delete childEnv.RUNWAY_MCP_BRIDGE_URL;
  delete childEnv.Authorization;
  delete childEnv.AUTHORIZATION;
  if (mcpRemoteConfigDir) childEnv.MCP_REMOTE_CONFIG_DIR = mcpRemoteConfigDir;

  const { command, args } = mcpRemoteCommand();
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...childEnv,
      PATH: `/Applications/Codex.app/Contents/Resources/cua_node/bin:${join(repoRoot, 'node_modules/.bin')}:${childEnv.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}`,
    },
  });
  const responses = [];
  let stdoutBuffer = '';
  let stderr = '';
  let nextId = 1;
  activeMcpChildren.add(child);
  child.once('close', () => activeMcpChildren.delete(child));
  child.once('exit', () => activeMcpChildren.delete(child));

  const flushStdoutLine = (line, { keepInvalid = false } = {}) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    try {
      responses.push(JSON.parse(trimmed));
      return true;
    } catch {
      // mcp-remote may occasionally log to stdout; do not echo it.
      return !keepInvalid;
    }
  };
  const flushStdoutBuffer = ({ final = false } = {}) => {
    if (!stdoutBuffer.trim()) return;
    if (flushStdoutLine(stdoutBuffer, { keepInvalid: !final }) || final) {
      stdoutBuffer = '';
    }
  };

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      flushStdoutLine(line);
    }
  });
  child.stdout.on('end', () => flushStdoutBuffer({ final: true }));
  child.stdout.on('close', () => flushStdoutBuffer({ final: true }));
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

  return { child, responses, send, notify, flushStdoutBuffer, getStderr: () => stderr };
}

function mcpRemoteCommand() {
  const explicitCommand = String(process.env.RUNWAY_MCP_REMOTE_COMMAND || '').trim();
  const extraArgs = mcpRemoteArgs();
  if (explicitCommand) {
    return { command: explicitCommand, args: [RUNWAY_MCP_URL, ...extraArgs] };
  }

  const localBin = join(repoRoot, 'node_modules/.bin/mcp-remote');
  if (existsSync(localBin)) {
    return { command: localBin, args: [RUNWAY_MCP_URL, ...extraArgs] };
  }

  const npxPath = existsSync(CODEX_NPX_PATH) ? CODEX_NPX_PATH : 'npx';
  const mcpRemotePackage = String(process.env.RUNWAY_MCP_REMOTE_PACKAGE || DEFAULT_MCP_REMOTE_PACKAGE).trim();
  return { command: npxPath, args: ['-y', mcpRemotePackage, RUNWAY_MCP_URL, ...extraArgs] };
}

function mcpRemoteArgs() {
  const args = [];
  const callbackPort = String(process.env.RUNWAY_MCP_REMOTE_CALLBACK_PORT || '').trim();
  const callbackHost = String(process.env.RUNWAY_MCP_REMOTE_CALLBACK_HOST || '').trim();
  const transport = String(process.env.RUNWAY_MCP_REMOTE_TRANSPORT || '').trim();
  const resource = String(process.env.RUNWAY_MCP_REMOTE_RESOURCE || '').trim();
  const authTimeout = String(process.env.RUNWAY_MCP_REMOTE_AUTH_TIMEOUT_SECONDS || '').trim();
  const staticMetadata = staticOAuthArg('RUNWAY_MCP_STATIC_OAUTH_CLIENT_METADATA', 'RUNWAY_MCP_STATIC_OAUTH_CLIENT_METADATA_FILE');
  const staticClientInfo = staticOAuthArg('', 'RUNWAY_MCP_STATIC_OAUTH_CLIENT_INFO_FILE');

  if (callbackPort) args.push(callbackPort);
  if (callbackHost) args.push('--host', callbackHost);
  if (transport) args.push('--transport', transport);
  if (resource) args.push('--resource', resource);
  if (authTimeout) args.push('--auth-timeout', authTimeout);
  if (staticMetadata) args.push('--static-oauth-client-metadata', staticMetadata);
  if (staticClientInfo) args.push('--static-oauth-client-info', staticClientInfo);
  if (process.env.RUNWAY_MCP_REMOTE_DEBUG === '1') args.push('--debug');
  if (process.env.RUNWAY_MCP_REMOTE_SILENT !== '0') args.push('--silent');
  return args;
}

function staticOAuthArg(jsonEnvName, fileEnvName) {
  const filePath = String(process.env[fileEnvName] || '').trim();
  if (filePath) return filePath.startsWith('@') ? filePath : `@${filePath}`;
  if (!jsonEnvName) return '';
  return String(process.env[jsonEnvName] || '').trim();
}

async function stopMcp(mcp) {
  if (mcp?.child) await stopChild(mcp.child);
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let killTimer;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      if (killTimer) clearTimeout(killTimer);
      activeMcpChildren.delete(child);
      resolve();
    };
    child.once('close', done);
    if (child.exitCode !== null) return done();
    child.stdin?.end?.();
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 3000);
    killTimer.unref?.();
  });
}

async function initialize(mcp) {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const initId = mcp.send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'heavy-chain-runway-mcp-remote-http-bridge', version: '0.1.0' },
  });
  const response = await waitForResponse(mcp, initId, 90000);
  if (response.error) throw new Error(`runway_mcp_initialize_failed:${JSON.stringify(response.error)}`);
  mcp.notify('notifications/initialized', {});
}

async function waitForResponse(mcp, id, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    mcp.flushStdoutBuffer?.();
    const response = mcp.responses.find((candidate) => candidate.id === id);
    if (response) return response;
    if (mcp.child.exitCode !== null) {
      throw new Error(`runway_mcp_remote_exited:${sanitizeSecretText(mcp.getStderr()).slice(0, 700)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout_waiting_for_runway_mcp_response:${id}`);
}

async function listTools(mcp) {
  const listId = mcp.send('tools/list', {});
  const list = await waitForResponse(mcp, listId, 60000);
  if (list.error) throw new Error(`runway_mcp_tools_list_failed:${JSON.stringify(list.error)}`);
  return Array.isArray(list.result?.tools) ? list.result.tools : [];
}

async function callRunwayImageTool(action, payload) {
  const mcp = startMcp();
  try {
    await initialize(mcp);
    const tools = await listTools(mcp);
    const tool = selectTool(tools, action);
    if (!tool?.name) {
      throw httpError(`runway_mcp_tool_unavailable:${action}`, 400);
    }

    const callId = mcp.send('tools/call', {
      name: tool.name,
      arguments: buildToolArguments(payload, action),
    });
    const initial = await waitForResponse(mcp, callId, 180000);
    if (initial.error) throw new Error(`runway_mcp_tool_call_failed:${JSON.stringify(initial.error)}`);
    if (initial.result?.isError) {
      throw new Error(`runway_mcp_tool_call_error:${summarizeMcpError(initial)}`);
    }

    const finalResult = await pollPendingTask(mcp, initial);
    const image = extractImageResult(finalResult, payload.model || fallbackModel(action));
    if (!image.base64 && !image.outputUrl) {
      throw new Error(`runway_mcp_empty_image_response:${JSON.stringify(safeShape(finalResult)).slice(0, 900)}`);
    }

    return {
      base64: image.base64,
      dataUrl: image.dataUrl,
      outputUrl: image.outputUrl,
      mimeType: image.mimeType || 'image/png',
      model: image.model || payload.model || fallbackModel(action),
      taskId: image.taskId || crypto.randomUUID(),
      tool: tool.name,
    };
  } finally {
    await stopMcp(mcp);
  }
}

async function pollPendingTask(mcp, initial) {
  let current = initial;
  const taskId = initial.result?.structuredContent?.taskId || initial.result?.structuredContent?.id || '';
  if (!taskId) return current;
  const initialProbe = extractImageResult(current, '');
  if (initialProbe.base64 || initialProbe.outputUrl) return current;

  const delaysMs = [35000, 45000, 60000, 60000, 60000];
  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    const taskIdResponse = mcp.send('tools/call', {
      name: 'get_task',
      arguments: {
        rationale: 'Retrieve generated image bytes or asset URL for a Heavy Chain local Runway MCP bridge call.',
        id: taskId,
      },
    });
    current = await waitForResponse(mcp, taskIdResponse, 120000);
    if (current.error) throw new Error(`runway_mcp_task_poll_failed:${JSON.stringify(current.error)}`);
    if (current.result?.isError) {
      throw new Error(`runway_mcp_task_poll_error:${summarizeMcpError(current)}`);
    }
    const probe = extractImageResult(current, '');
    if (probe.base64 || probe.outputUrl) return current;
    const status = taskStatusFromResult(current);
    if (['FAILED', 'CANCELLED'].includes(status)) {
      throw new Error(`runway_mcp_task_${status.toLowerCase()}`);
    }
  }
  return current;
}

function summarizeMcpError(response) {
  const structured = asRecord(response?.result?.structuredContent);
  const errors = Array.isArray(structured?.errors) ? structured.errors.filter((entry) => typeof entry === 'string') : [];
  const text = collectStrings(response?.result?.content || []).join(' ');
  const summary = errors.length ? errors.join('; ') : text;
  return sanitizeSecretText(summary || JSON.stringify(safeShape(response))).slice(0, 1200);
}

function selectTool(tools, action) {
  const projected = tools.map(projectTool).filter((tool) => tool.name);
  const preferred = action === 'image-upscale'
    ? ['upscale', 'magnific']
    : ['text_to_image', 'text-to-image', 'generate_image', 'image_generation', 'gen4', 'image'];

  return projected.find((tool) => {
    const haystack = `${tool.name} ${tool.description || ''}`.toLowerCase();
    return preferred.some((needle) => haystack.includes(needle));
  }) || projected[0] || null;
}

function buildToolArguments(payload, action) {
  if (action === 'image-upscale') {
    const image = asRecord(payload.image);
    const base64 = stringField(payload, ['base64']) || stringField(image, ['base64']);
    const mimeType = stringField(payload, ['mimeType', 'mime_type']) || stringField(image, ['mimeType', 'mime_type']) || 'image/png';
    const dataUrl = stringField(image, ['dataUrl', 'data_url', 'uri', 'url'])
      || (base64 ? `data:${mimeType};base64,${base64}` : '');
    if (!dataUrl && !base64) throw httpError('image_required', 400);
    return {
      image: dataUrl || base64,
      mimeType,
      prompt: stringField(payload, ['prompt']) || 'Upscale this image while preserving details.',
      model: stringField(payload, ['model']) || DEFAULT_UPSCALE_MODEL,
      rationale: stringField(payload, ['rationale']) || 'Upscale a Heavy Chain image through Runway MCP.',
    };
  }

  const prompt = stringField(payload, ['promptText', 'prompt']);
  if (!prompt) throw httpError('prompt_required', 400);
  return {
    rationale: stringField(payload, ['rationale']) || 'Generate a Heavy Chain image through Runway MCP.',
    model: stringField(payload, ['model']) || DEFAULT_IMAGE_MODEL,
    promptText: prompt,
    ratio: stringField(payload, ['ratio']) || ratioFromDimensions(payload.width, payload.height),
    count: Number.isInteger(payload.count) ? payload.count : 1,
    referenceImages: Array.isArray(payload.referenceImages) ? payload.referenceImages : [],
  };
}

function ratioFromDimensions(width, height) {
  const w = Number(width || 1024);
  const h = Number(height || 1024);
  if (w > h) return '16:9';
  if (h > w) return '9:16';
  return '1:1';
}

function fallbackModel(action) {
  return action === 'image-upscale' ? DEFAULT_UPSCALE_MODEL : DEFAULT_IMAGE_MODEL;
}

function extractImageResult(response, fallbackModelValue) {
  const result = response?.result || response;
  const record = asRecord(result);
  const structured = asRecord(record?.structuredContent);
  const content = Array.isArray(record?.content) ? record.content : [];
  const firstImageContent = content
    .map((item) => asRecord(item))
    .find((item) => item && (typeof item.data === 'string' || typeof item.url === 'string')) || null;
  const dataUrl = stringField(record, ['dataUrl', 'data_url', 'url', 'uri'])
    || stringField(structured, ['dataUrl', 'data_url', 'url', 'uri'])
    || stringField(firstImageContent, ['dataUrl', 'data_url', 'url', 'uri']);
  const parsed = parseDataUrl(dataUrl);
  const nestedUrls = collectStrings(response)
    .flatMap((text) => Array.from(text.matchAll(/https?:\/\/[^\s)\]"'`]+/g)).map((match) => match[0]));
  const base64 = parsed?.base64
    || stringField(record, ['base64', 'data'])
    || stringField(structured, ['base64', 'data'])
    || stringField(firstImageContent, ['base64', 'data']);
  const outputUrl = dataUrl && !dataUrl.startsWith('data:')
    ? dataUrl
    : stringField(record, ['outputUrl', 'output_url']) || stringField(structured, ['outputUrl', 'output_url']) || [...new Set(nestedUrls)][0] || '';
  const mimeType = parsed?.mimeType
    || stringField(record, ['mimeType', 'mime_type', 'contentType', 'content_type'])
    || stringField(structured, ['mimeType', 'mime_type', 'contentType', 'content_type'])
    || stringField(firstImageContent, ['mimeType', 'mime_type'])
    || 'image/png';

  return {
    base64,
    dataUrl: dataUrl?.startsWith('data:') ? dataUrl : '',
    outputUrl,
    mimeType,
    model: stringField(record, ['model']) || stringField(structured, ['model']) || fallbackModelValue,
    taskId: stringField(record, ['taskId', 'task_id', 'id']) || stringField(structured, ['taskId', 'task_id', 'id']),
  };
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i.exec(value || '');
  if (!match) return null;
  return { mimeType: match[1] || 'image/png', base64: match[2] || '' };
}

function taskStatusFromResult(result) {
  const strings = collectStrings(result).join('\n');
  const structuredKind = result?.result?.structuredContent?.kind || '';
  const statusMatch = strings.match(/"status"\s*:\s*"([A-Z_]+)"/) || strings.match(/\b(PENDING|RUNNING|THROTTLED|SUCCEEDED|FAILED|CANCELLED)\b/);
  return String(statusMatch?.[1] || structuredKind || '').toUpperCase();
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function safeShape(value, depth = 0) {
  if (depth > 4) return typeof value;
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return `data-url(${value.length})`;
    if (/^https?:/i.test(value)) return `url(${value.length})`;
    return `string(${value.length})`;
  }
  if (Array.isArray(value)) {
    return { arrayLength: value.length, first: safeShape(value[0], depth + 1) };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, safeShape(entryValue, depth + 1)]),
    );
  }
  return value;
}

function projectTool(tool) {
  const record = asRecord(tool);
  return {
    name: stringField(record, ['name']),
    description: stringField(record, ['description']),
  };
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringField(record, keys) {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function sanitizeSecretText(value) {
  let text = String(value || '');
  if (token) text = text.split(token).join('[redacted]');
  return text
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted-jwt]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]')
    .replace(/id_token["=:]\s*["']?[^"',\s}]+/gi, 'id_token=[redacted]')
    .replace(/client_secret["=:]\s*["']?[^"',\s}]+/gi, 'client_secret=[redacted]')
    .replace(/code_(verifier|challenge)["=:]\s*["']?[^"',\s}]+/gi, 'code_$1=[redacted]')
    .replace(/authorization_code["=:]\s*["']?[^"',\s}]+/gi, 'authorization_code=[redacted]')
    .replace(/RUNWAY_MCP_BRIDGE_URL\s*[:=]\s*["']?[^"',\s}]+/gi, 'RUNWAY_MCP_BRIDGE_URL=[redacted]')
    .replace(/RUNWAY_MCP_BRIDGE_TOKEN\s*[:=]\s*["']?[^"',\s}]+/gi, 'RUNWAY_MCP_BRIDGE_TOKEN=[redacted]')
    .replace(/token\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}["']?/gi, 'token=[redacted]');
}

function positiveInteger(value, name) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    console.error(`${name} must be a positive integer.`);
    process.exit(1);
  }
  return numberValue;
}

function redactForResponse(value) {
  if (typeof value === 'string') return sanitizeSecretText(value);
  if (Array.isArray(value)) return value.map(redactForResponse);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
      if (/token|secret|authorization/i.test(key) && key !== 'token_present') return [key, '[redacted]'];
      return [key, redactForResponse(inner)];
    }));
  }
  return value;
}
