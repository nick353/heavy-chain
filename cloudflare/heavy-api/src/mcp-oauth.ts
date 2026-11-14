/**
 * MCP の OAuth 2.1。ChatGPT・Claude・Cursor などで「Heavy Chain でサインイン」を押すと、
 * heavychain.app のふだんのログイン（Google / Apple / メール）に入って承認する形にする。
 *
 * 2026-11-14 オーナーの指示「できるだけ簡単にして。ログインとおんなじ感じで。Claudeとかもサインインの時は、
 * サイトから入れるので。Google認証など」「全て汎用的に使えるようにして」。
 *
 * 作りの決め事:
 * - 身元は今までどおり consumer-auth が持つ。この Worker は認可サーバーの役だけを足し、
 *   ログインの仕組みには一切触らない。
 * - 承認のときに本人のブラウザから受け取ったセッションを封じて預かり（AES-GCM、鍵はサーバーの秘密）、
 *   MCP の呼び出しではそれを解いて今までと同じ認証を通す。だから heavychain.app でログアウトすると
 *   MCP もそこで止まる。
 * - クライアントの登録は動的クライアント登録（RFC 7591）だけにする。公開クライアント＋PKCE（S256）で、
 *   クライアントの秘密は持たない。ChatGPT は CIMD を優先するが DCR にも落ちてくる（公式の説明）。
 * - 承認ページには request_id しか渡さない。パラメータはこちらの台帳にあるので、ページ側で書き換えられない。
 * - MCP 仕様 2025-11-25 の authorization と RFC 9728（protected resource metadata）、RFC 8414 に合わせる。
 */
import type { Env } from './index.ts';
import { configuredTokenVerifier } from './auth.ts';

const MCP_RESOURCE_PATH = '/mcp';
const SCOPE = 'mcp';
/** 承認ページを開いたまま置かれた要求を捨てるまで。 */
const REQUEST_TTL_MS = 10 * 60_000;
/** 認可コードの寿命。クライアントは受け取ったらすぐ交換する。 */
const CODE_TTL_MS = 2 * 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
/** 登録を置いておく上限。超えたら、使われていない古いものから消す。 */
const MAX_CLIENTS = 200;
const MAX_REDIRECT_URIS = 5;

const CODE_PREFIX = 'hcmc_';
const ACCESS_PREFIX = 'hcma_';
const REFRESH_PREFIX = 'hcmr_';

const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
/** PKCE の code_challenge / code_verifier は base64url の文字だけ（RFC 7636）。 */
const BASE64URL_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string;
}

interface RequestRow {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  resource: string | null;
  scope: string;
  expires_at: string;
  code_hash: string | null;
  owner_issuer: string | null;
  owner_subject: string | null;
  session_sealed: string | null;
  approved_at: string | null;
  consumed_at: string | null;
}

interface TokenRow {
  token_hash: string;
  refresh_hash: string | null;
  client_id: string;
  owner_issuer: string;
  owner_subject: string;
  session_sealed: string;
  scope: string;
  resource: string | null;
  expires_at: string;
  refresh_expires_at: string | null;
  revoked_at: string | null;
}

/** MCP のアクセストークンを解いて得た、呼び出しに使える中身。 */
export interface McpGrant {
  clientId: string;
  issuer: string;
  subject: string;
  /** consumer-auth のセッショントークン。内部呼び出しの Authorization に入れる。 */
  sessionToken: string;
}

function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers });
}

/** 公開してよいメタデータ。クライアントが起動のたびに読むので、短く置いておける。 */
function publicJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      // メタデータは誰でも読めるべきもの（クライアントはブラウザから読むことがある）。
      'access-control-allow-origin': '*',
    },
  });
}

function oauthError(error: string, description: string, status: number): Response {
  return json({ error, error_description: description }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return null; }
}

