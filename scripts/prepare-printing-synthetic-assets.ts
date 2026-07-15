import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { PrintingApprovalManifest } from '../src/features/printing/quality/printingApprovalSchema.ts';

const repositoryRoot = process.cwd();
const benchmarkRoot = path.join(repositoryRoot, 'benchmarks/printing-approval-v1');
const assetRoot = path.join(benchmarkRoot, 'assets');
const manifest = JSON.parse(await readFile(path.join(benchmarkRoot, 'manifest.json'), 'utf8')) as PrintingApprovalManifest;

const exists = async (target: string) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const paletteFor = (id: string) => {
  const digest = createHash('sha256').update(id).digest();
  const hue = digest[0] % 360;
  return {
    primary: `hsl(${hue} 78% 48%)`,
    secondary: `hsl(${(hue + 145) % 360} 76% 44%)`,
    accent: `hsl(${(hue + 286) % 360} 88% 54%)`,
  };
};

const artworkSvg = (id: string) => {
  const palette = paletteFor(id);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="400" cy="400" r="286" stroke="${palette.primary}" stroke-width="54"/>
      <path d="M170 510 C270 190 530 190 630 510" stroke="${palette.secondary}" stroke-width="64"/>
      <path d="M220 545 L400 250 L580 545 Z" stroke="${palette.accent}" stroke-width="34"/>
      <circle cx="400" cy="400" r="74" fill="${palette.primary}" stroke="white" stroke-width="18"/>
    </g>
    <text x="400" y="690" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" letter-spacing="5" fill="${palette.secondary}">HC ${id}</text>
  </svg>`);
};

const xmlEscape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const prepared: string[] = [];
const missing: string[] = [];
for (const candidate of manifest.cases) {
  const directory = path.join(assetRoot, candidate.id.slice(0, 5));
  const sourcePath = path.join(directory, 'garment-source.png');
  if (!(await exists(sourcePath))) {
    missing.push(candidate.id);
    continue;
  }
  await mkdir(directory, { recursive: true });
  const metadata = await sharp(sourcePath, { failOn: 'error', limitInputPixels: 4096 * 4096 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`SYNTHETIC_SOURCE_DIMENSIONS_MISSING:${candidate.id}`);
  await sharp(sourcePath, { failOn: 'error', limitInputPixels: 4096 * 4096 })
    .resize({ width: 720, height: 900, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(path.join(directory, 'garment-preview.png'));
  await sharp(artworkSvg(candidate.id), { density: 144 })
    .resize(800, 800, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(directory, 'artwork.png'));
  prepared.push(candidate.id);
}

const contactSheetPath = path.join(benchmarkRoot, 'synthetic-input-contact-sheet.jpg');
if (prepared.length > 0) {
  const columns = 4;
  const tileWidth = 320;
  const tileHeight = 370;
  const rows = Math.ceil(manifest.cases.length / columns);
  const composites: sharp.OverlayOptions[] = [];
  for (const [index, candidate] of manifest.cases.entries()) {
    const directory = path.join(assetRoot, candidate.id.slice(0, 5));
    const previewPath = path.join(directory, 'garment-preview.png');
    const left = (index % columns) * tileWidth;
    const top = Math.floor(index / columns) * tileHeight;
    const preview = (await exists(previewPath))
      ? await sharp(previewPath)
          .resize({ width: 300, height: 300, fit: 'contain', background: '#f4f4f5' })
          .extend({ top: 0, bottom: 0, left: 0, right: 0, background: '#f4f4f5' })
          .png()
          .toBuffer()
      : await sharp({ create: { width: 300, height: 300, channels: 3, background: '#e4e4e7' } }).png().toBuffer();
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="50">
      <rect width="300" height="50" fill="#ffffff"/>
      <text x="8" y="19" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#18181b">${xmlEscape(candidate.id.slice(0, 5))}</text>
      <text x="8" y="39" font-family="Arial, sans-serif" font-size="13" fill="#52525b">${xmlEscape(candidate.label.slice(0, 36))}</text>
    </svg>`);
    composites.push({ input: preview, left: left + 10, top: top + 10 });
    composites.push({ input: label, left: left + 10, top: top + 310 });
  }
  await sharp({ create: { width: columns * tileWidth, height: rows * tileHeight, channels: 3, background: '#d4d4d8' } })
    .composite(composites)
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toFile(contactSheetPath);
}

const summary = {
  schemaVersion: 'printing-synthetic-assets-v1',
  generatedAt: new Date().toISOString(),
  prepared,
  missing,
  contactSheetPath,
  note: 'Synthetic imagegen inputs are development fixtures and do not replace real-photo or user quality approval.',
};
await writeFile(path.join(benchmarkRoot, 'synthetic-assets-readback.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
