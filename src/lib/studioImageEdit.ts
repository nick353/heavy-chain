/**
 * Fashion Studio の「画像編集」メニュー・簡易エディター・クリッピングの計算部分（画面の部品から切り離した純粋な処理）。
 * 本家 jp.linkaigc.com の画面と台本（2026-11-12 に確認）に合わせている:
 * - メニューの並び: 画像修復(NEW)／部分編集／高画質化›(2K・4K)／ワンクリックで背景削除／クリッピング／AIトリミング／AI拡張／AI削除
 * - 高画質化: 長い辺が HD_2K(2048) 以上なら 2K、HD_4K(4096) 以上なら 4K を押せない
 * - AI拡張: 拡張倍率 1x/1.5x/2x、比率のプリセット、上限 4096px（本家の関数 z と同じ計算）
 * - クリッピング: 抽出は元の大きさのまま選択の外を透明に（getSynthesis）、お気に入りは選択の外接矩形で切り出す（imageAutoClip）
 * どの関数も DOM を使わない（試験から直接呼ぶ）。
 */

export type StudioEditToolId = 'repair' | 'partial' | 'upscale' | 'remove-background' | 'clipping' | 'crop' | 'expand' | 'erase';
/** 手元（ブラウザ）で仕上がる道具。結果は File で返す。 */
export type StudioClientEditTool = 'upscale' | 'remove-background' | 'clipping' | 'crop';
/** 生成の窓口に頼む道具。元画像・案内画像・英語の指示を返す。 */
export type StudioServerEditTool = 'repair' | 'partial' | 'expand' | 'erase';

export const STUDIO_EDIT_MENU: ReadonlyArray<{ id: StudioEditToolId; label: string; badge?: 'NEW'; submenu?: true; runsOn: 'client' | 'server' }> = [
  { id: 'repair', label: '画像修復', badge: 'NEW', runsOn: 'server' },
  { id: 'partial', label: '部分編集', runsOn: 'server' },
  { id: 'upscale', label: '高画質化', submenu: true, runsOn: 'client' },
  { id: 'remove-background', label: 'ワンクリックで背景削除', runsOn: 'client' },
  { id: 'clipping', label: 'クリッピング', runsOn: 'client' },
  { id: 'crop', label: 'AIトリミング', runsOn: 'client' },
  { id: 'expand', label: 'AI拡張', runsOn: 'server' },
  { id: 'erase', label: 'AI削除', runsOn: 'server' },
];

// ---- 高画質化 ----------------------------------------------------------------------------------------------
export const HD_2K = 2048;
export const HD_4K = 4096;
export type StudioUpscaleTarget = '2k' | '4k';
/** 本家の判定（34vt0w060bmsy.js: `"2k"===e&&n>=HD_2K||n>=HD_4K` なら何もしない）。scale は clientImageOps.upscaleImage に渡す倍率。 */
export function studioUpscaleOptions(width: number, height: number): Record<StudioUpscaleTarget, { enabled: boolean; scale: number }> {
  const side = Math.max(width, height);
  const valid = Number.isFinite(side) && side > 0;
  return {
    '2k': { enabled: valid && side < HD_2K, scale: valid ? HD_2K / side : 0 },
    '4k': { enabled: valid && side < HD_4K, scale: valid ? HD_4K / side : 0 },
  };
}
export const STUDIO_UPSCALE_TOO_LARGE = '画像サイズが大きすぎるため、拡大できません。';

