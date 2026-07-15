import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, open, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  PRINTING_SCORE_AXES,
  validatePrintingApprovalManifest,
  type PrintingApprovalManifest,
  type PrintingScores,
} from '../src/features/printing/quality/printingApprovalSchema.ts';
import {
  buildPrintingApprovalReport,
  decodeImageMetadata,
  parseImageMetadata,
  validateApprovalAggregateLimits,
  type ApprovalAssetEvidence,
} from './lib/printing-approval-pack.ts';

const manifestPath = new URL('../benchmarks/printing-approval-v1/manifest.json', import.meta.url);
const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname);
const execFileAsync = promisify(execFile);
const loadManifest = async () => JSON.parse(await readFile(manifestPath, 'utf8')) as PrintingApprovalManifest;
const scores = (value: number): PrintingScores =>
  Object.fromEntries(PRINTING_SCORE_AXES.map((axis) => [axis, value])) as PrintingScores;

const png = (width: number, height: number) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};
const validPng = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 120, g: 140, b: 160, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

const jpeg = (sof: 0xc0 | 0xc1 | 0xc2, width: number, height: number) =>
  Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, sof, 0x00, 0x07, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff,
    0xff, 0xd9,
  ]);

const webpVp8x = (width: number, height: number) => {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBPVP8X', 8, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
};

const webpVp8l = (width: number, height: number) => {
  const buffer = Buffer.alloc(25);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(17, 4);
  buffer.write('WEBPVP8L', 8, 'ascii');
  buffer.writeUInt32LE(5, 16);
  buffer[20] = 0x2f;
  buffer.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return buffer;
};

const webpVp8 = (width: number, height: number) => {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBPVP8 ', 8, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer.set([0x9d, 0x01, 0x2a], 23);
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
};

test('checked-in manifest fixes 24 balanced cases and remains incomplete rather than approved', async () => {
  const manifest = await loadManifest();
  const { validation } = validatePrintingApprovalManifest(manifest);
  assert.equal(manifest.cases.length, 24);
  assert.equal(validation.invalidIssues.length, 0);
  assert.equal(validation.qualityFailures.length, 0);
  assert.equal(validation.incompleteIssues.filter((item) => item.code === 'CASE_NOT_RUN').length, 24);
  for (const stratum of ['S1', 'S2', 'S3', 'S4']) {
    assert.equal(manifest.cases.filter((item) => item.stratum === stratum).length, 6);
  }
});

test('parses PNG, JPEG SOF0/SOF1/SOF2, and WebP VP8/VP8L/VP8X headers', () => {
  assert.deepEqual(parseImageMetadata(png(720, 900)), { format: 'png', width: 720, height: 900 });
  for (const sof of [0xc0, 0xc1, 0xc2] as const) {
    assert.deepEqual(parseImageMetadata(jpeg(sof, 640, 480)), { format: 'jpeg', width: 640, height: 480 });
  }
  assert.deepEqual(parseImageMetadata(webpVp8(320, 240)), { format: 'webp', width: 320, height: 240 });
  assert.deepEqual(parseImageMetadata(webpVp8l(321, 241)), { format: 'webp', width: 321, height: 241 });
  assert.deepEqual(parseImageMetadata(webpVp8x(322, 242)), { format: 'webp', width: 322, height: 242 });
});

test('full decoder accepts real PNG/JPEG/WebP and rejects header-only lookalikes', async () => {
  const source = sharp({
    create: { width: 32, height: 24, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } },
  });
  assert.deepEqual(await decodeImageMetadata(await source.clone().png().toBuffer()), { format: 'png', width: 32, height: 24 });
  assert.deepEqual(await decodeImageMetadata(await source.clone().jpeg().toBuffer()), { format: 'jpeg', width: 32, height: 24 });
  assert.deepEqual(await decodeImageMetadata(await source.clone().webp().toBuffer()), { format: 'webp', width: 32, height: 24 });
  await assert.rejects(decodeImageMetadata(png(32, 24)));
  await assert.rejects(decodeImageMetadata(jpeg(0xc0, 32, 24)));
  await assert.rejects(decodeImageMetadata(webpVp8x(32, 24)));
});

