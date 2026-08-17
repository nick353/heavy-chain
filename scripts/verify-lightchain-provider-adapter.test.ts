import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLightchainProviderPrompt, getLightchainProviderRoute } from '../src/features/lightchain/providerAdapter.ts';
import {
  invertGarmentAlphaToProviderMaskRgba,
  resolveContainedImagePlacement,
} from '../src/features/lightchain/providerMask.ts';
import { buildPortraitGarmentPriorAlpha } from '../src/features/lightchain/portraitGarmentMask.ts';
import { validateLegalSafetyInput } from '../src/lib/legalSafetyGuard.ts';

test('routes material and print tools through the multi-image edit provider', () => {
  assert.equal(getLightchainProviderRoute('fabric-image'), 'edit-image');
  assert.equal(getLightchainProviderRoute('printing-image'), 'edit-image');
  assert.equal(getLightchainProviderRoute('line-to-real'), 'edit-image');
});

test('routes model tools through the persisted model matrix contract', () => {
  assert.equal(getLightchainProviderRoute('ai-fitting'), 'model-matrix');
  assert.equal(getLightchainProviderRoute('model-change'), 'model-matrix');
  assert.equal(getLightchainProviderRoute('model-library'), 'model-matrix');
});

test('keeps video routes blocked until a real video provider is admitted', () => {
  assert.equal(getLightchainProviderRoute('video-workstation'), 'unsupported');
  assert.equal(getLightchainProviderRoute('video-detail'), 'unsupported');
});

test('fails closed for an unregistered feature instead of using generic image generation', () => {
  assert.equal(getLightchainProviderRoute('future-unregistered-feature'), 'unsupported');
});

test('builds source-preserving material prompt with both input roles', () => {
  const prompt = buildLightchainProviderPrompt({
    toolId: 'fabric-image',
    toolTitle: '生地イメージ',
    summary: 'モデル.png / 生地.png / 画像比率自動',
    primaryName: 'モデル.png',
    secondaryName: '生地.png',
  });
  assert.match(prompt, /textile material/);
  assert.match(prompt, /モデル\.png/);
  assert.match(prompt, /生地\.png/);
  assert.match(prompt, /Use the first uploaded reference/);
  assert.match(prompt, /same person, face, hair/);
  assert.match(prompt, /opaque mask pixel as locked/);
  assert.doesNotMatch(prompt, /third-party logo/i);
});

test('uses an explicit brief-only input contract when a workspace has no authoritative source image', () => {
  const prompt = buildLightchainProviderPrompt({
    toolId: 'marketing-detail',
    toolTitle: 'マーケティング詳細',
    summary: 'AIアシスタント / 商品ビジュアル',
    brief: 'EC向けの新しい商品ビジュアル',
    briefOnly: true,
  });
  assert.match(prompt, /brief-only workflow/);
  assert.match(prompt, /no required source image/);
  assert.doesNotMatch(prompt, /masked in-place edit/);
  assert.doesNotMatch(prompt, /exact same person/);
});

test('does not apply the garment-mask lock to model-matrix subfeatures', () => {
  const prompt = buildLightchainProviderPrompt({
    toolId: 'model-face',
    toolTitle: '顔変更',
    summary: '顔の参考図: face.png',
    primaryName: 'model.png',
    secondaryName: 'face.png',
  });
  assert.match(prompt, /Change only the model's face/);
  assert.match(prompt, /model-matrix operation/);
  assert.doesNotMatch(prompt, /opaque mask pixel as locked/);
  assert.doesNotMatch(prompt, /same person, face, hair/);
});

test('keeps model subfeatures scoped to their requested attribute', () => {
  const prompt = buildLightchainProviderPrompt({
    toolId: 'background-change',
    toolTitle: '背景',
    summary: '背景: Concrete Gallery',
    primaryName: 'model.png',
    secondaryName: 'background.png',
  });
  assert.match(prompt, /Change only the background/);
  assert.match(prompt, /Preserve the model identity, face, garment, pose/);
});

test('does not self-trigger likeness safety validation from provider guardrails', () => {
  const prompt = buildLightchainProviderPrompt({
    toolId: 'fabric-image',
    toolTitle: '生地イメージ',
    summary: 'モデル画像へ生地の質感を反映',
    primaryName: 'モデル.png',
    secondaryName: '生地.png',
  });
  assert.deepEqual(validateLegalSafetyInput([prompt]), { blocked: false, reasons: [] });
});

test('inverts garment alpha into an exact transparent-edit provider mask', () => {
  const garmentRgba = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 0,
    70, 80, 90, 128,
    1, 2, 3, 64,
  ]);
  const result = invertGarmentAlphaToProviderMaskRgba(garmentRgba);
  assert.equal(result.totalPixels, 4);
  assert.equal(result.editablePixels, 2);
  assert.deepEqual(Array.from(result.rgba), [
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 127,
    255, 255, 255, 191,
  ]);
});