function randomToken(prefix: string): string {
  return prefix + bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

/** 比べる時間が中身で変わらないようにする（トークンのハッシュの照合に使う）。 */
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

async function sealingKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** セッショントークンを封じる。鍵はサーバーの秘密だけが持ち、D1 には封じたものしか置かない。 */
async function seal(secret: string, plain: string): Promise<string> {
  const key = await sealingKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(sealed))}`;
}

async function unseal(secret: string, sealed: string): Promise<string | null> {
  const [ivPart, bodyPart] = sealed.split('.');
  if (!ivPart || !bodyPart) return null;
  const iv = base64UrlToBytes(ivPart);
  const body = base64UrlToBytes(bodyPart);
  if (!iv || !body || iv.length !== 12) return null;
  try {
    const key = await sealingKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

function secretOf(env: Env): string | null {
  const value = env.MCP_TOKEN_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

/** 承認ページの置き場。設定が無ければ OAuth は開かない（勝手な行き先へ飛ばさない）。 */
function approvalOrigin(env: Env): string | null {
  const value = env.PUBLIC_APP_ORIGIN?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch { return null; }
}

/** 戻り先として受け付ける形。https か、手元で試すための localhost だけ。 */
function allowedRedirectUri(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.hash) return null;
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')) {
    return url.toString();
  }
  return null;
}

function nowIso(): string { return new Date().toISOString(); }
function isoIn(ms: number): string { return new Date(Date.now() + ms).toISOString(); }
function expired(value: string | null): boolean {
  if (!value) return true;
  const at = Date.parse(value);
  return !Number.isFinite(at) || at <= Date.now();
}

/** 期限切れを少しずつ片付ける。1回の呼び出しの重さを決めておく。 */
async function sweep(env: Env): Promise<void> {
  const now = nowIso();
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM mcp_oauth_requests WHERE request_id IN (SELECT request_id FROM mcp_oauth_requests WHERE expires_at <= ? LIMIT 50)').bind(now),
      env.DB.prepare('DELETE FROM mcp_oauth_tokens WHERE token_hash IN (SELECT token_hash FROM mcp_oauth_tokens WHERE COALESCE(refresh_expires_at, expires_at) <= ? LIMIT 50)').bind(now),
    ]);
  } catch { /* 片付けの失敗で呼び出しを落とさない。 */ }
}

/** 承認ページと /approve は、ふだんのログインのセッションで本人を確かめる。 */
async function sessionOwner(request: Request, env: Env): Promise<{ issuer: string; subject: string; token: string } | Response> {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return oauthError('unauthorized', 'Heavy Chain のセッションが必要です。', 401);
  // index.ts の authenticate と同じ順序。本番では必ず consumer-auth の検証器が使われる。
  const verifier = env.MEDIA_TOKEN_VERIFIER
    ? (candidate: Request) => Promise.resolve(env.MEDIA_TOKEN_VERIFIER!(candidate, env))
    : configuredTokenVerifier(env);
  if (!verifier) return oauthError('temporarily_unavailable', '認証の仕組みにつながりません。', 503);
  try {
    const identity = await verifier(request);
    if (!identity) return oauthError('unauthorized', 'セッションが切れています。サインインし直してください。', 401);
    return { issuer: identity.issuer, subject: identity.subject, token: match[1] };
  } catch { return oauthError('temporarily_unavailable', '認証の仕組みにつながりません。', 503); }
}

async function readClient(env: Env, clientId: string): Promise<ClientRow | null> {
  if (!CLIENT_ID_PATTERN.test(clientId)) return null;
  return env.DB.prepare('SELECT client_id, client_name, redirect_uris FROM mcp_oauth_clients WHERE client_id = ? LIMIT 1')
    .bind(clientId).first<ClientRow>();
}

function clientRedirectUris(row: ClientRow): string[] {
  try {
    const parsed: unknown = JSON.parse(row.redirect_uris);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch { return []; }
}

/** 動的クライアント登録（RFC 7591）。公開クライアントなので秘密は出さない。 */
async function register(request: Request, env: Env): Promise<Response> {
  if (!secretOf(env)) return oauthError('temporarily_unavailable', 'MCP の OAuth はまだ設定されていません。', 503);
  let body: unknown;
  try { body = await request.json(); } catch { return oauthError('invalid_client_metadata', '本文が JSON ではありません。', 400); }
  if (!isRecord(body)) return oauthError('invalid_client_metadata', '本文が JSON のオブジェクトではありません。', 400);

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : null;
  if (!uris || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return oauthError('invalid_redirect_uri', `redirect_uris は1〜${MAX_REDIRECT_URIS}個の配列です。`, 400);
  }
  const normalized: string[] = [];
  for (const entry of uris) {
    const uri = allowedRedirectUri(entry);
    if (!uri) return oauthError('invalid_redirect_uri', 'redirect_uris は https か localhost だけです。', 400);
    normalized.push(uri);
  }
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') {
    return oauthError('invalid_client_metadata', 'クライアントの秘密は持ちません（token_endpoint_auth_method は none）。', 400);
  }
  if (body.grant_types !== undefined) {
    const grants = Array.isArray(body.grant_types) ? body.grant_types : [];
    if (!grants.every((grant) => grant === 'authorization_code' || grant === 'refresh_token')) {
      return oauthError('invalid_client_metadata', 'grant_types は authorization_code と refresh_token だけです。', 400);
    }
  }
  if (body.response_types !== undefined) {
    const responses = Array.isArray(body.response_types) ? body.response_types : [];
    if (!responses.every((value) => value === 'code')) {
      return oauthError('invalid_client_metadata', 'response_types は code だけです。', 400);
    }
  }
  const rawName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const clientName = (rawName.length > 0 && rawName.length <= 120 ? rawName : 'MCP クライアント').replace(/[\r\n]+/g, ' ');

  const clientId = randomId();
  const created = nowIso();
  try {
    // 登録はだれでもできる（DCR の決まり）。増えすぎないよう、使われていない古いものから捨てる。
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_oauth_clients').first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_CLIENTS) {
      await env.DB.prepare(`DELETE FROM mcp_oauth_clients WHERE client_id IN (
        SELECT client_id FROM mcp_oauth_clients ORDER BY COALESCE(last_used_at, created_at) ASC LIMIT 20)`).run();
    }
    await env.DB.prepare('INSERT INTO mcp_oauth_clients(client_id, client_name, redirect_uris, created_at) VALUES(?, ?, ?, ?)')
      .bind(clientId, clientName, JSON.stringify(normalized), created).run();
  } catch { return oauthError('temporarily_unavailable', '登録を保存できませんでした。', 503); }

  return json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: normalized,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    client_id_issued_at: Math.floor(Date.parse(created) / 1000),
    scope: SCOPE,
  }, 201);
}

/** 受け取ったパラメータを台帳に預け、承認ページへ送り出す。 */
async function authorize(request: Request, env: Env): Promise<Response> {
  const secret = secretOf(env);
  const origin = approvalOrigin(env);
  if (!secret || !origin) return oauthError('temporarily_unavailable', 'MCP の OAuth はまだ設定されていません。', 503);

  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') ?? '';
  const client = await readClient(env, clientId).catch(() => null);
  if (!client) return oauthError('invalid_client', 'client_id が分かりません。登録し直してください。', 400);

  const redirectUri = url.searchParams.get('redirect_uri');
  const registered = clientRedirectUris(client);
  // 戻り先が登録と合わないときはリダイレクトしない（ここで止めないと、好きな場所へ飛ばせてしまう）。
  const target = redirectUri && registered.includes(redirectUri) ? redirectUri
    : !redirectUri && registered.length === 1 ? registered[0] : null;
  if (!target) return oauthError('invalid_request', 'redirect_uri が登録と合いません。', 400);

  const state = url.searchParams.get('state');
  const issuer = url.origin;
  /** 決まりどおり、エラーも成功も同じ戻り先へ返し、iss を必ず付ける。 */
  const back = (params: Record<string, string>): Response => {
    const destination = new URL(target);
    for (const [key, value] of Object.entries(params)) destination.searchParams.set(key, value);
    if (state) destination.searchParams.set('state', state);
    destination.searchParams.set('iss', issuer);
    return new Response(null, { status: 302, headers: { location: destination.toString(), 'cache-control': 'no-store' } });
  };

  if (url.searchParams.get('response_type') !== 'code') {
    return back({ error: 'unsupported_response_type', error_description: 'response_type は code だけです。' });
  }
  if (url.searchParams.get('code_challenge_method') !== 'S256') {
    return back({ error: 'invalid_request', error_description: 'PKCE の S256 が必要です。' });
  }
  const challenge = url.searchParams.get('code_challenge') ?? '';
  if (!BASE64URL_PATTERN.test(challenge)) {
    return back({ error: 'invalid_request', error_description: 'code_challenge の形が正しくありません。' });
  }
  const askedScope = url.searchParams.get('scope');
  if (askedScope && !askedScope.split(/\s+/).filter(Boolean).every((entry) => entry === SCOPE)) {
    return back({ error: 'invalid_scope', error_description: `扱える scope は ${SCOPE} だけです。` });
  }
  const resource = url.searchParams.get('resource');
  if (resource) {
    // MCP の決まりで、クライアントは呼びたい資源をそのまま送ってくる。別の資源の札は出さない。
    const expected = new URL(MCP_RESOURCE_PATH, url.origin).toString();
    if (resource !== expected && resource !== url.origin && resource !== `${url.origin}/`) {
      return back({ error: 'invalid_target', error_description: 'その resource には出せません。' });
    }
  }

  const requestId = randomId();
  try {
    await env.DB.prepare(`INSERT INTO mcp_oauth_requests
      (request_id, client_id, redirect_uri, state, code_challenge, resource, scope, created_at, expires_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(requestId, client.client_id, target, state, challenge, resource, SCOPE, nowIso(), isoIn(REQUEST_TTL_MS)).run();
  } catch { return back({ error: 'server_error', error_description: '要求を保存できませんでした。' }); }

  const approval = new URL('/mcp-authorize', origin);
  approval.searchParams.set('request_id', requestId);
  return new Response(null, { status: 302, headers: { location: approval.toString(), 'cache-control': 'no-store' } });
}

