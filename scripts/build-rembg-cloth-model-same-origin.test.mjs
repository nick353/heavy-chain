import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSameOriginClothModel,
  stageClothModel,
} from './build-rembg-cloth-model-same-origin.mjs';

const expectedFor = (value) => ({
  bytes: Buffer.byteLength(value),
  sha256: crypto.createHash('sha256').update(value).digest('hex'),
});

test('staging atomically installs a pinned local build input without recording its path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-stage-'));
  const sourceFile = path.join(directory, 'source.onnx');
  const destinationPath = path.join(directory, 'public/models/u2net_cloth_seg.onnx');
  const proofPath = path.join(directory, 'output/stage.json');
  const model = 'pinned-test-model';
  await fs.writeFile(sourceFile, model);
  const result = await stageClothModel({
    sourceFile,
    destinationPath,
    proofPath,
    expectedModel: expectedFor(model),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'staged');
  assert.equal(await fs.readFile(destinationPath, 'utf8'), model);
  const proof = await fs.readFile(proofPath, 'utf8');
  assert.doesNotMatch(proof, new RegExp(sourceFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await fs.rm(directory, { recursive: true, force: true });
});

test('staging reuses an already pinned destination', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-stage-reuse-'));
  const destinationPath = path.join(directory, 'public/models/u2net_cloth_seg.onnx');
  const proofPath = path.join(directory, 'output/stage.json');
  const model = 'already-present';
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, model);
  const result = await stageClothModel({ destinationPath, proofPath, expectedModel: expectedFor(model) });
  assert.equal(result.status, 'reused');
  assert.equal(await fs.readFile(destinationPath, 'utf8'), model);
  await fs.rm(directory, { recursive: true, force: true });
});

test('identity mismatch leaves an existing destination intact and removes partial files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-stage-fail-'));
  const sourceFile = path.join(directory, 'bad.onnx');
  const destinationPath = path.join(directory, 'public/models/u2net_cloth_seg.onnx');
  const proofPath = path.join(directory, 'output/stage.json');
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(sourceFile, 'wrong');
  await fs.writeFile(destinationPath, 'previous');
  await assert.rejects(() => stageClothModel({
    sourceFile,
    destinationPath,
    proofPath,
    expectedModel: expectedFor('expected'),
  }), /cloth_model_(size|identity)_mismatch/);
  assert.equal(await fs.readFile(destinationPath, 'utf8'), 'previous');
  const directoryEntries = await fs.readdir(path.dirname(destinationPath));
  assert.deepEqual(directoryEntries, ['u2net_cloth_seg.onnx']);
  const proof = JSON.parse(await fs.readFile(proofPath, 'utf8'));
  assert.equal(proof.ok, false);
  assert.match(proof.exactBlocker, /cloth_model_(size|identity)_mismatch/);
  await fs.rm(directory, { recursive: true, force: true });
});

test('a build command failure still removes the staged public model and records cleanup', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-build-fail-'));
  const sourceFile = path.join(directory, 'source.onnx');
  const stagedModelPath = path.join(directory, 'public/models/u2net_cloth_seg.onnx');
  const stageProofPath = path.join(directory, 'output/stage.json');
  const buildProofPath = path.join(directory, 'output/build.json');
  const model = 'pinned-build-test-model';
  await fs.writeFile(sourceFile, model);
  await assert.rejects(() => buildSameOriginClothModel({
    cwd: directory,
    sourceFile,
    stagedModelPath,
    stageProofPath,
    buildProofPath,
    expectedModel: expectedFor(model),
    commandRunner: () => {
      throw new Error('simulated_build_failure');
    },
  }), /simulated_build_failure/);
  await assert.rejects(() => fs.access(stagedModelPath));
  const proof = JSON.parse(await fs.readFile(buildProofPath, 'utf8'));
  assert.equal(proof.ok, false);
  assert.equal(proof.exactBlocker, 'simulated_build_failure');
  assert.equal(proof.cleanup.stagedPublicModelRemoved, true);
  await fs.rm(directory, { recursive: true, force: true });
});

test('official download staging rejects an unexpected redirect host', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloth-model-stage-redirect-'));
  const destinationPath = path.join(directory, 'public/models/u2net_cloth_seg.onnx');
  const proofPath = path.join(directory, 'output/stage.json');
  await assert.rejects(() => stageClothModel({
    destinationPath,
    proofPath,
    expectedModel: expectedFor('unused'),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: 'https://evil.example/u2net_cloth_seg.onnx',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('unused'));
          controller.close();
        },
      }),
    }),
  }), /cloth_model_source_redirect_host_not_allowed/);
  await assert.rejects(() => fs.access(destinationPath));
  await fs.rm(directory, { recursive: true, force: true });
});

test('Zeabur deploy is wired to the same-origin build and the large asset is ignored', async () => {
  const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const zeabur = JSON.parse(await fs.readFile('zeabur.json', 'utf8'));
  assert.equal(packageJson.scripts['build:deploy'], 'npm run build:rembg-cloth-model-same-origin');
  assert.equal(
    packageJson.scripts['build:rembg-cloth-model-same-origin'],
    'node scripts/build-rembg-cloth-model-same-origin.mjs',
  );
  assert.equal(zeabur.build.build_command, 'npm install && npm run build:deploy');
  const ignored = spawnSync('git', [
    'check-ignore',
    '--quiet',
    '--no-index',
    'public/models/u2net_cloth_seg.onnx',
  ], { cwd: process.cwd() });
  assert.equal(ignored.status, 0);
});
