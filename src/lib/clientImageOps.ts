// Browser-only image utilities: upscaling and ZIP packaging. No server calls.
import { watermarkImageBlobIfOn } from './imageDownload.ts';

const MAX_UPSCALE_EDGE = 4096;

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('image_load_failed'));
  image.src = url;
});

/** Unsharp mask on RGB channels. amount 0..1. */
export function unsharpMask(data: Uint8ClampedArray, width: number, height: number, amount: number) {
  if (amount <= 0) return;
  const source = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const center = source[index + channel];
        const blur = (source[index - 4 + channel] + source[index + 4 + channel] +
          source[index - width * 4 + channel] + source[index + width * 4 + channel] + center * 4) / 8;
        data[index + channel] = center + (center - blur) * amount * 2;
      }
    }
  }
}

/**
 * Enlarge in 2x steps with high-quality smoothing, then sharpen. This is
 * resampling, not generative super-resolution: it adds pixels, not detail.
 */
export async function upscaleImage(imageUrl: string, options: { scale: number; sharpness: number; denoiseLevel: number }): Promise<string> {
  const image = await loadImage(imageUrl);
  let width = image.naturalWidth; let height = image.naturalHeight;
  if (!width || !height) throw new Error('image_dimensions_invalid');
  const limit = Math.min(options.scale, MAX_UPSCALE_EDGE / Math.max(width, height));
  if (limit <= 1) throw new Error('image_already_at_max_size');
  let canvas: HTMLCanvasElement | HTMLImageElement = image;
  let reached = 1;
  while (reached < limit) {
    const step = Math.min(2, limit / reached);
    const next = document.createElement('canvas');
    next.width = Math.round(width * step); next.height = Math.round(height * step);
    const context = next.getContext('2d'); if (!context) throw new Error('canvas_unavailable');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // A light blur before enlarging reduces JPEG noise when denoise is requested.
    if (options.denoiseLevel > 0 && reached === 1) context.filter = `blur(${Math.min(1, options.denoiseLevel / 100)}px)`;
    context.drawImage(canvas, 0, 0, next.width, next.height);
    context.filter = 'none';
    canvas = next; width = next.width; height = next.height; reached *= step;
  }
  const output = canvas as HTMLCanvasElement;
  const context = output.getContext('2d'); if (!context) throw new Error('canvas_unavailable');
  const amount = Math.max(0, Math.min(1, (options.sharpness || 40) / 100));
  const pixels = context.getImageData(0, 0, output.width, output.height);
  unsharpMask(pixels.data, output.width, output.height, amount);
  context.putImageData(pixels, 0, 0);
  return output.toDataURL('image/png');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer (stored, no compression) — images are already compressed. */
export function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = [];
  let offset = 0;
  const used = new Set<string>();
  for (const file of files) {
    const base = file.name.replace(/[\\/:*?"<>|]+/g, '_') || 'file';
    let name = base;
    for (let i = 2; used.has(name); i++) name = base.replace(/(\.[^.]*)?$/, `-${i}$1`);
    used.add(name);
    const nameBytes = encoder.encode(name); const crc = crc32(file.data); const size = file.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, size, true); entry.setUint32(24, size, true);
    entry.setUint16(28, nameBytes.length, true); entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + size;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) { out.set(part, position); position += part.length; }
  return out;
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

/** Fetch every image and save one ZIP. Returns how many images were included. */
export async function downloadImagesAsZip(images: Array<{ url: string; name: string }>, zipName: string): Promise<{ included: number; failed: number }> {
  const files: Array<{ name: string; data: Uint8Array }> = []; let failed = 0;
  for (const image of images) {
    try {
      const response = await fetch(image.url, { credentials: 'omit' });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await watermarkImageBlobIfOn(await response.blob());
      const extension = EXTENSIONS[blob.type] ?? 'png';
      files.push({ name: `${image.name}.${extension}`, data: new Uint8Array(await blob.arrayBuffer()) });
    } catch { failed++; }
  }
  if (!files.length) throw new Error('bulk_download_no_images');
  const url = URL.createObjectURL(new Blob([buildZip(files)], { type: 'application/zip' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = zipName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
  return { included: files.length, failed };
}
