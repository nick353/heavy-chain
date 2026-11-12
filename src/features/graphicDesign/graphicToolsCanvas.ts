import { repeatUnit, type RepeatLayout } from './graphicTools';

/** Browser side of the AIグラフィックデザイン tools: reading a result's pixels and writing PNGs. No server calls. */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** The image as a bitmap read through fetch, so the canvas is never tainted by another origin's image. */
async function loadBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error('graphic_tool_image_unreadable');
  return await createImageBitmap(await response.blob());
}

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas_unavailable');
  return { canvas, context };
};

/** The image's pixels, scaled down so the long edge is at most maxEdge (the preview works on a 1024px copy). */
export async function readPixels(url: string, maxEdge = Infinity): Promise<Pixels> {
  const image = await loadBitmap(url);
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const { canvas, context } = canvasOf(image.width * scale, image.height * scale);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width: canvas.width, height: canvas.height };
}

export function pixelsToCanvas(pixels: Pixels): HTMLCanvasElement {
  const { canvas, context } = canvasOf(pixels.width, pixels.height);
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  return canvas;
}

const canvasBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('graphic_tool_png_failed'))), 'image/png');
});

export async function pixelsToBlob(pixels: Pixels): Promise<Blob> {
  return await canvasBlob(pixelsToCanvas(pixels));
}

/** The repeat unit drawn once (CSS repeats it in the preview); size is one tile's edge in pixels. */
export function drawRepeatUnit(tile: HTMLCanvasElement, layout: RepeatLayout, tileWidth = tile.width, tileHeight = tile.height): HTMLCanvasElement {
  const unit = repeatUnit(layout);
  const { canvas, context } = canvasOf(unit.columns * tileWidth, unit.rows * tileHeight);
  for (const place of unit.placements) {
    context.save();
    context.translate((place.x + (place.flipX ? 1 : 0)) * tileWidth, (place.y + (place.flipY ? 1 : 0)) * tileHeight);
    context.scale(place.flipX ? -1 : 1, place.flipY ? -1 : 1);
    context.drawImage(tile, 0, 0, tileWidth, tileHeight);
    context.restore();
  }
  return canvas;
}

/** A sheet of the repeat for checking or sharing: columns × rows tiles at the tile's own size (long edge at most 4096). */
export async function repeatSheetBlob(tile: HTMLCanvasElement, layout: RepeatLayout, tiles = 3): Promise<Blob> {
  const scale = Math.min(1, 4096 / (Math.max(tile.width, tile.height) * tiles));
  const width = tile.width * scale; const height = tile.height * scale;
  const unitCanvas = drawRepeatUnit(tile, layout, width, height);
  const { canvas, context } = canvasOf(width * tiles, height * tiles);
  const pattern = context.createPattern(unitCanvas, 'repeat');
  if (!pattern) throw new Error('canvas_unavailable');
  context.fillStyle = pattern;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return await canvasBlob(canvas);
}

export const blobToFile = (blob: Blob, name: string) => new File([blob], name, { type: blob.type || 'image/png' });
