import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LIGHTCHAIN_MATERIAL_INPUTS,
  LIGHTCHAIN_MATERIAL_LIBRARY_TABS,
  LIGHTCHAIN_MATERIAL_TABS,
} from '../src/lib/lightchainMaterialContract.ts';
import { lightchainCategories } from '../src/lib/lightchainParityCatalog.ts';

test('material and print tools share the Light Chain tab contract', () => {
  assert.deepEqual(
    LIGHTCHAIN_MATERIAL_TABS.map((tab) => tab.label),
    ['生地イメージ', 'プリントイメージ', '線画の実写化', '平絵生成'],
  );
  assert.deepEqual(
    LIGHTCHAIN_MATERIAL_LIBRARY_TABS.map((tab) => tab.label),
    ['履歴アップロード', '生成履歴', 'マイライブラリー', 'チームライブラリー', 'プラットフォームアセット'],
  );
});

test('priority material routes expose the current Lightchain direct-route toolbar without Heavy-only rails', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');

  assert.deepEqual(
    lightchainCategories.map((category) => category.label),
    ['おすすめ', '企画デザインツール', 'AIフィッティング', 'グラフィックツール'],
  );
  assert.match(page, /data-testid="lightchain-material-toolbar"/);
  assert.match(page, />ツールバー<\/span>/);
  assert.match(page, /label: '衣類生産ツール'/);
  assert.match(page, /label: 'フィッティングツール'/);
  assert.doesNotMatch(page, /data-testid="lightchain-category-toolbar"/);
  assert.doesNotMatch(page, /lightchainCategories\.map/);
});

test('fabric and print keep the same required-input order as the Light recording', () => {
  assert.deepEqual(
    LIGHTCHAIN_MATERIAL_INPUTS['fabric-image'].map((slot) => slot.label),
    ['モデル／デザイン画像', '生地画像'],
  );
  assert.deepEqual(
    LIGHTCHAIN_MATERIAL_INPUTS['printing-image'].map((slot) => slot.label),
    ['参考画像', 'プリントをアップロード'],
  );
  assert.equal(
    LIGHTCHAIN_MATERIAL_INPUTS['printing-image'].every((slot) => slot.required),
    true,
  );
});

