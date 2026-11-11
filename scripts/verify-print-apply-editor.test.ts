import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cutoutDrawRect, fitPlacementToBounds, initialPlacementGeometry, maskBounds, movePlacementLayer, printEditRegionMask, regionAtPoint, type PrintPlacement } from '../src/components/lightchain/printPlacement.ts';
import { CLOTH_PARTS, clothPartMaskRgba, clothPartsClassMap, clothPartsInputTensorData, foundClothParts } from '../src/features/printing/selection/clothPartsMath.ts';

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

test('AIマスク認識 runs the cloth model in a worker once per garment, lists only the found parts, and keeps the colour heuristic as a fallback (2026-11-11)', () => {
  const worker = readFileSync(new URL('../src/features/printing/selection/clothParts.worker.ts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/features/printing/selection/clothParts.ts', import.meta.url), 'utf8');
  // Started when the dialog opens, cached per garment URL, off the page thread.
  assert.match(editor, /analyzeClothParts\(garmentUrl\)/);
  assert.match(client, /new Worker\(new URL\('\.\/clothParts\.worker\.ts', import\.meta\.url\)/);
  assert.match(client, /const analyses = new Map<string, Promise<ClothPartsAnalysis>>\(\);/);
  // The model is fetched once, kept in Cache Storage and checked against the pinned hash on every read.
  assert.match(worker, /caches\.open\(CACHE_NAME\)/);
  assert.match(worker, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(worker, /cloth_parts_model_hash_mismatch/);
  // The menu lists the found parts; the fixed three only when the model gave nothing.
  assert.match(editor, /parts\.status === 'ready' && parts\.analysis\?\.found\.length \? parts\.analysis\.found : \[\.\.\.MASK_CANDIDATES\]/);
  assert.match(editor, /buildMaterialCutoutDataUrl\(\{ imageUrl: garmentUrl, mode: 'auto', candidate: label/);
});

test('cloth parts math follows rembg u2net_cloth_seg: max-normalised ImageNet input, argmax classes, parts over 1%', () => {
  const side = 2;
  const rgba = new Uint8ClampedArray([200, 100, 50, 255, 100, 100, 100, 255, 0, 0, 0, 255, 200, 200, 200, 255]);
  const input = clothPartsInputTensorData(rgba, side);
  assert.equal(input.length, 12);
  assert.ok(Math.abs(input[0] - (1 - 0.485) / 0.229) < 1e-6);
  assert.ok(Math.abs(input[side * side + 2] - (0 - 0.456) / 0.224) < 1e-6);
  // 4 classes x 4 pixels: pixel 0 → class 1, pixel 1 → 0, pixel 2 → 3, pixel 3 → 1.
  const logits = new Float32Array([0, 5, 0, 0, 9, 0, 0, 9, 0, 0, 0, 0, 0, 0, 9, 0]);
  const map = clothPartsClassMap(logits, 4, side);
  assert.deepEqual([...map], [1, 0, 3, 1]);
  assert.deepEqual(foundClothParts(map, 0.2), ['トップス', '全身']);
  assert.deepEqual(CLOTH_PARTS.map((part) => part.label), ['トップス', 'ボトムス', '全身']);
  const mask = clothPartMaskRgba(map, 1);
  assert.deepEqual([mask[3], mask[7], mask[11], mask[15]], [255, 0, 0, 255]);
});

test('Light parity of the dialog (2026-11-11): no tool at first, undo/redo/全削除 disabled without history, brush size slider, mask teal, tools hidden in ステップ2', () => {
  assert.match(editor, /useState<Tool \| null>\(null\)/);
  assert.match(editor, /disabled=\{!history\.undo\}/);
  assert.match(editor, /disabled=\{!history\.redo\}/);
  assert.match(editor, /aria-label="全削除" title="全削除" disabled=\{maskEmpty\}/);
  assert.match(editor, /const BRUSH_MIN = 10, BRUSH_MAX = 100, BRUSH_DEFAULT = 40;/);
  assert.match(editor, /aria-label="ブラシの大きさ"/);
  assert.match(editor, /const MASK_COLOR = 'rgba\(43, 207, 190, 0\.75\)';/);
  assert.match(editor, /\{step === 1 && <>/);
  assert.match(editor, /h-\[86vh\][^"]*w-\[90vw\]/);
  // Four corner handles keep the aspect, four side handles stretch.
  for (const handle of ["'nw'", "'n'", "'ne'", "'e'", "'se'", "'s'", "'sw'", "'w'"]) assert.ok(editor.includes(`handle: ${handle}`), handle);
  assert.match(editor, /initialPlacementGeometry\(data \? maskBounds\(data\) : null, size\)/);
});

test('a new print drops at the centre of the mask at 0.28 of its shorter side, or mid-image at a quarter without one', () => {
  assert.deepEqual(initialPlacementGeometry(null, { width: 100, height: 200 }), { x: 0.5, y: 0.5, scale: 0.25 });
  const geometry = initialPlacementGeometry({ x: 20, y: 40, width: 60, height: 100 }, { width: 100, height: 200 });
  assert.deepEqual([geometry.x, geometry.y], [0.5, 0.45]);
  assert.ok(Math.abs(geometry.scale - 0.168) < 1e-9);
});

test('the edit area covers the prints and a margin, softened, and never leaves the painted garment', () => {
  const width = 20, height = 10;
  const prints = new Uint8ClampedArray(width * height * 4);
  for (let y = 4; y <= 5; y += 1) for (let x = 9; x <= 10; x += 1) prints[(y * width + x) * 4 + 3] = 255;
  const mask = printEditRegionMask(prints, width, height, { grow: 2, feather: 0 });
  const alpha = (x: number, y: number) => mask[(y * width + x) * 4 + 3];
  assert.equal(alpha(9, 4), 0);      // the print itself is editable
  assert.equal(alpha(7, 4), 0);      // grown by two pixels
  assert.equal(alpha(6, 4), 255);    // beyond the margin the composite is kept
  assert.equal(alpha(0, 0), 255);
  // Limited to the garment: the left half is not garment, so the grown margin there is kept.
  const garment = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 10; x < width; x += 1) garment[(y * width + x) * 4 + 3] = 255;
  const clipped = printEditRegionMask(prints, width, height, { grow: 2, feather: 0, garmentAlpha: garment });
  assert.equal(clipped[(4 * width + 9) * 4 + 3], 255);
  assert.equal(clipped[(4 * width + 11) * 4 + 3], 0);
  const soft = printEditRegionMask(prints, width, height, { grow: 2, feather: 1 });
  const edge = soft[(4 * width + 7) * 4 + 3];
  assert.ok(edge > 0 && edge < 255, `feathered edge ${edge}`);
  assert.throws(() => printEditRegionMask(new Uint8ClampedArray(width * height * 4), width, height, { grow: 2, feather: 0 }));
});

test('after 適用 the printing page sends the edit area as a protected edit and names the printed-look details in the brief', () => {
  const hook = readFileSync(new URL('../src/hooks/useCanonicalImageWorkspace.ts', import.meta.url), 'utf8');
  assert.match(hook, /configRef\.current\.protectedEditMask\?\.\(\) \?\? null/);
  assert.match(hook, /\.\.\.\(protectedMask\?\{maskDataUrl:protectedMask\}:\{\}\)/);
  assert.match(page, /protectedEditMask:\(\)=>workspace\.slots\.primary\?\.name===PRINT_APPLIED_FILE_NAME\?applyEditMaskRef\.current:null/);
  assert.match(page, /applyEditMaskRef\.current=editMaskDataUrl/);
  for (const phrase of ['インクで刷った', 'シールやワッペンを貼ったようには見せない', 'ボタン・ステッチなどの衣服の部品はプリントの上に残し', '衣服の外にはプリントを描かない', '最後の白黒の画像は変更してよい範囲']) assert.ok(page.includes(phrase), phrase);
});

test('every print tile has ×, the first one too, and placed prints read 編集する after 決定 (Light 2026-11-11)', () => {
  assert.match(page, /onClick=\{\(\)=>print\.id===PRIMARY_PRINT_ID\?removePrimaryPrint\(\):removeExtraPrint\(print\.id\)\}/);
  assert.match(page, /\{printApplied&&appliedPrintIds\.includes\(print\.id\)\?'編集する':'適用'\}/);
});

test('ステップ2 places any of the uploaded prints, and the side tools match Light (レイヤー, flips, 複製, 削除)', () => {
  assert.match(editor, /export const MAX_PRINTS = 5;/);
  assert.match(editor, /prints\.map\(\(print\) => \(/);
  for (const label of ['トップに移動', '上に移動', '下に移動', '一番下に移動', 'レイヤー', '左右反転', '上下反転', '複製', 'プリントを削除', '全削除']) {
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

test('the toolbar has Light 選択範囲にオブジェクトを追加 (追加 / 取り除く), ワンクリックでトリミング, 透過度 and the shortcut sheet (measured 2026-10-28)', () => {
  for (const label of ['選択範囲にオブジェクトを追加', '>追加<', '>取り除く<', 'ワンクリックでトリミング', 'マスクを塗ってください。', 'aria-label="透過度"', '<ShortcutSheetButton']) assert.ok(editor.includes(label), label);
  // 取り除く is unavailable until something is selected, like Light.
  assert.match(editor, /aria-checked=\{tool === 'object-remove'\} disabled=\{maskEmpty\}/);
  assert.match(editor, /layerContext\.globalAlpha = placement\.opacity \?\? 1;/);
});

test('mask helpers: bounds of the painted area, fitting a print inside it, and the clicked colour region', () => {
  const size = { width: 4, height: 4 };
  const data = new Uint8ClampedArray(4 * 4 * 4);
  assert.equal(maskBounds({ ...size, data }), null);
  data[(1 * 4 + 1) * 4 + 3] = 255; data[(2 * 4 + 2) * 4 + 3] = 255;
  assert.deepEqual(maskBounds({ ...size, data }), { x: 1, y: 1, width: 2, height: 2 });
  const placement: PrintPlacement = { id: 'p', printId: 'a', x: 0.1, y: 0.1, scale: 1, rotation: 15, flipX: true, flipY: false };
  const fitted = fitPlacementToBounds(placement, { x: 1, y: 1, width: 2, height: 2 }, size, 2);
  assert.deepEqual([fitted.x, fitted.y, fitted.scale, fitted.rotation, fitted.flipX], [0.5, 0.5, 0.25, 15, true]);
  // A 4x1 strip: two red pixels then two blue ones; clicking red selects only the red pair.
  const strip = new Uint8ClampedArray([255, 0, 0, 255, 250, 5, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  assert.deepEqual([...regionAtPoint({ width: 4, height: 1, data: strip }, 0, 0)], [1, 1, 0, 0]);
});

test('AI生成 opens 生成履歴 with the composed preview and a waiting tile first, then the result beside the preview (Light 2026-11-11)', () => {
  const panel = readFileSync(new URL('../src/components/lightchain/LightchainHistoryPanel.tsx', import.meta.url), 'utf8');
  const frame = readFileSync(new URL('../src/components/lightchain/LightchainDesignToolFrame.tsx', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="lightchain-history-pending"/);
  assert.match(panel, /data-testid="lightchain-history-preview"/);
  assert.match(panel, /if \(!refreshKey\) return;/);
  assert.match(frame, /const historyOpen = historyOpenProp \?\? historyOpenState;/);
  assert.match(page, /setPrintHistoryOpen\(true\);/);
  // The click renders before the request starts, so a run settles only after it was seen in flight.
  assert.match(page, /printRunSeenRunning\.current=true/);
  assert.match(page, /if\(!printRunSeenRunning\.current\)\{if\(workspace\.status==='error'\)setPrintRun\(null\);return;\}/);
});
