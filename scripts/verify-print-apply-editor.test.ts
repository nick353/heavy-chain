import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cutoutDrawRect, movePlacementLayer, type PrintPlacement } from '../src/components/lightchain/printPlacement.ts';

const editor = readFileSync(new URL('../src/components/lightchain/PrintApplyEditor.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');

test('the 適用 dialog mirrors Light: two steps, AI mask candidates, brush/eraser/toggle, cancel and confirm', () => {
  assert.match(editor, /ステップ1：画像のプリント領域をマスクで選択してください/);
  assert.match(editor, /ステップ2：プリントの角度とサイズを選択して調整/);
  assert.match(editor, /MASK_CANDIDATES = \['トップス', 'ボトムス', '全身'\]/);
  for (const label of ['AIマスク認識', 'ブラシ', '消しゴム', '切り替え', 'キャンセル', '決定']) assert.ok(editor.includes(label), label);
  assert.match(editor, /まず図案を追加してください/);
  assert.match(editor, /globalCompositeOperation = 'destination-in'/);
});

test('AIマスク認識 segments the garment with the cloth model and keeps the colour heuristic only as a fallback', () => {
  assert.match(editor, /buildPrintGarmentCutoutDataUrl\(\{ imageUrl: garmentUrl, modelName: 'u2net_cloth_seg', segmentationTarget: CANDIDATE_TARGET\[candidate\] \}\)/);
  assert.match(editor, /CANDIDATE_TARGET[^=]*= \{ トップス: 'upper', ボトムス: 'lower', 全身: 'full' \}/);
  assert.match(editor, /catch \{\s*return buildMaterialCutoutDataUrl\(\{ imageUrl: garmentUrl, mode: 'auto', candidate/);
  assert.match(editor, /cutoutDrawRect\(cutout,/);
});

test('ステップ2 places any of the uploaded prints, and the side tools match Light (レイヤー, flips, 複製, 削除)', () => {
  assert.match(editor, /export const MAX_PRINTS = 5;/);
  assert.match(editor, /prints\.map\(\(print\) => \(/);
  for (const label of ['トップに移動', '上に移動', '下に移動', '一番下に移動', 'レイヤー', '左右反転', '上下反転', '複製', 'プリントを削除', 'マスクを全て消す']) {
    assert.ok(editor.includes(label), label);
  }
  // Every placement is drawn in stacking order onto one layer that the mask clips.
  assert.match(editor, /for \(const placement of placements\)/);
  assert.match(editor, /layerContext\.scale\(placement\.flipX \? -1 : 1, placement\.flipY \? -1 : 1\)/);
});

test('the printing page keeps up to 5 prints with 適用 each, and the garment button opens the dialog', () => {
  assert.match(page, /data-testid="print-image-apply"/);
  assert.match(page, /data-testid="print-image-open-editor"/);
  assert.match(page, /\{printCount<MAX_PRINTS && \(/);
  assert.match(page, /<PrintApplyEditor garmentUrl=\{[^}]+\} prints=\{editorPrints\}/);
  assert.match(page, /if\(coverage!=='full'&&!printApplied\)\{toast\.error\(/);
  assert.match(page, /workspace\.upload\('primary',new File\(\[composite\],PRINT_APPLIED_FILE_NAME/);
  // The applied image already holds the prints, so the request asks to keep them rather than print again.
  assert.match(page, /printApplied\?printAppliedBrief\(/);
  // Extra prints are kept in the draft with one layer per design.
  assert.match(page, /designs\.map\(\(_,designIndex\)=>\(\{designIndex,layerId:`print-design-\$\{designIndex\+1\}`/);
});

const placement = (id: string): PrintPlacement => ({ id, printId: id, x: 0.5, y: 0.5, scale: 0.3, rotation: 0, flipX: false, flipY: false });
const order = (items: PrintPlacement[]) => items.map((item) => item.id).join('');

test('layer moves match Light: トップ / 上 / 下 / 一番下 (index 0 is the bottom)', () => {
  const stack = ['a', 'b', 'c', 'd'].map(placement);
  assert.equal(order(movePlacementLayer(stack, 'b', 'top')), 'acdb');
  assert.equal(order(movePlacementLayer(stack, 'b', 'up')), 'acbd');
  assert.equal(order(movePlacementLayer(stack, 'b', 'down')), 'bacd');
  assert.equal(order(movePlacementLayer(stack, 'c', 'bottom')), 'cabd');
  assert.equal(order(movePlacementLayer(stack, 'd', 'up')), 'abcd');
  assert.equal(order(movePlacementLayer(stack, 'a', 'down')), 'abcd');
  assert.equal(movePlacementLayer(stack, 'missing', 'top'), stack);
});

test('a cloth-model cutout cropped to the garment is drawn back into its bounds', () => {
  const frame = { width: 1000, height: 2000 };
  const cropped = cutoutDrawRect({ bounds: { x: 100, y: 400, width: 600, height: 900 }, sourceSize: frame, sourceFrameSize: frame, outputSize: { width: 300, height: 450 } }, { width: 500, height: 1000 });
  assert.deepEqual(cropped, { x: 50, y: 200, width: 300, height: 450 });
  const full = cutoutDrawRect({ bounds: { x: 100, y: 400, width: 600, height: 900 }, sourceSize: frame, sourceFrameSize: frame, outputSize: { width: 500, height: 1000 } }, { width: 500, height: 1000 });
  assert.deepEqual(full, { x: 0, y: 0, width: 500, height: 1000 });
});

test('after 適用 only the composed garment is sent, so prints that were not placed cannot appear', () => {
  const hook = readFileSync(new URL('../src/hooks/useCanonicalImageWorkspace.ts', import.meta.url), 'utf8');
  assert.match(hook, /configRef\.current\.sendSecondary===false\?null:snapshot\.slots\.secondary/);
  assert.match(page, /sendSecondary:sendPrintReference/);
  assert.match(page, /useEffect\(\(\)=>\{setSendPrintReference\(!printApplied\);\},\[printApplied\]\);/);
});

test('the draft keeps the garment from before 適用, so a reload never treats the composite as the garment', () => {
  assert.match(page, /const draftGarment=printApplied&&applyGarmentRef\.current\?applyGarmentRef\.current:referenceImage;/);
  assert.match(page, /persistPrintInputState\(currentBrand\.id,draftGarment,designs,/);
  assert.match(page, /if\(!printApplied\)applyGarmentRef\.current=referenceImage;/);
});

test('garments and prints uploaded on the printing page are kept in the library 履歴アップロード, like Light', () => {
  const history = readFileSync(new URL('../src/lib/libraryUploadHistory.ts', import.meta.url), 'utf8');
  assert.match(history, /featureType: 'lightchain-library-upload'/);
  assert.match(history, /libraryGroup: '履歴アップロード'/);
  assert.match(page, /void recordLibraryUpload\(\{brandId:currentBrand\.id,userId:user\?\.id,file\}\)/);
  // Draft restores never record again (they go through workspace.upload only).
  assert.equal((page.match(/recordLibraryUpload\(/g) ?? []).length, 2);
});
