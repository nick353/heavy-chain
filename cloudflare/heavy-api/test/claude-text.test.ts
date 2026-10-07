import assert from 'node:assert/strict';
import test from 'node:test';
import { callClaudeJSON, optimizePrompt, planChatEdit, ClaudeTextError } from '../src/claude-text.ts';
import type { Env } from '../src/index.ts';
import { imageSetup } from './image-ai-fixture.ts';

type Json = Record<string, any>;
const env = (overrides: Record<string, string | undefined> = {}) => ({ ANTHROPIC_API_KEY: 'server-only-test-key', ...overrides }) as Env;
const claudeReply = (value: unknown, extra: Json = {}) => Response.json({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(value) }], ...extra,
});
const optimized = { optimized_prompt: 'linen shirt, natural light', negative_prompt: 'blurry', style_tags: ['natural'],
  suggested_settings: { aspect_ratio: '4:5', quality: 'hd' } };

test('Claude call sends the key server-side with structured output and fallbacks', async () => {
  const box: { request?: Request } = {};
  const result = await callClaudeJSON<{ ok: boolean }>(env(), { system: 'sys', user: 'hello', schema: { type: 'object' } },
    async (url, init) => { box.request = new Request(url, init); return claudeReply({ ok: true }); });
  assert.deepEqual(result, { ok: true });
  const request = box.request; assert(request);
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.headers.get('x-api-key'), 'server-only-test-key');
  assert.equal(request.headers.get('anthropic-version'), '2023-06-01');
  assert.equal(request.headers.get('anthropic-beta'), 'server-side-fallback-2026-07-01');
  const body = await request.json() as Json;
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.output_config, { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } });
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(body.thinking, undefined);
});

test('Claude call honours a configured model and maps failures to stable error codes', async () => {
  const box: { body?: Json } = {};
  await callClaudeJSON(env({ ANTHROPIC_TEXT_MODEL: 'claude-sonnet-5-5' }), { system: 's', user: 'u', schema: {} },
    async (_url, init) => { box.body = JSON.parse(String(init?.body)); return claudeReply({}); });
  assert.equal(box.body?.model, 'claude-sonnet-5-5');
  const cases: Array<[() => Promise<Response>, string, number]> = [
    [async () => new Response('busy', { status: 529 }), 'claude_upstream_529', 429],
    [async () => new Response('bad', { status: 400 }), 'claude_upstream_400', 502],
    [async () => claudeReply({}, { stop_reason: 'refusal', content: [] }), 'claude_request_refused', 422],
    [async () => claudeReply({}, { stop_reason: 'max_tokens' }), 'claude_output_truncated', 502],
    [async () => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), 'claude_invalid_json', 502],
    [async () => { throw new TypeError('network'); }, 'claude_request_failed', 502],
  ];
  for (const [fake, code, status] of cases) {
    await assert.rejects(callClaudeJSON(env(), { system: 's', user: 'u', schema: {} }, fake),
      (error: unknown) => error instanceof ClaudeTextError && error.code === code && error.status === status);
  }
});

test('Claude call refuses to run without a key and never calls fetch', async () => {
  let called = false;
  await assert.rejects(callClaudeJSON(env({ ANTHROPIC_API_KEY: '  ' }), { system: 's', user: 'u', schema: {} },
    async () => { called = true; return claudeReply({}); }),
  (error: unknown) => error instanceof ClaudeTextError && error.code === 'claude_api_key_missing' && error.status === 503);
  assert.equal(called, false);
});

test('optimize-prompt keeps the legacy response shape the generate page reads', async () => {
  const box: { body?: Json } = {};
  const result = await optimizePrompt(env(), { prompt: '春物のリネンシャツ', style: 'natural', brandId: 'brand' },
    async (_url, init) => { box.body = JSON.parse(String(init?.body)); return claudeReply(optimized); });
  assert.deepEqual(result, { success: true, original: '春物のリネンシャツ', ...optimized });
  assert.match(box.body?.messages[0].content, /<request>\n春物のリネンシャツ\n<\/request>/);
  assert.match(box.body?.messages[0].content, /Target style: natural/);
  await assert.rejects(optimizePrompt(env(), { prompt: '   ' }, async () => claudeReply(optimized)),
    (error: unknown) => error instanceof ClaudeTextError && error.code === 'prompt_required' && error.status === 400);
  await assert.rejects(optimizePrompt(env(), { prompt: 'x'.repeat(4001) }, async () => claudeReply(optimized)),
    (error: unknown) => error instanceof ClaudeTextError && error.code === 'prompt_too_long');
});

