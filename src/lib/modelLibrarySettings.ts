import { MODEL_BODY_MEASUREMENTS, MODEL_BODY_PROFILES, validModelBodyMeasurement } from './modelToolSettings';
import type { Json } from '../types/database';
import { MODEL_LIBRARY_BODY_PREVIEWS } from './modelLibraryBodyPreviewData';
export { MODEL_LIBRARY_BODY_CATALOG_SHA256 } from './modelLibraryBodyPreviewData';

export const MODEL_LIBRARY_LABEL_OPTIONS = {
  age: ['スマート', '赤ちゃん', '子供', 'ティーン', '青年', '中年', '老年'],
  nationality: ['スマート', '中国', 'アメリカ', '日本', '韓国', 'ラテンアメリカ', 'アフリカ', 'ヨーロッパ'],
  skinColor: ['スマート', '黄色い肌', '白い肌', '茶色の肌', '黒い肌'],
  bodyType: ['スマート', '痩せ型', '正常', '筋肉質', '肥満'],
} as const;
export type ModelLibraryMode = 'label' | 'custom';
export type ModelLibrarySettings = Record<string, Json> & { modelLibraryVersion: 1; inputMode: ModelLibraryMode };
const labelKeys = ['gender', 'half', ...Object.keys(MODEL_LIBRARY_LABEL_OPTIONS)];
export const MODEL_LIBRARY_SIMILARITIES = ['一致', '類似'] as const;
const customKeys = ['customGender', 'height', ...MODEL_BODY_MEASUREMENTS.map(({ key }) => key), 'customSimilarity', 'customPrompt'];
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const freshLabels = () => ({ gender: '男性', half: false, age: 'スマート', nationality: 'スマート', skinColor: 'スマート', bodyType: 'スマート' });
const freshCustom = () => ({ customGender: '男性', height: '175cm', chest: '86', waist: '62', hip: '88', customSimilarity: '一致', customPrompt: '' });
/** Fresh user inputs only; saved records are never completed with these defaults. */
export const defaultModelLibrarySettings = (): ModelLibrarySettings => ({ modelLibraryVersion: 1, inputMode: 'label', ...freshLabels() });
export const isModelLibraryFeature = (feature: string): feature is 'model-library' | 'model-custom' => feature === 'model-library' || feature === 'model-custom';

const previewGenders: Record<string, string> = { 男性: 'Male', 男の子: 'Boy', 女性: 'Missy', 女の子: 'Girl' };
const bodyRows = (gender: string, height: string) => MODEL_LIBRARY_BODY_PREVIEWS.filter(row => row[0] === previewGenders[gender] && row[1] === Number(height.replace(/cm$/, '')));
/** Bounds depend on both gender and height in the source form. */
export function modelLibraryBodyProfile(gender: string, height: string) {
  const base = MODEL_BODY_PROFILES[gender];
  if (!base || !base.heights.includes(height)) return null;
  const rows = bodyRows(gender, height);
  if (!rows.length) return null;
  const bounds = (column: 2 | 3 | 4): readonly [number, number] => [Math.ceil(Math.min(...rows.map(row => row[column]))), Math.ceil(Math.max(...rows.map(row => row[column])))];
  return { ...base, chest: bounds(2), waist: bounds(3), hip: bounds(4) };
}
/** Select the source's closest measurements, preferring a preview within all requested dimensions. */
export function modelLibraryBodyPreview(value: unknown): string | null {
  const settings = readModelLibrarySettings(value);
  if (!settings || settings.inputMode !== 'custom') return null;
  const rows = bodyRows(String(settings.customGender), String(settings.height));
  const requested = [Number(settings.chest), Number(settings.waist), Number(settings.hip)];
  const within = rows.filter(row => requested.every((number, index) => (row[index + 2] as number) <= number));
  const score = (row: typeof rows[number]) => requested.reduce((sum, number, index) => sum + Math.abs((row[index + 2] as number) - number) / number, 0);
  const match = (within.length ? within : rows).reduce((best, row) => score(row) < score(best) ? row : best);
  return `/lightchain-assets/model-body/${match[5]}.webp`;
}

const validLabels = (raw: Record<string, unknown>) => ['男性', '女性'].includes(String(raw.gender)) && typeof raw.half === 'boolean'
  && Object.entries(MODEL_LIBRARY_LABEL_OPTIONS).every(([key, choices]) => typeof raw[key] === 'string' && (choices as readonly string[]).includes(raw[key] as string));
const validCustom = (raw: Record<string, unknown>) => {
  const profile = modelLibraryBodyProfile(String(raw.customGender), String(raw.height));
  return profile !== null && typeof raw.height === 'string' && profile.heights.includes(raw.height)
    && MODEL_BODY_MEASUREMENTS.every(({ key }) => validModelBodyMeasurement(raw[key], profile[key]))
    && MODEL_LIBRARY_SIMILARITIES.includes(raw.customSimilarity as typeof MODEL_LIBRARY_SIMILARITIES[number])
    && typeof raw.customPrompt === 'string' && raw.customPrompt.length <= 800 && !/[\u0000\u007f]/.test(raw.customPrompt);
};

