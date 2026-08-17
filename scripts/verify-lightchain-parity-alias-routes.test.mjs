import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../src/components/layout/Layout.tsx', import.meta.url), 'utf8');
const parityPagesSource = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const permissionComponentSource = await readFile(new URL('../src/components/lightchain/PermissionLockedButton.tsx', import.meta.url), 'utf8');

test('exposes the observed Light Chain direct routes in Heavy App', () => {
  for (const route of ['/creator', '/model', '/tools/fabric', '/designProduction', '/designProduction/detail', '/asset-center', '/flow/orientedDesign']) {
    assert.match(appSource, new RegExp(`path=\\"${route.replace('/', '\\/')}\\"`), `missing App route: ${route}`);
    assert.match(layoutSource, new RegExp(`'${route.replace(/\/detail$/, '')}'`), `missing Light shell alias: ${route}`);
  }
});

test('keeps permission and purchase boundaries visible in the parity screens', () => {
  assert.match(parityPagesSource, /PermissionLockedButton/);
  assert.match(permissionComponentSource, /権限がありません/);
  assert.match(parityPagesSource, /このモジュールは購入後に使用可能/);
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
