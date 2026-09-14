import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleRequest, type Env } from '../src/index.ts';

class Statement {
  db: Db; query: string; values: SQLInputValue[] = [];
  constructor(db: Db, query: string) { this.db = db; this.query = query; }
  bind(...values: SQLInputValue[]) { this.values = values; return this; }
  async first<T>() { return (this.db.sql.prepare(this.query).get(...this.values) ?? null) as T | null; }
  async all() { return { results: this.db.sql.prepare(this.query).all(...this.values) }; }
  async run() {
    const fail = this.db.fail && this.query.includes(this.db.fail.match) ? this.db.fail : null;
    if (fail) this.db.fail = null;
    if (fail?.when === 'before') throw new Error('unavailable');
    const meta = this.db.sql.prepare(this.query).run(...this.values);
    if (fail?.when === 'after') throw new Error('response lost');
    return { meta };
  }
}
class Db {
  sql = new DatabaseSync(':memory:'); fail: { match: string; when: 'before' | 'after' } | null = null;
  constructor() {
    const folder = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) this.sql.exec(readFileSync(new URL(file, folder), 'utf8'));
    for (const id of ['alice', 'bob', 'admin', 'viewer', 'brand-admin', 'invited']) {
      this.sql.prepare('INSERT INTO user_identities VALUES (?,?,?,?)').run(id, 'test-issuer', id, new Date().toISOString());
      this.sql.prepare('INSERT INTO users (id,email,name,created_at,updated_at) VALUES (?,?,?,?,?)')
        .run(id, `${id}@example.test`, id, new Date().toISOString(), new Date().toISOString());
    }
    this.sql.exec("INSERT INTO brands (id,owner_id,name,created_at,updated_at) VALUES ('brand','alice','Brand','2026-09-05','2026-09-05')");
    for (const [user, role, joined] of [['viewer','viewer','2026-09-05'], ['brand-admin','admin','2026-09-05'], ['invited','editor',null]])
      this.sql.prepare('INSERT INTO brand_members (id,brand_id,user_id,role,joined_at) VALUES (?,\'brand\',?,?,?)').run(user, user, role, joined);
    this.sql.exec("INSERT INTO platform_admins VALUES ('admin','2026-09-05','LOCAL TEST ONLY')");
  }
  prepare(query: string) { return new Statement(this, query); }
}
interface ObjectRow { bytes: Uint8Array; size: number; customMetadata: Record<string, string> }
class Bucket {
  rows = new Map<string, ObjectRow>(); puts = 0; fail: 'before' | 'after' | null = null;
  async head(key: string) { return this.rows.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array, options: { onlyIf: { etagDoesNotMatch: string }; customMetadata: Record<string,string> }) {
    assert.equal(options.onlyIf.etagDoesNotMatch, '*');
    const fail = this.fail; this.fail = null;
    if (fail === 'before') throw new Error('unavailable');
    if (this.rows.has(key)) return null;
    this.puts++; this.rows.set(key, { bytes, size: bytes.length, customMetadata: options.customMetadata });
    if (fail === 'after') throw new Error('lost put response');
    return this.rows.get(key);
  }
  async get(key: string) { const row = this.rows.get(key); return row ? { ...row, body: row.bytes } : null; }
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/f0AAAAASUVORK5CYII=';
function body(): Record<string, unknown> {
  return { request_id: crypto.randomUUID(), brand_id: 'brand', type: 'other', message: '日本語\n問い合わせ',
    page_url: 'https://heavy.test/canvas?token=must-not-store#secret', pathname: '/fake',
    viewport: { width: 1200, height: 800, devicePixelRatio: 2 }, user_agent: 'local test',
    screenshot_data_url: `data:image/png;base64,${png}`, screenshot_capture_status: 'captured' };
}
function setup() {
  const db = new Db(); const bucket = new Bucket();
  const env = { DB: db, PRIVATE_MEDIA: bucket, FRONTEND_ORIGINS: 'https://heavy.test',
    MEDIA_TOKEN_VERIFIER: (r: Request) => ({ issuer: 'test-issuer', subject: r.headers.get('authorization')!.slice(7) }),
  } as unknown as Env;
  const call = (path: string, user = 'alice', method = 'GET', value?: unknown) => handleRequest(new Request(`https://api.test${path}`, {
    method, headers: { ...(user ? { authorization: `Bearer ${user}` } : {}), origin: 'https://heavy.test', 'content-type': 'application/json',
      'x-user-id': 'admin', 'x-role': 'admin' }, body: value === undefined ? undefined : JSON.stringify(value),
  }), env);
  const submit = (value = body(), user = 'alice') => call('/v1/feedback', user, 'POST', value);
  return { db, bucket, env, call, submit };
}
type Receipt = { feedback: { id: string } };

test('feedback: actual SQL/private PNG, verified author, stripped URL credentials and same receipt', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const input = { ...body(), user_id: 'admin', email: 'spoof@example.test', status: 'done', screenshot_path: 'stolen.png' };
  const response = await s.submit(input); assert.equal(response.status, 200, await response.clone().text());
  const original = await response.json() as Receipt; const { feedback } = original;
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://heavy.test');
  const row = s.db.sql.prepare('SELECT * FROM feedback_submissions').get()!;
  assert.equal(row.user_id, 'alice'); assert.equal(row.email, 'alice@example.test'); assert.equal(row.status, 'new');
  assert.equal(row.page_url, 'https://heavy.test/canvas'); assert.equal(row.pathname, '/canvas');
  assert.equal(row.screenshot_path, `feedback/v1/${feedback.id}.png`); assert.equal(row.submission_state, 'accepted');
  assert.deepEqual(Buffer.from(s.bucket.rows.get(String(row.screenshot_path))!.bytes), Buffer.from(png, 'base64'));
  assert.deepEqual(await (await s.submit(input)).json(), original);
});

