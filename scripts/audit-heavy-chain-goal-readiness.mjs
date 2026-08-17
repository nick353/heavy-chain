#!/usr/bin/env node

import fs from 'node:fs';

const activePaths = [
  'src',
  'supabase/functions',
  'supabase/config.toml',
  'scripts/deploy-edge-functions.sh',
  'scripts/check-env.mjs',
  'package.json',
];
const read = (file) => {
  if (!fs.existsSync(file)) return '';
  if (fs.statSync(file).isDirectory()) {
    return fs.readdirSync(file, { withFileTypes: true })
      .map((entry) => read(`${file}/${entry.name}`))
      .join('\n');
  }
  return fs.readFileSync(file, 'utf8');
};
const activeText = activePaths.map(read).join('\n');
const migrationPath = fs.readdirSync('supabase/migrations').find((name) => name.endsWith('_retire_legacy_image_provider.sql'));
const checks = [
  { id: 'retired_provider_runtime_removed', passed: !/runway|runway_mcp|local-runway/i.test(activeText) },
  { id: 'openai_adapter_present', passed: activeText.includes('imageProvider.ts') && activeText.includes('OPENAI_IMAGE_API_KEY') },
  { id: 'retirement_migration_present', passed: Boolean(migrationPath) },
];
const summary = {
  schema: 'heavy-chain.goal-readiness.v2',
  capturedAt: new Date().toISOString(),
  objective: 'Retire the legacy image provider and keep OpenAI as the hosted image-generation path.',
  irreversibleActions: { externalApiCall: 'not_touched', generationSubmit: 'not_clicked', migrationApply: 'not_run', deploy: 'not_run' },
  checks,
  ok: checks.every((check) => check.passed),
  proofLimits: [
    'This static verifier cannot establish whether the retirement migration was applied in production; use the official Supabase readback artifact for that claim.',
    'This static verifier cannot establish whether Edge Functions are deployed in production; use the official function-status/version readback artifact for that claim.',
  ],
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
