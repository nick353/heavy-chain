import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest, type Env } from '../src/index.ts';
import { DESIGN_ASSISTANT_ABANDONED_MS, DESIGN_ASSISTANT_DAILY_LIMIT, DESIGN_ASSISTANT_MODEL, DESIGN_ASSISTANT_TIMEOUT_MS } from '../src/designAssistant.ts';

class Db {
  sql: DatabaseSync;
  fail: { match: RegExp; phase: 'before' | 'after' | 'read' } | null = null;
  writes: string[] = [];
  beforeWrite: ((sql: string) => void) | null = null;
  constructor(path = ':memory:', initialize = true) {
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (!initialize) return;
    const folder = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) this.sql.exec(readFileSync(new URL(file, folder), 'utf8'));
    for (const user of ['alice', 'bob', 'viewer']) {
      this.sql.prepare('INSERT INTO user_identities VALUES (?,?,?,?)').run(user, 'assistant-issuer', user, '2026-10-01');
      this.sql.prepare('INSERT INTO users (id,email,created_at,updated_at) VALUES (?,?,?,?)').run(user, `${user}@example.test`, '2026-10-01', '2026-10-01');
    }
    for (const brand of ['brand-1', 'brand-2']) this.sql.prepare('INSERT INTO brands (id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(brand, 'alice', brand, '2026-10-01', '2026-10-01');
    for (const [user, role] of [['bob', 'editor'], ['viewer', 'viewer']]) this.sql.prepare('INSERT INTO brand_members (id,brand_id,user_id,role,joined_at) VALUES (?,?,?,?,?)').run(`${user}-member`, 'brand-1', user, role, '2026-10-01');
    for (const [doc, owner, brand] of [['doc-a', 'alice', 'brand-1'], ['doc-b', 'bob', 'brand-1'], ['doc-a2', 'alice', 'brand-2']])
      this.sql.prepare('INSERT INTO canvas_documents (id,owner_id,brand_id,created_at,updated_at) VALUES (?,?,?,?,?)').run(doc, owner, brand, '2026-10-01', '2026-10-01');
    for (const [image, owner, brand] of [['image-a', 'alice', 'brand-1'], ['image-b', 'bob', 'brand-1'], ['image-a2', 'alice', 'brand-2']])
      this.sql.prepare('INSERT INTO generated_images (id,user_id,brand_id,storage_path,created_at) VALUES (?,?,?,?,?)').run(image, owner, brand, `generated-images/${image}`, '2026-10-01');
  }
  maybeFail(sql: string, phase: 'before' | 'after' | 'read') {
    if (this.fail?.phase === phase && this.fail.match.test(sql)) { this.fail = null; throw new Error('D1 response unavailable'); }
  }
  prepare(sql: string) {
    const db = this;
    return new class {
      values: SQLInputValue[] = [];
      bind(...values: SQLInputValue[]) { this.values = values; return this; }
      async first<T>() { db.maybeFail(sql, 'read'); return (db.sql.prepare(sql).get(...this.values) ?? null) as T | null; }
      async all() { return { results: db.sql.prepare(sql).all(...this.values) }; }
      async run() {
        db.beforeWrite?.(sql);
        db.maybeFail(sql, 'before'); db.writes.push(sql);
        const result = db.sql.prepare(sql).run(...this.values);
        db.maybeFail(sql, 'after'); return { meta: result };
      }
    }();
  }
}
const input = (requestId: string = crypto.randomUUID()) => ({ requestId, brandId: 'brand-1', projectId: 'doc-a', conversationId: 'conversation-a', prompt: '  素材を分析してください。\n', history: [] as { role: 'user' | 'assistant'; content: string }[], references: [] as { order: number; kind: 'upload' | 'scene-asset'; imageId: string; storagePath: string; name: string; sceneAssetKey?: string }[] });
type Provider = (model: string, value: unknown) => Promise<unknown>;
function setup(db = new Db()) {
  const calls: { model: string; input: unknown }[] = [];
  let provider: Provider = async () => ({ response: '  画像に合う素材は綿です。\n', usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 } });
  const gets: string[] = [];
  const images = new Map<string, { bytes: Uint8Array; mime: string; size?: number }>([
    ['generated-images/image-a', { bytes: new Uint8Array([137, 80, 78, 71]), mime: 'image/png' }],
    ['generated-images/image-b', { bytes: new Uint8Array([255, 216, 255]), mime: 'image/jpeg' }],
  ]);
  const env = {
    DB: db, FRONTEND_ORIGINS: 'https://heavy.test',
    MEDIA_TOKEN_VERIFIER: (r: Request) => ({ issuer: 'assistant-issuer', subject: r.headers.get('authorization')!.slice(7) }),
    AI: { run: async (model: string, value: unknown) => { calls.push({ model, input: value }); return provider(model, value); } },
    PRIVATE_MEDIA: { get: async (key: string) => {
      gets.push(key); const image = images.get(key);
      if (!image) return null;
      return { size: image.size ?? image.bytes.byteLength, httpMetadata: { contentType: image.mime },
        body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(image.bytes); controller.close(); } }) };
    } },
  } as unknown as Env;
  const call = (method: string, body: ReturnType<typeof input>, user: string | null = 'alice') => handleRequest(new Request(
    'https://api.test/v1/design-assistant/requests' + (method === 'GET' ? `/${body.requestId}?${new URLSearchParams({ brand_id: body.brandId, project_id: body.projectId, conversation_id: body.conversationId })}` : ''),
    { method, headers: { ...(user ? { authorization: `Bearer ${user}` } : {}), origin: 'https://heavy.test', 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }), env);
  return { db, env, call, calls, gets, images, setProvider: (next: Provider) => { provider = next; }, row: (requestId: string) => db.sql.prepare('SELECT * FROM design_assistant_requests WHERE request_id = ?').get(requestId) };
}

