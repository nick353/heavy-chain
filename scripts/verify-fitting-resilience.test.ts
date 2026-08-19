import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fittingPageSource = await readFile(
  new URL('../src/pages/FittingPage.tsx', import.meta.url),
  'utf8',
);

const generationSource = fittingPageSource.slice(
  fittingPageSource.indexOf('const runGeneration = async'),
  fittingPageSource.indexOf('const handleGenerate = async'),
);

test('Fitting generation does not clear the previous successful result matrix', () => {
  assert.doesNotMatch(generationSource, /setResultMatrix\(\[\]\)/);
});

test('Fitting shows the retained-result status only while generating with an old result', () => {
  const generatingBlockStart = fittingPageSource.indexOf(
    '{isGenerating && (',
    fittingPageSource.indexOf('fitting-resume-input-unavailable'),
  );
  const generatingBlockEnd = fittingPageSource.indexOf(
    '          )}\n\n          {resultMatrix.length > 0 && (',
    generatingBlockStart,
  );
  const generatingStatusSource = fittingPageSource.slice(generatingBlockStart, generatingBlockEnd);

  assert.match(generatingStatusSource, /\{isGenerating && \(/);
  assert.match(generatingStatusSource, /\{resultMatrix\.length > 0 && \(/);
  assert.match(generatingStatusSource, /role="status"/);
  assert.match(generatingStatusSource, /aria-label="前回の成功結果を保持中（新しい生成を処理しています）"/);
  assert.match(generatingStatusSource, /前回の成功結果を保持中（新しい生成を処理しています）/);
  assert.doesNotMatch(generatingStatusSource, /resultMatrix\.length === 0/);
});

test('Fitting promotes result and history only after the all-item persistence loop', () => {
  const persistenceLoopIndex = generationSource.indexOf('for (const [index, item] of matrix.entries())');
  const resultPromotionIndex = generationSource.indexOf('setResultMatrix(matrix)', persistenceLoopIndex);
  const historyPromotionIndex = generationSource.indexOf('setHistory((items)', persistenceLoopIndex);

  assert.notEqual(persistenceLoopIndex, -1);
  assert.ok(resultPromotionIndex > persistenceLoopIndex);
  assert.ok(historyPromotionIndex > resultPromotionIndex);
  assert.match(
    generationSource,
    /artifactIds\.push\(persisted\.artifact\.id\);\n\s{4}\}\n\n\s{4}setResultMatrix\(matrix\);/,
  );
  assert.match(generationSource, /saveWorkspaceArtifactPersisted\(/);
});

test('Fitting initial generation has no retained-result status because the condition requires a nonempty matrix', () => {
  const retainedStatusGuard = fittingPageSource.slice(
    fittingPageSource.indexOf('{isGenerating && (', fittingPageSource.indexOf('fitting-resume-input-unavailable')),
    fittingPageSource.indexOf('data-testid="fitting-previous-result-retained-status"'),
  );

  assert.match(retainedStatusGuard, /\{resultMatrix\.length > 0 && \(/);
  assert.doesNotMatch(retainedStatusGuard, /isGenerating && resultMatrix\.length === 0/);
});
