import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { stableCanonicalJson } from '../../src/features/printing/quality/printingApprovalSchema.ts';

export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_SCHEMA_VERSION = 'printing-offline-model-diagnostic-v1' as const;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION = 'printing-offline-model-diagnostic-worker-v1' as const;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_CASE_LIMIT = 24;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_DIMENSION = 4096;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES =
  PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_DIMENSION
  * PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_DIMENSION
  * 4;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_TOTAL_MAX_OUTPUT_BYTES = 300 * 1024 * 1024;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH = 320;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT = 320;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME = 'input.1' as const;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME = '1959' as const;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256 =
  '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb' as const;
export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT =
  'SYNTHETIC OFFLINE DIAGNOSTIC / NOT BROWSER / NOT REAL PHOTO / NOT APPROVAL / cutoutParity=false' as const;

export const PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS = Object.freeze({
  synthetic: true,
  cutoutPipelineParity: false,
  browserParity: false,
  realPhoto: false,
  userApproval: false,
} as const);

export type PrintingOfflineModelDiagnosticFlags = typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_FLAGS;

export type PrintingOfflineModelDiagnosticCaseInput = Readonly<{
  id: string;
  label: string;
  stratum: string;
  sourcePath: string;
  previewPath: string;
  artworkPath: string;
  expectedDisposition: string;
  observedDisposition: string;
  sourceBytes: number;
  sourceSha256: string;
  sourceWidth: number;
  sourceHeight: number;
}>;

export type PrintingOfflineModelDiagnosticCaseResult = Readonly<{
  caseId: string;
  label: string;
  stratum: string;
  sourcePath: string;
  previewPath: string;
  markedArtifactPath: string;
  markedArtifactBytes: number;
  markedArtifactSha256: string;
  rawPreHeaderBytes: number;
  rawPreHeaderSha256: string;
  outputWidth: number;
  outputHeight: number;
  outputBytes: number;
  outputSha256: string;
  finite: boolean;
  outputMin: number;
  outputMax: number;
  modelInputName: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME;
  modelOutputName: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME;
  modelInputShape: readonly [1, 3, 320, 320];
  modelOutputShape: readonly [1, 1, 320, 320];
  modelInputSha256: string;
  modelOutputSha256: string;
  bannerText: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT;
  synthetic: true;
  cutoutPipelineParity: false;
  browserParity: false;
  realPhoto: false;
  userApproval: false;
  elapsedMs: number;
}>;

export type PrintingOfflineModelDiagnosticWorkerEvent =
  | Readonly<{
      version: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION;
      type: 'case-start';
      caseId: string;
      label: string;
      startedAt: string;
      pid: number;
    }>
  | Readonly<{
      version: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION;
      type: 'case-complete';
      caseId: string;
      completedAt: string;
      finite: boolean;
      outputBytes: number;
      markedArtifactBytes: number;
      markedArtifactSha256: string;
      outputSha256: string;
    }>
  | Readonly<{
      version: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_WORKER_EVENT_VERSION;
      type: 'case-error';
      caseId: string | null;
      failedAt: string;
      message: string;
    }>;

export type PrintingOfflineModelDiagnosticReadback =
  | Readonly<{
      schemaVersion: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_SCHEMA_VERSION;
      status: 'ok';
      generatedAt: string;
      outputDirectory: string;
      manifestPath: string;
      manifestDigestBefore: string;
      manifestDigestAfter: string;
      caseCount: number;
      completedCaseCount: number;
      finiteCaseCount: number;
      totalOutputBytes: number;
      contactSheetPath: string;
      reportPath: string;
      flags: PrintingOfflineModelDiagnosticFlags;
      bannerText: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT;
      synthetic: true;
      cutoutPipelineParity: false;
      browserParity: false;
      realPhoto: false;
      userApproval: false;
      workerScriptPath: string;
      modelPath: string;
      modelSha256: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256;
      modelInputName: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME;
      modelOutputName: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME;
      modelInputShape: readonly [1, 3, 320, 320];
      modelOutputShape: readonly [1, 1, 320, 320];
      caseDigest: string;
    }>
  | Readonly<{
      schemaVersion: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_SCHEMA_VERSION;
      status: 'error';
      generatedAt: string;
      outputDirectory: string;
      manifestPath: string;
      manifestDigestBefore: string;
      manifestDigestAfter: string | null;
      caseCount: number;
      completedCaseCount: number;
      finiteCaseCount: number;
      totalOutputBytes: number;
      error: string;
      exactBlocker: string;
      stage: 'worker' | 'cleanup' | 'validation' | 'session-timeout';
      flags: PrintingOfflineModelDiagnosticFlags;
      bannerText: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT;
      synthetic: true;
      cutoutPipelineParity: false;
      browserParity: false;
      realPhoto: false;
      userApproval: false;
      workerScriptPath: string;
      modelPath: string;
      modelSha256: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_SHA256;
      modelInputName: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_INPUT_NAME;
      modelOutputName: typeof PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MODEL_OUTPUT_NAME;
      modelInputShape: readonly [1, 3, 320, 320];
      modelOutputShape: readonly [1, 1, 320, 320];
    }>;

