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
  assert.match(source, /designProductionSourceProjectAgesHours/);
  assert.match(source, /const projectPageCount = 6/);
  assert.match(source, /const visibleProjectArtifacts = displayDesignArtifacts/);
  assert.match(source, /formatDesignProductionSourceArtifactDate/);
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
  assert.match(source, /grid-cols-2 sm:grid-cols-5" aria-label="新規ファイル"/);
  assert.match(source, /className="mt-6 grid gap-2 grid-cols-2 sm:grid-cols-5"/);
  assert.match(source, /max-w-\[1157px\] px-6 py-7 lg:px-0/);
  assert.match(source, /border-dashed border-white\/10 bg-white\/5 p-5 text-center/);
  assert.match(source, /aria-label="残りクレジット"/);
  assert.match(source, /<Plus className="h-8 w-8 text-white" \/>[\s\S]*新規ファイル/);
  assert.match(source, /relative flex min-h-\[160px\] w-full flex-col/);
  assert.match(source, /absolute bottom-0 left-1\/2[\s\S]*inline-flex h-8/);
  assert.match(source, /bottom-0 left-1\/2/);
  assert.match(source, /bg-\[#0bc1b8\]/);
  assert.match(source, /デザインプロジェクトを新規作成: 'w-\[228px\]'/);
  assert.match(source, /生地プロジェクトを新規作成: 'w-\[204px\]'/);
  assert.match(source, /企画提案書を新規作成: 'w-\[168px\]'/);
  assert.match(source, /\{actionLabel\}/);
  const creationCard = source.match(/function CreationCard\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(creationCard, /type="submit"/);
  assert.doesNotMatch(source, /absolute inset-0 z-10 rounded-2xl border border-transparent bg-transparent text-transparent/);
  assert.doesNotMatch(source, /onClick=\{\(\) => navigate\('\/canvas\/new'\)\}.*title="新規ファイル"/s);
});
