import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';
import { handleRequest } from '../cloudflare/heavy-api/src/index.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { location: { origin: 'https://canvas-web.test' } };

const vite = await createServer({
  configFile: false,
  envFile: false,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
  define: {
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
    'import.meta.env.VITE_CLOUDFLARE_AUTH_ENABLED': '"true"',
    'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://canvas-api.test"',
  },
});

const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
const { cloudflareDataPlane: client } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
const persistence = await vite.ssrLoadModule('/src/lib/canvasDocumentPersistence.ts');
const recovery = await vite.ssrLoadModule('/src/lib/canvasDocumentSaveRecovery.ts');

class SqliteD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    const migrationFolder = new URL('../cloudflare/heavy-api/migrations/', import.meta.url);
    for (const file of readdirSync(migrationFolder).filter((name) => name.endsWith('.sql')).sort()) {
      this.sql.exec(readFileSync(new URL(file, migrationFolder), 'utf8'));
    }
    for (const user of ['alice']) {
      this.sql.prepare('INSERT INTO user_identities VALUES (?,?,?,?)')
        .run(user, 'canvas-issuer', user, '2026-09-10');
      this.sql.prepare('INSERT INTO users (id,email,created_at,updated_at) VALUES (?,?,?,?)')
        .run(user, `${user}@example.test`, '2026-09-10', '2026-09-10');
    }
    this.sql.prepare('INSERT INTO brands (id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('brand-1', 'alice', 'Synthetic brand', '2026-09-10', '2026-09-10');
    this.writes = [];
  }

  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        return db.sql.prepare(sql).get(...this.values) ?? null;
      },
      async all() {
        return { results: db.sql.prepare(sql).all(...this.values) };
      },
      async run() {
        db.writes.push(sql.replace(/\s+/g, ' ').trim());
        return { meta: db.sql.prepare(sql).run(...this.values) };
      },
    };
  }

  canvasWriteCount() {
    return this.writes.filter((sql) => /(?:INSERT INTO|UPDATE) canvas_documents/i.test(sql)).length;
  }

  row(id) {
    return this.sql.prepare('SELECT id, owner_id, brand_id, title, snapshot, revision FROM canvas_documents WHERE id=?')
      .get(id);
  }

  close() {
    this.sql.close();
  }
}

const makeEnvironment = (db) => ({
  DB: db,
  FRONTEND_ORIGINS: 'https://canvas-web.test',
  MEDIA_TOKEN_VERIFIER: (request) => (
    request.headers.get('authorization') === 'Bearer canvas-test-token'
      ? { issuer: 'canvas-issuer', subject: 'alice' }
      : null
  ),
});

let session;
let refreshes;
const setupClient = () => {
  session = { user: { id: 'alice' }, access_token: 'canvas-test-token' };
  refreshes = 0;
  auth.getSession = async () => ({ data: { session }, error: null });
  auth.refreshSession = async () => {
    refreshes += 1;
    throw new Error('unexpected_refresh');
  };
  const values = new Map();
  window.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

const installLocalTransport = (env, trace, lostMethods = new Set()) => {
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    trace.push({ method, path: new URL(url).pathname });
    const headers = new Headers(init.headers);
    headers.set('origin', 'https://canvas-web.test');
    const requestInit = { ...init, headers };
    const response = await handleRequest(new Request(url, requestInit), env);
    if (lostMethods.has(method) && response.ok) {
      lostMethods.delete(method);
      throw new TypeError(`simulated_${method.toLowerCase()}_response_lost_after_commit`);
    }
    return response;
  };
};

const context = { userId: 'alice', assertContext: () => {} };
const remoteSnapshot = {
  version: 1,
  objects: [{ id: 'remote-image', type: 'image', src: 'https://cdn.example.test/synthetic.png', label: 'Remote synthetic image' }],
};
const invalidSnapshots = [
  { name: 'data', snapshot: { version: 1, objects: [{ id: 'data-image', type: 'image', src: 'data:image/png;base64,synthetic' }] } },
  { name: 'blob', snapshot: { version: 1, objects: [{ id: 'blob-image', type: 'image', src: 'blob:https://canvas-web.test/synthetic' }] } },
  { name: 'local-canvas-asset', snapshot: { version: 1, objects: [{ id: 'local-image', type: 'image', src: 'local-canvas-asset://synthetic-asset' }] } },
];

test('local integration: client persistence reaches real Cloudflare handleRequest and preserves Canvas identity/revisions', async (t) => {
  setupClient();
  const db = new SqliteD1();
  t.after(() => db.close());
  const trace = [];
  installLocalTransport(makeEnvironment(db), trace);
  const documentId = crypto.randomUUID();
  const initial = { title: 'Synthetic board', snapshot: remoteSnapshot };
  const created = await persistence.createCanvasDocument({ documentId, brandId: 'brand-1', ...initial }, context);
  assert.deepEqual(
    { id: created.id, ownerId: created.ownerId, brandId: created.brandId, title: created.title, snapshot: created.snapshot, revision: created.revision },
    { id: documentId, ownerId: 'alice', brandId: 'brand-1', ...initial, revision: 0 },
  );
  const loaded = await persistence.getCanvasDocument(documentId, 'brand-1', context);
  assert.deepEqual(loaded, created);

  const updatedContent = {
    title: 'Synthetic board revised',
    snapshot: { ...remoteSnapshot, name: 'revised remote snapshot' },
  };
  const updated = await persistence.updateCanvasDocument({
    documentId,
    brandId: 'brand-1',
    expectedRevision: loaded.revision,
    ...updatedContent,
  }, context);
  assert.deepEqual(
    { id: updated.id, ownerId: updated.ownerId, brandId: updated.brandId, title: updated.title, snapshot: updated.snapshot, revision: updated.revision },
    { id: documentId, ownerId: 'alice', brandId: 'brand-1', ...updatedContent, revision: 1 },
  );
  const reloaded = await persistence.getCanvasDocument(documentId, 'brand-1', context);
  assert.deepEqual(reloaded, updated);
  assert.deepEqual(trace.map(({ method }) => method), ['POST', 'GET', 'PATCH', 'GET']);
  assert.equal(db.canvasWriteCount(), 2);
  assert.equal(refreshes, 0);
});

