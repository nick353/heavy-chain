import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../public/canvas-recovery-r1044.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1);
assert.equal(scripts[0][1].trim(), '');
const script = scripts[0][2];
const ids = ['ai-a1d3a15d-4d27-4c93-ad1c-5fe04d438df6-0', 'ai-6422c795-febf-4672-982d-e0f31a21d0bf-1'];
const fixture = () => ({ version: 3, state: { currentProjectId: null, zoom: 1, panX: 0, panY: 0,
  objects: ids.map((imageId, index) => ({ id: ['w13mb2h10wh', 'mu3keorhdms'][index], type: 'image',
    src: `generated-images/${imageId}`, x: 464, y: [68, 69.5][index], width: 440, height: 440,
    zIndex: index, scaleX: 1, scaleY: 1, metadata: { galleryStoragePath: `generated-images/${imageId}`, galleryImageId: imageId } })) } });

async function execute(raw, options = {}) {
  const effects = [];
  const reads = [];
  const attributes = {};
  const writes = [];
  let text = '';
  const forbidden = label => { effects.push(label); throw new Error('unauthorized_effect'); };
  const trap = label => new Proxy(function () { return forbidden(label); }, {
    get: (_, key) => forbidden(`${label}.${String(key)}`), set: (_, key) => forbidden(`${label}.${String(key)}=`),
    apply: () => forbidden(label), construct: () => forbidden(label), ownKeys: () => forbidden(`${label}.enumeration`),
  });
  const storage = new Proxy({}, {
    get: (_, key) => {
      if (key !== 'getItem') return forbidden(`localStorage.${String(key)}`);
      return storageKey => {
        reads.push(storageKey);
        if (storageKey !== 'heavy-chain-canvas' || reads.length !== 1) return forbidden('storage_read_boundary');
        if (options.storageFailure) throw new Error('private_storage_failure');
        return raw;
      };
    },
    set: (_, key) => forbidden(`localStorage.${String(key)}=`),
    ownKeys: () => forbidden('localStorage.enumeration'),
  });
  const element = {
    setAttribute: (key, value) => { attributes[key] = value; writes.push([key, value]); },
    set textContent(value) { text = value; },
    get textContent() { return text; },
  };
  const context = {
    localStorage: storage, TextEncoder,
    document: new Proxy({}, { get: (_, key) => {
      if (key !== 'getElementById') return forbidden(`document.${String(key)}`);
      return id => { assert.equal(id, 'r1044-result'); return element; };
    } }),
    crypto: options.noCrypto ? undefined : options.hashFailure ? { subtle: { digest: async () => { throw new Error('private_hash_failure'); } } }
      : options.shortHash ? { subtle: { digest: async () => new ArrayBuffer(0) } } : webcrypto,
  };
  for (const label of ['sessionStorage', 'fetch', 'XMLHttpRequest', 'location', 'navigator', 'indexedDB', 'caches',
    'Image', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'window', 'self', 'top', 'parent',
    'open', 'history', 'console', 'setTimeout', 'setInterval']) {
    Object.defineProperty(context, label, { get: () => forbidden(label), set: () => forbidden(`${label}=`) });
  }
  await runInNewContext(script, context, { timeout: 1000, filename: 'actual-canvas-recovery-r1044-inline.js' });
  assert.deepEqual(reads, ['heavy-chain-canvas']);
  assert.deepEqual(effects, []);
  assert.deepEqual(Object.keys(attributes).sort(), ['data-count', 'data-obj1', 'data-obj2', 'data-project-null', 'data-raw-sha256', 'data-status', 'data-version', 'data-view']);
  assert.equal(text, 'STOP');
  for (const key of ['data-count', 'data-obj1', 'data-obj2', 'data-project-null', 'data-view']) assert.match(attributes[key], /^(true|false)$/);
  assert.match(attributes['data-version'], /^(none|-?\d+)$/);
  assert.match(attributes['data-raw-sha256'], /^(none|[a-f0-9]{64})$/);
  assert.equal(writes.filter(([key, value]) => key === 'data-status' && value === 'match').length,
    attributes['data-status'] === 'match' ? 1 : 0);
  return attributes;
}

