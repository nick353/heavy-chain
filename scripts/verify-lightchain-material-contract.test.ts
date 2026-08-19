import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LIGHTCHAIN_MATERIAL_INPUTS,
  LIGHTCHAIN_MATERIAL_LIBRARY_TABS,
  LIGHTCHAIN_MATERIAL_TABS,
} from '../src/lib/lightchainMaterialContract.ts';

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
  assert.match(gallery, /\/assets\/printing\/blank-white-tshirt\.svg/);
  assert.match(gallery, /assetOrigin: 'platform'/);
  assert.match(gallery, /setImages\(assetPurpose === PRINT_DESIGN_ASSET_PURPOSE \? \[\] : PLATFORM_GALLERY_ASSETS\)/);
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

test('Light-style routes keep Heavy Chain branding in the shared header', () => {
  const layout = fs.readFileSync('src/components/layout/Layout.tsx', 'utf8');
  assert.match(layout, /import \{ HeavyChainLogo \} from '\.\.\/icons';/);
  assert.match(layout, /<HeavyChainLogo height=\{28\} showText=\{false\}/);
  assert.match(layout, /HEAVY CHAIN/);
  assert.doesNotMatch(layout, /isLightchainRoute \? 'LIGHTCHAIN' : 'HEAVY CHAIN'/);
});
