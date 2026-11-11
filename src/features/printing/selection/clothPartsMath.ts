/** Pure helpers for AIマスク認識 (rembg u2net_cloth_seg). Shared by the worker and the page; no DOM, no model. */

export const CLOTH_PARTS_INPUT_SIDE = 768;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The parts Light lists under AIマスク認識, in its order; the class index is the cloth model's output channel. */
export const CLOTH_PARTS = [
  { label: 'トップス', classIndex: 1 },
  { label: 'ボトムス', classIndex: 2 },
  { label: '全身', classIndex: 3 },
] as const;
export type ClothPartLabel = (typeof CLOTH_PARTS)[number]['label'];

/** A part is listed when it covers at least this share of the image (Light listed only トップス for a lone shirt). */
export const CLOTH_PART_MIN_SHARE = 0.01;

/** rembg's normalize: divide by the image maximum, then ImageNet mean / std, NCHW float32. */
export function clothPartsInputTensorData(rgba: Uint8ClampedArray, side = CLOTH_PARTS_INPUT_SIDE) {
  const plane = side * side;
  if (rgba.length !== plane * 4) throw new Error('cloth_parts_input_invalid');
  let max = 1;
  for (let at = 0; at < rgba.length; at += 4) max = Math.max(max, rgba[at], rgba[at + 1], rgba[at + 2]);
  const data = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const at = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) data[channel * plane + pixel] = (rgba[at + channel] / max - MEAN[channel]) / STD[channel];
  }
  return data;
}

/** Argmax over the class axis of a [1, classes, side, side] output; 0 is background. */
export function clothPartsClassMap(logits: Float32Array, classes: number, side = CLOTH_PARTS_INPUT_SIDE) {
  const plane = side * side;
  if (logits.length < plane * classes) throw new Error('cloth_parts_output_invalid');
  const map = new Uint8Array(plane);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    let best = 0, bestValue = logits[pixel];
    for (let cls = 1; cls < classes; cls += 1) {
      const value = logits[cls * plane + pixel];
      if (value > bestValue) { bestValue = value; best = cls; }
    }
    map[pixel] = best;
  }
  return map;
}

/** Share of the image each part covers, and the parts worth listing (in Light's order). */
export function foundClothParts(classMap: Uint8Array, minShare = CLOTH_PART_MIN_SHARE) {
  const counts = new Map<number, number>();
  for (const cls of classMap) counts.set(cls, (counts.get(cls) ?? 0) + 1);
  return CLOTH_PARTS.filter((part) => (counts.get(part.classIndex) ?? 0) / classMap.length >= minShare).map((part) => part.label);
}

/** One part as RGBA at the model side: opaque where the part is, transparent elsewhere (scaled up on the page). */
export function clothPartMaskRgba(classMap: Uint8Array, classIndex: number) {
  const rgba = new Uint8ClampedArray(classMap.length * 4);
  for (let pixel = 0; pixel < classMap.length; pixel += 1) {
    if (classMap[pixel] !== classIndex) continue;
    rgba[pixel * 4 + 3] = 255;
  }
  return rgba;
}
