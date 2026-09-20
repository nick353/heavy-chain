import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLOUDFLARE_CONTRACT_FILES,
  verifyCloudflareContract,
} from './verify-g632-incident-response-drill.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function copyCloudflareContractFixture() {
  const root = await mkdtemp(join(tmpdir(), 'heavy-g632-cloudflare-'));
  for (const { path: relativePath } of CLOUDFLARE_CONTRACT_FILES) {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repoRoot, relativePath), destination);
  }
  return root;
}

test('current Cloudflare contract evidence passes content checks', async () => {
  const root = await copyCloudflareContractFixture();
  try {
    const report = verifyCloudflareContract({ root });
    assert.equal(report.ok, true, JSON.stringify(report.failures, null, 2));
    for (const id of [
      'contract:cloudflare_provider_actions',
      'contract:durable_receipt_readback',
      'contract:private_media',
      'contract:auth_boundary',
      'contract:no_submit_language',
      'contract:no_payment_language',
      'contract:no_deploy_language',
    ]) {
      assert.equal(report.checks.find((check) => check.id === id)?.passed, true, id);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing and invalid current contract evidence fail closed', async () => {
  const missingRoot = await copyCloudflareContractFixture();
  const invalidRoot = await copyCloudflareContractFixture();
  try {
    await rm(join(missingRoot, 'cloudflare/heavy-api/FEEDBACK_ADMIN.md'));
    const missing = verifyCloudflareContract({ root: missingRoot });
    assert.equal(missing.ok, false);
    assert.ok(missing.failures.some(({ id }) => id === 'cloudflare/heavy-api/FEEDBACK_ADMIN.md:exists'));

    const imagePath = join(invalidRoot, 'cloudflare/heavy-api/IMAGE_AI.md');
    const image = await readFile(imagePath, 'utf8');
    await writeFile(imagePath, `${image.replaceAll('provider-actions', 'retired-provider-route')}\n`);
    const invalid = verifyCloudflareContract({ root: invalidRoot });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.failures.some(({ id }) => id === 'cloudflare/heavy-api/IMAGE_AI.md:provider-actions routes'));
  } finally {
    await Promise.all([
      rm(missingRoot, { recursive: true, force: true }),
      rm(invalidRoot, { recursive: true, force: true }),
    ]);
  }
});

test('legacy-only evidence cannot satisfy the Cloudflare contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'heavy-g632-legacy-only-'));
  try {
    const legacyPath = join(root, 'scripts/supabase-prod-verify.sh');
    await mkdir(dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, '#!/bin/sh\n# legacy Edge/RLS evidence only\n');
    const report = verifyCloudflareContract({ root });
    assert.equal(report.ok, false);
    assert.ok(report.failures.some(({ id }) => id === 'cloudflare/heavy-api/IMAGE_AI.md:exists'));
    assert.ok(report.failures.some(({ id }) => id === 'scripts/verify-g620-security-ops.mjs:exists'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
