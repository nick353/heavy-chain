import test from 'node:test';
import assert from 'node:assert/strict';
import web, { parseRange } from '../src/index.mjs';
import { assetDescriptor } from '../build.mjs';

const bytes = new TextEncoder().encode('test-public-model');
const asset = assetDescriptor('assets/silueta.onnx', bytes);
function fixture() {
  const calls = [];
  return {
    calls,
    env: {
      PUBLIC_ASSETS_JSON: JSON.stringify({ '/assets/silueta.onnx': asset }),
      ASSETS: { fetch: async () => new Response('SPA') },
      PUBLIC_ASSETS: {
        head: async key => { calls.push(key); return { size: bytes.length }; },
        get: async (key, options) => {
          calls.push(key);
          const r = options?.range;
          return { size: bytes.length, body: r ? bytes.slice(r.offset, r.offset + r.length) : bytes };
        },
      },
    },
  };
}
const request = (path = '/assets/silueta.onnx', init) => new Request(`https://heavy.example${path}`, init);

test('only explicitly allowlisted app models/runtime files can be offloaded', () => {
  for (const path of ['../private.onnx', 'secrets.env', 'assets/nested/key.wasm', 'photos/user.png']) {
    assert.throws(() => assetDescriptor(path, bytes));
  }
  assert.equal(assetDescriptor('assets/runtime.wasm', bytes).contentType, 'application/wasm');
});
test('full and HEAD reads use the manifest key, not a user supplied R2 key', async () => {
  const { env, calls } = fixture();
  const response = await web.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  const head = await web.fetch(request(undefined, { method: 'HEAD' }), env);
  assert.equal(await head.text(), '');
  assert.deepEqual(calls, [asset.key, asset.key]);
});
test('single byte ranges, suffixes and invalid ranges', async () => {
  assert.deepEqual(parseRange('bytes=-4', 20), { offset: 16, length: 4 });
  assert.deepEqual(parseRange('bytes=10-', 20), { offset: 10, length: 10 });
  for (const r of ['bytes=-0', 'bytes=20-', 'bytes=4-2', 'bytes=0-1,3-4']) assert.equal(parseRange(r, 20), false);
  const { env } = fixture();
  const response = await web.fetch(request(undefined, { headers: { range: 'bytes=0-3' } }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 0-3/${bytes.length}`);
  assert.equal(await response.text(), 'test');
  assert.equal((await web.fetch(request(undefined, { headers: { range: 'bytes=999-' } }), env)).status, 416);
});
test('conditional reads avoid downloads, stale If-Range returns full content', async () => {
  const { env, calls } = fixture();
  const cached = await web.fetch(request(undefined, { headers: { 'if-none-match': `W/"${asset.sha256}"` } }), env);
  assert.equal(cached.status, 304);
  assert.equal(calls.length, 0);
  assert.equal(cached.headers.get('content-length'), null);
  const response = await web.fetch(request(undefined, { headers: { range: 'bytes=0-3', 'if-range': '"old"' } }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, bytes.length);
});
test('unknown models never read R2 and app routes use the SPA binding', async () => {
  const { env, calls } = fixture();
  assert.equal((await web.fetch(request('/assets/private.onnx'), env)).status, 404);
  assert.equal(await (await web.fetch(request('/login'), env)).text(), 'SPA');
  assert.equal(calls.length, 0);
});
test('no writes, missing and inconsistent assets fail closed', async () => {
  const { env, calls } = fixture();
  assert.equal((await web.fetch(request(undefined, { method: 'PUT', body: 'x' }), env)).status, 405);
  assert.equal(calls.length, 0);
  env.PUBLIC_ASSETS.get = async () => null;
  assert.equal((await web.fetch(request(), env)).status, 503);
  env.PUBLIC_ASSETS.get = async () => ({ size: 1, body: bytes });
  assert.equal((await web.fetch(request(), env)).status, 503);
});

test('auth routes use the service binding with exact URL/origin/cookie and never fall through to SPA', async () => {
  const { env, calls } = fixture();
  let received;
  env.AUTH_SERVICE = { async fetch(request) {
    received = request;
    return new Response('{"ok":true}', { headers: { 'set-cookie': 'session=fixture; HttpOnly; Secure; SameSite=Lax', 'cache-control': 'no-store' } });
  } };
  const input = request('/api/auth/sign-in/email', { method: 'POST', headers: { origin: 'https://heavy.example', cookie: 'session=old', 'content-type': 'application/json' }, body: '{}' });
  const result = await web.fetch(input, env);
  assert.equal(result.status, 200); assert.equal(received, input);
  assert.match(result.headers.get('set-cookie'), /HttpOnly/); assert.equal(calls.length, 0);
  delete env.AUTH_SERVICE;
  assert.equal((await web.fetch(request('/api/auth/get-session'), env)).status, 503);
});

test('recovery page does not cache or forward its token in referrers', async () => {
  const { env } = fixture();
  const response = await web.fetch(request('/reset-password?token=local-fixture'), env);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'SPA');
});
