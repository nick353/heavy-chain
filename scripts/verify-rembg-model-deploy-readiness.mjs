#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnv } from 'vite';
import { OFFICIAL_CLOTH_MODEL } from './verify-rembg-cloth-model-compatibility.mjs';
import { validateClothModelBuildUrl } from './rembg-cloth-model-build-contract.mjs';

const checks = [];
const requireClothModel = process.argv.includes('--require-cloth');
const verifyDist = process.argv.includes('--verify-dist');
const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const viteMode = modeArgument?.slice('--mode='.length) || 'production';
const loadedViteEnv = loadEnv(viteMode, process.cwd(), '');

const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const readJson = (file) => {
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
};
const add = (name, ok, details = {}) => {
  checks.push({ name, ok: Boolean(ok), details });
};

const gitTrackedModels = execFileSync('git', ['ls-files', 'public/models'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const bundledModelPath = 'public/models/silueta.onnx';
const bundledModelBytes = fs.existsSync(bundledModelPath) ? fs.statSync(bundledModelPath).size : 0;
const stagedClothModelPath = 'public/models/u2net_cloth_seg.onnx';
const distClothModelPath = 'dist/models/u2net_cloth_seg.onnx';
const stagedClothModelIsIgnored = (() => {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', stagedClothModelPath]);
    return true;
  } catch {
    return false;
  }
})();

const readModelIdentity = (file) => {
  if (!fs.existsSync(file)) return null;
  const value = fs.readFileSync(file);
  return {
    bytes: value.byteLength,
    sha256: crypto.createHash('sha256').update(value).digest('hex'),
  };
};
const modelIdentityMatches = (identity) => (
  identity?.bytes === OFFICIAL_CLOTH_MODEL.bytes
  && identity?.sha256 === OFFICIAL_CLOTH_MODEL.sha256
);

const gitignore = read('.gitignore');
const source = read('src/lib/workspaceMaterialReferences.ts');
const envExample = read('.env.example');
const prodEnvExample = read('.env.production.example');
const zeabur = read('zeabur.json');
const zeaburConfig = readJson('zeabur.json');
const checkEnv = read('scripts/check-env.mjs');
const readme = read('README.md');
const checklist = read('DEPLOYMENT_CHECKLIST.md');
const clothModelUrl = String(
  Object.hasOwn(process.env, 'VITE_REMBG_CLOTH_SEG_MODEL_URL')
    ? process.env.VITE_REMBG_CLOTH_SEG_MODEL_URL
    : loadedViteEnv.VITE_REMBG_CLOTH_SEG_MODEL_URL || '',
).trim();
const clothModelUrlValidation = validateClothModelBuildUrl(clothModelUrl);
const stagedClothModelIdentity = clothModelUrlValidation.delivery === 'same_origin'
  ? readModelIdentity(stagedClothModelPath)
  : null;
const distClothModelIdentity = verifyDist && clothModelUrlValidation.delivery === 'same_origin'
  ? readModelIdentity(distClothModelPath)
  : null;
const distContainsClothModelUrl = verifyDist && clothModelUrlValidation.valid
  ? fs.existsSync('dist/assets') && fs.readdirSync('dist/assets')
      .filter((file) => file.endsWith('.js'))
      .some((file) => read(`dist/assets/${file}`).includes(clothModelUrl))
  : false;

add('large_model_directory_is_gitignored', gitignore.includes('public/models/*'), {
  file: '.gitignore',
});
add('cloth_model_asset_is_effectively_gitignored', stagedClothModelIsIgnored, {
  file: stagedClothModelPath,
});
add('only_bounded_silueta_model_is_tracked', (
  gitTrackedModels.length === 1
  && gitTrackedModels[0] === bundledModelPath
  && bundledModelBytes > 1_000_000
  && bundledModelBytes < 50_000_000
), {
  tracked: gitTrackedModels,
  bundledModelBytes,
});
add('source_supports_model_base_url_env', source.includes('VITE_REMBG_MODEL_BASE_URL') && source.includes("'/models'"), {
  file: 'src/lib/workspaceMaterialReferences.ts',
});
add('source_defaults_to_bundled_silueta_without_remote_isnet_fallback', (
  source.includes("modelName = 'silueta'")
  && (source.match(/modelName: 'silueta'/g) || []).length >= 1
  && source.includes("VITE_REMBG_SILUETA_MODEL_URL\n  || '/models/silueta.onnx'")
  && source.includes("VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL\n  || ''")
  && !source.includes('https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx')
), {
  file: 'src/lib/workspaceMaterialReferences.ts',
});
add('model_load_failure_has_quality_gated_fallback', (
  source.includes('buildWhiteBackgroundFallbackCutout') &&
  source.includes('isRembgModelLoadError') &&
  source.includes('Falling back to local white-background garment cutout because rembg failed during cutout.') &&
  source.includes('browser-local-white-background-garment-cutout-v1') &&
  source.includes("result.engine !== 'browser-canvas-background-flood-cutout-v2'") &&
  source.includes('白背景から服だけを分離できませんでした') &&
  source.includes('boundsRatio > 0.92')
), {
  file: 'src/lib/workspaceMaterialReferences.ts',
});
add('env_examples_include_model_base_url', envExample.includes('VITE_REMBG_MODEL_BASE_URL') && prodEnvExample.includes('VITE_REMBG_MODEL_BASE_URL'), {
  files: ['.env.example', '.env.production.example'],
});
add('zeabur_model_base_url_is_optional', zeaburConfig?.env?.VITE_REMBG_MODEL_BASE_URL?.required === false, {
  file: 'zeabur.json',
  value: zeaburConfig?.env?.VITE_REMBG_MODEL_BASE_URL ?? null,
});
add('source_supports_explicit_cloth_model_url', (
  source.includes('VITE_REMBG_CLOTH_SEG_MODEL_URL')
  && source.includes("setCustomModelPath('u2net_cloth_seg', rembgClothSegModelUrl)")
  && source.includes('isPrintGarmentClothModelConfigured')
), {
  file: 'src/lib/workspaceMaterialReferences.ts',
});
add('cloth_model_url_is_optional_in_deployment_contract', (
  envExample.includes('VITE_REMBG_CLOTH_SEG_MODEL_URL')
  && prodEnvExample.includes('VITE_REMBG_CLOTH_SEG_MODEL_URL')
  && zeaburConfig?.env?.VITE_REMBG_CLOTH_SEG_MODEL_URL?.required === false
  && checkEnv.includes("'VITE_REMBG_CLOTH_SEG_MODEL_URL'")
), {
  files: ['.env.example', '.env.production.example', 'zeabur.json', 'scripts/check-env.mjs'],
});
add('cloth_model_deployment_is_documented', (
  readme.includes('VITE_REMBG_CLOTH_SEG_MODEL_URL')
  && checklist.includes('VITE_REMBG_CLOTH_SEG_MODEL_URL')
  && checklist.includes('u2net_cloth_seg.onnx')
  && checklist.includes('CORS')
), {
  files: ['README.md', 'DEPLOYMENT_CHECKLIST.md'],
});
if (clothModelUrlValidation.configured || requireClothModel) {
  add('cloth_model_url_is_configured_for_required_build', clothModelUrlValidation.configured, {
    env: 'VITE_REMBG_CLOTH_SEG_MODEL_URL',
    reason: clothModelUrlValidation.reason,
  });
  add('cloth_model_url_is_valid_same_origin_or_https_onnx', clothModelUrlValidation.valid, {
    env: 'VITE_REMBG_CLOTH_SEG_MODEL_URL',
    reason: clothModelUrlValidation.reason,
  });
}
if (clothModelUrlValidation.delivery === 'same_origin') {
  add('same_origin_cloth_model_is_staged_with_pinned_identity', modelIdentityMatches(stagedClothModelIdentity), {
    file: stagedClothModelPath,
    identity: stagedClothModelIdentity,
    expected: {
      bytes: OFFICIAL_CLOTH_MODEL.bytes,
      sha256: OFFICIAL_CLOTH_MODEL.sha256,
    },
  });
  add('same_origin_cloth_model_is_not_git_tracked', !gitTrackedModels.includes(stagedClothModelPath), {
    file: stagedClothModelPath,
    tracked: gitTrackedModels.includes(stagedClothModelPath),
  });
}
if (verifyDist) {
  add('cloth_model_url_is_present_in_built_assets', distContainsClothModelUrl, {
    directory: 'dist/assets',
    mode: viteMode,
  });
  if (clothModelUrlValidation.delivery === 'same_origin') {
    add('same_origin_cloth_model_dist_has_pinned_identity', modelIdentityMatches(distClothModelIdentity), {
      file: distClothModelPath,
      identity: distClothModelIdentity,
      expected: {
        bytes: OFFICIAL_CLOTH_MODEL.bytes,
        sha256: OFFICIAL_CLOTH_MODEL.sha256,
      },
    });
  }
}
add('env_check_treats_model_base_url_as_optional', (
  checkEnv.indexOf("const optional") < checkEnv.indexOf("'VITE_REMBG_MODEL_BASE_URL'")
  && checkEnv.indexOf("const optional") < checkEnv.indexOf("'VITE_REMBG_SILUETA_MODEL_URL'")
), {
  file: 'scripts/check-env.mjs',
});
add('docs_name_bundled_default_and_optional_isnet_cors_requirement', (
  readme.includes('/models/silueta.onnx')
  && checklist.includes('/models/silueta.onnx')
  && checklist.includes('VITE_REMBG_SILUETA_MODEL_URL')
  && checklist.includes('VITE_REMBG_ISNET_GENERAL_USE_MODEL_URL')
  && checklist.includes('CORS')
), {
  files: ['README.md', 'DEPLOYMENT_CHECKLIST.md'],
});

const failed = checks.filter((check) => !check.ok).map((check) => check.name);
const summary = {
  ok: failed.length === 0,
  checkedAt: new Date().toISOString(),
  checks,
  failed,
  exactBlocker: failed.length > 0
    ? `rembg_model_deploy_readiness_failed:${failed.join(',')}`
    : null,
  clothModel: {
    required: requireClothModel,
    configured: clothModelUrlValidation.configured,
    urlValid: clothModelUrlValidation.valid,
    validationReason: clothModelUrlValidation.reason,
    delivery: clothModelUrlValidation.delivery,
    viteMode,
    distVerified: verifyDist,
    presentInBuiltAssets: distContainsClothModelUrl,
    stagedIdentityVerified: clothModelUrlValidation.delivery === 'same_origin'
      ? modelIdentityMatches(stagedClothModelIdentity)
      : false,
    distIdentityVerified: verifyDist && clothModelUrlValidation.delivery === 'same_origin'
      ? modelIdentityMatches(distClothModelIdentity)
      : false,
  },
  scope: {
    verifies: [
      'only the bounded same-origin silueta ONNX model is committed to Git',
      'production defaults to the bundled model and makes remote model overrides optional',
      'missing model URL falls back only through a bounded white-background quality gate',
      'cloth segmentation is enabled only by the pinned same-origin model path or an explicit HTTPS ONNX build URL',
      ...(verifyDist ? ['the cloth model URL is present in the built frontend assets'] : []),
      ...(verifyDist && clothModelUrlValidation.delivery === 'same_origin'
        ? ['the same-origin dist model has the pinned byte length and SHA-256']
        : []),
    ],
    notPerformed: [
      'Zeabur dashboard environment mutation',
      'production browser inference with a user-selected image',
      'remote cloth-model GET, CORS, content length, checksum, or ONNX runtime compatibility',
    ],
  },
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
