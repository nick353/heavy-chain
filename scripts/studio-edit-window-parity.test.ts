import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXPAND_MAX_SIZE, PARTIAL_EDIT_MAX_REFERENCES, STUDIO_EXPAND_SAME_PROMPT, studioExpandDrag, studioPartialEditPrompt, studioPenHit, studioPenPathD, studioPenTrace,
} from '../src/lib/studioImageEdit.ts';
import {
  STUDIO_LEGACY_SAVED_PROMPTS_KEY, STUDIO_PROMPT_LIBRARY_KEY, readStudioPromptLibrary, studioPromptDefaultTitle, withStudioPrompt, writeStudioPromptLibrary,
} from '../src/lib/studioPromptLibrary.ts';
import { validateLegalSafetyInput } from '../src/lib/legalSafetyGuard.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const menu = read('../src/components/lightchain/StudioImageEditMenu.tsx');
const editor = read('../src/components/lightchain/StudioMaskEditor.tsx');
const surface = read('../src/components/lightchain/StudioMaskSurface.tsx');
const library = read('../src/components/lightchain/StudioPromptLibrary.tsx');
const page = read('../src/pages/FashionStudioDetailPage.tsx');
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };

// 本家の部分編集（2026-11-13）: 入力欄の左に参考画像の追加（素材を選択・最大3枚）、右にプロンプトを保存とプロンプトライブラリ。
test('部分編集は参考画像を3枚まで足せて、指示文は送る順（写真・案内・参考画像）どおりに画像を名指す', () => {
  assert.equal(PARTIAL_EDIT_MAX_REFERENCES, 3);
  const marked = studioPartialEditPrompt('赤枠内を参考画像の柄にする', ['#FF3333'], 2) as string;
  assert.match(marked, /The second image is a guide/);
  assert.match(marked, /Images 3 to 4 are reference images/);
  const unmarked = studioPartialEditPrompt('make the shirt like the reference', [], 1) as string;
  assert.match(unmarked, /^The first image is the photo to edit\. The second image is a reference image/);
  assert.equal(studioPartialEditPrompt('x y', [], 0)?.startsWith('Edit this photo.'), true);
  assert.equal(studioPartialEditPrompt('x', [], 9)?.includes('Images 2 to 4'), true);
  for (const prompt of [marked, unmarked, STUDIO_EXPAND_SAME_PROMPT]) assert.equal(validateLegalSafetyInput([prompt]).blocked, false, prompt);
  // 窓: 参考画像の追加 → 素材を選択（GallerySelector、最大3枚、ファイルのアップロード）、保存・ライブラリ、送る順は案内の後ろ。
  assert.match(menu, /aria-label="参考画像を追加"/);
  assert.match(menu, /<GallerySelector isOpen title="素材を選択" multiple maxSelect=\{PARTIAL_EDIT_MAX_REFERENCES - references\.length\}/);
  assert.match(menu, /aria-label="プロンプトを保存" title="プロンプトを保存" disabled=\{!instruction\.trim\(\)\}/);
  assert.match(menu, /aria-label="プロンプトライブラリ"/);
  assert.match(menu, /referenceFiles: references\.map\(item => item\.file\)/);
  assert.match(page, /\[\.\.\.\(request\.guideFile \? \[request\.guideFile\] : \[\]\), \.\.\.\(request\.referenceFiles \?\? \[\]\)\]/);
  // 入力欄の文書は入力を1枚ずつ参考画像の欄に入れてから生成し、生成はその順で全部を送る。
  assert.match(page, /await uploadFile\(host\.inputFiles\[slot\], slotRole\(slot\)\)/);
  assert.match(page, /const chosen = edit \? shownReferences :/);
});

