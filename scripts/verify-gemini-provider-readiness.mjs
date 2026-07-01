#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outPath = args.out || 'output/playwright/gemini-provider-readiness/summary.json';

const files = {
  edge: readText('supabase/functions/generate-image/index.ts'),
  geminiShared: readText('supabase/functions/_shared/geminiImage.ts'),
  generatePage: readText('src/pages/GeneratePage.tsx'),
  imageApi: readText('src/lib/imageApi.ts'),
  packageJson: readText('package.json'),
  envExample: readText('.env.example'),
  productionEnvExample: readText('.env.production.example'),
  secrets: readText('docs/secrets.md'),
};

const checks = [];
const add = (id, passed, details = {}) => checks.push({ id, passed, details });

add('gemini_shared_provider_exists',
  files.geminiShared.includes('generateGeminiImage') &&
    files.geminiShared.includes("Deno.env.get('GEMINI_API_KEY')") &&
    files.geminiShared.includes('gemini_api_key_missing') &&
    files.geminiShared.includes('extractInlineImage'),
);

add('generate_image_defaults_to_gemini',
  files.edge.includes("return geminiProviderName()") &&
    files.edge.includes('sanitizeGenerationProvider') &&
    files.edge.includes('generateGeminiImage') &&
    files.edge.includes('geminiImageArtifact') &&
    files.edge.includes("provider: selectedProvider"),
);

add('runway_approval_only_for_runway_paths',
  files.edge.includes("if (selectedProvider === 'runway' || localWorkerRequest)") &&
    files.edge.includes('await requireRunwayMcpConnectionApproval(supabaseClient, brandId);'),
);

add('frontend_defaults_to_gemini',
  files.generatePage.includes("VITE_GENERATION_PROVIDER || 'gemini'") &&
    files.generatePage.includes('const geminiGenerationMode') &&
    files.generatePage.includes("generationProvider: 'gemini'") &&
    files.generatePage.includes('Geminiで生成') &&
    files.generatePage.includes('Runway workerは使いません'),
);

add('image_api_accepts_gemini_provider',
  files.imageApi.includes("generationProvider?: 'gemini'") &&
    files.imageApi.includes('images?: Array') &&
    files.imageApi.includes('provider?: string'),
);

add('env_and_docs_explain_gemini_runtime',
  files.envExample.includes('VITE_GENERATION_PROVIDER=gemini') &&
    files.productionEnvExample.includes('GEMINI_API_KEY=replace-in-runtime-secret-store') &&
    files.secrets.includes('GEMINI_API_KEY') &&
    files.secrets.includes('VITE_GENERATION_PROVIDER=gemini'),
);

add('npm_script_registered',
  files.packageJson.includes('"verify:gemini-provider"'),
);

const summary = {
  schema: 'heavy-chain.gemini-provider-readiness.v1',
  capturedAt: new Date().toISOString(),
  outPath,
  irreversibleActions: {
    externalApiCall: 'not_touched',
    generationSubmit: 'not_clicked',
    secretReadback: 'not_read',
    deploy: 'not_run',
  },
  checks,
  ok: checks.every((check) => check.passed),
  failed: checks.filter((check) => !check.passed).map((check) => check.id),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ok: summary.ok, outPath, failed: summary.failed }, null, 2));
process.exit(summary.ok ? 0 : 1);

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--out' && next) {
      parsed.out = next;
      index += 1;
    }
  }
  return parsed;
}
