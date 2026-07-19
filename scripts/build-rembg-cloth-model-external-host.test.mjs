import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getModelHash,
  setModelHash,
  verifyModelIntegrity,
} from '@bunnio/rembg-web';
import {
  buildPinnedExternalClothModel,
  verifyPinnedExternalClothModelHead,
} from './build-rembg-cloth-model-external-host.mjs';
import {
  PINNED_EXTERNAL_CLOTH_MODEL_SHA256,
  PINNED_EXTERNAL_CLOTH_MODEL_URL,
} from './rembg-cloth-model-build-contract.mjs';

const redirectUrl = 'https://us.aws.cdn.hf.co/xet-bridge-us/model?signed=true';
const goodFetch = async (url, options) => {
  assert.equal(options.method, 'HEAD');
  if (url.hostname === 'huggingface.co') {
    return new Response(null, {
      status: 302,
      headers: {
        location: redirectUrl,
        'x-linked-size': '176194565',
        'x-linked-etag': `"${PINNED_EXTERNAL_CLOTH_MODEL_SHA256}"`,
      },
    });
  }
  return new Response(null, {
    status: 200,
    headers: { 'access-control-allow-origin': '*', 'content-length': '176194565' },
  });
};

test('runtime library validates the extensionless cloth model key with the official hash', async () => {
  setModelHash('u2net_cloth_seg', PINNED_EXTERNAL_CLOTH_MODEL_SHA256);
  assert.equal(getModelHash('u2net_cloth_seg'), PINNED_EXTERNAL_CLOTH_MODEL_SHA256);
  assert.equal(await verifyModelIntegrity('u2net_cloth_seg', new Uint8Array([1, 2, 3]).buffer), false);
});

test('HEAD verification accepts only the pinned Hugging Face revision and identity', async () => {
  const result = await verifyPinnedExternalClothModelHead({ fetchImpl: goodFetch });
  assert.equal(result.url, PINNED_EXTERNAL_CLOTH_MODEL_URL);
  assert.equal(result.finalHost, 'us.aws.cdn.hf.co');
  assert.equal(result.bytes, 176194565);
  assert.equal(result.sha256, PINNED_EXTERNAL_CLOTH_MODEL_SHA256);
  assert.equal(result.cors, '*');
});

test('HEAD verification rejects redirect escape, missing CORS, and wrong identity', async () => {
  await assert.rejects(() => verifyPinnedExternalClothModelHead({
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/model.onnx' } }),
  }), /redirect_host_not_allowed/);
  await assert.rejects(() => verifyPinnedExternalClothModelHead({
    fetchImpl: async (url) => url.hostname === 'huggingface.co'
      ? new Response(null, { status: 302, headers: {
          location: redirectUrl,
          'x-linked-size': '176194565',
          'x-linked-etag': `"${PINNED_EXTERNAL_CLOTH_MODEL_SHA256}"`,
        } })
      : new Response(null, { status: 200, headers: { 'content-length': '176194565' } }),
  }), /cors_mismatch/);
  await assert.rejects(() => verifyPinnedExternalClothModelHead({
    fetchImpl: async (url) => url.hostname === 'huggingface.co'
      ? new Response(null, { status: 302, headers: {
          location: redirectUrl,
          'x-linked-size': '176194565',
          'x-linked-etag': '"bad"',
        } })
      : new Response(null, { status: 200, headers: { 'access-control-allow-origin': '*', 'content-length': '176194565' } }),
  }), /sha256_header_mismatch/);
});

test('external build verifies, builds, and verifies the embedded URL in order', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-external-build-'));
  const proofPath = path.join(directory, 'proof.json');
  const commands = [];
  const result = await buildPinnedExternalClothModel({
    cwd: directory,
    proofPath,
    fetchImpl: goodFetch,
    commandRunner: (command, args, { env }) => commands.push({ command, args, url: env.VITE_REMBG_CLOTH_SEG_MODEL_URL }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(commands.map(({ args }) => args), [
    ['scripts/verify-rembg-model-deploy-readiness.mjs', '--require-cloth'],
    ['run', 'build'],
    ['scripts/verify-rembg-model-deploy-readiness.mjs', '--require-cloth', '--verify-dist'],
  ]);
  assert.ok(commands.every(({ url }) => url === PINNED_EXTERNAL_CLOTH_MODEL_URL));
  assert.equal(JSON.parse(await fs.readFile(proofPath, 'utf8')).ok, true);
  await fs.rm(directory, { recursive: true, force: true });
});

test('external build rejects a stale same-origin model before running commands', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-external-stale-before-'));
  const stalePath = path.join(directory, 'public/models/u2net_cloth_seg.onnx');
  await fs.mkdir(path.dirname(stalePath), { recursive: true });
  await fs.writeFile(stalePath, 'stale');
  let commandCount = 0;
  await assert.rejects(() => buildPinnedExternalClothModel({
    cwd: directory,
    proofPath: path.join(directory, 'proof.json'),
    fetchImpl: goodFetch,
    commandRunner: () => { commandCount += 1; },
  }), /stale_same_origin_asset:before_build:5/);
  assert.equal(commandCount, 0);
  const proof = JSON.parse(await fs.readFile(path.join(directory, 'proof.json'), 'utf8'));
  assert.equal(proof.ok, false);
  assert.match(proof.exactBlocker, /stale_same_origin_asset:before_build/);
  await fs.rm(directory, { recursive: true, force: true });
});

test('external build rejects a same-origin model introduced during the build', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-external-stale-after-'));
  const stalePath = path.join(directory, 'public/models/u2net_cloth_seg.onnx');
  let commandCount = 0;
  await assert.rejects(() => buildPinnedExternalClothModel({
    cwd: directory,
    proofPath: path.join(directory, 'proof.json'),
    fetchImpl: goodFetch,
    commandRunner: () => {
      commandCount += 1;
      if (commandCount === 2) {
        fsSync.mkdirSync(path.dirname(stalePath), { recursive: true });
        fsSync.writeFileSync(stalePath, 'stale-after');
      }
    },
  }), /stale_same_origin_asset:after_build:11/);
  assert.equal(commandCount, 2);
  const proof = JSON.parse(await fs.readFile(path.join(directory, 'proof.json'), 'utf8'));
  assert.equal(proof.ok, false);
  assert.match(proof.exactBlocker, /stale_same_origin_asset:after_build/);
  await fs.rm(directory, { recursive: true, force: true });
});
