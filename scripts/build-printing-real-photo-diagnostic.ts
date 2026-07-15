import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  assertCanonicalManifestUnchanged,
  assertModelCaseBounds,
  assertOutputPathContained,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_OUTPUT_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_SOURCE_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION,
  sha256Hex,
  stableDigest,
  validateContainedPathCandidate,
  type PrintingOfflineModelDiagnosticWorkerEvent,
} from './lib/printing-offline-model-diagnostic.ts';
import {
  isDiagnosticProcessCleanupNotEstablishedError,
  runHardTimedDiagnosticChild,
} from './lib/printing-offline-model-diagnostic-process.ts';
import {
  buildRealPhotoCaseDigest,
  buildRealPhotoDiagnosticBannerSvg,
  classifyRealPhotoSafety,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_CASE_SCHEMA_VERSION,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_REPORT_SCHEMA_VERSION,
  PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION,
  realPhotoManifestDigest,
  type PrintingRealPhotoExecutionManifest,
  type PrintingRealPhotoManifestCase,
} from './lib/printing-real-photo-diagnostic.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(repositoryRoot, 'public/models/silueta.onnx');
const workerScriptPath = path.join(repositoryRoot, 'scripts/printing-real-photo-diagnostic-worker.ts');
const artworkRoot = path.join(repositoryRoot, 'benchmarks/printing-approval-v1/assets');
const artworkPath = path.join(artworkRoot, 'S1-01/artwork.png');
let manifestPath = '';
const SESSION_TIMEOUT_MS = 20 * 60 * 1_000;
const CASE_TIMEOUT_MS = 60_000;

type ManifestCase = PrintingRealPhotoManifestCase;

type ValidatedManifestCase = ManifestCase & Readonly<{
  sourcePath: string;
  artworkPath: string;
}>;

const readArgument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`ARGUMENT_MISSING:${name}`);
  return process.argv[index + 1];
};

const parseWorkerEvents = (stdout: string, expectedCaseId: string) => {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const events = lines.map((line) => JSON.parse(line) as PrintingOfflineModelDiagnosticWorkerEvent);
  if (
    events.length !== 2
    || events[0].version !== PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION
    || events[0].type !== 'case-start'
    || events[0].caseId !== expectedCaseId
    || events[1].version !== PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION
    || events[1].type !== 'case-complete'
    || events[1].caseId !== expectedCaseId
    || !events[1].finite
  ) {
    throw new Error(`WORKER_PROTOCOL_INVALID:${expectedCaseId}`);
  }
  return events;
};

