import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

test('design production saved cards expose Light-compatible menu and pin persistence', () => {
  assert.match(source, /export function LightchainDesignProductionPage/);
  assert.match(source, /heavy-design-production-pins:\$\{brandId\}/);
  assert.match(source, /aria-label=\{`\$\{artifact\.title\}のメニュー`\}/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /ピン留め/);
  assert.match(source, /saveWorkspaceArtifactBestEffort/);
  assert.match(source, /deleteWorkspaceArtifactsPersisted/);
  assert.match(source, /アセットライブラリーに保存しました/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /projectsPerPage = 6/);
  assert.match(source, /data-testid="design-production-pagination"/);
  assert.match(source, /aria-label="前のページ"/);
  assert.match(source, /aria-label="次のページ"/);
});

test('design production creation cards match the current Light source contract', () => {
  assert.match(source, /function CreationCard\(/);
  assert.match(source, /title="インスピレーション" actionLabel="デザインプロジェクトを新規作成"/);
  assert.match(source, /title="ブリン卜修正" actionLabel="プリントプロジェクトを新規作成"/);
  assert.match(source, /title="生地イメージ" actionLabel="生地プロジェクトを新規作成"/);
  assert.match(source, /title="企画提案書" actionLabel="企画提案書を新規作成"/);
  assert.doesNotMatch(source, /onClick=\{\(\) => navigate\('\/canvas\/new'\)\}.*title="新規ファイル"/s);
});