export const sha256Hex = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

export const stableDigest = (value: unknown) => sha256Hex(stableCanonicalJson(value));

export const canonicalManifestDigest = <T>(manifest: Readonly<T>) => stableDigest(manifest);

export const isPathInsideRoot = (rootPath: string, candidatePath: string) => {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

export const validateContainedPathCandidate = (
  rootPath: string,
  absolutePath: string,
  realPath: string,
) => {
  if (!path.isAbsolute(rootPath) || !path.isAbsolute(absolutePath) || !path.isAbsolute(realPath)) {
    throw new Error('PATH_NOT_ABSOLUTE');
  }
  if (!isPathInsideRoot(rootPath, absolutePath)) {
    throw new Error('PATH_TRAVERSAL');
  }
  if (absolutePath !== realPath) {
    throw new Error('SYMLINK_REJECTED');
  }
  return realPath;
};

export const clampByte = (value: number) => Math.round(Math.min(255, Math.max(0, value)));

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const assertSafeIntegerDimension = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}_INVALID`);
  }
};

export const assertModelCaseBounds = (width: number, height: number, bytes: number) => {
  assertSafeIntegerDimension(width, 'WIDTH');
  assertSafeIntegerDimension(height, 'HEIGHT');
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('SOURCE_BYTES_INVALID');
  }
  if (width > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_DIMENSION || height > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_DIMENSION) {
    throw new Error('SOURCE_DIMENSION_EXCEEDED');
  }
  if (bytes > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_SOURCE_BYTES) {
    throw new Error('SOURCE_BYTES_EXCEEDED');
  }
  const decodedBytes = width * height * 4;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > PRINTING_OFFLINE_MODEL_DIAGNOSTIC_MAX_DECODED_BYTES) {
    throw new Error('SOURCE_DECODED_BYTES_EXCEEDED');
  }
};

const isMissingPathError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const assertOutputPathContained = async (rootPath: string, outputPath: string) => {
  if (!path.isAbsolute(rootPath) || !path.isAbsolute(outputPath)) {
    throw new Error('OUTPUT_PATH_NOT_ABSOLUTE');
  }
  const normalizedRoot = path.resolve(rootPath);
  const normalizedOutput = path.resolve(outputPath);
  if (!isPathInsideRoot(normalizedRoot, normalizedOutput)) {
    throw new Error('OUTPUT_PATH_TRAVERSAL');
  }
  const canonicalRoot = await realpath(normalizedRoot);
  const relativeParts = path.relative(normalizedRoot, normalizedOutput).split(path.sep).filter(Boolean);
  let existingPath = normalizedRoot;
  let existingPartCount = 0;

  for (let index = 0; index < relativeParts.length; index += 1) {
    const candidate = path.join(existingPath, relativeParts[index]);
    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        throw new Error('OUTPUT_PATH_SYMLINK_REJECTED');
      }
      existingPath = candidate;
      existingPartCount = index + 1;
    } catch (error) {
      if (isMissingPathError(error)) break;
      throw error;
    }
  }

  const canonicalExistingPath = await realpath(existingPath);
  if (!isPathInsideRoot(canonicalRoot, canonicalExistingPath)) {
    throw new Error('OUTPUT_PATH_CANONICAL_ESCAPE');
  }
  return path.join(canonicalExistingPath, ...relativeParts.slice(existingPartCount));
};

export const normalizeImageNetInput = (rgbBytes: Uint8Array | Uint8ClampedArray) => {
  const expectedLength = PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH
    * PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT
    * 3;
  if (rgbBytes.length !== expectedLength) {
    throw new Error('IMAGE_INPUT_INVALID');
  }
  let dynamicMax = 0;
  for (let index = 0; index < rgbBytes.length; index += 1) {
    dynamicMax = Math.max(dynamicMax, rgbBytes[index]);
  }
  const safeMax = dynamicMax > 0 ? dynamicMax : 255;
  const pixelCount = rgbBytes.length / 3;
  const output = new Float32Array(pixelCount * 3);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 3;
    output[pixelIndex] = ((rgbBytes[offset] / safeMax) - mean[0]) / std[0];
    output[pixelCount + pixelIndex] = ((rgbBytes[offset + 1] / safeMax) - mean[1]) / std[1];
    output[(pixelCount * 2) + pixelIndex] = ((rgbBytes[offset + 2] / safeMax) - mean[2]) / std[2];
  }
  return {
    dynamicMax: safeMax,
    tensorData: output,
    tensorShape: [1, 3, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH, PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT] as const,
  };
};

export const normalizeModelMaskToAlpha = (maskValues: Float32Array) => {
  const expectedLength = PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_WIDTH
    * PRINTING_OFFLINE_MODEL_DIAGNOSTIC_INPUT_HEIGHT;
  if (maskValues.length !== expectedLength) {
    throw new Error('MASK_LENGTH_INVALID');
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of maskValues) {
    if (!Number.isFinite(value)) {
      throw new Error('MASK_NON_FINITE');
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (max === min) {
    throw new Error('MASK_CONSTANT');
  }
  const alpha = new Uint8ClampedArray(maskValues.length);
  const range = max - min;
  for (let index = 0; index < maskValues.length; index += 1) {
    alpha[index] = clampByte(((maskValues[index] - min) / range) * 255);
  }
  return { min, max, alpha };
};

export const applyAlphaOnceSourceOverWhite = ({
  rgba,
  alpha,
  width,
  height,
}: {
  rgba: Uint8ClampedArray;
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
}) => {
  if (rgba.length !== width * height * 4 || alpha.length !== width * height) {
    throw new Error('ALPHA_ORACLE_DIMENSION_MISMATCH');
  }
  const output = new Uint8ClampedArray(rgba.length);
  for (let pixelIndex = 0; pixelIndex < alpha.length; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    // Apply the model mask once to source alpha, then flatten source-over-white.
    const effectiveAlpha = (rgba[rgbaIndex + 3] * alpha[pixelIndex]) / (255 * 255);
    output[rgbaIndex] = clampByte((rgba[rgbaIndex] * effectiveAlpha) + (255 * (1 - effectiveAlpha)));
    output[rgbaIndex + 1] = clampByte((rgba[rgbaIndex + 1] * effectiveAlpha) + (255 * (1 - effectiveAlpha)));
    output[rgbaIndex + 2] = clampByte((rgba[rgbaIndex + 2] * effectiveAlpha) + (255 * (1 - effectiveAlpha)));
    output[rgbaIndex + 3] = 255;
  }
  return output;
};

const escapeSvgText = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export const buildDiagnosticBannerSvg = () => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="128" viewBox="0 0 1440 128">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1d4ed8"/>
      </linearGradient>
    </defs>
    <rect width="1440" height="128" fill="url(#g)"/>
    <rect x="18" y="18" width="1404" height="92" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)"/>
    <text x="44" y="74" fill="#f8fafc" font-size="20" font-family="Arial, Helvetica, sans-serif" font-weight="700">${escapeSvgText(PRINTING_OFFLINE_MODEL_DIAGNOSTIC_BANNER_TEXT)}</text>
  </svg>`,
);