test('contains the source frame without shifting the protected subject', () => {
  const placement = resolveContainedImagePlacement({
    sourceWidth: 136,
    sourceHeight: 240,
    outputWidth: 1024,
    outputHeight: 1536,
  });
  assert.equal(placement.height, 1536);
  assert.ok(Math.abs(placement.width - 870.4) < 1e-9);
  assert.ok(Math.abs(placement.x - 76.8) < 1e-9);
  assert.equal(placement.y, 0);
});

test('builds a conservative lower-garment prior only when chromatic garment evidence is present', () => {
  const width = 80;
  const height = 160;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 245;
    rgba[offset + 1] = 245;
    rgba[offset + 2] = 245;
    rgba[offset + 3] = 255;
  }
  for (let y = 60; y < 132; y += 1) {
    for (let x = 25; x < 56; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = 180;
      rgba[offset + 1] = 48;
      rgba[offset + 2] = 62;
    }
  }
  const prior = buildPortraitGarmentPriorAlpha({ rgba, width, height });
  assert.ok(prior);
  assert.ok(prior.startY >= Math.floor(height * 0.3));
  assert.ok(prior.endY <= Math.floor(height * 0.92));
  assert.ok(prior.coveragePercent > 8 && prior.coveragePercent < 72);
  assert.equal(prior.alpha[(20 * width + 40) * 4 + 3], 0);
  assert.ok(prior.alpha[(100 * width + 40) * 4 + 3] > 200);
  assert.equal(buildPortraitGarmentPriorAlpha({ rgba: new Uint8ClampedArray(width * height * 4), width, height }), null);
});

