export type FabricMaterialProfile = {
  tintColor: readonly [number, number, number];
  tintStrength: number;
  sourceTextureStrength: number;
  weaveStrength: number;
  sheenStrength: number;
  drapeStrength: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampByte = (value: number) => Math.round(clamp(value, 0, 255));
const luminance = (rgba: Uint8ClampedArray, offset: number) => (
  (0.2126 * rgba[offset])
  + (0.7152 * rgba[offset + 1])
  + (0.0722 * rgba[offset + 2])
);

const foldContrastAt = ({
  garmentRgba,
  width,
  height,
  x,
  y,
  radius,
}: {
  garmentRgba: Uint8ClampedArray;
  width: number;
  height: number;
  x: number;
  y: number;
  radius: number;
}) => {
  const offset = ((y * width) + x) * 4;
  const current = luminance(garmentRgba, offset);
  let neighbourSum = 0;
  let neighbourWeight = 0;
  for (const [offsetX, offsetY] of [
    [-radius, 0],
    [radius, 0],
    [0, -radius],
    [0, radius],
  ] as const) {
    const nextX = x + offsetX;
    const nextY = y + offsetY;
    if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
    const nextOffset = ((nextY * width) + nextX) * 4;
    const alphaWeight = garmentRgba[nextOffset + 3] / 255;
    if (alphaWeight <= 0) continue;
    neighbourSum += luminance(garmentRgba, nextOffset) * alphaWeight;
    neighbourWeight += alphaWeight;
  }
  if (neighbourWeight <= 0) return 0;
  return clamp((current - (neighbourSum / neighbourWeight)) / 48, -1, 1);
};

/**
 * Transfers a material reference into a detected garment region while keeping
 * the person's photographed lighting and folds. This is deliberately a pure
 * pixel helper so the browser composition path and its regression tests share
 * the same invariant: RGB may change, alpha and geometry may not.
 */
export const applyFabricMaterialResponse = ({
  materialRgba,
  garmentRgba,
  width,
  height,
  profile,
}: {
  materialRgba: Uint8ClampedArray;
  garmentRgba: Uint8ClampedArray;
  width: number;
  height: number;
  profile: FabricMaterialProfile;
}) => {
  if (materialRgba.length !== garmentRgba.length || materialRgba.length !== width * height * 4) {
    throw new Error('invalid_fabric_material_response_input');
  }
  const output = new Uint8ClampedArray(materialRgba);
  const foldSampleRadius = Math.max(1, Math.round(Math.min(width, height) / 180));
  let averageMaterialLuminance = 0;
  let materialPixelCount = 0;
  for (let offset = 0; offset < materialRgba.length; offset += 4) {
    if (materialRgba[offset + 3] === 0) continue;
    averageMaterialLuminance += luminance(materialRgba, offset);
    materialPixelCount += 1;
  }
  averageMaterialLuminance /= Math.max(1, materialPixelCount);

  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    const pixel = offset / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const garmentLuminance = luminance(garmentRgba, offset);
    const sourceLuminance = luminance(materialRgba, offset);
    const foldContrast = foldContrastAt({
      garmentRgba,
      width,
      height,
      x,
      y,
      radius: foldSampleRadius,
    });
    const normalizedX = (x + 0.5) / width;
    const normalizedY = (y + 0.5) / height;
    const broadDrape = Math.sin(2 * Math.PI * ((normalizedX * 2.25) + (normalizedY * 0.22)));
    const diagonalDrape = Math.sin((2 * Math.PI * ((normalizedX * 0.75) - (normalizedY * 1.4))) + 0.9);
    const syntheticDrape = (broadDrape * 0.68) + (diagonalDrape * 0.32);
    const sourceTextureRatio = clamp(sourceLuminance / Math.max(1, averageMaterialLuminance), 0.68, 1.36);
    const drapeResponse = (foldContrast * 0.8) + (syntheticDrape * profile.drapeStrength);
    const lighting = clamp(
      0.58
        + ((garmentLuminance / 255) * 0.62)
        + (foldContrast * 0.12)
        + (syntheticDrape * profile.drapeStrength * 0.04),
      0.5,
      1.18,
    );
    const textureResponse = clamp(
      1 + ((sourceTextureRatio - 1) * profile.sourceTextureStrength) + (drapeResponse * 0.06),
      0.72,
      1.3,
    );
    const weave = Math.sin(
      (2 * Math.PI * ((normalizedX * 74) + (normalizedY * 0.35)))
        + Math.sin(2 * Math.PI * ((normalizedY * 68) - (normalizedX * 0.22))),
    ) * profile.weaveStrength;
    const tintStrength = clamp(profile.tintStrength, 0, 1);
    const materialR = (materialRgba[offset] * (1 - tintStrength)) + (profile.tintColor[0] * tintStrength);
    const materialG = (materialRgba[offset + 1] * (1 - tintStrength)) + (profile.tintColor[1] * tintStrength);
    const materialB = (materialRgba[offset + 2] * (1 - tintStrength)) + (profile.tintColor[2] * tintStrength);
    const sheen = profile.sheenStrength > 0
      ? Math.max(0, Math.sin((2 * Math.PI * ((normalizedX * 0.72) + (normalizedY * 0.18))) + 0.6)) * profile.sheenStrength
      : 0;
    const sheenLift = sheen * 18;
    const response = lighting * textureResponse * (1 + weave);
    output[offset] = clampByte((materialR * response) + sheenLift);
    output[offset + 1] = clampByte((materialG * response) + sheenLift);
    output[offset + 2] = clampByte((materialB * response) + sheenLift);
  }
  return output;
};
