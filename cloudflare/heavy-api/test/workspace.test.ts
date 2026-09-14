import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleRequest, type Env } from '../src/index.ts';

class Statement {
  db: DatabaseSync;
  sql: string;
  values: SQLInputValue[] = [];
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: SQLInputValue[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) ?? null) as T | null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { return { meta: this.db.prepare(this.sql).run(...this.values) }; }
}
class Db {
  sql = new DatabaseSync(':memory:');
  failBatch: 'before' | 'after' | 'persistent-before' | null = null;
  constructor() {
    const folder = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) this.sql.exec(readFileSync(new URL(file, folder), 'utf8'));
    for (const user of ['alice', 'bob', 'viewer']) {
      this.sql.prepare('INSERT INTO user_identities VALUES (?, ?, ?, ?)').run(user, 'test-issuer', user, '2026-09-05');
      this.sql.prepare('INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)').run(user, `${user}@example.test`, '2026-09-05', '2026-09-05');
    }
    for (const brand of ['brand-1', 'brand-2']) this.sql.prepare('INSERT INTO brands (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(brand, 'alice', brand, '2026-09-05', '2026-09-05');
    this.sql.exec("INSERT INTO brand_members (id, brand_id, user_id, role, joined_at) VALUES ('viewer-member', 'brand-1', 'viewer', 'viewer', '2026-09-05')");
  }
  prepare(sql: string) { return new Statement(this.sql, sql); }
  async batch(statements: Statement[]) {
    const fail = this.failBatch;
    if (fail !== 'persistent-before') this.failBatch = null;
    if (fail === 'before' || fail === 'persistent-before') throw new Error('D1 unavailable');
    this.sql.exec('BEGIN');
    let result;
    try { result = await Promise.all(statements.map(s => s.run())); this.sql.exec('COMMIT'); }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
    if (fail === 'after') throw new Error('Commit response lost');
    return result;
  }
}
type Stored = { bytes: Uint8Array; customMetadata: Record<string, string>; httpMetadata: { contentType: string } };
class Bucket {
  objects = new Map<string, Stored>();
  puts = 0;
  failPut = false;
  async put(key: string, bytes: Uint8Array, options: Omit<Stored, 'bytes'>) {
    if (this.failPut) { this.failPut = false; throw new Error('R2 unavailable'); }
    this.puts++;
    this.objects.set(key, { bytes: bytes.slice(), ...options });
  }
  async head(key: string) { return this.objects.get(key) ?? null; }
  async get(key: string) {
    const row = this.objects.get(key);
    return row ? { ...row, body: row.bytes, writeHttpMetadata(headers: Headers) { headers.set('content-type', row.httpMetadata.contentType); } } : null;
  }
}
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/f0AAAAASUVORK5CYII=';
const body = () => ({ requestId: crypto.randomUUID(), brandId: 'brand-1', featureType: 'ai-fitting', title: 'Saved fitting',
  imageUrl: `data:image/png;base64,${png}`, prompt: 'cotton\nshirt', metadata: { source: 'canvas' } });
function setup() {
  const db = new Db(); const bucket = new Bucket();
  const env = { DB: db, PRIVATE_MEDIA: bucket, FRONTEND_ORIGINS: 'https://heavy.test',
    MEDIA_TOKEN_VERIFIER: (request: Request) => ({ issuer: 'test-issuer', subject: request.headers.get('authorization')!.slice(7) }),
  } as unknown as Env;
  const save = (input: unknown, user = 'alice') => handleRequest(new Request('https://api.test/v1/workspace-artifacts', {
    method: 'POST', headers: { authorization: `Bearer ${user}`, origin: 'https://heavy.test', 'content-type': 'application/json' }, body: JSON.stringify(input),
  }), env);
  return { db, bucket, env, save };
}

