#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const checks = [];

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

const gitignore = read('.gitignore');
const source = read('src/lib/workspaceMaterialReferences.ts');
const envExample = read('.env.example');
const prodEnvExample = read('.env.production.example');
const zeabur = read('zeabur.json');
const zeaburConfig = readJson('zeabur.json');
const checkEnv = read('scripts/check-env.mjs');
const readme = read('README.md');
const checklist = read('DEPLOYMENT_CHECKLIST.md');

add('large_model_directory_is_gitignored', gitignore.includes('public/models/'), {
  file: '.gitignore',
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
  && (source.match(/modelName: 'silueta'/g) || []).length >= 2
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
  scope: {
    verifies: [
      'only the bounded same-origin silueta ONNX model is committed to Git',
      'production defaults to the bundled model and makes remote model overrides optional',
      'missing model URL falls back only through a bounded white-background quality gate',
    ],
    notPerformed: [
      'Zeabur dashboard environment mutation',
      'production browser inference with a user-selected image',
    ],
  },
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
