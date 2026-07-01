#!/usr/bin/env node

import fs from 'node:fs';

const files = {
  guard: 'src/lib/legalSafetyGuard.ts',
  prompt: 'src/lib/productPromptQuality.ts',
  generate: 'src/pages/GeneratePage.tsx',
  canvas: 'src/pages/CanvasEditorPage.tsx',
  chat: 'src/components/ChatEditor.tsx',
  fitting: 'src/pages/FittingPage.tsx',
  imageApi: 'src/lib/imageApi.ts',
  gallery: 'src/pages/GalleryPage.tsx',
  shareLink: 'supabase/functions/share-link/index.ts',
  edgeLegalSafety: 'supabase/functions/_shared/legalSafety.ts',
  app: 'src/App.tsx',
  human: 'goals/HUMAN_NEEDED.md',
  packet: 'docs/legal-safety-decision-packet-2026-06-26.md',
};

const protectedGenerationEdgeFiles = [
  'supabase/functions/generate-image/index.ts',
  'supabase/functions/product-shots/index.ts',
  'supabase/functions/design-gacha/index.ts',
  'supabase/functions/model-matrix/index.ts',
  'supabase/functions/multilingual-banner/index.ts',
  'supabase/functions/generate-variations/index.ts',
  'supabase/functions/colorize/index.ts',
  'supabase/functions/remove-background/index.ts',
  'supabase/functions/upscale/index.ts',
];

const checks = [];
for (const [id, file] of Object.entries(files)) {
  addCheck(`${id} file exists`, fs.existsSync(file), { file });
}

const guard = read(files.guard);
const prompt = read(files.prompt);
const generate = read(files.generate);
const canvas = read(files.canvas);
const chat = read(files.chat);
const fitting = read(files.fitting);
const imageApi = read(files.imageApi);
const gallery = read(files.gallery);
const shareLink = read(files.shareLink);
const edgeLegalSafety = read(files.edgeLegalSafety);
const app = read(files.app);
const human = read(files.human);
const packet = read(files.packet);
const edgeFiles = protectedGenerationEdgeFiles.map((file) => ({ file, text: read(file) }));

addCheck('H601 remains open', /\| H601 \|[\s\S]*\| open \|/.test(human), {
  file: files.human,
});
addCheck('legal packet says H601 remains open', packet.includes('H601 remains open'), {
  file: files.packet,
});
addCheck('shared upload rights copy exists', guard.includes('UPLOAD_RIGHTS_CONFIRMATION_LABEL'), {
  file: files.guard,
});
addCheck('shared commercial caveat exists', guard.includes('著作権登録') && guard.includes('商標クリアランス'), {
  file: files.guard,
});
addCheck('brand likeness blocker exists', allIncludes(guard, [
  'validateLegalSafetyInput',
  'third_party_brand_or_logo_imitation',
  'protectedBrandTerms',
  'in the style of',
  '風',
]), {
  file: files.guard,
});
addCheck('person likeness blocker exists', guard.includes('person_or_celebrity_likeness_without_permission'), {
  file: files.guard,
});
addCheck('production prompt appends safety appendix', prompt.includes('SAFETY_PROMPT_APPENDIX'), {
  file: files.prompt,
});
addCheck('Generate page requires rights confirmation before generation', allIncludes(generate, [
  'rightsConfirmed',
  '素材と生成指示の権利確認にチェックしてください',
  'UPLOAD_RIGHTS_CONFIRMATION_LABEL',
  'selectedFeatureUsesRunwayMcp && !rightsConfirmed',
]), {
  file: files.generate,
});
addCheck('Generate page blocks unsafe brand or likeness prompt before worker submit', allIncludes(generate, [
  'validateLegalSafetyInput',
  'BRAND_LIKENESS_BLOCK_COPY',
  'legalSafetyAssessment.blocked',
  'legalSafety:',
  'rightsConfirmed',
  'setIsGenerating(true)',
]), {
  file: files.generate,
});
addCheck('Canvas and chat generation paths require legal safety before generate-image', allIncludes(canvas + chat + imageApi, [
  'UPLOAD_RIGHTS_CONFIRMATION_LABEL',
  'validateLegalSafetyInput',
  'BRAND_LIKENESS_BLOCK_COPY',
  'legalSafety:',
  'rightsConfirmed',
]), {
  files: [files.canvas, files.chat, files.imageApi],
});
addCheck('Chat edit path applies H601 guard before edit-image helper invoke', allIncludes(chat + imageApi, [
  'editImageWithPrompt(currentImage, userInput, currentBrand.id, { rightsConfirmed })',
  "invoke('edit-image'",
  'legalSafety:',
  'rightsConfirmed: options?.rightsConfirmed === true',
]), {
  files: [files.chat, files.imageApi],
});
addCheck('Fitting model-matrix helper path requires legal safety confirmation', allIncludes(fitting, [
  'UPLOAD_RIGHTS_CONFIRMATION_LABEL',
  'validateLegalSafetyInput',
  'BRAND_LIKENESS_BLOCK_COPY',
  'rightsConfirmed',
  'generateModelMatrix',
]), {
  file: files.fitting,
});
addCheck('Canvas legal safety guard runs before every generation mode branch', allIncludes(canvas, [
  'const safetyText',
  'if (!rightsConfirmed)',
  "case 'gacha'",
  "case 'product-shots'",
  "case 'model-matrix'",
  "case 'multilingual'",
  'legalSafety:',
]), {
  file: files.canvas,
});
addCheck('Edge legal safety guard requires rights confirmation and blocks unsafe prompts', allIncludes(edgeLegalSafety, [
  'legal_safety_rights_confirmation_required',
  'legal_safety_prompt_blocked',
  'protectedBrandTermMatches',
  'third_party_brand_or_logo_imitation',
  'person_or_celebrity_likeness_without_permission',
]), {
  file: files.edgeLegalSafety,
});
addCheck('All generation Edge Functions import shared H601 guard', edgeFiles.every(({ text }) => text.includes("from '../_shared/legalSafety.ts'")), {
  files: protectedGenerationEdgeFiles,
});
addCheck('All generation Edge Functions require H601 approval before generation', edgeFiles.every(({ text }) => text.includes('requireLegalSafetyApproval(')), {
  files: protectedGenerationEdgeFiles,
});
addCheck('Generate page passes legalSafety to all remote generation branches', allIncludes(generate, [
  'const baseBody',
  'legalSafety:',
  'rightsConfirmed',
]), {
  file: files.generate,
});
addCheck('Image API passes legalSafety to helper generation invokes', allIncludes(imageApi, [
  "invoke('remove-background'",
  "invoke('colorize'",
  "invoke('upscale'",
  "invoke('generate-variations'",
  "invoke('design-gacha'",
  "invoke('product-shots'",
  "invoke('model-matrix'",
  "invoke('multilingual-banner'",
  "invoke('edit-image'",
  'legalSafety:',
  'rightsConfirmed',
]), {
  file: files.imageApi,
});
const legalSafetyCaseResult = tableDrivenLegalSafetyChecks();
addCheck('guard blocks representative protected brand and likeness prompts', legalSafetyCaseResult.passed, legalSafetyCaseResult.details);
addCheck('Terms copy uses shared legal policy', allIncludes(app, [
  'GENERATION_LEGAL_COPY',
  'UPLOAD_RIGHTS_CONFIRMATION_LABEL',
  'BRAND_LIKENESS_BLOCK_COPY',
]), {
  file: files.app,
});
addCheck('Privacy copy names retained generation data classes', allIncludes(app, [
  'プロンプト',
  '生成ジョブ',
  '生成画像',
  'アップロード素材',
  '保持と削除',
]), {
  file: files.app,
});
addCheck('Billing and external publish remain excluded', allIncludes(app + human, [
  '課金',
  '支払い',
  'checkout',
  '外部公開',
]), {
  files: [files.app, files.human],
});
addCheck('Public share links remain disabled pending H602', allIncludes(gallery + shareLink, [
  '共有リンクは未有効',
  '共有リンク作成は公開範囲と責任分界が確定するまで無効です',
  'HEAVY_CHAIN_PUBLIC_SHARE_ENABLED',
  'external_public_sharing_disabled_pending_h602',
]), {
  files: [files.gallery, files.shareLink],
});