test('rejects truncated, unsupported, and zero-dimension image headers', () => {
  assert.throws(() => parseImageMetadata(png(0, 10)), /IMAGE_DIMENSIONS_INVALID/);
  assert.throws(() => parseImageMetadata(png(20, 20).subarray(0, 24)), /PNG_TRUNCATED/);
  assert.throws(() => parseImageMetadata(jpeg(0xc0, 20, 20).subarray(0, 12)), /JPEG_TRUNCATED/);
  assert.throws(() => parseImageMetadata(jpeg(0xc1, 20, 20).subarray(0, 12)), /JPEG_TRUNCATED/);
  assert.throws(() => parseImageMetadata(jpeg(0xc2, 20, 20).subarray(0, 12)), /JPEG_TRUNCATED/);
  assert.throws(() => parseImageMetadata(webpVp8(20, 20).subarray(0, 22)), /WEBP_TRUNCATED/);
  assert.throws(() => parseImageMetadata(webpVp8l(20, 20).subarray(0, 22)), /WEBP_TRUNCATED/);
  assert.throws(() => parseImageMetadata(webpVp8x(20, 20).subarray(0, 22)), /WEBP_TRUNCATED/);
  assert.throws(() => parseImageMetadata(Buffer.from('GIF89a')), /IMAGE_FORMAT_UNSUPPORTED/);
});

test('aggregate display budgets fail closed without decoding giant files', () => {
  const evidence = Array.from({ length: 25 }, (_, index): ApprovalAssetEvidence => ({
    caseId: `case-${index}`,
    role: 'garmentPreview',
    uri: `case-${index}.png`,
    absolutePath: `/tmp/case-${index}.png`,
    sha256: `${index}`.padStart(64, '0'),
    bytes: 2 * 1024 * 1024,
    format: 'png',
    width: 720,
    height: 900,
  }));
  const invalidIssues: Array<{ code: string; message: string }> = [];
  validateApprovalAggregateLimits(evidence, invalidIssues);
  assert.ok(invalidIssues.some((item) => item.code === 'PREVIEW_AGGREGATE_LIMIT_EXCEEDED'));
});

const createCompleteFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'printing-approval-'));
  const benchmark = path.join(root, 'benchmark');
  const assetRoot = path.join(benchmark, 'assets', 'shared');
  const output = path.join(root, 'output-a');
  await mkdir(assetRoot, { recursive: true });
  for (const name of ['source.png', 'preview.png', 'artwork.png', 'result.png']) {
    await writeFile(path.join(assetRoot, name), await validPng(name === 'result.png' ? 1440 : 640, name === 'result.png' ? 900 : 640));
  }
  const manifest = await loadManifest();
  for (const candidate of manifest.cases) {
    candidate.assets = {
      garmentSource: 'shared/source.png',
      garmentPreview: 'shared/preview.png',
      artwork: 'shared/artwork.png',
      result: candidate.stratum === 'S4' ? null : 'shared/result.png',
    };
    if (candidate.stratum === 'S4') {
      candidate.observedDisposition = 'explicit-reject';
      candidate.observedReasonCode = 'OOD_INPUT';
      candidate.surfaceProvenance = 'none';
      candidate.resultMode = 'none';
      candidate.scores = null;
      candidate.reviewStatus = 'reviewed';
      candidate.criticalFailures = null;
    } else {
      candidate.observedDisposition = 'semantic-success';
      candidate.observedReasonCode = null;
      candidate.surfaceProvenance = 'automatic-semantic';
      candidate.resultMode = 'surface-conform';
      candidate.scores = scores(5);
      candidate.reviewStatus = 'reviewed';
      candidate.criticalFailures = [];
    }
  }
  const targetManifest = path.join(benchmark, 'manifest.json');
  await writeFile(targetManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, targetManifest, output, assetRoot, manifest };
};