const preflightManifestCases = async (cases: readonly ManifestCase[]) => {
  const sourceRoot = await realpath(path.join(path.dirname(manifestPath), 'normalized'));
  const originalRoot = await realpath(path.join(path.dirname(manifestPath), 'sources'));
  const canonicalArtworkRoot = await realpath(artworkRoot);
  const canonicalArtworkPath = validateContainedPathCandidate(
    canonicalArtworkRoot,
    artworkPath,
    await realpath(artworkPath),
  );
  const artworkStats = await stat(canonicalArtworkPath);
  const artworkMetadata = await sharp(canonicalArtworkPath, { limitInputPixels: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES / 4 }).metadata();
  if (!artworkMetadata.width || !artworkMetadata.height) throw new Error('ARTWORK_DIMENSIONS_MISSING');
  assertModelCaseBounds(artworkMetadata.width, artworkMetadata.height, artworkStats.size);
  let aggregateSourceBytes = 0;
  const validated: ValidatedManifestCase[] = [];
  const seenIds = new Set<string>();
  for (const manifestCase of cases) {
    if (seenIds.has(manifestCase.id)) throw new Error(`REAL_PHOTO_CASE_ID_DUPLICATE:${manifestCase.id}`);
    seenIds.add(manifestCase.id);
    const sourcePath = validateContainedPathCandidate(sourceRoot, path.resolve(manifestCase.normalizedPath), await realpath(manifestCase.normalizedPath));
    const originalPath = validateContainedPathCandidate(originalRoot, path.resolve(manifestCase.originalPath), await realpath(manifestCase.originalPath));
    const sourceStats = await stat(sourcePath);
    const originalStats = await stat(originalPath);
    const sourceMetadata = await sharp(sourcePath, { limitInputPixels: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES / 4 }).metadata();
    const originalMetadata = await sharp(originalPath, { limitInputPixels: 8192 * 8192 }).metadata();
    if (!sourceMetadata.width || !sourceMetadata.height || !originalMetadata.width || !originalMetadata.height) {
      throw new Error(`ASSET_DIMENSIONS_MISSING:${manifestCase.id}`);
    }
    assertModelCaseBounds(sourceMetadata.width, sourceMetadata.height, sourceStats.size);
    if (
      sourceStats.size !== manifestCase.normalizedBytes
      || sourceMetadata.width !== manifestCase.normalizedWidth
      || sourceMetadata.height !== manifestCase.normalizedHeight
      || sha256Hex(await readFile(sourcePath)) !== manifestCase.normalizedSha256
      || originalStats.size !== manifestCase.originalBytes
      || originalMetadata.width !== manifestCase.originalWidth
      || originalMetadata.height !== manifestCase.originalHeight
      || sha256Hex(await readFile(originalPath)) !== manifestCase.originalSha256
    ) {
      throw new Error(`REAL_PHOTO_MANIFEST_EVIDENCE_MISMATCH:${manifestCase.id}`);
    }
    aggregateSourceBytes += sourceStats.size + artworkStats.size;
    if (aggregateSourceBytes > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_SOURCE_BYTES) {
      throw new Error('AGGREGATE_SOURCE_BYTES_EXCEEDED');
    }
    validated.push({ ...manifestCase, sourcePath, artworkPath: canonicalArtworkPath });
  }
  return { sourceRoot, artworkRoot: canonicalArtworkRoot, cases: validated, aggregateSourceBytes };
};

const publishParentError = async ({
  allowedRoot,
  stagingDirectory,
  outputDirectory,
  manifestDigestBefore,
  caseCount,
  completedCaseCount,
  exactBlocker,
  error,
}: {
  allowedRoot: string;
  stagingDirectory: string;
  outputDirectory: string;
  manifestDigestBefore: string;
  caseCount: number;
  completedCaseCount: number;
  exactBlocker: string;
  error: string;
}) => {
  const safeStaging = await assertOutputPathContained(allowedRoot, stagingDirectory);
  const safeOutput = await assertOutputPathContained(allowedRoot, outputDirectory);
  await rm(safeStaging, { recursive: true, force: true });
  const temporaryOutput = await assertOutputPathContained(allowedRoot, `${safeOutput}.error-${process.pid}-${Date.now()}`);
  let renamed = false;
  try {
    await mkdir(temporaryOutput);
    const readbackBase = {
      schemaVersion: PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION,
      status: 'error',
      incomplete: true,
      generatedAt: new Date().toISOString(),
      outputDirectory: safeOutput,
      manifestPath,
      manifestDigestBefore,
      manifestDigestAfter: null,
      caseCount,
      completedCaseCount,
      finiteCaseCount: 0,
      error,
      exactBlocker,
      stage: 'worker',
      flags: PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
      bannerText: PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT,
      ...PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
      workerScriptPath,
      modelPath,
      modelSha256: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
      modelInputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
      modelOutputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
      modelInputShape: [1, 3, 320, 320],
      modelOutputShape: [1, 1, 320, 320],
    };
    const serializedReadback = serializeReadbackWithActualTotal(readbackBase, 0);
    await writeFile(path.join(temporaryOutput, 'readback.json'), serializedReadback.serialized, { flag: 'wx' });
    await rename(temporaryOutput, safeOutput);
    renamed = true;
  } finally {
    if (!renamed) await rm(temporaryOutput, { recursive: true, force: true });
  }
};

