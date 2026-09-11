import {
  renderPrintRequestArtworkCanvas,
  type MaterialCutoutResult,
  type PrintRequestSnapshot,
} from './workspaceMaterialReferences';
import {
  PROVIDER_GARMENT_MASK_ORIENTATION,
  resolveContainedImagePlacement,
  resolveGarmentCutoutSourcePlacement,
  type ProviderGarmentMask,
} from '../features/lightchain/providerMask';
import { protectedImageDigest } from './protectedImageEditContract';

export const PRINT_PROVIDER_INPUT_MODE = 'source-frame-print-placement-v1';
export const CLOUDFLARE_PRINT_INPUT_NOTICE = '最大6件の配置・重なり・回転・反転・透明度を1枚の入力画像に合成してAIへ渡します。合成は生成結果ではありません。AIはプリントが見える範囲だけを編集し、範囲外は出力枠に配置した元画像へ戻します。参照は長辺512pxで送信し、出力解像度は最終合成サイズです。文字・細部の再現品質は検証中です。';

type Size = { width: number; height: number };
type Rect = Size & { x: number; y: number };

/** The preview fits the cutout, while the provider retains the whole photo.
 * Invert that cutout placement before fitting the original into the selected
 * output frame. No design is moved into a new, guessed garment position. */
export function resolvePrintProviderPlacement(
  snapshot: Pick<PrintRequestSnapshot, 'stageSize' | 'garment'>,
  sourceSize: Size,
  garmentCutout: MaterialCutoutResult,
) {
  const outputSize = snapshot.stageSize;
  if (![outputSize.width, outputSize.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 4096)
    || ![sourceSize.width, sourceSize.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384)
    || sourceSize.width * sourceSize.height > 64 * 1024 * 1024) {
    throw new Error('print_provider_frame_dimensions_invalid');
  }
  if (snapshot.garment.sourceSize.width !== garmentCutout.outputSize.width
    || snapshot.garment.sourceSize.height !== garmentCutout.outputSize.height) {
    throw new Error('print_provider_cutout_dimensions_mismatch');
  }
  const stageBounds = snapshot.garment.containBounds;
  if (![stageBounds.x, stageBounds.y, stageBounds.width, stageBounds.height].every(Number.isFinite)
    || stageBounds.x < 0 || stageBounds.y < 0 || stageBounds.width <= 0 || stageBounds.height <= 0
    || stageBounds.x + stageBounds.width > outputSize.width
    || stageBounds.y + stageBounds.height > outputSize.height) {
    throw new Error('print_provider_stage_bounds_invalid');
  }
  const sourceFramePlacement = resolveContainedImagePlacement({
    sourceWidth: sourceSize.width, sourceHeight: sourceSize.height,
    outputWidth: outputSize.width, outputHeight: outputSize.height,
  });
  const sourceCutout = resolveGarmentCutoutSourcePlacement(sourceSize, garmentCutout);
  const scaleX = sourceFramePlacement.width / sourceSize.width;
  const scaleY = sourceFramePlacement.height / sourceSize.height;
  const artworkPlacement: Rect = {
    x: sourceFramePlacement.x + sourceCutout.x * scaleX,
    y: sourceFramePlacement.y + sourceCutout.y * scaleY,
    width: sourceCutout.width * scaleX,
    height: sourceCutout.height * scaleY,
  };
  return { sourceFramePlacement, artworkPlacement, stageBounds: { ...stageBounds } };
}

/** Opacity already lives in the precomposed source. Multiplying it into the
 * final edit mask again would make translucent artwork fade twice. */
export function printArtworkFootprintMask(rgba: Uint8ClampedArray) {
  if (!rgba.length || rgba.length % 4) throw new Error('print_provider_artwork_pixels_invalid');
  const mask = new Uint8ClampedArray(rgba.length);
  let editablePixels = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    const editable = rgba[at + 3] > 0;
    if (editable) editablePixels++;
    mask[at] = mask[at + 1] = mask[at + 2] = 255;
    mask[at + 3] = editable ? 0 : 255;
  }
  if (!editablePixels) throw new Error('プリントが服の範囲内に表示されていません。配置・透明度を確認してください。');
  return { rgba: mask, coveragePercent: editablePixels / (rgba.length / 4) * 100 };
}

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  if (/^https?:\/\//i.test(url)) image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('print_provider_source_load_failed'));
  image.src = url;
});
const canvasFor = ({ width, height }: Size) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('print_provider_canvas_unavailable');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  return { canvas, context };
};
const png = (canvas: HTMLCanvasElement) => {
  const dataUrl = canvas.toDataURL('image/png');
  if (dataUrl.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 + 64) throw new Error('print_provider_composition_too_large');
  return dataUrl;
};

