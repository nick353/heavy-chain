export const UPLOAD_RIGHTS_CONFIRMATION_LABEL =
  'アップロード素材と生成指示に必要な権利・許可を持っていることを確認しました';

export const GENERATION_LEGAL_COPY =
  '生成物は商用デザイン制作に利用できますが、入力素材の権利、第三者の権利、プロバイダー規約、適用法令の確認は利用者の責任です。Heavy Chainは著作権登録、商標クリアランス、独占性、各プラットフォームでの承認を保証しません。';

export const BRAND_LIKENESS_BLOCK_COPY =
  '第三者ロゴ、保護されたブランド identity、著名人・本人の許可がない人物 likeness、または他者の特徴的な作品をコピーする生成はできません。';

export const SAFETY_PROMPT_APPENDIX =
  'Rights and safety: user confirmed they have rights or permission for uploaded inputs. Do not copy third-party logos, protected brand identity, celebrity/person likeness, or another creator distinctive work. Do not imply copyright registration, trademark clearance, exclusivity, or platform approval.';

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

const stripKnownSafetyInstructions = (text: string) => {
  return safetyInstructionPhrases.reduce(
    (currentText, phrase) => currentText.replaceAll(phrase, ' '),
    text,
  );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const protectedBrandTermMatches = (text: string, term: string) => {
  const normalized = term.toLowerCase();
  if (/^[a-z0-9][a-z0-9\s'-]*[a-z0-9]$/.test(normalized)) {
    const compact = escapeRegExp(normalized).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${compact}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(normalized);
};

export interface LegalSafetyAssessment {
  blocked: boolean;
  reasons: string[];
}

export const validateLegalSafetyInput = (values: Array<string | null | undefined>): LegalSafetyAssessment => {
  const text = stripKnownSafetyInstructions(values
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase());

  const reasons: string[] = [];
  const mentionsProtectedBrand = protectedBrandTerms.some((term) => protectedBrandTermMatches(text, term));
  const requestsImitation = brandImitationPhrases.some((phrase) => text.includes(phrase.toLowerCase()));

  if (mentionsProtectedBrand && requestsImitation) {
    reasons.push('third_party_brand_or_logo_imitation');
  }
  if (personLikenessPatterns.some((pattern) => pattern.test(text))) {
    reasons.push('person_or_celebrity_likeness_without_permission');
  }

  return {
    blocked: reasons.length > 0,
    reasons,
  };
};