test('keeps the multi-image contract and provider provenance across client and edge layers', () => {
  const imageApi = readFileSync(new URL('../src/lib/imageApi.ts', import.meta.url), 'utf8');
  const editImage = readFileSync(new URL('../supabase/functions/edit-image/index.ts', import.meta.url), 'utf8');
  const openAiImage = readFileSync(new URL('../supabase/functions/_shared/openaiImage.ts', import.meta.url), 'utf8');
  assert.match(imageApi, /referenceImageUrls/);
  assert.match(imageApi, /imageUrls: inputImages/);
  assert.match(imageApi, /providerModel/);
  assert.match(imageApi, /inputFidelity/);
  assert.match(imageApi, /quality/);
  assert.match(editImage, /normalizeEditImageInputs/);
  assert.match(editImage, /images: editInputImages\.map/);
  assert.match(editImage, /inputImageCount/);
  assert.match(editImage, /provider: 'openai'/);
  assert.match(editImage, /gpt-image-1/);
  assert.match(editImage, /resolveLightchainImageEditOptions/);
  assert.match(openAiImage, /input_fidelity/);
  assert.match(openAiImage, /formData\.set\('quality'/);
});

test('binds the live material routes to provider generation and durable result actions', () => {
  const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const marketingPage = readFileSync(new URL('../src/pages/MarketingWorkspacePage.tsx', import.meta.url), 'utf8');
  const generatePage = readFileSync(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8');
  const localArtifacts = readFileSync(new URL('../src/lib/localWorkspaceArtifacts.ts', import.meta.url), 'utf8');
  const materialPage = readFileSync(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  const galleryPage = readFileSync(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');
  const imageDownload = readFileSync(new URL('../src/lib/imageDownload.ts', import.meta.url), 'utf8');
  assert.match(workbench, /data-testid="lightchain-result-download"/);
  assert.match(workbench, /data-testid="marketing-detail-result-download"/);
  assert.match(workbench, /downloadValidatedImage/);
  assert.doesNotMatch(workbench, /const response = await fetch\(lightchainResult\.imageUrl\)/);
  assert.match(imageDownload, /response\.ok/);
  assert.match(imageDownload, /blob\.size <= 0/);
  assert.match(imageDownload, /startsWith\('image\//);
  assert.match(materialPage, /downloadValidatedImage/);
  assert.doesNotMatch(materialPage, /href=\{result\.imageUrl\}/);
  assert.match(materialPage, /data-testid="selected-print-result-download"/);
  const canvasPage = readFileSync(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
  assert.match(canvasPage, /downloadValidatedImage/);
  assert.doesNotMatch(canvasPage, /const response = await fetch\(imageSrc\)/);
  assert.match(generatePage, /downloadValidatedImage/);
  assert.doesNotMatch(generatePage, /const response = await fetch\(imageUrl\)/);
  assert.match(generatePage, /downloadResults\.filter\(Boolean\)\.length/);
  assert.match(galleryPage, /downloadResults\.filter\(Boolean\)\.length/);
  assert.match(workbench, /sourceJobId: lightchainResult\?\.jobId \?\? undefined/);
  assert.match(workbench, /!artifact\.remote && !artifact\.localPersisted/);
  assert.match(marketingPage, /!result\.remote && !result\.localPersisted/);
  assert.match(generatePage, /saveWorkspaceArtifactPersisted/);
  assert.match(generatePage, /!persisted\.ok/);
  assert.match(generatePage, /workspace_artifact_persistence_unverified/);
  assert.match(localArtifacts, /findWorkspaceArtifactPersisted\(artifact\.brandId, artifact\.id/);
  assert.match(localArtifacts, /localPersisted/);
  assert.match(materialPage, /editImageWithPrompt/);
  assert.match(materialPage, /data-testid="lightchain-material-rights-confirmation"/);
  assert.match(materialPage, /resultKind: 'provider'/);
  assert.match(materialPage, /saveWorkspaceArtifactPersisted/);
  assert.match(materialPage, /data-testid=\{`result-save-to-canvas-\$\{result\.id\}`\}/);
  assert.match(galleryPage, /gallery_image_url_unavailable/);
  assert.match(galleryPage, /downloadValidatedImage\(/);
  assert.match(imageDownload, /errorPrefix\}_not_image/);
});

test('keeps flat textile swatches usable when garment cutout is not applicable', () => {
  const materialPage = readFileSync(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(materialPage, /flat pattern swatch rather than a/);
  assert.match(materialPage, /return imageUrl;/);
  assert.doesNotMatch(materialPage, /throw new Error\('生地画像の背景を分離できませんでした/);
});

test('keeps preview fallback optional while provider generation fails closed without a mask', () => {
  const materialPage = readFileSync(new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(materialPage, /Fabric local try-on preview unavailable; keeping the uploaded model visible/);
  assert.match(materialPage, /modelGarmentMaskResult: null, previewUrl: fabricDesign\.url/);
  assert.match(materialPage, /provider_garment_mask_required/);
  assert.match(materialPage, /buildProviderGarmentEditMask/);
  assert.match(materialPage, /buildWhiteBackgroundGarmentCutoutDataUrl/);
  assert.match(materialPage, /buildPortraitGarmentPriorCutoutDataUrl/);
  assert.match(materialPage, /browser-local-portrait-garment-prior-v1/);
  assert.match(materialPage, /isPrintGarmentClothModelConfigured/);
  assert.match(materialPage, /deterministicError/);
  assert.match(materialPage, /semanticError/);
  assert.match(materialPage, /maskApplied: true/);
  assert.match(materialPage, /providerModel: 'gpt-image-1'/);
  assert.match(materialPage, /inputFidelity: 'high'/);
  assert.match(materialPage, /quality: 'high'/);
  assert.match(materialPage, /composeProviderProtectedResult/);
  assert.match(materialPage, /protectedRegionComposited: true/);
  assert.match(materialPage, /setFabricPreviewState\('done'\)/);
});
