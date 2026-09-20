import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('model library follows the current Light canonical route and rejects the stale plural alias', async () => {
  const [app, catalog] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/lightchainUnifiedFeatureCatalog.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /path="\/model-library"/);
  assert.match(app, /path="\/models"[\s\S]*?LightchainSourceNotFoundPage/);
  assert.match(app, /path="\/credits"[\s\S]*?LightchainSourceNotFoundPage/);
  assert.match(catalog, /'model-library': \['\/model-library\/model-custom-form', '\/model-library'\]/);
  assert.doesNotMatch(catalog, /'model-library':[^\n]*'\/models'/);
  assert.match(app, /path="\/model-library\/model-custom-form"[\s\S]*?ModelLibraryPage/);
});

test('launcher routes model planning through the canonical Light entrypoint', async () => {
  const workbench = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const generate = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  const modelLibraryEntry = workbench.match(/\n  \{\n[\s\S]*?id: 'model-library',[\s\S]*?\n  \},/u)?.[0] ?? '';
  assert.match(modelLibraryEntry, /heavyChainHref: '\/model-library\/model-custom-form'/);
  assert.match(generate, /title: 'AIフィッティング', to: '\/model'/);
  assert.match(generate, /title: 'モデル企画ライブラリ', to: '\/model-library\/model-custom-form'/);
  assert.doesNotMatch(modelLibraryEntry, /heavyChainHref: '\/generate\?feature=model-matrix'/);
});

test('new fitting entrypoints use canonical /model while retaining the legacy resume alias', async () => {
  const [app, navigation, handoff, activity, mapping, parityCatalog, workbench, library] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/layout/navigation.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/lightchainLibraryHandoff.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/workspaceActivity.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/lightchain/heavyRouteMapping.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/lightchainParityCatalog.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainLibraryPage.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(navigation, /label: 'AIフィッティング',[\s\S]*?path: '\/model'/);
  assert.match(handoff, /feature\.id === 'ai-fitting' \|\| feature\.id === 'ai-fitting-reference'[\s\S]*?\? '\/model'/);
  assert.match(activity, /sourceResumePath === '\/fitting' \|\| sourceResumePath === '\/model'/);
  assert.match(activity, /return `\/model\?\$\{params\.toString\(\)\}`/);
  assert.match(mapping, /'virtual-fitting': '\/model'/);
  assert.match(mapping, /'flat-to-model': '\/model'/);
  assert.match(parityCatalog, /id: 'flat-to-model',[\s\S]*?route: '\/model'/);
  assert.match(workbench, /const selectedToolActionHref = isFittingDetail \? '\/model#fitting-material-workbench'/);
  assert.match(workbench, /data-track-id="desc:reference-image"/);
  assert.match(workbench, /title="プロンプトテンプレート"/);
  assert.match(workbench, /data-testid="lightchain-fitting-reference-image-modal"/);
  assert.match(workbench, /data-testid="lightchain-fitting-prompt-template-modal"/);
  assert.match(workbench, /data-testid="lightchain-fitting-reference-input"/);
  assert.match(workbench, /data-testid={`lightchain-fitting-reference-slot-\$\{slot\.key\}`}/);
  assert.match(workbench, /data-testid="lightchain-fitting-model-set-input"/);
  assert.match(workbench, /data-testid="lightchain-fitting-model-set-grid"/);
  assert.match(workbench, /data-track-category-value={category}/);
  assert.match(workbench, /data-track-id="model-set"/);
  assert.match(workbench, /今すぐカスタマイズ/);
  assert.match(workbench, /data-testid="lightchain-fitting-reference-library-modal"/);
  assert.match(workbench, /data-testid="lightchain-fitting-batch-permission"/);
  assert.match(workbench, /alt="タスクなし"/);
  assert.match(workbench, /LIGHTCHAIN_FITTING_EMPTY_TASK_IMAGE_URL/);
  assert.match(workbench, /LIGHTCHAIN_FITTING_EXAMPLE_IMAGE_URL/);
  assert.match(library, /destination === 'fitting'[\s\S]*?`\/model\?libraryArtifactId=/);
  assert.match(app, /path="\/fitting"/);
});
