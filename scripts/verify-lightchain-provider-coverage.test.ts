import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLightchainProviderPrompt, getLightchainProviderRoute } from '../src/features/lightchain/providerAdapter.ts';
import { GOAL_CANDIDATE_ROW_IDS } from '../src/features/lightchain/parityContract.ts';

const MODEL_MATRIX_ROWS = new Set([
  'ai-fitting',
  'ai-fitting-reference',
  'model-library',
  'model-face',
  'model-change',
  'body-shape',
  'clothing-size',
  'pose-change',
  'background-change',
  'angle-change',
  'model-custom',
]);

const EDIT_IMAGE_ROWS = new Set([
  'marketing-home',
  'marketing-detail',
  'fitting-clothing-reference',
  'fitting-background-reference',
  'wear-design-lab',
  'wear-design-detail',
  'design-agent',
  'lab',
  'print-design-project',
  'print-design-detail',
  'line-generation',
  'line-to-real',
  'pattern-vector',
  'pattern-vector-pro',
  'svg-convert',
  'custom-style',
]);

test('admits every non-video goal row through an explicit provider route', () => {
  const videoRows = new Set(['video-workstation', 'video-detail']);
  const admittedRows = GOAL_CANDIDATE_ROW_IDS.filter((rowId) => !videoRows.has(rowId));

  assert.equal(admittedRows.length, 31);
  for (const rowId of admittedRows) {
    const route = getLightchainProviderRoute(rowId);
    assert.notEqual(route, 'unsupported', rowId);
    assert.equal(
      route,
      MODEL_MATRIX_ROWS.has(rowId) ? 'model-matrix' : EDIT_IMAGE_ROWS.has(rowId) ? 'edit-image' : 'edit-image',
      `unexpected provider route for ${rowId}`,
    );
  }
});

test('keeps both video rows fail-closed until a real provider is admitted', () => {
  assert.equal(getLightchainProviderRoute('video-workstation'), 'unsupported');
  assert.equal(getLightchainProviderRoute('video-detail'), 'unsupported');
});

test('keeps feature-specific model prompts distinct across every model subfeature', () => {
  const expected = new Map([
    ['model-face', /Change only the model's face/],
    ['model-change', /Replace only the main model/],
    ['body-shape', /Change only the model body shape/],
    ['clothing-size', /Change only the clothing size/],
    ['pose-change', /Change only the model pose/],
    ['background-change', /Change only the background/],
    ['angle-change', /Change only the camera angle/],
    ['model-custom', /Generate a dedicated virtual fashion model/],
  ]);

  for (const [rowId, marker] of expected) {
    const prompt = buildLightchainProviderPrompt({
      toolId: rowId,
      toolTitle: rowId,
      summary: `settings for ${rowId}`,
      primaryName: 'source.png',
      secondaryName: 'reference.png',
    });
    assert.match(prompt, marker, rowId);
    assert.match(prompt, /model-matrix operation/);
    assert.doesNotMatch(prompt, /opaque mask pixel as locked/);
  }
});

test('marks source-free model-library generation as brief-only without losing model semantics', () => {
  for (const rowId of ['model-library', 'model-custom']) {
    const prompt = buildLightchainProviderPrompt({
      toolId: rowId,
      toolTitle: rowId,
      summary: `${rowId} conditions`,
      brief: 'source-free model candidate request',
      briefOnly: true,
    });
    assert.match(prompt, /no required source image \(brief-only workflow\)/, rowId);
    assert.match(prompt, /optional references only/, rowId);
    assert.match(prompt, /model-matrix operation/, rowId);
    assert.match(prompt, rowId === 'model-library'
      ? /Generate apparel-ready model candidates/
      : /Generate a dedicated virtual fashion model/);
    assert.doesNotMatch(prompt, /the first reference image/, rowId);
  }
});

test('keeps brief-only workspace routes explicit instead of claiming source-preserving edits', () => {
  for (const rowId of ['marketing-home', 'marketing-detail', 'wear-design-lab', 'print-design-project', 'custom-style']) {
    const prompt = buildLightchainProviderPrompt({
      toolId: rowId,
      toolTitle: rowId,
      summary: `${rowId} brief`,
      brief: 'brief-only production request',
      briefOnly: true,
    });
    assert.match(prompt, /brief-only workflow/);
    assert.match(prompt, /no required source image/);
    assert.match(prompt, /optional references only/);
    assert.doesNotMatch(prompt, /masked in-place edit/);
  }
});

test('keeps an uploaded workspace source on the edit-image route even when the UI allows brief-only fallback', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(
    workbench,
    /lightchainProviderRoute === 'edit-image' && overrides\?\.allowBriefOnly && !providerSourceImageUrl/,
    'brief-only fallback must only apply when no authoritative primary source image exists',
  );
});