test('feedback: repeated/concurrent same ID produces one row/object; changed input conflicts', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const input = body();
  const responses = await Promise.all([s.submit(input), s.submit(input), s.submit(input)]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const receipts = await Promise.all(responses.map(r => r.json()));
  assert.deepEqual(receipts[0], receipts[1]); assert.deepEqual(receipts[0], receipts[2]);
  assert.equal(s.bucket.puts, 1); assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM feedback_submissions').get()!.n, 1);
  assert.equal((await s.submit({ ...input, message: 'different' })).status, 409); assert.equal(s.bucket.puts, 1);
});

test('feedback: auth and brand membership precede any write; brand admin is not platform admin', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  for (const [user, expected] of [['',401], ['unknown',403], ['bob',403], ['invited',403]] as const)
    assert.equal((await s.submit(body(), user)).status, expected);
  assert.equal(s.bucket.puts, 0); assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM feedback_submissions').get()!.n, 0);
  assert.equal((await s.submit(body(), 'viewer')).status, 200);
  for (const user of ['alice', 'viewer', 'brand-admin', 'bob']) {
    assert.equal((await s.call('/v1/admin/users', user)).status, 403);
    assert.equal((await s.call('/v1/admin/stats', user)).status, 403);
  }
});

test('feedback: no-screenshot receipt remains valid and own request IDs are isolated', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const input = { ...body(), brand_id: null, screenshot_data_url: null };
  const a = await s.submit(input); const b = await s.submit(input, 'bob');
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.notDeepEqual(await a.json(), await b.json());
  assert.equal(s.bucket.puts, 0);
  assert.equal(s.db.sql.prepare('SELECT screenshot_capture_status FROM feedback_submissions LIMIT 1').get()!.screenshot_capture_status, 'screenshot_capture_failed');
});

test('feedback: bounded/invalid payloads do not reach D1 or R2', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  for (const changes of [{ message: '' }, { message: 'x'.repeat(4001) }, { type: 'bad' }, { request_id: '../path' },
    { page_url: 'https://attacker.test/' }, { page_url: 'javascript:alert(1)' },
    { screenshot_data_url: 'data:image/svg+xml;base64,PHN2Zy8+' }, { screenshot_data_url: 'data:image/png;base64,aW1hZ2U=' },
    { viewport: { width: -1 } }]) assert.equal((await s.submit({ ...body(), ...changes })).status, 400);
  const large = await s.submit({ ...body(), message: 'あ'.repeat(3 * 1024 * 1024) }); assert.equal(large.status, 413);
  assert.equal(s.bucket.puts, 0); assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM feedback_submissions').get()!.n, 0);
});

test('feedback: lost D1 insert/R2 put/accept response reconciles the same ID without object replay', async t => {
  for (const stage of ['insert','put','accept'] as const) {
    const s = setup(); t.after(() => s.db.sql.close()); const input = body();
    if (stage === 'insert') s.db.fail = { match: 'INSERT INTO feedback_submissions', when: 'after' };
    if (stage === 'put') s.bucket.fail = 'after';
    if (stage === 'accept') s.db.fail = { match: 'UPDATE feedback_submissions SET submission_state', when: 'after' };
    assert.equal((await s.submit(input)).status, stage === 'accept' ? 503 : 200);
    assert.equal((await s.submit(input)).status, 200); assert.equal(s.bucket.puts, 1);
    assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM feedback_submissions').get()!.n, 1);
  }
});

test('feedback: a pending screenshot safely resumes after R2 outage; mismatching object is never overwritten', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const input = body(); s.bucket.fail = 'before';
  assert.equal((await s.submit(input)).status, 503);
  assert.equal(s.db.sql.prepare('SELECT submission_state FROM feedback_submissions').get()!.submission_state, 'pending');
  assert.equal((await s.submit(input)).status, 200); assert.equal(s.bucket.puts, 1);
  const row = s.db.sql.prepare('SELECT * FROM feedback_submissions').get()!;
  s.db.sql.prepare("UPDATE feedback_submissions SET submission_state = 'pending' WHERE id = ?").run(row.id);
  s.bucket.rows.get(String(row.screenshot_path))!.customMetadata.sha256 = 'foreign';
  assert.equal((await s.submit(input)).status, 409); assert.equal(s.bucket.puts, 1);
});

