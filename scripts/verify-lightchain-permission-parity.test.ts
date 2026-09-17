import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const parityPagesSourcePath = new URL('../src/pages/LightchainParityPages.tsx', import.meta.url);
const materialWorkbenchSourcePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const modelLibrarySourcePath = new URL('../src/pages/ModelLibraryPage.tsx', import.meta.url);
const fittingSourcePath = new URL('../src/pages/FittingPage.tsx', import.meta.url);

test('Lightchain parity keeps rights gates explicit on provider-bound surfaces', async () => {
  const [parityPages, materialWorkbench, workbench, modelLibrary] = await Promise.all([
    readFile(parityPagesSourcePath, 'utf8'),
    readFile(materialWorkbenchSourcePath, 'utf8'),
    readFile(workbenchSourcePath, 'utf8'),
    readFile(modelLibrarySourcePath, 'utf8'),
  ]);
  const source = [parityPages, materialWorkbench, workbench, modelLibrary].join('\n');

  assert.match(source, /PermissionLockedButton/);
  assert.match(source, /testId="creator-permission"/);
  assert.match(source, /providerRightsConfirmed/);
  assert.match(source, /data-testid="lightchain-fabric-design-input"/);
  assert.match(source, /data-testid="lightchain-material-rights-confirmation"/);
});

test('Creator keeps the Lightchain category picker and permission surface', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');

  assert.match(source, /CreatorCategoryPicker/);
  assert.match(source, /creatorCategoryTabs/);
  assert.match(source, /カテゴリを選択してください/);
  assert.match(source, /data-testid="creator-persisted-history"/);
  assert.match(source, /testId="creator-permission"/);
  assert.doesNotMatch(source, /Hello,山内カンナ/);
});

test('Wear Design Lab resumes through current persisted projects instead of a seeded project id', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');

  assert.match(source, /既存プロジェクトを続ける/);
  assert.match(source, /index === 1 \? '\/designProduction'/);
  assert.doesNotMatch(source, /boardProjectCode=2088009465900642306/);
});

test('AI fitting exposes Gallery selection and the rights gate before generation', async () => {
  const source = await readFile(fittingSourcePath, 'utf8');

  assert.doesNotMatch(source, /data-testid="heavy-native-fallback-banner"/);
  assert.doesNotMatch(source, /Lightchainの「権限がありません」はプラン規制として維持/);
  assert.match(source, /Gallery素材を選択/);
  assert.match(source, /data-testid="fitting-model-gallery-select"/);
  assert.match(source, /UPLOAD_RIGHTS_CONFIRMATION_LABEL/);
});
