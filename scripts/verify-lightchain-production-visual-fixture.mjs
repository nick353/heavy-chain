#!/usr/bin/env node

/**
 * Compare two supplied PNG captures mechanically.
 *
 * This comparator cannot establish source authenticity, capture provenance,
 * semantic equivalence, or Light/Heavy provider parity. It only compares the
 * decoded pixels in the two local files named by the caller.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SCHEMA = 'lightchain-production-visual-fixture-comparison.v1';
const NO_CLAIM_STATEMENT =
  'This result is only a mechanical comparison of the supplied local captures; it does not establish source authenticity or provider parity.';

function fail(message) {
  throw new Error(message);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterRows(raw, width, height, bytesPerPixel, rowBytes) {
  const expected = height * (rowBytes + 1);
  if (raw.length !== expected) {
    fail(`PNG scanline length mismatch: expected ${expected}, got ${raw.length}`);
  }

  const rows = Buffer.alloc(height * rowBytes);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const rowOffset = y * rowBytes;
    const previousOffset = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = raw[sourceOffset++];
      const left = x >= bytesPerPixel ? rows[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? rows[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? rows[previousOffset + x - bytesPerPixel]
        : 0;
      let value;
      switch (filter) {
        case 0:
          value = encoded;
          break;
        case 1:
          value = (encoded + left) & 0xff;
          break;
        case 2:
          value = (encoded + above) & 0xff;
          break;
        case 3:
          value = (encoded + Math.floor((left + above) / 2)) & 0xff;
          break;
        case 4:
          value = (encoded + paeth(left, above, upperLeft)) & 0xff;
          break;
        default:
          fail(`Unsupported PNG filter type: ${filter}`);
      }
      rows[rowOffset + x] = value;
    }
  }
  return rows;
}

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail('Input is not a PNG');
  }

  let offset = 8;
  let header;
  const idat = [];
  let sawIend = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) fail('Truncated PNG chunk');
    const length = readUInt32(buffer, offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + length;
    if (chunkEnd + 4 > buffer.length) fail(`Truncated PNG ${type} chunk`);
    const data = buffer.subarray(chunkStart, chunkEnd);
    const expectedCrc = readUInt32(buffer, chunkEnd);
    const actualCrc = crc32(buffer.subarray(offset + 4, chunkEnd));
    if (expectedCrc !== actualCrc) fail(`PNG ${type} CRC mismatch`);

    if (type === 'IHDR') {
      if (header || length !== 13) fail('Invalid PNG IHDR');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) fail('Invalid PNG IEND');
      sawIend = true;
      offset = chunkEnd + 4;
      break;
    }
    offset = chunkEnd + 4;
  }

  if (!header || !sawIend || idat.length === 0) fail('PNG is missing required chunks');
  if (header.width === 0 || header.height === 0) fail('PNG dimensions must be positive');
  if (header.bitDepth !== 8 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    fail('Only non-interlaced 8-bit PNGs are supported');
  }

  const channelCount = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  if (!channelCount) fail(`Unsupported PNG color type: ${header.colorType}`);
  const bytesPerPixel = channelCount;
  const rowBytes = header.width * bytesPerPixel;
  if (!Number.isSafeInteger(rowBytes) || rowBytes <= 0 || header.height > Math.floor(Number.MAX_SAFE_INTEGER / rowBytes)) {
    fail('PNG dimensions are too large');
  }

  const scanlines = unfilterRows(inflateSync(Buffer.concat(idat)), header.width, header.height, bytesPerPixel, rowBytes);
  const rgba = Buffer.alloc(header.width * header.height * 4);
  let outputOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const rowOffset = y * rowBytes;
    for (let x = 0; x < header.width; x += 1) {
      const inputOffset = rowOffset + x * bytesPerPixel;
      if (header.colorType === 6) {
        scanlines.copy(rgba, outputOffset, inputOffset, inputOffset + 4);
      } else if (header.colorType === 2) {
        scanlines.copy(rgba, outputOffset, inputOffset, inputOffset + 3);
        rgba[outputOffset + 3] = 255;
      } else if (header.colorType === 4) {
        rgba[outputOffset] = scanlines[inputOffset];
        rgba[outputOffset + 1] = scanlines[inputOffset];
        rgba[outputOffset + 2] = scanlines[inputOffset];
        rgba[outputOffset + 3] = scanlines[inputOffset + 1];
      } else {
        rgba[outputOffset] = scanlines[inputOffset];
        rgba[outputOffset + 1] = scanlines[inputOffset];
        rgba[outputOffset + 2] = scanlines[inputOffset];
        rgba[outputOffset + 3] = 255;
      }
      outputOffset += 4;
    }
  }
  return { width: header.width, height: header.height, rgba };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function comparePngBuffers(sourceBuffer, heavyBuffer, paths = {}, threshold = 0) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    fail('Threshold must be a finite number between 0 and 1');
  }
  const source = decodePng(sourceBuffer);
  const heavy = decodePng(heavyBuffer);
  const dimensions = {
    source: { width: source.width, height: source.height },
    heavy: { width: heavy.width, height: heavy.height },
  };
  const sameDimensions = source.width === heavy.width && source.height === heavy.height;
  let differingPixelCount = null;
  let totalPixelCount = null;
  let differingPixelRatio = null;
  if (sameDimensions) {
    totalPixelCount = source.width * source.height;
    differingPixelCount = 0;
    for (let pixel = 0; pixel < totalPixelCount; pixel += 1) {
      const offset = pixel * 4;
      if (!source.rgba.subarray(offset, offset + 4).equals(heavy.rgba.subarray(offset, offset + 4))) {
        differingPixelCount += 1;
      }
    }
    differingPixelRatio = totalPixelCount === 0 ? 0 : differingPixelCount / totalPixelCount;
  }

  return {
    schema: SCHEMA,
    capturedImagePaths: {
      source: paths.source ?? null,
      heavy: paths.heavy ?? null,
    },
    sha256: { source: sha256(sourceBuffer), heavy: sha256(heavyBuffer) },
    dimensions,
    differingPixelCount,
    totalPixelCount,
    differingPixelRatio,
    threshold,
    status: sameDimensions && differingPixelRatio <= threshold ? 'EQUAL' : 'DIFFERENT',
    noClaimGuard: {
      mechanicalComparisonOnly: true,
      statement: NO_CLAIM_STATEMENT,
    },
  };
}

export async function comparePngFiles(sourcePath, heavyPath, threshold = 0) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    fail('Threshold must be a finite number between 0 and 1');
  }
  const [sourceBuffer, heavyBuffer] = await Promise.all([readFile(sourcePath), readFile(heavyPath)]);
  const result = comparePngBuffers(sourceBuffer, heavyBuffer, {
    source: sourcePath,
    heavy: heavyPath,
  }, threshold);
  return result;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--source', '--heavy', '--out', '--threshold'].includes(flag)) fail(`Unknown argument: ${flag}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for ${flag}`);
    args[flag.slice(2)] = value;
  }
  for (const required of ['source', 'heavy', 'out']) {
    if (!args[required]) fail(`Missing required argument: --${required}`);
  }
  const threshold = args.threshold === undefined ? 0 : Number(args.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    fail('Threshold must be a finite number between 0 and 1');
  }
  return { source: args.source, heavy: args.heavy, out: args.out, threshold };
}

async function main(argv) {
  const { source, heavy, out, threshold } = parseArgs(argv);
  const result = await comparePngFiles(source, heavy, threshold);
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

if (isAbsolute(process.argv[1]) && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`visual fixture comparison failed: ${error.message}`);
    process.exitCode = 1;
  });
}