test('platform assets expose only explicit product-owned inputs', () => {
  const gallery = fs.readFileSync('src/components/GallerySelector.tsx', 'utf8');
  assert.match(gallery, /const PLATFORM_GALLERY_ASSETS: GeneratedImage\[\] = \[/);
  assert.match(gallery, /platform-blank-white-tshirt-v1/);
  assert.match(gallery, /platform-cotton-knit-neutral-v1/);
  assert.match(gallery, /\/assets\/printing\/blank-white-tshirt\.svg/);
  assert.match(gallery, /\/assets\/fabric\/cotton-knit-neutral\.svg/);
  assert.match(gallery, /assetOrigin: 'platform'/);
  assert.match(gallery, /assetRole: 'textile'/);
  assert.match(gallery, /platformAssetRole/);
  assert.match(gallery, /assetPurpose === PRINT_DESIGN_ASSET_PURPOSE[\s\S]*?PLATFORM_GALLERY_ASSETS\.filter/);
  assert.match(gallery, /role === platformAssetRole/);
  assert.ok(fs.existsSync('public/assets/fabric/cotton-knit-neutral.svg'));
});

test('general Heavy workbenches can use an existing Gallery asset before upload', () => {
  const workbench = fs.readFileSync('src/components/workspace/MaterialWorkbench.tsx', 'utf8');
  assert.match(workbench, /enableGallerySelection = true/);
  assert.match(workbench, /data-testid="material-gallery-select"/);
  assert.match(workbench, /Galleryから選ぶ/);
  assert.match(workbench, /handleGallerySelect/);
  assert.match(workbench, /sourceImageId: imageId/);
  assert.match(workbench, /sourceImageId: null/);
  assert.match(workbench, /sourceStoragePath: null/);
  assert.match(workbench, /<GallerySelector/);
});

test('AI fitting restricts the bundled platform picker to garment inputs', () => {
  const fitting = fs.readFileSync('src/pages/FittingPage.tsx', 'utf8');
  const materialWorkbench = fs.readFileSync('src/components/workspace/MaterialWorkbench.tsx', 'utf8');
  assert.match(fitting, /<MaterialWorkbench[\s\S]*?platformAssetRole="garment"/);
  assert.match(fitting, /title="Gallery素材を選択"[\s\S]*?platformAssetRole="garment"/);
  assert.doesNotMatch(fitting, /data-testid="heavy-native-fallback-banner"/);
  assert.doesNotMatch(fitting, /Heavy Chainの自前生成ロジック/);
  assert.doesNotMatch(fitting, /Lightchainの「権限がありません」/);
  assert.match(materialWorkbench, /platformAssetRole\?: 'garment' \| 'textile' \| 'artwork'/);
  assert.match(materialWorkbench, /platformAssetRole=\{platformAssetRole\}/);
});

test('Gallery keeps a loading shell while auth and brand state are initializing', () => {
  const gallery = fs.readFileSync('src/components/GallerySelector.tsx', 'utf8');
  assert.match(gallery, /isLoading: authLoading/);
  assert.match(gallery, /isInitialized: authInitialized/);
  assert.match(gallery, /!currentBrand && \(authLoading \|\| !authInitialized\)/);
  assert.match(gallery, /authLoading \|\| !authInitialized/);
  assert.match(gallery, /ブランドを選択してからギャラリーを開いてください/);
});

test('fabric uses the Light-style parity shell while retaining the real generation path', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  assert.match(page, /data-testid="lightchain-fabric-parity-view"/);
  assert.match(page, /data-testid="lightchain-fabric-design-input"/);
  assert.match(page, /data-testid="lightchain-fabric-input"/);
  assert.match(page, /data-testid="fabric-result-history"/);
  assert.match(page, /value=\{fabricPrompt\}[\s\S]*?onChange=\{\(event\) => setFabricPrompt\(event\.target\.value\)\}/);
  assert.match(page, /disabled=\{isGenerating \|\| fabricPreviewState !== 'done' \|\| !fabricBase \|\| !fabricDesign \|\| fabricPresetIds\.length === 0 \|\| !providerRightsConfirmed\}/);
  assert.match(page, /data-testid="lightchain-material-rights-confirmation"/);
  assert.match(page, /AIプロバイダーへ送信して生成します/);
  assert.match(page, /<Link to="\/designProduction"[^>]*>\s*今すぐ体験\s*<\/Link>/);
  assert.match(page, /切り抜き済み生地を衣服領域へ適用した参考/);
  assert.match(page, /buildFabricModelGarmentMask/);
  assert.match(page, /buildHighPrecisionMaterialCutoutDataUrl/);
  assert.match(page, /preserveSourceFrame: true/);
  assert.match(page, /fabricBoundsWidth/);
  assert.match(page, /fabricCoreLeft/);
  assert.match(page, /renderFabricTryOnComposition/);
  assert.match(page, /keepCentralGarmentMaskComponent/);
  assert.match(page, /refineCoarseGarmentMask/);
  assert.match(page, /coarseMaskWasRectangular/);
  assert.match(page, /averageColor/);
  assert.match(page, /FABRIC_OUTPUT_BACKGROUND/);
  assert.doesNotMatch(page, /backgroundColor: (?:previewVariant|preset)\.tint/);
  assert.match(page, /globalCompositeOperation = 'destination-in'/);
  assert.match(page, /const isDedicatedClothResult = result\.engine === 'browser-ai-u2net_cloth_seg-v1'/);
  assert.match(page, /const isSafeWhiteBackgroundFallback = result\.engine === 'browser-local-white-background-garment-cutout-v1'/);
  assert.match(page, /const isSafePortraitPriorFallback = result\.engine === 'browser-local-portrait-garment-prior-v1'/);
  assert.match(page, /if \(!isDedicatedClothResult && !isSafeWhiteBackgroundFallback && !isSafePortraitPriorFallback\)/);
  assert.match(page, /モデル画像の衣服領域を専用AIで確定できませんでした/);
  assert.doesNotMatch(page, /<img src=\{fabricPreviewOverlayUrl\}/);
  assert.doesNotMatch(page, /<img src=\{fabricBase\.url\} alt="生地プレビュー"/);
  assert.doesNotMatch(page, /<img src=\{fabricBase\.url\} alt="生地の参考"/);
  assert.match(page, /note: `\$\{preset\.name\} の質感で重ねた見本/);
  assert.match(page, /outputSize: \{ width, height \}/);
  assert.match(page, /const imageLoadCache = new Map<string, Promise<HTMLImageElement>>\(\)/);
  assert.ok(page.includes("img.crossOrigin = 'anonymous'"));
  assert.ok(page.includes("https?:"));
  assert.match(page, /const handleGenerate = async \(\) => \{/);
  assert.match(page, /const providerResult = await withTimeout\(/);
  assert.match(page, /lightchainFeatureId: 'fabric-image'/);
  assert.match(page, /maskApplied: true/);
  assert.match(page, /protectedRegionComposited: true/);
  assert.match(page, /data-testid="lightchain-fabric-generate"/);
  assert.ok(page.includes("canvas.toBlob"));
  assert.ok(page.includes("URL.createObjectURL(blob)"));
});

test('Lightchain parity routes use the Lightchain header identity', () => {
  const layout = fs.readFileSync('src/components/layout/Layout.tsx', 'utf8');
  const lightchainHeader = layout.slice(
    layout.indexOf('{isLightchainRoute ? ('),
    layout.indexOf(') : (', layout.indexOf('{isLightchainRoute ? (')),
  );
  assert.match(layout, /import \{ HeavyChainLogo \} from '\.\.\/icons';/);
  assert.match(lightchainHeader, /aria-label="Lightchain AI"/);
  assert.match(lightchainHeader, /LIGHTCHAIN/);
  assert.doesNotMatch(lightchainHeader, /HEAVY CHAIN/);
  assert.match(layout, /const lightchainWorkspaceRoutes = \['\/gallery', '\/history', '\/jobs'\]/);
});

test('current /model route uses the provider-capable AI fitting workbench', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const modelRouteStart = app.indexOf('path="/model"');
  const modelRouteEnd = app.indexOf('path="/tools/fabric"', modelRouteStart);
  const modelRoute = app.slice(modelRouteStart, modelRouteEnd);
  const workbench = fs.readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');

  assert.ok(modelRouteStart >= 0);
  assert.ok(modelRouteEnd > modelRouteStart);
  assert.match(modelRoute, /<LightchainWorkbenchPage \/>/);
  assert.doesNotMatch(modelRoute, /LightchainModelPage/);
  assert.match(workbench, /const isModelRoute = location\.pathname === '\/model';/);
  assert.match(workbench, /visibleTools\.find\(\(tool\) => tool\.id === 'ai-fitting'\)/);
  assert.doesNotMatch(workbench, />Heavy Chain<\/p>/);
  assert.doesNotMatch(workbench, />HEAVY CHAIN ORDER SHEET<\/text>/);
});

test('Lightchain generation entrypoints do not expose the legacy Heavy branding', () => {
  const layout = fs.readFileSync('src/components/layout/Layout.tsx', 'utf8');
  const generate = fs.readFileSync('src/pages/GeneratePage.tsx', 'utf8');
  const parityPages = fs.readFileSync('src/pages/LightchainParityPages.tsx', 'utf8');
  const unifiedCatalog = fs.readFileSync('src/lib/lightchainUnifiedFeatureCatalog.ts', 'utf8');
  const parityCatalog = fs.readFileSync('src/lib/lightchainParityCatalog.ts', 'utf8');
  const gallery = fs.readFileSync('src/components/GallerySelector.tsx', 'utf8');
  const printingComposer = fs.readFileSync('src/components/lightchain/PrintingImageComposer.tsx', 'utf8');

  assert.match(layout, /concat\(\['\/generate', '\/editor\/changeColor'\]\)/);
  assert.doesNotMatch(generate, /HEAVY CHAIN \/ ENTRY/);
  assert.doesNotMatch(generate, /Heavy Chain usage/);
  assert.doesNotMatch(parityPages, /Heavy Chainで続ける/);
  assert.doesNotMatch(parityPages, /Heavy Chainでは/);
  assert.doesNotMatch(unifiedCatalog, /title: 'Heavy Chain Lab'/);
  assert.doesNotMatch(parityCatalog, /title: 'Heavy Chain Lab'/);
  assert.doesNotMatch(gallery, /このHeavy Chain環境/);
  assert.doesNotMatch(printingComposer, />Heavy Chain \/ printing-image/);
});

test('Lightchain parity pages do not render Heavy-only identity or prompt defaults', () => {
  const parityPages = [
    'src/pages/FashionStudioPage.tsx',
    'src/pages/PatternWorkspacePage.tsx',
    'src/pages/ModelLibraryPage.tsx',
    'src/pages/LabPage.tsx',
  ].map((path) => fs.readFileSync(path, 'utf8')).join('\n');

  assert.doesNotMatch(parityPages, /HEAVY CHAIN|HEAVYCHAIN|Heavy Chain/);
  assert.match(parityPages, /LIGHTCHAIN \/ STUDIO/);
  assert.match(parityPages, /LIGHTCHAIN \/ MODELS/);
  assert.match(parityPages, /ラボで試す/);
});

test('History and Jobs lineage labels use the Lightchain identity', () => {
  const summary = fs.readFileSync('src/lib/sourceContextSummary.ts', 'utf8');
  const activity = fs.readFileSync('src/lib/workspaceActivity.ts', 'utf8');

  assert.match(summary, /'Lightchain機能'/);
  assert.match(summary, /'Lightchain task'/);
  assert.match(summary, /'Lightchain steps'/);
  assert.doesNotMatch(summary, /'Heavy Chain機能'|'Heavy Chain task'|'Heavy Chain steps'/);
  assert.match(activity, /'Lightchain steps'/);
  assert.match(activity, /'Lightchain状態'/);
});
