import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.ts';
import { imageSetup } from './image-ai-fixture.ts';

type Setup = ReturnType<typeof imageSetup>;

const ORIGIN = 'https://heavy.test';
const CALLBACK = 'https://chatgpt.example/oauth/callback';
/** PKCE の verifier と、その S256 の challenge（試験の中で作る）。 */
const VERIFIER = 'uDJ8mQ2nR4tV6xY9bC1eF3hJ5kL7nP0qS2uW4yA6cE8';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** OAuth を設定した状態の下敷き。承認ページの置き場と、封じる鍵を入れる。 */
function oauthSetup(): Setup {
  const setup = imageSetup();
  Object.assign(setup.env, {
    MCP_TOKEN_SECRET: 'test-only-mcp-sealing-secret-0123456789',
    PUBLIC_APP_ORIGIN: 'https://heavychain.test',
  });
  return setup;
}

const send = (setup: Setup, path: string, init: RequestInit = {}) =>
  handleRequest(new Request(ORIGIN + path, init), setup.env);

async function registerClient(setup: Setup, overrides: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await send(setup, '/mcp-oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [CALLBACK], ...overrides }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** 登録 → 承認 → コード交換まで通して、アクセストークンと更新トークンを得る。 */
async function signIn(setup: Setup, user = 'alice'): Promise<{ clientId: string; access: string; refresh: string }> {
  const { body: client } = await registerClient(setup);
  const clientId = client.client_id as string;
  const challenge = await challengeOf(VERIFIER);
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${clientId}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${challenge}&code_challenge_method=S256&state=st-1`);
  assert.equal(authorize.status, 302);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');
  assert.ok(requestId, '承認ページへ request_id が渡っていない');

  const approve = await send(setup, '/mcp-oauth/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
    body: JSON.stringify({ requestId, approve: true }),
  });
  assert.equal(approve.status, 200);
  const { redirectTo } = await approve.json() as { redirectTo: string };
  const code = new URL(redirectTo).searchParams.get('code');
  assert.ok(code, 'コードが返っていない');

  const token = await send(setup, '/mcp-oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CALLBACK }).toString(),
  });
  assert.equal(token.status, 200);
  const tokens = await token.json() as { access_token: string; refresh_token: string };
  return { clientId, access: tokens.access_token, refresh: tokens.refresh_token };
}

test('資源のメタデータは、認可サーバーと scope を指す', async () => {
  const setup = oauthSetup();
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const response = await send(setup, path);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.resource, `${ORIGIN}/mcp`);
    assert.deepEqual(body.authorization_servers, [ORIGIN]);
    assert.deepEqual(body.scopes_supported, ['mcp']);
  }
});

test('認可サーバーのメタデータは、S256 と動的登録を出す', async () => {
  const setup = oauthSetup();
  const response = await send(setup, '/.well-known/oauth-authorization-server');
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.issuer, ORIGIN);
  assert.equal(body.authorization_endpoint, `${ORIGIN}/mcp-oauth/authorize`);
  assert.equal(body.token_endpoint, `${ORIGIN}/mcp-oauth/token`);
  assert.equal(body.registration_endpoint, `${ORIGIN}/mcp-oauth/register`);
  // MCP 仕様は S256 を必須にしている。これが無いとクライアントは繋がない。
  assert.deepEqual(body.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(body.token_endpoint_auth_methods_supported, ['none']);
  assert.equal(body.authorization_response_iss_parameter_supported, true);
  assert.equal(body.client_id_metadata_document_supported, false);
});

test('鍵が無い間は、OAuth の道は開かない', async () => {
  const setup = imageSetup();
  const register = await send(setup, '/mcp-oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [CALLBACK] }),
  });
  assert.equal(register.status, 503);
});

test('動的クライアント登録は、公開クライアントとして id を出す', async () => {
  const setup = oauthSetup();
  const { status, body } = await registerClient(setup);
  assert.equal(status, 201);
  assert.match(body.client_id as string, /^[0-9a-f]{32}$/);
  assert.equal(body.client_name, 'ChatGPT');
  assert.equal(body.token_endpoint_auth_method, 'none');
  assert.equal(body.client_secret, undefined, 'クライアントの秘密を出してはいけない');
  assert.deepEqual(body.redirect_uris, [CALLBACK]);
});

test('戻り先が https でも localhost でもなければ登録を断る', async () => {
  const setup = oauthSetup();
  for (const uris of [['http://evil.test/cb'], ['javascript:alert(1)'], [], ['https://a.test/#x']]) {
    const { status, body } = await registerClient(setup, { redirect_uris: uris });
    assert.equal(status, 400, JSON.stringify(uris));
    assert.match(String(body.error), /invalid_redirect_uri/);
  }
  // 手元で試すための localhost は通す。
  const local = await registerClient(setup, { redirect_uris: ['http://localhost:7777/callback'] });
  assert.equal(local.status, 201);
});

test('クライアントの秘密を使う登録は断る', async () => {
  const setup = oauthSetup();
  const { status } = await registerClient(setup, { token_endpoint_auth_method: 'client_secret_post' });
  assert.equal(status, 400);
});

test('authorize は、知らない client_id と登録外の戻り先ではリダイレクトしない', async () => {
  const setup = oauthSetup();
  const unknown = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${'0'.repeat(32)}&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  assert.equal(unknown.status, 400);

  const { body: client } = await registerClient(setup);
  const elsewhere = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent('https://evil.test/steal')}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  assert.equal(elsewhere.status, 400, '登録外の戻り先へ飛ばしてはいけない');
});

test('PKCE が S256 でなければ、戻り先へエラーを返す（iss と state つき）', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const response = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=abc&code_challenge_method=plain&state=st-9`);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.origin + location.pathname, CALLBACK);
  assert.equal(location.searchParams.get('error'), 'invalid_request');
  assert.equal(location.searchParams.get('state'), 'st-9');
  assert.equal(location.searchParams.get('iss'), ORIGIN);
});

