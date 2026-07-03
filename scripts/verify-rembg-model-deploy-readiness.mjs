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
add('no_public_models_tracked_by_git', gitTrackedModels.length === 0, {
  tracked: gitTrackedModels,
});
add('source_supports_model_base_url_env', source.includes('VITE_REMBG_MODEL_BASE_URL') && source.includes("'/models'"), {
  file: 'src/lib/workspaceMaterialReferences.ts',
});
add('model_load_failure_is_fail_closed', source.includes('高精度AI切り抜きモデルを読み込めませんでした'), {
  file: 'src/lib/workspaceMaterialReferences.ts',
});
add('env_examples_include_model_base_url', envExample.includes('VITE_REMBG_MODEL_BASE_URL') && prodEnvExample.includes('VITE_REMBG_MODEL_BASE_URL'), {
  files: ['.env.example', '.env.production.example'],
});
add('zeabur_requires_model_base_url', zeaburConfig?.env?.VITE_REMBG_MODEL_BASE_URL?.required === true, {
  file: 'zeabur.json',
  value: zeaburConfig?.env?.VITE_REMBG_MODEL_BASE_URL ?? null,
});
add('env_check_requires_model_base_url', checkEnv.includes("'VITE_REMBG_MODEL_BASE_URL'"), {
  file: 'scripts/check-env.mjs',
});
add('docs_name_cors_model_requirement', readme.includes('VITE_REMBG_MODEL_BASE_URL') && checklist.includes('VITE_REMBG_MODEL_BASE_URL') && checklist.includes('CORS'), {
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
      'large ONNX model is not committed to Git',
      'production build has an explicit CORS-enabled model base URL requirement',
      'missing model URL fails closed instead of enabling AI fitting generation',
    ],
    notPerformed: [
      'Zeabur dashboard environment mutation',
      'remote model CDN upload',
      'production browser fetch of isnet-general-use.onnx',
    ],
  },
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
