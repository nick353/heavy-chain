const protectedBrandTerms = [
  'nike',
  'adidas',
  'gucci',
  'chanel',
  'louis vuitton',
  'lv',
  'supreme',
  'balenciaga',
  'prada',
  'hermes',
  'dior',
  'uniqlo',
  'zara',
  'apple',
  'disney',
  'pokemon',
  'ポケモン',
  'ナイキ',
  'アディダス',
  'グッチ',
  'シャネル',
  'ルイヴィトン',
  'シュプリーム',
  'ユニクロ',
  'ザラ',
];

const brandImitationPhrases = [
  'same as',
  'in the style of',
  'style of',
  'copy',
  'replica',
  'counterfeit',
  'knockoff',
  'swoosh',
  'monogram',
  'trademark',
  'emblem',
  'mascot',
  'character',
  'logo',
  'brand logo',
  '風',
  'ふう',
  'っぽい',
  'そっくり',
  'コピー',
  '模倣',
  '偽物',
  '商標',
  '紋章',
  'キャラクター',
  'ロゴ',
  'ブランドロゴ',
];

const personLikenessPatterns = [
  /(?:celebrity|famous person|public figure|actor|idol|singer|influencer)\s+(?:likeness|face|style)/i,
  /(?:looks like|same face as|顔を?似せ|そっくりな顔|有名人|芸能人|アイドル|俳優|本人風|celebrity|famous person|public figure)/i,
  /\b[a-z][a-z'-]+\s+[a-z][a-z'-]+\s+(?:face|likeness|style)\b/i,
];

const safetyInstructionPhrases = [
  'rights and safety: user confirmed they have rights or permission for uploaded inputs',
  'do not copy third-party logos, protected brand identity, celebrity/person likeness, or another creator distinctive work',
  'do not copy third-party logos, protected brand identity, celebrity likeness, or another creator distinctive work',
  'do not copy third-party logos, protected brand identity, person likeness, or another creator distinctive work',
  'do not imply copyright registration, trademark clearance, exclusivity, or platform approval',
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const imagePayloadKeys = new Set([
  'image',
  'imageurl',
  'image_url',
  'referenceimage',
  'referenceimageurl',
  'reference_image_url',
  'modelreferenceimageurl',
  'model_reference_image_url',
  'sourceimageurl',
  'source_image_url',
  'extractedimageurl',
  'extracted_image_url',
  'dataurl',
  'data_url',
  'src',
  'thumbnail',
  'preview',
]);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const protectedBrandTermMatches = (text: string, term: string) => {
  const normalized = term.toLowerCase();
  if (/^[a-z0-9][a-z0-9\s'-]*[a-z0-9]$/.test(normalized)) {
    const compact = normalized.replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${compact}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(normalized);
};

const stripKnownSafetyInstructions = (text: string) => {
  return safetyInstructionPhrases.reduce(
    (currentText, phrase) => currentText.replaceAll(phrase, ' '),
    text,
  );
};

const isLikelyImagePayloadString = (value: string) => {
  const trimmed = value.trim();
  const dataUrlMatch = trimmed.match(/^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataUrlMatch) return hasImageMagicHeader(dataUrlMatch[1]);
  if (!/^[A-Za-z0-9+/=\s]{200,}$/.test(trimmed)) return false;
  return hasImageMagicHeader(trimmed);
};

const hasImageMagicHeader = (base64Value: string) => {
  const compactBase64 = base64Value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(compactBase64)) return false;
  try {
    const binary = atob(compactBase64.slice(0, 64));
    const bytes = Array.from(binary).map((char) => char.charCodeAt(0));
    const header = bytesToHex(bytes.slice(0, 12));
    return header.startsWith('89504e47')
      || header.startsWith('ffd8ff')
      || header.startsWith('47494638')
      || header.startsWith('52494646');
  } catch {
    return false;
  }
};

const bytesToHex = (bytes: number[]) => bytes
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const stringifySafetyValue = (value: unknown, key = '', seen = new WeakSet<object>()): string => {
  if (typeof value === 'string') {
    if (imagePayloadKeys.has(key.toLowerCase()) && isLikelyImagePayloadString(value)) return '';
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '';
    seen.add(value);
    return value
      .map((item) => stringifySafetyValue(item, key, seen))
      .filter(Boolean)
      .join(' ');
  }
  if (!isRecord(value)) return '';
  if (seen.has(value)) return '';
  seen.add(value);
  try {
    return Object.entries(value)
      .map(([entryKey, entryValue]) => stringifySafetyValue(entryValue, entryKey, seen))
      .filter(Boolean)
      .join(' ');
  } catch {
    return '';
  }
};

export const validateLegalSafetyInput = (values: unknown[]) => {
  const text = stripKnownSafetyInstructions(values
    .map((value) => stringifySafetyValue(value, '', new WeakSet<object>()))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase());

  const reasons: string[] = [];
  const mentionsProtectedBrand = protectedBrandTerms.some((term) =>
    protectedBrandTermMatches(text, escapeRegExp(term))
  );
  const requestsImitation = brandImitationPhrases.some((phrase) => text.includes(phrase.toLowerCase()));

  if (mentionsProtectedBrand && requestsImitation) {
    reasons.push('third_party_brand_or_logo_imitation');
  }
  if (personLikenessPatterns.some((pattern) => pattern.test(text))) {
    reasons.push('person_or_celebrity_likeness_without_permission');
  }

  return { blocked: reasons.length > 0, reasons };
};

export const requireLegalSafetyApproval = (legalSafety: unknown, values: unknown[]) => {
  if (!isRecord(legalSafety) || legalSafety.rightsConfirmed !== true) {
    throw new Error('legal_safety_rights_confirmation_required');
  }
  const assessment = validateLegalSafetyInput(values);
  if (assessment.blocked) {
    throw new Error(`legal_safety_prompt_blocked:${assessment.reasons.join(',')}`);
  }
};
