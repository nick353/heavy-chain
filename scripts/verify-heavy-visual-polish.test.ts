import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../src/components/workspace/PrintGarmentSelectionEditor.tsx', import.meta.url),
  'utf8',
);
const workbench = readFileSync(
  new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url),
  'utf8',
);

test('tap mask defaults to a texture-preserving overlay with accessible display choices', () => {
  assert.match(editor, /useState<MaskDisplayMode>\('overlay'\)/);
  assert.match(editor, /overlay\.data\[offset \+ 3\] = maskOnly \? 210 : 72/);
  assert.match(editor, /overlay\.data\[offset \+ 3\] = 255/);
  assert.doesNotMatch(editor, /overlay\.data\[offset \+ 3\] = 224/);
  assert.doesNotMatch(editor, /overlay\.data\[offset \+ 3\] = 120/);
  assert.match(
    editor,
    /if \(maskDisplayModeRef\.current === 'source'\) \{\s*syncMaskPreview\(\);\s*return;/,
  );
  assert.match(editor, /if \(maskOnly\) \{\s*context\.fillStyle = '#030712'/);
  assert.match(editor, /aria-label="マスクのプレビュー表示"/);
  assert.match(editor, /value: 'overlay', label: '重ねて表示'/);
  assert.match(editor, /value: 'source', label: '元画像'/);
  assert.match(editor, /value: 'mask-only', label: 'マスクのみ'/);
  assert.match(
    editor,
    /selectionSource === 'tap' && guidedResult\?\.mask && \(\s*<fieldset[^>]+data-testid="garment-mask-display-controls"/,
  );
  assert.match(editor, /focus-within:ring-2 focus-within:ring-cyan-200\/80/);
});

test('focused panes do not stretch and progressive cards reserve matching footer height', () => {
  assert.match(
    workbench,
    /lg:grid-cols-\[minmax\(0,0\.92fr\)_minmax\(0,1\.08fr\)\] lg:items-start/,
  );
  assert.equal(workbench.match(/min-h-\[9rem\]/g)?.length, 2);
  assert.match(workbench, /className="min-h-\[9rem\] space-y-2 p-4"/);
  assert.match(workbench, /className="min-h-\[9rem\] border-t border-white\/10 p-4"/);
});
