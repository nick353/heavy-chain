import assert from 'node:assert/strict';
import fs from 'node:fs';

const authStore = fs.readFileSync(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
const workbench = fs.readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
const workspaceHelper = fs.readFileSync(new URL('../src/lib/heavyWorkspace.ts', import.meta.url), 'utf8');
const sharedSurfaces = [
  'HistoryPage.tsx',
  'JobsPage.tsx',
  'GalleryPage.tsx',
  'CanvasEditorPage.tsx',
  'FittingPage.tsx',
  'LightchainWorkbenchPage.tsx',
  'LightchainMaterialWorkbenchPage.tsx',
]
  .map((file) => [file, fs.readFileSync(new URL(`../src/pages/${file}`, import.meta.url), 'utf8')]);

assert.match(authStore, /isHeavyWorkspaceBrandName/);
assert.match(authStore, /accessibleBrands\.find\(isHeavyWorkspaceBrand\)/);
assert.match(authStore, /set\(\{ currentBrand: existingHeavy \}\)/);
assert.match(workbench, /if \(isHeavyRoute\) \{[\s\S]*?void ensureHeavyWorkspace\(\);/);
assert.match(workbench, /const generationBrand = isHeavyRoute && heavyOwnedFeature && user\?\.id/);
assert.match(workbench, /isHeavyRoute && heavyOwnedFeature \? await ensureHeavyWorkspace\(\)/);
assert.match(workspaceHelper, /hostname\.includes\('heavy-chain'\)/);
assert.match(workspaceHelper, /heavy chain workspace/i);
for (const [file, source] of sharedSurfaces) {
  assert.match(source, /isHeavyWorkspaceRuntime/);
  assert.match(source, /ensureHeavyWorkspace/);
}
const materialSource = sharedSurfaces.find(([file]) => file === 'LightchainMaterialWorkbenchPage.tsx')?.[1] ?? '';
assert.match(materialSource, /let generationBrand = isHeavyRoute && heavyOwnedFeature && user\?\.id[\s\S]*?await ensureHeavyWorkspace\(\)/);

console.log('heavy-workspace-routing: 18/18 passed');
