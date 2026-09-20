#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outPath = args.out || args.output || 'output/playwright/cloudflare-generation-readiness/summary.json';
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const sourceFiles = [
  'src/lib/cloudflareApi.ts',
  'src/lib/cloudflareImageAI.ts',
  'src/lib/cloudflareProtectedImageEdit.ts',
  'src/lib/imageApi.ts',
  'src/pages/GeneratePage.tsx',
  'src/pages/CanvasEditorPage.tsx',
  'src/lib/errorMessages.ts',
];
const source = sourceFiles.map(read).join('\n');
const forbidden = [/supabase\.co/i, /@supabase\//i, /\/functions\/v1\//i, /VITE_SUPABASE_/i];
const checks = [
  ['cloudflare_provider_action_transport', source.includes('invokeProviderAction') && source.includes('/v1/provider-actions/')],
  ['generation_and_model_matrix_routes', source.includes("'generate-image'") && source.includes("'model-matrix'")],
  ['protected_edit_route', source.includes('prepareProtectedCloudflareEdit') && source.includes("'edit-image'")],
  ['durable_receipt_and_acknowledgement', source.includes('invokeDurableImageAction') && source.includes('acknowledgeDurableImageAction')],
  ['private_media_persistence', source.includes('persistProtectedImageInput') && source.includes('/v1/media')],
  ['generate_and_canvas_use_cloudflare_client', source.includes('cloudflareDataPlane') && source.includes('cloudflare_api_not_configured')],
  ['legacy_runtime_markers_absent', forbidden.every((pattern) => !pattern.test(source))],
];
const report = {
  schema: 'heavy-chain.cloudflare-generation-readiness.v1',
  capturedAt: new Date().toISOString(),
  mode: 'static-local-no-provider-submit-no-payment-no-deploy',
  irreversibleActions: { externalApiCall: 'not_touched', generationSubmit: 'not_clicked', deploy: 'not_run' },
  checks: checks.map(([id, passed]) => ({ id, passed })),
  ok: checks.every(([, passed]) => passed),
  proofLimits: [
    'This gate does not prove authenticated production generation, AI quality, R2 readback, or browser business completion.',
    'No historical Supabase test data or provider response is copied into this report.',
  ],
};
const resolved = path.resolve(outPath);
fs.mkdirSync(path.dirname(resolved), { recursive: true });
fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}
