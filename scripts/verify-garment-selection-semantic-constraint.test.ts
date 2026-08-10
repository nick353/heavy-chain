import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../src/components/workspace/PrintGarmentSelectionEditor.tsx', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url),
  'utf8',
);
const library = readFileSync(
  new URL('../src/lib/workspaceMaterialReferences.ts', import.meta.url),
  'utf8',
);

test('tap selection keeps the source crop opaque and carries the reviewed mask separately', () => {
  assert.match(editor, /Keep the\n+\s+\/\/ crop opaque for the downstream cloth model/);
  assert.match(editor, /selectionMaskUrl = maskCanvas\.toDataURL\('image\/png'\)/);
  assert.match(editor, /onApply\(output\.toDataURL\('image\/png'\), selectionSource, segmentationTarget, selectionMaskUrl\)/);
  assert.doesNotMatch(
    editor,
    /context\.globalCompositeOperation = 'destination-in';[\s\S]*?context\.drawImage\(maskCanvas, 0, 0\)/,
  );
});

test('printing passes the reviewed tap mask into the semantic cutout request', () => {
  assert.match(page, /const \[printGarmentSelectionMaskUrl, setPrintGarmentSelectionMaskUrl\]/);
  assert.match(page, /selectionMaskUrl: printGarmentSelectionMaskUrl \?\? undefined/);
  assert.match(page, /setPrintGarmentSelectionMaskUrl\(selectionMaskUrl \?\? null\)/);
});

test('the semantic result and every fallback are constrained by the reviewed mask', () => {
  assert.match(library, /const constrainCutoutResultToSelectionMask = async/);
  assert.match(library, /result: semanticResult,[\s\S]*?selectionMaskUrl,[\s\S]*?maxDataUrlBytes/);
  assert.match(library, /result: fallback,[\s\S]*?selectionMaskUrl,[\s\S]*?maxDataUrlBytes/);
  assert.match(library, /result: fastResult,[\s\S]*?selectionMaskUrl,[\s\S]*?maxDataUrlBytes/);
});

test('a reviewed tap mask remains usable when semantic cutout models fail', () => {
  assert.match(library, /const buildGuidedSelectionMaskFallback = async/);
  assert.match(library, /browser-canvas-guided-selection-mask-v1/);
  assert.match(library, /if \(modelName === 'modnet' \|\| modelName === 'ben2'\)/);
  assert.ok(
    library.indexOf("if (modelName === 'modnet' || modelName === 'ben2')")
      < library.indexOf('const guidedFallback = await buildGuidedSelectionMaskFallback'),
    'the reviewed mask must constrain a semantic matte before the terminal guided fallback',
  );
  assert.match(library, /const guidedFallback = await buildGuidedSelectionMaskFallback\([\s\S]*?selectionMaskUrl/);
});
