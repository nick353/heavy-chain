import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CROP_PRESET_GROUPS, EXPAND_PRESET_GROUPS, EXPAND_SCALES, HD_2K, HD_4K, PARTIAL_EDIT_COLORS, STUDIO_EDIT_MENU, STUDIO_ERASE_PROMPT, STUDIO_EXPAND_PROMPT, STUDIO_REPAIR_PROMPT,
  presetRatio, studioAlphaBounds, studioApplyMaskAlpha, studioAspectRatioLabel, studioAutoClip, studioCenteredCrop, studioCropRgba, studioDataUrlToFile, studioEditFileName,
  studioExpandOffset, studioExpandScaleEnabled, studioExpandSize, studioFillRectAlpha, studioPartialEditPrompt, studioRectFromDrag, studioResizeCrop, studioScaleRect,
  studioUpscaleOptions, type StudioRgba,
} from '../src/lib/studioImageEdit.ts';
import { validateLegalSafetyInput } from '../src/lib/legalSafetyGuard.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const menuSource = read('../src/components/lightchain/StudioImageEditMenu.tsx');
const editorSource = read('../src/components/lightchain/StudioMaskEditor.tsx');
const clippingSource = read('../src/components/lightchain/StudioClippingDialog.tsx');
const surfaceSource = read('../src/components/lightchain/StudioMaskSurface.tsx');

/** 1色で塗った w×h の画像。 */
const solid = (width: number, height: number, rgba: [number, number, number, number]): StudioRgba => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < data.length; at += 4) data.set(rgba, at);
  return { width, height, data };
};
const alphaAt = (image: StudioRgba, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];

