import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../src/components/layout/Layout.tsx', import.meta.url), 'utf8');
const parityPagesSource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const permissionComponentSource = await readFile(new URL('../src/components/lightchain/PermissionLockedButton.tsx', import.meta.url), 'utf8');
const modelLibrarySource = await readFile(new URL('../src/pages/ModelLibraryPage.tsx', import.meta.url), 'utf8');
const workbenchSource = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

test('exposes the observed Light Chain direct routes in Heavy App', () => {
  for (const route of ['/creator', '/model', '/tools/fabric', '/designProduction', '/designProduction/detail', '/asset-center', '/flow/orientedDesign']) {
    assert.match(appSource, new RegExp(`path=\\"${route.replace('/', '\\/')}\\"`), `missing App route: ${route}`);
    assert.match(layoutSource, new RegExp(`'${route.replace(/\/detail$/, '')}'`), `missing Light shell alias: ${route}`);
  }
});

test('keeps permission and purchase boundaries visible in the parity screens', () => {
  // The internal beta is available to all employees; the legacy plan lock was
  // intentionally removed. The source permission surface is separate from
  // rights-attestation UI, which Light Chain does not render.
  assert.doesNotMatch(parityPagesSource, /PermissionLockedButton/);
  assert.match(permissionComponentSource, /権限がありません/);
  assert.match(parityPagesSource, /AIフィッティングを開く/);
  assert.match(parityPagesSource, /生成履歴/);
  assert.match(parityPagesSource, /キーワード辞典/);
});

test('keeps the observed dialogue scene prompts and gallery reuse affordance', () => {
  assert.match(parityPagesSource, /生地パターン適用/);
  assert.match(parityPagesSource, /線画から実写化/);
  assert.match(parityPagesSource, /デザインミックス/);
  assert.match(parityPagesSource, /プリント修正/);
  assert.match(parityPagesSource, /画像1/);
  assert.match(parityPagesSource, /画像2/);
});

test('keeps the model-library alias on the shared workflow contract', () => {
  assert.match(modelLibrarySource, /data-workflow-contract=\{UNIFIED_FEATURE_WORKFLOW_CONTRACT_VERSION\}/);
  assert.match(modelLibrarySource, /data-workflow-feature="model-library"/);
  assert.match(modelLibrarySource, /data-workflow-result-destinations=\{modelLibraryWorkflowContract\?\.resultDestinations\.join\(','\) \?\? ''\}/);
  assert.match(modelLibrarySource, /data-workflow-rights-gate=\{modelLibraryWorkflowContract\?\.rightsGate \?\? ''\}/);
  assert.match(modelLibrarySource, /data-testid="model-library-permission-surface"/);
  assert.match(modelLibrarySource, /権限がありません/);
  assert.doesNotMatch(modelLibrarySource, /生成直前に権利確認を行います/);
  assert.match(modelLibrarySource, /getLightchainUnifiedFeatureWorkflowContract\('model-library'\)/);
  assert.match(modelLibrarySource, /buildGenerationIntentHref/);
});

test('uses Light Chain /model as the canonical AI fitting entrypoint', () => {
  const fittingEntries = [...workbenchSource.matchAll(/id: 'ai-fitting(?:-[^']+)?'[\s\S]*?heavyChainHref: '([^']+)'/g)].map((match) => match[1]);
  assert.ok(fittingEntries.length >= 1, 'missing AI fitting catalog entries');
  assert.ok(fittingEntries.every((href) => href.startsWith('/model')), `non-canonical AI fitting hrefs: ${fittingEntries.join(', ')}`);
  assert.match(parityPagesSource, /navigate\(`\/model\?/);
  assert.match(workbenchSource, /to="\/model#fitting-history"|navigate\('\/model#fitting-history'\)/);
});
