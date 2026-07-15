import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import {
  PRINTING_APPROVAL_SCHEMA_VERSION,
  sortPrintingApprovalIssues,
  stableCanonicalJson,
  validatePrintingApprovalManifest,
  type PrintingApprovalAssets,
  type PrintingApprovalCase,
  type PrintingApprovalIssue,
  type PrintingApprovalManifest,
} from '../../src/features/printing/quality/printingApprovalSchema.ts';

export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type ImageMetadata = { format: ImageFormat; width: number; height: number };
export type ApprovalAssetEvidence = ImageMetadata & {
  caseId: string;
  role: keyof PrintingApprovalAssets;
  uri: string;
  absolutePath: string;
  sha256: string;
  bytes: number;
};

export type ApprovalDecision = {
  schemaVersion: typeof PRINTING_APPROVAL_SCHEMA_VERSION;
  manifestDigest: string;
  evidenceCoreDigest: string;
  decision: 'approved' | 'rejected';
  decidedAt: string;
};

export type PrintingApprovalReport = {
  schemaVersion: typeof PRINTING_APPROVAL_SCHEMA_VERSION;
  generatedAt: string;
  manifestPath: string;
  outputDirectory: string;
  manifestDigest: string;
  assetEvidence: ApprovalAssetEvidence[];
  invalidIssues: PrintingApprovalIssue[];
  incompleteIssues: PrintingApprovalIssue[];
  qualityFailures: PrintingApprovalIssue[];
  evidenceValid: boolean;
  evidenceComplete: boolean;
  qualityGatePassed: boolean;
  readyForUserApproval: boolean;
  evidenceCoreDigest: string;
  checkpointApproval: 'pending' | 'approved' | 'rejected';
  decisionIssue: string | null;
  reportEnvelopeDigest: string;
  cases: PrintingApprovalCase[];
};

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const isInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const readUint24LE = (buffer: Buffer, offset: number) =>
  buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);

