import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isDiagnosticProcessCleanupNotEstablishedError,
  runHardTimedDiagnosticChild,
} from './lib/printing-offline-model-diagnostic-process.ts';
import {
  buildRealPhotoDiagnosticBannerSvg,
  classifyRealPhotoSafety,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION,
} from './lib/printing-real-photo-diagnostic.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('real-photo diagnostic contract is explicitly non-browser and never approval eligible', () => {
  assert.equal(PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION, 'printing-real-photo-offline-diagnostic-v1');
  assert.deepEqual(PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS, {
    synthetic: false,
    realPhoto: true,
    browserParity: false,
    cutoutPipelineParity: false,
    userApproval: false,
    approvalEligible: false,
  });
  assert.match(buildRealPhotoDiagnosticBannerSvg().toString('utf8'), new RegExp(PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT));
});

test('guarded risk success is an unsafe silent success, never a quality pass', () => {
  const result = classifyRealPhotoSafety({
    riskTags: ['multiple-garments', 'specular'],
    suggestionKind: 'success',
    surfaceKind: 'success',
  });
  assert.equal(result.pipelineSuccess, true);
  assert.equal(result.falseSuccess, true);
  assert.equal(result.safetyDisposition, 'unsafe-silent-success');
  assert.deepEqual(result.falseSuccessReasons, ['guarded-risk:multiple-garments', 'guarded-risk:specular']);
});

test('fallback, OOD, and clean success remain review outcomes', () => {
  assert.equal(classifyRealPhotoSafety({ riskTags: ['extreme-crop'], suggestionKind: 'fallback-required', surfaceKind: 'not-run' }).safetyDisposition, 'fallback-required');
  assert.equal(classifyRealPhotoSafety({ riskTags: ['reflective'], suggestionKind: 'success', surfaceKind: 'ood' }).safetyDisposition, 'ood-review-required');
  assert.equal(classifyRealPhotoSafety({ riskTags: ['on-model'], suggestionKind: 'success', surfaceKind: 'success' }).safetyDisposition, 'manual-review-required');
});

test('shared process failure publication keeps real-photo non-approval flags', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-real-photo-spawn-'));
  const stagingDirectory = path.join(tempRoot, 'run.staging');
  const outputDirectory = path.join(tempRoot, 'run');
  await mkdir(stagingDirectory);
  try {
    const result = await runHardTimedDiagnosticChild({
      command: path.join(tempRoot, 'missing-command'),
      args: [],
      cwd: repositoryRoot,
      allowedRoot: tempRoot,
      stagingDirectory,
      outputDirectory,
      manifestPath: path.join(tempRoot, 'manifest.json'),
      manifestDigestBefore: 'a'.repeat(64),
      workerScriptPath: path.join(repositoryRoot, 'scripts/printing-real-photo-diagnostic-worker.ts'),
      modelPath: path.join(repositoryRoot, 'public/models/silueta.onnx'),
      caseCount: 10,
      timeoutMs: 500,
      killGraceMs: 100,
      errorReadbackContext: {
        schemaVersion: PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION,
        flags: PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
        bannerText: PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT,
      },
    });
    assert.equal(result.kind, 'spawn-error');
    const readback = JSON.parse(await readFile(path.join(outputDirectory, 'readback.json'), 'utf8'));
    assert.equal(readback.schemaVersion, PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION);
    assert.deepEqual(readback.flags, PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS);
    assert.equal(readback.synthetic, false);
    assert.equal(readback.realPhoto, true);
    assert.equal(readback.browserParity, false);
    assert.equal(readback.userApproval, false);
    assert.equal(readback.approvalEligible, false);
    assert.equal(readback.finiteCaseCount, 0);
    assert.equal(readback.totalOutputBytes, (await stat(path.join(outputDirectory, 'readback.json'))).size);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('cleanup-not-established errors are explicitly classified for no-publication handling', () => {
  assert.equal(isDiagnosticProcessCleanupNotEstablishedError(new Error('CHILD_PROCESS_GROUP_STILL_ALIVE')), true);
  assert.equal(isDiagnosticProcessCleanupNotEstablishedError(new Error('CHILD_PROCESS_GROUP_STILL_ALIVE_AFTER_NORMAL_EXIT')), true);
  assert.equal(isDiagnosticProcessCleanupNotEstablishedError(new Error('CHILD_DID_NOT_EXIT_AFTER_SIGKILL')), true);
  assert.equal(isDiagnosticProcessCleanupNotEstablishedError(new Error('ordinary-validation-error')), false);
});
