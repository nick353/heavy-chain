import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.ts';
import { MCP_TOOL_NAMES } from '../src/mcp.ts';
import { imageSetup } from './image-ai-fixture.ts';

type Setup = ReturnType<typeof imageSetup>;

/** MCP クライアント（ChatGPT・Claude）はサーバー間で呼ぶので Origin を送らない。 */
function rpc(setup: Setup, body: unknown, options: { user?: string | null; origin?: string } = {}): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  const user = options.user === undefined ? 'alice' : options.user;
  if (user) headers.set('authorization', `Bearer ${user}`);
  if (options.origin) headers.set('origin', options.origin);
  return handleRequest(new Request('https://heavy.test/mcp', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), setup.env);
}

const call = (setup: Setup, name: string, args: unknown, user?: string) =>
  rpc(setup, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }, user === undefined ? {} : { user });

async function result(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200);
  const body = await response.json() as { result?: Record<string, unknown>; error?: unknown };
  assert.equal(body.error, undefined, `unexpected JSON-RPC error: ${JSON.stringify(body.error)}`);
  assert.ok(body.result, 'no result');
  return body.result;
}

async function toolText(response: Response): Promise<{ text: string; isError: boolean }> {
  const payload = await result(response);
  const content = payload.content as Array<{ type: string; text: string }>;
  assert.equal(content.length, 1);
  assert.equal(content[0].type, 'text');
  return { text: content[0].text, isError: payload.isError === true };
}

