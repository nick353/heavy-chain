#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDirArg = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'output/playwright/g672-api-less-generation-readiness';
const outDir = path.resolve(repoRoot, outDirArg);

const files = {
  generatePage: 'src/pages/GeneratePage.tsx',
  imageApi: 'src/lib/imageApi.ts',
  edge: 'supabase/functions/generate-image/index.ts',
  mock: 'supabase/functions/_shared/mockImage.ts',
  openai: 'supabase/functions/_shared/openaiImage.ts',
  gemini: 'supabase/functions/_shared/geminiImage.ts',
  errors: 'src/lib/errorMessages.ts',
  quickStart: 'QUICK_START.md',
  readme: 'README.md',
};

const features = [
  'campaign-image',
  'product-shots',
  'model-matrix',
  'design-gacha',
  'scene-coordinate',
  'multilingual-banner',
  'remove-bg',
  'colorize',
  'upscale',
  'variations',
];

const checks = [];
const failures = [];

function check(name, passed, details = {}) {
  checks.push({ name, passed, details });
  if (!passed) failures.push({ name, details });
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function mockSvg(feature, index) {
  const hue = 210 + index * 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="hsl(${hue}, 28%, 92%)"/>
  <rect x="96" y="96" width="832" height="832" rx="32" fill="#151515"/>
  <path d="M382 276 C284 392 298 720 512 772 C726 720 740 392 642 276 Z" fill="#2d2d2d" stroke="#e7ded1" stroke-width="5"/>
  <path d="M332 512 C424 430 600 430 692 512" fill="none" stroke="#cbd5e1" stroke-width="18" stroke-linecap="round" stroke-dasharray="36 24"/>
  <text x="512" y="176" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="700" fill="#f8fafc">${escapeXml(feature)}</text>
  <text x="512" y="866" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="24" fill="#cbd5e1">API-less mock generation artifact</text>
</svg>`;
}

await fs.mkdir(outDir, { recursive: true });
const text = {};
for (const [key, file] of Object.entries(files)) {
  text[key] = await fs.readFile(path.join(repoRoot, file), 'utf8');
}

check('openai_helper_exists', /generateOpenAiImage/.test(text.openai) && /OPENAI_IMAGE_API_KEY/.test(text.openai));
check('gemini_helper_exists', /generateGeminiImage/.test(text.gemini) && /GEMINI_API_KEY/.test(text.gemini));
check('mock_helper_is_env_guarded', /ALLOW_MOCK_IMAGE_GENERATION/.test(text.mock) && /mock_image_generation_not_enabled/.test(text.mock));
check('edge_accepts_openai_provider', /requested === 'openai'/.test(text.edge) && /generateOpenAiImage/.test(text.edge));
check('edge_accepts_mock_provider', /requested === 'mock'/.test(text.edge) && /generateMockImage/.test(text.edge));
check('edge_persists_generation_model', /generationModel/.test(text.edge) && /generation_params: \{ width, height, provider: selectedProvider/.test(text.edge));
check('frontend_has_openai_tabs', /GPT Image 2/.test(text.generatePage) && /GPT Image 1 mini/.test(text.generatePage));
check(
  'frontend_model_cards_show_per_image_cost',
  [
    '1枚 約$0.02',
    '1枚 約$0.04',
    '1枚 約$0.0336',
    '1枚 約$0.067',
    '1枚 約$0.006-$0.211',
    '1枚 約$0.005-$0.052',
  ].every((needle) => text.generatePage.includes(needle)),
);
check('frontend_sends_selected_provider', /generationProvider: selectedGenerationModelOption\.provider/.test(text.generatePage));
check('image_api_allows_openai_and_mock', /'openai'/.test(text.imageApi) && /'mock'/.test(text.imageApi));
check('user_errors_cover_missing_keys', /OPENAI_IMAGE_API_KEY_MISSING/.test(text.errors) && /GEMINI_API_KEY_MISSING/.test(text.errors));
check('user_errors_cover_quota_and_mock', /IMAGE_PROVIDER_QUOTA_EXHAUSTED/.test(text.errors) && /MOCK_IMAGE_GENERATION_NOT_ENABLED/.test(text.errors));
check('docs_explain_two_api_keys', /GEMINI_API_KEY/.test(text.quickStart) && /OPENAI_IMAGE_API_KEY/.test(text.quickStart) && /OPENAI_IMAGE_API_KEY/.test(text.readme));

const artifacts = [];
for (const [index, feature] of features.entries()) {
  const fileName = `${String(index + 1).padStart(2, '0')}-${feature}.svg`;
  const relativePath = path.join(path.relative(repoRoot, outDir), fileName);
  await fs.writeFile(path.join(outDir, fileName), mockSvg(feature, index));
  artifacts.push({
    feature,
    path: relativePath,
    provider: 'mock',
    model: 'mock-image-provider',
    expectedUse: 'UI, DB/Storage, Gallery, Jobs, Canvas flow rehearsal without external API keys',
  });
}

const manifest = {
  ok: failures.length === 0,
  runId: `g672-api-less-generation-readiness-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  checkedAt: new Date().toISOString(),
  noExternalApiCalls: true,
  noSecretsRequired: true,
  requiredRuntimeSecretsAfterApiArrival: ['GEMINI_API_KEY', 'OPENAI_IMAGE_API_KEY'],
  optionalMockRuntimeSecretForInternalQa: 'ALLOW_MOCK_IMAGE_GENERATION=true',
  checks,
  failures,
  mockArtifacts: artifacts,
  nextHumanStep: 'Provide Gemini/OpenAI image API keys only when ready; then run one-image live probes before all-10 generation QA.',
};

await fs.writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  ok: manifest.ok,
  outDir: path.relative(repoRoot, outDir),
  checks: checks.length,
  failures,
  mockArtifacts: artifacts.length,
}, null, 2));
if (!manifest.ok) process.exit(1);
