import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  FUNCTION_ENTRYPOINTS,
  validateHeavyEdgeFunctionDispositionMatrix,
} from './verify-heavy-edge-function-disposition.mjs';

const guarantees = { persistence: 'none', idempotency: 'none', retry: 'none', dedup: 'none', receipt: 'none', reconciliation: 'none', recovery: 'none' };
const baseEntry = (name) => ({ name, sourceEvidence: { path: `supabase/functions/${name}`, entrypoint: name }, caller: 'fixture caller', authPermissions: 'fixture auth boundary', dbStorageDeps: [], externalEffects: [], cloudflareTarget: null, status: 'unrepresented', asyncGuarantees: guarantees, unresolvedItems: ['fixture disposition'] });

async function withFixture(mutator, callback) {
  const root = await mkdtemp(join(tmpdir(), 'heavy-edge-disposition-'));
  try {
    for (const name of FUNCTION_ENTRYPOINTS) {
      await mkdir(join(root, 'supabase/functions', name), { recursive: true });
      await writeFile(join(root, 'supabase/functions', name, 'index.ts'), 'Deno.serve(() => new Response("fixture"));\n', 'utf8');
    }
    await mkdir(join(root, 'cloudflare/heavy-api/src'), { recursive: true });
    await writeFile(join(root, 'cloudflare/heavy-api/src/fixture.ts'), 'export function handleOk() {}\nif (url.pathname === "/v1/ok") return handleOk();\n', 'utf8');
    const entries = FUNCTION_ENTRYPOINTS.map(baseEntry);
    entries[1] = { ...entries[1], status: 'represented', cloudflareTarget: { route: '/v1/ok', handler: 'handleOk', evidencePath: 'cloudflare/heavy-api/src/fixture.ts' } };
    const matrix = { schema: 'heavy-chain-edge-function-disposition-matrix.v1', entries };
    return await callback(root, mutator(matrix));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('normal matrix covers all 21 and validates while preparation remains incomplete', async () => {
  await withFixture((matrix) => matrix, (_root, matrix) => {
    const result = validateHeavyEdgeFunctionDispositionMatrix(matrix, { root: _root });
    assert.equal(result.contractValid, true);
    assert.equal(result.migrationPreparationComplete, false);
    assert.equal(result.counts.expectedEntrypoints, 21);
    assert.equal(result.counts.entries, 21);
  });
});

test('missing and duplicate entrypoints are rejected', async () => {
  await withFixture((matrix) => ({ ...matrix, entries: [...matrix.entries.slice(1), matrix.entries[1]] }), (root, matrix) => {
    const result = validateHeavyEdgeFunctionDispositionMatrix(matrix, { root });
    assert.equal(result.contractValid, false);
    assert.equal(result.issues.some((item) => item.code === 'missing_entrypoint'), true);
    assert.equal(result.issues.some((item) => item.code === 'duplicate_entrypoint'), true);
  });
});

test('fictional Cloudflare route and handler are rejected', async () => {
  await withFixture((matrix) => ({ ...matrix, entries: matrix.entries.map((entry) => entry.status === 'represented' ? { ...entry, cloudflareTarget: { ...entry.cloudflareTarget, route: '/v1/not-real', handler: 'missingHandler' } } : entry) }), (root, matrix) => {
    const result = validateHeavyEdgeFunctionDispositionMatrix(matrix, { root });
    assert.equal(result.contractValid, false);
    assert.equal(result.issues.some((item) => item.code === 'fictional_target_route'), true);
    assert.equal(result.issues.some((item) => item.code === 'fictional_target_handler'), true);
  });
});

test('missing function entry files are rejected even when the directory exists', async () => {
  await withFixture((matrix) => matrix, async (root, matrix) => {
    const entryFile = join(root, 'supabase/functions/bulk-download/index.ts');
    await rm(entryFile);
    const result = validateHeavyEdgeFunctionDispositionMatrix(matrix, { root });
    assert.equal(result.contractValid, false);
    assert.equal(result.issues.some((item) => item.code === 'missing_source_evidence' && item.entrypoint === 'bulk-download'), true);
  });
});

test('directory-only legacy inventory is explicit and cannot be represented', async () => {
  await withFixture((matrix) => ({ ...matrix, entries: matrix.entries.map((entry) => entry.name === 'bulk-download' ? {
    ...entry,
    sourceEvidence: { ...entry.sourceEvidence, kind: 'directory_only', note: 'No source entry file.' },
    status: 'represented',
    cloudflareTarget: { route: '/v1/ok', handler: 'handleOk', evidencePath: 'cloudflare/heavy-api/src/fixture.ts' },
  } : entry) }), async (root, matrix) => {
    const result = validateHeavyEdgeFunctionDispositionMatrix(matrix, { root });
    assert.equal(result.contractValid, false);
    assert.equal(result.issues.some((item) => item.code === 'represented_requires_source_file'), true);
  });
});
