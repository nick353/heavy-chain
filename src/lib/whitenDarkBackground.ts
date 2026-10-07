/**
 * Graphic references often sit on a flat black/dark background, and the image
 * model carries that background (with a glow) into the new graphic even when
 * the prompt asks for white. Replacing a uniform dark border colour with white
 * before sending removes the cue. Light, busy or non-uniform backgrounds are
 * left untouched.
 */
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Mutates RGBA pixels in place. Returns true when the background was whitened. */
export function whitenDarkBackgroundPixels(data: Uint8ClampedArray, width: number, height: number, tolerance = 48): boolean {
  if (width < 4 || height < 4 || data.length < width * height * 4) return false;
  const border: number[][] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  const push = (x: number, y: number) => { const i = (y * width + x) * 4; if (data[i + 3] > 200) border.push([data[i], data[i + 1], data[i + 2]]); };
  for (let x = 0; x < width; x += step) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += step) { push(0, y); push(width - 1, y); }
  if (border.length < 8) return false;
  const median = [0, 1, 2].map(c => border.map(p => p[c]).sort((a, b) => a - b)[Math.floor(border.length / 2)]);
  if (luminance(median[0], median[1], median[2]) > 70) return false;
  const near = (r: number, g: number, b: number) => Math.hypot(r - median[0], g - median[1], b - median[2]) <= tolerance;
  // Require a mostly uniform border so photos and patterned grounds are kept.
  if (border.filter(p => near(p[0], p[1], p[2])).length / border.length < 0.8) return false;
  for (let i = 0; i < width * height * 4; i += 4) {
    if (near(data[i], data[i + 1], data[i + 2])) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255; }
  }
  return true;
}

/** Returns a PNG data URL with the dark background whitened, or the original URL when nothing changed. */
export async function whitenDarkBackground(url: string): Promise<string> {
  if (typeof document === 'undefined' || !url) return url;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('image_load_failed')); image.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) return url;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  if (!whitenDarkBackgroundPixels(pixels.data, canvas.width, canvas.height)) return url;
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}
