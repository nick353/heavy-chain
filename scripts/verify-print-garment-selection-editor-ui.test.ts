import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../src/components/workspace/PrintGarmentSelectionEditor.tsx', import.meta.url),
  'utf8',
);

test('crop frame and all eight resize handles are range-mode only', () => {
  assert.match(
    editor,
    /selectionMode === 'range' && ready && selection && canvasSize\.width > 0 && canvasSize\.height > 0 && \(/,
  );
  assert.equal(editor.match(/id: '(?:nw|n|ne|e|se|s|sw|w)'/g)?.length, 8);
  assert.match(editor, /resizeHandleDetails\.map\(\(handle\) => \(/);
  assert.match(
    editor,
    /if \(renderMode === 'range'\) \{[\s\S]*?context\.strokeRect\(nextSelection\.x, nextSelection\.y, nextSelection\.width, nextSelection\.height\);[\s\S]*?\}/,
  );
});

test('tap confirmation distinguishes low-confidence neighborhood candidates from recognized masks', () => {
  assert.match(
    editor,
    /guidedResult\.source === 'tap-neighborhood' \? 'この候補で決定' : '決定'/,
  );
  assert.match(editor, /guidedResult\.source === 'tap-neighborhood' \? '低信頼候補' : 'タップ認識済み'/);
  assert.match(editor, /タップ位置から作った矩形候補です。内容を確認してから「この候補で決定」を押してください。/);
  assert.match(editor, /guidedResult\.source === 'tap-neighborhood'[\s\S]*?低信頼候補です。タップ位置から作った矩形候補を確認してください。信頼度:/);
  assert.match(editor, /: '服をタップしてください'\s*: '選択範囲をAIマスクへ渡す'/);
});

test('confirmation remains policy-gated and tap recognition does not auto-apply', () => {
  assert.equal(editor.match(/canSubmitGarmentSelectionPreview\(\{/g)?.length, 2);
  assert.match(editor, /onClick=\{apply\}/);

  const recognizeTap = editor.slice(
    editor.indexOf('  const recognizeTap ='),
    editor.indexOf('  const beginTap ='),
  );
  assert.ok(recognizeTap.length > 0);
  assert.doesNotMatch(recognizeTap, /\b(?:apply|exportSelection|onApply)\s*\(/);
  assert.match(recognizeTap, /requestId !== tapRequestIdRef\.current/);
});

test('low-confidence neighborhood mask uses the established range fallback and never the cloth model', () => {
  assert.match(
    editor,
    /selectionSource === 'tap' && guidedResult\?\.mask && guidedResult\.source !== 'tap-neighborhood'/,
  );
  assert.match(editor, /source: 'efficient-sam'/);
  assert.doesNotMatch(
    editor,
    /if \(selectionSource === 'tap' && guidedResult\?\.mask\) \{/,
  );
  assert.match(
    editor,
    /guidedResult\?\.source === 'tap-neighborhood' \? 'range' : selectionSource/,
  );
});

test('switching from range to tap invalidates the old range submission', () => {
  const chooseTapMode = editor.slice(
    editor.indexOf('  const chooseTapMode ='),
    editor.indexOf('  const chooseRangeMode ='),
  );
  assert.match(chooseTapMode, /if \(selectionSource === 'range'\)/);
  assert.match(chooseTapMode, /setSelection\(null\)/);
  assert.match(chooseTapMode, /setSelectionSource\(null\)/);
  assert.match(chooseTapMode, /setGuidedResult\(null\)/);
  assert.match(chooseTapMode, /render\(null\)/);
});

test('point-prompt inference preloads for the selected source before the editor opens', () => {
  assert.match(editor, /const preparePointPromptForImage = \(url: string\)/);
  assert.match(editor, /pointPromptPreparationCache\?\.sourceUrl === url/);
  assert.match(editor, /pointPromptPreparationQueue[\s\S]*?\.then\(prepare\)/);
  assert.match(
    editor,
    /useEffect\(\(\) => \{[\s\S]*?const preload = preparePointPromptForImage\(sourceUrl\);[\s\S]*?pointPromptRef\.current = preload;[\s\S]*?\}, \[sourceUrl\]\);/,
  );

  const openEffect = editor.slice(
    editor.indexOf("    if (!isOpen) return;"),
    editor.indexOf('  const pointFromEvent ='),
  );
  assert.doesNotMatch(openEffect, /pointPromptRef\.current = null/);
  assert.match(openEffect, /pointPromptSourceRef\.current !== sourceUrl \|\| !pointPromptRef\.current/);
  assert.match(openEffect, /pointPromptRef\.current = pointPromptRef\.current\.catch\(prepareFromVisibleCanvas\)/);
  assert.match(openEffect, /garment_selection_point_prompt_source_changed/);
});
