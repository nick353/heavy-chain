/**
 * Light's account menu has 「透かし（ウォーターマーク）表示」. Heavy keeps the switch per user in this browser and
 * stamps downloaded images while it is on. Layout tells this module who is signed in; downloads read it.
 */
const storageKey = (userId: string) => `heavy:watermark-display:v1:${userId}`;

let activeUserId: string | null = null;

export const WATERMARK_TEXT = 'Heavy Chain';

export const setWatermarkUser = (userId: string | null | undefined) => {
  activeUserId = userId || null;
};

export const readWatermarkPreference = (userId: string | null | undefined): boolean => {
  if (!userId) return false;
  try { return globalThis.localStorage?.getItem(storageKey(userId)) === '1'; } catch { return false; }
};

export const writeWatermarkPreference = (userId: string | null | undefined, on: boolean) => {
  if (!userId) return;
  try { globalThis.localStorage?.setItem(storageKey(userId), on ? '1' : '0'); } catch { /* storage unavailable */ }
};

export const isDownloadWatermarkOn = () => readWatermarkPreference(activeUserId);

/** Bottom-right label, sized to the image so it reads the same on a 512px thumbnail and a 4K export. */
export const watermarkLayout = (width: number, height: number) => {
  const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.04));
  const margin = Math.round(fontSize * 0.8);
  return { fontSize, x: width - margin, y: height - margin };
};

export const drawWatermark = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const { fontSize, x, y } = watermarkLayout(width, height);
  context.save();
  context.font = `600 ${fontSize}px sans-serif`;
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = Math.max(2, fontSize / 6);
  context.fillStyle = 'rgba(255, 255, 255, 0.75)';
  context.fillText(WATERMARK_TEXT, x, y);
  context.restore();
};
