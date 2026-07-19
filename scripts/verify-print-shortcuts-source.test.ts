import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('printing workbench keeps gallery/upload and shares garment reset logic with bundled blank garment', async () => {
  const source = await read('../src/pages/LightchainMaterialWorkbenchPage.tsx');
  assert.match(source, /data-testid="use-trusted-blank-garment"/);
  assert.match(source, /無地Tシャツを使う（推奨）/);
  assert.match(source, /onChange=\{selectPrintGarment\}/);
  assert.match(source, /selectPrintGarment\(createTrustedBlankGarmentSelection\(\)\)/);
  assert.match(source, /galleryTitle="参考画像を選択"/);
});

test('Patterns result cards expose a guarded print handoff and the printing page consumes it once', async () => {
  const [generateSource, printSource] = await Promise.all([
    read('../src/pages/GeneratePage.tsx'),
    read('../src/pages/LightchainMaterialWorkbenchPage.tsx'),
  ]);
  assert.match(generateSource, /selectedFeature\.id === 'design-gacha'/);
  assert.match(generateSource, /isPrintEligibleDesignGachaResult\(image\)/);
  assert.match(generateSource, /isTrustedPatternsResultProvenance\(image\.printDesignProvenance\)/);
  assert.match(generateSource, /resultProvenance: image\.printDesignProvenance/);
  assert.match(generateSource, /startedProvenance: startedPrintDesignProvenance/);
  assert.match(generateSource, /currentFeatureId: currentGenerationContextRef\.current\.featureId/);
  assert.match(generateSource, /currentGenerationContextRef\.current = \{\s*featureId: renderedFeatureId,\s*sourceReadback,\s*\}/);
  assert.match(generateSource, /const stampGeneratedImagesForCurrentContext = \(images: GeneratedResult\[\]\)/);
  assert.match(generateSource, /generationLane: geminiGenerationMode\s*\? 'hosted-gemini'\s*: localRunwayWorkerMode \|\| generationProvider === 'planning'\s*\? undefined\s*: 'edge-design-gacha'/);
  assert.match(generateSource, /image\.artifactKind === 'planning_brief'/);
  assert.match(generateSource, /const \{ printDesignProvenance: _untrustedProvenance, \.\.\.unstampedImage \} = image/);
  assert.match(generateSource, /const stampedImages = stampGeneratedImagesForCurrentContext\(images\);\s*newGeneratedImages = stampedImages;\s*setGeneratedImages\(stampedImages\)/);
  assert.match(generateSource, /const stampedImages = stampGeneratedImagesForCurrentContext\(images\);\s*newGeneratedImages = stampedImages;\s*setGeneratedImages\(prev => \[\.\.\.stampedImages, \.\.\.prev\]\)/);
  assert.match(generateSource, /replaceGeneratedImages\(geminiResults\)/);
  assert.match(generateSource, /const materializedDesignGachaResults = await Promise\.all/);
  assert.match(generateSource, /replaceGeneratedImages\(materializedDesignGachaResults\)/);
  assert.match(generateSource, /setGeneratedImages\(\(prev\) => \[\.\.\.importedResults, \.\.\.prev\]\)/);
  assert.match(generateSource, /Boolean\(image\.jobId\)/);
  assert.match(generateSource, /Boolean\(image\.imageId \|\| image\.storagePath\)/);
  assert.match(generateSource, /image\.imageUrl\.startsWith\('https:\/\/'\)/);
  assert.match(generateSource, /data-testid="design-gacha-use-in-print"/);
  assert.equal((generateSource.match(/data-testid="design-gacha-use-in-print"/g) || []).length, 1);
  assert.match(generateSource, /relative z-30 border-t border-cyan-200\/20/);
  assert.match(generateSource, /type="button"\s*onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*handleUseDesignGachaResultInPrinting\(image\)/);
  assert.match(generateSource, /if \(!prepareDesignGachaResultForPrinting\(image\)\) return;\s*navigate\('\/lightchain\/printing-image\?handoff=patterns'\)/);
  assert.match(generateSource, /pointer-events-none absolute inset-0 z-10/);
  assert.match(generateSource, /pointer-events-auto absolute bottom-0/);
  assert.doesNotMatch(generateSource, /to="\/lightchain\/printing-image\?handoff=patterns"/);
  assert.match(generateSource, /writePrintDesignHandoff\(window\.sessionStorage/);
  assert.match(printSource, /consumePrintDesignHandoff\(window\.sessionStorage, currentBrand\.id\)/);
  assert.match(printSource, /referenceType: 'pattern'/);
  assert.match(printSource, /void addDesigns\(\[\.\.\.printDesigns, importedDesign\]\)/);
});

test('bundled blank garment is a visible, decoration-free product-owned asset', async () => {
  const source = await read('../public/assets/printing/blank-white-tshirt.svg');
  assert.match(source, /無地の白いTシャツ/);
  assert.match(source, /装飾のない白いTシャツ/);
  assert.doesNotMatch(source, /<image\b/);
});
