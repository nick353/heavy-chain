import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const parityPages = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const libraryPage = await readFile(new URL('../src/pages/LightchainLibraryPage.tsx', import.meta.url), 'utf8');
const canvasPage = await readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8');
const fittingPage = await readFile(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');

test('library persisted artifacts can be routed to Canvas with source identity', () => {
  assert.match(parityPages, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(parityPages, /sourceArtifactId=\$\{encodeURIComponent\(asset\.id\)\}/);
  assert.match(canvasPage, /searchParams\.get\('sourceArtifactId'\)/);
  assert.match(canvasPage, /getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(canvasPage, /feature: 'library-import'/);
  assert.match(canvasPage, /sourceArtifactId: artifact\.id/);
  assert.match(canvasPage, /toast\.success\('ライブラリー素材をCanvasへ追加しました'\)/);
});

test('Lightchain library exposes working upload and group controls', () => {
  assert.match(libraryPage, /saveWorkspaceArtifactBestEffort/);
  assert.match(libraryPage, /from\('generated_images'\)/);
  assert.match(libraryPage, /withSignedImageUrls/);
  assert.match(libraryPage, /const canonicalStoragePath = getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(libraryPage, /signedArtifacts\[index\]\?\.image_url \|\| \(canonicalStoragePath \? '' : artifact\.imageUrl\)/);
  assert.match(libraryPage, /ライブラリーに登録/);
  assert.match(libraryPage, /AIフィッティングへ/);
  assert.match(libraryPage, /生地イメージへ/);
  assert.match(libraryPage, /プリント画像へ/);
  assert.match(libraryPage, /type LibraryFeatureDestination =/);
  assert.match(libraryPage, /kind: 'feature'; featureId: string/);
  assert.match(libraryPage, /remoteImageId/);
  assert.match(libraryPage, /isVideoGeneratedImage/);
  assert.match(libraryPage, /libraryArtifactId/);
  assert.match(libraryPage, /featureType: 'lightchain-library-upload'/);
  assert.match(libraryPage, /librarySource: 'upload'/);
  assert.match(libraryPage, /新規グループ作成/);
  assert.match(libraryPage, /localStorage\.setItem\(groupsKey/);
  assert.doesNotMatch(libraryPage, /title="素材の登録は各ワークベンチから行います"/);
  assert.doesNotMatch(libraryPage, /disabled title="グループ管理はβ版で準備中"/);
  assert.match(fittingPage, /libraryArtifactId/);
  assert.match(fittingPage, /getWorkspaceArtifactCanonicalStoragePath/);
});

test('Library handoff restores a canonical asset into the fabric or print workbench', () => {
  const materialWorkbench = readFileSync('src/pages/LightchainMaterialWorkbenchPage.tsx', 'utf8');

  assert.match(materialWorkbench, /librarySlot/);
  assert.match(materialWorkbench, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(materialWorkbench, /resolveGeneratedImageUrl\(sourceStoragePath\)/);
  assert.match(materialWorkbench, /libraryHandoff\.slot === 'printing-design'/);
  assert.match(materialWorkbench, /addDesigns\(\[selectedImage\]\)/);
  assert.match(materialWorkbench, /selectPrintGarment\(selectedImage\)/);
  assert.match(materialWorkbench, /setFabricDesign\(selectedImage\)/);
  assert.match(materialWorkbench, /libraryHandoff\.artifactId \|\| !isAuthInitialized/);
});

test('Library exposes every non-video feature as a material handoff target', () => {
  assert.match(libraryPage, /lightchainUnifiedFeatureCatalog/);
  assert.match(libraryPage, /buildLibraryFeatureHref/);
  assert.match(libraryPage, /data-testid="library-all-feature-handoff"/);
  assert.match(libraryPage, /data-testid="library-open-selected-feature"/);
  assert.match(libraryPage, /動画を除く\{lightchainUnifiedFeatureCatalog\.length\}機能/);
  assert.match(libraryPage, /feature\.id === 'ai-fitting' \|\| feature\.id === 'ai-fitting-reference'/);
  assert.match(libraryPage, /feature\.id === 'fabric-image'/);
  assert.match(libraryPage, /feature\.id === 'printing-image'/);
});

test('Generic Lightchain workbench restores a canonical Library artifact from the handoff query', () => {
  const workbench = readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  assert.match(workbench, /searchParams\.get\('libraryArtifactId'\)/);
  assert.match(workbench, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(workbench, /getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(workbench, /setMaterialSlotFiles\(\{ primary: nextItem, secondary: null \}\)/);
  assert.match(workbench, /setResumeInputReadback\('restored'\)/);
});
