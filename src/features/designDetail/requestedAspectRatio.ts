/**
 * The frame the user asked for in a design / marketing chat. Light draws 「Instagram用の正方形の宣伝画像」 as a 2048×2048
 * square (measured 2026-11-11); Heavy ignored the wording and kept the garment photo's portrait frame, so the same
 * request came back 1696×2528. Only explicit wording counts: a ratio such as 「1:1」, or a frame word (正方形・縦長・横長)
 * that describes the image, never a garment part (「正方形のポケット」「縦長のシルエット」). Exported for tests.
 */

/** The ratios the image API accepts (cloudflare/heavy-api/src/image-ai-contracts.ts). */
export const SUPPORTED_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '2:3', '3:2'] as const;
export type SupportedAspectRatio = typeof SUPPORTED_ASPECT_RATIOS[number];

const supported = new Set<string>(SUPPORTED_ASPECT_RATIOS);
const EXPLICIT = /(?<![\d.])(\d{1,2})\s*[:：×x]\s*(\d{1,2})(?![\d.])/g;
const FRAME_WORDS: ReadonlyArray<readonly [RegExp, SupportedAspectRatio]> = [
  [/正方形|スクエア|square/i, '1:1'],
  [/縦長|縦型|portrait/i, '2:3'],
  [/横長|横型|landscape/i, '3:2'],
];
/** What a frame word must lead to (within a few characters) to describe the image itself. */
const IMAGE_NOUN = /画像|ビジュアル|バナー|投稿|サイズ|比率|フォーマット|写真|ポスター|広告|フィード|サムネ|image|post|format|banner/i;
/** Garment parts and patterns that frame words also describe. */
const GARMENT_PART = /ポケット|シルエット|柄|模様|ボタン|パッチ|ロゴ|プリント|ライン|ネック|襟|カラー|袖|裾|ステッチ|pocket|silhouette|pattern/i;
/** Story / reel / short-video placements are 9:16 even without a frame word. */
const VERTICAL_PLACEMENT = /(?:ストーリーズ|ストーリー|リール|reels?|tiktok|ショート動画)(?:用|向け|に|の)/i;

/** 「1080×1080」「1080x1920px」: pixel sizes count when they sit within 3% of a supported ratio. */
const PIXELS = /(?<!\d)(\d{3,4})\s*[×xX*]\s*(\d{3,4})(?!\d)/g;
const closestRatio = (width: number, height: number): SupportedAspectRatio | null => {
  let best: SupportedAspectRatio | null = null; let bestError = 0.03;
  for (const ratio of SUPPORTED_ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const error = Math.abs(width / height - w / h) / (w / h);
    if (error <= bestError) { best = ratio; bestError = error; }
  }
  return best;
};

const fromText = (text: string): SupportedAspectRatio | null => {
  for (const match of text.matchAll(EXPLICIT)) {
    const ratio = `${Number(match[1])}:${Number(match[2])}`;
    if (supported.has(ratio)) return ratio as SupportedAspectRatio;
  }
  for (const match of text.matchAll(PIXELS)) {
    const ratio = closestRatio(Number(match[1]), Number(match[2]));
    if (ratio) return ratio;
  }
  for (const [word, ratio] of FRAME_WORDS) {
    const pattern = new RegExp(word.source, `${word.flags.replace('g', '')}g`);
    for (const match of text.matchAll(pattern)) {
      const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 16).split(/[。\n]/)[0];
      const noun = IMAGE_NOUN.exec(after);
      if (noun && !GARMENT_PART.test(after.slice(0, noun.index))) return ratio;
    }
  }
  return VERTICAL_PLACEMENT.test(text) ? '9:16' : null;
};

/**
 * The user's own request decides first; the assistant's design direction (after "Design direction:", see
 * imagePrompt.ts) only fills in when the user named no frame.
 */
export function requestedAspectRatio(prompt: string): SupportedAspectRatio | null {
  const [request, direction = ''] = prompt.split(/\n\nDesign direction:\n/);
  return fromText(request) ?? fromText(direction);
}
