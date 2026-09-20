import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PINNED_EXTERNAL_CLOTH_MODEL_URL,
  resolveClothModelBuildUrl,
  validateClothModelBuildUrl,
} from './rembg-cloth-model-build-contract.mjs';

const repoRoot = process.cwd();
const verifierScript = fileURLToPath(new URL('./verify-rembg-model-deploy-readiness.mjs', import.meta.url));
const rembgModelUrlEnvKeys = [
  'VITE_REMBG_MODEL_BASE_URL',
  'VITE_REMBG_SILUETA_MODEL_URL',
  'VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL',
  'VITE_REMBG_CLOTH_SEG_MODEL_URL',
];
const checkEnvSource = readFileSync(join(repoRoot, 'scripts/check-env.mjs'), 'utf8');

const runVerifier = ({ args = [], clothModelUrl, cwd = repoRoot } = {}) => {
  const env = { ...process.env };
  env.VITE_REMBG_CLOTH_SEG_MODEL_URL = clothModelUrl ?? '';
  const result = spawnSync(process.execPath, [
    verifierScript,
    ...args,
  ], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    ...result,
    summary: JSON.parse(result.stdout),
  };
};

const createVerifierFixture = ({ checkEnv = checkEnvSource } = {}) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'rembg-model-deploy-readiness-'));
  const copy = (relativePath) => {
    const destination = join(fixtureRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repoRoot, relativePath), destination);
  };

  for (const relativePath of [
    '.gitignore',
    '.env.example',
    '.env.production.example',
    'README.md',
    'DEPLOYMENT_CHECKLIST.md',
    'src/lib/workspaceMaterialReferences.ts',
    'src/features/printing/selection/clothModelRuntimeContract.ts',
  ]) {
    copy(relativePath);
  }
  mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'scripts/check-env.mjs'), checkEnv);
  mkdirSync(join(fixtureRoot, 'public/assets'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'public/assets/silueta.onnx'), Buffer.alloc(1_000_001));
  return fixtureRoot;
};

const removeFixture = (fixtureRoot) => rmSync(fixtureRoot, { force: true, recursive: true });

test('default production readiness configures the pinned cloth model URL', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.clothModel.required, false);
  assert.equal(result.summary.clothModel.configured, true);
  assert.equal(result.summary.clothModel.configuredBy, 'production_default');
  assert.equal(result.summary.clothModel.urlValid, true);
  assert.equal(result.summary.clothModel.validationReason, null);
  assert.equal(result.summary.clothModel.delivery, 'cross_origin');
  assert.equal(result.summary.clothModel.stagedIdentityVerified, false);
  assert.equal(result.summary.clothModel.distIdentityVerified, false);
  assert.equal(
    result.summary.checks.find(({ name }) => name === 'cloth_model_asset_is_effectively_gitignored')?.ok,
    true,
  );
  assert.equal(
    result.summary.checks.find(({ name }) => name === 'runtime_cloth_model_integrity_uses_official_pinned_sha256')?.ok,
    true,
  );
});

test('readiness does not require the legacy provider config file', () => {
  const fixtureRoot = createVerifierFixture();
  try {
    const result = runVerifier({ cwd: fixtureRoot });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.summary.ok, true);
    assert.equal(result.summary.checks.some(({ name }) => name.includes('zeabur')), false);
  } finally {
    removeFixture(fixtureRoot);
  }
});

test('readiness fails when any rembg model URL leaves the check-env optional contract', () => {
  for (const key of rembgModelUrlEnvKeys) {
    const invalidCheckEnv = checkEnvSource.replace(`  '${key}',\n`, '');
    assert.notEqual(invalidCheckEnv, checkEnvSource, `fixture did not remove ${key}`);
    const fixtureRoot = createVerifierFixture({ checkEnv: invalidCheckEnv });
    try {
      const result = runVerifier({ cwd: fixtureRoot });
      assert.equal(result.status, 1, `${key}: ${result.stderr}`);
      assert.equal(result.summary.ok, false);
      assert.match(result.summary.exactBlocker, /env_check_treats_model_base_url_as_optional/);
      if (key === 'VITE_REMBG_CLOTH_SEG_MODEL_URL') {
        assert.match(result.summary.exactBlocker, /cloth_model_url_is_optional_in_deployment_contract/);
      }
    } finally {
      removeFixture(fixtureRoot);
    }
  }
});

test('development keeps the unconfigured fallback while production resolves the pinned URL', () => {
  assert.equal(resolveClothModelBuildUrl({ configuredUrl: '', viteMode: 'development' }), '');
  assert.equal(resolveClothModelBuildUrl({ configuredUrl: '', viteMode: 'production' }), PINNED_EXTERNAL_CLOTH_MODEL_URL);
  assert.equal(
    resolveClothModelBuildUrl({ configuredUrl: 'https://models.example.com/custom.onnx', viteMode: 'production' }),
    'https://models.example.com/custom.onnx',
  );
  const result = runVerifier({ args: ['--mode=development'] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.clothModel.configured, false);
  assert.equal(result.summary.clothModel.configuredBy, null);
  assert.equal(result.summary.clothModel.validationReason, 'not_configured');
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
  const result = runVerifier({ args: ['--require-cloth', '--mode=development'] });
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
