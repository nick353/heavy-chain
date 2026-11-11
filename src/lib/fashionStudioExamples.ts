/**
 * Light's Fashion Studio function examples (read from Light's bundle and its screens, 2026-11-11).
 * Choosing a function on the empty canvas loads that function's example: the sample garment as the main image,
 * the function's form with its sample settings, and the finished sample on the right. Heavy hosts the same
 * sample images under /lightchain-assets/flow-examples/ (converted to WebP).
 */
export type StudioFunctionId = 'text' | 'region' | 'underwear' | '3d';

const BASE = '/lightchain-assets/flow-examples/';
export const STUDIO_EXAMPLES: Readonly<Record<StudioFunctionId, { main: string; result: string; reference?: string }>> = {
  text: { main: `${BASE}fusion-main.webp`, result: `${BASE}fusion-result.webp` },
  region: { main: `${BASE}directional-main.webp`, result: `${BASE}directional-result.webp`, reference: `${BASE}directional-reference.webp` },
  underwear: { main: `${BASE}underwear-main.webp`, result: `${BASE}underwear-result.webp`, reference: `${BASE}underwear-reference.webp` },
  '3d': { main: `${BASE}flat-main.webp`, result: `${BASE}flat-result.webp` },
};

/** Light's Japanese sample instruction for テキストで生成 (71 characters on Light's form). */
export const STUDIO_TEXT_SAMPLE_PROMPT = 'ビジュアルテーマ：ハイエンドなファッション誌のような雰囲気。幻想的な印象のモデルが、ヴィンテージの一人掛けソファに座り、自然に脚を重ねている。';
/** Light's 下着のフィッティング instruction when a model image is given (図1 = the garment, 図2 = the model). */
export const STUDIO_UNDERWEAR_WITH_MODEL_PROMPT = '図2のモデル外観・ポーズ・背景を維持し、全身の服を図1に変更';
/** Light's instruction when no model image is given (its UNDERWEAR_NO_MODEL_PROMPT, translated). */
export const STUDIO_UNDERWEAR_NO_MODEL_PROMPT = '太ももから上の全身ショット。モデルが下着を着用し、少し体を斜めにして立つ。真っ白なスタジオ背景、柔らかく均一な光、商業用インナーカタログ風、リアルな肌の質感、高解像度、生地の細部まで表現、下着のフィット感を重視、自然な表情、クローズアップなし';

/** 3D画像に変換: Light's エリアを選択 (上装 / 下装 / 连身装) and 生成対象 (正面 / 背面). */
export const STUDIO_GARMENT_AREAS = [
  { value: '上装', label: 'トップス' },
  { value: '下装', label: 'ボトムス' },
  { value: '连身装', label: 'ワンピース/セットアップ' },
] as const;
export type StudioGarmentArea = (typeof STUDIO_GARMENT_AREAS)[number]['value'];
export const STUDIO_PERSPECTIVES = ['正面', '背面'] as const;
export type StudioPerspective = (typeof STUDIO_PERSPECTIVES)[number];

/** 生成設定 → 比率: 自動 keeps the main image's frame; the others are the frames Heavy's image server accepts. */
export const STUDIO_ASPECT_RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'] as const;
export type StudioAspectRatio = (typeof STUDIO_ASPECT_RATIOS)[number];
export const studioAspectRatioLabel = (value: StudioAspectRatio) => value === 'auto' ? '自動' : value;

export type StudioSettings = {
  aspectRatio: StudioAspectRatio;
  garment: StudioGarmentArea;
  perspective: StudioPerspective;
  /** The function whose example this project was created from; its sample result shows until a real result exists. */
  example: StudioFunctionId | null;
  /** The × on the reference/model thumbnail: the project stops using its reference image until a new one is added. */
  referenceOff: boolean;
};
export const DEFAULT_STUDIO_SETTINGS: StudioSettings = { aspectRatio: 'auto', garment: '连身装', perspective: '正面', example: null, referenceOff: false };
const settingsKey = (projectId: string) => `heavy-fashion-studio-settings:${projectId}`;
const isFunction = (value: unknown): value is StudioFunctionId => value === 'text' || value === 'region' || value === 'underwear' || value === '3d';
export const readStudioSettings = (projectId: string, storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage): StudioSettings => {
  try {
    const raw = projectId && storage ? storage.getItem(settingsKey(projectId)) : null;
    const value = raw ? JSON.parse(raw) as Partial<StudioSettings> : {};
    return {
      aspectRatio: STUDIO_ASPECT_RATIOS.includes(value.aspectRatio as StudioAspectRatio) ? value.aspectRatio as StudioAspectRatio : DEFAULT_STUDIO_SETTINGS.aspectRatio,
      garment: STUDIO_GARMENT_AREAS.some(area => area.value === value.garment) ? value.garment as StudioGarmentArea : DEFAULT_STUDIO_SETTINGS.garment,
      perspective: STUDIO_PERSPECTIVES.includes(value.perspective as StudioPerspective) ? value.perspective as StudioPerspective : DEFAULT_STUDIO_SETTINGS.perspective,
      example: isFunction(value.example) ? value.example : null,
      referenceOff: value.referenceOff === true,
    };
  } catch { return { ...DEFAULT_STUDIO_SETTINGS }; }
};
export const writeStudioSettings = (projectId: string, settings: StudioSettings, storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.localStorage) => {
  try { if (projectId && storage) storage.setItem(settingsKey(projectId), JSON.stringify(settings)); } catch { /* storage unavailable */ }
};

/** The prompt each function saves with its generation. 範囲指定 and 3D have no instruction field on Light's form. */
export const studioFunctionPromptText = (fn: StudioFunctionId, prompt: string, settings: Pick<StudioSettings, 'garment' | 'perspective'>) => {
  if (fn === '3d') return `${STUDIO_GARMENT_AREAS.find(area => area.value === settings.garment)?.label ?? 'ワンピース/セットアップ'}を3D画像に変換（${settings.perspective}）`;
  if (fn === 'region') return '範囲指定で生成（融合ポイント1）';
  return prompt;
};

/** Light waits up to 15 s for an example asset before showing 示例加载失败. */
export async function loadStudioExampleFile(url: string, signal?: AbortSignal): Promise<File> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) throw new Error('studio_example_asset_failed');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('studio_example_asset_failed');
    // Light names an example project Untitled, so the file is not named after the sample asset.
    return new File([blob], `Untitled.${url.split('.').pop() || 'webp'}`, { type: blob.type });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