/** 承認ページが「どのクライアントに、何の許可を出すのか」を表示するために読む。 */
async function describeRequest(request: Request, env: Env, requestId: string): Promise<Response> {
  if (!REQUEST_ID_PATTERN.test(requestId)) return oauthError('invalid_request', 'request_id の形が正しくありません。', 400);
  const owner = await sessionOwner(request, env);
  if (owner instanceof Response) return owner;
  let row: RequestRow | null;
  try {
    row = await env.DB.prepare('SELECT * FROM mcp_oauth_requests WHERE request_id = ? LIMIT 1').bind(requestId).first<RequestRow>();
  } catch { return oauthError('temporarily_unavailable', '要求を読めませんでした。', 503); }
  if (!row || expired(row.expires_at)) return oauthError('invalid_request', 'この承認の要求は期限切れです。もう一度サインインしてください。', 404);
  if (row.approved_at) return oauthError('invalid_request', 'この要求はもう使われています。', 409);
  const client = await readClient(env, row.client_id).catch(() => null);
  return json({
    requestId: row.request_id,
    clientName: client?.client_name ?? 'MCP クライアント',
    redirectUri: row.redirect_uri,
    scope: row.scope,
    expiresAt: row.expires_at,
  });
}

/** 本人が「許可する」を押したときだけ、認可コードを出す。 */
async function approve(request: Request, env: Env): Promise<Response> {
  const secret = secretOf(env);
  if (!secret) return oauthError('temporarily_unavailable', 'MCP の OAuth はまだ設定されていません。', 503);
  const owner = await sessionOwner(request, env);
  if (owner instanceof Response) return owner;

  let body: unknown;
  try { body = await request.json(); } catch { return oauthError('invalid_request', '本文が JSON ではありません。', 400); }
  if (!isRecord(body)) return oauthError('invalid_request', '本文が JSON のオブジェクトではありません。', 400);
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!REQUEST_ID_PATTERN.test(requestId)) return oauthError('invalid_request', 'requestId の形が正しくありません。', 400);
  if (typeof body.approve !== 'boolean') return oauthError('invalid_request', 'approve は true か false です。', 400);

  let row: RequestRow | null;
  try {
    row = await env.DB.prepare('SELECT * FROM mcp_oauth_requests WHERE request_id = ? LIMIT 1').bind(requestId).first<RequestRow>();
  } catch { return oauthError('temporarily_unavailable', '要求を読めませんでした。', 503); }
  if (!row || expired(row.expires_at)) return oauthError('invalid_request', 'この承認の要求は期限切れです。', 404);
  if (row.approved_at) return oauthError('invalid_request', 'この要求はもう使われています。', 409);

  const destination = new URL(row.redirect_uri);
  if (row.state) destination.searchParams.set('state', row.state);
  destination.searchParams.set('iss', new URL(request.url).origin);

  if (!body.approve) {
    try { await env.DB.prepare('DELETE FROM mcp_oauth_requests WHERE request_id = ?').bind(requestId).run(); } catch { /* 期限切れで消える。 */ }
    destination.searchParams.set('error', 'access_denied');
    return json({ redirectTo: destination.toString() });
  }

  const code = randomToken(CODE_PREFIX);
  const codeHash = await sha256Hex(code);
  const sealed = await seal(secret, owner.token);
  const approvedAt = nowIso();
  try {
    // 承認は1回だけ。approved_at が入っている行は、同時に押されても書き換わらない。
    const update = await env.DB.prepare(`UPDATE mcp_oauth_requests
      SET code_hash = ?, owner_issuer = ?, owner_subject = ?, session_sealed = ?, approved_at = ?, expires_at = ?
      WHERE request_id = ? AND approved_at IS NULL`)
      .bind(codeHash, owner.issuer, owner.subject, sealed, approvedAt, isoIn(CODE_TTL_MS), requestId).run();
    if (!update.meta.changes) return oauthError('invalid_request', 'この要求はもう使われています。', 409);
  } catch { return oauthError('temporarily_unavailable', '承認を保存できませんでした。', 503); }

  destination.searchParams.set('code', code);
  return json({ redirectTo: destination.toString() });
}

