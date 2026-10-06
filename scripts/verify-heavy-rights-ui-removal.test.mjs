import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const surfacePaths = [
  '../src/pages/GeneratePage.tsx',
  '../src/pages/LightchainWorkbenchPage.tsx',
  '../src/pages/LightchainMaterialWorkbenchPage.tsx',
  '../src/pages/CanvasEditorPage.tsx',
  '../src/pages/FittingPage.tsx',
  '../src/components/ChatEditor.tsx',
  '../src/pages/ModelLibraryPage.tsx',
  '../src/components/lightchain/SourceModelLibrarySurface.tsx',
  '../src/components/lightchain/SourceModelToolSurface.tsx',
];

const forbiddenHeavyUi = /data-testid="heavy-(?:terms|rights|entitlement-gate)|Heavy利用条件|権利表明|規約同意|権利を確認してAI生成|terms v1|rights v1/u;

test('Heavy surfaces expose no Light-missing rights or terms UI', async () => {
  const sources = await Promise.all(surfacePaths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, forbiddenHeavyUi, surfacePaths[index]);
  }
});

test('login-only Heavy generation keeps persistence safety while removing consent and setup gating', async () => {
  const [generate, workbench, material, canvas, fitting, chat] = await Promise.all(
    surfacePaths.slice(0, 6).map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  );
  assert.doesNotMatch(generate, /canSubmitHeavyCapability\(/);
  assert.doesNotMatch(generate, /heavyTermsAccepted && heavyRightsAttested/);
  assert.match(generate, /const heavyConsent = undefined/);
  assert.match(generate, /heavyCapability\.supported && Boolean\(user\?\.id\)/);
  assert.match(workbench, /providerRightsConfirmed/);
  assert.match(material, /providerRightsConfirmed/);
  assert.match(canvas, /requireBrandRole|currentBrand/);
  assert.match(fitting, /currentBrand/);
  assert.match(chat, /resolveChatEditorHeavyReadiness/);
  assert.doesNotMatch(generate, /ログインしてブランドを選択してください/u);
  assert.match(generate, /利用環境を準備できませんでした。もう一度お試しください。/u);
  assert.match(workbench, /heavyOwnedFeature\s*\?\s*'利用環境を準備できませんでした。もう一度お試しください。'/u);
  assert.match(material, /heavyOwnedFeature\s*\?\s*'利用環境を準備できませんでした。もう一度お試しください。'/u);
  assert.match(canvas, /利用環境を準備できませんでした。もう一度お試しください。/u);
  assert.match(fitting, /保存先を準備できませんでした。もう一度お試しください。/u);
  for (const [index, source] of [generate, workbench, material, canvas, fitting, chat].entries()) {
    assert.doesNotMatch(source, /getHeavyEntitlement\(/, surfacePaths[index]);
  }

  const imageAi = await readFile(new URL('../cloudflare/heavy-api/src/image-ai.ts', import.meta.url), 'utf8');
  const contracts = await readFile(new URL('../cloudflare/heavy-api/src/image-ai-contracts.ts', import.meta.url), 'utf8');
  const entitlement = await readFile(new URL('../cloudflare/heavy-api/src/heavy-entitlement.ts', import.meta.url), 'utf8');
  assert.match(imageAi, /resolveHeavyGenerationAccess/);
  assert.doesNotMatch(imageAi, /const entitlement = await resolveHeavyEntitlement\(env/);
  assert.doesNotMatch(contracts, /rights_confirmation_required/);
  assert.match(contracts, /validateLegalSafetyInput/);
  assert.match(entitlement, /resolveHeavyGenerationAccess/);
});

test('Heavy model-library parity surfaces replace Light plan-lock affordances with login-only generation', async () => {
  const [library, tool] = await Promise.all([
    readFile(new URL('../src/components/lightchain/SourceModelLibrarySurface.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lightchain/SourceModelToolSurface.tsx', import.meta.url), 'utf8'),
  ]);
  for (const source of [library, tool]) {
    assert.match(source, /isHeavyWorkspaceRuntime/);
    assert.match(source, /heavyRuntime \? \(/);
    assert.match(source, /AI生成/);
    assert.match(source, /SourcePermissionLockedButton/);
  }
  assert.match(library, /feature: 'model-matrix'/);
  assert.match(tool, /feature: 'model-matrix'/);
  assert.match(tool, /putLocalCanvasAsset/);
  assert.match(tool, /localSourceReference/);
  assert.doesNotMatch(library, /heavyRuntime[\s\S]{0,800}権限がありません/u);
  assert.doesNotMatch(tool, /heavyRuntime[\s\S]{0,800}権限がありません/u);
});

test('Heavy model-matrix rehydrates actual model-library file bytes before provider submit', async () => {
  const generate = await readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  assert.match(generate, /getLocalCanvasAsset/);
  assert.match(generate, /setReferenceImage\(\{[\s\S]*sourceImageUrl/);
  assert.match(generate, /modelReferenceImageUrl: modelReferenceImageUrl/);
  assert.match(generate, /modelReferenceFileName/);
});
