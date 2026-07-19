import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateClothModelBuildUrl } from './rembg-cloth-model-build-contract.mjs';

const runVerifier = ({ args = [], clothModelUrl } = {}) => {
  const env = { ...process.env };
  env.VITE_REMBG_CLOTH_SEG_MODEL_URL = clothModelUrl ?? '';
  const result = spawnSync(process.execPath, [
    'scripts/verify-rembg-model-deploy-readiness.mjs',
    ...args,
  ], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
  return {
    ...result,
    summary: JSON.parse(result.stdout),
  };
};

test('default readiness preserves the unconfigured cloth fallback', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.clothModel.required, false);
  assert.equal(result.summary.clothModel.configured, false);
  assert.equal(result.summary.clothModel.urlValid, false);
  assert.equal(result.summary.clothModel.validationReason, 'not_configured');
  assert.equal(result.summary.clothModel.delivery, null);
  assert.equal(result.summary.clothModel.stagedIdentityVerified, false);
  assert.equal(result.summary.clothModel.distIdentityVerified, false);
  assert.equal(
    result.summary.checks.find(({ name }) => name === 'cloth_model_asset_is_effectively_gitignored')?.ok,
    true,
  );
});

test('default readiness rejects a configured invalid cloth URL', () => {
  const result = runVerifier({
    clothModelUrl: 'http://models.example.com/u2net_cloth_seg.onnx',
  });
  assert.equal(result.status, 1);
  assert.equal(result.summary.clothModel.validationReason, 'https_required');
  assert.match(result.summary.exactBlocker, /cloth_model_url_is_valid_same_origin_or_https_onnx/);
});

test('required cloth build fails closed when its URL is missing', () => {
  const result = runVerifier({ args: ['--require-cloth'] });
  assert.equal(result.status, 1);
  assert.equal(result.summary.clothModel.required, true);
  assert.match(result.summary.exactBlocker, /cloth_model_url_is_configured_for_required_build/);
});

test('required cloth build rejects non-HTTPS and non-ONNX URLs', () => {
  const insecure = runVerifier({
    args: ['--require-cloth'],
    clothModelUrl: 'http://models.example.com/u2net_cloth_seg.onnx',
  });
  assert.equal(insecure.status, 1);
  assert.equal(insecure.summary.clothModel.validationReason, 'https_required');

  const wrongPath = runVerifier({
    args: ['--require-cloth'],
    clothModelUrl: 'https://models.example.com/u2net_cloth_seg.bin',
  });
  assert.equal(wrongPath.status, 1);
  assert.equal(wrongPath.summary.clothModel.validationReason, 'onnx_path_required');

  const credentials = runVerifier({
    args: ['--require-cloth'],
    clothModelUrl: 'https://user:secret@models.example.com/u2net_cloth_seg.onnx',
  });
  assert.equal(credentials.status, 1);
  assert.equal(credentials.summary.clothModel.validationReason, 'embedded_credentials_forbidden');

  const queryCredential = runVerifier({
    args: ['--require-cloth'],
    clothModelUrl: 'https://models.example.com/u2net_cloth_seg.onnx?token=secret',
  });
  assert.equal(queryCredential.status, 1);
  assert.equal(queryCredential.summary.clothModel.validationReason, 'query_or_fragment_forbidden');
});

test('required cloth build accepts an explicit HTTPS ONNX URL contract', () => {
  const result = runVerifier({
    args: ['--require-cloth'],
    clothModelUrl: 'https://models.example.com/u2net_cloth_seg.onnx',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.clothModel.required, true);
  assert.equal(result.summary.clothModel.configured, true);
  assert.equal(result.summary.clothModel.urlValid, true);
  assert.equal(result.summary.clothModel.validationReason, null);
  assert.equal(result.summary.clothModel.delivery, 'cross_origin');
  assert.equal(result.summary.clothModel.stagedIdentityVerified, false);
  assert.equal(result.summary.clothModel.distIdentityVerified, false);
});

test('build URL contract allows only the pinned root-relative same-origin path', () => {
  assert.deepEqual(validateClothModelBuildUrl('/models/u2net_cloth_seg.onnx'), {
    configured: true,
    valid: true,
    reason: null,
    delivery: 'same_origin',
  });
  assert.equal(validateClothModelBuildUrl('//evil.example/u2net_cloth_seg.onnx').reason, 'protocol_relative_url_forbidden');
  assert.equal(validateClothModelBuildUrl('models/u2net_cloth_seg.onnx').reason, 'invalid_url');
  assert.equal(validateClothModelBuildUrl('/models/other.onnx').reason, 'same_origin_path_not_allowed');
  assert.equal(validateClothModelBuildUrl('/models/u2net_cloth_seg.onnx?token=x').reason, 'query_or_fragment_forbidden');
  assert.equal(validateClothModelBuildUrl('/models/u2net_cloth_seg.onnx#x').reason, 'query_or_fragment_forbidden');
});

test('same-origin required build fails closed until the pinned model is staged', () => {
  const result = runVerifier({
    args: ['--require-cloth'],
    clothModelUrl: '/models/u2net_cloth_seg.onnx',
  });
  assert.equal(result.status, 1);
  assert.equal(result.summary.clothModel.delivery, 'same_origin');
  assert.equal(result.summary.clothModel.stagedIdentityVerified, false);
  assert.match(result.summary.exactBlocker, /same_origin_cloth_model_is_staged_with_pinned_identity/);
});

test('dist verification fails when the configured URL is absent from built assets', () => {
  const result = runVerifier({
    args: ['--require-cloth', '--verify-dist'],
    clothModelUrl: 'https://models.example.com/not-in-the-current-build/u2net_cloth_seg.onnx',
  });
  assert.equal(result.status, 1);
  assert.match(result.summary.exactBlocker, /cloth_model_url_is_present_in_built_assets/);
});