const buildContactSheet = async (caseDocuments: Array<Record<string, unknown>>, stagingDirectory: string) => {
  const columns = 4;
  const thumbWidth = 352;
  const thumbHeight = 251;
  const cellWidth = 360;
  const cellHeight = 280;
  const rows = Math.ceil(caseDocuments.length / columns);
  const composites: sharp.OverlayOptions[] = [{ input: buildRealPhotoDiagnosticBannerSvg(), left: 0, top: 0 }];
  for (let index = 0; index < caseDocuments.length; index += 1) {
    const result = caseDocuments[index].result as Record<string, unknown>;
    const caseId = String(result.caseId);
    const markedPath = path.join(stagingDirectory, String(result.markedArtifactPath));
    const thumbnail = await sharp(markedPath).resize(thumbWidth, thumbHeight, { fit: 'contain', background: '#0f172a' }).png().toBuffer();
    const left = (index % columns) * cellWidth + 4;
    const top = 128 + (Math.floor(index / columns) * cellHeight);
    composites.push({ input: thumbnail, left, top });
    composites.push({
      input: Buffer.from(`<svg width="352" height="24"><rect width="352" height="24" fill="#111827"/><text x="8" y="17" fill="white" font-family="Arial" font-size="13">${caseId}</text></svg>`),
      left,
      top: top + thumbHeight,
    });
  }
  return sharp({
    create: { width: 1440, height: 128 + (rows * cellHeight), channels: 3, background: '#030712' },
  })
    .composite(composites)
    .png()
    .toBuffer();
};

const assertExactBannerHeader = async (imagePath: string) => {
  const metadata = await sharp(imagePath).metadata();
  if (metadata.width !== 1440 || !metadata.height || metadata.height < 128) throw new Error('MARKED_ARTIFACT_DIMENSIONS_INVALID');
  const actual = await sharp(imagePath).extract({ left: 0, top: 0, width: 1440, height: 128 }).ensureAlpha().raw().toBuffer();
  const expected = await sharp(buildRealPhotoDiagnosticBannerSvg()).ensureAlpha().raw().toBuffer();
  if (!actual.equals(expected)) throw new Error('DIAGNOSTIC_BANNER_MISMATCH');
};

