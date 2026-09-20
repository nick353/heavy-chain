import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  scanHeavySupabaseCloudflareMigrationAudit,
} from './verify-heavy-supabase-cloudflare-migration-audit.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(files, callback) {
  const root = await mkdtemp(join(tmpdir(), 'heavy-chain-migration-audit-'));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, 'utf8');
    }
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('current runtime audit is deterministic and read-only', () => {
  const first = scanHeavySupabaseCloudflareMigrationAudit({ root: repoRoot });
  const second = scanHeavySupabaseCloudflareMigrationAudit({ root: repoRoot });
  assert.deepEqual(first, second);
  assert.equal(first.schema, 'heavy-chain.supabase-cloudflare-migration-audit.v1');
  assert.equal(first.copyAllowed, false);
  assert.equal(first.sourceDeleteAllowed, false);
  assert.equal(first.migrationGates.copyAllowed, false);
  assert.equal(first.migrationGates.sourceDeleteAllowed, false);
  assert.equal(first.migrationGates.externalActionsDisabled.ok, true);
});

test('reachable runtime markers fail while comments, tests, and legacy inventory do not', async () => {
  await fixture({
    'src/live.ts': `// https://example.supabase.co\nexport const value = fetch('https://example.supabase.co/rest/v1/items');\n`,
    'src/live.test.ts': `const fixture = 'https://example.supabase.co/rest/v1/items';\n`,
    'cloudflare/heavy-api/src/comment.ts': '/* supabase.auth.getUser() */\nexport const ok = true;\n',
    'cloudflare/heavy-web/src/env.ts': 'export const key = import.meta.env.VITE_SUPABASE_URL;\n',
    'supabase/functions/legacy/index.ts': "import '@supabase/supabase-js';\n",
    'scripts/deploy-edge-functions.sh': '#!/bin/sh\nsupabase functions deploy legacy\n',
  }, (root) => {
    const result = scanHeavySupabaseCloudflareMigrationAudit({ root });
    assert.equal(result.ok, false);
    assert.equal(result.counts.runtimeMarkers, 2);
    assert.deepEqual(result.envVariables, ['VITE_SUPABASE_URL']);
    assert.equal(result.legacy.functionDirectories.includes('supabase/functions/legacy'), true);
    assert.equal(result.legacy.manualScripts.some(({ path }) => path === 'scripts/deploy-edge-functions.sh'), true);
    assert.deepEqual(result.findings.map(({ path, marker }) => [path, marker]), [
      ['cloudflare/heavy-web/src/env.ts', 'supabase-env'],
      ['src/live.ts', 'supabase-url'],
    ]);
  });
});

test('values are never emitted and clean runtime passes with retained legacy files', async () => {
  await fixture({
    'src/clean.ts': 'export const runtime = "cloudflare";\n',
    'supabase/functions/legacy/index.ts': 'export const retained = true;\n',
    'scripts/supabase-prod-verify.sh': 'SUPABASE_SERVICE_ROLE_KEY="secret-value"\n',
    'scripts/verify-g701-visible-fitting-prod-e2e.mjs': '/* HISTORICAL SOURCE: /rest/v1/legacy */\n',
    '.env.production.local': 'VITE_SUPABASE_URL=https://legacy.example.test\nSUPABASE_SERVICE_ROLE_KEY=secret-value\n',
  }, (root) => {
    const result = scanHeavySupabaseCloudflareMigrationAudit({ root });
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(result).includes('secret-value'), false);
    assert.deepEqual(result.envVariables, ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL']);
    assert.deepEqual(result.envFiles, [{
      path: '.env.production.local',
      variableNames: ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'],
    }]);
    assert.equal(JSON.stringify(result).includes('legacy.example.test'), false);
    assert.equal(result.counts.legacyFunctionFiles, 1);
    assert.equal(result.counts.manualScripts, 1);
    assert.deepEqual(result.legacy.historicalScripts, [{
      path: 'scripts/verify-g701-visible-fitting-prod-e2e.mjs',
      classification: 'retained legacy',
    }]);
  });
});