test('authorize は承認ページへ送り、パラメータは台帳に残す', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const response = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256&state=st-1`);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.origin, 'https://heavychain.test');
  assert.equal(location.pathname, '/mcp-authorize');
  // 承認ページに渡すのは request_id だけ。戻り先も challenge もページからは触れない。
  assert.deepEqual([...location.searchParams.keys()], ['request_id']);
});

test('承認ページの読み出しはサインインが要る', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');

  const anonymous = await send(setup, `/mcp-oauth/requests/${requestId}`);
  assert.equal(anonymous.status, 401);

  const signedIn = await send(setup, `/mcp-oauth/requests/${requestId}`, { headers: { authorization: 'Bearer alice' } });
  assert.equal(signedIn.status, 200);
  const body = await signedIn.json() as Record<string, unknown>;
  assert.equal(body.clientName, 'ChatGPT');
  assert.equal(body.redirectUri, CALLBACK);
});

test('サインイン一式が通り、そのトークンで MCP のツールが動く', async () => {
  const setup = oauthSetup();
  const { access } = await signIn(setup);
  assert.match(access, /^hcma_/);

  const response = await handleRequest(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_brands', arguments: {} } }),
  }), setup.env);
  assert.equal(response.status, 200);
  const payload = await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } };
  assert.notEqual(payload.result.isError, true, payload.result.content[0]?.text);
  const brands = JSON.parse(payload.result.content[0].text) as Array<{ id: string }>;
  assert.deepEqual(brands.map((brand) => brand.id), ['brand']);
});

test('承認した本人のブランドだけが見える', async () => {
  const setup = oauthSetup();
  // 'other' は fixture のブランド 'brand' の一員ではない（自分の個人ブランドだけを持つ）。
  const { access } = await signIn(setup, 'other');
  const response = await handleRequest(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_brands', arguments: {} } }),
  }), setup.env);
  const payload = await response.json() as { result: { content: Array<{ text: string }> } };
  const brands = JSON.parse(payload.result.content[0].text) as Array<{ id: string; owner_id: string }>;
  assert.ok(!brands.some((brand) => brand.id === 'brand'), '他人のブランドが見えてはいけない');
  assert.ok(brands.every((brand) => brand.owner_id === 'other'));

  // そのブランドのデザインを名指しで読もうとしても通らない。
  const designs = await handleRequest(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_designs', arguments: { brand_id: 'brand' } } }),
  }), setup.env);
  const blocked = await designs.json() as { result: { isError?: boolean } };
  assert.equal(blocked.result.isError, true);
});

test('heavychain.app のセッションが切れると、MCP も止まる', async () => {
  const setup = oauthSetup();
  const { access } = await signIn(setup);
  setup.revoked.add('alice');
  const response = await handleRequest(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_brands', arguments: {} } }),
  }), setup.env);
  const payload = await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } };
  assert.equal(payload.result.isError, true);
  assert.match(payload.result.content[0].text, /サインイン/);
});

test('認証なしの /mcp は、サインインの在りかを教える', async () => {
  const setup = oauthSetup();
  const response = await handleRequest(new Request(`${ORIGIN}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }), setup.env);
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get('www-authenticate'),
    `Bearer realm="Heavy Chain MCP", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
  );
});

test('拒否すると access_denied で戻り、コードは出ない', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256&state=st-2`);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');
  const response = await send(setup, '/mcp-oauth/approve', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice' },
    body: JSON.stringify({ requestId, approve: false }),
  });
  const { redirectTo } = await response.json() as { redirectTo: string };
  const location = new URL(redirectTo);
  assert.equal(location.searchParams.get('error'), 'access_denied');
  assert.equal(location.searchParams.get('state'), 'st-2');
  assert.equal(location.searchParams.get('code'), null);
});