export const parseImageMetadata = (buffer: Buffer): ImageMetadata => {
  let metadata: ImageMetadata | null = null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (buffer.length < 33) throw new Error('PNG_TRUNCATED');
    if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG_IHDR_INVALID');
    metadata = { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) break;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) throw new Error('JPEG_TRUNCATED');
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) throw new Error('JPEG_TRUNCATED');
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (length < 7) throw new Error('JPEG_SOF_INVALID');
        metadata = { format: 'jpeg', height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
        break;
      }
      offset += length;
    }
    if (!metadata) throw new Error('JPEG_SOF_MISSING');
  } else if (
    buffer.length >= 20 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const declaredLength = buffer.readUInt32LE(4) + 8;
    if (declaredLength > buffer.length) throw new Error('WEBP_TRUNCATED');
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      if (buffer.length < 30 || buffer.readUInt32LE(16) < 10) throw new Error('WEBP_VP8X_TRUNCATED');
      metadata = { format: 'webp', width: readUint24LE(buffer, 24) + 1, height: readUint24LE(buffer, 27) + 1 };
    } else if (chunk === 'VP8L') {
      if (buffer.length < 25 || buffer[20] !== 0x2f) throw new Error('WEBP_VP8L_TRUNCATED');
      const bits = buffer.readUInt32LE(21);
      metadata = { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (chunk === 'VP8 ') {
      if (buffer.length < 30 || buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
        throw new Error('WEBP_VP8_TRUNCATED');
      }
      metadata = {
        format: 'webp',
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    } else {
      throw new Error('WEBP_CHUNK_UNSUPPORTED');
    }
  }
  if (!metadata) throw new Error('IMAGE_FORMAT_UNSUPPORTED');
  if (metadata.width <= 0 || metadata.height <= 0) throw new Error('IMAGE_DIMENSIONS_INVALID');
  return metadata;
};

export const decodeImageMetadata = async (buffer: Buffer, pixelLimit = 16_777_216): Promise<ImageMetadata> => {
  const detected = parseImageMetadata(buffer);
  const { data, info } = await sharp(buffer, {
    failOn: 'error',
    limitInputPixels: pixelLimit,
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data.length === 0 || info.width !== detected.width || info.height !== detected.height) {
    throw new Error('IMAGE_DECODE_DIMENSIONS_MISMATCH');
  }
  return detected;
};

const expectedFormatForExtension = (uri: string): ImageFormat | null => {
  switch (path.extname(uri).toLowerCase()) {
    case '.png':
      return 'png';
    case '.jpg':
    case '.jpeg':
      return 'jpeg';
    case '.webp':
      return 'webp';
    default:
      return null;
  }
};

const roleLimits: Record<keyof PrintingApprovalAssets, { width: number; height: number; bytes: number }> = {
  garmentSource: { width: 4096, height: 4096, bytes: 32 * 1024 * 1024 },
  garmentPreview: { width: 720, height: 900, bytes: 2 * 1024 * 1024 },
  artwork: { width: 4096, height: 4096, bytes: 32 * 1024 * 1024 },
  result: { width: 1440, height: 1800, bytes: 16 * 1024 * 1024 },
};

const assetIssue = (
  code: string,
  message: string,
  caseId: string,
  assetRole: keyof PrintingApprovalAssets,
): PrintingApprovalIssue => ({ code, message, caseId, assetRole });

const collectAssetEvidence = async (
  manifest: PrintingApprovalManifest,
  manifestPath: string,
  invalidIssues: PrintingApprovalIssue[],
  incompleteIssues: PrintingApprovalIssue[],
) => {
  const evidence: ApprovalAssetEvidence[] = [];
  const assetRoot = path.resolve(path.dirname(manifestPath), 'assets');
  let assetRootReal: string | null = null;
  try {
    assetRootReal = await realpath(assetRoot);
  } catch {
    // Missing root is represented by per-asset incomplete issues.
  }
  for (const candidate of manifest.cases) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || !candidate.assets || typeof candidate.assets !== 'object') {
      continue;
    }
    for (const role of ['garmentSource', 'garmentPreview', 'artwork', 'result'] as const) {
      const uri = candidate.assets?.[role];
      if (uri === null || uri === undefined || uri === '') {
        if (role !== 'result') incompleteIssues.push(assetIssue('ASSET_MISSING', 'required asset URI is missing', candidate.id, role));
        continue;
      }
      if (typeof uri !== 'string') continue;
      if (path.isAbsolute(uri)) {
        invalidIssues.push(assetIssue('ASSET_PATH_ABSOLUTE', 'asset URI must be relative', candidate.id, role));
        continue;
      }
      const absolutePath = path.resolve(assetRoot, uri);
      if (!isInside(assetRoot, absolutePath)) {
        invalidIssues.push(assetIssue('ASSET_PATH_TRAVERSAL', 'asset URI escapes the asset root', candidate.id, role));
        continue;
      }
      let fileReal: string;
      try {
        const fileStat = await lstat(absolutePath);
        if (!fileStat.isFile() && !fileStat.isSymbolicLink()) throw new Error('not-file');
        fileReal = await realpath(absolutePath);
      } catch {
        incompleteIssues.push(assetIssue('ASSET_FILE_MISSING', `asset file is missing: ${uri}`, candidate.id, role));
        continue;
      }
      if (!assetRootReal || !isInside(assetRootReal, fileReal)) {
        invalidIssues.push(assetIssue('ASSET_SYMLINK_ESCAPE', 'asset realpath escapes the asset root', candidate.id, role));
        continue;
      }
      try {
        const fileInfo = await stat(fileReal);
        const limits = roleLimits[role];
        if (fileInfo.size > limits.bytes) {
          invalidIssues.push(assetIssue('ASSET_LIMIT_EXCEEDED', `${role} exceeds its byte limit`, candidate.id, role));
          continue;
        }
        const fileBytes = await readFile(fileReal);
        const metadata = await decodeImageMetadata(fileBytes, limits.width * limits.height);
        const expectedFormat = expectedFormatForExtension(uri);
        if (!expectedFormat || expectedFormat !== metadata.format) {
          invalidIssues.push(assetIssue('ASSET_FORMAT_MISMATCH', 'image magic does not match the supported file extension', candidate.id, role));
          continue;
        }
        if (metadata.width > limits.width || metadata.height > limits.height) {
          invalidIssues.push(assetIssue('ASSET_LIMIT_EXCEEDED', `${role} exceeds its dimension limit`, candidate.id, role));
          continue;
        }
        evidence.push({
          caseId: candidate.id,
          role,
          uri,
          absolutePath: fileReal,
          sha256: sha256(fileBytes),
          bytes: fileInfo.size,
          ...metadata,
        });
      } catch (error) {
        invalidIssues.push(
          assetIssue('ASSET_IMAGE_INVALID', error instanceof Error ? error.message : 'image is invalid', candidate.id, role),
        );
      }
    }
  }
  return evidence.sort((left, right) => `${left.caseId}\u0000${left.role}`.localeCompare(`${right.caseId}\u0000${right.role}`));
};

