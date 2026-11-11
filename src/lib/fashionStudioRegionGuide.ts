/**
 * 範囲指定で生成: Light marks where the reference garment goes with a brush stroke (its sample mask is a single
 * stroke across the chest). Heavy keeps the stroke as a teal PNG and sends the main image with the stroke painted
 * on it as a guide image; the provider prompt says which garment the marks point at.
 */
export const REGION_MASK_COLOR = '#20d0c4';
/** The same working size as MaskPaintDialog (longest side 1024), so a stored mask reopens in the dialog. */
export const regionMaskWorkingSize = (width: number, height: number) => {
  const ratio = Math.min(1, 1024 / Math.max(width, height));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
};
const GUIDE_MAX_EDGE = 1536;

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('region_guide_image_load_failed'));
  image.src = url;
});
const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('region_guide_canvas_unavailable');
  return { canvas, context };
};

/** Painted pixels (alpha > 0) become opaque teal; the rest stays transparent. */
export const regionMaskToDataUrl = (mask: ImageData): string => {
  const { canvas, context } = canvasOf(mask.width, mask.height);
  const pixels = new ImageData(mask.width, mask.height);
  for (let at = 0; at < mask.data.length; at += 4) {
    if (mask.data[at + 3] === 0) continue;
    pixels.data[at] = 0x20; pixels.data[at + 1] = 0xd0; pixels.data[at + 2] = 0xc4; pixels.data[at + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
};

/** A stored mask (any size) redrawn at the dialog's working size for the main image. */
export async function regionMaskImageData(maskUrl: string, mainWidth: number, mainHeight: number): Promise<ImageData> {
  const size = regionMaskWorkingSize(mainWidth, mainHeight);
  const { context } = canvasOf(size.width, size.height);
  context.drawImage(await loadImage(maskUrl), 0, 0, size.width, size.height);
  return context.getImageData(0, 0, size.width, size.height);
}

export const naturalImageSize = async (url: string) => {
  const image = await loadImage(url);
  return { width: image.naturalWidth, height: image.naturalHeight };
};

/** The guide image (main + teal strokes) as a blob: URL the image request reads like any other reference. */
export async function buildRegionGuideUrl(mainUrl: string, maskUrl: string): Promise<string> {
  const [main, mask] = await Promise.all([loadImage(mainUrl), loadImage(maskUrl)]);
  const ratio = Math.min(1, GUIDE_MAX_EDGE / Math.max(main.naturalWidth, main.naturalHeight));
  const width = Math.round(main.naturalWidth * ratio); const height = Math.round(main.naturalHeight * ratio);
  const { canvas, context } = canvasOf(width, height);
  context.drawImage(main, 0, 0, width, height);
  context.drawImage(mask, 0, 0, width, height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('region_guide_encode_failed');
  return URL.createObjectURL(blob);
}
