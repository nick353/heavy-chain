import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const tools = read('src/components/lightchain/EditorImageTools.tsx');
const printDesign = read('src/pages/PrintDesignDetailPage.tsx');
const changeColor = read('src/pages/ChangeColorDetailPage.tsx');
const account = read('src/components/layout/AccountCenterDialog.tsx');
const layout = read('src/components/layout/Layout.tsx');

test('the image toolbar of パターンデザイン matches Light (measured 2026-10-28)', () => {
  for (const label of ['色調整', '画像調整', 'シームレス', '<UpscaleMenu', '<CollectButton', '<DownloadMenu', '<ShortcutSheetButton']) assert.ok(printDesign.includes(label), label);
  for (const label of ['色味', '彩度', '明るさ', 'コントラスト', '水平反転', '垂直反転', '透過度', '画像をトリミング', 'ダウンロードPNG', 'ダウンロードJPG', 'ダウンロードAVIF', '2K', '4K']) assert.ok(tools.includes(label), label);
  assert.match(printDesign, /ズーム倍率が大きいほど、上半身のプリントが大きくなります/);
  assert.match(printDesign, /キャンバスに保存/);
});

test('色変更 has the same 色調整, コレクション and ダウンロード, and both editors zoom with the wheel', () => {
  for (const label of ['<ColorAdjustPanel', '<CollectButton', '<DownloadMenu', '<ShortcutSheetButton']) assert.ok(changeColor.includes(label), label);
  for (const source of [printDesign, changeColor]) assert.match(source, /onWheel/);
});

test('マイアカウント and チーム管理 open Light-style account window with the team table', () => {
  for (const label of ['マイアカウント', 'チーム管理', '透かし（ウォーターマーク）表示', 'ログアウト', 'パスワードを変更する', 'ポイント残高', '消費ポイント', '登録時間', 'アカウント状態', '編集する', '追加']) assert.ok(account.includes(label), label);
  assert.match(layout, /<AccountCenterDialog/);
});
