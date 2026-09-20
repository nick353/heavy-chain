import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const script = path.join(root, 'scripts/verify-lightchain-all-feature-workflows.mjs');
const isolatedRunner = path.join(root, 'scripts/run-lightchain-all-feature-workflows.mjs');
const source = fs.readFileSync(script, 'utf8');
const isolatedRunnerSource = fs.readFileSync(isolatedRunner, 'utf8');

function run(args) {
  const env = { ...process.env };
  delete env.HEAVY_CHAIN_VERIFY_MODE;
  delete env.HEAVY_CHAIN_BASE_URL;
  delete env.HEAVY_CHAIN_AUTH_STATE;
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

function combinedOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

test('verifier requires an explicit mode', () => {
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.match(combinedOutput(result), /verification_mode_must_be_explicit/);
});

test('local mode rejects remote base URLs and auth-state inputs', () => {
  const remote = run(['--mode=local', '--base-url=https://heavy-chain.example.test']);
  assert.notEqual(remote.status, 0);
  assert.match(combinedOutput(remote), /local_mode_requires_explicit_loopback_base_url/);

  const authState = run(['--mode=local', '--auth-state=/tmp/should-not-be-read.json']);
  assert.notEqual(authState.status, 0);
  assert.match(combinedOutput(authState), /local_mode_rejects_auth_state_use/);
});

test('production mode rejects loopback targets and local coverage cannot be reduced', () => {
  const productionLoopback = run(['--mode=production', '--base-url=http://127.0.0.1:4183']);
  assert.notEqual(productionLoopback.status, 0);
  assert.match(combinedOutput(productionLoopback), /production_mode_rejects_loopback_base_url/);

  const reduced = run(['--mode=local', '--dist-dir=/tmp/heavy-chain-isolated-dist-contract', '--max-features=1']);
  assert.notEqual(reduced.status, 0);
  assert.match(combinedOutput(reduced), /full_31_feature_desktop_mobile_coverage_cannot_be_reduced/);
});

test('requested output directories are never reused', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-chain-verifier-contract-'));
  const existing = path.join(parent, 'existing-output');
  fs.mkdirSync(existing);
  const distDir = path.join(parent, 'isolated-dist');
  fs.mkdirSync(distDir);
  const result = run(['--mode=local', `--dist-dir=${distDir}`, `--out=${existing}`]);
  assert.notEqual(result.status, 0);
  assert.match(combinedOutput(result), /output_directory_already_exists/);
});

test('local verifier contains the fail-closed boundary and fresh-output guards', () => {
  for (const pattern of [
    /installLocalContextGuard\(context, baseUrl\)/,
    /routeWebSocket\('\*\*\/\*'/,
    /LOCAL_SAFE_HTTP_METHODS = new Set\(\['GET', 'HEAD', 'OPTIONS'\]\)/,
    /local_provider_submit_mutation_fail_closed/,
    /serviceWorkers: 'block'/,
    /fs\.mkdtempSync\(/,
    /fs\.writeFileSync\([^\n]+\{ flag: 'wx' \}\)/,
    /catalog\.tools\.length === 31/,
    /startPreviewServer\(baseUrl, distDir\)/,
    /local_mode_requires_isolated_dist_dir/,
    /local_mode_rejects_shared_dist_dir/,
    /lightchain-source-readback-20260920-r4\.json/,
    /source_readback_schema_invalid/,
    /verifySourceRouteParity\(context, desktopViewport\)/,
    /videoResults: \[\]/,
    /verifyVideoSurface\(context, desktopViewport, '\/flow\/GenerateShortVideo'/,
    /verifyVideoSurface\(context, mobileViewport, '\/flow\/GenerateShortVideo\/detail\?project=new'/,
    /editLabelCount/,
    /dashboard_edit_labels_match_source_count/,
    /rights_checkbox_absent/,
    /source_fabric_permission_surface_match/,
    /source_model_has_no_checkbox/,
    /screenshotRole: 'heavy-observed-source-contract'/,
    /sourceScreenshot: null/,
    /pixel: 'PENDING_CONFIRMATION'/,
    /Current authenticated Light Chain screenshot baseline is not supplied/,
  ]) {
    assert.match(source, pattern);
  }
  assert.match(isolatedRunnerSource, /fs\.mkdtempSync\(/);
  assert.match(isolatedRunnerSource, /vite, 'build', '--outDir', distDir/);
  assert.match(isolatedRunnerSource, /fs\.rmSync\(buildRoot, \{ recursive: true, force: true \}\)/);
});
