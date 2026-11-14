import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../src/index.ts';
import { MCP_TOOL_NAMES } from '../src/mcp.ts';
import { imageSetup, pngFixture } from './image-ai-fixture.ts';

type Setup = ReturnType<typeof imageSetup>;

/** 書き込みのツール。ここに無いものは読み取りで、readOnlyHint が付く。 */
const WRITE_TOOLS = new Set(['create_design', 'edit_design', 'create_model_shots']);

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

/**
 * 試験の土台のモデルは既定で 256x256 を返すが、ツール経由の生成は aspect_ratio から
 * 1024x1024 を期待するので、そのままだと必ず image_provider_invalid_output で失敗する
 * （state が completed にならないので、仕上がりの経路が一度も試されない）。
 */
function drawsFullSize(setup: Setup, width = 1024, height = 1024): void {
  const image = Buffer.from(pngFixture(width, height)).toString('base64');
  setup.setHook(async () => ({ image }));
}

/** text と image を分けて読む（画像を同梱する道具の試験用）。 */
async function toolContent(response: Response): Promise<{ text: string; images: Array<Record<string, unknown>>; isError: boolean }> {
  const payload = await result(response);
  const content = payload.content as Array<Record<string, unknown>>;
  const text = content.filter((part) => part.type === 'text').map((part) => String(part.text)).join('\n');
  const images = content.filter((part) => part.type === 'image');
  return { text, images, isError: payload.isError === true };
}

/**
 * 試験の土台には Cloudflare Images が無いので、この試験の間だけ差し込む。
 * 本番は wrangler.production.jsonc の images バインディング。渡された設定を calls に残す。
 */
function withShrinker(setup: Setup): { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  // 入力のバイトをそのまま返す。生成の経路（enlargeLikeLight・sizeForResolution）も
  // 同じバインディングを使うので、別の画像を返すと生成そのものが壊れる。
  // ストリームは一度しか読めないため、バイトを保持して毎回新しい写しを渡す
  // （sizeForResolution は format を変えて何度も output を呼ぶ）。
  (setup.env as unknown as Record<string, unknown>).IMAGES = {
    input: (stream: unknown) => {
      const bytes = new Response(stream as BodyInit).arrayBuffer();
      const chain = {
        transform(options: Record<string, unknown>) { calls.push({ transform: options }); return chain; },
        async output(options: Record<string, unknown>) {
          calls.push({ output: options });
          const buffer = await bytes;
          return { response: () => new Response(buffer.slice(0)) };
        },
      };
      return chain;
    },
  };
  return { calls };
}

/**
 * 文章系のツール（improve_prompt・plan_design_set・plan_from_message）を試すために、
 * Claude の鍵を入れて、Anthropic への fetch を差し替える。送られた本文を box に残す。
 */
async function withClaude(
  setup: Setup,
  answer: unknown,
  run: (box: { body?: Record<string, unknown> }) => Promise<void>,
): Promise<{ body?: Record<string, unknown> }> {
  const overrides = setup.env as unknown as Record<string, unknown>;
  overrides.ANTHROPIC_API_KEY = 'test-only-key';
  // 試験の土台は画像の3つだけを許している。本番（wrangler.production.jsonc）は7つ全部なので、それに合わせる。
  overrides.AI_IMAGE_ALLOWED_ACTIONS = 'generate-image,edit-image,model-matrix,optimize-prompt,chat-plan,image-plan,profile-extract';
  const box: { body?: Record<string, unknown> } = {};
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    box.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return Response.json({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answer) }],
    });
  }) as typeof fetch;
  try { await run(box); } finally { globalThis.fetch = original; }
  return box;
}

