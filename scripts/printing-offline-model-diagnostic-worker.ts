import { readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as ort from 'onnxruntime-web';
import sharp from 'sharp';

import { conformSurface } from '../src/features/printing/render/surfaceConformer.ts';
import { suggestPrintableSurface } from '../src/features/printing/surface/suggestPrintableSurface.ts';
import {
  assertModelCaseBounds,
  assertOutputPathContained,
  buildCaseDigest,
  buildDiagnosticBannerSvg,
  normalizeImageNetInput,
  normalizeModelMaskToAlpha,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256,
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION,
  sha256Hex,
  validateContainedPathCandidate,
  type PrintingOfflineModelDiagnosticCaseResult,
  type PrintingOfflineModelDiagnosticWorkerEvent,
} from './lib/printing-offline-model-diagnostic.ts';

const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 900;

type WorkerCaseSpec = Readonly<{
  id: string;
  label: string;
  stratum: string;
  sourcePath: string;
  artworkPath: string;
  stagingDirectory: string;
  modelPath: string;
  assetRoot: string;
}>;

const readArgument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`ARGUMENT_MISSING:${name}`);
  return process.argv[index + 1];
};

const emit = (event: PrintingOfflineModelDiagnosticWorkerEvent) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const alphaFromRgba = (rgba: Uint8Array | Uint8ClampedArray) => {
  const alpha = new Uint8ClampedArray(rgba.length / 4);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[(index * 4) + 3];
  return alpha;
};

const replaceAlpha = (rgba: Uint8Array, alpha: Uint8Array | Uint8ClampedArray) => {
  if (rgba.length !== alpha.length * 4) throw new Error('CUTOUT_ALPHA_DIMENSION_MISMATCH');
  const output = new Uint8ClampedArray(rgba);
  for (let index = 0; index < alpha.length; index += 1) output[(index * 4) + 3] = alpha[index];
  return output;
};

const alphaBounds = (alpha: Uint8Array | Uint8ClampedArray, width: number, height: number) => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[(y * width) + x] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right >= left && bottom >= top
    ? { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
    : null;
};

