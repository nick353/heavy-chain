#!/usr/bin/env node

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PUBLIC_URL',
];

const requiredAny = [['OPENAI_API_KEY', 'OPENAI_IMAGE_API_KEY']];

const optional = [
  'VITE_REMBG_MODEL_BASE_URL',
  'VITE_REMBG_SILUETA_MODEL_URL',
  'VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL',
  'VITE_REMBG_CLOTH_SEG_MODEL_URL',
  'VITE_EFFICIENT_SAM_ENCODER_URL',
  'VITE_EFFICIENT_SAM_DECODER_URL',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_ACCESS_TOKEN',
  'OPENAI_IMAGE_MODEL',
  'OPENAI_IMAGE_EDIT_MODEL',
  'OPENAI_IMAGE_BASE_URL',
];

const missing = required.filter((key) => !process.env[key]);
const missingAny = requiredAny.filter((keys) => !keys.some((key) => process.env[key]));
const presentOptional = optional.filter((key) => Boolean(process.env[key]));

console.log(`Environment check: ${required.length - missing.length}/${required.length} required keys present.`);
console.log(`OpenAI server key group present: ${missingAny.length === 0 ? 'yes' : 'no'}.`);
console.log(`Optional deployment keys present: ${presentOptional.length}/${optional.length}.`);

if (missing.length > 0 || missingAny.length > 0) {
  const missingGroups = missingAny.map((keys) => `one of: ${keys.join(' or ')}`);
  console.error(`Missing required keys: ${[...missing, ...missingGroups].join(', ')}`);
  process.exit(1);
}

console.log('Environment check passed. Secret values were not printed.');