test('exposes the shared rights gate on every provider-backed early-return screen', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const branches = [
    ['AI fitting', 'if (isFeatureDetail && isFittingDetail)', 'if (isFeatureDetail && selectedTool.id !== \'custom-style\' && workspaceStyle)'],
    ['workspace styles', 'if (isFeatureDetail && selectedTool.id !== \'custom-style\' && workspaceStyle)', 'if (selectedTool.id === \'print-design-project\')'],
    ['print project', 'if (selectedTool.id === \'print-design-project\')', 'if (selectedTool.id === \'print-design-detail\')'],
    ['print detail', 'if (selectedTool.id === \'print-design-detail\')', 'if (selectedTool.id === \'wear-design-lab\')'],
    ['wear lab', 'if (selectedTool.id === \'wear-design-lab\')', 'if (selectedTool.id === \'wear-design-detail\')'],
    ['wear detail', 'if (selectedTool.id === \'wear-design-detail\')', 'if (selectedTool.id === \'custom-style\')'],
    ['custom style', 'if (selectedTool.id === \'custom-style\')', ''],
  ] as const;

  for (const [label, start, end] of branches) {
    const startIndex = workbench.indexOf(start);
    const endIndex = end ? workbench.indexOf(end, startIndex + start.length) : workbench.length;
    assert.ok(startIndex >= 0 && endIndex > startIndex, `${label} branch boundaries must remain discoverable`);
    const branch = workbench.slice(startIndex, endIndex);
    assert.match(branch, /renderLightchainProviderGate\(\)/, `${label} must expose the rights gate`);
  }

  assert.match(workbench, /const specialProviderGenerationLocked = !lightchainProviderSupported \|\| lightchainGenerationRunning/);
  assert.match(workbench, /data-testid="lightchain-special-provider-gate"/);
  assert.match(workbench, /data-testid="lightchain-generation-error"/);
});

test('keeps non-model catalog prompts feature-specific instead of using the generic fallback', () => {
  const expected = new Map([
    ['marketing-home', /marketing composition/],
    ['marketing-detail', /exhibition, store, or brand visual/],
    ['fitting-clothing-reference', /clean clothing reference for AI fitting/],
    ['fitting-background-reference', /clean background reference for AI fitting/],
    ['design-agent', /design-planning visual/],
    ['lab', /Heavy Chain Lab transformation/],
  ]);

  for (const [rowId, marker] of expected) {
    const prompt = buildLightchainProviderPrompt({
      toolId: rowId,
      toolTitle: rowId,
      summary: `${rowId} settings`,
      primaryName: 'source.png',
    });
    assert.match(prompt, marker, rowId);
    assert.doesNotMatch(prompt, /Create the requested .* using the supplied references/u, rowId);
  }
});

