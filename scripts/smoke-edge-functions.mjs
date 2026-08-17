#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

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
const serviceRoleWriteFunctions = ['marketing-workspace-artifact'];
const failures = [];
const deprecatedGeminiModelPattern = /gemini-2\.0-flash-exp(?:-image-generation)?/;

function read(path) {
  if (!existsSync(path)) {
    failures.push(`missing file: ${path}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

function hasUnsafePersistedImageUrl(text) {
  const assignments = text.match(/image_url\s*:\s*[^,\n}]+/g) || [];
  return assignments.some((assignment) =>
    /\b(storageUrl|imageDataUrl|dataUrl|signedUrl)\b/.test(assignment),
  );
}

for (const name of guarded) {
  const text = read(`supabase/functions/${name}/index.ts`);
  if (deprecatedGeminiModelPattern.test(text)) failures.push(`${name}: deprecated Gemini model reference`);
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
  if (['generate-image', 'remove-background', 'upscale', 'colorize', 'generate-variations', 'design-gacha', 'product-shots', 'model-matrix'].includes(name)) {
    if (!text.includes('reserveBrandUsage')) failures.push(`${name}: missing quota reserve`);
    if (!text.includes('completeBrandUsage')) failures.push(`${name}: missing usage completion`);
    if (!text.includes('generateProviderImage') && !text.includes('upscaleProviderImage') && !text.includes('generateOpenAiImage') && !text.includes('generateGeminiImage')) {
      failures.push(`${name}: missing hosted image provider path`);
    }
  }
  if (hasUnsafePersistedImageUrl(text)) failures.push(`${name}: persists signed/data URL as image_url`);
  if (name === 'multilingual-banner' && !text.includes('buildBannerSvg')) failures.push(`${name}: missing deterministic SVG composition`);
}

for (const name of observedOnly) {
  const text = read(`supabase/functions/${name}/index.ts`);
  if (deprecatedGeminiModelPattern.test(text)) failures.push(`${name}: deprecated Gemini model reference`);
  if (!text.includes('recordEdgeFunctionRun')) failures.push(`${name}: missing edge run observability`);
}

for (const name of serviceRoleWriteFunctions) {
  const text = read(`supabase/functions/${name}/index.ts`);
  if (deprecatedGeminiModelPattern.test(text)) failures.push(`${name}: deprecated Gemini model reference`);
  if (!text.includes('createServiceClient')) failures.push(`${name}: missing service-role client`);
  if (!text.includes('requireBrandRole')) failures.push(`${name}: missing brand role guard`);
  if (hasUnsafePersistedImageUrl(text) || !/image_url:\s*null/.test(text)) {
    failures.push(`${name}: generated_images.image_url must not persist signed/data URLs`);
  }
}

const openaiImage = read('supabase/functions/_shared/openaiImage.ts');
const imageProvider = read('supabase/functions/_shared/imageProvider.ts');
if (!openaiImage.includes("Deno.env.get('OPENAI_IMAGE_API_KEY')") && !openaiImage.includes("Deno.env.get('OPENAI_API_KEY')")) {
  failures.push('openaiImage.ts: missing server-side OpenAI key lookup');
}
if (!imageProvider.includes('generateOpenAiImage') || !imageProvider.includes('editOpenAiImage')) {
  failures.push('imageProvider.ts: OpenAI generation/edit adapter is incomplete');
}

const config = read('supabase/config.toml');
const deploy = read('scripts/deploy-edge-functions.sh');
if (/runway/i.test(config) || /runway/i.test(deploy)) failures.push('Runway reference remains in active Supabase config/deploy script');

const output = {
  schema: 'heavy-chain.edge-smoke.v2',
  capturedAt: new Date().toISOString(),
  irreversibleActions: {
    externalApiCall: 'not_touched',
    generationSubmit: 'not_clicked',
    deploy: 'not_run',
  },
  ok: failures.length === 0,
  failures,
};
console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exit(1);