test('GET /mcp は 405 で、受信ストリームを持たないことを伝える', async () => {
  const setup = imageSetup();
  const response = await handleRequest(new Request('https://heavy.test/mcp', {
    headers: { authorization: 'Bearer alice' },
  }), setup.env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('認証なしの呼び出しは 401 と WWW-Authenticate を返す', async () => {
  const setup = imageSetup();
  const response = await rpc(setup, { jsonrpc: '2.0', id: 1, method: 'initialize' }, { user: null });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer /);
});

test('失効したセッションのツール呼び出しは、サインインし直すよう答える', async () => {
  const setup = imageSetup();
  setup.revoked.add('alice');
  const { text, isError } = await toolText(await call(setup, 'list_brands', {}));
  assert.equal(isError, true);
  assert.match(text, /サインイン/);
});

test('initialize は要求された版・ツールの能力・使い方を返す', async () => {
  const setup = imageSetup();
  const payload = await result(await rpc(setup, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  }));
  assert.equal(payload.protocolVersion, '2025-11-25');
  assert.deepEqual(payload.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(payload.serverInfo, { name: 'heavy-chain', title: 'Heavy Chain', version: '1.0.0' });
  // 最初の512字に大事なことを置く（ChatGPT と Codex はここまでを強く読む）。
  const instructions = payload.instructions as string;
  assert.ok(instructions.length <= 512, `instructions が長すぎる: ${instructions.length}`);
  assert.match(instructions, /list_brands/);
});

test('知らない版を要求されたら、こちらが対応する版を返す', async () => {
  const setup = imageSetup();
  const payload = await result(await rpc(setup, {
    jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' },
  }));
  assert.equal(payload.protocolVersion, '2025-06-18');
});

test('notifications/initialized は本文なしの 202', async () => {
  const setup = imageSetup();
  const response = await rpc(setup, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
});

test('id の無い普通の要求は invalid request', async () => {
  const setup = imageSetup();
  const response = await rpc(setup, { jsonrpc: '2.0', method: 'tools/list' });
  assert.equal(response.status, 400);
  const body = await response.json() as { error: { code: number } };
  assert.equal(body.error.code, -32600);
});

test('tools/list は全部のツールを出し、読み取りには readOnlyHint を付ける', async () => {
  const setup = imageSetup();
  const payload = await result(await rpc(setup, { jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  const tools = payload.tools as Array<Record<string, unknown>>;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...MCP_TOOL_NAMES].sort());
  for (const tool of tools) {
    const annotations = tool.annotations as Record<string, unknown>;
    // ここまでのツールは全部読み取り。書き込みを足すときは、この試験を分けて明示する。
    assert.equal(annotations.readOnlyHint, true, `${String(tool.name)} の readOnlyHint`);
    assert.equal(annotations.destructiveHint, false);
    assert.ok(tool.description, `${String(tool.name)} に説明が無い`);
    const schema = tool.inputSchema as Record<string, unknown>;
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
  }
  const openWorld = Object.fromEntries(tools.map((tool) => [tool.name, (tool.annotations as Record<string, unknown>).openWorldHint]));
  assert.equal(openWorld.search_reference_images, true);
  assert.equal(openWorld.search_products, true);
  assert.equal(openWorld.list_brands, false);
});

test('list_brands は、このアカウントが使えるブランドを返す', async () => {
  const setup = imageSetup();
  const { text, isError } = await toolText(await call(setup, 'list_brands', {}));
  assert.equal(isError, false);
  const brands = JSON.parse(text) as Array<{ id: string; name: string }>;
  assert.deepEqual(brands.map((brand) => brand.id), ['brand']);
});

test('list_designs は、そのブランドのデザインを新しい順に返す', async () => {
  const setup = imageSetup();
  setup.db.sql.prepare(`INSERT INTO generated_images(id,brand_id,user_id,storage_path,version,is_favorite,prompt,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('design-1', 'brand', 'alice', 'generated-images/design-1', 1, 0, 'リネンのシャツ', '2026-11-13T00:00:00.000Z');
  const { text, isError } = await toolText(await call(setup, 'list_designs', { brand_id: 'brand', limit: 5 }));
  assert.equal(isError, false);
  const designs = JSON.parse(text) as Array<{ id: string; prompt: string }>;
  assert.deepEqual(designs.map((design) => design.id), ['design-1']);
  assert.equal(designs[0].prompt, 'リネンのシャツ');
});

test('list_designs の with_image_urls は、期限つきの画像 URL を足す', async () => {
  const setup = imageSetup();
  setup.db.sql.prepare(`INSERT INTO generated_images(id,brand_id,user_id,storage_path,version,is_favorite,prompt,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('design-1', 'brand', 'alice', 'generated-images/design-1', 1, 0, 'シャツ', '2026-11-13T00:00:00.000Z');
  const { text } = await toolText(await call(setup, 'list_designs', { brand_id: 'brand', with_image_urls: true }));
  const designs = JSON.parse(text) as Array<{ image_url_signed?: string }>;
  assert.equal(designs.length, 1);
  assert.match(designs[0].image_url_signed ?? '', /\/v1\/media\/read\?/);
});

test('他人のブランドの一覧は、見つからないと伝えて止まる', async () => {
  const setup = imageSetup();
  const { text, isError } = await toolText(await call(setup, 'list_designs', { brand_id: 'brand' }, 'other'));
  assert.equal(isError, true);
  assert.match(text, /list_brands/);
});

test('形の違う brand_id は、API を呼ぶ前に断る', async () => {
  const setup = imageSetup();
  for (const value of ['', '../brand', 'a'.repeat(200), 42]) {
    const { isError, text } = await toolText(await call(setup, 'list_designs', { brand_id: value }));
    assert.equal(isError, true, `${JSON.stringify(value)} が通ってしまった`);
    assert.match(text, /brand_id/);
  }
});

test('範囲の外の limit と order は断る', async () => {
  const setup = imageSetup();
  const big = await toolText(await call(setup, 'list_designs', { brand_id: 'brand', limit: 500 }));
  assert.equal(big.isError, true);
  assert.match(big.text, /limit/);
  const order = await toolText(await call(setup, 'list_designs', { brand_id: 'brand', order: 'random' }));
  assert.equal(order.isError, true);
  assert.match(order.text, /order/);
});

test('search_products は brand と project の両方を要る', async () => {
  const setup = imageSetup();
  const missing = await toolText(await call(setup, 'search_products', { brand_id: 'brand', queries: ['トートバッグ'] }));
  assert.equal(missing.isError, true);
  assert.match(missing.text, /project_id/);
  const empty = await toolText(await call(setup, 'search_products', { brand_id: 'brand', project_id: 'p1', queries: [] }));
  assert.equal(empty.isError, true);
  assert.match(empty.text, /queries/);
});

test('search_reference_images は探す言葉を要る', async () => {
  const setup = imageSetup();
  const { isError, text } = await toolText(await call(setup, 'search_reference_images', { q: '   ' }));
  assert.equal(isError, true);
  assert.match(text, /q /);
});

test('get_design_request は UUID 以外を断る', async () => {
  const setup = imageSetup();
  const { isError, text } = await toolText(await call(setup, 'get_design_request', { request_id: 'not-a-uuid' }));
  assert.equal(isError, true);
  assert.match(text, /UUID/);
});

test('知らないツール名と、形の違う引数は JSON-RPC のエラー', async () => {
  const setup = imageSetup();
  for (const [params, code] of [
    [{ name: 'delete_everything', arguments: {} }, -32602],
    [{ name: 'list_brands', arguments: 'not-an-object' }, -32602],
    [{ arguments: {} }, -32602],
    ['not-an-object', -32602],
  ] as Array<[unknown, number]>) {
    const response = await rpc(setup, { jsonrpc: '2.0', id: 3, method: 'tools/call', params });
    const body = await response.json() as { error?: { code: number } };
    assert.equal(body.error?.code, code, `${JSON.stringify(params)}`);
  }
});

test('知らない method は method not found', async () => {
  const setup = imageSetup();
  const response = await rpc(setup, { jsonrpc: '2.0', id: 4, method: 'resources/list' });
  const body = await response.json() as { error: { code: number } };
  assert.equal(body.error.code, -32601);
});

test('ping は空の結果を返す', async () => {
  const setup = imageSetup();
  assert.deepEqual(await result(await rpc(setup, { jsonrpc: '2.0', id: 5, method: 'ping' })), {});
});

test('JSON でない本文、配列、版違いは断る', async () => {
  const setup = imageSetup();
  const broken = await rpc(setup, '{');
  assert.equal(broken.status, 400);
  assert.equal(((await broken.json()) as { error: { code: number } }).error.code, -32700);

  const batched = await rpc(setup, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  assert.equal(batched.status, 400);
  assert.equal(((await batched.json()) as { error: { code: number } }).error.code, -32600);

  const wrongVersion = await rpc(setup, { jsonrpc: '1.0', id: 1, method: 'tools/list' });
  assert.equal(wrongVersion.status, 400);
  assert.equal(((await wrongVersion.json()) as { error: { code: number } }).error.code, -32600);
});

test('知らない Origin からのブラウザの呼び出しは断る（DNS rebinding 対策）', async () => {
  const setup = imageSetup();
  const blocked = await rpc(setup, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'https://evil.test' });
  assert.equal(blocked.status, 403);
  // 画面と同じ origin は通す。
  const allowed = await rpc(setup, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'https://heavy.test' });
  assert.equal(allowed.status, 200);
});

test('大きすぎる本文は断る', async () => {
  const setup = imageSetup();
  const response = await rpc(setup, {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'list_brands', arguments: { padding: 'x'.repeat(300_000) } },
  });
  assert.equal(response.status, 413);
});

test('/mcp 以外の経路は今までどおり（MCP の入口が邪魔をしない）', async () => {
  const setup = imageSetup();
  const health = await handleRequest(new Request('https://heavy.test/v1/health'), setup.env);
  assert.equal(health.status, 200);
  const brands = await setup.call('/v1/brands');
  assert.equal(brands.status, 200);
});
