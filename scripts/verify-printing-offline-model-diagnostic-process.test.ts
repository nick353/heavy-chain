import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runHardTimedDiagnosticChild } from './lib/printing-offline-model-diagnostic-process.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repositoryRoot, 'scripts/fixtures/printing-offline-model-diagnostic-ignore-sigterm.ts');

test('hard timeout sends TERM then KILL, awaits exit, removes staging, and publishes error readback only', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-timeout-'));
  const stagingDirectory = path.join(tempRoot, 'run.staging');
  const outputDirectory = path.join(tempRoot, 'run');
  const descendantOutput = path.join(stagingDirectory, 'late-contact.png');
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(path.join(stagingDirectory, 'partial-unmarked.png'), 'must-be-removed');
  try {
    const result = await runHardTimedDiagnosticChild({
      command: process.execPath,
      args: ['--experimental-strip-types', fixturePath, '--descendant-output', descendantOutput],
      cwd: repositoryRoot,
      allowedRoot: tempRoot,
      stagingDirectory,
      outputDirectory,
      manifestPath: path.join(repositoryRoot, 'benchmarks/printing-approval-v1/manifest.json'),
      manifestDigestBefore: 'a'.repeat(64),
      workerScriptPath: fixturePath,
      modelPath: path.join(repositoryRoot, 'public/models/silueta.onnx'),
      caseCount: 1,
      timeoutMs: 1_500,
      killGraceMs: 100,
    });

    assert.equal(result.kind, 'timeout');
    assert.equal(result.sigtermSent, true);
    assert.equal(result.sigkillSent, true);
    assert.equal(result.processGroupGone, true);
    assert.equal(result.exitSignal, 'SIGKILL');
    assert.equal(result.awaitedExitBeforeCleanup, true);
    assert.equal(result.stagingRemoved, true);
    assert.match(result.stdout, /fixture-ready/);
    assert.match(result.stdout, /sigterm-ignored/);
    assert.deepEqual(result.outputFiles, ['readback.json']);
    await assert.rejects(access(stagingDirectory));
    assert.deepEqual(await readdir(outputDirectory), ['readback.json']);

    const readback = JSON.parse(await readFile(path.join(outputDirectory, 'readback.json'), 'utf8'));
    assert.equal(readback.status, 'error');
    assert.equal(readback.incomplete, true);
    assert.equal(readback.exactBlocker, 'OFFLINE_MODEL_DIAGNOSTIC_CHILD_TIMEOUT');
    assert.equal(readback.synthetic, true);
    assert.equal(readback.cutoutPipelineParity, false);
    assert.equal(readback.browserParity, false);
    assert.equal(readback.realPhoto, false);
    assert.equal(readback.userApproval, false);
    assert.equal(readback.processEvidence.sigtermSent, true);
    assert.equal(readback.processEvidence.sigkillSent, true);
    assert.equal(readback.totalOutputBytes, (await stat(path.join(outputDirectory, 'readback.json'))).size);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    await assert.rejects(access(descendantOutput));
    await assert.rejects(access(stagingDirectory));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('spawn failure cleans staging and publishes an incomplete readback only', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-spawn-'));
  const stagingDirectory = path.join(tempRoot, 'run.staging');
  const outputDirectory = path.join(tempRoot, 'run');
  await mkdir(stagingDirectory);
  await writeFile(path.join(stagingDirectory, 'partial.png'), 'partial');
  try {
    const result = await runHardTimedDiagnosticChild({
      command: path.join(tempRoot, 'missing-command'),
      args: [],
      cwd: repositoryRoot,
      allowedRoot: tempRoot,
      stagingDirectory,
      outputDirectory,
      manifestPath: path.join(repositoryRoot, 'benchmarks/printing-approval-v1/manifest.json'),
      manifestDigestBefore: 'b'.repeat(64),
      workerScriptPath: fixturePath,
      modelPath: path.join(repositoryRoot, 'public/models/silueta.onnx'),
      caseCount: 1,
      timeoutMs: 500,
      killGraceMs: 100,
    });
    assert.equal(result.kind, 'spawn-error');
    assert.deepEqual(await readdir(outputDirectory), ['readback.json']);
    await assert.rejects(access(stagingDirectory));
    const readback = JSON.parse(await readFile(path.join(outputDirectory, 'readback.json'), 'utf8'));
    assert.equal(readback.exactBlocker, 'OFFLINE_MODEL_DIAGNOSTIC_CHILD_SPAWN_FAILED');
    assert.equal(readback.incomplete, true);
    assert.equal(readback.totalOutputBytes, (await stat(path.join(outputDirectory, 'readback.json'))).size);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('process-group escalation kills a TERM-ignoring descendant after its leader exits', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-descendant-'));
  const stagingDirectory = path.join(tempRoot, 'run.staging');
  const outputDirectory = path.join(tempRoot, 'run');
  const descendantOutput = path.join(stagingDirectory, 'late-contact.png');
  await mkdir(stagingDirectory);
  await writeFile(path.join(stagingDirectory, 'partial.png'), 'partial');
  try {
    const result = await runHardTimedDiagnosticChild({
      command: process.execPath,
      args: [
        '--experimental-strip-types',
        fixturePath,
        '--descendant-output',
        descendantOutput,
        '--leader-exits-on-term',
      ],
      cwd: repositoryRoot,
      allowedRoot: tempRoot,
      stagingDirectory,
      outputDirectory,
      manifestPath: path.join(repositoryRoot, 'benchmarks/printing-approval-v1/manifest.json'),
      manifestDigestBefore: 'e'.repeat(64),
      workerScriptPath: fixturePath,
      modelPath: path.join(repositoryRoot, 'public/models/silueta.onnx'),
      caseCount: 1,
      timeoutMs: 1_500,
      killGraceMs: 100,
    });
    assert.equal(result.kind, 'timeout');
    assert.equal(result.exitCode, 0);
    assert.equal(result.sigtermSent, true);
    assert.equal(result.sigkillSent, true);
    assert.equal(result.processGroupGone, true);
    assert.deepEqual(await readdir(outputDirectory), ['readback.json']);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    await assert.rejects(access(descendantOutput));
    await assert.rejects(access(stagingDirectory));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('symlinked output ancestry is rejected without deleting outside staging', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-symlink-'));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-outside-'));
  const linkedRoot = path.join(tempRoot, 'linked');
  await symlink(outsideRoot, linkedRoot);
  const outsideStaging = path.join(outsideRoot, 'run.staging');
  await mkdir(outsideStaging);
  await writeFile(path.join(outsideStaging, 'keep.txt'), 'keep');
  try {
    await assert.rejects(
      runHardTimedDiagnosticChild({
        command: process.execPath,
        args: ['--experimental-strip-types', fixturePath],
        cwd: repositoryRoot,
        allowedRoot: tempRoot,
        stagingDirectory: path.join(linkedRoot, 'run.staging'),
        outputDirectory: path.join(linkedRoot, 'run'),
        manifestPath: path.join(repositoryRoot, 'benchmarks/printing-approval-v1/manifest.json'),
        manifestDigestBefore: 'c'.repeat(64),
        workerScriptPath: fixturePath,
        modelPath: path.join(repositoryRoot, 'public/models/silueta.onnx'),
        caseCount: 1,
        timeoutMs: 500,
        killGraceMs: 100,
      }),
      /OUTPUT_PATH_SYMLINK_REJECTED/,
    );
    assert.equal(await readFile(path.join(outsideStaging, 'keep.txt'), 'utf8'), 'keep');
    await assert.rejects(access(path.join(outsideRoot, 'run')));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test('normal leader exit still terminates and reaps a surviving descendant group', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-normal-descendant-'));
  const stagingDirectory = path.join(tempRoot, 'run.staging');
  const outputDirectory = path.join(tempRoot, 'run');
  const descendantOutput = path.join(stagingDirectory, 'late-contact.png');
  await mkdir(stagingDirectory);
  try {
    const result = await runHardTimedDiagnosticChild({
      command: process.execPath,
      args: [
        '--experimental-strip-types',
        fixturePath,
        '--descendant-output',
        descendantOutput,
        '--leader-exits-normally-after-ready',
      ],
      cwd: repositoryRoot,
      allowedRoot: tempRoot,
      stagingDirectory,
      outputDirectory,
      manifestPath: path.join(repositoryRoot, 'benchmarks/printing-approval-v1/manifest.json'),
      manifestDigestBefore: 'f'.repeat(64),
      workerScriptPath: fixturePath,
      modelPath: path.join(repositoryRoot, 'public/models/silueta.onnx'),
      caseCount: 1,
      timeoutMs: 2_000,
      killGraceMs: 100,
    });
    assert.equal(result.kind, 'exit');
    assert.equal(result.exitCode, 0);
    assert.equal(result.processGroupGone, true);
    assert.equal(result.sigtermSent, true);
    assert.equal(result.sigkillSent, true);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    await assert.rejects(access(descendantOutput));
    assert.deepEqual(await readdir(stagingDirectory), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('existing output is preserved and no temporary error directory leaks', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hc-offline-existing-'));
  const stagingDirectory = path.join(tempRoot, 'run.staging');
  const outputDirectory = path.join(tempRoot, 'run');
  await mkdir(stagingDirectory);
  await mkdir(outputDirectory);
  await writeFile(path.join(outputDirectory, 'old-contact.png'), 'old');
  try {
    await assert.rejects(
      runHardTimedDiagnosticChild({
        command: process.execPath,
        args: ['--experimental-strip-types', fixturePath],
        cwd: repositoryRoot,
        allowedRoot: tempRoot,
        stagingDirectory,
        outputDirectory,
        manifestPath: path.join(repositoryRoot, 'benchmarks/printing-approval-v1/manifest.json'),
        manifestDigestBefore: 'd'.repeat(64),
        workerScriptPath: fixturePath,
        modelPath: path.join(repositoryRoot, 'public/models/silueta.onnx'),
        caseCount: 1,
        timeoutMs: 500,
        killGraceMs: 100,
      }),
      /DIAGNOSTIC_OUTPUT_ALREADY_EXISTS/,
    );
    assert.deepEqual(await readdir(outputDirectory), ['old-contact.png']);
    assert.deepEqual((await readdir(tempRoot)).filter((name) => name.includes('.error-')), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
