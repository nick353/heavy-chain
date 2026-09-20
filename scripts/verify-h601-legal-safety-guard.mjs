#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const checks = [];
const files = {
  browserGuard: 'src/lib/legalSafetyGuard.ts',
  cloudflareGuard: 'cloudflare/heavy-api/src/legalSafety.ts',
  imageContract: 'cloudflare/heavy-api/src/image-ai-contracts.ts',
  imageClient: 'src/lib/cloudflareImageAI.ts',
  generate: 'src/pages/GeneratePage.tsx',
  canvas: 'src/pages/CanvasEditorPage.tsx',
  fitting: 'src/pages/FittingPage.tsx',
  app: 'src/App.tsx',
  human: 'goals/HUMAN_NEEDED.md',
};

for (const [id, file] of Object.entries(files)) {
  addCheck(`${id} file exists`, fs.existsSync(file), { file });
}

const source = Object.fromEntries(Object.entries(files).map(([id, file]) => [id, read(file)]));
const browser = source.browserGuard;
const cloudflare = source.cloudflareGuard;
const imageContract = source.imageContract;
const imageClient = source.imageClient;

addCheck('browser guard exposes shared rights and safety policy', includes(browser, [
  'UPLOAD_RIGHTS_CONFIRMATION_LABEL',
  'GENERATION_LEGAL_COPY',
  'BRAND_LIKENESS_BLOCK_COPY',
  'validateLegalSafetyInput',
  'third_party_brand_or_logo_imitation',
  'person_or_celebrity_likeness_without_permission',
]), { file: files.browserGuard });

addCheck('Cloudflare image boundary requires explicit rights and blocks unsafe prompts', includes(cloudflare, [
  'requireLegalSafetyApproval',
  'legal_safety_rights_confirmation_required',
  'legal_safety_prompt_blocked',
  'imagePayloadKeys',
  'protectedBrandTerms',
]), { file: files.cloudflareGuard });

addCheck('Cloudflare provider contract carries legal safety metadata', includes(imageContract, [
  'requireLegalSafetyApproval(body.legalSafety',
  'body.generationIntent',
  'body.legalSafety.rightsConfirmed',
]), { file: files.imageContract });

addCheck('Browser Cloudflare client keeps durable admission before provider submission', includes(imageClient, [
  'invokeDurableImageAction',
  'beforeSubmit',
  'assertCurrent',
  'Idempotency-Key',
]), { file: files.imageClient });

addCheck('Generate, Canvas, and Fitting keep the rights gate before provider calls', includes(
  `${source.generate}\n${source.canvas}\n${source.fitting}`,
  ['rightsConfirmed', 'validateLegalSafetyInput', 'legalSafety:', 'BRAND_LIKENESS_BLOCK_COPY'],
), { files: [files.generate, files.canvas, files.fitting] });

addCheck('app copy preserves the legal boundary', includes(source.app, [
  'GENERATION_LEGAL_COPY',
  'UPLOAD_RIGHTS_CONFIRMATION_LABEL',
  'BRAND_LIKENESS_BLOCK_COPY',
]), { file: files.app });

addCheck('human legal gate remains explicit and open', source.human.includes('H601') && /open/i.test(source.human), {
  file: files.human,
});

const runtimeText = `${browser}\n${cloudflare}\n${imageContract}\n${imageClient}`;
addCheck('current safety runtime has no legacy provider endpoint', !/(?:supabase\.co|\/rest\/v1|\/auth\/v1|\/functions\/v1)/i.test(runtimeText), {
  files: [files.browserGuard, files.cloudflareGuard, files.imageContract, files.imageClient],
});

const failures = checks.filter((check) => !check.passed);
const summary = {
  schema: 'heavy-chain.h601-cloudflare-legal-safety.v2',
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
if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
}
process.exit(summary.ok ? 0 : 1);

function parseArgs(rawArgs) {
  const parsed = { out: null };
  for (let index = 0; index < rawArgs.length; index += 1) {
    if (rawArgs[index] === '--out' && rawArgs[index + 1]) parsed.out = rawArgs[++index];
  }
  return parsed;
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function includes(text, terms) {
  return terms.every((term) => text.includes(term));
}

function addCheck(name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), details });
}
