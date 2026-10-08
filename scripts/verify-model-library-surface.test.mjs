import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const root = new URL('..', import.meta.url).pathname;
const temporary = await fs.mkdtemp(path.join(root, '.model-library-surface-'));
const outfile = path.join(temporary, 'surface.mjs');
await build({ entryPoints: [path.join(root, 'src/components/lightchain/SourceModelLibrarySurface.tsx')], outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'lucide-react'], plugins: [{ name: 'model-library-surface-io-fixtures', setup(builder) {
  const modules = {
    useCanonicalImageWorkspace: 'export const useCanonicalImageWorkspace=(toolId,config)=>{globalThis.__modelLibraryConfig={toolId,config};return globalThis.__modelLibrarySurface;};',
    authStore: 'export const useAuthStore=()=>({user:{id:"alice"},currentBrand:{id:"brand"},brandState:{requestGeneration:1}});',
    localWorkspaceArtifacts: 'export const listWorkspaceArtifacts=()=>[];',
    lightchainResume: 'export const readLightchainResumeResult=()=>null;',
    cloudflareApi: 'export const cloudflareDataPlane=null;',
    authBrandSelection: 'export const captureAuthBrandFence=()=>null;export const assertAuthBrandFence=()=>{};',
    CanonicalImageWorkspaceControls: 'export const CanonicalImageWorkspaceControls=()=>null;',
    GallerySelector: 'export const GallerySelector=()=>null;',
    LightchainHistoryPanel: 'export const LightchainHistoryPanel=()=>null;',
  };
  builder.onResolve({ filter: /react-router-dom/ }, () => ({ path: 'router', namespace: 'fixture' }));
  builder.onLoad({ filter: /^router$/, namespace: 'fixture' }, () => ({ contents: 'export const useNavigate=()=>()=>{};export const useLocation=()=>({pathname:"/model-library/model-custom-form",search:"?workspaceFeature=model-custom"});export const Link="a";', loader: 'js' }));
  builder.onResolve({ filter: /.*/ }, args => { const name = args.path.split('/').at(-1)?.replace(/\.(?:tsx?|jsx?)$/, ''); return Object.hasOwn(modules, name) ? { path: name, namespace: 'fixture' } : undefined; });
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => modules[args.path] ? { contents: modules[args.path], loader: 'js' } : undefined);
} }] });
const { SourceModelLibrarySurface } = await import(outfile);
const helperBuild = await build({ entryPoints: [path.join(root, 'src/lib/modelLibrarySettings.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const helper = await import(`data:text/javascript;base64,${Buffer.from(helperBuild.outputFiles[0].text).toString('base64')}`);
function render(inputState, { face = false, pending = false } = {}) {
  globalThis.__modelLibrarySurface = { inputState, toolId: 'model-custom', status: pending ? 'unknown' : 'ready', pendingId: pending ? 'old-uuid' : null,
    jobId: null, originalInputsAvailable: false, sourceSelectionScope: 'fixture', slots: { primary: null, secondary: face ? { imageUrl: 'https://fixture.test/face.png', sourceImageId: 'face-0' } : null }, candidates: [],
    setInputState() {}, clearSource() {}, upload() {}, selectModelReference() {}, generate() {}, brief: '', result: null };
  return renderToStaticMarkup(createElement(SourceModelLibrarySurface));
}
const generateTag = html => html.match(/<button[^>]*data-testid="heavy-model-generate"[^>]*>/)?.[0];
test('actual label surface has no file prerequisite and exposes recorded label mode', () => {
  const html = render(helper.defaultModelLibrarySettings());
  assert.match(html, /data-model-input-mode="label"/); assert.doesNotMatch(html, /type="file"/);
  assert.doesNotMatch(generateTag(html), /\sdisabled=/); assert.equal(globalThis.__modelLibraryConfig.config.requiredSources, 0);
  assert.match(html, /aria-label="年齢"/); assert.match(html, /aria-label="ハーフ"/);
});
test('actual custom surface exposes face, four genders, measured fields, prompt and required-face gate', () => {
  const custom = helper.chooseModelLibraryMode(helper.defaultModelLibrarySettings(), 'custom');
  const html = render(custom); assert.match(html, /data-model-input-mode="custom"/); assert.match(html, /aria-label="顔の参考図"/);
  assert.match(html, /参考画像ライブラリ/); assert.match(html, /男の子/); assert.match(html, /女の子/);
  assert.match(html, /aria-label="身長"/); assert.match(html, /aria-label="バスト\/胸囲"/); assert.match(html, /min="86" max="143"/);
  assert.match(html, /maxLength="800"/); assert.match(html, /data-testid="model-custom-body-preview"/); assert.match(generateTag(html), /\sdisabled=/);
  assert.match(html, /alt="プレビュー画像"/); assert.match(html, /0ee175d46d7c46bdc7bb78d26d96a709\.webp/);
  assert.doesNotMatch(html, /aria-label="顔の参考程度"/);
  assert.match(render(custom, { face: true }), /aria-label="顔の参考程度"/);
  assert.doesNotMatch(generateTag(render(custom, { face: true })), /\sdisabled=/);
});
test('female profile and unknown original mode remain distinct from fresh defaults', () => {
  const custom = helper.changeModelLibraryGender(helper.chooseModelLibraryMode(helper.defaultModelLibrarySettings(), 'custom'), '女性');
  assert.match(render(custom), /min="80" max="120"/);
  assert.match(render(custom), /fa9a82f60eb90212040467b90f492f19\.webp/);
  const unknown = render({ gender: '男性' }); assert.match(unknown, /data-model-input-mode="unavailable"/); assert.match(generateTag(unknown), /disabled/);
  assert.doesNotMatch(unknown, /aria-pressed="true"/);
});
test('retained unknown UUID disables both modes, face uploads and generation', () => {
  const custom = helper.chooseModelLibraryMode(helper.defaultModelLibrarySettings(), 'custom');
  const html = render(custom, { face: true, pending: true }); assert.match(generateTag(html), /disabled/);
  assert.match(html, /aria-pressed="true" disabled=""|disabled="" aria-pressed="true"/);
  assert.match(html, /aria-label="顔の参考図"[^>]*disabled=""/);
});
after(async () => { delete globalThis.__modelLibraryConfig; delete globalThis.__modelLibrarySurface; await fs.rm(temporary, { recursive: true, force: true }); });