export function readModelLibrarySettings(value: unknown): ModelLibrarySettings | null {
  if (!record(value) || value.modelLibraryVersion !== 1 || !['label', 'custom'].includes(String(value.inputMode))) return null;
  const allowed = ['modelLibraryVersion', 'inputMode', ...labelKeys, ...customKeys];
  if (Object.keys(value).some(key => !allowed.includes(key))) return null;
  const hasLabels = labelKeys.some(key => Object.hasOwn(value, key));
  const hasCustom = customKeys.some(key => Object.hasOwn(value, key));
  if ((value.inputMode === 'label' || hasLabels) && !validLabels(value)) return null;
  if ((value.inputMode === 'custom' || hasCustom) && !validCustom(value)) return null;
  return Object.fromEntries(Object.entries(value)) as ModelLibrarySettings;
}

/** Exact old label records carry a mode, skinTone and an on/off half switch. */
export function readLegacyModelLibrarySettings(value: unknown): ModelLibrarySettings | null {
  if (!record(value) || value.customMode !== 'ラベル') return null;
  const half = value.half === 'オン' ? true : value.half === 'オフ' ? false : null;
  if (half === null) return null;
  return readModelLibrarySettings({ modelLibraryVersion: 1, inputMode: 'label', gender: value.gender, half,
    age: value.age, nationality: value.nationality, skinColor: value.skinTone, bodyType: value.bodyType });
}

/** A deliberate mode selection initializes new inputs while preserving previously edited values. */
export function chooseModelLibraryMode(value: ModelLibrarySettings, inputMode: ModelLibraryMode): ModelLibrarySettings {
  return { ...value, ...(inputMode === 'label' && !labelKeys.some(key => Object.hasOwn(value, key)) ? freshLabels() : {}),
    ...(inputMode === 'custom' && !customKeys.some(key => Object.hasOwn(value, key)) ? freshCustom() : {}), inputMode };
}
export function changeModelLibraryGender(value: ModelLibrarySettings, customGender: string): ModelLibrarySettings {
  const profile = MODEL_BODY_PROFILES[customGender];
  if (!profile || customGender === value.customGender) return value;
  const height = typeof value.height === 'string' && profile.heights.includes(value.height) ? value.height : profile.initialHeight;
  return resetModelLibraryBody({ ...value, customGender }, height);
}
export function changeModelLibraryHeight(value: ModelLibrarySettings, height: string): ModelLibrarySettings {
  return height === value.height ? value : resetModelLibraryBody(value, height);
}
function resetModelLibraryBody(value: ModelLibrarySettings, height: string): ModelLibrarySettings {
  const profile = modelLibraryBodyProfile(String(value.customGender), height);
  if (!profile) return value;
  return { ...value, height, ...Object.fromEntries(MODEL_BODY_MEASUREMENTS.map(({ key }) => [key, String(profile[key][0])])) };
}

/** 'スマート' is the stored "let the AI choose" value; sent as-is, 体型: スマート reads as "slim". */
const promptOption = (option: unknown) => option === 'スマート' ? 'おまかせ（指定なし）' : String(option);

export function modelLibrarySettingsPrompt(value: unknown): string {
  const settings = readModelLibrarySettings(value);
  if (!settings) throw new Error('model_library_settings_unavailable');
  return settings.inputMode === 'label'
    ? ['入力モード: ラベル', `性別: ${settings.gender}`, `ハーフ: ${settings.half ? 'オン' : 'オフ'}`,
      `年齢: ${promptOption(settings.age)}`, `国籍: ${promptOption(settings.nationality)}`, `肌の色: ${promptOption(settings.skinColor)}`, `体型: ${promptOption(settings.bodyType)}`].join('\n')
    : ['入力モード: カスタム', `性別: ${settings.customGender}`, `身長: ${settings.height}`,
      ...MODEL_BODY_MEASUREMENTS.map(({ key, label }) => `${label}: ${settings[key]}cm`),
      `顔の参考程度: ${settings.customSimilarity}`,
      '顔の参考図は同じ人物の顔・髪の参考です。衣服画像として扱わず、指定された体型の専用モデルを生成してください。',
      '画像1は顔の参考図、画像2は体型の参考図です。顔の参考程度が一致なら画像1の顔を保持し、類似なら似た顔にしてください。画像2の体型と指定寸法を参考にし、顔は画像1を使ってください。',
      '縦長の全身モデル写真として、頭頂から両足のつま先までを画面内に収めてください。頭の上と足元に余白を取り、頭・腕・脚・足を画面端で切らず、体型が確認できる距離から撮影してください。',
      typeof settings.customPrompt === 'string' && settings.customPrompt ? `プロンプト: ${settings.customPrompt}` : ''].filter(Boolean).join('\n');
}
