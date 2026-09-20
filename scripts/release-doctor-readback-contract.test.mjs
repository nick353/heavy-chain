import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const doctorPath = join(scriptsDir, 'release-doctor.mjs');

test('release doctor keeps the missing blocker when no explicit contract path is supplied', () => {
  const source = readFileSync(doctorPath, 'utf8');

  assert.match(source, /RELEASE_CLOUDFLARE_READBACK_CONTRACT/);
  assert.match(source, /CLOUDFLARE_RELEASE_READBACK_CONTRACT/);
  assert.match(source, /name: 'cloudflare_release_readback_contract_missing'/);
  assert.match(source, /output: 'cloudflare_release_readback_contract_missing'/);
  assert.match(source, /if \(!cloudflareReleaseReadbackContractPath\.trim\(\)\) return missing/);
  assert.doesNotMatch(source, /currentReadbackArgs/);
  assert.doesNotMatch(source, /verify:readback(?::current)?/);
});

test('release doctor changes only a valid contract to production-not-verified and still stops', () => {
  const source = readFileSync(doctorPath, 'utf8');

  assert.match(source, /if \(report\.contractValid === true\)/);
  assert.match(source, /name: 'cloudflare_release_readback_production_not_verified'/);
  assert.match(source, /output: 'cloudflare_release_readback_production_not_verified'/);
  assert.match(source, /name: 'cloudflare_release_readback_contract_missing'/);
  assert.match(source, /passed: false/);
  assert.match(source, /releaseを止めてください/);
  assert.doesNotMatch(source, /verify:readback(?::current)?/);
});

test('doctor guidance does not turn local or historical evidence into approval', () => {
  const source = readFileSync(doctorPath, 'utf8');
  const start = source.indexOf("name: 'cloudflare_release_readback_production_not_verified'");
  const end = source.indexOf('\n    };', start);
  assert.ok(start >= 0);
  assert.ok(end > start);

  const check = source.slice(start, end);
  assert.match(check, /認証済みproduction readbackは未検証/);
  assert.match(check, /provider receipt/);
  assert.match(check, /passed: false/);
  assert.doesNotMatch(check, /releaseApproval:\s*true|businessCompletion:\s*['"]completed['"]/);
});
