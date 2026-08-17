#!/usr/bin/env node

import fs from 'node:fs';

const generationFunctions = [
  'generate-image', 'remove-background', 'upscale', 'colorize',
  'generate-variations', 'design-gacha', 'product-shots',
  'model-matrix', 'multilingual-banner',
];
const failures = [];
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

for (const name of generationFunctions) {
  const text = read(`supabase/functions/${name}/index.ts`);
  if (!text) failures.push(`${name}: missing function`);
  if (!text.includes('requireBrandRole')) failures.push(`${name}: missing brand-role guard`);
  if (!text.includes('reserveBrandUsage')) failures.push(`${name}: missing usage reservation`);
  if (!text.includes('completeBrandUsage')) failures.push(`${name}: missing usage completion`);
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge-run audit`);
  if (/runway|runway_mcp|local-runway/i.test(text)) failures.push(`${name}: retired provider reference remains`);
}

const shared = read('supabase/functions/_shared/imageProvider.ts');
if (!shared.includes('generateOpenAiImage') || !shared.includes('editOpenAiImage')) failures.push('OpenAI provider adapter is incomplete');
for (const file of ['src/pages/GeneratePage.tsx', 'src/pages/AdminDashboard.tsx', 'src/lib/errorMessages.ts', 'src/lib/imageApi.ts']) {
  if (/runway|runway_mcp|local-runway/i.test(read(file))) failures.push(`${file}: retired provider reference remains`);
}

const report = {
  schema: 'heavy-chain.g620.security-operations.v2',
  capturedAt: new Date().toISOString(),
  mode: 'read-only-static-no-submit-no-payment-no-deploy',
  irreversibleActions: { generationSubmit: 'not_clicked', purchasePaymentCheckout: 'not_touched', deploy: 'not_run' },
  ok: failures.length === 0,
  failures,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