test('keeps direct provider promotion behind durable result and Canvas lineage guards', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const material = readFileSync(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  const fitting = readFileSync(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  const persistence = readFileSync(new URL('../src/lib/providerResultPersistence.ts', import.meta.url), 'utf8');

  for (const source of [workbench, material]) {
    assert.match(source, /assertCompletedImageEditResult/);
    assert.match(source, /persistProviderResultArtifact/);
    assert.match(source, /sourceProviderResultArtifactId/);
  }
  assert.match(fitting, /assertCompletedModelMatrixResult/);
  assert.match(fitting, /saveWorkspaceArtifactPersisted/);
  assert.match(fitting, /downloadValidatedImage/);
  assert.match(fitting, /fitting_result_download/);
  assert.match(fitting, /fitting-history-\$\{item\.id\}/);
  assert.match(fitting, /data-testid=\{`fitting-result-download-\$\{item\.bodyType\}-\$\{item\.ageGroup\}-\$\{index\}`\}/);
  assert.match(fitting, /data-testid=\{`fitting-history-download-\$\{item\.id\}`\}/);
  assert.match(workbench, /to="\/fitting#fitting-history"/);
  assert.match(workbench, /data-testid="lightchain-fitting-history-link"/);
  assert.match(workbench, /to="\/history"/);
  assert.match(workbench, /data-testid="lightchain-feature-history-link"/);
  for (const marker of [
    'lightchain-print-design-project-result-download',
    'lightchain-print-design-detail-result-download',
    'lightchain-wear-design-lab-result-download',
    'lightchain-wear-design-detail-result-download',
    'lightchain-fitting-result-download',
    'lightchain-lab-result-download',
    'lightchain-workspace-result-download',
    'lightchain-custom-style-result-download',
    'lightchain-feature-result-download',
  ]) {
    assert.match(
      workbench,
      new RegExp(`onClick=\\{\\(\\) => void handleDownloadLightchainResult\\(\\)\\}[\\s\\S]{0,320}data-testid="${marker}"`),
      `${marker} must use the shared validated download handler`,
    );
  }
  assert.match(fitting, /id="fitting-history"/);
  assert.match(fitting, /try \{\s*response = await generateModelMatrix\([\s\S]*?\}\s*catch \(error\) \{\s*setIsGenerating\(false\);\s*setErrorMessage\(getErrorMessage/);
  assert.match(persistence, /provider_result_persistence_unverified/);
});

test('allows a durable brief-only provider result onto Canvas without inventing a source layer', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const resultPlacement = workbench.indexOf('if (workbenchEnabled && lightchainResult?.imageUrl && selectedTool.id !== \'printing-image\')');
  const sourceLayerPlacement = workbench.indexOf('if (shouldSaveWorkbenchAsset) {', resultPlacement - 12000);
  assert.ok(resultPlacement >= 0, 'provider result placement must not require a garment source image');
  assert.ok(sourceLayerPlacement >= 0, 'source layer placement remains separately guarded');
  assert.ok(resultPlacement > sourceLayerPlacement, 'result placement must follow source-layer setup');
});

test('provider retries retain the last completed workbench result until inputs change', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

  const previewStart = workbench.indexOf('setLightchainGenerationRunning(true);');
  const previewTry = workbench.indexOf('try {', previewStart);
  const previewCatch = workbench.indexOf('} catch (error) {', previewTry);
  const previewFinally = workbench.indexOf('} finally {', previewCatch);
  assert.ok(previewStart >= 0 && previewTry > previewStart && previewCatch > previewTry && previewFinally > previewCatch);
  assert.doesNotMatch(workbench.slice(previewStart, previewTry), /setLightchainResult\(null\)/);
  assert.doesNotMatch(workbench.slice(previewCatch, previewFinally), /setLightchainResult\(null\)/);

  const printingStart = workbench.indexOf("setPrintingGenerationStatus('pending');");
  const printingTry = workbench.indexOf('try {', printingStart);
  const printingCatch = workbench.indexOf('} catch (error) {', printingTry);
  const printingFinally = workbench.indexOf('} finally {', printingCatch);
  assert.ok(printingStart >= 0 && printingTry > printingStart && printingCatch > printingTry && printingFinally > printingCatch);
  assert.doesNotMatch(workbench.slice(printingStart, printingTry), /setLightchainResult\(null\)/);
  assert.doesNotMatch(workbench.slice(printingCatch, printingFinally), /setLightchainResult\(null\)/);

  const inputReset = workbench.indexOf('const applyMaterialToSlot');
  assert.ok(inputReset >= 0);
  assert.match(workbench.slice(inputReset, inputReset + 2400), /setLightchainResult\(null\)/);
});