test('report builder preserves invalid classification for malformed case JSON', async () => {
  const fixture = await createCompleteFixture();
  (fixture.manifest.cases[0] as unknown as { id: number }).id = 42;
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  const report = await buildPrintingApprovalReport({
    manifestPath: fixture.targetManifest,
    outputDirectory: fixture.output,
  });
  assert.equal(report.evidenceValid, false);
  assert.ok(report.invalidIssues.some((item) => item.code === 'CASE_INVALID'));

  const malformedTopLevel = { ...fixture.manifest, cases: null };
  await writeFile(fixture.targetManifest, JSON.stringify(malformedTopLevel));
  const topLevelReport = await buildPrintingApprovalReport({
    manifestPath: fixture.targetManifest,
    outputDirectory: fixture.output,
  });
  assert.equal(topLevelReport.evidenceValid, false);
  assert.ok(topLevelReport.invalidIssues.some((item) => item.code === 'CASE_COUNT_INVALID'));
});

test('complete evidence is ready but remains pending until a digest-bound user decision exists', async () => {
  const fixture = await createCompleteFixture();
  const first = await buildPrintingApprovalReport({
    manifestPath: fixture.targetManifest,
    outputDirectory: fixture.output,
    generatedAt: '2026-07-15T00:00:00.000Z',
  });
  assert.equal(first.evidenceValid, true);
  assert.equal(first.evidenceComplete, true);
  assert.equal(first.qualityGatePassed, true);
  assert.equal(first.readyForUserApproval, true);
  assert.equal(first.checkpointApproval, 'pending');

  const decisionPath = path.join(fixture.root, 'decision.json');
  await writeFile(
    decisionPath,
    JSON.stringify({
      schemaVersion: 'printing-approval-v1',
      manifestDigest: first.manifestDigest,
      evidenceCoreDigest: first.evidenceCoreDigest,
      decision: 'approved',
      decidedAt: '2026-07-15T01:00:00.000Z',
    }),
  );
  const approved = await buildPrintingApprovalReport({
    manifestPath: fixture.targetManifest,
    outputDirectory: path.join(fixture.root, 'output-b'),
    decisionPath,
    generatedAt: '2026-07-16T00:00:00.000Z',
  });
  assert.equal(approved.evidenceCoreDigest, first.evidenceCoreDigest);
  assert.equal(approved.checkpointApproval, 'approved');

  await writeFile(path.join(fixture.assetRoot, 'result.png'), Buffer.concat([png(1440, 900), Buffer.from([1])]));
  const changed = await buildPrintingApprovalReport({
    manifestPath: fixture.targetManifest,
    outputDirectory: fixture.output,
    decisionPath,
  });
  assert.notEqual(changed.evidenceCoreDigest, first.evidenceCoreDigest);
  assert.equal(changed.checkpointApproval, 'pending');
  assert.equal(changed.decisionIssue, 'DECISION_BINDING_INVALID');

  await writeFile(path.join(fixture.assetRoot, 'result.png'), await validPng(1440, 900));
  fixture.manifest.cases[0].scores = scores(4.5);
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  const scoreChanged = await buildPrintingApprovalReport({
    manifestPath: fixture.targetManifest,
    outputDirectory: fixture.output,
    decisionPath,
  });
  assert.notEqual(scoreChanged.evidenceCoreDigest, first.evidenceCoreDigest);
  assert.equal(scoreChanged.checkpointApproval, 'pending');

  fixture.manifest.cases[0].label = 'Changed manifest label';
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  const manifestChanged = await buildPrintingApprovalReport({
    manifestPath: fixture.targetManifest,
    outputDirectory: fixture.output,
    decisionPath,
  });
  assert.notEqual(manifestChanged.manifestDigest, first.manifestDigest);
  assert.equal(manifestChanged.checkpointApproval, 'pending');
});

