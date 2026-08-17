import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const parityPagesSourcePath = new URL('../src/pages/LightchainParityPages.tsx', import.meta.url);
const permissionComponentSourcePath = new URL('../src/components/lightchain/PermissionLockedButton.tsx', import.meta.url);
const materialWorkbenchSourcePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const modelLibrarySourcePath = new URL('../src/pages/ModelLibraryPage.tsx', import.meta.url);
const fittingSourcePath = new URL('../src/pages/FittingPage.tsx', import.meta.url);

test('all Lightchain permission surfaces share native disabled and accessible lock semantics', async () => {
  const [component, parityPages, materialWorkbench, workbench, modelLibrary] = await Promise.all([
    readFile(permissionComponentSourcePath, 'utf8'),
    readFile(parityPagesSourcePath, 'utf8'),
    readFile(materialWorkbenchSourcePath, 'utf8'),
    readFile(workbenchSourcePath, 'utf8'),
    readFile(modelLibrarySourcePath, 'utf8'),
  ]);
  const source = [component, parityPages, materialWorkbench, workbench, modelLibrary].join('\n');

  assert.match(component, /export function PermissionLockedButton\(/);
  assert.match(source, /disabled\s+aria-disabled="true"\s+aria-label="権限がありません"/);
  assert.match(source, /data-testid=\{testId\}/);
  assert.match(source, /testId="lightchain-creator-permission-locked"/);
  assert.match(source, /testId="lightchain-model-permission-locked"/);
  assert.match(source, /testId="lightchain-fabric-permission-locked"/);
  assert.match(source, /testId="lightchain-printing-permission-locked"/);
  assert.match(source, /testId=\{`lightchain-\$\{selectedTool\.id\}-permission-locked`\}/);
  assert.match(source, /testId="lightchain-model-library-workbench-permission-locked"/);
  assert.match(source, /testId="lightchain-model-library-permission-locked"/);
});

test('fabric direct route exposes the permission state before the input placeholder', async () => {
  const source = await readFile(materialWorkbenchSourcePath, 'utf8');
  const permissionIndex = source.indexOf('testId="lightchain-fabric-permission-locked"');
  const inputIndex = source.indexOf('data-testid="lightchain-fabric-design-input"');

  assert.ok(permissionIndex >= 0);
  assert.ok(inputIndex >= 0);
  assert.ok(permissionIndex < inputIndex);
});

test('Creator permission surface has a Heavy functional fallback with captured intent', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');

  assert.match(source, /source:\s*'lightchain-creator-heavy-fallback'/);
  assert.match(source, /feature=design-gacha/);
  assert.match(source, /category:\s*selectedCategory \|\| 'ユニセックス'/);
  assert.match(source, /Heavy Chainで続ける/);
});

test('Heavy fallback exposes Gallery selection and the same rights gate before generation', async () => {
  const source = await readFile(fittingSourcePath, 'utf8');

  assert.match(source, /data-testid="heavy-native-fallback-banner"/);
  assert.match(source, /Lightchainの「権限がありません」はプラン規制として維持/);
  assert.match(source, /PermissionLockedButton/);
  assert.match(source, /testId="heavy-lightchain-permission-locked"/);
  assert.match(source, /Gallery素材を選ぶ/);
  assert.match(source, /UPLOAD_RIGHTS_CONFIRMATION_LABEL/);
});