test('chat-plan routes edits only when an image exists and forwards recent history', async () => {
  const box: { body?: Json } = {};
  const edit = await planChatEdit(env(), { message: 'もっと明るく', hasCurrentImage: true,
    history: [{ role: 'user', content: '白いシャツ' }, { role: 'assistant', content: '生成しました' }, { role: 'system', content: 'ignored' }] },
  async (_url, init) => { box.body = JSON.parse(String(init?.body));
    return claudeReply({ mode: 'edit', instruction: 'Make the lighting brighter; keep everything else.', reply: '明るくします' }); });
  assert.deepEqual(edit, { success: true, mode: 'edit', instruction: 'Make the lighting brighter; keep everything else.', reply: '明るくします' });
  const prompt = box.body?.messages[0].content as string;
  assert.match(prompt, /Current image exists: yes/);
  assert.match(prompt, /user: 白いシャツ\nassistant: 生成しました/);
  assert.doesNotMatch(prompt, /ignored/);
  const noImage = await planChatEdit(env(), { message: '色を変えて', hasCurrentImage: false },
    async () => claudeReply({ mode: 'edit', instruction: 'Change color', reply: '変更します' }));
  assert.equal(noImage.mode, 'generate');
  const blank = await planChatEdit(env(), { message: '赤いドレス' },
    async () => claudeReply({ mode: 'generate', instruction: '  ', reply: '作ります' }));
  assert.equal(blank.instruction, '赤いドレス');
});

const withFetch = async (fake: typeof fetch, run: () => Promise<void>) => {
  const original = globalThis.fetch; globalThis.fetch = fake;
  try { await run(); } finally { globalThis.fetch = original; }
};
const textSetup = (overrides: Record<string, string | undefined> = {}) => {
  const s = imageSetup();
  Object.assign(s.env, { AI_IMAGE_ALLOWED_ACTIONS: 'generate-image,edit-image,model-matrix,optimize-prompt,chat-plan',
    ANTHROPIC_API_KEY: 'server-only-test-key', ...overrides });
  return s;
};

test('provider endpoint returns 503 with a clear code when the Anthropic key is not configured', async (t) => {
  const s = textSetup({ ANTHROPIC_API_KEY: undefined }); t.after(() => s.db.sql.close());
  let called = false;
  await withFetch(async () => { called = true; return claudeReply(optimized); }, async () => {
    const response = await s.call('/v1/provider-actions/optimize-prompt', 'alice', { brandId: 'brand', prompt: 'シャツ' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, error: 'claude_api_key_missing' });
  });
  assert.equal(called, false);
});

test('provider endpoint serves optimize-prompt and chat-plan without touching the image pipeline', async (t) => {
  const s = textSetup(); t.after(() => s.db.sql.close());
  const replies = [claudeReply(optimized), claudeReply({ mode: 'generate', instruction: 'Red dress on white', reply: '作ります' })];
  await withFetch(async (url) => { assert.equal(String(url), 'https://api.anthropic.com/v1/messages'); return replies.shift()!; }, async () => {
    const opt = await s.call('/v1/provider-actions/optimize-prompt', 'alice', { brandId: 'brand', prompt: 'シャツ' });
    assert.equal(opt.status, 200);
    assert.equal((await opt.json() as Json).optimized_prompt, optimized.optimized_prompt);
    const plan = await s.call('/v1/provider-actions/chat-plan', 'alice', { brandId: 'brand', message: '赤いドレス' });
    assert.equal(plan.status, 200);
    assert.equal((await plan.json() as Json).mode, 'generate');
  });
  assert.equal(s.calls.length, 0);
  assert.equal(s.bucket.puts, 0);
});

