/** Observed form values only. These are requested settings, not output-pixel proof. */
export const MODEL_TOOL_FEATURES = ['model-face', 'model-change', 'body-shape', 'clothing-size', 'pose-change', 'background-change', 'angle-change'] as const;
export type ModelToolFeature = typeof MODEL_TOOL_FEATURES[number];
export type ModelToolSettings = Record<string, string | boolean>;
export const MODEL_ASPECT_OPTIONS = ['スマート', '1:1', '2:3', '3:2', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9'] as const;
export const MODEL_RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const;
export const MODEL_BODY_MEASUREMENTS = [
  { key: 'chest', label: 'バスト/胸囲' },
  { key: 'waist', label: 'ウエスト/腹囲' },
  { key: 'hip', label: 'ヒップ' },
] as const;
export type ModelBodyMeasurement = typeof MODEL_BODY_MEASUREMENTS[number]['key'];
type BodyProfile = { heights: readonly string[]; initialHeight: string; chest: readonly [number, number]; waist: readonly [number, number]; hip: readonly [number, number] };
/** Source form observations; gender transitions while ON reset, OFF retains hidden measurements. */
export const MODEL_BODY_PROFILES: Readonly<Record<string, BodyProfile>> = {
  '男性': { heights: ['160cm', '165cm', '170cm', '175cm', '180cm', '185cm', '190cm'], initialHeight: '175cm', chest: [86, 143], waist: [62, 145], hip: [88, 132] },
  '男の子': { heights: ['100cm', '110cm', '120cm', '130cm', '140cm', '150cm', '160cm', '170cm'], initialHeight: '130cm', chest: [65, 89], waist: [58, 82], hip: [68, 86] },
  '女性': { heights: ['160cm', '165cm', '170cm', '175cm', '180cm'], initialHeight: '165cm', chest: [79, 119], waist: [26, 104], hip: [90, 122] },
  '女の子': { heights: ['100cm', '110cm', '120cm', '130cm', '140cm', '150cm', '160cm'], initialHeight: '130cm', chest: [67, 96], waist: [57, 84], hip: [70, 92] },
};
export function validModelBodyMeasurement(value: unknown, bounds: readonly [number, number]): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= bounds[0] && Number(value) <= bounds[1];
}
export function chooseModelCustomBody(settings: ModelToolSettings, enabled: boolean): ModelToolSettings {
  if (!enabled) return { ...settings, customBody: false };
  const profile = MODEL_BODY_PROFILES[String(settings.gender)];
  if (!profile) return settings;
  return { ...settings, customBody: true,
    height: typeof settings.height === 'string' && profile.heights.includes(settings.height) ? settings.height : profile.initialHeight,
    ...Object.fromEntries(MODEL_BODY_MEASUREMENTS.map(({ key }) => {
      const value = typeof settings[key] === 'string' && settings[key].trim() !== '' ? Number(settings[key]) : NaN;
      return [key, String(Number.isFinite(value) ? Math.min(profile[key][1], Math.max(profile[key][0], value)) : profile[key][0])];
    })),
  };
}
export function changeModelBodyGender(settings: ModelToolSettings, gender: string): ModelToolSettings {
  const profile = MODEL_BODY_PROFILES[gender];
  if (!profile || settings.gender === gender) return settings;
  const next = { ...settings, gender };
  if (settings.customBody === true) {
    return chooseModelCustomBody({ ...next, height: profile.initialHeight, ...Object.fromEntries(MODEL_BODY_MEASUREMENTS.map(({ key }) => [key, String(profile[key][0])])) }, true);
  }
  // Uninitialized OFF forms stay uninitialized; initialized OFF values remain hidden.
  return typeof settings.height === 'string' ? { ...next, height: profile.initialHeight } : next;
}
export const MODEL_TOOL_FIELDS: Partial<Record<ModelToolFeature, readonly { key: string; label: string; options: readonly string[]; initial: string }[]>> = {
  'body-shape': [
    { key: 'gender', label: '性別', options: ['男性', '男の子', '女性', '女の子'], initial: '男性' },
    { key: 'bodyShape', label: '体型', options: ['痩せ型', '正常', '筋肉質', 'プラスサイズ'], initial: '正常' },
  ],
  'clothing-size': [
    { key: 'clothingType', label: '服装タイプ', options: ['トップス', 'ボトムス', '全身'], initial: 'トップス' },
    { key: 'originalSize', label: '元のサイズ', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], initial: 'L' },
    { key: 'targetSize', label: '変更サイズ', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], initial: 'XXL' },
  ],
  'angle-change': [
    { key: 'horizontalAngle', label: '左右調整', options: ['左視点', '左45°', '変更なし', '右45°', '右視点'], initial: '変更なし' },
    { key: 'verticalAngle', label: '上下調整', options: ['見上げる', '変更なし', '見下ろす'], initial: '変更なし' },
    { key: 'zoom', label: 'ズーム調整', options: ['接写', '変更なし', '遠景'], initial: '変更なし' },
  ],
};
export function isModelToolFeature(feature: string): feature is ModelToolFeature {
  return (MODEL_TOOL_FEATURES as readonly string[]).includes(feature);
}
export function isModelDescriptionFeature(feature: string): feature is 'pose-change' | 'background-change' {
  return feature === 'pose-change' || feature === 'background-change';
}
export function defaultModelToolSettings(feature: ModelToolFeature): ModelToolSettings {
  return { aspectRatio: 'スマート', resolution: '1K',
    ...(feature === 'model-change' ? { keepApparelSize: false } : {}),
    ...(feature === 'body-shape' ? { customBody: false } : {}),
    ...(feature === 'angle-change' ? { backView: false } : {}),
    ...(isModelDescriptionFeature(feature) ? { inputMode: 'reference', customDescription: '' } : {}),
    ...Object.fromEntries((MODEL_TOOL_FIELDS[feature] ?? []).map(field => [field.key, field.initial])) };
}
/** No default filling on read. Missing/foreign fields are unavailable original settings. */
export function readModelToolSettings(feature: ModelToolFeature, value: unknown): ModelToolSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const fields = [{ key: 'aspectRatio', options: MODEL_ASPECT_OPTIONS }, { key: 'resolution', options: MODEL_RESOLUTION_OPTIONS }, ...(MODEL_TOOL_FIELDS[feature] ?? [])];
  const bodyKeys = ['height', ...MODEL_BODY_MEASUREMENTS.map(({ key }) => key)];
  const hasBodyMeasurements = feature === 'body-shape' && bodyKeys.some(key => Object.hasOwn(raw, key));
  const keys = fields.map(field => field.key).concat(feature === 'model-change' ? ['keepApparelSize'] : [], isModelDescriptionFeature(feature) ? ['inputMode', 'customDescription'] : [], feature === 'body-shape' ? ['customBody', ...(hasBodyMeasurements ? bodyKeys : [])] : [], feature === 'angle-change' && Object.hasOwn(raw, 'backView') ? ['backView'] : []);
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) return null;
  if (fields.some(field => typeof raw[field.key] !== 'string' || !(field.options as readonly string[]).includes(raw[field.key] as string))) return null;
  if (feature === 'model-change' && typeof raw.keepApparelSize !== 'boolean') return null;
  if (feature === 'angle-change' && Object.hasOwn(raw, 'backView') && typeof raw.backView !== 'boolean') return null;
  if (feature === 'body-shape') {
    if (typeof raw.customBody !== 'boolean' || (raw.customBody && !hasBodyMeasurements)) return null;
    if (hasBodyMeasurements) {
      const profile = MODEL_BODY_PROFILES[String(raw.gender)];
      const heights = raw.customBody ? profile.heights : Object.values(MODEL_BODY_PROFILES).flatMap(p => p.heights);
      if (typeof raw.height !== 'string' || !heights.includes(raw.height)) return null;
      for (const { key } of MODEL_BODY_MEASUREMENTS) {
        const bounds: readonly [number, number] = raw.customBody ? profile[key] : [Math.min(...Object.values(MODEL_BODY_PROFILES).map(p => p[key][0])), Math.max(...Object.values(MODEL_BODY_PROFILES).map(p => p[key][1]))];
        if (!validModelBodyMeasurement(raw[key], bounds)) return null;
      }
    }
  }
  if (isModelDescriptionFeature(feature) && (!['reference', 'custom'].includes(String(raw.inputMode)) || typeof raw.inputMode !== 'string' || typeof raw.customDescription !== 'string' || raw.customDescription.length > 800)) return null;
  return Object.fromEntries(keys.map(key => [key, raw[key] as string | boolean]));
}
/** Exact legacy two-key values are readable, but never authorize a mode or dispatch. */
export function readLegacyModelDescriptionSettings(feature: string, value: unknown): ModelToolSettings | null {
  if (!isModelDescriptionFeature(feature) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 2 || !Object.keys(raw).every(key => ['aspectRatio', 'resolution'].includes(key))
    || typeof raw.aspectRatio !== 'string' || !(MODEL_ASPECT_OPTIONS as readonly string[]).includes(raw.aspectRatio)
    || typeof raw.resolution !== 'string' || !(MODEL_RESOLUTION_OPTIONS as readonly string[]).includes(raw.resolution)) return null;
  return { aspectRatio: raw.aspectRatio, resolution: raw.resolution };
}
/** Prior four-key body settings retain only known values; custom mode remains unknown. */
export function readLegacyModelToolSettings(feature: string, value: unknown): ModelToolSettings | null {
  if (feature !== 'body-shape') return readLegacyModelDescriptionSettings(feature, value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 4 || !Object.keys(raw).every(key => ['aspectRatio', 'resolution', 'gender', 'bodyShape'].includes(key))) return null;
  if (!readModelToolSettings('body-shape', { ...raw, customBody: false })) return null;
  return { aspectRatio: raw.aspectRatio as string, resolution: raw.resolution as string, gender: raw.gender as string, bodyShape: raw.bodyShape as string };
}
export function modelToolSettingsPrompt(feature: ModelToolFeature, value: unknown): string {
  const settings = readModelToolSettings(feature, value);
  if (!settings) throw new Error('model_tool_settings_unavailable');
  return [
    ...(feature === 'model-change' ? [`アパレルサイズをキープ: ${settings.keepApparelSize ? 'オン' : 'オフ'}`] : []),
    ...(isModelDescriptionFeature(feature) ? [`入力モード: ${settings.inputMode === 'custom' ? 'カスタム' : '参考画像'}`, ...(settings.inputMode === 'custom' ? [`カスタム説明: ${settings.customDescription}`] : [])] : []),
    ...(MODEL_TOOL_FIELDS[feature] ?? []).filter(field => !(feature === 'body-shape' && settings.customBody === true && field.key === 'bodyShape')).map(field => `${field.label}: ${settings[field.key]}`),
    ...(feature === 'body-shape' ? [`カスタムボディ: ${settings.customBody ? 'オン' : 'オフ'}`, ...(settings.customBody ? [`身長: ${settings.height}`, ...MODEL_BODY_MEASUREMENTS.map(({ key, label }) => `${label}: ${settings[key]}cm`)] : [])] : []),
    ...(feature === 'angle-change' && typeof settings.backView === 'boolean' ? [`背面: ${settings.backView ? 'オン' : 'オフ'}`] : []),
    ...(feature === 'angle-change' ? ['元画像に写っていない面（背面・側面など）は、元の衣服の色と素材のまま描き、文字・ラベル・タグ・ロゴを新しく加えないでください。'] : []),
    ...(feature === 'clothing-size' ? [`${settings.clothingType === '全身' ? 'トップスとボトムス' : settings.clothingType}のサイズを${settings.originalSize}から${settings.targetSize}へ、見て分かるほどはっきり変えてください（大きくする場合は身幅・裾幅・丈・ゆとりを広げ、小さくする場合は細く短くします）。デザイン・色・体型・ポーズは変えないでください。指定した服装タイプ以外の服は元画像のまま変えず、どの服にもポケット・ロゴ・文字・縫い目などのディテールを新しく加えないでください。`] : []),
    `画像比率の指定: ${settings.aspectRatio}`, `解像度の指定: ${settings.resolution}`,
  ].join('\n');
}