test('feedback: rate limit counts new receipts, not safe replay', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const first = { ...body(), screenshot_data_url: null };
  assert.equal((await s.submit(first)).status, 200);
  for (let i = 0; i < 19; i++) assert.equal((await s.submit({ ...first, request_id: crypto.randomUUID() })).status, 200);
  assert.equal((await s.submit({ ...first, request_id: crypto.randomUUID() })).status, 429);
  assert.equal((await s.submit(first)).status, 200);
});

test('admin: current platform role controls profile/list/private screenshot and revocation is effective', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const receipt = await (await s.submit()).json() as Receipt;
  assert.equal((await (await s.call('/v1/profile', 'admin')).json() as { is_admin: boolean }).is_admin, true);
  assert.equal((await (await s.call('/v1/profile', 'alice')).json() as { is_admin: boolean }).is_admin, false);
  assert.equal((await s.call('/v1/profile', 'alice', 'PATCH', { is_admin: true })).status, 400);
  const items = await (await s.call('/v1/admin/feedback', 'admin')).json() as Array<Record<string,unknown>>;
  assert.equal(items.length, 1); assert.equal(items[0].payload_hash, undefined); assert.equal(items[0].request_id, undefined);
  const path = `/v1/admin/feedback/${receipt.feedback.id}/screenshot`;
  assert.equal((await s.call(path, 'alice')).status, 403);
  const image = await s.call(path, 'admin'); assert.equal(image.status, 200); assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
  s.db.sql.exec("DELETE FROM platform_admins WHERE user_id='admin'");
  assert.equal((await s.call(path, 'admin')).status, 403);
  assert.equal((await (await s.call('/v1/profile', 'admin')).json() as { is_admin: boolean }).is_admin, false);
});

test('admin: status/note updates require current revision and server timestamps; forbidden fields are rejected', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const receipt = await (await s.submit()).json() as Receipt;
  const path = `/v1/admin/feedback/${receipt.feedback.id}`;
  assert.equal((await s.call(path, 'alice', 'PATCH', { revision: 0, status: 'done' })).status, 403);
  const update = await s.call(path, 'admin', 'PATCH', { revision: 0, status: 'done', admin_note: '確認済み\n修正' });
  assert.equal(update.status, 200); const row = await update.json() as { revision: number; resolved_at: string; admin_note: string };
  assert.equal(row.revision, 1); assert(Number.isFinite(Date.parse(row.resolved_at))); assert.equal(row.admin_note, '確認済み\n修正');
  assert.equal((await s.call(path, 'admin', 'PATCH', { revision: 0, status: 'new' })).status, 409);
  assert.equal((await s.call(path, 'admin', 'PATCH', { revision: 1, status: 'new', user_id: 'admin' })).status, 400);
  assert.equal((await s.call(path, 'admin', 'PATCH', { revision: 1, status: 'new' })).status, 200);
  assert.equal(s.db.sql.prepare('SELECT resolved_at FROM feedback_submissions').get()!.resolved_at, null);
});

test('admin: announcements publish once/read authenticated, no role grants; stats distinguish missing metering', async t => {
  const s = setup(); t.after(() => s.db.sql.close()); const input = { request_id: crypto.randomUUID(), title: 'Title', content: 'お知らせ\n本文', type: 'info' };
  assert.equal((await s.call('/v1/admin/announcements', 'alice', 'POST', input)).status, 403);
  s.db.fail = { match: 'INSERT INTO admin_announcements', when: 'after' };
  const first = await s.call('/v1/admin/announcements', 'admin', 'POST', input); assert.equal(first.status, 200);
  const again = await s.call('/v1/admin/announcements', 'admin', 'POST', input); assert.deepEqual(await first.json(), await again.json());
  assert.equal((await s.call('/v1/admin/announcements', 'admin', 'POST', { ...input, title: 'changed' })).status, 409);
  assert.equal((await s.call('/v1/announcements', '')).status, 401);
  assert.equal((await (await s.call('/v1/announcements', 'bob')).json() as unknown[]).length, 1);
  assert.equal((await s.call('/v1/admin/users?limit=101', 'admin')).status, 400);
  assert.equal((await s.call('/v1/admin/users?offset=-1', 'admin')).status, 400);
  const stats = await (await s.call('/v1/admin/stats', 'admin')).json() as Record<string,unknown>;
  assert.equal(stats.totalUsers, 6); assert.equal(stats.totalImages, 0); assert.equal(stats.totalCost, null); assert.equal(stats.meteringStatus, 'image_ai_only');
  assert.equal(stats.inferenceAttempts,0); assert.equal(stats.estimatedImageCostUSD,null); assert.equal(stats.edgeRunCount,null);
  assert.equal((await s.call('/v1/admin/users/alice', 'admin', 'PATCH', { is_admin: true })).status, 404);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM platform_admins').get()!.n, 1);
});