export async function renderPrintProviderInput({
  snapshot, sourceImageUrl, garmentCutout, assertCurrent = () => {},
}: {
  snapshot: PrintRequestSnapshot;
  sourceImageUrl: string;
  garmentCutout: MaterialCutoutResult;
  assertCurrent?: () => void;
}) {
  assertCurrent();
  if (!snapshot.designs.length || new Set(snapshot.designs.map(layer => layer.id)).size !== snapshot.designs.length) {
    throw new Error('print_provider_design_identity_invalid');
  }
  const source = await loadImage(sourceImageUrl);
  assertCurrent();
  const sourceSize = { width: source.naturalWidth, height: source.naturalHeight };
  const mapping = resolvePrintProviderPlacement(snapshot, sourceSize, garmentCutout);
  // This is the actual existing exact-preview raster, not a separate placement
  // implementation or a contact sheet that would discard spatial intent.
  const stageArtwork = await renderPrintRequestArtworkCanvas(snapshot);
  assertCurrent();
  const outputSize = { ...snapshot.stageSize };
  const artwork = canvasFor(outputSize);
  const from = mapping.stageBounds; const to = mapping.artworkPlacement;
  artwork.context.drawImage(stageArtwork, from.x, from.y, from.width, from.height,
    to.x, to.y, to.width, to.height);
  const maskPixels = printArtworkFootprintMask(artwork.context.getImageData(0, 0, outputSize.width, outputSize.height).data);
  const mask = canvasFor(outputSize);
  mask.context.putImageData(new ImageData(maskPixels.rgba, outputSize.width, outputSize.height), 0, 0);
  const sourceFrame = canvasFor(outputSize);
  const frame = mapping.sourceFramePlacement;
  sourceFrame.context.drawImage(source, frame.x, frame.y, frame.width, frame.height);
  const originalFrameUrl = png(sourceFrame.canvas);
  sourceFrame.context.drawImage(artwork.canvas, 0, 0);
  const imageUrl = png(sourceFrame.canvas);
  const maskDataUrl = png(mask.canvas);
  const artworkDataUrl = png(artwork.canvas);
  const metadata = {
    mode: PRINT_PROVIDER_INPUT_MODE,
    inputKind: 'precomposed-layout-not-generated-result',
    designCount: snapshot.designs.length,
    orderedLayers: snapshot.designs.map(layer => ({ id: layer.id, maskRevision: layer.maskRevision,
      sourceSize: { ...layer.sourceSize }, transform: { ...layer.transform }, box: { ...layer.box } })),
    coverageMode: snapshot.coverageMode,
    sourceSize, outputSize, ...mapping,
    sourceFrameResampled: frame.width !== sourceSize.width || frame.height !== sourceSize.height,
    referenceRoles: ['precomposed-print-layout', 'original-photo-in-output-frame', 'print-footprint-guide'],
    originalFrameSha256: await protectedImageDigest(originalFrameUrl),
    compositionSha256: await protectedImageDigest(imageUrl),
    artworkSha256: await protectedImageDigest(artworkDataUrl),
    maskSha256: await protectedImageDigest(maskDataUrl),
    editRegion: 'rendered-artwork-footprint',
    semanticQuality: 'unverified',
  };
  assertCurrent();
  const providerMask: ProviderGarmentMask = {
    dataUrl: maskDataUrl, ...outputSize, coveragePercent: maskPixels.coveragePercent,
    orientation: PROVIDER_GARMENT_MASK_ORIENTATION, sourceEngine: garmentCutout.engine,
  };
  return { imageUrl, referenceImageUrls: [originalFrameUrl], providerMask, metadata };
}

export function printProviderPrompt(basePrompt: string, designCount: number) {
  return `${basePrompt}\nImage 0 is a deterministic precomposition of ALL ${designCount} selected print artwork layers in their approved positions on the original photo. It is the primary input, not a previous AI result. Keep every layer's exact location, size, rotation, horizontal/vertical flips, overlap order, lettering, colors and opacity. Do not add, omit, move, repeat or redesign artwork. Image 1 is the same original photo BEFORE printing, aligned in the identical output frame; use it only for the garment's lighting and fabric texture. Make the already-placed print look naturally applied to that fabric inside the supplied footprint guide. Preserve the entire photo composition. Do not reproduce the guide or make a contact sheet. Exact lettering and artwork fidelity still require visual review.`;
}
