import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { sha256Hex } from './lib/printing-offline-model-diagnostic.ts';
import {
  realPhotoManifestDigest,
  type PrintingRealPhotoExecutionManifest,
  type PrintingRealPhotoManifestCase,
  type PrintingRealPhotoRiskTag,
} from './lib/printing-real-photo-diagnostic.ts';

const readArgument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`ARGUMENT_MISSING:${name}`);
  return process.argv[index + 1];
};

const riskTagsById: Readonly<Record<string, readonly PrintingRealPhotoRiskTag[]>> = Object.freeze({
  samue_001: ['two-piece', 'multiple-garments'],
  met_dress_front: ['drape'],
  auckland_sweater_top: ['texture'],
  egija_red_dress: ['on-model', 'drape', 'occlusion'],
  beige_crop_top_model: ['on-model', 'small-printable-area', 'frame-crop'],
  carole_lombard_satin: ['on-model', 'specular', 'reflective', 'drape'],
  pleated_skirt_tights: ['frame-crop', 'pleats', 'texture'],
  cable_knit_pullover: ['garment-detail', 'frame-crop', 'texture'],
  trouser_seam_closeup: ['extreme-crop', 'garment-detail', 'texture'],
  betty_ford_green_gown: ['specular', 'reflective', 'drape', 'texture'],
});

const expectedSafeOutcomeById: Readonly<Record<string, PrintingRealPhotoManifestCase['expectedSafeOutcome']>> = Object.freeze({
  samue_001: 'fallback-required',
  met_dress_front: 'manual-review-required',
  auckland_sweater_top: 'manual-review-required',
  egija_red_dress: 'manual-review-required',
  beige_crop_top_model: 'fallback-required',
  carole_lombard_satin: 'fallback-required',
  pleated_skirt_tights: 'fallback-required',
  cable_knit_pullover: 'fallback-required',
  trouser_seam_closeup: 'fallback-required',
  betty_ford_green_gown: 'fallback-required',
});

const assertContainedFile = async (root: string, candidate: string) => {
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return canonicalCandidate;
    throw new Error(`REAL_PHOTO_SOURCE_PATH_ESCAPE:${candidate}`);
  }
  return canonicalCandidate;
};

const imageEvidence = async (
  filePath: string,
  limits: Readonly<{ maxDimension: number; maxFileBytes: number }>,
) => {
  const bytes = await readFile(filePath);
  const metadata = await sharp(bytes, { limitInputPixels: limits.maxDimension * limits.maxDimension }).metadata();
  if (
    bytes.length > limits.maxFileBytes
    || !metadata.width
    || !metadata.height
    || metadata.width > limits.maxDimension
    || metadata.height > limits.maxDimension
  ) {
    throw new Error(`REAL_PHOTO_SOURCE_DIMENSIONS_INVALID:${filePath}`);
  }
  return { bytes: bytes.length, width: metadata.width, height: metadata.height, sha256: sha256Hex(bytes) };
};

const run = async () => {
  const sourceDirectory = await realpath(path.resolve(readArgument('--source-dir')));
  const sourcesPath = await assertContainedFile(sourceDirectory, path.join(sourceDirectory, 'sources.json'));
  const downloadReadbackPath = await assertContainedFile(sourceDirectory, path.join(sourceDirectory, 'download-readback.json'));
  const sourcesBytes = await readFile(sourcesPath);
  const downloadBytes = await readFile(downloadReadbackPath);
  const sources = JSON.parse(sourcesBytes.toString('utf8')) as {
    cases: Array<Record<string, unknown>>;
  };
  const download = JSON.parse(downloadBytes.toString('utf8')) as {
    requestedCaseCount: number;
    downloadedCaseCount: number;
    normalizedCaseCount: number;
    downloadedIds: string[];
    pending: Array<{ id: string; exactBlocker: string }>;
    digests: { sourcesManifestSha256: string };
  };
  if (
    download.requestedCaseCount !== 12
    || download.downloadedCaseCount !== 10
    || download.normalizedCaseCount !== 10
    || download.downloadedIds.length !== 10
    || download.pending.length !== 2
    || sha256Hex(sourcesBytes) !== download.digests.sourcesManifestSha256
  ) {
    throw new Error('REAL_PHOTO_SOURCING_READBACK_INVALID');
  }

  const sourceById = new Map(sources.cases.map((entry) => [String(entry.id), entry]));
  const cases: PrintingRealPhotoManifestCase[] = [];
  for (const id of download.downloadedIds) {
    const source = sourceById.get(id);
    const riskTags = riskTagsById[id];
    const expectedSafeOutcome = expectedSafeOutcomeById[id];
    if (!source || !riskTags || !expectedSafeOutcome) throw new Error(`REAL_PHOTO_CASE_METADATA_MISSING:${id}`);
    const fileName = String(source.fileName);
    const originalPath = await assertContainedFile(sourceDirectory, path.join(sourceDirectory, 'sources', fileName));
    const normalizedPath = await assertContainedFile(sourceDirectory, path.join(sourceDirectory, 'normalized', fileName));
    const [original, normalized] = await Promise.all([
      imageEvidence(originalPath, { maxDimension: 8192, maxFileBytes: 64 * 1024 * 1024 }),
      imageEvidence(normalizedPath, { maxDimension: 4096, maxFileBytes: 32 * 1024 * 1024 }),
    ]);
    cases.push(Object.freeze({
      id,
      label: String(source.challenge),
      category: String(source.category),
      view: String(source.view),
      challenge: String(source.challenge),
      pageUrl: String(source.pageUrl),
      author: String(source.author),
      license: String(source.license),
      normalizedPath,
      normalizedBytes: normalized.bytes,
      normalizedWidth: normalized.width,
      normalizedHeight: normalized.height,
      normalizedSha256: normalized.sha256,
      originalPath,
      originalBytes: original.bytes,
      originalWidth: original.width,
      originalHeight: original.height,
      originalSha256: original.sha256,
      riskTags,
      expectedSafeOutcome,
    }));
  }

  const manifest: PrintingRealPhotoExecutionManifest = Object.freeze({
    schemaVersion: 'printing-real-photo-execution-manifest-v1',
    status: 'immutable-input-snapshot',
    requestedCaseCount: 12,
    availableCaseCount: 10,
    sourceManifestPath: sourcesPath,
    sourceManifestSha256: sha256Hex(sourcesBytes),
    downloadReadbackPath,
    downloadReadbackSha256: sha256Hex(downloadBytes),
    pending: Object.freeze(download.pending.map((entry) => Object.freeze({ ...entry }))),
    cases: Object.freeze(cases),
  });
  const digest = realPhotoManifestDigest(manifest);
  const manifestPath = path.join(sourceDirectory, `real-photo-manifest-${digest}.json`);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    await writeFile(manifestPath, serialized, { flag: 'wx' });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    if (await readFile(manifestPath, 'utf8') !== serialized) throw new Error('REAL_PHOTO_MANIFEST_IMMUTABLE_CONFLICT');
  }
  const manifestStats = await stat(manifestPath);
  process.stdout.write(`${JSON.stringify({ manifestPath, manifestDigest: digest, manifestBytes: manifestStats.size, caseCount: cases.length }, null, 2)}\n`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
