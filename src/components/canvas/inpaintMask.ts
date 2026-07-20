export function hasEditableMaskPixels(data: Uint8ClampedArray, editableAlphaMax = 32) {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] <= editableAlphaMax) return true;
  }
  return false;
}