test('local integration: data/blob/local-canvas-asset snapshots fail before D1 and preserve existing document', async (t) => {
  setupClient();
  const db = new SqliteD1();
  t.after(() => db.close());
  const trace = [];
  installLocalTransport(makeEnvironment(db), trace);
  const documentId = crypto.randomUUID();
  const created = await persistence.createCanvasDocument({
    documentId,
    brandId: 'brand-1',
    title: 'Preserved board',
    snapshot: remoteSnapshot,
  }, context);
  const before = await persistence.getCanvasDocument(documentId, 'brand-1', context);
  const writesBeforeInvalid = db.canvasWriteCount();
  const traceBeforeInvalid = trace.length;
  const writeRequestsBeforeInvalid = trace.filter(({ method }) => method === 'POST' || method === 'PATCH').length;

  for (const { name, snapshot } of invalidSnapshots) {
    const result = await persistence.createCanvasDocument({
      documentId: crypto.randomUUID(),
      brandId: 'brand-1',
      title: `Invalid ${name}`,
      snapshot,
    }, context).catch((error) => error);
    assert.equal(result.code, 'canvas_image_source_invalid');
    assert.equal(result.id, undefined);
    assert.equal(db.canvasWriteCount(), writesBeforeInvalid);
    assert.equal(trace.length, traceBeforeInvalid);
    assert.equal(trace.filter(({ method }) => method === 'POST' || method === 'PATCH').length, writeRequestsBeforeInvalid);
  }

  for (const { name, snapshot } of invalidSnapshots) {
    const result = await persistence.updateCanvasDocument({
      documentId,
      brandId: 'brand-1',
      expectedRevision: before.revision,
      title: `Invalid ${name}`,
      snapshot,
    }, context).catch((error) => error);
    assert.equal(result.code, 'canvas_image_source_invalid');
    assert.equal(result.id, undefined);
    assert.equal(db.canvasWriteCount(), writesBeforeInvalid);
    assert.equal(trace.filter(({ method }) => method === 'POST' || method === 'PATCH').length, writeRequestsBeforeInvalid);
    const preserved = await persistence.getCanvasDocument(documentId, 'brand-1', context);
    assert.deepEqual(
      { id: preserved.id, ownerId: preserved.ownerId, brandId: preserved.brandId, title: preserved.title, snapshot: preserved.snapshot, revision: preserved.revision },
      { id: created.id, ownerId: created.ownerId, brandId: created.brandId, title: created.title, snapshot: created.snapshot, revision: created.revision },
    );
  }
  assert.equal(refreshes, 0);
});

test('local integration: lost committed PATCH is recovered by GET without replaying a write', async (t) => {
  setupClient();
  const db = new SqliteD1();
  t.after(() => db.close());
  const trace = [];
  const lostMethods = new Set();
  installLocalTransport(makeEnvironment(db), trace, lostMethods);
  const documentId = crypto.randomUUID();
  const created = await persistence.createCanvasDocument({
    documentId,
    brandId: 'brand-1',
    title: 'Recoverable board',
    snapshot: remoteSnapshot,
  }, context);
  const scope = { origin: client.origin, userId: 'alice', brandId: 'brand-1' };
  const recoveredContent = {
    title: 'Recoverable board after lost response',
    snapshot: { ...remoteSnapshot, name: 'recovered remote snapshot' },
  };
  trace.length = 0;
  const writesBeforePatch = db.canvasWriteCount();
  lostMethods.add('PATCH');
  const recovered = await recovery.saveCanvasDocumentRecoverably({
    scope,
    documentId,
    ownerId: 'alice',
    expectedRevision: created.revision,
    content: recoveredContent,
    assertCurrent: () => {},
    transport: {
      get: (id) => persistence.getCanvasDocument(id, 'brand-1', context),
      create: (id, content) => persistence.createCanvasDocument({ documentId: id, brandId: 'brand-1', ...content }, context),
      update: (id, revision, content) => persistence.updateCanvasDocument({ documentId: id, brandId: 'brand-1', expectedRevision: revision, ...content }, context),
    },
  });
  assert.deepEqual(
    { id: recovered.id, ownerId: recovered.ownerId, brandId: recovered.brandId, title: recovered.title, snapshot: recovered.snapshot, revision: recovered.revision },
    { id: documentId, ownerId: 'alice', brandId: 'brand-1', ...recoveredContent, revision: 1 },
  );
  assert.deepEqual(trace.map(({ method }) => method), ['GET', 'PATCH', 'GET']);
  assert.equal(trace.filter(({ method }) => method === 'POST' || method === 'PATCH').length, 1);
  assert.equal(db.canvasWriteCount() - writesBeforePatch, 1);
  assert.equal(db.row(documentId)?.revision, 1);
  const savedState = recovery.readCanvasSaveRecovery(scope, documentId);
  assert.equal(savedState.pending, null);
  assert.equal(savedState.revision, 1);
  assert.equal(refreshes, 0);
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  auth.dispose();
  globalThis.window = originalWindow;
  await vite.close();
});
