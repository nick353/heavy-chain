import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const parityPagesSourcePath = new URL('../src/pages/LightchainParityPages.tsx', import.meta.url);
const materialWorkbenchSourcePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const modelLibrarySourcePath = new URL('../src/pages/ModelLibraryPage.tsx', import.meta.url);
const fittingSourcePath = new URL('../src/pages/FittingPage.tsx', import.meta.url);

test('the integrated beta does not expose the legacy plan-lock affordance', async () => {
  const [parityPages, materialWorkbench, workbench, modelLibrary] = await Promise.all([
    readFile(parityPagesSourcePath, 'utf8'),
    readFile(materialWorkbenchSourcePath, 'utf8'),
    readFile(workbenchSourcePath, 'utf8'),
    readFile(modelLibrarySourcePath, 'utf8'),
  ]);
  const source = [parityPages, materialWorkbench, workbench, modelLibrary].join('\n');

  assert.doesNotMatch(source, /PermissionLockedButton/);
  assert.doesNotMatch(source, /権限がありません/);
  assert.match(source, /data-testid="lightchain-fabric-design-input"/);
  assert.match(source, /data-testid="lightchain-material-rights-confirmation"/);
});

test('Creator permission surface keeps a Lightchain-native handoff with captured intent', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');

  assert.match(source, /source:\s*'lightchain-creator-heavy-fallback'/);
  assert.match(source, /feature=design-gacha/);
  assert.match(source, /category:\s*selectedCategory \|\| 'ユニセックス'/);
  assert.match(source, /生成条件を開く/);
});

test('AI fitting exposes Gallery selection and the rights gate before generation', async () => {
  const source = await readFile(fittingSourcePath, 'utf8');

  assert.doesNotMatch(source, /data-testid="heavy-native-fallback-banner"/);
  assert.doesNotMatch(source, /Lightchainの「権限がありません」はプラン規制として維持/);
  assert.match(source, /Gallery素材を選択/);
  assert.match(source, /data-testid="fitting-model-gallery-select"/);
  assert.match(source, /UPLOAD_RIGHTS_CONFIRMATION_LABEL/);
});