test('authenticated multimodal response uses exact owned R2 bytes, ordered manifest and durable text receipt', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const body = input();
  body.history = [{ role: 'user', content: '履歴の入力' }, { role: 'assistant', content: '履歴の応答' }];
  body.references = [
    { order: 0, kind: 'scene-asset', imageId: 'image-a', storagePath: 'generated-images/image-a', name: 'scene', sceneAssetKey: 'scene-one' },
    { order: 1, kind: 'upload', imageId: 'image-a', storagePath: 'generated-images/image-a', name: 'upload' },
  ];
  const response = await s.call('POST', body); assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://heavy.test');
  const result = await response.json();
  assert.deepEqual(result, { requestId: body.requestId, state: 'completed', content: '  画像に合う素材は綿です。\n', usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 }, provider: 'workers-ai', model: DESIGN_ASSISTANT_MODEL });
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].model, DESIGN_ASSISTANT_MODEL);
  const sent = s.calls[0].input as { messages: { role: string; content: unknown }[]; stream: boolean; max_tokens: number; tools?: unknown };
  assert.equal(sent.stream, false); assert.equal(sent.max_tokens, 1536); assert.equal(sent.tools, undefined);
  assert.deepEqual(sent.messages.slice(1, 3), body.history);
  assert.deepEqual(sent.messages.at(-1)?.content, [
    { type: 'text', text: body.prompt },
    { type: 'text', text: JSON.stringify(body.references[0]) }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } },
    { type: 'text', text: JSON.stringify(body.references[1]) }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } },
  ]);
  assert.deepEqual(s.gets, ['generated-images/image-a', 'generated-images/image-a']);
  assert.equal(s.row(body.requestId)?.content, (result as { content: string }).content);
  assert.equal(s.row(body.requestId)?.project_id, 'doc-a'); assert.equal(s.row(body.requestId)?.owner_id, 'alice');
  assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM generation_jobs').get()?.n, 0);
});