export const validateApprovalAggregateLimits = (evidence: ApprovalAssetEvidence[], invalidIssues: PrintingApprovalIssue[]) => {
  const allBytes = evidence.reduce((sum, asset) => sum + asset.bytes, 0);
  const previews = evidence.filter((asset) => asset.role === 'garmentPreview');
  const results = evidence.filter((asset) => asset.role === 'result');
  const previewPixels = previews.reduce((sum, asset) => sum + asset.width * asset.height, 0);
  const previewBytes = previews.reduce((sum, asset) => sum + asset.bytes, 0);
  const resultPixels = results.reduce((sum, asset) => sum + asset.width * asset.height, 0);
  const resultBytes = results.reduce((sum, asset) => sum + asset.bytes, 0);
  if (allBytes > 256 * 1024 * 1024) invalidIssues.push({ code: 'ASSET_AGGREGATE_BYTES_EXCEEDED', message: 'all assets exceed 256 MiB' });
  if (previewPixels > 15_552_000 || previewBytes > 48 * 1024 * 1024) {
    invalidIssues.push({ code: 'PREVIEW_AGGREGATE_LIMIT_EXCEEDED', message: 'garment previews exceed the aggregate display budget' });
  }
  if (resultPixels > 62_208_000 || resultBytes > 96 * 1024 * 1024) {
    invalidIssues.push({ code: 'RESULT_AGGREGATE_LIMIT_EXCEEDED', message: 'results exceed the aggregate display budget' });
  }
};

const coreAssetEvidence = (asset: ApprovalAssetEvidence) => ({
  caseId: asset.caseId,
  role: asset.role,
  uri: asset.uri,
  sha256: asset.sha256,
  bytes: asset.bytes,
  format: asset.format,
  width: asset.width,
  height: asset.height,
});

const buildEvidenceCore = (report: Omit<PrintingApprovalReport, 'evidenceCoreDigest' | 'checkpointApproval' | 'decisionIssue' | 'reportEnvelopeDigest'>) => ({
  schemaVersion: report.schemaVersion,
  manifestDigest: report.manifestDigest,
  assetEvidence: report.assetEvidence.map(coreAssetEvidence),
  cases: [...report.cases].sort((left, right) => left.id.localeCompare(right.id)).map((candidate) => ({
    id: candidate.id,
    expectedDisposition: candidate.expectedDisposition,
    observedDisposition: candidate.observedDisposition,
    observedReasonCode: candidate.observedReasonCode,
    surfaceProvenance: candidate.surfaceProvenance,
    resultMode: candidate.resultMode,
    scores: candidate.scores,
    reviewStatus: candidate.reviewStatus,
    criticalFailures: Array.isArray(candidate.criticalFailures)
      ? [...candidate.criticalFailures].sort((left, right) =>
          `${left && typeof left === 'object' ? left.code : ''}\u0000${left && typeof left === 'object' ? left.detail ?? '' : ''}`.localeCompare(
            `${right && typeof right === 'object' ? right.code : ''}\u0000${right && typeof right === 'object' ? right.detail ?? '' : ''}`,
          ),
        )
      : candidate.criticalFailures,
  })),
  invalidIssues: report.invalidIssues,
  incompleteIssues: report.incompleteIssues,
  qualityFailures: report.qualityFailures,
  evidenceValid: report.evidenceValid,
  evidenceComplete: report.evidenceComplete,
  qualityGatePassed: report.qualityGatePassed,
  readyForUserApproval: report.readyForUserApproval,
});

