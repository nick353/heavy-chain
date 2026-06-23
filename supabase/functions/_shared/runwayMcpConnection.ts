import type { AppSupabaseClient } from './auth.ts';

const RUNWAY_ISSUER = 'https://mcp.runwayml.com';
const RUNWAY_RESOURCE = 'https://mcp.runwayml.com/mcp';
const OAUTH_SCOPE = 'openid api:read_write';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

type StoredConnection = {
  brand_id: string;
  client_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  expires_at: string | null;
  status: string;
};

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      ...extraHeaders,
    },
  });
}

export function redirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'no-store',
    },
  });
}

export function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export async function registerRunwayOAuthClient(redirectUri: string) {
  const response = await fetch(`${RUNWAY_ISSUER}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Heavy Chain Runway MCP',
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
  return data.client_id as string;
}

export async function buildRunwayAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}) {
  const codeChallenge = await sha256Base64Url(params.codeVerifier);
  const url = new URL(`${RUNWAY_ISSUER}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', OAUTH_SCOPE);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', RUNWAY_RESOURCE);
  return url.toString();
}

export async function exchangeRunwayCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    resource: RUNWAY_RESOURCE,
  });
  return await tokenRequest(body);
}

export async function refreshRunwayToken(params: {
  clientId: string;
  refreshToken: string;
}) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: params.refreshToken,
    resource: RUNWAY_RESOURCE,
  });
  return await tokenRequest(body);
}

export async function encryptSecret(value: string) {
  const key = await encryptionKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  return `v1:${base64Url(iv)}:${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string) {
  const [version, ivText, dataText] = value.split(':');
  if (version !== 'v1' || !ivText || !dataText) throw new Error('runway_mcp_token_decrypt_failed');
  const key = await encryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivText) },
    key,
    fromBase64Url(dataText),
  );
  return new TextDecoder().decode(decrypted);
}

export async function readConnectionToken(supabase: AppSupabaseClient, brandId: string) {
  const client = supabase as any;
  const { data, error } = await client
    .from('runway_mcp_oauth_connections')
    .select('brand_id, client_id, encrypted_access_token, encrypted_refresh_token, expires_at, status')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error('runway_mcp_connection_status_unavailable');
  if (!data || data.status !== 'connected') throw new Error('runway_mcp_auth_required');

  const connection = data as StoredConnection;
  const accessToken = await decryptSecret(connection.encrypted_access_token);
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (!connection.encrypted_refresh_token || !expiresAt || expiresAt - Date.now() > 60_000) {
    return accessToken;
  }

  const refreshToken = await decryptSecret(connection.encrypted_refresh_token);
  const refreshed = await refreshRunwayToken({ clientId: connection.client_id, refreshToken });
  const nextAccessToken = refreshed.access_token;
  const nextRefreshToken = refreshed.refresh_token || refreshToken;
  const nextExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : connection.expires_at;

  await client
    .from('runway_mcp_oauth_connections')
    .update({
      encrypted_access_token: await encryptSecret(nextAccessToken),
      encrypted_refresh_token: await encryptSecret(nextRefreshToken),
      expires_at: nextExpiresAt,
      token_type: refreshed.token_type || 'Bearer',
      scope: refreshed.scope || null,
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('brand_id', brandId);

  return nextAccessToken;
}

export async function runwayMcpListTools(accessToken: string) {
  const session = await createMcpSession(accessToken);
  const result = await mcpRequest(accessToken, 'tools/list', {}, session);
  return Array.isArray(result?.tools) ? result.tools : [];
}

export async function runwayMcpCallTool(accessToken: string, toolName: string, args: Record<string, unknown>) {
  const session = await createMcpSession(accessToken);
  return await mcpRequest(accessToken, 'tools/call', {
    name: toolName,
    arguments: args,
  }, session);
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(`${RUNWAY_ISSUER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string') {
    throw new Error(`runway_mcp_token_exchange_failed:${response.status}`);
  }
  return data as TokenResponse;
}

async function createMcpSession(accessToken: string) {
  const init = await mcpRequest(accessToken, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {
      name: 'Heavy Chain Runway MCP Bridge',
      version: '1.0.0',
    },
  });
  return init.sessionId || '';
}

async function mcpRequest(
  accessToken: string,
  method: string,
  params: Record<string, unknown>,
  sessionId = '',
) {
  const response = await fetch(RUNWAY_RESOURCE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`runway_mcp_request_failed:${response.status}:${sanitize(text)}`);
  }
  const payload = parseMcpPayload(text);
  return {
    ...(payload.result || {}),
    sessionId: response.headers.get('mcp-session-id') || sessionId,
  };
}

function parseMcpPayload(text: string) {
  if (!text.trim()) return {};
  if (text.trim().startsWith('{')) return JSON.parse(text);
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data:'));
  if (dataLine) return JSON.parse(dataLine.slice(5).trim());
  throw new Error('runway_mcp_unparseable_response');
}

async function encryptionKey() {
  const raw = Deno.env.get('RUNWAY_MCP_TOKEN_ENCRYPTION_KEY')?.trim();
  if (!raw) throw new Error('runway_mcp_token_encryption_key_missing');
  const bytes = raw.length >= 43 ? fromBase64Url(raw) : new TextEncoder().encode(raw);
  const material = bytes.length === 32
    ? bytes
    : new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function sanitize(value: string) {
  return value
    .replace(/access_token["=:]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
    .replace(/refresh_token["=:]\s*["']?[^"',\s}]+/gi, 'refresh_token=[redacted]')
    .slice(0, 700);
}
