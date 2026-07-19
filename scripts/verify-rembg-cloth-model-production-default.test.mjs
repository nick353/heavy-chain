import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PINNED_EXTERNAL_CLOTH_MODEL_URL } from './rembg-cloth-model-build-contract.mjs';

const run = (command, args, env) => spawnSync(command, args, {
  cwd: process.cwd(),
  env,
  encoding: 'utf8',
});

test('ordinary production build embeds and configures the pinned cloth model URL', () => {
  const env = { ...process.env };
  delete env.VITE_REMBG_CLOTH_SEG_MODEL_URL;
  const build = run('npm', ['run', 'build'], env);
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

  const readback = run(process.execPath, [
    'scripts/verify-rembg-model-deploy-readiness.mjs',
    '--require-cloth',
    '--verify-dist',
  ], env);
  assert.equal(readback.status, 0, `${readback.stdout}\n${readback.stderr}`);
  const summary = JSON.parse(readback.stdout);
  assert.equal(summary.clothModel.configured, true);
  assert.equal(summary.clothModel.configuredBy, 'production_default');
  assert.equal(summary.clothModel.presentInBuiltAssets, true);
  assert.equal(summary.clothModel.delivery, 'cross_origin');
  assert.ok(PINNED_EXTERNAL_CLOTH_MODEL_URL.includes('/197561dc207c9b23e2739fb81645ef21b4e37d10/'));
});