test('well-formed low quality is a quality failure, while malformed critical other is invalid', async () => {
  const manifest = await loadManifest();
  const candidate = manifest.cases[0];
  candidate.observedDisposition = 'semantic-success';
  candidate.surfaceProvenance = 'automatic-semantic';
  candidate.resultMode = 'surface-conform';
  candidate.assets.result = 'result.png';
  candidate.scores = scores(2);
  candidate.reviewStatus = 'reviewed';
  candidate.criticalFailures = [];
  let result = validatePrintingApprovalManifest(manifest);
  assert.ok(result.validation.qualityFailures.some((item) => item.code === 'MEAN_SCORE_BELOW_GATE'));
  assert.ok(!result.validation.invalidIssues.some((item) => item.caseId === candidate.id));

  candidate.scores = scores(5);
  candidate.criticalFailures = [{ code: 'other' }];
  result = validatePrintingApprovalManifest(manifest);
  assert.ok(result.validation.invalidIssues.some((item) => item.code === 'CRITICAL_OTHER_DETAIL_REQUIRED'));
});

test('an explicit reject needs human review but never fabricated scores or a result', async () => {
  const manifest = await loadManifest();
  const candidate = manifest.cases.find((item) => item.stratum === 'S4')!;
  candidate.observedDisposition = 'explicit-reject';
  candidate.observedReasonCode = 'MULTIPLE_GARMENTS';
  candidate.reviewStatus = 'unreviewed';
  let result = validatePrintingApprovalManifest(manifest);
  assert.ok(result.validation.incompleteIssues.some((item) => item.code === 'CASE_UNREVIEWED' && item.caseId === candidate.id));
  assert.ok(!result.validation.invalidIssues.some((item) => item.caseId === candidate.id));
  candidate.reviewStatus = 'reviewed';
  result = validatePrintingApprovalManifest(manifest);
  assert.ok(!result.validation.incompleteIssues.some((item) => item.code === 'CASE_UNREVIEWED' && item.caseId === candidate.id));
});

test('fixed scores reject extra axes and malformed JSON becomes invalid instead of throwing', async () => {
  const manifest = await loadManifest();
  const candidate = manifest.cases[0];
  candidate.observedDisposition = 'semantic-success';
  candidate.surfaceProvenance = 'automatic-semantic';
  candidate.resultMode = 'surface-conform';
  candidate.assets.result = 'result.png';
  candidate.scores = { ...scores(5), unexpectedAxis: 5 } as PrintingScores;
  candidate.reviewStatus = 'reviewed';
  candidate.criticalFailures = [];
  let result = validatePrintingApprovalManifest(manifest);
  assert.ok(result.validation.invalidIssues.some((item) => item.code === 'SCORE_AXES_INVALID'));

  (manifest.cases[0] as unknown as { id: number }).id = 42;
  assert.doesNotThrow(() => {
    result = validatePrintingApprovalManifest(manifest);
  });
  assert.ok(result.validation.invalidIssues.some((item) => item.code === 'CASE_INVALID'));
});

test('path traversal and symlink escape are invalid rather than incomplete', async () => {
  const fixture = await createCompleteFixture();
  fixture.manifest.cases[0].assets.garmentSource = '../outside.png';
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  let report = await buildPrintingApprovalReport({ manifestPath: fixture.targetManifest, outputDirectory: fixture.output });
  assert.ok(report.invalidIssues.some((item) => item.code === 'ASSET_PATH_TRAVERSAL'));

  fixture.manifest.cases[0].assets.garmentSource = 'shared/escape.png';
  const outside = path.join(fixture.root, 'outside.png');
  await writeFile(outside, await validPng(10, 10));
  await symlink(outside, path.join(fixture.assetRoot, 'escape.png'));
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  report = await buildPrintingApprovalReport({ manifestPath: fixture.targetManifest, outputDirectory: fixture.output });
  assert.ok(report.invalidIssues.some((item) => item.code === 'ASSET_SYMLINK_ESCAPE'));
});

