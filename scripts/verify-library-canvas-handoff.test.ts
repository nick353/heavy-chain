import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lightchainUnifiedFeatureCatalog } from '../src/lib/lightchainUnifiedFeatureCatalog.ts';
import { buildLightchainLibraryFeatureHref } from '../src/lib/lightchainLibraryHandoff.ts';

const parityPages = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const libraryPage = await readFile(new URL('../src/pages/LightchainLibraryPage.tsx', import.meta.url), 'utf8');
const libraryHandoff = await readFile(new URL('../src/lib/lightchainLibraryHandoff.ts', import.meta.url), 'utf8');
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

test('Library Canvas hydration uses the readable remote-image path', () => {
  assert.match(canvasPage, /const loadLibraryCanvasImage = async/);
  assert.match(canvasPage, /const localResolution = await resolveLocalCanvasAsset\(source\)/);
  assert.match(canvasPage, /const resolvedSource = localResolution\?\.source \|\| await resolveGeneratedImageUrl\(source\)/);
  assert.match(canvasPage, /const response = await fetch\(resolvedSource\)/);
  assert.match(canvasPage, /const blob = await response\.blob\(\)/);
  assert.match(canvasPage, /const canonicalSource = getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(canvasPage, /const source = canonicalSource \|\| artifact\.imageUrl/);
  assert.match(canvasPage, /image = await loadLibraryCanvasImage\(source\)/);
  assert.match(canvasPage, /if \(!fallbackSource\) throw primaryError/);
  assert.match(canvasPage, /src: source,/);
});

test('Canvas accepts Gallery id-prefixed artifact keys without broadening the lookup scope', () => {
  assert.match(canvasPage, /const sourceArtifactParam = searchParams\.get\('sourceArtifactId'\)/);
  assert.match(canvasPage, /sourceArtifactParam\?\.startsWith\('id:'\)/);
  assert.match(canvasPage, /sourceArtifactParam\.slice\(3\)/);
  assert.match(canvasPage, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
});

test('Lightchain library exposes working upload and group controls', () => {
  assert.match(libraryPage, /saveWorkspaceArtifactBestEffort/);
  assert.match(libraryPage, /cloudflareDataPlane\.listGeneratedImages\(brandId, \{ limit: 100, offset: 0 \}\)/);
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

test('Lightchain library starts on the canonical history-upload group and uses the compact card action icon', () => {
  assert.match(libraryPage, /useState<string>\('履歴アップロード'\)/);
  assert.match(libraryPage, /aria-label="詳細"[\s\S]*<MoreVertical/);
});

test('Library selected-asset detail exposes the Light production actions', () => {
  assert.match(libraryPage, /handleDownloadSelected/);
  assert.match(libraryPage, /handleDeleteSelected/);
  assert.match(libraryPage, />戻る<\/button>/);
  assert.match(libraryPage, />コピーを作成します<\/button>/);
  assert.match(libraryPage, />ダウンロード<\/button>/);
  assert.match(libraryPage, />削除<\/button>/);
  assert.match(libraryPage, />名前を編集<\/button>/);
  assert.match(libraryPage, /data-testid="library-selected-asset-id"/);
  assert.match(libraryPage, /cardIdentity/);
  assert.match(libraryPage, /deleteGeneratedImage\(card\.asset\.remoteImageId\)/);
  assert.match(libraryPage, /downloadValidatedImage\(imageUrl/);
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
  assert.match(libraryPage, /buildLightchainLibraryFeatureHref/);
  assert.match(libraryPage, /data-testid="library-all-feature-handoff"/);
  assert.match(libraryPage, /data-testid="library-open-selected-feature"/);
  assert.match(libraryPage, /動画を除く\{lightchainUnifiedFeatureCatalog\.length\}機能/);
  assert.match(libraryHandoff, /feature\.id === 'ai-fitting' \|\| feature\.id === 'ai-fitting-reference'/);
  assert.match(libraryHandoff, /feature\.id === 'fabric-image'/);
  assert.match(libraryHandoff, /feature\.id === 'printing-image'/);
});

test('Library handoff preserves source lineage for all 31 non-video features', () => {
  assert.equal(lightchainUnifiedFeatureCatalog.length, 31);
  for (const feature of lightchainUnifiedFeatureCatalog) {
    const href = buildLightchainLibraryFeatureHref(feature, 'artifact-library-001');
    const url = new URL(href, 'https://heavy-chain.local');
    assert.equal(url.searchParams.get('libraryArtifactId'), 'artifact-library-001', feature.id);
    assert.equal(/video|動画/i.test(`${feature.id} ${feature.route}`), false, feature.id);
  }

  const fabric = new URL(
    buildLightchainLibraryFeatureHref(
      lightchainUnifiedFeatureCatalog.find((feature) => feature.id === 'fabric-image')!,
      'fabric-001',
    ),
    'https://heavy-chain.local',
  );
  assert.equal(fabric.pathname, '/tools/fabric');
  assert.equal(fabric.searchParams.get('librarySlot'), 'fabric-design');

  const printing = new URL(
    buildLightchainLibraryFeatureHref(
      lightchainUnifiedFeatureCatalog.find((feature) => feature.id === 'printing-image')!,
      'printing-001',
    ),
    'https://heavy-chain.local',
  );
  assert.equal(printing.pathname, '/tools/printing');
  assert.equal(printing.searchParams.get('librarySlot'), 'printing-design');
});

test('Generic Lightchain workbench restores a canonical Library artifact from the handoff query', () => {
  const workbench = readFileSync('src/pages/LightchainWorkbenchPage.tsx', 'utf8');
  assert.match(workbench, /searchParams\.get\('libraryArtifactId'\)/);
  assert.match(workbench, /listWorkspaceArtifacts\(currentBrand\.id, user\?\.id\)/);
  assert.match(workbench, /getWorkspaceArtifactCanonicalStoragePath\(artifact\.metadata\)/);
  assert.match(workbench, /setMaterialSlotFiles\(\{ primary: nextItem, secondary: null \}\)/);
  assert.match(workbench, /setResumeInputReadback\('restored'\)/);
});
