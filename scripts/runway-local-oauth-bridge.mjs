#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomBytes, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const RUNWAY_ISSUER = 'https://mcp.runwayml.com';
const RUNWAY_RESOURCE = 'https://mcp.runwayml.com/mcp';
const OAUTH_SCOPE = 'openid api:read_write';
const DEFAULT_BRAND_ID = 'e5571b0b-7af7-4265-9d47-7d90ae4767d3';

const args = parseArgs(process.argv.slice(2));
loadEnvFile('.env.production.local');

const outPath = args.out || `output/playwright/runway-local-oauth-bridge-${dateStamp(new Date())}/proof.json`;
mkdirSync(dirname(outPath), { recursive: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const encryptionKeyText = process.env.RUNWAY_MCP_TOKEN_ENCRYPTION_KEY;
const brandId = args.brandId || process.env.RUNWAY_READINESS_BRAND_ID || DEFAULT_BRAND_ID;
const port = Number(args.port || 58743);
const timeoutMs = Number(args.timeoutMs || 240000);
const statePath = args.state || '';

const proof = {
  captured_at: new Date().toISOString(),
  checker: 'runway-local-oauth-bridge',
  mode: 'localhost-callback-token-save',
  brand_id: brandId,
  redirect_uri: `http://127.0.0.1:${port}/callback`,
  checks: [],
  blockers: [],
};

let server;
let browser;

try {
  if (args.dangerouslyDirectDbWrite !== true) {
    throw new Error('dangerously_direct_db_write_flag_required');
  }
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('supabase_service_role_env_missing');
  }
  if (!encryptionKeyText) {
    throw new Error('runway_mcp_token_encryption_key_missing');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const connectedBy = args.connectedBy || readSupabaseUserIdFromStorageState(statePath);
  if (!connectedBy) throw new Error('connected_by_user_id_required');
  await assertBrandAdmin(supabase, brandId, connectedBy);
  addCheck('connected_by brand admin verified', true, { connected_by_present: true });

  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const clientId = await registerRunwayOAuthClient(proof.redirect_uri);
  addCheck('Runway dynamic client registration', true, { client_id_present: Boolean(clientId) });

  const authorizationUrl = buildRunwayAuthorizeUrl({ clientId, redirectUri: proof.redirect_uri, state, codeChallenge });
  proof.authorization_url_host = new URL(authorizationUrl).host;

  let serverResolve;
  let serverReject;
  const callbackPromise = new Promise((resolve, reject) => {
    serverResolve = resolve;
    serverReject = reject;
  });

  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', proof.redirect_uri);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const code = url.searchParams.get('code') || '';
      const returnedState = url.searchParams.get('state') || '';
      const providerError = url.searchParams.get('error') || '';
      if (providerError) throw new Error(`runway_provider_error:${providerError}`);
      if (!code || !returnedState) throw new Error('missing_code_or_state');
      if (returnedState !== state) throw new Error('state_mismatch');

      const token = await exchangeRunwayCode({ code, clientId, redirectUri: proof.redirect_uri, codeVerifier });
      const now = new Date().toISOString();
      const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
      const encryptedAccessToken = await encryptSecret(token.access_token, encryptionKeyText);
      const encryptedRefreshToken = token.refresh_token ? await encryptSecret(token.refresh_token, encryptionKeyText) : null;

      const { error: connectionError } = await supabase
        .from('runway_mcp_oauth_connections')
        .upsert({
          brand_id: brandId,
          status: 'connected',
          connected_by: connectedBy,
          client_id: clientId,
          scope: token.scope || null,
          token_type: token.token_type || 'Bearer',
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          last_verified_at: now,
          last_error: null,
          updated_at: now,
        }, { onConflict: 'brand_id' });
      if (connectionError) throw connectionError;

      proof.callback_received = true;
      proof.token_exchange = {
        access_token_present: Boolean(token.access_token),
        refresh_token_present: Boolean(token.refresh_token),
        token_type: token.token_type || 'Bearer',
        scope: token.scope || null,
        expires_at: expiresAt,
      };
      proof.saved_connection = true;
      proof.approval_write_skipped = true;
      addCheck('Runway token saved to Supabase', true, {
        brand_id: brandId,
        connected_by_present: Boolean(connectedBy),
        encrypted_access_token_present: Boolean(encryptedAccessToken),
        encrypted_refresh_token_present: Boolean(encryptedRefreshToken),
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Runway connected</title><h1>Runway connected</h1><p>You may close this window.</p>');
      serverResolve({ ok: true });
    } catch (error) {
      const message = sanitize(String(error instanceof Error ? error.message : error));
      proof.callback_error = message;
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Runway connection failed</title><h1>Runway connection failed</h1><p>${escapeHtml(message)}</p>`);
      serverReject(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  addCheck('localhost callback listening', true, { port });

  browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--new-window'],
  });
  const context = await browser.newContext(statePath && existsSync(statePath) ? { storageState: statePath } : {});
  const page = await context.newPage();
  const requests = [];
  page.on('requestfinished', async (request) => {
    const response = await request.response().catch(() => null);
    requests.push({ method: request.method(), url: redactUrl(request.url()), status: response?.status() ?? null });
  });
  page.on('requestfailed', (request) => {
    requests.push({ method: request.method(), url: redactUrl(request.url()), failed: request.failure()?.errorText || 'failed' });
  });

  await page.goto(authorizationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  const continueButton = page.getByRole('button', { name: 'Continue to Runway' });
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
  }

  await Promise.race([
    callbackPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('localhost_oauth_callback_timeout')), timeoutMs)),
  ]);

  proof.final_url = redactUrl(page.url());
  proof.final_text = (await page.locator('body').innerText().catch(() => '')).slice(0, 1200);
  proof.requests = requests.slice(-30);
  await closeBrowser();
  await closeServer();

  writeProof();
  console.log(`Runway local OAuth bridge completed. Proof: ${outPath}`);
} catch (error) {
  await closeBrowser();
  await closeServer();
  proof.blockers.push({
    code: 'runway_local_oauth_bridge_failed',
    message: sanitize(String(error instanceof Error ? error.message : error)),
  });
  writeProof();
  console.error(`Runway local OAuth bridge failed. Proof: ${outPath}`);
  console.error(proof.blockers[proof.blockers.length - 1].message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--brand-id' && next) {
      parsed.brandId = next;
      i += 1;
    } else if (arg === '--state' && next) {
      parsed.state = next;
      i += 1;
    } else if (arg === '--out' && next) {
      parsed.out = next;
      i += 1;
    } else if (arg === '--port' && next) {
      parsed.port = next;
      i += 1;
    } else if (arg === '--timeout-ms' && next) {
      parsed.timeoutMs = next;
      i += 1;
    } else if (arg === '--connected-by' && next) {
      parsed.connectedBy = next;
      i += 1;
    } else if (arg === '--dangerously-direct-db-write') {
      parsed.dangerouslyDirectDbWrite = true;
    }
  }
  return parsed;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const externalKeys = new Set(Object.keys(process.env));
  const loadedKeys = new Set();
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = unquote(rawValue.trim());
    if (isPlaceholder(value)) continue;
    if (externalKeys.has(key) && !loadedKeys.has(key)) continue;
    process.env[key] = value;
    loadedKeys.add(key);
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isPlaceholder(value) {
  return !value || /(^|[^A-Za-z0-9_])(PROJECT_REF|YOUR_[A-Za-z0-9_]*|REPLACE_ME[A-Za-z0-9_]*|example\.com)([^A-Za-z0-9_]|$)/i.test(String(value));
}

async function assertBrandAdmin(supabase, targetBrandId, userId) {
  const { data: members, error: memberError } = await supabase
    .from('brand_members')
    .select('user_id, role')
    .eq('brand_id', targetBrandId)
    .eq('user_id', userId)
    .in('role', ['owner', 'admin'])
    .limit(1);
  if (memberError) throw memberError;
  if (members?.[0]?.user_id) return;

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('owner_id')
    .eq('id', targetBrandId)
    .maybeSingle();
  if (brandError) throw brandError;
  if (brand?.owner_id === userId) return;
  throw new Error('connected_by_user_is_not_brand_admin');
}

function readSupabaseUserIdFromStorageState(filePath) {
  if (!filePath || !existsSync(filePath)) return '';
  const state = JSON.parse(readFileSync(filePath, 'utf8'));
  for (const origin of state.origins || []) {
    for (const item of origin.localStorage || []) {
      if (!item.name.startsWith('sb-') || !item.name.endsWith('-auth-token')) continue;
      const auth = JSON.parse(item.value);
      const userId = auth?.user?.id || auth?.currentSession?.user?.id;
      if (typeof userId === 'string' && userId) return userId;
    }
  }
  return '';
}

async function registerRunwayOAuthClient(redirectUri) {
  const response = await fetch(`${RUNWAY_ISSUER}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Heavy Chain Runway MCP Local Bridge',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPE,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.client_id !== 'string') {
    throw new Error(`runway_mcp_client_registration_failed:${response.status}`);
  }
  return data.client_id;
}

function buildRunwayAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(`${RUNWAY_ISSUER}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', OAUTH_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', RUNWAY_RESOURCE);
  return url.toString();
}

async function exchangeRunwayCode({ code, clientId, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    resource: RUNWAY_RESOURCE,
  });
  const response = await fetch(`${RUNWAY_ISSUER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  const data = JSON.parse(text || '{}');
  if (!response.ok || typeof data.access_token !== 'string') {
    throw new Error(`runway_mcp_token_exchange_failed:${response.status}:${sanitize(text)}`);
  }
  return data;
}

async function closeBrowser() {
  if (!browser) return;
  await browser.close().catch(() => {});
  browser = null;
}

async function closeServer() {
  if (!server?.listening) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
}

async function encryptSecret(value, rawKey) {
  const key = await importEncryptionKey(rawKey);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  return `v1:${base64Url(iv)}:${base64Url(new Uint8Array(encrypted))}`;
}

async function importEncryptionKey(raw) {
  const trimmed = raw.trim();
  const bytes = trimmed.length >= 43 ? fromBase64Url(trimmed) : new TextEncoder().encode(trimmed);
  const material = bytes.length === 32
    ? bytes
    : new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  return await webcrypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function sha256Base64Url(value) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function randomBase64Url(byteLength) {
  return base64Url(randomBytes(byteLength));
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function dateStamp(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
}

function addCheck(name, passed, details = {}) {
  proof.checks.push({ name, passed, details });
}

function writeProof() {
  writeFileSync(outPath, `${JSON.stringify(proof, null, 2)}\n`);
}

function redactUrl(value) {
  return String(value || '').replace(/([?&](?:code|state|access_token|refresh_token)=)[^&\s"]+/g, '$1[redacted]');
}

function sanitize(value) {
  return String(value)
    .replace(/"?access_token"?\s*[:=]\s*"?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replace(/"?refresh_token"?\s*[:=]\s*"?[^"',\s}]+/gi, 'refresh_token=[redacted]')
    .replace(/([?&](?:code|state)=)[^&\s"]+/g, '$1[redacted]')
    .slice(0, 700);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
