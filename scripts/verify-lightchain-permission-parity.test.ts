import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const parityPagesSourcePath = new URL('../src/pages/LightchainParityPages.tsx', import.meta.url);
const materialWorkbenchSourcePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const modelLibrarySourcePath = new URL('../src/pages/ModelLibraryPage.tsx', import.meta.url);
const fittingSourcePath = new URL('../src/pages/FittingPage.tsx', import.meta.url);
const generateSourcePath = new URL('../src/pages/GeneratePage.tsx', import.meta.url);
const canvasSourcePath = new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url);
const chatSourcePath = new URL('../src/components/ChatEditor.tsx', import.meta.url);
const creditsSourcePath = new URL('../src/pages/CreditsPage.tsx', import.meta.url);
const fashionDetailSourcePath = new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url);

test('Lightchain parity does not add a Heavy-only rights checkbox', async () => {
  const [parityPages, materialWorkbench, workbench, modelLibrary] = await Promise.all([
    readFile(parityPagesSourcePath, 'utf8'),
    readFile(materialWorkbenchSourcePath, 'utf8'),
    readFile(workbenchSourcePath, 'utf8'),
    readFile(modelLibrarySourcePath, 'utf8'),
  ]);
  const source = [parityPages, materialWorkbench, workbench, modelLibrary].join('\n');

  assert.match(source, /ParityPermissionGate/);
  assert.match(source, /testId="creator-permission"/);
  assert.match(source, /providerRightsConfirmed/);
  assert.match(source, /data-testid="lightchain-fabric-design-input"/);
  assert.doesNotMatch(source, /権利確認済みのサンプル素材/);
  assert.doesNotMatch(source, /lightchain-material-rights-confirmation|lightchain-rights-confirmation|権利を確認してAI生成/);
  assert.doesNotMatch(modelLibrary, /生成直前に権利確認を行います/);
  assert.match(modelLibrary, /data-testid="model-library-permission-surface"/);
});

test('Creator keeps the Lightchain category picker and permission surface', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');

  assert.match(source, /CreatorCategoryPicker/);
  assert.match(source, /creatorCategoryTabs/);
  assert.match(source, /カテゴリを選択してください/);
  assert.match(source, /data-testid="creator-persisted-history"/);
  assert.match(source, /testId="creator-permission"/);
  assert.match(source, /aria-label="デザインを選択してください 必須項目"/);
  assert.match(source, /aria-label="画像をアップロード オプション"/);
  assert.match(source, /aria-label="キーワードを追加 オプション"/);
  assert.doesNotMatch(source, /Hello,山内カンナ/);
});

test('Creator mirrors the Lightchain full and compact category sets', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');

  assert.match(source, /レディース: creatorCategoryGroups/);
  assert.match(source, /女の子: creatorCategoryGroups/);
  const compactTop = "items: ['ニット', 'ルームウェア', 'Tシャツ', 'パーカー', 'シャツ', 'タンクトップ', 'ベスト', 'スーツ', 'ブルゾン', 'トレンチコート', 'オーバーコート', 'ダウン']";
  assert.ok(source.includes(`メンズ: [\n    { label: 'トップス', ${compactTop}`));
  assert.ok(source.includes(`男の子: [\n    { label: 'トップス', ${compactTop}`));
  assert.ok(source.includes("{ label: 'ボトムス', items: ['ルームウェア', 'スイムウェア', 'パンツ'] }"));
  assert.ok(source.includes("{ label: 'ワンピース/セットアップ', items: ['つなぎ'] }"));
});

test('Wear Design Lab mirrors the current project cards without a seeded project id', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');

  // Project cards come from saved projects; the detail link carries project=<n> and keeps the lab workspace.
  assert.match(source, /function orientedDesignLabHref\(/);
  assert.match(source, /index\?: \{ key: 'project' \| 'reference'; value: number \}/);
  assert.match(source, /navigate\(orientedDesignLabHref\(location, '\/flow\/orientedDesign\/detail', index\)\)/);
  assert.doesNotMatch(source, /boardProjectCode=2088009465900642306/);
});

test('AI fitting exposes Gallery selection and the source permission surface before generation', async () => {
  const source = await readFile(fittingSourcePath, 'utf8');

  assert.doesNotMatch(source, /data-testid="heavy-native-fallback-banner"/);
  assert.doesNotMatch(source, /Lightchainの「権限がありません」はプラン規制として維持/);
  assert.match(source, /Gallery素材を選択/);
  assert.match(source, /data-testid="fitting-model-gallery-select"/);
  assert.match(source, /const heavyGenerationReady = Boolean\(currentBrand\?\.id && user\?\.id\)/);
  assert.match(source, /生成を準備できません/);
  assert.doesNotMatch(source, /getLightchainSourceGenerationAccess(?:ForWorkflow)?\(/);
  assert.doesNotMatch(source, /UPLOAD_RIGHTS_CONFIRMATION_LABEL|type="checkbox"/);
});

test('Heavy parity surfaces keep Heavy consent separate from the Light-missing rights badge', async () => {
  const sources = await Promise.all([
    readFile(generateSourcePath, 'utf8'),
    readFile(canvasSourcePath, 'utf8'),
    readFile(chatSourcePath, 'utf8'),
    readFile(creditsSourcePath, 'utf8'),
    readFile(fashionDetailSourcePath, 'utf8'),
  ]);
  const source = sources.join('\n');

  assert.doesNotMatch(source, /UPLOAD_RIGHTS_CONFIRMATION_LABEL|GENERATION_LEGAL_COPY/);
  assert.doesNotMatch(source, /権利確認ゲート|権利確認後/);
  const generate = sources[0];
  assert.match(generate, /const heavyEntitlementReady = noImageGenerationMode[\s\S]*?Boolean\(user\?\.id\) && Boolean\(currentBrand\?\.id\)/);
  assert.match(generate, /const providerRightsConfirmed = heavyEntitlementReady/);
  assert.doesNotMatch(generate, /if \(!noImageGenerationMode && !heavyEntitlementReady\)/);
  assert.match(generate, /const heavyConsent = undefined/);
  assert.doesNotMatch(generate, /data-testid="heavy-terms-acceptance"|data-testid="heavy-rights-attestation"|data-testid="heavy-terms-copy"/);
  assert.doesNotMatch(generate, /Heavy利用条件|権利表明|規約同意/);
  assert.doesNotMatch(generate, /権限がありません/);
  assert.doesNotMatch(generate, /isLightchainGenerationSurface|sourceGenerationAccess|getLightchainSourceGenerationAccess(?:ForWorkflow)?\(/);
  assert.doesNotMatch(generate, /const rightsConfirmed = true/);
  assert.doesNotMatch(generate, /sourceModelGenerationDenied/);
  assert.doesNotMatch(source, /権利確認ゲート|権利確認後/);
});
