import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { validateHeavySchemaTransformContract } from './verify-heavy-schema-transform-contract.mjs';

const validMapped = {
  sourceEntity: 'users',
  evidenceMigrations: ['supabase/migrations/001.sql'],
  target: { type: 'table', name: 'users', evidenceMigrations: ['cloudflare/heavy-api/migrations/001.sql'] },
  status: 'mapped',
  transformRules: ['Preserve stable user identity and normalize JSON fields.'],
  idOwner: 'Auth subject resolves to the preserved user id.',
  permissions: 'Self access and admin access are explicit; foreign-user access is denied.',
  unresolvedItems: [],
};

const validDecisionRequired = {
  sourceEntity: 'plans',
  evidenceMigrations: ['supabase/migrations/002.sql'],
  target: null,
  status: 'decision_required',
  transformRules: ['No transform selected until entitlement authority is decided.'],
  idOwner: 'Product ownership is unresolved.',
  permissions: 'Catalog/operator boundary is unresolved.',
  unresolvedItems: ['No target is selected.'],
};

async function withFixture(entities, callback) {
  const root = await mkdtemp(join(tmpdir(), 'heavy-schema-transform-contract-'));
  try {
    await mkdir(join(root, 'supabase/migrations'), { recursive: true });
    await mkdir(join(root, 'cloudflare/heavy-api/migrations'), { recursive: true });
    await writeFile(join(root, 'supabase/migrations/001.sql'), 'CREATE TABLE public.users (id uuid);\n', 'utf8');
    await writeFile(join(root, 'supabase/migrations/002.sql'), 'CREATE TABLE public.plans (id uuid);\n', 'utf8');
    await writeFile(join(root, 'cloudflare/heavy-api/migrations/001.sql'), 'CREATE TABLE users (id TEXT);\n', 'utf8');
    await writeFile(join(root, 'work.json'), JSON.stringify({ schema: 'heavy-chain-schema-transform-contract.v1', entities }), 'utf8');
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('valid mapped and decision_required entries are accepted separately from preparation completion', async () => {
  await withFixture([validMapped, validDecisionRequired], async (root) => {
    const result = await validateHeavySchemaTransformContract({ root, contractPath: 'work.json' });
    assert.equal(result.contractValid, true);
    assert.equal(result.migrationPreparationComplete, false);
    assert.deepEqual(result.counts, { sourceEntities: 2, contractEntities: 2, mapped: 1, unmapped: 0, decisionRequired: 1, issues: 0 });
  });
});

test('missing and duplicate source entities are rejected', async () => {
  await withFixture([validMapped, validMapped], async (root) => {
    const result = await validateHeavySchemaTransformContract({ root, contractPath: 'work.json' });
    assert.equal(result.contractValid, false);
    assert.equal(result.issues.some((item) => item.code === 'duplicate_source_entity'), true);
    assert.equal(result.issues.some((item) => item.code === 'missing_source_entity' && item.sourceEntity === 'plans'), true);
  });
});

test('fictional targets and incomplete mapped declarations are rejected', async () => {
  await withFixture([
    { ...validMapped, target: { type: 'table', name: 'imaginary', evidenceMigrations: ['cloudflare/heavy-api/migrations/001.sql'] } },
    { ...validDecisionRequired, status: 'mapped', target: { type: 'table', name: 'plans', evidenceMigrations: ['cloudflare/heavy-api/migrations/001.sql'] }, transformRules: [], idOwner: '', permissions: '' },
  ], async (root) => {
    const result = await validateHeavySchemaTransformContract({ root, contractPath: 'work.json' });
    assert.equal(result.contractValid, false);
    assert.equal(result.issues.some((item) => item.code === 'fictional_target'), true);
    assert.equal(result.issues.some((item) => item.code === 'missing_transform_rules' && item.sourceEntity === 'plans'), true);
    assert.equal(result.issues.some((item) => item.code === 'missing_id_owner' && item.sourceEntity === 'plans'), true);
    assert.equal(result.issues.some((item) => item.code === 'missing_permissions' && item.sourceEntity === 'plans'), true);
  });
});

test('source evidence must declare the source entity in the referenced migration', async () => {
  await withFixture([{ ...validMapped, evidenceMigrations: ['supabase/migrations/002.sql'] }, validDecisionRequired], async (root) => {
    const result = await validateHeavySchemaTransformContract({ root, contractPath: 'work.json' });
    assert.equal(result.contractValid, false);
    assert.equal(result.issues.some((item) => item.code === 'invalid_source_evidence' && item.sourceEntity === 'users'), true);
  });
});