test('completed duplicate is cached, object-key order is canonical, changed exact prompt/history/reference digest conflicts', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const body = input();
  const result = await (await s.call('POST', body)).json();
  assert.deepEqual(await (await s.call('POST', { references: body.references, history: body.history, prompt: body.prompt, conversationId: body.conversationId, projectId: body.projectId, brandId: body.brandId, requestId: body.requestId })).json(), result);
  for (const changed of [{ ...body, prompt: body.prompt.trim() }, { ...body, history: [{ role: 'user' as const, content: 'different' }] }, { ...body, references: [{ order: 0, kind: 'upload' as const, imageId: 'image-a', storagePath: 'generated-images/image-a', name: 'different' }] }])
    assert.equal((await s.call('POST', changed)).status, 409);
  assert.deepEqual(await (await s.call('GET', body)).json(), result);
  assert.equal(s.calls.length, 1); assert.equal(s.db.sql.prepare('SELECT COUNT(*) n FROM design_assistant_requests').get()?.n, 1);
});

test('independent SQLite connections and concurrent identical POST have exactly one insertion/inference winner', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'heavy-assistant-')); const path = join(directory, 'requests.sqlite');
  const a = setup(new Db(path)); const b = setup(new Db(path, false));
  t.after(() => { a.db.sql.close(); b.db.sql.close(); rmSync(directory, { recursive: true, force: true }); });
  let release!: (result: unknown) => void; const pending = new Promise<unknown>(resolve => { release = resolve; });
  a.setProvider(async () => pending); b.setProvider(async () => pending);
  const body = input(); const posts = Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).call('POST', body));
  // Drain async authentication/digest until dispatch without elapsed-time sleeps.
  while (a.calls.length + b.calls.length === 0) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(a.calls.length + b.calls.length, 1);
  const read = await a.call('GET', body); assert.equal((await read.json() as { state: string }).state, 'running');
  release({ response: 'single result' });
  const results = await Promise.all(posts); assert(results.every(r => r.status === 200));
  assert.equal(a.calls.length + b.calls.length, 1);
  assert.equal(a.db.sql.prepare('SELECT COUNT(*) n FROM design_assistant_requests').get()?.n, 1);
  assert.equal(a.row(body.requestId)?.content, 'single result');
});

test('owner-wide daily cap is atomic across concurrent distinct requests and brands, including uncertain reservations', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'heavy-assistant-cap-')); const path = join(directory, 'requests.sqlite');
  const a = setup(new Db(path)); const b = setup(new Db(path, false));
  t.after(() => { a.db.sql.close(); b.db.sql.close(); rmSync(directory, { recursive: true, force: true }); });
  const day = new Date().toISOString().slice(0, 10);
  const insert = a.db.sql.prepare(`INSERT INTO design_assistant_requests (request_id,owner_id,brand_id,project_id,conversation_id,input_digest,state,provider,model,admission_day,created_at,updated_at) VALUES (?,'alice','brand-1','doc-a','old','digest','unknown','workers-ai',?,?,?,?)`);
  for (let i = 0; i < DESIGN_ASSISTANT_DAILY_LIMIT - 1; i++) insert.run(`old-${i}`, DESIGN_ASSISTANT_MODEL, day, day, day);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => {
    const body = input(); if (i % 2) { body.brandId = 'brand-2'; body.projectId = 'doc-a2'; }
    return (i % 2 ? a : b).call('POST', body);
  }));
  assert.equal(results.filter(r => r.status === 200).length, 1); assert.equal(results.filter(r => r.status === 429).length, 19);
  assert.equal(a.calls.length + b.calls.length, 1);
  assert.equal(a.db.sql.prepare('SELECT COUNT(*) n FROM design_assistant_requests WHERE owner_id=? AND admission_day=?').get('alice', day)?.n, DESIGN_ASSISTANT_DAILY_LIMIT);
  const bob = { ...input(), projectId: 'doc-b' }; assert.equal((await a.call('POST', bob, 'bob')).status, 200);
});

