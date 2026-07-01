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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const protectedBrandTermMatches = (text: string, term: string) => {
  const normalized = term.toLowerCase();
  if (/^[a-z0-9][a-z0-9\s'-]*[a-z0-9]$/.test(normalized)) {
    const compact = normalized.replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${compact}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(normalized);
};

const stringifySafetyValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (!isRecord(value) && !Array.isArray(value)) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

export const validateLegalSafetyInput = (values: unknown[]) => {
  const text = values
    .map(stringifySafetyValue)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

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
