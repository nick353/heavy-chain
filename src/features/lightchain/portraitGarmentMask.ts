export type PortraitGarmentPriorInput = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
};

export type PortraitGarmentPriorResult = {
  alpha: Uint8ClampedArray;
  seedPixelCount: number;
  garmentPixelCount: number;
  coveragePercent: number;
  startY: number;
  endY: number;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const lerp = (from: number, to: number, amount: number) => from + ((to - from) * amount);

const luminance = (r: number, g: number, b: number) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

/**
 * Build a bounded fallback for a tall portrait whose garment has visible
 * chromatic material detail. This is deliberately conservative: it covers a
 * centered lower garment prior, never the face or the full person silhouette,
 * and returns null when the input does not provide enough garment evidence.
 */
export function buildPortraitGarmentPriorAlpha({
  rgba,
  width,
  height,
}: PortraitGarmentPriorInput): PortraitGarmentPriorResult | null {
  if (width < 48 || height < 72 || rgba.length !== width * height * 4) return null;
  if (height / width < 1.35) return null;

  const firstSearchRow = Math.floor(height * 0.3);
  const lastSearchRow = Math.floor(height * 0.9);
  const rowMinimum = new Int16Array(height);
  const rowMaximum = new Int16Array(height);
  const rowCount = new Uint16Array(height);
  rowMinimum.fill(width);
  rowMaximum.fill(-1);
  let seedPixelCount = 0;

  for (let y = firstSearchRow; y <= lastSearchRow; y += 1) {
    for (let x = Math.floor(width * 0.08); x <= Math.floor(width * 0.92); x += 1) {
      const offset = ((y * width) + x) * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      const warmOrChromatic = spread >= 28 && (
        r > g + 14
        || g > r + 14
        || b > Math.min(r, g) + 14
      );
      const notFloorNoise = luminance(r, g, b) > 38 || y < height * 0.82;
      if (!warmOrChromatic || !notFloorNoise) continue;
      rowMinimum[y] = Math.min(rowMinimum[y], x);
      rowMaximum[y] = Math.max(rowMaximum[y], x);
      rowCount[y] += 1;
      seedPixelCount += 1;
    }
  }

  const minimumSeedPixels = Math.max(12, Math.round(width * height * 0.004));
  if (seedPixelCount < minimumSeedPixels) return null;
  const rowsWithSeeds = Array.from({ length: height }, (_, y) => y).filter((y) => rowCount[y] > 0);
  if (rowsWithSeeds.length < Math.max(8, Math.round(height * 0.08))) return null;

  const firstSeedRow = rowsWithSeeds[0];
  const lastSeedRow = rowsWithSeeds[rowsWithSeeds.length - 1];
  const startY = Math.max(Math.floor(height * 0.3), firstSeedRow - 4);
  const endY = Math.min(Math.floor(height * 0.92), lastSeedRow + Math.max(8, Math.round(height * 0.05)));
  if (endY - startY < Math.round(height * 0.34)) return null;

  let seedCenterSum = 0;
  let seedCenterWeight = 0;
  for (let y = Math.floor(height * 0.36); y <= Math.floor(height * 0.84); y += 1) {
    if (rowCount[y] === 0) continue;
    seedCenterSum += ((rowMinimum[y] + rowMaximum[y]) / 2) * rowCount[y];
    seedCenterWeight += rowCount[y];
  }
  const seedCenter = seedCenterWeight > 0 ? seedCenterSum / seedCenterWeight : width / 2;
  const center = clamp((width / 2 * 0.72) + (seedCenter * 0.28), width * 0.36, width * 0.64);
  const alpha = new Uint8ClampedArray(rgba.length);
  const horizontalFeather = Math.max(1, width * 0.018);
  const verticalFeather = Math.max(2, height * 0.018);
  let garmentPixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    const verticalAlpha = Math.min(
      clamp((y - startY + verticalFeather) / verticalFeather, 0, 1),
      clamp((endY - y + verticalFeather) / verticalFeather, 0, 1),
    );
    const t = clamp((y - startY) / Math.max(1, endY - startY), 0, 1);
    const halfWidth = t < 0.18
      ? lerp(width * 0.22, width * 0.29, t / 0.18)
      : t < 0.64
        ? lerp(width * 0.29, width * 0.38, (t - 0.18) / 0.46)
        : lerp(width * 0.38, width * 0.34, (t - 0.64) / 0.36);
    let left = center - halfWidth;
    let right = center + halfWidth;
    if (rowCount[y] > 0) {
      left = Math.min(left, rowMinimum[y] - (width * 0.04));
      right = Math.max(right, rowMaximum[y] + (width * 0.04));
    }
    left = clamp(left, width * 0.04, width * 0.86);
    right = clamp(right, width * 0.14, width * 0.96);
    for (let x = 0; x < width; x += 1) {
      const edgeAlpha = Math.min(
        clamp((x - left + horizontalFeather) / horizontalFeather, 0, 1),
        clamp((right - x + horizontalFeather) / horizontalFeather, 0, 1),
      );
      const value = Math.round(255 * Math.min(verticalAlpha, edgeAlpha));
      const offset = ((y * width) + x) * 4;
      alpha[offset] = 255;
      alpha[offset + 1] = 255;
      alpha[offset + 2] = 255;
      alpha[offset + 3] = value;
      if (value > 4) garmentPixelCount += 1;
    }
  }

  const coveragePercent = (garmentPixelCount / (width * height)) * 100;
  if (coveragePercent < 8 || coveragePercent > 72) return null;
  return {
    alpha,
    seedPixelCount,
    garmentPixelCount,
    coveragePercent: Number(coveragePercent.toFixed(4)),
    startY,
    endY,
  };
}