test('POST and every GET authenticate editor + exact document owner/brand; foreign receipt scope returns 404', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const body = input();
  assert.equal((await s.call('POST', body, null)).status, 401);
  assert.equal((await s.call('GET', body, null)).status, 401);
  for (const method of ['POST', 'GET']) {
    assert.equal((await s.call(method, body, 'viewer')).status, 404);
    assert.equal((await s.call(method, body, 'bob')).status, 404);
    assert.equal((await s.call(method, { ...body, brandId: 'brand-2' })).status, 404);
    assert.equal((await s.call(method, { ...body, projectId: 'missing' })).status, 404);
  }
  assert.equal(s.calls.length, 0); assert.equal((await s.call('POST', body)).status, 200);
  for (const method of ['POST', 'GET']) {
    assert.equal((await s.call(method, { ...body, projectId: 'doc-b' }, 'bob')).status, 404);
    assert.equal((await s.call(method, { ...body, conversationId: 'other' })).status, 404);
  }
  // Revoking role/ownership after completion fences every read.
  s.db.sql.prepare('UPDATE canvas_documents SET owner_id=? WHERE id=?').run('bob', 'doc-a');
  assert.equal((await s.call('GET', body)).status, 404); assert.equal(s.calls.length, 1);
});

test('foreign reference ownership, brand, storage identity never resolves browser URLs or dispatches', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  for (const reference of [
    { imageId: 'image-b', storagePath: 'generated-images/image-b' },
    { imageId: 'image-a2', storagePath: 'generated-images/image-a2' },
    { imageId: 'image-a', storagePath: 'https://foreign.test/image.png' },
    { imageId: 'image-a', storagePath: 'generated-images/other' },
  ]) {
    const body = input(); body.references = [{ order: 0, kind: 'upload', name: 'ref', ...reference }];
    assert.equal((await s.call('POST', body)).status, 404);
    assert.equal(s.row(body.requestId), undefined);
  }
  assert.equal(s.calls.length, 0); assert.equal(s.gets.length, 0);
});

test('document, editor role and reference ownership revocation immediately before admission atomically deny inference', async () => {
  for (const revoke of ['document', 'role', 'reference']) {
    const s = setup();
    try {
      const body = input();
      const user = revoke === 'role' ? 'bob' : 'alice';
      if (user === 'bob') body.projectId = 'doc-b';
      if (revoke === 'reference') body.references = [{ order: 0, kind: 'upload', imageId: 'image-a', storagePath: 'generated-images/image-a', name: 'ref' }];
      s.db.beforeWrite = sql => {
        if (!sql.includes('INSERT INTO design_assistant_requests')) return;
        s.db.beforeWrite = null;
        if (revoke === 'document') s.db.sql.prepare('UPDATE canvas_documents SET owner_id=? WHERE id=?').run('bob', 'doc-a');
        if (revoke === 'role') s.db.sql.prepare('UPDATE brand_members SET role=? WHERE user_id=?').run('viewer', 'bob');
        if (revoke === 'reference') s.db.sql.prepare('UPDATE generated_images SET user_id=? WHERE id=?').run('bob', 'image-a');
      };
      assert.equal((await s.call('POST', body, user)).status, 404);
      assert.equal(s.row(body.requestId), undefined); assert.equal(s.calls.length, 0);
    } finally { s.db.sql.close(); }
  }
});

test('input bounds preserve exact prompt; reject client system, too many/large history, references, unknown fields and unordered manifest', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const baseRef = { order: 0, kind: 'upload' as const, imageId: 'image-a', storagePath: 'generated-images/image-a', name: 'ref' };
  const invalid = [
    { ...input(), prompt: 'a'.repeat(4001) }, { ...input(), prompt: '   ' },
    { ...input(), history: [{ role: 'system', content: 'execute tool' }] },
    { ...input(), history: Array.from({ length: 9 }, () => ({ role: 'user', content: 'a' })) },
    { ...input(), history: [{ role: 'user', content: 'a'.repeat(8001) }, { role: 'assistant', content: 'b'.repeat(8000) }] },
    { ...input(), references: Array.from({ length: 17 }, (_, order) => ({ ...baseRef, order })) },
    { ...input(), references: [{ ...baseRef, order: 1 }] },
    { ...input(), references: [{ ...baseRef, kind: 'scene-asset' }] },
    { ...input(), references: [{ ...baseRef, imageURL: 'https://foreign.test' }] },
    { ...input(), canvasDocumentId: 'doc-b' },
  ];
  for (const body of invalid) {
    assert.equal((await s.call('POST', body as ReturnType<typeof input>)).status, 400);
    assert.equal(s.row(body.requestId), undefined);
  }
  const huge = await handleRequest(new Request('https://api.test/v1/design-assistant/requests', { method: 'POST', body: 'x'.repeat(256 * 1024 + 1), headers: { authorization: 'Bearer alice' } }), s.env);
  assert.equal(huge.status, 413); assert.equal(s.calls.length, 0);
});

