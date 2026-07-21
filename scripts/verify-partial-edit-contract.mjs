import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const sources = {
  modal: read('src/components/canvas/PartialEditModal.tsx'),
  toolbar: read('src/components/canvas/FloatingToolbar.tsx'),
  page: read('src/pages/CanvasEditorPage.tsx'),
  api: read('src/lib/imageApi.ts'),
  helper: read('supabase/functions/_shared/openaiImage.ts'),
  function: read('supabase/functions/edit-image/index.ts'),
  deploy: read('scripts/deploy-edge-functions.sh'),
};

const checks = [
  ['modal exposes blue mask canvas', /data-testid="partial-edit-mask-canvas"/.test(sources.modal)],
  ['modal renders an API mask canvas', /ref=\{apiMaskRef\}/.test(sources.modal) && /data-testid="partial-edit-api-mask-canvas"/.test(sources.modal)],
  ['modal creates alpha mask data URL', /apiCanvas\.toDataURL\('image\/png'\)/.test(sources.modal)],
  ['modal has one explicit submit action', /data-testid="partial-edit-submit"/.test(sources.modal)],
  ['toolbar exposes partial edit action', /onAction\('(partial-edit|inpaint)'\)/.test(sources.toolbar)],
  ['page wires partial edit modal', /<PartialEditModal/.test(sources.page) && /handlePartialEditSubmit/.test(sources.page)],
  ['page marker counts partial edit results', /partialEditResultCount/.test(sources.page) && /heavyCanvasPartialEditState/.test(sources.page)],
  ['client sends mask payload', /maskDataUrl: options\?\.maskDataUrl/.test(sources.api)],
  ['helper accepts remote HTTPS input', /parsedUrl\.protocol !== 'https:'/.test(sources.helper) && /responseBlob\.arrayBuffer/.test(sources.helper)],
  ['helper appends multipart mask', /formData\.append\('mask'/.test(sources.helper)],
  ['edge function persists inpaint provenance', /feature_type: hasMask \? 'inpaint'/.test(sources.function) && /backendProvider: 'supabase-edge-function'/.test(sources.function)],
  ['edge function returns mask result readback', /maskApplied: hasMask/.test(sources.function) && /parentObjectId: safeParentObjectId/.test(sources.function)],
  ['edit-image is deployable by allowlist', /  edit-image\n/.test(sources.deploy)],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
const result = {
  schema: 'heavy-chain.partial-edit-contract.v1',
  status: failed.length === 0 ? 'pass' : 'fail',
  checks: Object.fromEntries(checks.map(([name, passed]) => [name, passed])),
  failed,
};
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exitCode = 1;
