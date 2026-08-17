#!/usr/bin/env node

import fs from 'node:fs';

const files = {
  edge: fs.readFileSync('supabase/functions/generate-image/index.ts', 'utf8'),
  shared: fs.readFileSync('supabase/functions/_shared/openaiImage.ts', 'utf8'),
  adapter: fs.readFileSync('supabase/functions/_shared/imageProvider.ts', 'utf8'),
  generatePage: fs.readFileSync('src/pages/GeneratePage.tsx', 'utf8'),
  imageApi: fs.readFileSync('src/lib/imageApi.ts', 'utf8'),
};
const imageProviderUnion = files.imageApi.match(/generationProvider\?:\s*([^;]+)/)?.[1] ?? '';
const checks = [
  ['server-side OpenAI helper', files.shared.includes('OPENAI_IMAGE_API_KEY') && files.shared.includes('OPENAI_API_KEY')],
  ['OpenAI generation and edit adapter', files.adapter.includes('generateOpenAiImage') && files.adapter.includes('editOpenAiImage')],
  ['generate-image OpenAI branch', files.edge.includes("selectedProvider === 'openai'") && files.edge.includes('generateOpenAiImage')],
  ['frontend defaults to OpenAI', files.generatePage.includes("VITE_GENERATION_PROVIDER || 'openai'") && files.generatePage.includes('OpenAI画像API')],
  ['image API provider union is OpenAI/Gemini-only', imageProviderUnion.includes("'openai'") && imageProviderUnion.includes("'gemini'") && !imageProviderUnion.toLowerCase().includes('runway')],
];
const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
const summary = {
  schema: 'heavy-chain.openai-provider-readiness.v1',
  capturedAt: new Date().toISOString(),
  irreversibleActions: { externalApiCall: 'not_touched', generationSubmit: 'not_clicked', deploy: 'not_run' },
  checks: checks.map(([name, passed]) => ({ name, passed })),
  ok: failures.length === 0,
  failures,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