test('同じ要求を二度承認できない', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');
  const body = JSON.stringify({ requestId, approve: true });
  const headers = { 'content-type': 'application/json', authorization: 'Bearer alice' };
  assert.equal((await send(setup, '/mcp-oauth/approve', { method: 'POST', headers, body })).status, 200);
  assert.equal((await send(setup, '/mcp-oauth/approve', { method: 'POST', headers, body })).status, 409);
});

test('承認にはサインインが要る', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');
  const response = await send(setup, '/mcp-oauth/approve', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, approve: true }),
  });
  assert.equal(response.status, 401);
});

test('code_verifier が合わなければコードを交換できない', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');
  const approve = await send(setup, '/mcp-oauth/approve', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice' },
    body: JSON.stringify({ requestId, approve: true }),
  });
  const code = new URL(((await approve.json()) as { redirectTo: string }).redirectTo).searchParams.get('code') ?? '';

  const wrong = await send(setup, '/mcp-oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id as string,
      code_verifier: 'xDJ8mQ2nR4tV6xY9bC1eF3hJ5kL7nP0qS2uW4yA6cE8' }).toString(),
  });
  assert.equal(wrong.status, 400);
  assert.equal(((await wrong.json()) as { error: string }).error, 'invalid_grant');
});

test('コードは1回しか使えない', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');
  const approve = await send(setup, '/mcp-oauth/approve', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice' },
    body: JSON.stringify({ requestId, approve: true }),
  });
  const code = new URL(((await approve.json()) as { redirectTo: string }).redirectTo).searchParams.get('code') ?? '';
  const exchange = () => send(setup, '/mcp-oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: client.client_id as string }).toString(),
  });
  assert.equal((await exchange()).status, 200);
  assert.equal((await exchange()).status, 400);
});

test('別のクライアントはコードを交換できない', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const { body: other } = await registerClient(setup, { client_name: '別の道具' });
  const authorize = await send(setup, `/mcp-oauth/authorize?response_type=code&client_id=${client.client_id}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${await challengeOf(VERIFIER)}&code_challenge_method=S256`);
  const requestId = new URL(authorize.headers.get('location') ?? '').searchParams.get('request_id');
  const approve = await send(setup, '/mcp-oauth/approve', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer alice' },
    body: JSON.stringify({ requestId, approve: true }),
  });
  const code = new URL(((await approve.json()) as { redirectTo: string }).redirectTo).searchParams.get('code') ?? '';
  const response = await send(setup, '/mcp-oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: other.client_id as string }).toString(),
  });
  assert.equal(response.status, 400);
});

test('更新トークンは1回で入れ替わり、古いものは使えない', async () => {
  const setup = oauthSetup();
  const { clientId, refresh } = await signIn(setup);
  const again = () => send(setup, '/mcp-oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId }).toString(),
  });
  const first = await again();
  assert.equal(first.status, 200);
  const renewed = await first.json() as { access_token: string; refresh_token: string };
  assert.notEqual(renewed.refresh_token, refresh);

  assert.equal((await again()).status, 400, '古い更新トークンは使えてはいけない');

  // 新しいアクセストークンでツールが動く。
  const response = await handleRequest(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${renewed.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_brands', arguments: {} } }),
  }), setup.env);
  const payload = await response.json() as { result: { isError?: boolean } };
  assert.notEqual(payload.result.isError, true);
});

test('知らない grant_type とクライアントは断る', async () => {
  const setup = oauthSetup();
  const { body: client } = await registerClient(setup);
  const unsupported = await send(setup, '/mcp-oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: client.client_id as string }).toString(),
  });
  assert.equal(((await unsupported.json()) as { error: string }).error, 'unsupported_grant_type');

  const unknownClient = await send(setup, '/mcp-oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'nope' }).toString(),
  });
  assert.equal(unknownClient.status, 401);
});

test('封じたセッションは、そのままでは読めない形で置かれる', async () => {
  const setup = oauthSetup();
  await signIn(setup);
  const row = setup.db.sql.prepare('SELECT session_sealed FROM mcp_oauth_tokens LIMIT 1').get() as { session_sealed: string };
  assert.ok(row.session_sealed.length > 0);
  assert.ok(!row.session_sealed.includes('alice'), 'セッションを生のまま置いてはいけない');
  assert.match(row.session_sealed, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('OAuth の道は、ふだんの経路を邪魔しない', async () => {
  const setup = oauthSetup();
  assert.equal((await send(setup, '/v1/health')).status, 200);
  assert.equal((await setup.call('/v1/brands')).status, 200);
  assert.equal((await send(setup, '/mcp-oauth/unknown')).status, 404);
});