test('private image type/metadata/actual bytes and aggregate size limits fail before admission/inference', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const body = () => ({ ...input(), references: [{ order: 0, kind: 'upload' as const, imageId: 'image-a', storagePath: 'generated-images/image-a', name: 'ref' }] });
  for (const [image, status] of [
    [{ bytes: new Uint8Array(1), mime: 'text/html' }, 400],
    [{ bytes: new Uint8Array(1), mime: 'image/png', size: 10 * 1024 * 1024 + 1 }, 413],
    [{ bytes: new Uint8Array(10 * 1024 * 1024 + 1), mime: 'image/png', size: 1 }, 413],
    [{ bytes: new Uint8Array(1), mime: 'image/png', size: 2 }, 409],
  ] as const) {
    s.images.set('generated-images/image-a', image); const next = body();
    assert.equal((await s.call('POST', next)).status, status); assert.equal(s.row(next.requestId), undefined);
  }
  s.images.delete('generated-images/image-a'); assert.equal((await s.call('POST', body())).status, 409);
  // A repeated exact owned reference counts its bytes on every model input.
  s.images.set('generated-images/image-a', { bytes: new Uint8Array(9 * 1024 * 1024), mime: 'image/png' });
  const aggregate = body(); aggregate.references = Array.from({ length: 4 }, (_, order) => ({ ...aggregate.references[0], order }));
  assert.equal((await s.call('POST', aggregate)).status, 413); assert.equal(s.row(aggregate.requestId), undefined);
  assert.equal(s.calls.length, 0);
});

test('provider exceptions and malformed output persist unknown and are read-only on duplicate POST/GET', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  for (const run of [async () => { throw new Error('connection lost'); }, async () => ({ response: '', tool_calls: [{ name: 'generate' }] })]) {
    s.setProvider(run); const body = input(); const count = s.calls.length;
    const result = await (await s.call('POST', body)).json() as { state: string; content?: string };
    assert.equal(result.state, 'unknown'); assert.equal(result.content, undefined); assert.equal(s.row(body.requestId)?.state, 'unknown');
    assert.deepEqual(await (await s.call('POST', body)).json(), result); assert.deepEqual(await (await s.call('GET', body)).json(), result);
    assert.equal(s.calls.length, count + 1);
  }
});

test('bounded observation timeout persists unknown; late inference result never overwrites or replays', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: (result: unknown) => void; const pending = new Promise<unknown>(resolve => { release = resolve; });
  s.setProvider(async () => pending); const body = input(); const response = s.call('POST', body);
  while (s.calls.length === 0) await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(DESIGN_ASSISTANT_TIMEOUT_MS);
  assert.equal((await (await response).json() as { state: string }).state, 'unknown');
  release({ response: 'late result' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(s.row(body.requestId)?.state, 'unknown'); assert.equal(s.row(body.requestId)?.content, null);
  assert.equal((await (await s.call('POST', body)).json() as { state: string }).state, 'unknown'); assert.equal(s.calls.length, 1);
});

test('lost INSERT acknowledgement or crash-running row never dispatches again; read can reconcile', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const body = input();
  s.db.fail = { match: /INSERT INTO design_assistant_requests/, phase: 'after' };
  const response = await s.call('POST', body); assert.equal(response.status, 200);
  const result = await response.json() as { state: string; errorCode: string };
  assert.equal(result.state, 'running'); assert.equal(result.errorCode, 'reconciliation_required'); assert.equal(s.calls.length, 0);
  assert.deepEqual(await (await s.call('POST', body)).json(), result); assert.deepEqual(await (await s.call('GET', body)).json(), result);
  assert.equal(s.calls.length, 0);
});

