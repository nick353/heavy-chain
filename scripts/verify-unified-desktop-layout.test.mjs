import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./verify-unified-desktop-layout.mjs', import.meta.url), 'utf8');

test('current catalogs resolve to the approved 31-feature, 57-target, 228-cell plan', () => {
  const featureSource = fs.readFileSync(new URL('../src/features/lightchain/parityContract.ts', import.meta.url), 'utf8');
  const featureBlock = featureSource.match(/GOAL_CANDIDATE_ROW_IDS\s*=\s*Object\.freeze\(\[([\s\S]+?)\]\s*as const\)/);
  assert.ok(featureBlock);
  const featureIds = [...featureBlock[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((id) => !id.startsWith('video-'));
  const catalogSource = fs.readFileSync(new URL('../src/lib/lightchainUnifiedFeatureCatalog.ts', import.meta.url), 'utf8');
  const aliasesBlock = catalogSource.match(/const routeAliases:[^=]+?=\s*\{([\s\S]+?)\n\};/);
  assert.ok(aliasesBlock);
  const aliases = new Map();
  for (const match of aliasesBlock[1].matchAll(/(?:'([^']+)'|([a-z-]+)):\s*\[([^\]]*)\]/g)) {
    aliases.set(match[1] ?? match[2], [...match[3].matchAll(/'([^']+)'/g)].map((route) => route[1]));
  }
  const targets = new Set(['/lightchain', '/fitting', '/model', '/lightchain/fabric-image', '/lightchain/printing-image', '/gallery', '/history', '/jobs']);
  for (const featureId of featureIds) {
    targets.add(`/lightchain/${featureId}`);
    for (const alias of aliases.get(featureId) ?? []) targets.add(alias);
  }
  assert.equal(featureIds.length, 31);
  assert.equal(new Set(featureIds).size, 31);
  assert.equal(targets.size, 57);
  assert.equal(targets.size * 4, 228);
});

test('unified desktop verifier keeps the approved fixed plan and budgets', () => {
  assert.match(source, /EXPECTED_FEATURE_COUNT\s*=\s*31/);
  assert.match(source, /EXPECTED_TARGET_COUNT\s*=\s*57/);
  assert.match(source, /EXPECTED_VIEWPORT_COUNT\s*=\s*4/);
  assert.match(source, /EXPECTED_CHECK_COUNT\s*=\s*228/);
  assert.match(source, /GLOBAL_BUDGET_MS\s*=\s*300_000/);
  assert.match(source, /CELL_BUDGET_MS\s*=\s*30_000/);
  assert.match(source, /performance\.now\(\)/);
  assert.match(source, /scheduled:\s*EXPECTED_CHECK_COUNT/);
  assert.match(source, /evidence\.completed\s*===\s*EXPECTED_CHECK_COUNT/);
});

test('verifier logs only bounded sanitized progress and a final summary', () => {
  assert.equal((source.match(/console\.log\(/g) || []).length, 1);
  assert.match(source, /process\.stderr\.write\(/);
  assert.match(source, /Buffer\.byteLength\(line, 'utf8'\)\s*>\s*240/);
  assert.doesNotMatch(source, /request\.url\(\)|message\.text\(\)|error\.stack/);
  assert.doesNotMatch(source, /summaryPath/);
});

test('verifier guards local origins, final redirects, and terminal cleanup', () => {
  assert.match(source, /LOCAL_HOSTS\s*=\s*new Set\(\['localhost', '127\.0\.0\.1', '::1'\]\)/);
  assert.match(source, /assertAllowedLocalUrl\(finalUrl, baseOrigin\)/);
  assert.match(source, /fetch\(currentUrl, \{ redirect: 'manual' \}\)/);
  assert.match(source, /await stopPreview\(preview, cleanupBudget\)/);
  assert.match(source, /await waitForChildExit\(child, budget, 'SIGTERM', 4_000\)/);
  assert.match(source, /cleanupLeftovers === 0/);
  assert.match(source, /process\.exitCode = evidence\.globalTimedOut \? 2/);
});

test('layout verifier blocks external waits while preserving local preview resources', () => {
  assert.match(source, /installLocalPreviewNetworkBoundary\(context\)/);
  assert.match(source, /context\.route\('\*\*\/\*'/);
  assert.match(source, /requestUrl\.origin === baseOrigin/);
  assert.match(source, /requestUrl\.protocol === 'data:'/);
  assert.match(source, /requestUrl\.protocol === 'blob:'/);
  assert.match(source, /route\.abort\('blockedbyclient'\)/);
});

test('independent desktop viewports run concurrently within the global budget', () => {
  assert.match(source, /Promise\.all\(viewports\.map\(\(viewport\) => runViewport\(viewport, routeSpecs, runBudget\)\)\)/);
});
