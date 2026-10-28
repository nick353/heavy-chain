import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const repair = read('src/pages/LightchainImageRepairPage.tsx');
const dialog = read('src/components/lightchain/MaskPaintDialog.tsx');
const parity = read('src/pages/LightchainParityPages.tsx');

test('画像修正 after an upload matches Light: 再アップロード, the round mask button and the mask window (measured 2026-10-28)', () => {
  assert.match(repair, /data-testid="image-repair-reupload"/);
  assert.match(repair, /data-testid="image-repair-mask"/);
  assert.match(repair, /<MaskPaintDialog imageUrl=\{source\.imageUrl\} hint="手足の変形を修正" paneTitle="変更したい手足の部分をマスクで選択してください"/);
  // The inline brush and its clear button are gone; the mask is painted only in the window.
  assert.doesNotMatch(repair, /マスクをクリア/);
  for (const label of ['AIマスク認識', '選択範囲にオブジェクトを追加', '>追加<', '>取り除く<', 'ブラシ', '消しゴム', '全削除', 'キャンセル', '決定', '<ShortcutSheetButton']) assert.ok(dialog.includes(label), label);
});

test('ベクター and 平絵をベクター化 show 再アップロード on the source and アップロード中 in the result panel', () => {
  assert.match(parity, /data-testid="vector-reupload"/);
  assert.match(parity, /data-testid="vector-uploading"[^>]*>.*アップロード中/s);
});