const validateCaseEvidence = async (
  cases: readonly ManifestCase[],
  stagingDirectory: string,
  workerCompleteEvents: ReadonlyMap<string, Extract<PrintingOfflineModelDiagnosticWorkerEvent, { type: 'case-complete' }>>,
) => {
  const caseDirectory = path.join(stagingDirectory, 'cases');
  const actualFiles = (await readdir(caseDirectory)).sort();
  const expectedFiles = cases
    .flatMap((manifestCase) => [`${manifestCase.id}.json`, `${manifestCase.id}.png`])
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('CASE_FILE_ALLOWLIST_MISMATCH');
  const expectedFlags = JSON.stringify(PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS);
  const caseDocuments: Array<Record<string, unknown>> = [];
  let actualCaseBytes = 0;
  for (const manifestCase of cases) {
    const jsonPath = path.join(caseDirectory, `${manifestCase.id}.json`);
    const pngPath = path.join(caseDirectory, `${manifestCase.id}.png`);
    const jsonBytes = await readFile(jsonPath);
    const pngBytes = await readFile(pngPath);
    actualCaseBytes += jsonBytes.length + pngBytes.length;
    if (pngBytes.length > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES) throw new Error(`CASE_OUTPUT_BYTES_EXCEEDED:${manifestCase.id}`);
    const document = JSON.parse(jsonBytes.toString('utf8')) as Record<string, unknown>;
    const result = document.result as Record<string, unknown> | undefined;
    const workerComplete = workerCompleteEvents.get(manifestCase.id);
    const suggestion = result?.suggestion as Record<string, unknown> | undefined;
    const surface = result?.surface as Record<string, unknown> | undefined;
    const expectedSafety = suggestion && surface
      ? classifyRealPhotoSafety({
          riskTags: manifestCase.riskTags,
          suggestionKind: suggestion.kind === 'success' ? 'success' : 'fallback-required',
          surfaceKind: surface.kind === 'success' ? 'success' : surface.kind === 'ood' ? 'ood' : 'not-run',
        })
      : null;
    if (
      document.schemaVersion !== PRINTING_REAL_PHOTO_DIAGNOSTIC_CASE_SCHEMA_VERSION
      || document.status !== 'diagnostic-only'
      || JSON.stringify(document.flags) !== expectedFlags
      || !result
      || result.caseId !== manifestCase.id
      || result.label !== manifestCase.label
      || result.category !== manifestCase.category
      || result.view !== manifestCase.view
      || result.challenge !== manifestCase.challenge
      || result.pageUrl !== manifestCase.pageUrl
      || result.author !== manifestCase.author
      || result.license !== manifestCase.license
      || JSON.stringify(result.riskTags) !== JSON.stringify(manifestCase.riskTags)
      || result.expectedSafeOutcome !== manifestCase.expectedSafeOutcome
      || result.sourcePath !== manifestCase.normalizedPath
      || result.previewPath !== manifestCase.normalizedPath
      || JSON.stringify(result.sourceEvidence) !== JSON.stringify({
        bytes: manifestCase.normalizedBytes,
        width: manifestCase.normalizedWidth,
        height: manifestCase.normalizedHeight,
        sha256: manifestCase.normalizedSha256,
        originalPath: manifestCase.originalPath,
        originalBytes: manifestCase.originalBytes,
        originalWidth: manifestCase.originalWidth,
        originalHeight: manifestCase.originalHeight,
        originalSha256: manifestCase.originalSha256,
      })
      || result.markedArtifactPath !== `cases/${manifestCase.id}.png`
      || result.markedArtifactBytes !== pngBytes.length
      || result.markedArtifactSha256 !== sha256Hex(pngBytes)
      || result.rawPreHeaderBytes !== 720 * 900 * 4
      || !/^[a-f0-9]{64}$/.test(String(result.rawPreHeaderSha256))
      || result.modelInputName !== PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME
      || result.modelOutputName !== PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME
      || JSON.stringify(result.modelInputShape) !== JSON.stringify([1, 3, 320, 320])
      || JSON.stringify(result.modelOutputShape) !== JSON.stringify([1, 1, 320, 320])
      || result.outputWidth !== 320
      || result.outputHeight !== 320
      || result.outputBytes !== 320 * 320 * 4
      || typeof result.outputMin !== 'number'
      || !Number.isFinite(result.outputMin)
      || typeof result.outputMax !== 'number'
      || !Number.isFinite(result.outputMax)
      || result.outputMin > result.outputMax
      || !/^[a-f0-9]{64}$/.test(String(result.modelInputSha256))
      || !/^[a-f0-9]{64}$/.test(String(result.modelOutputSha256))
      || !/^[a-f0-9]{64}$/.test(String(result.outputSha256))
      || result.outputSha256 !== result.modelOutputSha256
      || result.finite !== true
      || result.bannerText !== PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT
      || result.synthetic !== false
      || result.cutoutPipelineParity !== false
      || result.browserParity !== false
      || result.realPhoto !== true
      || result.userApproval !== false
      || result.approvalEligible !== false
      || !expectedSafety
      || result.pipelineSuccess !== expectedSafety.pipelineSuccess
      || result.falseSuccess !== expectedSafety.falseSuccess
      || result.safetyDisposition !== expectedSafety.safetyDisposition
      || JSON.stringify(result.falseSuccessReasons) !== JSON.stringify(expectedSafety.falseSuccessReasons)
      || !workerComplete
      || workerComplete.outputBytes !== result.outputBytes
      || workerComplete.outputSha256 !== result.outputSha256
      || workerComplete.markedArtifactBytes !== result.markedArtifactBytes
      || workerComplete.markedArtifactSha256 !== result.markedArtifactSha256
      || workerComplete.finite !== true
      || document.caseDigest !== buildRealPhotoCaseDigest(result)
    ) {
      throw new Error(`CASE_EVIDENCE_INVALID:${manifestCase.id}`);
    }
    const metadata = await sharp(pngBytes).metadata();
    if (metadata.format !== 'png' || metadata.width !== 1440 || metadata.height !== 1028) {
      throw new Error(`CASE_MARKED_DIMENSIONS_INVALID:${manifestCase.id}`);
    }
    await assertExactBannerHeader(pngPath);
    caseDocuments.push(document);
  }
  return { caseDocuments, actualCaseBytes };
};

const serializeReadbackWithActualTotal = (base: Record<string, unknown>, baseBytes: number) => {
  let totalOutputBytes = baseBytes;
  let serialized = Buffer.alloc(0);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    serialized = Buffer.from(`${JSON.stringify({ ...base, totalOutputBytes }, null, 2)}\n`);
    const nextTotal = baseBytes + serialized.length;
    if (nextTotal === totalOutputBytes) return { totalOutputBytes, serialized };
    totalOutputBytes = nextTotal;
  }
  throw new Error('READBACK_TOTAL_BYTES_DID_NOT_STABILIZE');
};

