import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createPinnedLookup,
  isPublicIpAddress,
  validatePublicModelUrl,
  verifyClothModelHost,
} from './verify-rembg-cloth-model-host.mjs';

const fixture = Buffer.from('pinned-cloth-model-fixture');
const fixtureSha256 = crypto.createHash('sha256').update(fixture).digest('hex');

const withFixtureServer = async ({ cors = 'https://heavy-chain.zeabur.app', body = fixture, status = 200, location = null }, callback) => {
  const server = http.createServer((request, response) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', body.byteLength);
    if (cors !== null) response.setHeader('Access-Control-Allow-Origin', cors);
    if (location !== null) response.setHeader('Location', location);
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}/u2net_cloth_seg.onnx`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test('public model URL rejects credentials, query, fragments, and non-HTTPS hosts', () => {
  assert.throws(() => validatePublicModelUrl('https://user:secret@models.example/model.onnx'), /credentials_forbidden/);
  assert.throws(() => validatePublicModelUrl('https://models.example/model.onnx?token=secret'), /query_or_fragment_forbidden/);
  assert.throws(() => validatePublicModelUrl('https://models.example/model.onnx#x'), /query_or_fragment_forbidden/);
  assert.throws(() => validatePublicModelUrl('http://models.example/model.onnx'), /https_required/);
  assert.throws(() => validatePublicModelUrl('https://models.example/model.bin'), /onnx_path_required/);
  for (const hostname of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '[::1]', '[fe80::1]']) {
    assert.throws(() => validatePublicModelUrl(`https://${hostname}/model.onnx`), /public_address_required/);
  }
  for (const address of ['::ffff:7f00:1', '::ffff:a00:1', 'fec0::1']) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});

test('pinned lookup returns only the previously validated address set', async () => {
  const lookup = createPinnedLookup([
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  const ipv4 = await new Promise((resolve, reject) => lookup('models.example', { family: 4 }, (error, address, family) => {
    if (error) reject(error);
    else resolve({ address, family });
  }));
  assert.deepEqual(ipv4, { address: '8.8.8.8', family: 4 });
  const all = await new Promise((resolve, reject) => lookup('models.example', { all: true }, (error, addresses) => {
    if (error) reject(error);
    else resolve(addresses);
  }));
  assert.deepEqual(all, [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
});

test('DNS names resolving to private addresses are rejected before fetch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-host-private-dns-'));
  const outputPath = path.join(directory, 'host-proof.json');
  let fetchCalled = false;
  await assert.rejects(() => verifyClothModelHost({
    url: 'https://models.example/model.onnx',
    outputPath,
    expectedBytes: fixture.byteLength,
    expectedSha256: fixtureSha256,
    lookupImpl: async () => [{ address: '10.1.2.3', family: 4 }],
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('should not fetch');
    },
  }), /cloth_model_host_public_address_required/);
  assert.equal(fetchCalled, false);
  await fs.rm(directory, { recursive: true, force: true });
});

test('production HTTPS path binds the verified address set to the pinned request implementation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-host-pinned-https-'));
  const outputPath = path.join(directory, 'host-proof.json');
  const resolvedAddresses = [{ address: '8.8.8.8', family: 4 }];
  let pinnedRequest = null;
  const result = await verifyClothModelHost({
    url: 'https://models.example/u2net_cloth_seg.onnx',
    outputPath,
    expectedBytes: fixture.byteLength,
    expectedSha256: fixtureSha256,
    lookupImpl: async () => resolvedAddresses,
    pinnedHttpsImpl: async (parsed, options) => {
      pinnedRequest = { url: parsed.href, resolvedAddresses: options.resolvedAddresses };
      const response = new Response(fixture, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': 'https://heavy-chain.zeabur.app',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(fixture.byteLength),
        },
      });
      return Object.assign(response, {
        connectedAddress: '8.8.8.8',
      });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(pinnedRequest, {
    url: 'https://models.example/u2net_cloth_seg.onnx',
    resolvedAddresses,
  });
  assert.equal(result.connectedAddress, '8.8.8.8');
  await fs.rm(directory, { recursive: true, force: true });
});

test('full host verification checks CORS, byte count, and SHA-256', async () => {
  await withFixtureServer({}, async (url) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-host-success-'));
    const outputPath = path.join(directory, 'host-proof.json');
    const result = await verifyClothModelHost({
      url,
      outputPath,
      expectedBytes: fixture.byteLength,
      expectedSha256: fixtureSha256,
      allowHttpLocalhost: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.response.receivedBytes, fixture.byteLength);
    assert.equal(result.response.sha256, fixtureSha256);
    assert.equal(JSON.parse(await fs.readFile(outputPath, 'utf8')).status, 'verified');
    await fs.rm(directory, { recursive: true, force: true });
  });
});

test('missing CORS replaces stale success proof with an exact blocker', async () => {
  await withFixtureServer({ cors: null }, async (url) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-host-cors-'));
    const outputPath = path.join(directory, 'host-proof.json');
    await fs.writeFile(outputPath, '{"ok":true}\n');
    await assert.rejects(() => verifyClothModelHost({
      url,
      outputPath,
      expectedBytes: fixture.byteLength,
      expectedSha256: fixtureSha256,
      allowHttpLocalhost: true,
    }), /cloth_model_host_cors_mismatch:missing/);
    const evidence = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.equal(evidence.ok, false);
    assert.equal(evidence.exactBlocker, 'cloth_model_host_cors_mismatch:missing');
    await fs.rm(directory, { recursive: true, force: true });
  });
});

test('hash mismatch is fail-closed after the complete body read', async () => {
  await withFixtureServer({}, async (url) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-host-hash-'));
    const outputPath = path.join(directory, 'host-proof.json');
    await assert.rejects(() => verifyClothModelHost({
      url,
      outputPath,
      expectedBytes: fixture.byteLength,
      expectedSha256: '0'.repeat(64),
      allowHttpLocalhost: true,
    }), /cloth_model_host_sha256_mismatch/);
    const evidence = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.match(evidence.exactBlocker, /cloth_model_host_sha256_mismatch/);
    await fs.rm(directory, { recursive: true, force: true });
  });
});

test('redirects are rejected instead of inheriting unsafe URL or CORS semantics', async () => {
  await withFixtureServer({ status: 302, location: 'http://169.254.169.254/model.onnx' }, async (url) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-host-redirect-'));
    const outputPath = path.join(directory, 'host-proof.json');
    await assert.rejects(() => verifyClothModelHost({
      url,
      outputPath,
      expectedBytes: fixture.byteLength,
      expectedSha256: fixtureSha256,
      allowHttpLocalhost: true,
    }), /cloth_model_host_redirect_forbidden:302/);
    await fs.rm(directory, { recursive: true, force: true });
  });
});

test('partial content is rejected even when bytes and hash match', async () => {
  await withFixtureServer({ status: 206 }, async (url) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-host-status-'));
    const outputPath = path.join(directory, 'host-proof.json');
    await assert.rejects(() => verifyClothModelHost({
      url,
      outputPath,
      expectedBytes: fixture.byteLength,
      expectedSha256: fixtureSha256,
      allowHttpLocalhost: true,
    }), /cloth_model_host_http_status:206/);
    await fs.rm(directory, { recursive: true, force: true });
  });
});

test('cloth-model build command binds a fresh host proof before build and dist readback', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts['build:rembg-cloth-model'],
    'npm run verify:rembg-cloth-model-host -- --output=output/rembg-cloth-model-host.json && npm run verify:rembg-cloth-model-deploy && npm run build && npm run verify:rembg-cloth-model-build',
  );
});
