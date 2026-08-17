import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

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