const readDecision = async (decisionPath: string | undefined): Promise<ApprovalDecision | null> => {
  if (!decisionPath) return null;
  return JSON.parse(await readFile(decisionPath, 'utf8')) as ApprovalDecision;
};

export const buildPrintingApprovalReport = async (options: {
  manifestPath: string;
  outputDirectory: string;
  decisionPath?: string;
  generatedAt?: string;
}): Promise<PrintingApprovalReport> => {
  const manifestPath = path.resolve(options.manifestPath);
  const manifestBytes = await readFile(manifestPath);
  const parsed = JSON.parse(manifestBytes.toString('utf8')) as unknown;
  const { manifest, validation } = validatePrintingApprovalManifest(parsed);
  const manifestCases = manifest && Array.isArray(manifest.cases) ? manifest.cases : [];
  const cases = manifestCases.filter(
    (candidate): candidate is PrintingApprovalCase =>
      Boolean(
        candidate &&
          typeof candidate === 'object' &&
          typeof candidate.id === 'string' &&
          candidate.assets &&
          typeof candidate.assets === 'object',
      ),
  );
  const assetEvidence = manifest && Array.isArray(manifest.cases)
    ? await collectAssetEvidence(manifest, manifestPath, validation.invalidIssues, validation.incompleteIssues)
    : [];
  validateApprovalAggregateLimits(assetEvidence, validation.invalidIssues);
  validation.invalidIssues = sortPrintingApprovalIssues(validation.invalidIssues);
  validation.incompleteIssues = sortPrintingApprovalIssues(validation.incompleteIssues);
  validation.qualityFailures = sortPrintingApprovalIssues(validation.qualityFailures);
  const evidenceValid = validation.invalidIssues.length === 0;
  const evidenceComplete = evidenceValid && validation.incompleteIssues.length === 0;
  const qualityGatePassed = evidenceComplete && validation.qualityFailures.length === 0;
  const readyForUserApproval = qualityGatePassed;
  const base = {
    schemaVersion: PRINTING_APPROVAL_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    manifestPath,
    outputDirectory: path.resolve(options.outputDirectory),
    manifestDigest: sha256(manifestBytes),
    assetEvidence,
    invalidIssues: validation.invalidIssues,
    incompleteIssues: validation.incompleteIssues,
    qualityFailures: validation.qualityFailures,
    evidenceValid,
    evidenceComplete,
    qualityGatePassed,
    readyForUserApproval,
    cases,
  };
  const evidenceCoreDigest = sha256(stableCanonicalJson(buildEvidenceCore(base)));
  let checkpointApproval: PrintingApprovalReport['checkpointApproval'] = 'pending';
  let decisionIssue: string | null = null;
  try {
    const decision = await readDecision(options.decisionPath);
    if (decision) {
      if (
        decision.schemaVersion !== PRINTING_APPROVAL_SCHEMA_VERSION ||
        decision.manifestDigest !== base.manifestDigest ||
        decision.evidenceCoreDigest !== evidenceCoreDigest ||
        !new Set(['approved', 'rejected']).has(decision.decision) ||
        Number.isNaN(Date.parse(decision.decidedAt))
      ) {
        decisionIssue = 'DECISION_BINDING_INVALID';
      } else if (!readyForUserApproval && decision.decision === 'approved') {
        decisionIssue = 'DECISION_APPROVAL_NOT_READY';
      } else {
        checkpointApproval = decision.decision;
      }
    }
  } catch {
    decisionIssue = 'DECISION_FILE_INVALID';
  }
  const withoutEnvelope = { ...base, evidenceCoreDigest, checkpointApproval, decisionIssue };
  const reportEnvelopeDigest = sha256(stableCanonicalJson(withoutEnvelope));
  return { ...withoutEnvelope, reportEnvelopeDigest };
};