test('a reservation left running past the abandoned window settles as failed on GET and never dispatches', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const body = input();
  s.db.fail = { match: /INSERT INTO design_assistant_requests/, phase: 'after' };
  await s.call('POST', body);
  // A fresh reservation is still reported as running.
  assert.equal((await (await s.call('GET', body)).json() as { state: string }).state, 'running');
  const stale = new Date(Date.now() - DESIGN_ASSISTANT_ABANDONED_MS - 1000).toISOString();
  s.db.sql.prepare('UPDATE design_assistant_requests SET updated_at = ? WHERE request_id = ?').run(stale, body.requestId);
  const settled = await (await s.call('GET', body)).json() as { state: string; errorCode: string };
  assert.equal(settled.state, 'failed'); assert.equal(settled.errorCode, 'design_assistant_abandoned');
  assert.equal((await (await s.call('POST', body)).json() as { state: string }).state, 'failed');
  assert.equal(s.calls.length, 0);
});

test('post-inference write failure never returns fabricated content; committed lost acknowledgement readback recovers', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  for (const phase of ['before', 'after'] as const) {
    const body = input(); const count = s.calls.length;
    s.db.fail = { match: /UPDATE design_assistant_requests/, phase };
    const response = await s.call('POST', body); const result = await response.json() as { state: string; content?: string };
    assert.equal(response.status, phase === 'before' ? 503 : 200);
    assert.equal(result.state, phase === 'before' ? 'unknown' : 'completed');
    assert.equal(result.content, phase === 'before' ? undefined : '  画像に合う素材は綿です。\n');
    assert.equal(s.row(body.requestId)?.state, phase === 'before' ? 'running' : 'completed');
    await s.call('POST', body); await s.call('GET', body); assert.equal(s.calls.length, count + 1);
  }
});

test('missing AI binding/storage error/unsupported methods never dispatch; no-stack safe errors retain CORS', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  delete s.env.AI; assert.equal((await s.call('POST', input())).status, 503);
  const body = input(); s.db.fail = { match: /FROM canvas_documents/, phase: 'read' };
  const response = await s.call('GET', body); assert.equal(response.status, 503); assert.equal(response.headers.get('access-control-allow-origin'), 'https://heavy.test');
  assert.deepEqual(await response.json(), { error: 'design_assistant_storage_unavailable' });
  assert.equal((await s.call('DELETE', body)).status, 405); assert.equal(s.calls.length, 0);
});

