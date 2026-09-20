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

test('priority material routes keep the current Lightchain source navigation labels', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');

  assert.deepEqual(
    lightchainCategories.map((category) => category.label),
    ['おすすめ', '企画デザインツール', 'AIフィッティング', 'グラフィックツール'],
  );
  assert.match(page, /data-testid="lightchain-source-toolbar"/);
  assert.match(page, /aria-label="ツールカテゴリ"/);
  assert.match(page, /lightchainSourceToolbarItems\.map/);
  assert.match(page, /aria-current=\{item\.category === 'graphics' \? 'page' : undefined\}/);
  assert.match(page, /item\.category === 'graphics' \? 'bg-white\/\[0\.08\] text-white' : ''/);
  for (const label of ['おすすめ', '企画デザインツール', 'AIフィッティング', 'グラフィックツール']) {
    assert.match(page, new RegExp(`label: '${label}'`));
  }
  assert.match(page, /function LightchainMaterialSourceRail/);
  for (const label of ['ツールバー', 'デザインツール', 'フィッティングツール', 'グラフィックデザインツール', '衣類生産ツール']) {
    assert.match(page, new RegExp(`label: '${label}'`));
  }
  assert.doesNotMatch(page, /LIGHTCHAIN MATERIAL WORKBENCH/);
});

test('provider provenance stays behind an opt-in result detail disclosure', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');

  assert.match(page, /<details className="mt-1 rounded-lg border border-white\/10/);
  assert.match(page, /<summary className="cursor-pointer select-none font-semibold text-white\/65">生成情報<\/summary>/);
  assert.match(page, /data-testid=\{`provider-result-provenance-\$\{result\.id\}`\}/);
  assert.doesNotMatch(page, /eyebrow: 'PROVIDER'/);
  assert.match(page, /配置したプリントを服の形状に沿って反映/);
});

