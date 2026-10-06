import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Heavy authenticated routes use the compact Light-shaped shell everywhere', async () => {
  const layout = await read('src/components/layout/Layout.tsx');
  assert.match(layout, /isHeavyWorkspaceRuntime/);
  assert.match(layout, /const isHeavyWorkspacePage = isHeavyWorkspaceRuntime\(\) && !isPublicPage/);
  assert.match(layout, /const isLightchainRoute = isHeavyWorkspacePage\s*\n\s*\|\|/);
  assert.match(layout, /isHeavyWorkspacePage && location\.pathname\.endsWith\('\/printing-image'\)/);
});

test('Heavy first paint keeps the compact Light-shaped launcher during auth hydration', async () => {
  const app = await read('src/App.tsx');
  assert.match(app, /import \{ LightchainLauncherHeader \} from '\.\/components\/layout\/LightchainLauncherHeader';/);
  assert.match(app, /import \{ isHeavyWorkspaceRuntime \} from '\.\/lib\/heavyWorkspace';/);
  assert.match(app, /const renderHeader = showHeader \|\| heavyRuntime;/);
  assert.match(app, /data-heavy-loading-shell=\{heavyRuntime \? 'compact-light-shaped' : undefined\}/);
  assert.match(app, /renderHeader && heavyRuntime \? <LightchainLauncherHeader \/>/);
});

test('Heavy launcher keeps Light feature copy unchanged apart from the Heavy brand', async () => {
  const catalog = await read('src/lib/lightchainParityCatalog.ts');
  assert.match(catalog, /'design-agent': 'インスピレーションワークスペース'/);
  assert.doesNotMatch(catalog, /'design-agent': 'インサイト意思決定ワークベンチ'/);
});

test('Heavy public launcher keeps Heavy route aliases on the Heavy host', async () => {
  const launcher = await read('src/components/GenerateLightchainEntry.tsx');
  assert.match(launcher, /isHeavyWorkspaceRuntime\(\)/);
  assert.match(launcher, /const isHeavyRoute = isHeavyWorkspaceRuntime\(\)/);
  assert.match(launcher, /href\.replace\(\/\^\\\/lightchain/);
});

test('Heavy fitting keeps Light geometry without exposing the Light plan-lock affordance', async () => {
  const workbench = await read('src/pages/LightchainWorkbenchPage.tsx');
  assert.match(workbench, /const showModelPermissionGate = !isHeavyRoute\s*\n\s*&& isModelWorkspaceRoute/);
  assert.match(workbench, /data-testid="lightchain-model-permission"/);
  assert.match(workbench, /data-testid="lightchain-fitting-canvas-save"/);
});

test('Heavy routes retain the complete non-video feature inventory', async () => {
  const [catalog, app, capability] = await Promise.all([
    read('src/lib/lightchainUnifiedFeatureCatalog.ts'),
    read('src/App.tsx'),
    read('src/lib/heavyCapability.ts'),
  ]);
  const entriesSource = catalog.slice(catalog.indexOf('const entries:'), catalog.indexOf('const routeAliases:'));
  const catalogIds = [...entriesSource.matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9-]+))\s*:\s*\{/gmu)]
    .map((match) => match[1] ?? match[2]);
  assert.equal(catalogIds.length, 31, 'the non-video catalog must stay at 31 rows');
  assert.match(app, /path="\/heavy"/);
  assert.match(app, /path="\/heavy\/fabric-image"/);
  assert.match(app, /path="\/heavy\/printing-image"/);
  assert.match(app, /path="\/heavy\/:toolId"/);
  for (const id of catalogIds) {
    const escaped = id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    assert.match(capability, new RegExp(`(?:['"]${escaped}['"]|\\b${escaped}\\b)\\s*:`));
  }
});

test('Heavy parity removes legacy Light-only locks from every reused image surface', async () => {
  const [parityPages, modelLibrary, workbench, materialWorkbench] = await Promise.all([
    read('src/pages/LightchainParityPages.tsx'),
    read('src/pages/ModelLibraryPage.tsx'),
    read('src/pages/LightchainWorkbenchPage.tsx'),
    read('src/pages/LightchainMaterialWorkbenchPage.tsx'),
  ]);
  assert.match(parityPages, /const heavyRuntime = isHeavyWorkspaceRuntime\(\);/);
  assert.match(parityPages, /data-testid="heavy-creator-generate"/);
  assert.match(parityPages, /data-testid="heavy-pattern-vector-generate"/);
  assert.match(modelLibrary, /isHeavyWorkspaceRuntime\(\) \? 'ログイン済みワークスペースから生成できます。'/);
  assert.match(workbench, /disabled=\{!isHeavyRoute\} onClick=\{\(\) => \{ if \(isHeavyRoute\) void handleLightchainPreviewGenerate\(\); \}\}/);
  assert.match(materialWorkbench, /const heavyLoginOnlyReady = heavyOwnedFeature && Boolean\(user\?\.id\);/);
  assert.match(materialWorkbench, /const sourceFabricAdmitted = isHeavyRoute \|\| sourceFabricAccess === 'admitted';/);
  assert.match(materialWorkbench, /sourceFabricAdmitted \?/);
});