test('workspace save persists real SQL metadata and private R2 bytes with CORS and readback', async t => {
  const { db, bucket, env, save } = setup(); t.after(() => db.sql.close());
  const input = body(); const response = await save(input);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://heavy.test');
  const { remote } = await response.json() as { remote: { imageId: string; storagePath: string } };
  assert.equal(remote.storagePath, `generated-images/wa-${input.requestId}`);
  assert.deepEqual(Buffer.from(bucket.objects.get(remote.storagePath)!.bytes), Buffer.from(png, 'base64'));
  assert.equal(db.sql.prepare('SELECT status FROM generation_jobs').get()?.status, 'completed');
  const read = await handleRequest(new Request(`https://api.test/v1/generated-images/${remote.imageId}/content`, { headers: { authorization: 'Bearer alice' } }), env);
  assert.equal(read.status, 200);
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), Buffer.from(png, 'base64'));
  const foreignRead = await handleRequest(new Request(`https://api.test/v1/generated-images/${remote.imageId}/content`, { headers: { authorization: 'Bearer bob' } }), env);
  assert.equal(foreignRead.status, 404);
});

test('repeated save ID is deduplicated and changed input cannot overwrite it', async t => {
  const { db, bucket, save } = setup(); t.after(() => db.sql.close());
  const input = body(); const first = await (await save(input)).json();
  assert.deepEqual(await (await save(input)).json(), first);
  assert.equal(bucket.puts, 1);
  assert.equal((await save({ ...input, title: 'Different result' })).status, 409);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM generated_images').get()?.n, 1);
});

test('canonical reuse validates both owner and brand and never fetches an external URL', async t => {
  const { db, bucket, save } = setup(); t.after(() => db.sql.close());
  const input = body(); const first = await (await save(input)).json() as { remote: { storagePath: string } };
  const reuse = { ...body(), imageUrl: 'https://external.invalid/private', sourceStoragePath: first.remote.storagePath };
  assert.deepEqual(await (await save(reuse)).json(), first);
  assert.equal(bucket.puts, 1);
  assert.equal((await save(reuse, 'bob')).status, 403);
  assert.equal((await save({ ...reuse, brandId: 'brand-2' })).status, 404);
  bucket.objects.clear();
  assert.equal((await save(reuse)).status, 404);
});

test('missing auth, viewer writes, invalid images and oversized bodies fail closed', async t => {
  const { db, env, save } = setup(); t.after(() => db.sql.close());
  const input = body();
  assert.equal((await handleRequest(new Request('https://api.test/v1/workspace-artifacts', { method: 'POST', body: '{}' }), env)).status, 401);
  assert.equal((await save(input, 'viewer')).status, 403);
  for (const imageUrl of ['https://internal.invalid/secret', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJj']) {
    assert.equal((await save({ ...input, imageUrl })).status, 400);
  }
  env.MAX_MEDIA_BYTES = '8';
  assert.equal((await save(input)).status, 400);
  assert.equal((await save({ ...input, imageUrl: 'a'.repeat(200 * 1024) })).status, 400);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get()?.n, 0);
});

test('R2 failure resumes the same claimed job without marking it complete', async t => {
  const { db, bucket, save } = setup(); t.after(() => db.sql.close());
  const input = body(); bucket.failPut = true;
  assert.equal((await save(input)).status, 502);
  assert.equal(db.sql.prepare('SELECT status FROM generation_jobs').get()?.status, 'pending');
  assert.equal((await save(input)).status, 200);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get()?.n, 1);
});

test('D1 failure retains recoverable object and retries without duplicate rows', async t => {
  const { db, bucket, save,env } = setup(); t.after(() => db.sql.close());
  const input = body(); db.failBatch = 'persistent-before';
  assert.equal((await save(input)).status, 503);
  assert.equal(bucket.objects.size, 1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM generated_images').get()?.n, 0);
  db.failBatch = null;
  const recovered = await handleRequest(new Request(`https://api.test/v1/workspace-artifacts/${input.requestId}`,{ headers:{authorization:'Bearer alice'} }),env);
  assert.equal(recovered.status,200,await recovered.clone().text());
  assert.equal(bucket.puts,1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get()?.n, 1);
});

test('lost commit receipt reconciles the exact committed artifact instead of deleting it', async t => {
  const { db, bucket, save } = setup(); t.after(() => db.sql.close());
  db.failBatch = 'after';
  assert.equal((await save(body())).status, 200);
  assert.equal(bucket.objects.size, 1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM generated_images').get()?.n, 1);
});
