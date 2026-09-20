import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
const paritySource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const patternSource = await readFile(new URL('../src/pages/PatternWorkspacePage.tsx', import.meta.url), 'utf8');
const studioSource = await readFile(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');
const launcherSource = await readFile(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');

test('Lightchain material choices are artifact-backed', () => {
  assert.match(source, /listWorkspaceArtifacts/);
  assert.match(source, /buildMaterialTabItems/);
  assert.match(source, /imageUrl: artifact\.imageUrl/);
  assert.match(source, /このタブに使える保存済み素材はありません/);
  assert.doesNotMatch(source, /title: '黒チェーン柄フーディー'/);
  assert.doesNotMatch(source, /title: '白背景Tシャツ'/);
  assert.doesNotMatch(source, /title: 'ブランド定番モデル'/);
  assert.doesNotMatch(source, /title: '25SS EC背景'/);
  assert.doesNotMatch(source, /title: '標準フーディーモック'/);
});

test('Lightchain project/history cards do not seed fake records', () => {
  assert.match(source, /保存済みの履歴はありません/);
  assert.match(source, /buildWorkspaceProjectCards/);
  assert.match(source, /プレビュー未取得/);
  assert.doesNotMatch(source, /title: 'ブランド春夏企画'/);
  assert.doesNotMatch(source, /title: '店舗ポスター', summary:/);
  assert.doesNotMatch(source, /title: 'ライブ配信素材'/);
  assert.doesNotMatch(source, /age: '[0-9]+(?:日|か月|ヶ月)前 修正'/);
});

test('Lightchain workbench restores only persisted results for the current tool', () => {
  assert.match(source, /findLatestPersistedLightchainResult/);
  assert.match(source, /isPersistedLightchainResultForTool/);
  assert.match(source, /metadataBoolean\(artifact, 'providerResultArtifact'\)/);
  assert.match(source, /metadataBoolean\(artifact, 'localPreviewArtifact'\)/);
  assert.match(source, /withSignedImageUrls\(\[\{/);
  assert.match(source, /lightchainResultRef\.current/);
  assert.match(source, /setResumeInputReadback\('restored'\)/);
});

test('Lightchain parity entrypoints do not inject fixed external or sample library assets', () => {
  assert.match(paritySource, /listWorkspaceArtifacts/);
  assert.doesNotMatch(paritySource, /static-cn\.linkaigc\.com\/workbenches/);
  assert.doesNotMatch(paritySource, /library-seed/);
  assert.doesNotMatch(paritySource, /素材サンプル 01/);
  assert.doesNotMatch(paritySource, /gallery-style-reference/);
});

test('pattern and studio workbenches do not prefill nonexistent reference files', () => {
  assert.doesNotMatch(patternSource, /chain_mark_ref\.svg|vintage_bandana_grid\.png|tee_mockup_front\.jpg/);
  assert.doesNotMatch(studioSource, /lookbook_ref_01\.jpg|fabric_ref_02\.png/);
});

test('Lightchain launcher uses Heavy-owned category chrome and saved artifacts for cases', () => {
  assert.doesNotMatch(launcherSource, /static-cn\.linkaigc\.com|lightchain-qlxy-prod\.oss-cn-hangzhou\.aliyuncs\.com|jp\.linkaigc\.com\/static/);
  assert.match(launcherSource, /listWorkspaceArtifacts/);
  assert.match(launcherSource, /withSignedImageUrls/);
  assert.match(launcherSource, /saved-\$\{artifact\.id\}/);
  assert.match(launcherSource, /このカテゴリに表示できる保存済み成果物はまだありません/);
});
