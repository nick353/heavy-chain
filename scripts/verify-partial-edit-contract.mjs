import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sources = {
  modal: read('src/components/canvas/PartialEditModal.tsx'), toolbar: read('src/components/canvas/FloatingToolbar.tsx'),
  page: read('src/pages/CanvasEditorPage.tsx'), api: read('src/lib/imageApi.ts'), client: read('src/lib/cloudflareApi.ts'),
  image: read('src/lib/cloudflareImageAI.ts'), protectedEdit: read('src/lib/cloudflareProtectedImageEdit.ts'),
};
const active = Object.values(sources).join('\n');
const retired = /(?:supabase\.co|@supabase\/|\/functions\/v1\/|supabase-edge-function|OPENAI_API_KEY)/i;
const checks = [
  ['modal exposes blue mask canvas', /data-testid="partial-edit-mask-canvas"/.test(sources.modal)],
  ['modal renders an API mask canvas', /ref=\{apiMaskRef\}/.test(sources.modal) && /data-testid="partial-edit-api-mask-canvas"/.test(sources.modal)],
  ['modal creates alpha mask data URL', /apiCanvas\.toDataURL\('image\/png'\)/.test(sources.modal)],
  ['modal has one explicit submit action', /data-testid="partial-edit-submit"/.test(sources.modal)],
  ['toolbar exposes partial edit action', /onAction\('(partial-edit|inpaint)'\)/.test(sources.toolbar)],
  ['page wires partial edit modal', /<PartialEditModal/.test(sources.page) && /handlePartialEditSubmit/.test(sources.page)],
  ['page marker counts partial edit results', /partialEditResultCount/.test(sources.page) && /heavyCanvasPartialEditState/.test(sources.page)],
  ['client sends mask payload', /maskDataUrl: options\?\.maskDataUrl/.test(sources.api)],
  ['client routes image edits through Cloudflare provider actions', /invokeImageAction<ImageEditResult>\('edit-image'/.test(sources.api) && /\/v1\/provider-actions\//.test(sources.client)],
  ['protected edit builds a bounded provider guide', /buildProviderMaskGuide/.test(sources.protectedEdit) && /protectedEdit:plan/.test(sources.protectedEdit)],
  ['protected edit persists a composite through Cloudflare workspace artifacts', /saveWorkspaceArtifact/.test(sources.protectedEdit) && /\/v1\/workspace-artifacts\//.test(sources.protectedEdit)],
  ['protected edit verifies Cloudflare receipt identity', /backendProvider !== 'cloudflare-workers-ai'/.test(sources.protectedEdit) && /protected_edit_receipt_plan_mismatch/.test(sources.protectedEdit)],
  ['protected edit reads private media after save', /\/v1\/media\/read\?/.test(sources.protectedEdit) && /protected_edit_final_media_readback_invalid/.test(sources.protectedEdit)],
  ['Cloudflare input rejects unsupported direct mask fallback', /maskDataUrl \|\| body\.maskApplied/.test(sources.image) && /Cloudflare画像AIでまだ対応していません/.test(sources.image)],
  ['active partial-edit sources have no retired provider reference', !retired.test(active)],
];
const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
const result = {
  schema: 'heavy-chain.partial-edit-contract.v2', status: failed.length === 0 ? 'pass' : 'fail',
  mode: 'static-cloudflare-protected-edit-no-provider-submit',
  checks: Object.fromEntries(checks.map(([name, passed]) => [name, passed])), failed,
  irreversibleActions: { generationSubmit: 'not_clicked', deploy: 'not_run' },
  proofLimits: ['This gate does not prove authenticated production inference, visual quality, R2 data readback, or device/browser completion.'],
};
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exitCode = 1;
