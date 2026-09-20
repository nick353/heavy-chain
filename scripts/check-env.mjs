#!/usr/bin/env node

const required = [
  'VITE_CLOUDFLARE_API_BASE_URL',
  'VITE_CLOUDFLARE_API_ENABLED',
  'VITE_MEDIA_PROVIDER_ORDER',
  'VITE_MEDIA_GATEWAY_URL',
  'VITE_GENERATION_PROVIDER',
  'PUBLIC_URL',
];

const requiredAny = [];

const optional = [
  'VITE_REMBG_MODEL_BASE_URL',
  'VITE_REMBG_SILUETA_MODEL_URL',
  'VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL',
  'VITE_REMBG_CLOTH_SEG_MODEL_URL',
  'VITE_EFFICIENT_SAM_ENCODER_URL',
  'VITE_EFFICIENT_SAM_DECODER_URL',
];

const missing = required.filter((key) => !process.env[key]);
const missingAny = requiredAny.filter((keys) => !keys.some((key) => process.env[key]));
const presentOptional = optional.filter((key) => Boolean(process.env[key]));

console.log(`Environment check: ${required.length - missing.length}/${required.length} required keys present.`);
console.log(`Additional secret groups present: ${missingAny.length === 0 ? 'yes' : 'no'}.`);
console.log(`Optional deployment keys present: ${presentOptional.length}/${optional.length}.`);

if (missing.length > 0 || missingAny.length > 0) {
  const missingGroups = missingAny.map((keys) => `one of: ${keys.join(' or ')}`);
  console.error(`Missing required keys: ${[...missing, ...missingGroups].join(', ')}`);
  process.exit(1);
}

console.log('Environment check passed. Secret values were not printed.');