test('magic-extension mismatch and role dimension overrun are invalid', async () => {
  const fixture = await createCompleteFixture();
  fixture.manifest.cases[0].assets.garmentSource = 'shared/source.jpg';
  await writeFile(path.join(fixture.assetRoot, 'source.jpg'), await validPng(640, 640));
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  let report = await buildPrintingApprovalReport({ manifestPath: fixture.targetManifest, outputDirectory: fixture.output });
  assert.ok(report.invalidIssues.some((item) => item.code === 'ASSET_FORMAT_MISMATCH'));

  fixture.manifest.cases[0].assets.garmentSource = 'shared/too-wide.png';
  await writeFile(path.join(fixture.assetRoot, 'too-wide.png'), await validPng(4097, 10));
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  report = await buildPrintingApprovalReport({ manifestPath: fixture.targetManifest, outputDirectory: fixture.output });
  assert.ok(report.invalidIssues.some((item) => item.code === 'ASSET_LIMIT_EXCEEDED'));
});

test('header-only and oversized sparse assets fail before entering evidence', async () => {
  const fixture = await createCompleteFixture();
  await writeFile(path.join(fixture.assetRoot, 'source.png'), png(640, 640));
  let report = await buildPrintingApprovalReport({ manifestPath: fixture.targetManifest, outputDirectory: fixture.output });
  assert.ok(report.invalidIssues.some((item) => item.code === 'ASSET_IMAGE_INVALID'));
  assert.ok(!report.assetEvidence.some((item) => item.caseId === fixture.manifest.cases[0].id && item.role === 'garmentSource'));

  const hugePath = path.join(fixture.assetRoot, 'huge.png');
  await writeFile(path.join(fixture.assetRoot, 'source.png'), await validPng(640, 640));
  const handle = await open(hugePath, 'w');
  await handle.truncate(32 * 1024 * 1024 + 1);
  await handle.close();
  fixture.manifest.cases[0].assets.garmentSource = 'shared/huge.png';
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  report = await buildPrintingApprovalReport({ manifestPath: fixture.targetManifest, outputDirectory: fixture.output });
  assert.ok(report.invalidIssues.some((item) => item.code === 'ASSET_LIMIT_EXCEEDED'));
  assert.ok(!report.invalidIssues.some((item) => item.code === 'ASSET_IMAGE_INVALID' && item.assetRole === 'garmentSource'));
});

test('CLI allow-incomplete relaxes only incomplete evidence and still writes artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'printing-approval-cli-'));
  const output = path.join(root, 'allow-output');
  await execFileAsync(
    process.execPath,
    [
      '--experimental-strip-types',
      'scripts/build-printing-approval-pack.ts',
      '--output',
      output,
      '--allow-incomplete',
    ],
    { cwd: repositoryRoot },
  );
  await access(path.join(output, 'report.json'));
  await access(path.join(output, 'contact-sheet.html'));

  const strictOutput = path.join(root, 'strict-output');
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/build-printing-approval-pack.ts', '--output', strictOutput],
      { cwd: repositoryRoot },
    ),
    (error: { code?: number }) => error.code === 1,
  );
  await access(path.join(strictOutput, 'report.json'));

  const fixture = await createCompleteFixture();
  fixture.manifest.cases[0].assets.garmentSource = '../outside.png';
  await writeFile(fixture.targetManifest, JSON.stringify(fixture.manifest));
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/build-printing-approval-pack.ts',
        '--manifest',
        fixture.targetManifest,
        '--output',
        path.join(root, 'invalid-output'),
        '--allow-incomplete',
      ],
      { cwd: repositoryRoot },
    ),
    (error: { code?: number }) => error.code === 1,
  );
});
