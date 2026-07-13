#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const bridgeUrl = String(args.url || process.env.RUNWAY_MCP_BRIDGE_URL || '').trim().replace(/\/+$/, '');
const tokenEnvName = args.tokenEnv || 'RUNWAY_MCP_BRIDGE_TOKEN';
const bridgeToken = String(process.env[tokenEnvName] || '').trim();
const timestamp = compactTimestamp(new Date());
const proofPath = args.out || `output/playwright/runway-mcp-remote-http-bridge-${timestamp}/proof.json`;

const proof = {
  captured_at: new Date().toISOString(),
  checker: 'verify-runway-mcp-remote-http-bridge',
  bridge_url_host: safeUrlHost(bridgeUrl),
  token_present: Boolean(bridgeToken),
  live_generate: Boolean(args.liveGenerate),
  checks: [],
  blockers: [],
};

try {
  if (!bridgeUrl) throw new Error('RUNWAY_MCP_BRIDGE_URL_or_--url_required');
  if (!bridgeToken) throw new Error(`${tokenEnvName}_missing`);

  const health = await bridgeFetch('/health', { method: 'GET' });
  proof.checks.push({
    name: 'health',
    ok: health.response.ok,
    status: health.response.status,
    body: safeBody(health.body),
  });
  if (!health.response.ok) throw new Error(`health_failed:${health.response.status}`);

  const tools = await bridgeFetch('/tools', { method: 'POST', body: {} });
  const toolNames = Array.isArray(tools.body?.tools) ? tools.body.tools.map((tool) => tool?.name).filter(Boolean) : [];
  proof.checks.push({
    name: 'tools',
    ok: tools.response.ok,
    status: tools.response.status,
    tool_count: toolNames.length,
    tools: toolNames.slice(0, 30),
  });
  if (!tools.response.ok) throw new Error(`tools_failed:${tools.response.status}`);

  if (args.liveGenerate) {
    const generated = await bridgeFetch('/text-to-image', {
      method: 'POST',
      body: {
        prompt: args.prompt || 'A simple flat lay product concept image for Heavy Chain verification.',
        model: args.model || undefined,
        ratio: args.ratio || '1024:1024',
      },
    });
    proof.checks.push({
      name: 'text-to-image',
      ok: generated.response.ok,
      status: generated.response.status,
      image_present: Boolean(generated.body?.base64 || generated.body?.outputUrl || generated.body?.dataUrl),
      task_id_present: Boolean(generated.body?.taskId),
      model: typeof generated.body?.model === 'string' ? generated.body.model : null,
      tool: typeof generated.body?.tool === 'string' ? generated.body.tool : null,
    });
    if (!generated.response.ok) throw new Error(`text_to_image_failed:${generated.response.status}`);
  }

  proof.ok = true;
  writeProof();
  console.log(`Runway MCP remote HTTP bridge verification passed. Proof: ${proofPath}`);
} catch (error) {
  proof.ok = false;
  proof.blockers.push({
    code: 'runway_mcp_remote_http_bridge_verify_failed',
    message: sanitize(error instanceof Error ? error.message : String(error || 'verify_failed')),
  });
  writeProof();
  console.error(`Runway MCP remote HTTP bridge verification failed. Proof: ${proofPath}`);
  console.error(proof.blockers[proof.blockers.length - 1].message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { liveGenerate: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--url' && next) {
      parsed.url = next;
      index += 1;
    } else if (arg === '--token-env' && next) {
      parsed.tokenEnv = next;
      index += 1;
    } else if (arg === '--out' && next) {
      parsed.out = next;
      index += 1;
    } else if (arg === '--prompt' && next) {
      parsed.prompt = next;
      index += 1;
    } else if (arg === '--model' && next) {
      parsed.model = next;
      index += 1;
    } else if (arg === '--ratio' && next) {
      parsed.ratio = next;
      index += 1;
    } else if (arg === '--live-generate') {
      parsed.liveGenerate = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/verify-runway-mcp-remote-http-bridge.mjs [--url URL] [--token-env RUNWAY_MCP_BRIDGE_TOKEN] [--live-generate]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function bridgeFetch(path, options) {
  const response = await fetch(`${bridgeUrl}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${bridgeToken}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  return { response, body };
}

function safeBody(body) {
  if (!body || typeof body !== 'object') return {};
  const allowed = {};
  for (const key of ['ok', 'service', 'host', 'token_present']) {
    if (key in body) allowed[key] = body[key];
  }
  return allowed;
}

function writeProof() {
  mkdirSync(dirname(proofPath), { recursive: true });
  writeFileSync(proofPath, `${JSON.stringify(redact(proof), null, 2)}\n`);
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function safeUrlHost(value) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function sanitize(value) {
  let text = String(value || '');
  if (bridgeToken) text = text.split(bridgeToken).join('[redacted]');
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

function redact(value) {
  if (typeof value === 'string') return sanitize(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
      if (/token|secret|authorization/i.test(key) && key !== 'token_present' && key !== 'token_env') {
        return [key, '[redacted]'];
      }
      return [key, redact(inner)];
    }));
  }
  return value;
}