test('priority material routes keep the current Lightchain content frame and source rail', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');

  assert.match(page, /lg:grid-cols-\[minmax\(0,596px\)_minmax\(360px,1fr\)\]/);
  assert.match(page, /LIGHTCHAIN_FABRIC_EMPTY_PREVIEW_VIDEO/);
  assert.match(page, /data-testid="lightchain-fabric-source-preview-video"/);
  assert.match(page, /onClick=\{\(\) => navigate\('\/history'\)\}/);
  assert.match(page, /lightchainSourceAppearance/);
  assert.match(page, /data-testid="lightchain-source-toolbar"/);
  assert.doesNotMatch(page, /lg:\[writing-mode:vertical-rl\]/);
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
  assert.match(gallery, /const PLATFORM_GALLERY_ASSETS: GeneratedImageGallerySelectorRow\[\] = \[/);
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

test('Lightchain AI fitting exposes the same library-first garment entry', () => {
  const lightchainWorkbench = fs.readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  assert.match(lightchainWorkbench, /id: 'platform-garment-blank-white-tshirt'/);
  assert.match(lightchainWorkbench, /data-testid="fitting-model-gallery-select"/);
  assert.match(lightchainWorkbench, /setActiveMaterialTab\('platform-assets'\)/);
  assert.match(lightchainWorkbench, /Gallery素材を選択/);
  assert.match(lightchainWorkbench, /const generationBrand = currentBrand \?\? await refreshCurrentBrand\(\)/);
  assert.match(lightchainWorkbench, /const generationBrandId = authBrandFence\.brandId[\s\S]*generateModelMatrix\(generationSummary, generationBrandId/);
  assert.match(lightchainWorkbench, /async function prepareProviderImageUrl\(imageUrl\?: string\)/);
  assert.match(lightchainWorkbench, /const providerRequestImageUrl = await prepareProviderImageUrl\(providerSourceImageUrl\)/);
  assert.match(lightchainWorkbench, /imageUrl: providerRequestImageUrl/);
  assert.match(lightchainWorkbench, /const brandResolutionPending = !isAuthInitialized[\s\S]*brandState\.status !== 'success_nonempty'/);
  assert.match(lightchainWorkbench, /const aiGenerateDisabled = brandResolutionPending/);
});

test('Lightchain AI fitting readback reflects the selected garment state', () => {
  const lightchainWorkbench = fs.readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  assert.match(lightchainWorkbench, /const fittingGarmentCount = materialSlotFiles\.primary \? 1 : 0;/);
  assert.match(lightchainWorkbench, /data-testid="lightchain-fitting-garment-count"/);
  assert.match(lightchainWorkbench, /data-count=\{`\$\{fittingGarmentCount\}\/4`\}/);
  assert.match(lightchainWorkbench, /衣服の画像 \(\{fittingGarmentCount\}\/4\)/);
  assert.match(lightchainWorkbench, /data-testid="lightchain-fitting-garment-selection"/);
  assert.match(lightchainWorkbench, /materialSlotFiles\.primary\?\.name &&/);
  assert.match(lightchainWorkbench, /\{materialSlotFiles\.primary\.name\}/);
  assert.doesNotMatch(lightchainWorkbench, /materialSlotFiles\.primary\?\.name \?\? '未選択'/);
  assert.doesNotMatch(lightchainWorkbench, /衣服の画像 \(0\/4\)/);
});

test('Lightchain fitting clothing uploads retain local Canvas source metadata', () => {
  const lightchainWorkbench = fs.readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  assert.match(lightchainWorkbench, /buildLocalUploadSourceMetadata/);
  assert.match(lightchainWorkbench, /sanitizeCanvasSourceMetadata/);
  assert.match(lightchainWorkbench, /if \(isFittingDetail && selectedTool\.id === 'fitting-clothing-reference' && slot === 'primary'\)/);
  assert.match(lightchainWorkbench, /putLocalCanvasAsset\(sourceMetadata\.sourceRevision\.revision, file\)/);
  assert.match(lightchainWorkbench, /persistenceStatus = 'session-only'/);
  assert.match(lightchainWorkbench, /sourceMetadata: materialSlotFiles\[slot\.key\]\?\.sourceMetadata/);
  assert.match(lightchainWorkbench, /sourceIdentity: fittingMaterialSource\.sourceIdentity/);
  assert.match(lightchainWorkbench, /sourceRevision: fittingMaterialSource\.sourceRevision/);
  assert.match(lightchainWorkbench, /sourceReadback: fittingMaterialSource\.sourceReadback/);
  assert.match(lightchainWorkbench, /persistenceStatus: fittingMaterialPersistenceStatus \?\? 'session-only'/);
  assert.match(lightchainWorkbench, /src: processedMaterialImageUrl/);
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
  assert.match(page, /data-testid="lightchain-material-workbench"/);
  assert.match(page, /data-workbench-mode=\{isPrinting \? 'printing' : 'fabric'\}/);
  assert.match(page, /data-workbench-state="hydrated"/);
  assert.match(page, /data-testid="lightchain-fabric-parity-view"/);
  assert.match(page, /data-testid="lightchain-print-parity-view"/);
  assert.match(page, /data-testid="lightchain-fabric-design-input"/);
  assert.match(page, /data-testid="lightchain-fabric-input"/);
  assert.match(page, /data-testid="fabric-result-history"/);
  assert.match(page, /value=\{fabricPrompt\}[\s\S]*?onChange=\{\(event\) => setFabricPrompt\(event\.target\.value\)\}/);
  assert.match(page, /disabled=\{isGenerating \|\| fabricPreviewState !== 'done' \|\| !fabricBase \|\| !fabricDesign \|\| fabricPresetIds\.length === 0\}/);
  assert.match(page, /const \[providerRightsConfirmed, setProviderRightsConfirmed\] = useState\(true\)/);
  assert.doesNotMatch(page, /rightsConfirmationOpen|rightsConfirmationDraft|lightchain-material-rights-confirmation|権利を確認してAI生成|PermissionLockedButton/);
  assert.match(page, /data-testid="lightchain-print-generate"/);
  assert.match(page, /data-testid="lightchain-fabric-generate"/);
  assert.doesNotMatch(page, /data-testid="lightchain-material-provider-gate"/);
  assert.doesNotMatch(page, /data-testid="lightchain-material-retirement-notice"/);
  assert.match(page, /data-testid="lightchain-fabric-deprecation-banner"/);
  assert.match(page, /この機能はまもなく終了します/);
  assert.match(page, /data-testid="lightchain-material-retry-fabric"/);
  assert.match(page, /data-testid="lightchain-material-retry-printing"/);
  assert.match(page, /生地を衣服領域へ適用したプレビュー/);
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
  assert.match(page, /const resultNote = `\$\{preset\.name\} の質感で重ねた見本/);
  assert.match(page, /outputSize: \{ width, height \}/);
  assert.match(page, /const imageLoadCache = new Map<string, Promise<HTMLImageElement>>\(\)/);
  assert.ok(page.includes("img.crossOrigin = 'anonymous'"));
  assert.ok(page.includes("https?:"));
  assert.match(page, /const handleGenerate = async \(options\?: \{ rightsAlreadyConfirmed\?: boolean \}\) => \{/);
  assert.match(page, /const providerResult = await withTimeout\(/);
  assert.match(page, /lightchainFeatureId: 'fabric-image'/);
  assert.match(page, /maskApplied: true/);
  assert.match(page, /protectedRegionComposited: true/);
  assert.match(page, /data-testid="lightchain-fabric-generate"/);
  assert.ok(page.includes("canvas.toBlob"));
  assert.ok(page.includes("URL.createObjectURL(blob)"));
});

test('fabric direct UI does not add a Heavy-only visible preset picker', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');

  assert.doesNotMatch(page, /onClick=\{\(\) => updateFabricPreset\(/);
  assert.doesNotMatch(page, /<span className="block text-xs font-semibold text-white\/75">生地バリエーション<\/span>/);
  assert.match(page, /const fabricVariants = \[/);
});

test('Lightchain parity routes use the Lightchain header identity', () => {
  const layout = fs.readFileSync('src/components/layout/Layout.tsx', 'utf8');
  const lightchainHeader = layout.slice(
    layout.indexOf('{isLightchainRoute ? ('),
    layout.indexOf(') : (', layout.indexOf('{isLightchainRoute ? (')),
  );
  assert.match(layout, /import \{ HeavyChainLogo \} from '\.\.\/icons';/);
  assert.match(lightchainHeader, /aria-label="Lightchain AI"/);
  assert.match(lightchainHeader, />\s*LIGHTCHAIN\s*</);
  assert.doesNotMatch(lightchainHeader, />\s*Lightchain AI\s*</);
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

test('provider work is fenced by current auth brand authority before and after awaits', () => {
  const material = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  const general = fs.readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  for (const page of [material, general]) {
    assert.match(page, /captureAuthBrandFence/);
    assert.match(page, /assertAuthBrandFence/);
    assert.match(page, /before_provider/);
    assert.match(page, /after_provider/);
    assert.match(page, /before_provider_persistence/);
    assert.match(page, /after_provider_persistence/);
    assert.match(page, /before_provider_ui_commit/);
  }
  assert.match(material, /error instanceof AuthBrandAccessFenceError\s*\? null/);
  assert.match(material, /printing_preview_stale_cleanup_guard/);
});

test('access-fence abort paths never invoke artifact cleanup', () => {
  const material = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  assert.match(material, /const cleanup = error instanceof AuthBrandAccessFenceError\s*\? null\s*:\s*deleteWorkspaceArtifactsPersisted/);
  assert.match(material, /assertCurrentAuthBrandFence\(authBrandFence, 'printing_preview_stale_cleanup_guard'\);\s*deleteWorkspaceArtifactsPersisted/);
});

test('History and Jobs lineage labels use the Lightchain identity', () => {
  const summary = fs.readFileSync('src/lib/sourceContextSummary.ts', 'utf8');
  const activity = fs.readFileSync('src/lib/workspaceActivity.ts', 'utf8');

  assert.match(summary, /'Lightchain機能'/);
  assert.match(summary, /'Lightchain task'/);
  assert.match(summary, /'入力工程（申告）'/);
  assert.doesNotMatch(summary, /'Heavy Chain機能'|'Heavy Chain task'|'Heavy Chain steps'/);
  assert.match(activity, /'実行記録'/);
  assert.match(activity, /'Lightchain状態'/);
});

test('direct fabric route keeps the Lightchain single-input surface without an extra reference-type toggle', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  const start = page.indexOf('data-testid="lightchain-fabric-design-input"');
  const end = page.indexOf('data-testid="lightchain-fabric-input"', start);
  assert.ok(start >= 0 && end > start, 'direct fabric input sections are required');
  const directFabricDesign = page.slice(start, end);

  assert.match(directFabricDesign, /label="モデル\/デザイン画像"/);
  assert.match(directFabricDesign, /allowedReferenceTypes=\{\['base'\]\}/);
  assert.doesNotMatch(directFabricDesign, /allowedReferenceTypes=\{\['base', 'pattern'\]\}/);
});

test('unified fabric workbench keeps the rendered garment input on the Lightchain base-image contract', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  const branchStart = page.indexOf('{!isPrinting ? (');
  const branchEnd = page.indexOf(') : (', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart, 'unified fabric branch is required');

  const fabricBranch = page.slice(branchStart, branchEnd);
  const garmentSelectorStart = fabricBranch.indexOf('<ImageSelector');
  const textileSelectorStart = fabricBranch.indexOf('<ImageSelector', garmentSelectorStart + 1);
  assert.ok(garmentSelectorStart >= 0 && textileSelectorStart > garmentSelectorStart, 'unified fabric selectors are required');

  const garmentSelector = fabricBranch.slice(garmentSelectorStart, textileSelectorStart);
  assert.match(garmentSelector, /label=\{activeMaterialInputs\[0\]\.label\}/);
  assert.match(garmentSelector, /allowedReferenceTypes=\{\['base'\]\}/);
  assert.doesNotMatch(garmentSelector, /allowedReferenceTypes=\{\['base', 'pattern'\]\}/);
});

test('unified printing workbench keeps garment and print inputs on Lightchain reference contracts', () => {
  const page = fs.readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');
  const fabricBranchStart = page.indexOf('{!isPrinting ? (');
  const printingBranchStart = page.indexOf(') : (', fabricBranchStart);
  const printingBranchEnd = page.indexOf('{isPrinting && (', printingBranchStart);
  assert.ok(fabricBranchStart >= 0 && printingBranchStart > fabricBranchStart, 'unified printing branch is required');
  assert.ok(printingBranchEnd > printingBranchStart, 'printing branch boundary is required');

  const printingBranch = page.slice(printingBranchStart, printingBranchEnd);
  const garmentStart = printingBranch.indexOf('selectionTestId="print-garment-selector"');
  const designStart = printingBranch.indexOf('selectionTestId="print-design-selector"');
  assert.ok(garmentStart >= 0 && designStart > garmentStart, 'printing garment and design selectors are required');

  const garmentSelector = printingBranch.slice(
    printingBranch.lastIndexOf('<ImageSelector', garmentStart),
    designStart,
  );
  assert.match(garmentSelector, /allowedReferenceTypes=\{\['base'\]\}/);
  assert.doesNotMatch(garmentSelector, /allowedReferenceTypes=\{\['base', 'pattern'\]\}/);

  const designSelector = printingBranch.slice(
    printingBranch.lastIndexOf('<ImageSelector', designStart),
    printingBranch.indexOf('/>', designStart) + 2,
  );
  assert.match(designSelector, /allowedReferenceTypes=\{\['pattern'\]\}/);
  assert.doesNotMatch(designSelector, /allowedReferenceTypes=\{\['base', 'pattern'\]\}/);
});

test('AI fitting early route has no extra rights confirmation surface', () => {
  const workbench = fs.readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  const fittingStart = workbench.indexOf('if (isFeatureDetail && isFittingDetail) {');
  const nextRouteStart = workbench.indexOf("if (isFeatureDetail && selectedTool.id !== 'custom-style' && workspaceStyle)");
  assert.ok(fittingStart >= 0 && nextRouteStart > fittingStart);
  assert.doesNotMatch(workbench.slice(fittingStart, nextRouteStart), /rightsConfirmation|権利確認/);
});
