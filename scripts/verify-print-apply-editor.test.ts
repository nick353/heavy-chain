import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('../src/components/lightchain/PrintApplyEditor.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

test('the 適用 dialog mirrors Light: two steps, AI mask candidates, brush/eraser/toggle, cancel and confirm', () => {
  assert.match(editor, /ステップ1：画像のプリント領域をマスクで選択してください/);
  assert.match(editor, /ステップ2：プリントの角度とサイズを選択して調整/);
  assert.match(editor, /MASK_CANDIDATES = \['トップス', 'ボトムス', '全身'\]/);
  for (const label of ['AIマスク認識', 'ブラシ', '消しゴム', '切り替え', 'キャンセル', '決定']) assert.ok(editor.includes(label), label);
  assert.match(editor, /まず図案を追加してください/);
  assert.match(editor, /buildMaterialCutoutDataUrl\(\{ imageUrl: garmentUrl, mode: 'auto', candidate/);
  assert.match(editor, /globalCompositeOperation = 'destination-in'/);
});

test('the printing page opens the dialog from the print tile and gates spot generation until applied', () => {
  assert.match(page, /data-testid="print-image-apply"/);
  assert.match(page, /<PrintApplyEditor /);
  assert.match(page, /if\(coverage!=='full'&&!printApplied\)\{toast\.error\(/);
  assert.match(page, /workspace\.upload\('primary',new File\(\[composite\],PRINT_APPLIED_FILE_NAME/);
});