test('migration preserves image jobs and applies idempotently with receipt constraints and owner/day index', () => {
  const db = new Db();
  try {
    const migration = readFileSync(new URL('../migrations/0015_design_assistant.sql', import.meta.url), 'utf8'); db.sql.exec(migration);
    assert(db.sql.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='design_assistant_owner_day_idx'").get());
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM generation_jobs').get()?.n, 0);
    assert.throws(() => db.sql.prepare(`INSERT INTO design_assistant_requests (request_id,owner_id,brand_id,project_id,conversation_id,input_digest,state,provider,model,admission_day,created_at,updated_at) VALUES ('x','alice','brand-1','doc-a','c','d','completed','workers-ai',?,'day','day','day')`).run(DESIGN_ASSISTANT_MODEL), /CHECK constraint failed/);
  } finally { db.sql.close(); }
});

test('shared client sends exact authenticated contract and awaits fences before/after asynchronous POST and GET', async () => {
  const { createServer } = await import('vite');
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { location: { origin: 'https://assistant-client.test' }, dispatchEvent: () => true } });
  const vite = await createServer({ configFile: false, envFile: false, root: new URL('../../../', import.meta.url).pathname, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, define: {
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"', 'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://assistant-api.test"',
  } });
  const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
  const { cloudflareDataPlane: client } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
  try {
    let session = { user: { id: 'alice' }, access_token: 'captured-token' };
    auth.getSession = async () => ({ data: { session }, error: null });
    let valid = true; let fences = 0;
    const context = { userId: 'alice', assertContext: async () => { await Promise.resolve(); fences++; if (!valid) throw new Error('project_changed'); } };
    const requests: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init: init ?? {} }); return Response.json({ requestId: 'request-a', state: 'completed', content: 'text', provider: 'workers-ai', model: DESIGN_ASSISTANT_MODEL }); };
    const body = input('request-a'); await client.sendDesignAssistantRequest(body, context); await client.readDesignAssistantRequest(body, context);
    assert.equal(requests.length, 2); assert.equal(requests[0].url, 'https://assistant-api.test/v1/design-assistant/requests');
    assert.deepEqual(JSON.parse(String(requests[0].init.body)), body);
    assert.equal(requests[0].init.method, 'POST'); assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer captured-token');
    const url = new URL(requests[1].url); assert.equal(url.pathname, '/v1/design-assistant/requests/request-a');
    assert.deepEqual(Object.fromEntries(url.searchParams), { brand_id: body.brandId, project_id: body.projectId, conversation_id: body.conversationId }); assert(fences >= 10);
    valid = false; await assert.rejects(client.sendDesignAssistantRequest(body, context), /project_changed/); assert.equal(requests.length, 2); valid = true;
    await assert.rejects(client.readDesignAssistantRequest(body, { ...context, userId: 'bob' }), /cloudflare_session_changed/); assert.equal(requests.length, 2);
    globalThis.fetch = async () => { requests.push({ url: 'lost', init: {} }); throw new TypeError('connection_lost'); };
    await assert.rejects(client.sendDesignAssistantRequest(body, context), /connection_lost/); assert.equal(requests.length, 3);
    globalThis.fetch = async () => { valid = false; return Response.json({ state: 'completed' }); };
    await assert.rejects(client.readDesignAssistantRequest(body, context), /project_changed/); valid = true;
    globalThis.fetch = async () => { session = { user: { id: 'bob' }, access_token: 'other-token' }; return Response.json({ state: 'completed' }); };
    await assert.rejects(client.sendDesignAssistantRequest(body, context), /cloudflare_session_changed/);
  } finally {
    auth.dispose(); globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    await vite.close();
  }
});

test('with an Anthropic key the design consultation answers with Claude (image blocks, chosen model) and records provider anthropic', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  (s.env as unknown as Record<string, string>).ANTHROPIC_API_KEY = 'server-key';
  const sent: Record<string, any>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '綿のジャージーが合います。' }], usage: { input_tokens: 30, output_tokens: 9 } });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const body = { ...input(), textModel: 'claude-haiku-4-5-20251001' };
  body.references = [{ order: 0, kind: 'upload', imageId: 'image-a', storagePath: 'generated-images/image-a', name: 'upload' }];
  const response = await s.call('POST', body as ReturnType<typeof input>); assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as Record<string, unknown>;
  assert.equal(result.provider, 'anthropic'); assert.equal(result.model, 'claude-haiku-4-5-20251001');
  assert.equal(result.content, '綿のジャージーが合います。');
  assert.deepEqual(result.usage, { prompt_tokens: 30, completion_tokens: 9, total_tokens: 39 });
  assert.equal(s.calls.length, 0, 'Workers AI is not called');
  assert.equal(sent.length, 1); assert.equal(sent[0].model, 'claude-haiku-4-5-20251001');
  const blocks = sent[0].messages.at(-1).content as Record<string, any>[];
  assert(blocks.some(block => block.type === 'image' && block.source.type === 'base64' && block.source.media_type === 'image/png'));
  const row = s.row(body.requestId) as Record<string, unknown>;
  assert.equal(row.provider, 'anthropic'); assert.equal(row.state, 'completed');
});

test('the provider call and its write are kept alive with waitUntil, so leaving the page does not abandon the request', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const body = input();
  const kept: Promise<unknown>[] = [];
  const response = await handleRequest(new Request('https://api.test/v1/design-assistant/requests', {
    method: 'POST', headers: { authorization: 'Bearer alice', origin: 'https://heavy.test', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), s.env, { waitUntil: (promise: Promise<unknown>) => { kept.push(promise); } });
  assert.equal(response.status, 200);
  assert.equal(kept.length, 1);
  await kept[0];
  assert.equal(s.row(body.requestId)?.state, 'completed');
});