const run = async () => {
  manifestPath = await realpath(path.resolve(readArgument('--manifest')));
  const outputDirectoryRequested = path.resolve(readArgument('--output'));
  const allowedRoot = path.dirname(outputDirectoryRequested);
  const outputDirectory = await assertOutputPathContained(allowedRoot, outputDirectoryRequested);
  try {
    await stat(outputDirectory);
    throw new Error('DIAGNOSTIC_OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const stagingDirectory = await assertOutputPathContained(
    allowedRoot,
    `${outputDirectory}.staging-${process.pid}-${Date.now()}`,
  );

  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as PrintingRealPhotoExecutionManifest;
  const manifestDigestBefore = realPhotoManifestDigest(manifest);
  const expectedSourceManifestPath = await realpath(path.join(path.dirname(manifestPath), 'sources.json'));
  const expectedDownloadReadbackPath = await realpath(path.join(path.dirname(manifestPath), 'download-readback.json'));
  if (
    path.basename(manifestPath) !== `real-photo-manifest-${manifestDigestBefore}.json`
    || manifest.schemaVersion !== 'printing-real-photo-execution-manifest-v1'
    || manifest.status !== 'immutable-input-snapshot'
    || manifest.requestedCaseCount !== 12
    || manifest.availableCaseCount !== 10
    || !Array.isArray(manifest.cases)
    || manifest.cases.length !== 10
    || manifest.pending.length !== 2
    || manifest.sourceManifestPath !== expectedSourceManifestPath
    || manifest.downloadReadbackPath !== expectedDownloadReadbackPath
    || sha256Hex(await readFile(expectedSourceManifestPath)) !== manifest.sourceManifestSha256
    || sha256Hex(await readFile(expectedDownloadReadbackPath)) !== manifest.downloadReadbackSha256
  ) {
    await publishParentError({
      allowedRoot,
      stagingDirectory,
      outputDirectory,
      manifestDigestBefore,
      caseCount: Array.isArray(manifest.cases) ? manifest.cases.length : 0,
      completedCaseCount: 0,
      exactBlocker: 'OFFLINE_MODEL_DIAGNOSTIC_CASE_COUNT_INVALID',
      error: 'Immutable real-photo manifest must contain exactly 10 available cases and 2 pending cases.',
    });
    process.exitCode = 1;
    return;
  }
  await mkdir(path.join(stagingDirectory, 'cases'), { recursive: true });
  await mkdir(path.join(stagingDirectory, 'specs'), { recursive: true });

  const sessionDeadline = Date.now() + SESSION_TIMEOUT_MS;
  let completedCaseCount = 0;
  const workerCompleteEvents = new Map<
    string,
    Extract<PrintingOfflineModelDiagnosticWorkerEvent, { type: 'case-complete' }>
  >();
  try {
    const preflight = await preflightManifestCases(manifest.cases);
    for (const manifestCase of preflight.cases) {
      const remainingSessionMs = sessionDeadline - Date.now();
      if (remainingSessionMs <= 0) throw new Error('OFFLINE_MODEL_DIAGNOSTIC_SESSION_TIMEOUT');
      const caseSpecPath = path.join(stagingDirectory, 'specs', `${manifestCase.id}.json`);
      await writeFile(caseSpecPath, `${JSON.stringify({
        id: manifestCase.id,
        label: manifestCase.label,
        category: manifestCase.category,
        view: manifestCase.view,
        challenge: manifestCase.challenge,
        pageUrl: manifestCase.pageUrl,
        author: manifestCase.author,
        license: manifestCase.license,
        riskTags: manifestCase.riskTags,
        expectedSafeOutcome: manifestCase.expectedSafeOutcome,
        sourceEvidence: {
          bytes: manifestCase.normalizedBytes,
          width: manifestCase.normalizedWidth,
          height: manifestCase.normalizedHeight,
          sha256: manifestCase.normalizedSha256,
          originalPath: manifestCase.originalPath,
          originalBytes: manifestCase.originalBytes,
          originalWidth: manifestCase.originalWidth,
          originalHeight: manifestCase.originalHeight,
          originalSha256: manifestCase.originalSha256,
        },
        sourcePath: manifestCase.sourcePath,
        artworkPath: manifestCase.artworkPath,
        sourceRoot: preflight.sourceRoot,
        artworkRoot: preflight.artworkRoot,
        stagingDirectory,
        modelPath,
      }, null, 2)}\n`, { flag: 'wx' });
      const childResult = await runHardTimedDiagnosticChild({
        command: process.execPath,
        args: ['--experimental-strip-types', workerScriptPath, '--case-spec', caseSpecPath],
        cwd: repositoryRoot,
        allowedRoot,
        stagingDirectory,
        outputDirectory,
        manifestPath,
        manifestDigestBefore,
        workerScriptPath,
        modelPath,
        caseCount: manifest.cases.length,
        timeoutMs: Math.max(1, Math.min(CASE_TIMEOUT_MS, remainingSessionMs)),
        killGraceMs: 1_000,
        errorReadbackContext: {
          schemaVersion: PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION,
          flags: PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
          bannerText: PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT,
        },
      });
      if (childResult.kind !== 'exit') {
        process.exitCode = 1;
        return;
      }
      if (childResult.exitCode !== 0 || childResult.exitSignal || !childResult.processGroupGone) {
        const childEvidence = `${childResult.stdout}\n${childResult.stderr}`.trim().slice(-4_000);
        throw new Error(`WORKER_EXIT_INVALID:${manifestCase.id}:${childResult.exitCode}:${childResult.exitSignal ?? 'none'}:${childEvidence}`);
      }
      const workerEvents = parseWorkerEvents(childResult.stdout, manifestCase.id);
      const workerComplete = workerEvents[1];
      if (workerComplete.type !== 'case-complete') {
        throw new Error(`WORKER_PROTOCOL_INVALID:${manifestCase.id}`);
      }
      workerCompleteEvents.set(manifestCase.id, workerComplete);
      completedCaseCount += 1;
      process.stdout.write(`completed ${completedCaseCount}/${manifest.cases.length} ${manifestCase.id}\n`);
    }

    const validatedEvidence = await validateCaseEvidence(
      manifest.cases,
      stagingDirectory,
      workerCompleteEvents,
    );
    const { caseDocuments, actualCaseBytes } = validatedEvidence;
    const contactSheet = await buildContactSheet(caseDocuments, stagingDirectory);
    if (contactSheet.length > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES) throw new Error('CONTACT_SHEET_BYTES_EXCEEDED');
    const contactSheetPath = path.join(stagingDirectory, 'contact-sheet.png');
    await writeFile(contactSheetPath, contactSheet, { flag: 'wx' });
    const contactMetadata = await sharp(contactSheet).metadata();
    const expectedContactHeight = 128 + (Math.ceil(caseDocuments.length / 4) * 280);
    if (contactMetadata.format !== 'png' || contactMetadata.width !== 1440 || contactMetadata.height !== expectedContactHeight) {
      throw new Error('CONTACT_SHEET_DIMENSIONS_INVALID');
    }
    await assertExactBannerHeader(contactSheetPath);
    const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8')) as PrintingRealPhotoExecutionManifest;
    assertCanonicalManifestUnchanged(manifestDigestBefore, manifestAfter);
    const manifestDigestAfter = realPhotoManifestDigest(manifestAfter);
    const caseDigest = stableDigest(caseDocuments.map((document) => document.caseDigest));
    const caseResults = caseDocuments.map((document) => document.result as Record<string, unknown>);
    const pipelineSuccessCount = caseResults.filter((result) => result.pipelineSuccess === true).length;
    const falseSuccessCount = caseResults.filter((result) => result.falseSuccess === true).length;
    const suggestionFallbackCount = caseResults.filter((result) => (result.suggestion as Record<string, unknown>).kind === 'fallback-required').length;
    const surfaceOodCount = caseResults.filter((result) => (result.surface as Record<string, unknown>).kind === 'ood').length;
    const overallVerdict = falseSuccessCount > 0 ? 'false-success-observed' : 'manual-review-required';
    const report = {
      schemaVersion: PRINTING_REAL_PHOTO_DIAGNOSTIC_REPORT_SCHEMA_VERSION,
      status: 'diagnostic-complete',
      generatedAt: new Date().toISOString(),
      flags: PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
      bannerText: PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT,
      manifestPath,
      manifestDigestBefore,
      manifestDigestAfter,
      caseCount: caseDocuments.length,
      requestedCaseCount: manifest.requestedCaseCount,
      availableCaseCount: manifest.availableCaseCount,
      pending: manifest.pending,
      aggregateSourceBytes: preflight.aggregateSourceBytes,
      caseDigest,
      finiteCaseCount: caseDocuments.length,
      pipelineSuccessCount,
      suggestionFallbackCount,
      surfaceOodCount,
      falseSuccessCount,
      overallVerdict,
      cases: caseDocuments,
      notice: 'Real-photo offline diagnostic only. Pipeline success is not semantic, browser, quality, or approval evidence.',
    };
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(stagingDirectory, 'report.json'), reportBytes, { flag: 'wx' });
    await rm(path.join(stagingDirectory, 'specs'), { recursive: true, force: true });
    const readbackBase = {
      schemaVersion: PRINTING_REAL_PHOTO_DIAGNOSTIC_SCHEMA_VERSION,
      status: 'ok',
      generatedAt: new Date().toISOString(),
      outputDirectory,
      manifestPath,
      manifestDigestBefore,
      manifestDigestAfter,
      caseCount: caseDocuments.length,
      requestedCaseCount: manifest.requestedCaseCount,
      availableCaseCount: manifest.availableCaseCount,
      pending: manifest.pending,
      completedCaseCount: caseDocuments.length,
      finiteCaseCount: caseDocuments.length,
      pipelineSuccessCount,
      suggestionFallbackCount,
      surfaceOodCount,
      falseSuccessCount,
      overallVerdict,
      contactSheetPath: 'contact-sheet.png',
      reportPath: 'report.json',
      flags: PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
      bannerText: PRINTING_REAL_PHOTO_DIAGNOSTIC_BANNER_TEXT,
      ...PRINTING_REAL_PHOTO_DIAGNOSTIC_FLAGS,
      workerScriptPath,
      modelPath,
      modelSha256: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
      modelInputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
      modelOutputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
      modelInputShape: [1, 3, 320, 320],
      modelOutputShape: [1, 1, 320, 320],
      caseDigest,
    };
    const serializedReadback = serializeReadbackWithActualTotal(
      readbackBase,
      actualCaseBytes + contactSheet.length + reportBytes.length,
    );
    if (serializedReadback.totalOutputBytes > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_OUTPUT_BYTES) {
      throw new Error('TOTAL_OUTPUT_BYTES_EXCEEDED');
    }
    await writeFile(path.join(stagingDirectory, 'readback.json'), serializedReadback.serialized, { flag: 'wx' });
    const expectedRootFiles = ['cases', 'contact-sheet.png', 'readback.json', 'report.json'];
    if (JSON.stringify((await readdir(stagingDirectory)).sort()) !== JSON.stringify(expectedRootFiles)) {
      throw new Error('ROOT_FILE_ALLOWLIST_MISMATCH');
    }
    const actualTotalBytes = actualCaseBytes
      + (await stat(contactSheetPath)).size
      + (await stat(path.join(stagingDirectory, 'report.json'))).size
      + (await stat(path.join(stagingDirectory, 'readback.json'))).size;
    if (actualTotalBytes !== serializedReadback.totalOutputBytes) throw new Error('TOTAL_OUTPUT_BYTES_MISMATCH');
    await rename(stagingDirectory, outputDirectory);
    process.stdout.write(serializedReadback.serialized.toString('utf8'));
  } catch (error) {
    if (isDiagnosticProcessCleanupNotEstablishedError(error)) {
      console.error(`PROCESS_CLEANUP_NOT_ESTABLISHED:${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
    await publishParentError({
      allowedRoot,
      stagingDirectory,
      outputDirectory,
      manifestDigestBefore,
      caseCount: manifest.cases.length,
      completedCaseCount,
      exactBlocker: error instanceof Error ? error.message.split(':')[0] : 'OFFLINE_MODEL_DIAGNOSTIC_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