const buildDesignPlane = async (artworkPath: string, clipAlpha: Uint8ClampedArray) => {
  const bounds = alphaBounds(clipAlpha, STAGE_WIDTH, STAGE_HEIGHT);
  const canvas = sharp({
    create: { width: STAGE_WIDTH, height: STAGE_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  if (!bounds) return new Uint8ClampedArray(await canvas.raw().toBuffer());
  const targetWidth = Math.max(1, Math.min(300, Math.round(bounds.width * 0.72)));
  const targetHeight = Math.max(1, Math.min(300, Math.round(bounds.height * 0.72)));
  const artwork = await sharp(artworkPath)
    .ensureAlpha()
    .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round(bounds.left + ((bounds.width - artwork.info.width) / 2));
  const top = Math.round(bounds.top + ((bounds.height - artwork.info.height) / 2));
  return new Uint8ClampedArray(await canvas
    .composite([{ input: artwork.data, left, top, blend: 'over' }])
    .raw()
    .toBuffer());
};

const applySingleClip = (design: Uint8ClampedArray, clipAlpha: Uint8ClampedArray) => {
  const output = new Uint8ClampedArray(design);
  for (let index = 0; index < clipAlpha.length; index += 1) {
    output[(index * 4) + 3] = Math.round((design[(index * 4) + 3] * clipAlpha[index]) / 255);
  }
  return output;
};

const compositeOverGarment = async (garment: Uint8ClampedArray, overlay: Uint8ClampedArray) => sharp(garment, {
  raw: { width: STAGE_WIDTH, height: STAGE_HEIGHT, channels: 4 },
})
  .composite([{ input: Buffer.from(overlay), raw: { width: STAGE_WIDTH, height: STAGE_HEIGHT, channels: 4 }, blend: 'over' }])
  .flatten({ background: '#ffffff' })
  .png()
  .toBuffer();

const labelSvg = (leftLabel: string, rightLabel: string) => Buffer.from(
  `<svg width="1440" height="900" xmlns="http://www.w3.org/2000/svg">
    <rect x="16" y="16" width="250" height="42" rx="10" fill="rgba(15,23,42,0.88)"/>
    <text x="34" y="44" fill="white" font-family="Arial" font-size="20" font-weight="700">${leftLabel}</text>
    <rect x="736" y="16" width="650" height="42" rx="10" fill="rgba(15,23,42,0.88)"/>
    <text x="754" y="44" fill="white" font-family="Arial" font-size="20" font-weight="700">${rightLabel.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text>
  </svg>`,
);

const run = async () => {
  const caseSpecPath = path.resolve(readArgument('--case-spec'));
  const spec = JSON.parse(await readFile(caseSpecPath, 'utf8')) as WorkerCaseSpec;
  const startedAt = Date.now();
  emit({
    version: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION,
    type: 'case-start',
    caseId: spec.id,
    label: spec.label,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  });

  const markedPath = await assertOutputPathContained(spec.stagingDirectory, path.join(spec.stagingDirectory, 'cases', `${spec.id}.png`));
  const jsonPath = await assertOutputPathContained(spec.stagingDirectory, path.join(spec.stagingDirectory, 'cases', `${spec.id}.json`));
  const markedTemp = `${markedPath}.tmp-${process.pid}`;
  const jsonTemp = `${jsonPath}.tmp-${process.pid}`;
  let session: ort.InferenceSession | undefined;
  try {
    globalThis.fetch = async () => {
      throw new Error('NETWORK_DISABLED');
    };
    const canonicalAssetRoot = await realpath(spec.assetRoot);
    const sourcePath = validateContainedPathCandidate(canonicalAssetRoot, path.resolve(spec.sourcePath), await realpath(spec.sourcePath));
    const artworkPath = validateContainedPathCandidate(canonicalAssetRoot, path.resolve(spec.artworkPath), await realpath(spec.artworkPath));
    const sourceStats = await stat(sourcePath);
    const artworkStats = await stat(artworkPath);
    const sourceMetadata = await sharp(sourcePath, { limitInputPixels: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES / 4 }).metadata();
    const artworkMetadata = await sharp(artworkPath, { limitInputPixels: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES / 4 }).metadata();
    if (!sourceMetadata.width || !sourceMetadata.height || !artworkMetadata.width || !artworkMetadata.height) {
      throw new Error('ASSET_DIMENSIONS_MISSING');
    }
    assertModelCaseBounds(sourceMetadata.width, sourceMetadata.height, sourceStats.size);
    assertModelCaseBounds(artworkMetadata.width, artworkMetadata.height, artworkStats.size);
    const sourceFile = await readFile(sourcePath);
    const sourceDecoded = await sharp(sourceFile, { limitInputPixels: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES / 4 })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sourceRgba = new Uint8ClampedArray(sourceDecoded.data);

    const modelBytes = await readFile(spec.modelPath);
    if (sha256Hex(modelBytes) !== PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256) throw new Error('MODEL_SHA256_MISMATCH');
    const inputRgb = await sharp(sourceFile)
      .rotate()
      .resize(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const normalizedInput = normalizeImageNetInput(inputRgb);

    ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
    if (session.inputNames.length !== 1 || session.inputNames[0] !== PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME) {
      throw new Error('MODEL_INPUT_METADATA_MISMATCH');
    }
    if (!session.outputNames.includes(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME)) {
      throw new Error('MODEL_OUTPUT_METADATA_MISMATCH');
    }
    const outputs = await session.run({
      [PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME]: new ort.Tensor('float32', normalizedInput.tensorData, normalizedInput.tensorShape),
    });
    const outputTensor = outputs[PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME];
    if (
      outputTensor.type !== 'float32'
      || JSON.stringify(outputTensor.dims) !== JSON.stringify([1, 1, 320, 320])
      || !(outputTensor.data instanceof Float32Array)
    ) {
      throw new Error('MODEL_OUTPUT_TENSOR_MISMATCH');
    }
    const modelOutput = outputTensor.data;
    const normalizedMask = normalizeModelMaskToAlpha(modelOutput);
    const resizedMask = await sharp(Buffer.from(normalizedMask.alpha), {
      raw: { width: 320, height: 320, channels: 1 },
    })
      .resize(sourceDecoded.info.width, sourceDecoded.info.height, { fit: 'fill', kernel: 'cubic' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sourceMask = resizedMask.info.channels === 1
      ? resizedMask.data
      : Uint8Array.from(
          { length: sourceDecoded.info.width * sourceDecoded.info.height },
          (_, index) => resizedMask.data[index * resizedMask.info.channels],
        );
    const cutoutSource = replaceAlpha(sourceRgba, sourceMask);
    const stageGarment = new Uint8ClampedArray(await sharp(Buffer.from(cutoutSource), {
      raw: { width: sourceDecoded.info.width, height: sourceDecoded.info.height, channels: 4 },
    })
      .resize(STAGE_WIDTH, STAGE_HEIGHT, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer());
    const garmentAlpha = alphaFromRgba(stageGarment);
    const suggestion = suggestPrintableSurface({ width: STAGE_WIDTH, height: STAGE_HEIGHT, garmentAlpha });
    const clipAlpha = suggestion.kind === 'success' ? suggestion.alpha : new Uint8ClampedArray(STAGE_WIDTH * STAGE_HEIGHT);
    const designPlane = await buildDesignPlane(artworkPath, clipAlpha);
    const exactOverlay = applySingleClip(designPlane, clipAlpha);
    const exactPng = await compositeOverGarment(stageGarment, exactOverlay);

    const conformed = suggestion.kind === 'success'
      ? conformSurface({
          source: { width: STAGE_WIDTH, height: STAGE_HEIGHT, rgba: stageGarment },
          sourceReferenceSize: { width: sourceDecoded.info.width, height: sourceDecoded.info.height },
          design: { width: STAGE_WIDTH, height: STAGE_HEIGHT, rgba: designPlane },
          garment: { width: STAGE_WIDTH, height: STAGE_HEIGHT, alpha: garmentAlpha },
          clip: { width: STAGE_WIDTH, height: STAGE_HEIGHT, alpha: clipAlpha },
          deadlineAtMs: Date.now() + 10_000,
        })
      : null;
    const surfacePng = conformed?.kind === 'success'
      ? await compositeOverGarment(stageGarment, conformed.rgba)
      : exactPng;
    const rightLabel = suggestion.kind === 'fallback-required'
      ? `SURFACE FALLBACK: ${suggestion.reason}`
      : conformed?.kind === 'ood'
        ? `SURFACE OOD: ${conformed.domain}`
        : 'SURFACE-CONFORM';
    const rawPair = await sharp({
      create: { width: 1440, height: 900, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite([
        { input: exactPng, left: 0, top: 0 },
        { input: surfacePng, left: 720, top: 0 },
        { input: labelSvg('EXACT', rightLabel), left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    const markedArtifact = await sharp(rawPair)
      .extend({ top: 128, bottom: 0, left: 0, right: 0, background: '#0f172a' })
      .composite([{ input: buildDiagnosticBannerSvg(), left: 0, top: 0 }])
      .png()
      .toBuffer();
    if (markedArtifact.length > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES) throw new Error('MARKED_OUTPUT_BYTES_EXCEEDED');

    let outputMin = Number.POSITIVE_INFINITY;
    let outputMax = Number.NEGATIVE_INFINITY;
    for (const value of modelOutput) {
      if (!Number.isFinite(value)) throw new Error('MODEL_OUTPUT_NON_FINITE');
      outputMin = Math.min(outputMin, value);
      outputMax = Math.max(outputMax, value);
    }
    const exactRawRgba = await sharp(exactPng).ensureAlpha().raw().toBuffer();
    const result: PrintingOfflineModelDiagnosticCaseResult & Record<string, unknown> = Object.freeze({
      caseId: spec.id,
      label: spec.label,
      stratum: spec.stratum,
      sourcePath: spec.sourcePath,
      previewPath: spec.sourcePath,
      markedArtifactPath: path.relative(spec.stagingDirectory, markedPath),
      markedArtifactBytes: markedArtifact.length,
      markedArtifactSha256: sha256Hex(markedArtifact),
      rawPreHeaderBytes: exactRawRgba.length,
      rawPreHeaderSha256: sha256Hex(exactRawRgba),
      outputWidth: 320,
      outputHeight: 320,
      outputBytes: modelOutput.byteLength,
      outputSha256: sha256Hex(new Uint8Array(modelOutput.buffer, modelOutput.byteOffset, modelOutput.byteLength)),
      finite: true,
      outputMin,
      outputMax,
      modelInputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME,
      modelOutputName: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME,
      modelInputShape: [1, 3, 320, 320],
      modelOutputShape: [1, 1, 320, 320],
      modelInputSha256: sha256Hex(new Uint8Array(normalizedInput.tensorData.buffer)),
      modelOutputSha256: sha256Hex(new Uint8Array(modelOutput.buffer, modelOutput.byteOffset, modelOutput.byteLength)),
      bannerText: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT,
      synthetic: true,
      ...PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS,
      elapsedMs: Date.now() - startedAt,
      cutoutPipelineParity: false,
      browserParity: false,
      realPhoto: false,
      userApproval: false,
      suggestion: suggestion.kind === 'success'
        ? { kind: suggestion.kind, diagnostics: suggestion.diagnostics }
        : { kind: suggestion.kind, reason: suggestion.reason, diagnostics: suggestion.diagnostics },
      surface: conformed
        ? { kind: conformed.kind, domain: conformed.kind === 'ood' ? conformed.domain : null, diagnostics: conformed.diagnostics }
        : { kind: 'not-run', domain: suggestion.kind === 'fallback-required' ? suggestion.reason : null },
    });
    const caseDocument = Object.freeze({
      schemaVersion: 'printing-offline-model-diagnostic-case-v1',
      status: 'diagnostic-only',
      flags: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS,
      result,
      caseDigest: buildCaseDigest(result),
    });
    await writeFile(markedTemp, markedArtifact, { flag: 'wx' });
    await writeFile(jsonTemp, `${JSON.stringify(caseDocument, null, 2)}\n`, { flag: 'wx' });
    await rename(markedTemp, markedPath);
    await rename(jsonTemp, jsonPath);
    emit({
      version: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION,
      type: 'case-complete',
      caseId: spec.id,
      completedAt: new Date().toISOString(),
      finite: true,
      outputBytes: modelOutput.byteLength,
      markedArtifactBytes: markedArtifact.length,
      markedArtifactSha256: result.markedArtifactSha256,
      outputSha256: result.outputSha256,
    });
  } finally {
    await rm(markedTemp, { force: true });
    await rm(jsonTemp, { force: true });
    if (session) await session.release();
  }
};

run().catch((error) => {
  emit({
    version: PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION,
    type: 'case-error',
    caseId: null,
    failedAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
