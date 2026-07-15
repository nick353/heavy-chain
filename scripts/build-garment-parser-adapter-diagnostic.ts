import { mkdir, readFile, realpath, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import {
  prepareGarmentParserSurfaceProposal,
  type GarmentParserClassDefinition,
} from '../src/features/printing/surface/garmentParserSurfaceAdapter.ts';
import {
  assertOutputPathContained,
  sha256Hex,
  stableDigest,
  validateContainedPathCandidate,
} from './lib/printing-offline-model-diagnostic.ts';

const CLASS_NAMES = [
  'background', 'face', 'hair', 'top', 'dress', 'skirt', 'pants', 'belt', 'bag',
  'hat', 'scarf', 'glasses', 'arms', 'hands', 'legs', 'feet', 'torso', 'jewelry',
] as const;
const GARMENT_IDS = new Set([3, 4, 5, 6, 7, 10]);
const OCCLUDER_IDS = new Set([1, 2, 8, 9, 11, 12, 13, 14, 15, 16, 17]);
const CLASSES: readonly GarmentParserClassDefinition[] = Object.freeze(
  CLASS_NAMES.map((label, id) => Object.freeze({
    id,
    label,
    role: GARMENT_IDS.has(id) ? 'garment' as const : OCCLUDER_IDS.has(id) ? 'occluder' as const : 'ignore' as const,
  })),
);

const readArgument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`ARGUMENT_MISSING:${name}`);
  return process.argv[index + 1];
};

const serializeWithActualTotal = (base: Record<string, unknown>) => {
  let totalOutputBytes = 0;
  let serialized = Buffer.alloc(0);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    serialized = Buffer.from(`${JSON.stringify({ ...base, totalOutputBytes }, null, 2)}\n`);
    if (serialized.length === totalOutputBytes) return { serialized, totalOutputBytes };
    totalOutputBytes = serialized.length;
  }
  throw new Error('ADAPTER_DIAGNOSTIC_TOTAL_BYTES_DID_NOT_STABILIZE');
};