test('プロンプトライブラリは本家の窓の形で、題つきの一覧を端末に残し、前の文字だけの一覧を移す', () => {
  const store = memory();
  store.setItem(STUDIO_LEGACY_SAVED_PROMPTS_KEY, JSON.stringify(['白いシャツを紺にする\n細かく', '', 4]));
  const moved = readStudioPromptLibrary(store);
  assert.deepEqual(moved.map(item => [item.title, item.text]), [['白いシャツを紺にする', '白いシャツを紺にする\n細かく']]);
  assert.ok(store.data.has(STUDIO_PROMPT_LIBRARY_KEY));
  const next = withStudioPrompt(moved, { id: 'p1', title: 'miyako', text: 'POP 画像', updatedAt: 1 });
  writeStudioPromptLibrary(next, store);
  assert.deepEqual(readStudioPromptLibrary(store).map(item => item.id), ['p1', 'legacy-0']);
  assert.deepEqual(withStudioPrompt(next, { id: 'legacy-0', title: '直した', text: 'x', updatedAt: 2 }).map(item => item.title), ['直した', 'miyako']);
  assert.equal(studioPromptDefaultTitle('  '), 'Untitled');
  for (const word of ['プロンプトライブラリ', 'メッセージの詳細', '編集する', '入力後に挿入', '現在の内容を上書き', 'プロンプトを追加', 'プロンプト名', 'カバー画像', 'プロンプトの内容', 'キーワードを入力して検索'])
    assert.ok(library.includes(word), word);
  assert.match(library, /h-\[800px\][^"]*w-\[1280px\]/);
  assert.match(library, /w-\[320px\]/);
  // スタジオの入力欄も同じ窓（前の小さな一覧は無い）。
  assert.match(page, /<StudioPromptLibrary initialText=\{library\.saveText\}/);
  assert.doesNotMatch(page, /保存したプロンプトはまだありません/);
});

test('AI拡張は枠のつまみで広げられ、1x・元の比率でも生成を押せる', () => {
  const image = { width: 1024, height: 1536 };
  const frame = { width: 1024, height: 1536, x: 0, y: 0 };
  assert.deepEqual(studioExpandDrag(image, frame, 'e', 300, 0), { width: 1324, height: 1536, x: 0, y: 0 });
  assert.deepEqual(studioExpandDrag(image, frame, 'nw', -100, -50), { width: 1124, height: 1586, x: 100, y: 50 });
  // 元の画像より内へは縮まない・4096 まで・移動は枠を変えない。
  assert.deepEqual(studioExpandDrag(image, frame, 'w', 500, 0), frame);
  assert.equal(studioExpandDrag(image, frame, 's', 0, 9999).height, EXPAND_MAX_SIZE);
  assert.deepEqual(studioExpandDrag(image, frame, 'move', 50, 50), frame);
  assert.match(menu, /<FrameHandles onHandleDown=\{onHandleDown\} \/><\/div>/);
  assert.match(menu, /data-testid="studio-edit-expand-generate" disabled=\{!image \|\| Boolean\(busy\) \|\| Boolean\(target\.error\)\}/);
  assert.match(menu, /prompt: unchanged \? STUDIO_EXPAND_SAME_PROMPT : STUDIO_EXPAND_PROMPT/);
});

test('パスツールは本家の4つ（描画・削除・選択・曲線）で、曲線の点は三次ベジェで塗る', () => {
  const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.equal(studioPenPathD(corners, true), 'M0 0 L10 0 L10 10 L0 0 Z');
  const curved = [{ x: 0, y: 0 }, { x: 10, y: 0, handle: { x: 14, y: 4 } }, { x: 10, y: 10 }];
  assert.equal(studioPenPathD(curved, false), 'M0 0 C0 0 6 -4 10 0 C14 4 10 10 10 10');
  const calls: string[] = [];
  studioPenTrace({ moveTo: () => calls.push('M'), lineTo: () => calls.push('L'), bezierCurveTo: () => calls.push('C'), closePath: () => calls.push('Z') }, curved);
  assert.deepEqual(calls, ['M', 'C', 'C', 'L', 'Z']);
  assert.equal(studioPenHit(corners, { x: 9, y: 1 }, 3), 1);
  assert.equal(studioPenHit(corners, { x: 5, y: 5 }, 3), -1);
  for (const label of ["label: '描画'", "label: '削除'", "label: '選択'", "label: '曲線'"]) assert.ok(editor.includes(label), label);
  assert.match(editor, /penMode=\{penMode\}/);
  assert.match(surface, /studioPenTrace\(current\.context, points\)/);
  assert.match(surface, /penMode === 'delete'/);
});
