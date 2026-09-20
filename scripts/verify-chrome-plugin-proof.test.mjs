import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const verifierPath = join(scriptsDir, 'verify-chrome-plugin-proof.mjs');
const releaseDoctorPath = join(scriptsDir, 'release-doctor.mjs');
const retiredBlocker = 'historical_chrome_plugin_proof_retired';

function runVerifier(args = []) {
  return spawnSync(process.execPath, [verifierPath, ...args], {
    cwd: join(scriptsDir, '..'),
    encoding: 'utf8',
  });
}

function assertRetired(result) {
  assert.equal(result.status, 1);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout, '');

  const output = JSON.parse(result.stderr);
  assert.equal(output.accepted, false);
  assert.equal(output.blocker, retiredBlocker);
  assert.deepEqual(output.failures, [retiredBlocker]);
  assert.equal(output.historicalOnly, true);
}

test('rejects no arguments before any evidence lookup', () => {
  assertRetired(runVerifier());
});

test('rejects the dated Zeabur-shaped input without reading its path', () => {
  assertRetired(runVerifier(['--evidence', 'output/playwright/chrome-plugin-proof-20260818.json']));
});

test('rejects Cloudflare-shaped input without selecting a replacement origin', () => {
  assertRetired(
    runVerifier([
      '--evidence',
      'output/cloudflare/chrome-plugin-proof.json',
      '--expect-environment',
      'production',
    ]),
  );
});

test('rejects malformed evidence without attempting to parse it', () => {
  assertRetired(runVerifier(['--evidence', '/dev/null']));
});

test('rejects permissive age and commit flags with the same blocker', () => {
  assertRetired(
    runVerifier([
      '--evidence',
      '/dev/null',
      '--max-age-hours',
      '999999',
      '--expect-git-commit',
      '0000000000000000000000000000000000000000',
    ]),
  );
});

test('release doctor keeps the retired verifier as the selected proof consumer', () => {
  const source = readFileSync(releaseDoctorPath, 'utf8');

  assert.match(source, /releaseChromePluginEvidenceValid\s*\?/);
  assert.match(source, /name:\s*'verify:chrome-plugin-proof'/);
  assert.match(source, /args:\s*currentChromePluginArgs/);
  assert.match(source, /dated proof verifierは退役済み/);
  assert.match(source, /historical_chrome_plugin_proof_retired/);
  assert.match(source, /historical-only/);

  const selectedBranch = source.match(
    /const releaseProofCheck = releaseChromePluginEvidenceValid\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{/,
  )?.[1];
  assert.ok(selectedBranch, 'selected Chrome Plugin proof branch must be present');
  assert.doesNotMatch(selectedBranch, /fresh|取り直|収集|Browser Use|verify:browser-use/i);
  assert.match(selectedBranch, /自動の次アクションはありません/);
});