test('provider endpoint keeps Claude actions behind auth, brand role, and the allow-list', async (t) => {
  const s = textSetup(); t.after(() => s.db.sql.close());
  let called = 0;
  await withFetch(async () => { called++; return claudeReply(optimized); }, async () => {
    assert.equal((await s.call('/v1/provider-actions/optimize-prompt', '', { brandId: 'brand', prompt: 'x' })).status, 401);
    const outsider = await s.call('/v1/provider-actions/optimize-prompt', 'mallory', { brandId: 'brand', prompt: 'x' });
    assert(outsider.status === 403 || outsider.status === 404, `unexpected ${outsider.status}`);
    assert.equal((await s.call('/v1/provider-actions/optimize-prompt', 'alice', { prompt: 'x' })).status, 400);
    Object.assign(s.env, { AI_IMAGE_ALLOWED_ACTIONS: 'generate-image' });
    const disabled = await s.call('/v1/provider-actions/optimize-prompt', 'alice', { brandId: 'brand', prompt: 'x' });
    assert.equal(disabled.status, 503);
    assert.equal((await disabled.json() as Json).error, 'claude_text_not_enabled');
  });
  assert.equal(called, 0);
});

test('image-plan keeps the requested keys and order and attaches the reference image', async () => {
  const { planImages } = await import('../src/claude-text.ts');
  const box: { body?: Json } = {};
  const pixel = 'data:image/png;base64,iVBORw0KGgo=';
  const result = await planImages(env(), { task: 'colorize', items: ['red', 'navy'], imageDataUrl: pixel, pattern: 'stripe' },
    async (_url, init) => { box.body = JSON.parse(String(init?.body));
      return claudeReply({ items: [
        { key: 'RED', label: '赤', prompt: 'Recolor the shirt red', headline: '', subheadline: '' },
        { key: 'x', label: 'ネイビー', prompt: 'Recolor the shirt navy', headline: '', subheadline: '' },
        { key: 'extra', label: '余分', prompt: 'ignored', headline: '', subheadline: '' },
      ] }); });
  assert.deepEqual(result.items.map(item => [item.key, item.label]), [['red', '赤'], ['navy', 'ネイビー']]);
  const content = box.body?.messages[0].content as Json[];
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
  assert.match(content[1].text, /Task: colorize/);
  assert.match(content[1].text, /Pattern: stripe/);
  assert.match(content[1].text, /\["red","navy"\]/);
});

test('image-plan validates the task and plans a single instruction for variations', async () => {
  const { planImages } = await import('../src/claude-text.ts');
  await assert.rejects(planImages(env(), { task: 'nope' }, async () => claudeReply({ items: [] })),
    (error: unknown) => error instanceof ClaudeTextError && error.code === 'invalid_plan_task' && error.status === 400);
  await assert.rejects(planImages(env(), { task: 'banner', items: ['en'] }, async () => claudeReply({ items: [] })),
    (error: unknown) => error instanceof ClaudeTextError && error.code === 'plan_empty');
  const box: { body?: Json } = {};
  const one = await planImages(env(), { task: 'variations', count: 4, brief: 'more casual' },
    async (_url, init) => { box.body = JSON.parse(String(init?.body));
      return claudeReply({ items: [{ key: '1', label: 'v', prompt: 'casual styling', headline: '', subheadline: '' },
        { key: '2', label: 'v', prompt: 'second', headline: '', subheadline: '' }] }); });
  assert.equal(one.items.length, 1);
  assert.match(box.body?.messages[0].content, /Number of items: 1/);
  await assert.rejects(planImages(env(), { task: 'product-shots', imageDataUrl: 'data:image/png;base64,' + 'A'.repeat(7_000_004) }, async () => claudeReply({ items: [] })),
    (error: unknown) => error instanceof ClaudeTextError && error.code === 'plan_image_too_large');
});

test('provider endpoint serves image-plan behind the same gates', async (t) => {
  const s = textSetup({ AI_IMAGE_ALLOWED_ACTIONS: 'generate-image,edit-image,model-matrix,optimize-prompt,chat-plan,image-plan' }); t.after(() => s.db.sql.close());
  await withFetch(async () => claudeReply({ items: [{ key: 'en', label: '英語', prompt: 'banner', headline: 'Spring', subheadline: '' }] }), async () => {
    const response = await s.call('/v1/provider-actions/image-plan', 'alice', { brandId: 'brand', task: 'banner', items: ['en'], headline: '春' });
    assert.equal(response.status, 200);
    const body = await response.json() as Json;
    assert.equal(body.items[0].headline, 'Spring');
  });
  assert.equal(s.calls.length, 0);
});