async function issueTokens(
  env: Env,
  secret: string,
  grant: { clientId: string; issuer: string; subject: string; sealed: string; scope: string; resource: string | null },
): Promise<Response> {
  const access = randomToken(ACCESS_PREFIX);
  const refresh = randomToken(REFRESH_PREFIX);
  try {
    await env.DB.prepare(`INSERT INTO mcp_oauth_tokens
      (token_hash, refresh_hash, client_id, owner_issuer, owner_subject, session_sealed, scope, resource,
       created_at, expires_at, refresh_expires_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(await sha256Hex(access), await sha256Hex(refresh), grant.clientId, grant.issuer, grant.subject,
        grant.sealed, grant.scope, grant.resource, nowIso(), isoIn(ACCESS_TTL_MS), isoIn(REFRESH_TTL_MS)).run();
    await env.DB.prepare('UPDATE mcp_oauth_clients SET last_used_at = ? WHERE client_id = ?').bind(nowIso(), grant.clientId).run();
  } catch { return oauthError('temporarily_unavailable', 'トークンを保存できませんでした。', 503); }
  void secret;
  return json({
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope: grant.scope,
  });
}

async function token(request: Request, env: Env): Promise<Response> {
  const secret = secretOf(env);
  if (!secret) return oauthError('temporarily_unavailable', 'MCP の OAuth はまだ設定されていません。', 503);
  let form: URLSearchParams;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return oauthError('invalid_request', '本文が大きすぎます。', 413);
    form = new URLSearchParams(raw);
  } catch { return oauthError('invalid_request', '本文を読めませんでした。', 400); }

  const clientId = form.get('client_id') ?? '';
  const client = await readClient(env, clientId).catch(() => null);
  if (!client) return oauthError('invalid_client', 'client_id が分かりません。', 401);

  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    if (!code.startsWith(CODE_PREFIX) || !BASE64URL_PATTERN.test(verifier)) {
      return oauthError('invalid_grant', 'code か code_verifier の形が正しくありません。', 400);
    }
    let row: RequestRow | null;
    try {
      row = await env.DB.prepare('SELECT * FROM mcp_oauth_requests WHERE code_hash = ? LIMIT 1')
        .bind(await sha256Hex(code)).first<RequestRow>();
    } catch { return oauthError('temporarily_unavailable', 'コードを読めませんでした。', 503); }
    if (!row || !row.approved_at || !row.session_sealed || !row.owner_issuer || !row.owner_subject) {
      return oauthError('invalid_grant', 'このコードは使えません。', 400);
    }
    if (row.client_id !== client.client_id) return oauthError('invalid_grant', 'コードを出したクライアントと違います。', 400);
    const askedRedirect = form.get('redirect_uri');
    if (askedRedirect !== null && askedRedirect !== row.redirect_uri) {
      return oauthError('invalid_grant', 'redirect_uri がコードを出したときと違います。', 400);
    }
    if (expired(row.expires_at) || row.consumed_at) {
      // 一度でも引き換えたコードが再び来たら、その承認そのものを捨てる（コードの使い回しへの備え）。
      try { await env.DB.prepare('DELETE FROM mcp_oauth_requests WHERE request_id = ?').bind(row.request_id).run(); } catch { /* 期限切れで消える。 */ }
      return oauthError('invalid_grant', 'このコードは期限切れか、もう使われています。', 400);
    }
    if (!constantTimeEqual(await sha256Base64Url(verifier), row.code_challenge)) {
      return oauthError('invalid_grant', 'code_verifier が合いません。', 400);
    }
    try {
      const consume = await env.DB.prepare('UPDATE mcp_oauth_requests SET consumed_at = ? WHERE request_id = ? AND consumed_at IS NULL')
        .bind(nowIso(), row.request_id).run();
      if (!consume.meta.changes) return oauthError('invalid_grant', 'このコードはもう使われています。', 400);
    } catch { return oauthError('temporarily_unavailable', 'コードを使えませんでした。', 503); }
    await sweep(env);
    return issueTokens(env, secret, {
      clientId: client.client_id, issuer: row.owner_issuer, subject: row.owner_subject,
      sealed: row.session_sealed, scope: row.scope, resource: row.resource,
    });
  }

  if (grantType === 'refresh_token') {
    const refresh = form.get('refresh_token') ?? '';
    if (!refresh.startsWith(REFRESH_PREFIX)) return oauthError('invalid_grant', 'refresh_token の形が正しくありません。', 400);
    let row: TokenRow | null;
    try {
      row = await env.DB.prepare('SELECT * FROM mcp_oauth_tokens WHERE refresh_hash = ? LIMIT 1')
        .bind(await sha256Hex(refresh)).first<TokenRow>();
    } catch { return oauthError('temporarily_unavailable', 'トークンを読めませんでした。', 503); }
    if (!row || row.revoked_at || expired(row.refresh_expires_at)) {
      return oauthError('invalid_grant', 'この refresh_token は使えません。もう一度サインインしてください。', 400);
    }
    if (row.client_id !== client.client_id) return oauthError('invalid_grant', 'トークンを出したクライアントと違います。', 400);
    try {
      // 更新トークンは1回で入れ替える。古いものは同時に使えなくする。
      const rotate = await env.DB.prepare('UPDATE mcp_oauth_tokens SET revoked_at = ?, refresh_hash = NULL WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(nowIso(), row.token_hash).run();
      if (!rotate.meta.changes) return oauthError('invalid_grant', 'この refresh_token はもう使われています。', 400);
    } catch { return oauthError('temporarily_unavailable', 'トークンを入れ替えられませんでした。', 503); }
    await sweep(env);
    return issueTokens(env, secret, {
      clientId: client.client_id, issuer: row.owner_issuer, subject: row.owner_subject,
      sealed: row.session_sealed, scope: row.scope, resource: row.resource,
    });
  }

  return oauthError('unsupported_grant_type', 'grant_type は authorization_code か refresh_token です。', 400);
}

/**
 * MCP のアクセストークンを解く。これが返す sessionToken を内部呼び出しの Authorization に入れると、
 * 画面から呼んだときと同じ認証・権限・上限を通る。
 */
export async function resolveMcpAccessToken(env: Env, bearer: string): Promise<McpGrant | null> {
  if (!bearer.startsWith(ACCESS_PREFIX)) return null;
  const secret = secretOf(env);
  if (!secret) return null;
  let row: TokenRow | null;
  try {
    row = await env.DB.prepare('SELECT * FROM mcp_oauth_tokens WHERE token_hash = ? LIMIT 1')
      .bind(await sha256Hex(bearer)).first<TokenRow>();
  } catch { return null; }
  if (!row || row.revoked_at || expired(row.expires_at)) return null;
  const sessionToken = await unseal(secret, row.session_sealed);
  if (!sessionToken) return null;
  return { clientId: row.client_id, issuer: row.owner_issuer, subject: row.owner_subject, sessionToken };
}

/** MCP のアクセストークンらしい形か（ふだんのセッションと見分けるため）。 */
export function looksLikeMcpAccessToken(bearer: string): boolean {
  return bearer.startsWith(ACCESS_PREFIX);
}

/** 401 のときにクライアントへ渡す、認証の入口の在りか（RFC 9728）。 */
export function resourceMetadataUrl(origin: string): string {
  return new URL('/.well-known/oauth-protected-resource/mcp', origin).toString();
}

function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: new URL(MCP_RESOURCE_PATH, origin).toString(),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://heavychain.app',
  };
}

function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: new URL('/mcp-oauth/authorize', origin).toString(),
    token_endpoint: new URL('/mcp-oauth/token', origin).toString(),
    registration_endpoint: new URL('/mcp-oauth/register', origin).toString(),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [SCOPE],
    // どの応答にも iss を付けている（混ざり込み対策）。
    authorization_response_iss_parameter_supported: true,
    // クライアントの秘密を持たないので、CIMD ではなく動的クライアント登録だけを出す。
    client_id_metadata_document_supported: false,
    service_documentation: 'https://heavychain.app',
  };
}

/** MCP の OAuth の道。それ以外なら null を返し、ふだんの経路に渡す。 */
export async function handleMcpOAuthRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp')) {
    return publicJson(protectedResourceMetadata(url.origin));
  }
  if (request.method === 'GET' && (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/openid-configuration')) {
    return publicJson(authorizationServerMetadata(url.origin));
  }
  if (!path.startsWith('/mcp-oauth/')) return null;

  if (path === '/mcp-oauth/register') {
    return request.method === 'POST' ? register(request, env) : json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }
  if (path === '/mcp-oauth/authorize') {
    return request.method === 'GET' ? authorize(request, env) : json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  }
  if (path === '/mcp-oauth/approve') {
    return request.method === 'POST' ? approve(request, env) : json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }
  if (path === '/mcp-oauth/token') {
    return request.method === 'POST' ? token(request, env) : json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }
  const describe = /^\/mcp-oauth\/requests\/([^/]+)$/.exec(path);
  if (describe) {
    return request.method === 'GET'
      ? describeRequest(request, env, decodeURIComponent(describe[1]))
      : json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  }
  return json({ error: 'not_found' }, 404);
}