test('standalone HTML has no app mount, imports, resources, links or controls', () => {
  assert.match(html, /heavy-canvas-readonly-r1044/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<(?:a|button|form|input|img|iframe|link|video|audio|object|embed)\b/i);
  assert.doesNotMatch(html, /(?:\bsrc\s*=|http-equiv=["']refresh|type=["']module)/i);
  assert.doesNotMatch(script, /\b(?:import|require|fetch|XMLHttpRequest|sessionStorage|setItem|removeItem|clear|location|authStore|useCanvasStore)\b/);
});

test('exact original matches with one read, zero effects, and actual raw SHA-256', async () => {
  const raw = JSON.stringify(fixture());
  const result = await execute(raw);
  assert.equal(result['data-status'], 'match');
  assert.equal(result['data-version'], '3');
  assert.equal(result['data-raw-sha256'], createHash('sha256').update(raw).digest('hex'));
  for (const key of ['data-count', 'data-obj1', 'data-obj2', 'data-project-null', 'data-view']) assert.equal(result[key], 'true');
});

test('object array order is irrelevant; missing scale defaults to one', async () => {
  const value = fixture();
  value.state.objects.reverse();
  for (const object of value.state.objects) { delete object.scaleX; delete object.scaleY; }
  assert.equal((await execute(JSON.stringify(value)))['data-status'], 'match');
});

test('sanitized absent src can qualify through a consistent canonical storage path', async () => {
  const value = fixture();
  for (const object of value.state.objects) delete object.src;
  assert.equal((await execute(JSON.stringify(value)))['data-status'], 'match');
});

for (const [name, raw, status] of [
  ['missing', null, 'missing'], ['corrupt JSON', '{private_corrupt', 'malformed'],
  ['empty string', '', 'malformed'], ['null payload', 'null', 'malformed'], ['array payload', '[]', 'malformed'],
  ['primitive payload', '"private"', 'malformed'], ['missing state', '{"version":3}', 'mismatch'],
  ['array state', '{"version":3,"state":[]}', 'mismatch'], ['non-array objects', '{"version":3,"state":{"objects":{}}}', 'mismatch'],
]) test(name, async () => assert.equal((await execute(raw))['data-status'], status));

const mutations = [
  ['version 2', f => { f.version = 2; }], ['string version', f => { f.version = '3'; }],
  ['missing version', f => { delete f.version; }], ['noninteger version', f => { f.version = 3.5; }],
  ['private version redacted', f => { f.version = '<private-version>'; }],
  ['unsafe integer version redacted', f => { f.version = Number.MAX_SAFE_INTEGER + 1; }],
  ['nonnull project', f => { f.state.currentProjectId = '<private-project>'; }],
  ['missing project', f => { delete f.state.currentProjectId; }],
  ['extra object', f => { f.state.objects.push({ id: 'private-extra', type: 'text' }); }],
  ['one object', f => { f.state.objects.pop(); }], ['zero objects', f => { f.state.objects = []; }],
  ['null object', f => { f.state.objects[0] = null; }],
  ['duplicate IDs', f => { f.state.objects[1].id = f.state.objects[0].id; }],
  ['unknown ID', f => { f.state.objects[0].id = 'private-other'; }],
  ['swapped object IDs', f => { [f.state.objects[0].id, f.state.objects[1].id] = [f.state.objects[1].id, f.state.objects[0].id]; }],
  ['wrong type', f => { f.state.objects[0].type = 'text'; }],
  ['identity conflict', f => { f.state.objects[0].metadata.imageId = ids[1]; }],
  ['canonical path conflict', f => { f.state.objects[0].metadata.storagePath = `generated-images/${ids[1]}`; }],
  ['invalid metadata', f => { f.state.objects[0].metadata = []; }],
  ['invalid parameters', f => { f.state.objects[0].metadata.parameters = 'private'; }],
  ['parameter identity conflict', f => { f.state.objects[0].metadata.parameters = { imageId: ids[1] }; }],
  ['parameter path conflict', f => { f.state.objects[0].metadata.parameters = { backendStoragePath: 'private-other' }; }],
  ['numeric identity', f => { f.state.objects[0].metadata.imageId = 123; }],
  ['bare image ID insufficient', f => { delete f.state.objects[0].src; delete f.state.objects[0].metadata.galleryStoragePath; }],
  ['display URL cannot rescue missing canonical path', f => { delete f.state.objects[0].src; delete f.state.objects[0].metadata.galleryStoragePath; f.state.objects[0].metadata.galleryImageUrl = `https://impostor.test/generated-images/${ids[0]}`; }],
];
for (const key of ['x', 'y', 'width', 'height', 'zIndex', 'scaleX', 'scaleY']) {
  for (const index of [0, 1]) mutations.push([`object${index + 1} wrong ${key}`, f => { f.state.objects[index][key] += 0.5; }]);
}
for (const key of ['zoom', 'panX', 'panY']) {
  mutations.push([`wrong ${key}`, f => { f.state[key] += 0.5; }]);
  mutations.push([`string ${key}`, f => { f.state[key] = String(f.state[key]); }]);
  mutations.push([`missing ${key}`, f => { delete f.state[key]; }]);
}
for (const source of [
  `https://impostor.test/generated-images/${ids[0]}`, `//impostor.test/generated-images/${ids[0]}`,
  `generated-images/${ids[0]}?token=private`, `generated-images/${ids[0]}#private`,
  `prefix/generated-images/${ids[0]}`, `/generated-images/${ids[0]}`, `generated-images/${ids[0]}/extra`,
  `generated-images/${ids[0]}.png`, `generated-images/${ids[0]}evil`, `generated-images%2F${ids[0]}`,
  `generated-images/../generated-images/${ids[0]}`, ` generated-images/${ids[0]}`,
  `generated-images/${ids[0]}\u0000`, 'data:image/png;base64,private', 'blob:private',
]) mutations.push([`URL/path impostor ${mutations.length}`, f => { f.state.objects[0].src = source; }]);
for (const [name, mutate] of mutations) test(name, async () => {
  const value = fixture(); mutate(value);
  assert.equal((await execute(JSON.stringify(value)))['data-status'], 'mismatch');
});

for (const option of ['storageFailure', 'hashFailure', 'noCrypto', 'shortHash']) test(`${option} fails closed without retries or raw error disclosure`, async () => {
  const result = await execute(JSON.stringify(fixture()), { [option]: true });
  assert.equal(result['data-status'], 'malformed');
  assert.equal(result['data-raw-sha256'], 'none');
  assert.doesNotMatch(JSON.stringify(result), /private|failure|unavailable/);
});

test('private titles, URLs, prompt, auth fields and raw payload never enter DOM', async () => {
  const value = fixture();
  value.privateSecret = 'private-auth-token';
  value.state.title = '<script>private-title</script>';
  value.state.objects[0].metadata.prompt = 'private-prompt';
  value.state.objects[0].metadata.galleryImageUrl = 'https://private.test/image?token=private-url-token';
  const raw = JSON.stringify(value);
  const result = await execute(raw);
  assert.equal(result['data-status'], 'match');
  const serialized = JSON.stringify(result);
  for (const secret of [raw, 'private-auth-token', 'private-title', 'private-prompt', 'private-url-token', ...ids, 'w13mb2h10wh', 'mu3keorhdms', 'generated-images/']) assert.ok(!serialized.includes(secret));
  assert.equal(result['data-raw-sha256'], createHash('sha256').update(raw).digest('hex'));
});