// ---- 比率のプリセット（AI拡張・AIトリミング） ---------------------------------------------------------------
export const EXPAND_MAX_SIZE = 4096;
export const EXPAND_SCALES = [1, 1.5, 2] as const;
export type StudioExpandScale = (typeof EXPAND_SCALES)[number];
export const EXPAND_ORIGINAL = '元の比率';
export const CROP_CUSTOM = 'カスタム';
const PRESET_TAIL = [
  { label: '標準EC商品画像', presets: ['1:1'] },
  { label: 'SNSカバー', presets: ['3:4', '4:5'] },
  { label: 'ショート動画カバー', presets: ['9:16', '16:9'] },
  { label: '公式サイトバナー', presets: ['21:9'] },
];
const GENERAL = ['1:1', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'];
export const EXPAND_PRESET_GROUPS: ReadonlyArray<{ label: string; presets: readonly string[] }> = [
  { label: '汎用', presets: [EXPAND_ORIGINAL, ...GENERAL] }, ...PRESET_TAIL,
];
/** AIトリミングは「汎用」の先頭が「カスタム」（自由な枠）。ほかは AI拡張と同じ。 */
export const CROP_PRESET_GROUPS: ReadonlyArray<{ label: string; presets: readonly string[] }> = [
  { label: '汎用', presets: [CROP_CUSTOM, ...GENERAL] }, ...PRESET_TAIL,
];
/** 'a:b' → a/b。元の比率・カスタムは 0（比率を固定しない）。 */
export function presetRatio(label: string): number {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(label.trim());
  if (!match) return 0;
  const width = Number(match[1]), height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 0;
}

// ---- AI拡張 ------------------------------------------------------------------------------------------------
export type StudioExpandSize = { width: number; height: number; error: null | 'width' | 'height' };
export const EXPAND_ERRORS = { width: '幅が最大拡張範囲に達しました', height: '高さが最大拡張範囲に達しました' } as const;
/**
 * 拡張後の大きさ。本家の関数 z と同じ: 比率なしは倍率をそのまま掛け、比率ありは「長い辺×倍率」と元の幅・高さが
 * 必ず収まる大きさのうち最小の枠。上限 4096 を超える辺があれば error に印を付ける（本家はその倍率を押せない）。
 */
export function studioExpandSize(width: number, height: number, scale: number, ratio: number): StudioExpandSize {
  let outWidth: number, outHeight: number;
  if (ratio <= 0) { outWidth = width * scale; outHeight = height * scale; }
  else if (ratio >= 1) { const side = Math.max(Math.max(width, height) * scale, width, height * ratio); outWidth = side; outHeight = side / ratio; }
  else { const side = Math.max(Math.max(width, height) * scale, height, width / ratio); outWidth = side * ratio; outHeight = side; }
  const rounded = { width: Math.round(outWidth), height: Math.round(outHeight) };
  const error = rounded.width > EXPAND_MAX_SIZE ? 'width' : rounded.height > EXPAND_MAX_SIZE ? 'height' : null;
  return { ...rounded, error };
}
/** 倍率ごとに押せるか（上限を超える倍率は押せない）。 */
export const studioExpandScaleEnabled = (width: number, height: number, scale: number, ratio: number) => studioExpandSize(width, height, scale, ratio).error === null;
/** 元の画像を拡張後の枠のどこに置くか（真ん中）。 */
export function studioExpandOffset(width: number, height: number, target: { width: number; height: number }) {
  return { x: Math.round((target.width - width) / 2), y: Math.round((target.height - height) / 2) };
}
/** 生成の窓口に渡す比率の文字（プリセットに近ければその名前、ほかは約分した 'w:h'）。 */
export function studioAspectRatioLabel(width: number, height: number): string {
  if (!(width > 0 && height > 0)) return '1:1';
  const known = [...GENERAL, '4:5', '21:9'];
  const ratio = width / height;
  const near = known.find(label => Math.abs(presetRatio(label) - ratio) / ratio < 0.01);
  if (near) return near;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const w = Math.round(width), h = Math.round(height), divisor = gcd(w, h) || 1;
  return `${w / divisor}:${h / divisor}`;
}

// ---- AIトリミング ------------------------------------------------------------------------------------------
export type StudioRect = { x: number; y: number; width: number; height: number };
/** 比率に合う、画像の中で一番大きい真ん中の枠（比率 0 は画像全体）。本家の初めの枠と同じ。 */
export function studioCenteredCrop(width: number, height: number, ratio: number): StudioRect {
  if (ratio <= 0) return { x: 0, y: 0, width, height };
  let cropWidth = width, cropHeight = width / ratio;
  if (cropHeight > height) { cropHeight = height; cropWidth = height * ratio; }
  cropWidth = Math.round(cropWidth); cropHeight = Math.round(cropHeight);
  return { x: Math.round((width - cropWidth) / 2), y: Math.round((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}
export type StudioCropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const MIN_CROP = 16;
/**
 * 枠をつまみで動かす（画像の画素の単位）。比率があるときは保ったまま、画像の外へは出さない。
 * つまみの反対側の角（辺なら反対の辺の真ん中）を動かさない。
 */
export function studioResizeCrop(rect: StudioRect, handle: StudioCropHandle, dx: number, dy: number, bounds: { width: number; height: number }, ratio: number): StudioRect {
  if (handle === 'move') {
    return {
      ...rect,
      x: Math.round(Math.min(Math.max(0, rect.x + dx), bounds.width - rect.width)),
      y: Math.round(Math.min(Math.max(0, rect.y + dy), bounds.height - rect.height)),
    };
  }
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s');
  let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
  if (west) left = Math.min(right - MIN_CROP, Math.max(0, left + dx));
  if (east) right = Math.max(left + MIN_CROP, Math.min(bounds.width, right + dx));
  if (north) top = Math.min(bottom - MIN_CROP, Math.max(0, top + dy));
  if (south) bottom = Math.max(top + MIN_CROP, Math.min(bounds.height, bottom + dy));
  if (ratio > 0) {
    let width = right - left, height = bottom - top;
    const horizontalOnly = (west || east) && !(north || south), verticalOnly = (north || south) && !(west || east);
    if (horizontalOnly) height = width / ratio;
    else if (verticalOnly) width = height * ratio;
    else if (width / height > ratio) width = height * ratio; else height = width / ratio;
    // 反対側を固定した基準点からの最大の大きさに収める。
    const anchorX = west ? rect.x + rect.width : east ? rect.x : rect.x + rect.width / 2;
    const anchorY = north ? rect.y + rect.height : south ? rect.y : rect.y + rect.height / 2;
    const maxWidth = west ? anchorX : east ? bounds.width - anchorX : 2 * Math.min(anchorX, bounds.width - anchorX);
    const maxHeight = north ? anchorY : south ? bounds.height - anchorY : 2 * Math.min(anchorY, bounds.height - anchorY);
    const fit = Math.min(1, maxWidth / width, maxHeight / height);
    width *= fit; height *= fit;
    left = west ? anchorX - width : east ? anchorX : anchorX - width / 2;
    top = north ? anchorY - height : south ? anchorY : anchorY - height / 2;
    right = left + width; bottom = top + height;
  }
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

// ---- マスクと切り抜き -----------------------------------------------------------------------------------------
export type StudioRgba = { width: number; height: number; data: Uint8ClampedArray };
/**
 * 本家の getSynthesis（destination-in の合成）: 元画像の大きさのまま、マスクの塗っていない所を透明にする。
 * マスクは元画像と同じ大きさにしてから渡す。半透明の縁はマスクの透明度を掛けて残す。
 */
export function studioApplyMaskAlpha(source: StudioRgba, mask: StudioRgba): Uint8ClampedArray<ArrayBuffer> {
  if (source.width !== mask.width || source.height !== mask.height) throw new Error('studio_mask_size_mismatch');
  const out = new Uint8ClampedArray(source.data.length);
  out.set(source.data);
  for (let at = 3; at < out.length; at += 4) out[at] = Math.round((source.data[at] * mask.data[at]) / 255);
  return out;
}
/** 透明でない画素（alpha > 0）の外接矩形。何も無ければ null。 */
export function studioAlphaBounds(image: StudioRgba): StudioRect | null {
  let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    const row = y * image.width * 4;
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[row + x * 4 + 3] === 0) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
/** 矩形の部分だけを切り出す（本家の imageAutoClip は透明でない範囲で切る）。 */
export function studioCropRgba(image: StudioRgba, rect: StudioRect): StudioRgba {
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const width = Math.max(0, Math.min(image.width, Math.ceil(rect.x + rect.width)) - x0);
  const height = Math.max(0, Math.min(image.height, Math.ceil(rect.y + rect.height)) - y0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}
/** お気に入り（imageAutoClip）: 透明にした画像を、残った部分の外接矩形で切る。何も残らなければ null。 */
export function studioAutoClip(image: StudioRgba): StudioRgba | null {
  const bounds = studioAlphaBounds(image);
  return bounds ? studioCropRgba(image, bounds) : null;
}
/** 矩形選択で認識できなかったとき: 矩形そのものを塗る（add）か消す（remove）。 */
export function studioFillRectAlpha(mask: StudioRgba, rect: StudioRect, add: boolean) {
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(mask.width, Math.round(rect.x + rect.width)), y1 = Math.min(mask.height, Math.round(rect.y + rect.height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * mask.width + x) * 4;
      if (add) { mask.data[at] = 0; mask.data[at + 1] = 0; mask.data[at + 2] = 0; mask.data[at + 3] = 255; } else mask.data[at + 3] = 0;
    }
  }
}
/** 矩形を別の大きさの座標へ写す（作業用のマスク ↔ 元画像）。 */
export function studioScaleRect(rect: StudioRect, from: { width: number; height: number }, to: { width: number; height: number }): StudioRect {
  const sx = to.width / from.width, sy = to.height / from.height;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}
/** 2点のドラッグから、画像の中に収めた矩形を作る。 */
export function studioRectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, bounds: { width: number; height: number }): StudioRect {
  const clampX = (value: number) => Math.min(bounds.width, Math.max(0, value)), clampY = (value: number) => Math.min(bounds.height, Math.max(0, value));
  const x0 = clampX(Math.min(a.x, b.x)), x1 = clampX(Math.max(a.x, b.x)), y0 = clampY(Math.min(a.y, b.y)), y1 = clampY(Math.max(a.y, b.y));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---- 生成の窓口に渡す指示（英語） -------------------------------------------------------------------------------
/** 部分編集のマーカーの色（本家と同じ3色）。 */
export const PARTIAL_EDIT_COLORS = [
  { hex: '#FF3333', name: 'red', label: '赤' },
  { hex: '#FFDD33', name: 'yellow', label: '黄' },
  { hex: '#3399FF', name: 'blue', label: '青' },
] as const;
export type StudioPartialColor = (typeof PARTIAL_EDIT_COLORS)[number]['hex'];
/** AI削除の案内画像で塗る色（範囲指定の案内図と同じティール）。 */
export const ERASE_GUIDE_COLOR = '#20d0c4';
const KEEP_REST = 'Keep every part outside the marked areas exactly as it is, at the same framing and colors.';
const NO_MARKS = 'Return only the edited first image, with no guide strokes, text, borders or watermark.';

export const STUDIO_REPAIR_PROMPT = 'Restore this photo: remove blur, noise, compression artifacts, scratches and small defects, and bring back crisp fine detail in fabric, hair and skin texture. Keep the composition, framing, colors, people, poses and garments exactly as they are, and do not add or remove anything.';
export const STUDIO_ERASE_PROMPT = `The first image is the photo to edit. The second image is a guide: the areas painted solid teal (${ERASE_GUIDE_COLOR}) in it mark objects to remove from the first image. Remove everything under the teal marks and rebuild those areas from the surrounding background so the result looks untouched. ${KEEP_REST} ${NO_MARKS}`;
/** AI拡張を 1x・元の比率のまま押したとき（本家は押せる）: 広げずに同じ構図で描き直す。 */
export const STUDIO_EXPAND_SAME_PROMPT = 'Redraw this photo at the same framing and aspect ratio with crisp, clean detail. Keep the composition, people, poses, garments, background and colors exactly as they are; add or remove nothing, and add no text, borders or watermark.';
export const STUDIO_EXPAND_PROMPT = 'This photo sits in the middle of a larger canvas whose outer margin is empty and transparent. Fill the whole empty margin by continuing the scene outward with matching background, lighting, perspective and colors, so the result reads as one wider photo. Keep the original photo area unchanged, add no new people, text, borders or watermark.';
/** 部分編集: 使った色だけを書き、オーナーの指示はそのまま引用する。指示が空なら null。 */
/** 本家の部分編集の参考画像は最大3枚（素材を選択の「選択済み: 0 / 3」）。 */
export const PARTIAL_EDIT_MAX_REFERENCES = 3;
export function studioPartialEditPrompt(instruction: string, usedColors: readonly string[], referenceCount = 0): string | null {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const colors = PARTIAL_EDIT_COLORS.filter(color => usedColors.some(used => used.toLowerCase() === color.hex.toLowerCase()));
  const count = Math.max(0, Math.min(PARTIAL_EDIT_MAX_REFERENCES, Math.floor(referenceCount)));
  // 参考画像は案内画像の後ろ（印が無いときは写真のすぐ後ろ）に並ぶ。
  const first = colors.length ? 3 : 2;
  const ordinal = (n: number) => ['first', 'second', 'third', 'fourth', 'fifth'][n - 1];
  const references = count ? ` ${count === 1 ? `The ${ordinal(first)} image is a reference image` : `Images ${first} to ${first + count - 1} are reference images`}: take the look the instruction asks for (garment, pattern, color, material or object) from ${count === 1 ? 'it' : 'them'}.` : '';
  // 印を付けずに送ったとき（本家も送れる）は、写真全体に指示をかける。案内画像は付けない。
  if (!colors.length) return `${count ? 'The first image is the photo to edit.' : 'Edit this photo.'}${references} Follow this instruction: "${text}". Change only what the instruction asks for and keep everything else exactly as it is, at the same framing and colors. Return a clean image with no text, borders or watermark.`;
  const marks = colors.map(color => `${color.name} (${color.hex}, called ${color.label} in the instruction)`).join(', ');
  return `The first image is the photo to edit. The second image is a guide with ${marks} strokes drawn over the photo; the strokes mark where to edit.${references} Apply this instruction only inside the marked areas: "${text}". ${KEEP_REST} ${NO_MARKS}`;
}

// ---- ファイル ----------------------------------------------------------------------------------------------
const TOOL_SUFFIX: Record<StudioEditToolId, string> = {
  repair: 'repair', partial: 'partial-edit', upscale: 'upscale', 'remove-background': 'no-background', clipping: 'clipping', crop: 'crop', expand: 'expand', erase: 'erase',
};
/** 結果のファイル名（元の名前の拡張子を外して、道具の印と .png を付ける）。 */
export function studioEditFileName(baseName: string | undefined, tool: StudioEditToolId, extra?: string): string {
  const base = (baseName ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  return `${base}-${TOOL_SUFFIX[tool]}${extra ? `-${extra}` : ''}.png`;
}
/** data: URL を File に（DOM を使わない。node の試験でも動く）。 */
export function studioDataUrlToFile(dataUrl: string, name: string): File {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('studio_data_url_invalid');
  const type = match[1] || 'application/octet-stream';
  const bytes = match[2] ? Uint8Array.from(atob(match[3]), char => char.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(match[3]));
  return new File([bytes], name, { type });
}

// ---- パスツール（本家の簡易エディター: 描画・削除・選択・曲線） ---------------------------------------------------------
export type StudioPenPoint = { x: number; y: number; /** 曲線の点: 次の線へ出る向きの取っ手（入る向きは点を挟んだ反対側）。 */ handle?: { x: number; y: number } };
export type StudioPenMode = 'draw' | 'delete' | 'select' | 'curve';
const mirror = (point: StudioPenPoint) => (point.handle ? { x: 2 * point.x - point.handle.x, y: 2 * point.y - point.handle.y } : point);
const outOf = (point: StudioPenPoint) => point.handle ?? point;
/** 点の並びを SVG の path に（曲線の点は三次ベジェ、ほかは直線）。closed なら最初の点へ戻して閉じる。 */
export function studioPenPathD(points: readonly StudioPenPoint[], closed: boolean): string {
  if (!points.length) return '';
  const parts = [`M${points[0].x} ${points[0].y}`];
  const segment = (from: StudioPenPoint, to: StudioPenPoint) => {
    if (!from.handle && !to.handle) return `L${to.x} ${to.y}`;
    const a = outOf(from), b = mirror(to);
    return `C${a.x} ${a.y} ${b.x} ${b.y} ${to.x} ${to.y}`;
  };
  for (let index = 1; index < points.length; index += 1) parts.push(segment(points[index - 1], points[index]));
  if (closed && points.length > 2) parts.push(segment(points[points.length - 1], points[0]), 'Z');
  return parts.join(' ');
}
/** 同じ形を canvas に描く（塗る前に beginPath 済みの context に足す）。 */
export function studioPenTrace(context: { moveTo: (x: number, y: number) => void; lineTo: (x: number, y: number) => void; bezierCurveTo: (a: number, b: number, c: number, d: number, x: number, y: number) => void; closePath: () => void },
  points: readonly StudioPenPoint[]) {
  if (points.length < 3) return;
  context.moveTo(points[0].x, points[0].y);
  const segment = (from: StudioPenPoint, to: StudioPenPoint) => {
    if (!from.handle && !to.handle) { context.lineTo(to.x, to.y); return; }
    const a = outOf(from), b = mirror(to);
    context.bezierCurveTo(a.x, a.y, b.x, b.y, to.x, to.y);
  };
  for (let index = 1; index < points.length; index += 1) segment(points[index - 1], points[index]);
  segment(points[points.length - 1], points[0]);
  context.closePath();
}
/** 押した所に近い点（なければ -1）。radius は作業用マスクの画素。 */
export function studioPenHit(points: readonly StudioPenPoint[], at: { x: number; y: number }, radius: number): number {
  let best = -1, bestDistance = radius;
  points.forEach((point, index) => { const distance = Math.hypot(point.x - at.x, point.y - at.y); if (distance <= bestDistance) { best = index; bestDistance = distance; } });
  return best;
}

// ---- AI拡張の枠のつまみ（本家: 枠の辺と角を引いて広げる） ------------------------------------------------------------
/** 拡張後の枠（width×height）と、その中で元の画像を置く左上（x, y）。 */
export type StudioExpandFrame = { width: number; height: number; x: number; y: number };
/**
 * 枠のつまみを引いたあとの枠。引いた辺だけが動き、反対の辺と元の画像は動かない。元の画像より内へは縮まず、
 * 1辺は EXPAND_MAX_SIZE（4096）まで。dx・dy は元の画像の画素。
 */
export function studioExpandDrag(image: { width: number; height: number }, frame: StudioExpandFrame, handle: StudioCropHandle, dx: number, dy: number): StudioExpandFrame {
  if (handle === 'move') return frame;
  let left = -frame.x, top = -frame.y, right = frame.width - frame.x, bottom = frame.height - frame.y;
  if (handle.includes('w')) left = Math.max(right - EXPAND_MAX_SIZE, Math.min(0, left + dx));
  if (handle.includes('e')) right = Math.min(left + EXPAND_MAX_SIZE, Math.max(image.width, right + dx));
  if (handle.includes('n')) top = Math.max(bottom - EXPAND_MAX_SIZE, Math.min(0, top + dy));
  if (handle.includes('s')) bottom = Math.min(top + EXPAND_MAX_SIZE, Math.max(image.height, bottom + dy));
  left = Math.round(left); top = Math.round(top); right = Math.round(right); bottom = Math.round(bottom);
  return { width: right - left, height: bottom - top, x: 0 - left || 0, y: 0 - top || 0 };
}
