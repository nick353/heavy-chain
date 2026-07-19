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

test('tap confirmation is concise while pre-tap and range actions stay explicit', () => {
  assert.match(
    editor,
    /selectionMode === 'tap'\s*\? selectionSource === 'tap' && guidedResult\?\.mask \? '\u6c7a定' : '\u670dをタップしてください'\s*: '\u9078択範囲をAIマスクへ渡す'/,
  );
  assert.doesNotMatch(editor, /このマスクで確定/);
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