const htmlEscape = (value: unknown) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const encodeRelativeHref = (fromDirectory: string, absolutePath: string) =>
  path
    .relative(fromDirectory, absolutePath)
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export const renderPrintingApprovalHtml = (report: PrintingApprovalReport) => {
  const byCaseRole = new Map(report.assetEvidence.map((asset) => [`${asset.caseId}\u0000${asset.role}`, asset]));
  const card = (candidate: PrintingApprovalCase) => {
    const preview = byCaseRole.get(`${candidate.id}\u0000garmentPreview`);
    const result = byCaseRole.get(`${candidate.id}\u0000result`);
    const source = byCaseRole.get(`${candidate.id}\u0000garmentSource`);
    const artwork = byCaseRole.get(`${candidate.id}\u0000artwork`);
    const image = (asset: ApprovalAssetEvidence | undefined, label: string) =>
      asset
        ? `<figure><img loading="lazy" decoding="async" src="${htmlEscape(encodeRelativeHref(report.outputDirectory, asset.absolutePath))}" alt="${htmlEscape(`${candidate.label} ${label}`)}"><figcaption>${htmlEscape(label)} · ${asset.width}×${asset.height} · ${htmlEscape(asset.sha256.slice(0, 12))}</figcaption></figure>`
        : `<figure class="missing"><div>${htmlEscape(label)} missing</div></figure>`;
    const metadataLink = (asset: ApprovalAssetEvidence | undefined, label: string) =>
      asset
        ? `<a href="${htmlEscape(encodeRelativeHref(report.outputDirectory, asset.absolutePath))}">${htmlEscape(label)} ${asset.width}×${asset.height} ${asset.sha256.slice(0, 12)}</a>`
        : `<span>${htmlEscape(label)} missing</span>`;
    return `<article>
      <h2>${htmlEscape(candidate.id)} · ${htmlEscape(candidate.label)}</h2>
      <div class="images">${image(preview, 'input preview')}${result ? image(result, 'result') : ''}</div>
      <p><b>expected:</b> ${htmlEscape(candidate.expectedDisposition)} · <b>observed:</b> ${htmlEscape(candidate.observedDisposition)} · <b>reason:</b> ${htmlEscape(candidate.observedReasonCode ?? 'none')}</p>
      <p>${metadataLink(source, 'source')} · ${metadataLink(artwork, 'artwork')}</p>
      <p><b>review:</b> ${htmlEscape(candidate.reviewStatus)} · <b>scores:</b> ${htmlEscape(candidate.scores ? JSON.stringify(candidate.scores) : 'not-applicable')}</p>
    </article>`;
  };
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Heavy Chain printing approval pack</title><style>
  body{font-family:system-ui,sans-serif;margin:24px;background:#f4f4f5;color:#18181b}header{background:white;padding:20px;border-radius:12px;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}article{background:white;padding:16px;border-radius:12px}.images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}figure{margin:0;min-height:160px;background:#e4e4e7;display:grid;place-items:center}img{display:block;width:100%;height:260px;object-fit:contain}figcaption{font-size:12px;padding:6px}.missing{color:#a1a1aa}code{overflow-wrap:anywhere}.bad{color:#b91c1c}.good{color:#047857}</style></head><body>
  <header><h1>Heavy Chain printing approval checkpoint 1</h1><p>Evidence valid: <b>${report.evidenceValid}</b> · complete: <b>${report.evidenceComplete}</b> · quality gate: <b>${report.qualityGatePassed}</b> · ready for user approval: <b>${report.readyForUserApproval}</b> · checkpoint: <b>${report.checkpointApproval}</b></p><p>Invalid ${report.invalidIssues.length} · incomplete ${report.incompleteIssues.length} · quality failures ${report.qualityFailures.length}</p><p><code>manifest ${htmlEscape(report.manifestDigest)}</code><br><code>evidence ${htmlEscape(report.evidenceCoreDigest)}</code></p></header>
  <main class="grid">${report.cases.map(card).join('')}</main></body></html>`;
};

export const writePrintingApprovalPack = async (report: PrintingApprovalReport) => {
  await mkdir(report.outputDirectory, { recursive: true });
  const jsonPath = path.join(report.outputDirectory, 'report.json');
  const htmlPath = path.join(report.outputDirectory, 'contact-sheet.html');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, renderPrintingApprovalHtml(report), 'utf8');
  return { jsonPath, htmlPath };
};
