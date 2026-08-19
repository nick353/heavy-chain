import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  getLightchainUnifiedRouteAliases,
  lightchainUnifiedFeatureCatalog,
} from '../src/lib/lightchainUnifiedFeatureCatalog.ts';

test('first complete apparel flows use the unified workspace shell', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const shell = fs.readFileSync('src/components/workspace/LightchainUnifiedWorkspaceShell.tsx', 'utf8');

  assert.match(app, /<LightchainUnifiedWorkspaceShell>[\s\S]*?<FittingPage \/>[\s\S]*?<\/LightchainUnifiedWorkspaceShell>/);
  assert.match(app, /path="\/lightchain\/:toolId"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<LightchainWorkbenchPage \/>[\s\S]*?<\/LightchainUnifiedWorkspaceShell>/);
  assert.match(app, /path="\/lightchain"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<GenerateLightchainEntry \/>[\s\S]*?<\/LightchainUnifiedWorkspaceShell>/);
  assert.match(app, /path="\/lightchain\/fabric-image"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<LightchainMaterialWorkbenchPage \/>/);
  assert.match(app, /path="\/lightchain\/printing-image"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<LightchainMaterialWorkbenchPage \/>/);
  assert.match(app, /path="\/tools\/printing"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<LightchainMaterialWorkbenchPage \/>/);
  assert.match(app, /path="\/model-library\/model-custom-form"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<ModelLibraryPage \/>/);
  assert.match(app, /path="\/flow\/integration"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<FashionStudioPage \/>/);
  assert.match(app, /path="\/flow\/laboratory"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<LabPage \/>/);
  assert.match(shell, /data-testid="lightchain-parity-shell"/);
  assert.match(shell, /data-flow-state=\{flowState\}/);
  assert.match(shell, /UnifiedWorkspaceFlowContext\.Provider/);
  assert.match(shell, /getUnifiedWorkspaceFlowScopeKey/);
  assert.match(shell, /writeUnifiedWorkspaceFlowState/);
  assert.doesNotMatch(shell, /Heavy Chain \/ Apparel Beta/);
  assert.doesNotMatch(shell, /heavy-unified-feature-library/);
  assert.doesNotMatch(shell, /heavy-unified-context-rail/);
  assert.doesNotMatch(shell, /共通フロー/);
  assert.doesNotMatch(shell, /社内βの状態/);
  assert.doesNotMatch(shell, /Gallery \/ Canvas \/ History \/ Jobs/);
  assert.match(shell, /getLightchainUnifiedRouteAliases/);
  assert.match(app, /path="\/tools\/line-draft-to-tile"/);
  assert.match(app, /path="\/tools\/svg-convert"/);
  assert.match(app, /path="\/editor\/changeColor"/);
  assert.match(app, /path="\/editor\/pattern"/);
  assert.match(app, /path="\/editor\/patternDesign"/);
  assert.match(app, /path="\/gallery"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<GalleryPage \/>[\s\S]*?<\/LightchainUnifiedWorkspaceShell>/);
  assert.match(app, /path="\/history"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<HistoryPage \/>[\s\S]*?<\/LightchainUnifiedWorkspaceShell>/);
  assert.match(app, /path="\/jobs"[\s\S]*?<LightchainUnifiedWorkspaceShell>[\s\S]*?<JobsPage \/>[\s\S]*?<\/LightchainUnifiedWorkspaceShell>/);
  const catalog = fs.readFileSync('src/lib/lightchainParityCatalog.ts', 'utf8');
  const navigation = fs.readFileSync('src/components/layout/navigation.ts', 'utf8');
  assert.match(catalog, /duplicateRoute/);
  assert.match(catalog, /params\.set\('lcFeature', feature\.id\)/);
  assert.doesNotMatch(navigation, /path: '\/video'/);
  const fitting = fs.readFileSync('src/pages/FittingPage.tsx', 'utf8');
  const material = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  const generate = fs.readFileSync('src/pages/GeneratePage.tsx', 'utf8');
  const workbench = fs.readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  const auxiliaryPages = [
    'src/pages/MarketingWorkspacePage.tsx',
    'src/pages/FashionStudioPage.tsx',
    'src/pages/ModelLibraryPage.tsx',
    'src/pages/PatternWorkspacePage.tsx',
    'src/pages/LabPage.tsx',
  ].map((path) => fs.readFileSync(path, 'utf8'));
  assert.match(fitting, /data-flow-state={fittingFlowState}/);
  assert.match(material, /data-flow-state={materialFlowState}/);
  assert.match(generate, /useUnifiedWorkspaceFlow/);
  assert.match(generate, /deriveUnifiedWorkspaceFlowState/);
  assert.match(generate, /setFlowState\(unifiedFlowState\)/);
  assert.match(generate, /data-testid="heavy-generate-workspace"/);
  assert.match(generate, /data-flow-state-label=\{unifiedWorkspaceFlowLabels\[unifiedFlowState\]\}/);
  assert.match(workbench, /useUnifiedWorkspaceFlow/);
  assert.match(workbench, /deriveUnifiedWorkspaceFlowState/);
  assert.match(workbench, /setFlowState\(unifiedFlowState\)/);
  assert.match(workbench, /data-flow-state-label=\{unifiedWorkspaceFlowLabels\[unifiedFlowState\]\}/);
  auxiliaryPages.forEach((source) => {
    assert.match(source, /useUnifiedWorkspaceFlow/);
    assert.match(source, /deriveUnifiedWorkspaceFlowState/);
    assert.match(source, /data-flow-state-label=\{unifiedWorkspaceFlowLabels\[/);
  });
});

test('unified workspace library exposes exactly the 31 non-video compatibility functions', () => {
  assert.equal(lightchainUnifiedFeatureCatalog.length, 31);
  assert.equal(new Set(lightchainUnifiedFeatureCatalog.map((feature) => feature.id)).size, 31);
  assert.equal(lightchainUnifiedFeatureCatalog.some((feature) => feature.id.includes('video')), false);
  assert.equal(lightchainUnifiedFeatureCatalog.every((feature) => feature.betaIncluded !== false), true);
});

test('unified workspace aliases current Heavy-compatible Lightchain entry routes', () => {
  const expected = new Map([
    ['marketing-home', '/marketing'],
    ['ai-fitting', '/model'],
    ['wear-design-lab', '/flow/orientedDesign'],
    ['model-library', '/model-library/model-custom-form'],
    ['fashion-studio', '/flow/integration'],
    ['design-agent', '/agent'],
    ['lab', '/flow/laboratory'],
    ['print-design-project', '/editor/patternDesign'],
    ['fabric-image', '/tools/fabric'],
    ['line-to-real', '/tools/line-draft-to-tile'],
    ['pattern-vector-pro', '/tools/vector-special'],
    ['printing-image', '/tools/printing'],
    ['image-repair', '/tools/reactor'],
    ['svg-convert', '/tools/svg-convert'],
    ['custom-style', '/model-base/style'],
  ]);

  for (const [featureId, route] of expected) {
    assert.equal(getLightchainUnifiedRouteAliases(featureId)[0], route, featureId);
  }
});

test('every unified workspace alias is implemented by an App route inside the shared shell', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const routeBlocks = [...app.matchAll(/<Route\s+path="([^"]+)"[\s\S]*?(?=\n\s*<Route|\n\s*<\/Routes>)/g)]
    .map((match) => ({ path: match[1], source: match[0] }));
  const aliasPaths = new Set(
    lightchainUnifiedFeatureCatalog.flatMap((feature) => getLightchainUnifiedRouteAliases(feature.id)),
  );

  assert.equal(aliasPaths.size, 24);
  for (const path of aliasPaths) {
    const matches = routeBlocks.filter((route) => route.path === path);
    assert.equal(matches.length, 1, `${path} must have exactly one App route`);
    assert.match(matches[0].source, /LightchainUnifiedWorkspaceShell/, `${path} must use the shared workspace shell`);
  }
});