export const assertCanonicalManifestUnchanged = <T>(beforeDigest: string, after: Readonly<T>): void => {
  if (!/^[a-f0-9]{64}$/.test(beforeDigest)) {
    throw new Error('CANONICAL_MANIFEST_DIGEST_INVALID');
  }
  if (beforeDigest !== canonicalManifestDigest(after)) {
    throw new Error('CANONICAL_MANIFEST_CHANGED');
  }
};

export const buildCaseDigest = (caseResult: PrintingOfflineModelDiagnosticCaseResult) =>
  stableDigest({
    caseId: caseResult.caseId,
    label: caseResult.label,
    stratum: caseResult.stratum,
    rawPreHeaderSha256: caseResult.rawPreHeaderSha256,
    markedArtifactSha256: caseResult.markedArtifactSha256,
    outputSha256: caseResult.outputSha256,
    finite: caseResult.finite,
    outputMin: caseResult.outputMin,
    outputMax: caseResult.outputMax,
    outputBytes: caseResult.outputBytes,
  });

export const buildReadbackCase = (caseResult: PrintingOfflineModelDiagnosticCaseResult) => ({
  caseId: caseResult.caseId,
  label: caseResult.label,
  stratum: caseResult.stratum,
  rawPreHeaderSha256: caseResult.rawPreHeaderSha256,
  markedArtifactSha256: caseResult.markedArtifactSha256,
  outputSha256: caseResult.outputSha256,
  finite: caseResult.finite,
  outputMin: caseResult.outputMin,
  outputMax: caseResult.outputMax,
  outputBytes: caseResult.outputBytes,
  elapsedMs: caseResult.elapsedMs,
});

export const buildDiagnosticReportDigest = (report: unknown) => stableDigest(report);
