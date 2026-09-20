import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, '..');
const verifierPath = join(scriptsDir, 'verify-release-readback.mjs');
const packagePath = join(repoRoot, 'package.json');
const retiredBlocker = 'historical_release_readback_retired';

function runVerifier(args = []) {
  return spawnSync(process.execPath, [verifierPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function assertRetired(result, args) {
  assert.equal(result.status, 1);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /missing proof file|invalid JSON|probe_side_effects/);
  for (const arg of args) {
    assert.equal(result.stderr.includes(arg), false, 'evidence argument was printed: ' + arg);
  }

  const report = JSON.parse(result.stderr);
  assert.equal(report.accepted, false);
  assert.equal(report.legacyOnly, true);
  assert.equal(report.blocker, retiredBlocker);
  assert.deepEqual(report.failures, [retiredBlocker]);
}

test('rejects the default invocation before any evidence lookup', () => {
  const args = [];
  assertRetired(runVerifier(args), args);
});

test('rejects legacy-proof paths without reading or printing them', () => {
  const args = [
    '--readback',
    'output/playwright/prod-db-readback.json',
    '--cleanup',
    'output/playwright/prod-cleanup.json',
    '--rate-limit',
    'output/playwright/rate-limit-db-proof-2.json',
    '--rate-limit-cleanup',
    'output/playwright/rate-limit-cleanup-2.json',
  ];
  assertRetired(runVerifier(args), args);
});

test('rejects Cloudflare-shaped paths without selecting a replacement origin', () => {
  const args = [
    '--readback',
    'output/cloudflare/release-readback.json',
    '--cleanup',
    'output/cloudflare/release-cleanup.json',
  ];
  assertRetired(runVerifier(args), args);
});

test('rejects metadata flags with the same historical blocker', () => {
  const args = [
    '--expect-release-date',
    '2026-09-08',
    '--expect-environment',
    'production',
    '--expect-git-commit',
    '0000000000000000000000000000000000000000',
  ];
  assertRetired(runVerifier(args), args);
});

test('retired verifier has no evidence, filesystem, or external-call implementation', () => {
  const source = readFileSync(verifierPath, 'utf8');

  assert.match(source, /accepted:\s*false/);
  assert.match(source, /legacyOnly:\s*true/);
  assert.match(source, /historical_release_readback_retired/);
  assert.doesNotMatch(source, /node:(?:fs|fs\/promises|child_process|http|https)/);
  assert.doesNotMatch(
    source,
    /\b(?:existsSync|readFileSync|writeFileSync|appendFileSync|readdirSync|readFile|writeFile|fetch|spawnSync|execSync)\b/,
  );
});

test('package verify:readback entry remains the legacy verifier entrypoint', () => {
  const packageSource = readFileSync(packagePath, 'utf8');
  assert.match(packageSource, /"verify:readback":\s*"node scripts\/verify-release-readback\.mjs"/);
});