// ---- メニュー --------------------------------------------------------------------------------------------
test('画像編集メニューは本家と同じ並び・言葉で、画像修復だけに NEW が付き、高画質化だけが › の子メニューを持つ', () => {
  assert.deepEqual(STUDIO_EDIT_MENU.map(item => item.label), ['画像修復', '部分編集', '高画質化', 'ワンクリックで背景削除', 'クリッピング', 'AIトリミング', 'AI拡張', 'AI削除']);
  assert.deepEqual(STUDIO_EDIT_MENU.filter(item => item.badge === 'NEW').map(item => item.id), ['repair']);
  assert.deepEqual(STUDIO_EDIT_MENU.filter(item => item.submenu).map(item => item.id), ['upscale']);
  // 手元で仕上がる道具と、生成の窓口に頼む道具の分け方（呼び出し側への出口の約束）。
  assert.deepEqual(STUDIO_EDIT_MENU.filter(item => item.runsOn === 'client').map(item => item.id), ['upscale', 'remove-background', 'clipping', 'crop']);
  assert.deepEqual(STUDIO_EDIT_MENU.filter(item => item.runsOn === 'server').map(item => item.id), ['repair', 'partial', 'expand', 'erase']);
  // 部品はこの表から描く（並びを部品の中で書き直さない）。
  assert.match(menuSource, /STUDIO_EDIT_MENU\.map\(/);
});

test('出口の形: 手元の道具は onClientResult(tool, File)、生成の道具は onServerEdit(tool, { mainFile, guideFile?, prompt, editOptions })', () => {
  assert.match(menuSource, /onClientResult: \(tool: StudioClientEditTool, file: File\) => void \| Promise<void>/);
  assert.match(menuSource, /onServerEdit: \(tool: StudioServerEditTool, request: StudioServerEditRequest\) => void \| Promise<void>/);
  assert.match(menuSource, /mainFile: File;\s*guideFile\?: File;\s*prompt: string;\s*editOptions\?: \{ aspectRatio\?: string; resolution\?: '1k' \| '4k' \};/);
  for (const tool of ['upscale', 'remove-background', 'clipping', 'crop']) assert.match(menuSource, new RegExp(`onClientResult\\('${tool}'`), tool);
  for (const tool of ['repair', 'partial', 'expand', 'erase']) assert.match(menuSource, new RegExp(`onServerEdit\\('${tool}'`), tool);
  // AI削除と部分編集は案内画像を、AI拡張は余白を足した画像を渡す。
  assert.match(menuSource, /onServerEdit\('erase', \{ mainFile: [^}]*guideFile, prompt: STUDIO_ERASE_PROMPT/);
  assert.match(menuSource, /onServerEdit\('expand', \{\s*mainFile: await toPng\(canvas/);
  assert.match(menuSource, /resolution: quality/);
  // 本家の画像修復は 4K の料金（qualityMode 既定 "4k"）。
  assert.match(menuSource, /onServerEdit\('repair', \{[^}]*editOptions: \{ resolution: '4k'/);
  // 生成の窓口へ渡す前に法的な守りを通す。
  assert.match(menuSource, /validateLegalSafetyInput\(values\)\.blocked/);
  assert.match(menuSource, /legalBlocked\(instruction, prompt\)/);
});

// ---- 高画質化 ---------------------------------------------------------------------------------------------
test('高画質化は長い辺が 2048 以上なら 2K、4096 以上なら 4K を押せない（本家の HD_2K・HD_4K）', () => {
  assert.equal(HD_2K, 2048); assert.equal(HD_4K, 4096);
  assert.deepEqual(studioUpscaleOptions(1024, 1536), { '2k': { enabled: true, scale: 2048 / 1536 }, '4k': { enabled: true, scale: 4096 / 1536 } });
  const at2k = studioUpscaleOptions(2048, 1000);
  assert.equal(at2k['2k'].enabled, false); assert.equal(at2k['4k'].enabled, true); assert.equal(at2k['4k'].scale, 2);
  const just = studioUpscaleOptions(1000, 2047);
  assert.equal(just['2k'].enabled, true);
  const at4k = studioUpscaleOptions(4096, 4096);
  assert.equal(at4k['2k'].enabled, false); assert.equal(at4k['4k'].enabled, false);
  // 大きさが分からない画像は押せない。
  assert.equal(studioUpscaleOptions(0, 0)['2k'].enabled, false);
  assert.match(menuSource, /disabled=\{!upscale\?\.\[target\]\.enabled\}/);
});

// ---- AI拡張 ----------------------------------------------------------------------------------------------
test('AI拡張の大きさは本家の関数 z と同じ（1024×1536 の元の比率 1x はそのまま、1:1 は 1536 角、16:9 は 2731×1536）', () => {
  assert.deepEqual(EXPAND_SCALES, [1, 1.5, 2]);
  assert.deepEqual(studioExpandSize(1024, 1536, 1, 0), { width: 1024, height: 1536, error: null });
  assert.deepEqual(studioExpandSize(1024, 1536, 1.5, 0), { width: 1536, height: 2304, error: null });
  assert.deepEqual(studioExpandSize(1024, 1536, 1, presetRatio('1:1')), { width: 1536, height: 1536, error: null });
  assert.deepEqual(studioExpandSize(1024, 1536, 1, presetRatio('16:9')), { width: 2731, height: 1536, error: null });
  assert.deepEqual(studioExpandSize(1024, 1536, 1, presetRatio('9:16')), { width: 1024, height: 1820, error: null });
  // 比率ありでも倍率は長い辺に掛かる。
  assert.deepEqual(studioExpandSize(1024, 1536, 2, presetRatio('1:1')), { width: 3072, height: 3072, error: null });
  // 元の画像は必ず枠に収まる。
  for (const label of EXPAND_PRESET_GROUPS.flatMap(group => group.presets)) {
    for (const scale of EXPAND_SCALES) {
      const size = studioExpandSize(1024, 1536, scale, presetRatio(label));
      assert.ok(size.width >= 1024 && size.height >= 1536, `${label} ${scale}`);
    }
  }
});

test('AI拡張は 4096 を超える倍率を押せず、超えた辺の言葉を出す。元の画像は枠の真ん中に置く', () => {
  assert.deepEqual(studioExpandSize(2400, 3000, 2, 0), { width: 4800, height: 6000, error: 'width' });
  assert.equal(studioExpandScaleEnabled(2400, 3000, 1.5, 0), false);
  assert.equal(studioExpandScaleEnabled(2400, 3000, 1, 0), true);
  assert.equal(studioExpandSize(1000, 3000, 1, presetRatio('9:16')).error, null);
  assert.equal(studioExpandSize(1000, 3000, 1.5, presetRatio('9:16')).error, 'height');
  assert.deepEqual(studioExpandOffset(1024, 1536, { width: 2731, height: 1536 }), { x: 854, y: 0 });
  assert.deepEqual(studioExpandOffset(1024, 1536, { width: 1536, height: 2304 }), { x: 256, y: 384 });
  assert.match(menuSource, /disabled=\{width > 0 && !studioExpandScaleEnabled\(width, height, value, ratio\)\}/);
});

test('比率のプリセットは本家と同じ群・並び（AI拡張の先頭は「元の比率」、AIトリミングは「カスタム」）', () => {
  const tail = [['標準EC商品画像', ['1:1']], ['SNSカバー', ['3:4', '4:5']], ['ショート動画カバー', ['9:16', '16:9']], ['公式サイトバナー', ['21:9']]];
  assert.deepEqual(EXPAND_PRESET_GROUPS.map(group => [group.label, [...group.presets]]), [['汎用', ['元の比率', '1:1', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9']], ...tail]);
  assert.deepEqual(CROP_PRESET_GROUPS.map(group => [group.label, [...group.presets]]), [['汎用', ['カスタム', '1:1', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9']], ...tail]);
  assert.equal(presetRatio('元の比率'), 0); assert.equal(presetRatio('カスタム'), 0); assert.equal(presetRatio('21:9'), 21 / 9);
  assert.equal(studioAspectRatioLabel(2731, 1536), '16:9');
  assert.equal(studioAspectRatioLabel(1024, 1536), '2:3');
  assert.equal(studioAspectRatioLabel(1000, 1100), '10:11');
});

// ---- AIトリミング ------------------------------------------------------------------------------------------
test('AIトリミングの初めの枠は比率に合う最大の真ん中の枠で、つまみで動かしても比率と画像の内側を保つ', () => {
  assert.deepEqual(studioCenteredCrop(1024, 1536, 0), { x: 0, y: 0, width: 1024, height: 1536 });
  assert.deepEqual(studioCenteredCrop(1024, 1536, 1), { x: 0, y: 256, width: 1024, height: 1024 });
  assert.deepEqual(studioCenteredCrop(1920, 1080, 3 / 4), { x: 555, y: 0, width: 810, height: 1080 });
  const bounds = { width: 1024, height: 1536 };
  // 自由な枠: 右下を内側へ。
  assert.deepEqual(studioResizeCrop({ x: 0, y: 0, width: 1024, height: 1536 }, 'se', -100, -200, bounds, 0), { x: 0, y: 0, width: 924, height: 1336 });
  // 画像の外へは出ない。
  assert.deepEqual(studioResizeCrop({ x: 0, y: 256, width: 1024, height: 1024 }, 'move', 500, 900, bounds, 1), { x: 0, y: 512, width: 1024, height: 1024 });
  // 1:1 の枠を左上のつまみで縮めても 1:1 のまま、右下の角は動かない。
  const square = studioResizeCrop({ x: 0, y: 256, width: 1024, height: 1024 }, 'nw', 200, 100, bounds, 1);
  assert.equal(square.width, square.height);
  assert.equal(square.x + square.width, 1024); assert.equal(square.y + square.height, 1280);
  // 辺のつまみで広げても画像の外へ出ない。
  const wide = studioResizeCrop({ x: 200, y: 600, width: 400, height: 300 }, 'e', 5000, 0, bounds, 4 / 3);
  assert.ok(wide.x + wide.width <= 1024 && wide.y >= 0 && wide.y + wide.height <= 1536);
  assert.ok(Math.abs(wide.width / wide.height - 4 / 3) < 0.02);
});

// ---- マスク → 透明 PNG・外接矩形で切り出す ---------------------------------------------------------------------
test('抽出（getSynthesis）: 元の大きさのまま、塗っていない所は透明・塗った所は元の色、半透明の縁は掛け算', () => {
  const source = solid(4, 3, [200, 100, 50, 255]);
  const mask = solid(4, 3, [0, 0, 0, 0]);
  studioFillRectAlpha(mask, { x: 1, y: 1, width: 2, height: 1 }, true);
  mask.data[(0 * 4 + 0) * 4 + 3] = 128;
  const out: StudioRgba = { width: 4, height: 3, data: studioApplyMaskAlpha(source, mask) };
  assert.equal(out.data.length, 4 * 3 * 4);
  assert.equal(alphaAt(out, 1, 1), 255); assert.equal(alphaAt(out, 2, 1), 255);
  assert.deepEqual([...out.data.subarray((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 3)], [200, 100, 50]);
  assert.equal(alphaAt(out, 3, 2), 0); assert.equal(alphaAt(out, 0, 1), 0);
  assert.equal(alphaAt(out, 0, 0), 128);
  // 元の画像に透明な所があれば、塗っても透明のまま。
  const partly = solid(1, 1, [10, 10, 10, 100]);
  assert.equal(studioApplyMaskAlpha(partly, solid(1, 1, [0, 0, 0, 255]))[3], 100);
  assert.throws(() => studioApplyMaskAlpha(source, solid(2, 2, [0, 0, 0, 255])), /studio_mask_size_mismatch/);
});

test('お気に入り（imageAutoClip）: 残った部分の外接矩形で切り出す。何も残らなければ null', () => {
  const image = solid(6, 5, [0, 0, 0, 0]);
  studioFillRectAlpha(image, { x: 2, y: 1, width: 3, height: 2 }, true);
  image.data[(4 * 6 + 1) * 4 + 3] = 40;
  assert.deepEqual(studioAlphaBounds(image), { x: 1, y: 1, width: 4, height: 4 });
  const clip = studioAutoClip(image);
  assert.ok(clip);
  assert.equal(clip.width, 4); assert.equal(clip.height, 4);
  assert.equal(alphaAt(clip, 1, 0), 255); assert.equal(alphaAt(clip, 0, 0), 0); assert.equal(alphaAt(clip, 0, 3), 40);
  assert.equal(studioAutoClip(solid(3, 3, [0, 0, 0, 0])), null);
  const cropped = studioCropRgba(solid(10, 10, [1, 2, 3, 255]), { x: 8, y: 8, width: 5, height: 5 });
  assert.deepEqual([cropped.width, cropped.height], [2, 2]);
});

test('矩形選択で認識できなかったときは矩形そのものを塗る／選択解除なら消す。座標は作業用 ↔ 元の大きさへ写す', () => {
  const mask = solid(10, 10, [0, 0, 0, 0]);
  studioFillRectAlpha(mask, studioRectFromDrag({ x: 8, y: 7 }, { x: 2, y: 3 }, mask), true);
  assert.deepEqual(studioAlphaBounds(mask), { x: 2, y: 3, width: 6, height: 4 });
  studioFillRectAlpha(mask, { x: 2, y: 3, width: 3, height: 4 }, false);
  assert.deepEqual(studioAlphaBounds(mask), { x: 5, y: 3, width: 3, height: 4 });
  // 画像の外へはみ出したドラッグは内側に収める。
  assert.deepEqual(studioRectFromDrag({ x: -5, y: 2 }, { x: 30, y: 4 }, { width: 10, height: 10 }), { x: 0, y: 2, width: 10, height: 2 });
  assert.deepEqual(studioScaleRect({ x: 10, y: 20, width: 30, height: 40 }, { width: 1024, height: 683 }, { width: 2048, height: 1366 }), { x: 20, y: 40, width: 60, height: 80 });
  // 部品は認識に失敗したらこの塗りに切り替える。
  assert.match(surfaceSource, /recognizeInRect\(image, studioScaleRect\(/);
  assert.match(surfaceSource, /studioFillRectAlpha\(rgbaOf\(data\), rect, add\)/);
});

// ---- 指示（英語）が法的な守りを通る ---------------------------------------------------------------------------
test('生成の窓口に渡す指示は英語で、法的な守りに止められず、「<語> <語> face|likeness|style」を含まない', () => {
  const prompts = [
    STUDIO_REPAIR_PROMPT, STUDIO_ERASE_PROMPT, STUDIO_EXPAND_PROMPT,
    studioPartialEditPrompt('赤枠内のネクタイをスカーフに変更', ['#FF3333']) as string,
    studioPartialEditPrompt('change the shirt color to navy', ['#ff3333', '#3399FF', '#FFDD33']) as string,
    studioPartialEditPrompt('make the sleeves shorter', []) as string,
  ];
  for (const prompt of prompts) {
    assert.ok(prompt.length > 40, prompt);
    assert.equal(validateLegalSafetyInput([prompt]).blocked, false, prompt);
    assert.doesNotMatch(prompt, /\b[a-z][a-z'-]+\s+[a-z][a-z'-]+\s+(?:face|likeness|style)\b/i, prompt);
    assert.doesNotMatch(prompt, /\b(?:face|likeness|style)\b/i, prompt);
  }
  // 部分編集は使った色だけを書き、指示はそのまま引用する。空の指示は送らない。
  const red = studioPartialEditPrompt('  赤枠内の  ネクタイを スカーフに ', ['#ff3333']) as string;
  assert.match(red, /red \(#FF3333/); assert.doesNotMatch(red, /yellow|blue/);
  assert.match(red, /"赤枠内の ネクタイを スカーフに"/);
  assert.equal(studioPartialEditPrompt('   ', ['#FF3333']), null);
  assert.deepEqual(PARTIAL_EDIT_COLORS.map(color => color.hex), ['#FF3333', '#FFDD33', '#3399FF']);
  // 有名人の似せを頼む指示は守りに止められる（部品は送らずに知らせる）。
  assert.equal(validateLegalSafetyInput(['make him look like john smith face', studioPartialEditPrompt('make him look like john smith face', []) as string]).blocked, true);
});

// ---- ファイル --------------------------------------------------------------------------------------------
test('結果は PNG の File で、名前は元の名前＋道具の印', () => {
  assert.equal(studioEditFileName('look 01.jpg', 'upscale', '2k'), 'look-01-upscale-2k.png');
  assert.equal(studioEditFileName(undefined, 'remove-background'), 'image-no-background.png');
  assert.equal(studioEditFileName('a/b:c.webp', 'crop'), 'a-b-c-crop.png');
  const file = studioDataUrlToFile('data:image/png;base64,iVBORw0KGgo=', 'x.png');
  assert.equal(file.type, 'image/png'); assert.equal(file.name, 'x.png'); assert.equal(file.size, 8);
  assert.throws(() => studioDataUrlToFile('not a data url', 'x.png'), /studio_data_url_invalid/);
});

// ---- 簡易エディターとクリッピングの見た目の約束 ------------------------------------------------------------------
test('簡易エディターの上の帯は本家の並び（マスク調整｜AIマスク認識｜ブラシ｜投げ縄ツール｜矩形選択｜パスツール｜選択範囲をクリア｜↶↷｜キャンセル｜差し込み）', () => {
  const order = ['STUDIO_MASK_EDITOR_TEXT.adjust', 'STUDIO_MASK_EDITOR_TOOLS.filter', 'STUDIO_MASK_EDITOR_TEXT.clear', 'aria-label="元に戻す"', 'aria-label="やり直し"', 'STUDIO_MASK_EDITOR_TEXT.cancel', 'actions?.(api)'];
  const positions = order.map(token => editorSource.indexOf(token));
  positions.forEach((position, index) => assert.ok(position > 0, order[index]));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(editorSource, /\{ id: 'ai-mask', label: 'AIマスク認識' \},\s*\{ id: 'brush', label: 'ブラシ' \},\s*\{ id: 'lasso', label: '投げ縄ツール' \},\s*\{ id: 'rect', label: '矩形選択' \},\s*\{ id: 'pen', label: 'パスツール' \}/);
  // 道具の帯の下に 追加選択｜選択解除｜(ブラシなら − 太さ ＋)。
  assert.match(editorSource, /add: '追加選択',\s*remove: '選択解除'/);
  assert.match(editorSource, /tool === 'brush' && \(/);
  // 2面（元画像＋参考画像）の題は本家の既定。
  assert.match(editorSource, /baseTitle: '調整したい領域を描いてください',\s*referenceTitle: '参考にしたい領域を描いてください'/);
  assert.match(editorSource, /<h2 className="sr-only">\{STUDIO_MASK_EDITOR_TEXT\.title\}<\/h2>/);
  // ホイールは 1.05 倍ずつ、Space で動かす（本家と同じ）。
  assert.match(surfaceSource, /const WHEEL_STEP = 1\.05;/);
  assert.match(surfaceSource, /event\.code === 'Space'/);
});

test('クリッピングは「保存したい範囲を選択してください」で、抽出は getCutout（元の大きさ）、お気に入りは getClip（外接矩形）', () => {
  assert.match(clippingSource, /paneTitle: '保存したい範囲を選択してください',\s*extract: '抽出',\s*collect: 'お気に入り'/);
  assert.match(clippingSource, /const file = await api\.getCutout\(\);[\s\S]*?await onExtract\(file\);/);
  assert.match(clippingSource, /const file = await api\.getClip\(\);[\s\S]*?await onCollect\(file\);/);
  assert.match(clippingSource, /api\.notifyEmpty\(\)/);
  // 書き出しは純粋な処理を通す（試験で確かめた計算と同じもの）。
  assert.match(surfaceSource, /studioApplyMaskAlpha\(rgbaOf\(pixels\), rgbaOf\(mask\)\)/);
  assert.match(surfaceSource, /const clip = studioAutoClip\(rgbaOf\(data\)\);/);
});