/** 画像の実体つきのデザインを1件用意する（edit_design・create_model_shots の元になるもの）。 */
async function seedDesign(setup: Setup, id: string, options: { user?: string; brand?: string; withBytes?: boolean } = {}) {
  const user = options.user ?? 'alice';
  const brand = options.brand ?? 'brand';
  setup.db.sql.prepare(`INSERT INTO generated_images(id,brand_id,user_id,storage_path,version,is_favorite,prompt,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(id, brand, user, `generated-images/${id}`, 1, 0, 'もとのシャツ', '2026-11-14T00:00:00.000Z');
  if (options.withBytes !== false) {
    await setup.bucket.put(`generated-images/${id}`, setup.output, { customMetadata: {}, httpMetadata: { contentType: 'image/png' } });
  }
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
    const writes = WRITE_TOOLS.has(String(tool.name));
    // 書き込みのツールは readOnlyHint を付けない。付けると ChatGPT 側の毎回の確認が出なくなる。
    assert.equal(annotations.readOnlyHint, !writes, `${String(tool.name)} の readOnlyHint`);
    // 生成は新しいものを足すだけで、既にあるものを壊さない。
    assert.equal(annotations.destructiveHint, false);
    assert.equal(annotations.idempotentHint, !writes, `${String(tool.name)} の idempotentHint`);
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

test('create_design は生成を走らせ、追跡用の request_id を返す', async () => {
  const setup = imageSetup();
  // aspect_ratio 3:4 は 768x1024 を期待する（src/image-ai-contracts.ts の ratios）。
  drawsFullSize(setup, 768, 1024);
  const { text, isError } = await toolText(await call(setup, 'create_design', {
    brand_id: 'brand', prompt: 'リネンのシャツに藍色の波の柄', aspect_ratio: '3:4', count: 1,
  }));
  assert.equal(isError, false, text);
  const id = /request_id: ([0-9a-f-]{36})/.exec(text)?.[1];
  assert.ok(id, `request_id が返っていない: ${text}`);
  // 返った id が、そのまま追跡に使える（画面で始めた生成と同じ経路）。
  const follow = await toolText(await call(setup, 'get_design_request', { request_id: id }));
  assert.equal(follow.isError, false, follow.text);
  assert.match(follow.text, new RegExp(id));
});

test('create_design は、同じ文章でも呼ぶたびに別の生成になる', async () => {
  const setup = imageSetup();
  const first = await toolText(await call(setup, 'create_design', { brand_id: 'brand', prompt: '白いトートバッグ' }));
  const second = await toolText(await call(setup, 'create_design', { brand_id: 'brand', prompt: '白いトートバッグ' }));
  const ids = [first.text, second.text].map((value) => /request_id: ([0-9a-f-]{36})/.exec(value)?.[1]);
  assert.ok(ids[0] && ids[1]);
  assert.notEqual(ids[0], ids[1]);
});

test('create_design は入力の間違いを、直し方つきで断る', async () => {
  const setup = imageSetup();
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ prompt: 'シャツ' }, /brand_id/],
    [{ brand_id: 'brand' }, /prompt/],
    [{ brand_id: 'brand', prompt: '  ' }, /prompt/],
    [{ brand_id: 'brand', prompt: 'シャツ', aspect_ratio: '7:3' }, /aspect_ratio/],
    [{ brand_id: 'brand', prompt: 'シャツ', count: 9 }, /count/],
    [{ brand_id: 'brand', prompt: 'シャツ', count: 1.5 }, /count/],
    [{ brand_id: 'brand', prompt: 'シャツ', resolution: '8k' }, /resolution/],
  ];
  for (const [args, expected] of cases) {
    const { text, isError } = await toolText(await call(setup, 'create_design', args));
    assert.equal(isError, true, `通ってしまった: ${JSON.stringify(args)}`);
    assert.match(text, expected);
  }
});

test('create_design は、他人のブランドでは生成しない', async () => {
  const setup = imageSetup();
  const { text, isError } = await toolText(await call(setup, 'create_design', {
    brand_id: 'brand', prompt: 'シャツ',
  }, 'other'));
  assert.equal(isError, true);
  assert.match(text, /list_brands|権限/);
});

test('create_design は、他社ブランドを真似る文章を断る', async () => {
  const setup = imageSetup();
  const { text, isError } = await toolText(await call(setup, 'create_design', {
    brand_id: 'brand', prompt: 'a hoodie in the style of nike',
  }));
  assert.equal(isError, true);
  assert.match(text, /他社のロゴやブランド/);
});

test('edit_design は、自分のデザインを元に直しの生成を始める', async () => {
  const setup = imageSetup();
  drawsFullSize(setup);
  await seedDesign(setup, 'design-1');
  const { text, isError } = await toolText(await call(setup, 'edit_design', {
    brand_id: 'brand', source_design_id: 'design-1', prompt: '色を藍色にして',
  }));
  assert.equal(isError, false, text);
  const id = /request_id: ([0-9a-f-]{36})/.exec(text)?.[1];
  assert.ok(id, `request_id が返っていない: ${text}`);
  // 元の画像が参考として実際にモデルへ渡っている。
  assert.ok(setup.calls.length > 0, 'モデルが呼ばれていない');
});

test('edit_design は、他人のデザインを元にできない', async () => {
  const setup = imageSetup();
  await seedDesign(setup, 'design-other', { user: 'other' });
  const { text, isError } = await toolText(await call(setup, 'edit_design', {
    brand_id: 'brand', source_design_id: 'design-other', prompt: '色を変えて',
  }));
  assert.equal(isError, true);
  assert.match(text, /見つかりません|list_designs/);
});

test('edit_design は、画像の実体が無いデザインを断る', async () => {
  const setup = imageSetup();
  await seedDesign(setup, 'design-empty', { withBytes: false });
  const { text, isError } = await toolText(await call(setup, 'edit_design', {
    brand_id: 'brand', source_design_id: 'design-empty', prompt: '色を変えて',
  }));
  assert.equal(isError, true);
  assert.match(text, /保管庫|get_design_request/);
});

test('create_model_shots は、服のデザインから人が着ている絵の生成を始める', async () => {
  const setup = imageSetup();
  drawsFullSize(setup, 768, 1024);
  await seedDesign(setup, 'design-1');
  const { text, isError } = await toolText(await call(setup, 'create_model_shots', {
    brand_id: 'brand', garment_design_id: 'design-1', body_types: ['regular'], age_groups: ['20s'], gender: 'female',
  }));
  assert.equal(isError, false, text);
  assert.match(text, /request_id: [0-9a-f-]{36}/);
});

test('create_model_shots は、組み合わせが3通りを超えると断る', async () => {
  const setup = imageSetup();
  await seedDesign(setup, 'design-1');
  const { text, isError } = await toolText(await call(setup, 'create_model_shots', {
    brand_id: 'brand', garment_design_id: 'design-1', body_types: ['slim', 'regular'], age_groups: ['20s', '30s'],
  }));
  assert.equal(isError, true);
  assert.match(text, /3通り/);
});

test('create_model_shots は、選べない体型・年代・性別を断る', async () => {
  const setup = imageSetup();
  await seedDesign(setup, 'design-1');
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ body_types: ['tall'] }, /body_types/],
    [{ body_types: ['slim', 'slim'] }, /body_types/],
    [{ age_groups: ['60s'] }, /age_groups/],
    [{ gender: 'other' }, /gender/],
    [{ skin_tone: 'blue' }, /skin_tone/],
    [{ hair_style: 'curly' }, /hair_style/],
  ];
  for (const [extra, expected] of cases) {
    const { text, isError } = await toolText(await call(setup, 'create_model_shots', {
      brand_id: 'brand', garment_design_id: 'design-1', ...extra,
    }));
    assert.equal(isError, true, `通ってしまった: ${JSON.stringify(extra)}`);
    assert.match(text, expected);
  }
});

test('edit_design と create_model_shots は、id の形の間違いを API を呼ぶ前に断る', async () => {
  const setup = imageSetup();
  const edit = await toolText(await call(setup, 'edit_design', { brand_id: 'brand', source_design_id: '../secret', prompt: 'x' }));
  assert.equal(edit.isError, true);
  assert.match(edit.text, /source_design_id/);
  const shots = await toolText(await call(setup, 'create_model_shots', { brand_id: 'brand', garment_design_id: '' }));
  assert.equal(shots.isError, true);
  assert.match(shots.text, /garment_design_id/);
});

test('improve_prompt は、整えた文章を返す（画像は描かない）', async () => {
  const setup = imageSetup();
  const answer = { optimized_prompt: 'linen shirt, indigo wave print, natural light', negative_prompt: 'blurry',
    style_tags: ['natural'], suggested_settings: { aspect_ratio: '4:5', quality: 'hd' } };
  const box = await withClaude(setup, answer, async () => {
    const { text, isError } = await toolText(await call(setup, 'improve_prompt', {
      brand_id: 'brand', prompt: 'リネンのシャツ 藍色の波', style: 'studio product photo', target_platform: 'Etsy',
    }));
    assert.equal(isError, false, text);
    assert.match(text, /linen shirt, indigo wave print/);
  });
  // 画風と出す先が、そのままモデルへの指示に入っている。
  const user = String((box.body?.messages as Array<{ content: unknown }>)[0].content);
  assert.match(user, /studio product photo/);
  assert.match(user, /Etsy/);
  // 画像の生成は1件も走っていない。
  assert.equal(setup.calls.length, 0);
});

test('plan_design_set は、種類ごとに複数枚の構成を返す', async () => {
  const setup = imageSetup();
  const answer = { items: [{ key: 'a', prompt: 'front view' }, { key: 'b', prompt: 'back view' }] };
  await withClaude(setup, answer, async () => {
    const { text, isError } = await toolText(await call(setup, 'plan_design_set', {
      brand_id: 'brand', task: 'product-shots', brief: '白いトートバッグの出品用', count: 2,
    }));
    assert.equal(isError, false, text);
    assert.match(text, /front view/);
  });
  assert.equal(setup.calls.length, 0);
});

test('plan_design_set は、参考のデザインを型つきのデータ URL でモデルに渡す', async () => {
  const setup = imageSetup();
  await seedDesign(setup, 'design-1');
  const box = await withClaude(setup, { items: [{ key: 'a', prompt: 'variation' }] }, async () => {
    const { isError } = await toolText(await call(setup, 'plan_design_set', {
      brand_id: 'brand', task: 'variations', reference_design_id: 'design-1',
    }));
    assert.equal(isError, false);
  });
  // プレフィックスを忘れると imageBlock が null を返して画像が黙って落ちるので、ここを必ず確かめる。
  const content = (box.body?.messages as Array<{ content: unknown }>)[0].content as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(content), '画像つきの形で送られていない');
  const image = content.find((part) => part.type === 'image');
  assert.ok(image, '画像が送られていない');
  const source = image.source as Record<string, unknown>;
  assert.equal(source.type, 'base64');
  assert.equal(source.media_type, 'image/png');
  assert.ok(String(source.data).length > 0);
});

test('plan_from_message は、作るか直すかを答える', async () => {
  const setup = imageSetup();
  const answer = { mode: 'edit', instruction: '袖を長くする', reply: '袖を長くしますね' };
  const box = await withClaude(setup, answer, async () => {
    const { text, isError } = await toolText(await call(setup, 'plan_from_message', {
      brand_id: 'brand', message: '袖を長くして', has_current_image: true,
      history: [{ role: 'user', content: 'シャツを作って' }, { role: 'assistant', content: '描きました' }],
    }));
    assert.equal(isError, false, text);
    assert.match(text, /"mode": "edit"/);
  });
  const user = String((box.body?.messages as Array<{ content: unknown }>)[0].content);
  assert.match(user, /Current image exists: yes/);
  assert.match(user, /シャツを作って/);
});

test('文章系のツールは、入力の間違いを API を呼ぶ前に断る', async () => {
  const setup = imageSetup();
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['improve_prompt', { brand_id: 'brand' }, /prompt/],
    ['improve_prompt', { prompt: 'x' }, /brand_id/],
    ['plan_design_set', { brand_id: 'brand', task: 'poster' }, /task/],
    ['plan_design_set', { brand_id: 'brand', task: 'banner', count: 99 }, /count/],
    ['plan_design_set', { brand_id: 'brand', task: 'banner', reference_design_id: '../x' }, /reference_design_id/],
    ['plan_from_message', { brand_id: 'brand' }, /message/],
    ['plan_from_message', { brand_id: 'brand', message: 'x', has_current_image: 'yes' }, /has_current_image/],
    ['plan_from_message', { brand_id: 'brand', message: 'x', history: [{ role: 'system', content: 'x' }] }, /role/],
  ];
  for (const [name, args, expected] of cases) {
    const { text, isError } = await toolText(await call(setup, name, args));
    assert.equal(isError, true, `通ってしまった: ${name} ${JSON.stringify(args)}`);
    assert.match(text, expected);
  }
});

test('生成の返り文は、その場で終わったかどうかと食い違わない', async () => {
  const setup = imageSetup();
  drawsFullSize(setup);
  const { text, isError } = await toolText(await call(setup, 'create_design', { brand_id: 'brand', prompt: 'シャツ' }));
  assert.equal(isError, false, text);
  // 2026-11-15 に本番で実測: create_design の呼び出しの中で state が completed になり、画像の URL まで返った。
  // 終わっているのに「まだ途中」と書くと、モデルが無駄に get_design_request を呼ぶ。
  // drawsFullSize を当てているので、この呼び出しの中で completed になる。
  assert.match(text, /"state": "completed"/);
  assert.match(text, /生成が終わりました/);
  assert.doesNotMatch(text, /まだ描いている途中/);
  // どちらの場合も request_id は必ず返す（あとから画面や get_design_request で辿れるように）。
  assert.match(text, /request_id: [0-9a-f-]{36}/);
});

test('create_design は、できた絵そのものを結果に同梱する', async () => {
  const setup = imageSetup();
  drawsFullSize(setup);
  const shrinker = withShrinker(setup);
  const { text, images, isError } = await toolContent(await call(setup, 'create_design', {
    brand_id: 'brand', prompt: 'リネンのシャツ',
  }));
  assert.equal(isError, false, text);
  // URL だけではモデルが中身を見られないので、image の content が必ず付く。
  assert.equal(images.length, 1, `画像が同梱されていない: ${text}`);
  assert.equal(images[0].mimeType, 'image/jpeg');
  assert.ok(String(images[0].data).length > 0);
  assert.match(text, /写し/);
  // 長辺512px に収める形で、JPEG にして渡している。
  const transform = shrinker.calls.find((entry) => entry.transform)?.transform as Record<string, unknown>;
  assert.deepEqual(transform, { width: 512, height: 512, fit: 'scale-down' });
  const output = shrinker.calls.find((entry) => entry.output)?.output as Record<string, unknown>;
  assert.deepEqual(output, { format: 'image/jpeg', quality: 80 });
});

test('list_designs の with_images は、絵そのものを最大3枚まで付ける', async () => {
  const setup = imageSetup();
  withShrinker(setup);
  for (const id of ['design-1', 'design-2', 'design-3', 'design-4']) await seedDesign(setup, id);
  const { text, images, isError } = await toolContent(await call(setup, 'list_designs', {
    brand_id: 'brand', with_images: true,
  }));
  assert.equal(isError, false, text);
  assert.equal(images.length, 3, '3枚に切れていない');
  for (const image of images) assert.equal(image.mimeType, 'image/jpeg');
  assert.match(text, /新しい順で3枚/);
});

test('with_images を渡さなければ画像は付かない（文脈を勝手に食わない）', async () => {
  const setup = imageSetup();
  withShrinker(setup);
  await seedDesign(setup, 'design-1');
  const plain = await toolContent(await call(setup, 'list_designs', { brand_id: 'brand' }));
  assert.equal(plain.images.length, 0);
  const urls = await toolContent(await call(setup, 'list_designs', { brand_id: 'brand', with_image_urls: true }));
  assert.equal(urls.images.length, 0);
  assert.match(urls.text, /image_url_signed/);
});

test('縮小ができない環境でも、結果そのものは返る', async () => {
  const setup = imageSetup();
  // IMAGES を差し込まない（本番で images バインディングが外れた場合と同じ）。
  await seedDesign(setup, 'design-1');
  const { text, images, isError } = await toolContent(await call(setup, 'list_designs', {
    brand_id: 'brand', with_images: true,
  }));
  assert.equal(isError, false);
  assert.equal(images.length, 0);
  assert.match(text, /design-1/);
  assert.match(text, /写しは作れませんでした/);
});

test('get_design_request も、仕上がった絵を同梱する', async () => {
  const setup = imageSetup();
  drawsFullSize(setup);
  withShrinker(setup);
  const started = await toolContent(await call(setup, 'create_design', { brand_id: 'brand', prompt: 'トートバッグ' }));
  const id = /request_id: ([0-9a-f-]{36})/.exec(started.text)?.[1];
  assert.ok(id);
  const followed = await toolContent(await call(setup, 'get_design_request', { request_id: id }));
  assert.equal(followed.isError, false, followed.text);
  assert.equal(followed.images.length, 1);
  assert.equal(followed.images[0].mimeType, 'image/jpeg');
});

test('with_images の指定が true / false 以外なら断る', async () => {
  const setup = imageSetup();
  const { text, isError } = await toolText(await call(setup, 'list_designs', { brand_id: 'brand', with_images: 'yes' }));
  assert.equal(isError, true);
  assert.match(text, /with_images/);
});

test('生成が落ちたときは、失敗として伝えて待たせない', async () => {
  const setup = imageSetup();
  // 土台のモデルは 256x256 を返すので、ツール経由の生成は image_provider_invalid_output で落ちる。
  // これを「生成を始めました／まだ描いている途中」と返すと、モデルが終わらないものを待ち続ける。
  const { text, isError } = await toolText(await call(setup, 'create_design', { brand_id: 'brand', prompt: 'シャツ' }));
  assert.match(text, /"state": "failed"/);
  assert.equal(isError, true, '失敗が失敗として伝わっていない');
  assert.match(text, /生成に失敗しました/);
  assert.doesNotMatch(text, /まだ描いている途中/);
  assert.match(text, /理由があります/);
});
