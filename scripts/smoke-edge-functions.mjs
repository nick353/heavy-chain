#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const guarded = [
  'generate-image',
  'remove-background',
  'upscale',
  'colorize',
  'generate-variations',
  'design-gacha',
  'product-shots',
  'model-matrix',
  'multilingual-banner',
  'optimize-prompt',
  'bulk-download',
];

const observedOnly = ['share-link'];
const failures = [];

function hasUnsafePersistedImageUrl(text) {
  const imageUrlAssignments = text.match(/image_url\s*:\s*[^,\n}]+/g) || [];
  return imageUrlAssignments.some((assignment) =>
    /\b(storageUrl|imageDataUrl|dataUrl|signedUrl)\b/.test(assignment) ||
    /storageUrl\s*\|\|\s*imageDataUrl/.test(assignment)
  );
}

for (const name of guarded) {
  const file = `supabase/functions/${name}/index.ts`;
  const text = readFileSync(file, 'utf8');
  if (!text.includes('reserveBrandUsage')) failures.push(`${name}: missing quota reserve`);
  if (!text.includes('completeBrandUsage')) failures.push(`${name}: missing usage completion`);
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
  if (hasUnsafePersistedImageUrl(text)) {
    failures.push(`${name}: persists signed/data URL as image_url`);
  }
}

for (const name of observedOnly) {
  const text = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
}

if (failures.length > 0) {
  console.error('Edge smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Edge smoke passed without external API calls.');