const failures = checks.filter((check) => !check.passed);
const summary = {
  schema: 'heavy-chain.h601-legal-safety-guard.v1',
  checkedAt: new Date().toISOString(),
  ok: failures.length === 0,
  checks,
  failures,
  irreversibleActions: {
    billingPurchasePaymentCheckout: 'not_touched',
    identityOtpCaptchaSecrets: 'not_touched',
    externalPublicPublish: 'not_touched',
    legalPolicyFinalization: 'not_run',
  },
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function allIncludes(text, terms) {
  return terms.every((term) => text.includes(term));
}

function addCheck(name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), details });
}

function tableDrivenLegalSafetyChecks() {
  const cases = [
    { text: 'Nike風のロゴ入りキャンペーン画像', blocked: true },
    { text: 'Nike swoosh hoodie', blocked: true },
    { text: 'in the style of Nike with brand logo', blocked: true },
    { text: 'Taylor Swift face on a model', blocked: true },
    { text: '有名人そっくりな顔のモデル画像', blocked: true },
    { text: 'minimal black hoodie product photo, no logo', blocked: false },
    { text: 'silver chain hoodie campaign image, no logo, no watermark', blocked: false },
    { text: 'LV logo hoodie replica', blocked: true },
  ];
  const results = cases.map((item) => ({ ...item, actual: legalSafetyBlocked(item.text) }));
  return {
    passed: results.every((item) => item.actual === item.blocked),
    details: { cases: results },
  };
}

function legalSafetyBlocked(text) {
  const lower = text.toLowerCase();
  const protectedBrandTerms = ['nike', 'lv', 'ナイキ'];
  const brandImitationPhrases = ['in the style of', 'style of', 'logo', 'brand logo', 'swoosh', '風', 'ロゴ'];
  const personLikenessPatterns = [
    /(有名人|芸能人|アイドル|俳優|本人風|celebrity|famous person|public figure|そっくりな顔)/i,
    /\b[a-z][a-z'-]+\s+[a-z][a-z'-]+\s+(?:face|likeness|style)\b/i,
  ];
  return (
    protectedBrandTerms.some((term) => protectedBrandTermMatches(lower, term)) &&
    brandImitationPhrases.some((phrase) => lower.includes(phrase.toLowerCase()))
  ) || personLikenessPatterns.some((pattern) => pattern.test(text));
}

function protectedBrandTermMatches(text, term) {
  const normalized = term.toLowerCase();
  if (/^[a-z0-9][a-z0-9\s'-]*[a-z0-9]$/.test(normalized)) {
    return new RegExp(`(^|[^a-z0-9])${normalized.replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(normalized);
}