const run = async () => {
  const parserEvalRoot = await realpath(path.resolve(readArgument('--parser-eval')));
  const manifestPath = await realpath(path.resolve(readArgument('--manifest')));
  const outputRequested = path.resolve(readArgument('--output'));
  const allowedOutputRoot = path.dirname(outputRequested);
  const outputDirectory = await assertOutputPathContained(allowedOutputRoot, outputRequested);
  try {
    await stat(outputDirectory);
    throw new Error('ADAPTER_DIAGNOSTIC_OUTPUT_EXISTS');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const stagingDirectory = await assertOutputPathContained(
    allowedOutputRoot,
    `${outputDirectory}.staging-${process.pid}-${Date.now()}`,
  );
  const parserReadbackPath = validateContainedPathCandidate(
    parserEvalRoot,
    path.join(parserEvalRoot, 'readback.json'),
    await realpath(path.join(parserEvalRoot, 'readback.json')),
  );
  const parserReadbackBytes = await readFile(parserReadbackPath);
  const parserReadback = JSON.parse(parserReadbackBytes.toString('utf8')) as {
    status: string;
    modelId: string;
    revision: string;
    modelBytes: number;
    modelSha256: string;
    browserParity: boolean;
    productionIntegrated: boolean;
    licenseReviewRequired: boolean;
    userApproval: boolean;
    caseCount: number;
    cases: Array<{ id: string; width: number; height: number }>;
  };
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    availableCaseCount: number;
    cases: Array<{ id: string; normalizedWidth: number; normalizedHeight: number }>;
  };
  if (
    parserReadback.status !== 'all-10-technical-spike'
    || parserReadback.browserParity !== false
    || parserReadback.productionIntegrated !== false
    || parserReadback.licenseReviewRequired !== true
    || parserReadback.userApproval !== false
    || parserReadback.caseCount !== 10
    || manifest.availableCaseCount !== 10
    || manifest.cases.length !== 10
  ) {
    throw new Error('PARSER_TECHNICAL_SPIKE_READBACK_INVALID');
  }
  const parserCaseById = new Map(parserReadback.cases.map((entry) => [entry.id, entry]));
  const cases: Array<Record<string, unknown>> = [];
  for (const manifestCase of manifest.cases) {
    const parserCase = parserCaseById.get(manifestCase.id);
    if (
      !parserCase
      || parserCase.width !== manifestCase.normalizedWidth
      || parserCase.height !== manifestCase.normalizedHeight
    ) {
      throw new Error(`PARSER_CASE_DIMENSIONS_MISMATCH:${manifestCase.id}`);
    }
    const labelCandidate = path.join(parserEvalRoot, `${manifestCase.id}-labels.png`);
    const labelPath = validateContainedPathCandidate(parserEvalRoot, labelCandidate, await realpath(labelCandidate));
    const labelBytes = await readFile(labelPath);
    const decoded = await sharp(labelBytes, { limitInputPixels: 16_000_000 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width !== manifestCase.normalizedWidth
      || decoded.info.height !== manifestCase.normalizedHeight
      || decoded.info.channels !== 1
    ) {
      throw new Error(`PARSER_LABEL_RASTER_INVALID:${manifestCase.id}`);
    }
    const labels = new Uint8Array(decoded.data);
    for (const label of labels) {
      if (label >= CLASS_NAMES.length) throw new Error(`PARSER_LABEL_CLASS_INVALID:${manifestCase.id}`);
    }
    const proposal = prepareGarmentParserSurfaceProposal({
      width: decoded.info.width,
      height: decoded.info.height,
      labels,
      classes: CLASSES,
    });
    cases.push(Object.freeze({
      id: manifestCase.id,
      labelPath,
      labelBytes: labelBytes.length,
      labelSha256: sha256Hex(labelBytes),
      kind: proposal.kind,
      reason: proposal.kind === 'fallback-required' ? proposal.reason : null,
      candidates: proposal.candidates,
      selected: proposal.kind === 'success' ? proposal.selected : null,
      confidence: proposal.kind === 'success' ? proposal.confidence : null,
      printablePixels: proposal.kind === 'success' ? proposal.suggestionDiagnostics.printablePixels : 0,
    }));
  }
  const successCount = cases.filter((entry) => entry.kind === 'success').length;
  const selectionRequiredCount = cases.filter((entry) => entry.kind === 'selection-required').length;
  const fallbackRequiredCount = cases.filter((entry) => entry.kind === 'fallback-required').length;
  const caseDigest = stableDigest(cases);
  const readbackBase = {
    schemaVersion: 'garment-parser-surface-adapter-diagnostic-v1',
    status: 'diagnostic-complete',
    generatedAt: new Date().toISOString(),
    parserModelId: parserReadback.modelId,
    parserRevision: parserReadback.revision,
    parserModelBytes: parserReadback.modelBytes,
    parserModelSha256: parserReadback.modelSha256,
    parserReadbackPath,
    parserReadbackSha256: sha256Hex(parserReadbackBytes),
    manifestPath,
    manifestSha256: sha256Hex(manifestBytes),
    caseCount: cases.length,
    successCount,
    selectionRequiredCount,
    fallbackRequiredCount,
    caseDigest,
    browserParity: false,
    productionIntegrated: false,
    licenseReviewRequired: true,
    userApproval: false,
    exactModeChanged: false,
    manualFallbackPreserved: true,
    cases,
    notice: 'Technical adapter diagnostic only. Parser model is not bundled or production-integrated.',
  };
  const output = serializeWithActualTotal(readbackBase);
  await mkdir(stagingDirectory);
  try {
    await writeFile(path.join(stagingDirectory, 'readback.json'), output.serialized, { flag: 'wx' });
    if (JSON.stringify(await readdir(stagingDirectory)) !== JSON.stringify(['readback.json'])) {
      throw new Error('ADAPTER_DIAGNOSTIC_OUTPUT_ALLOWLIST_MISMATCH');
    }
    if ((await stat(path.join(stagingDirectory, 'readback.json'))).size !== output.totalOutputBytes) {
      throw new Error('ADAPTER_DIAGNOSTIC_TOTAL_BYTES_MISMATCH');
    }
    await rename(stagingDirectory, outputDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(output.serialized.toString('utf8'));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
