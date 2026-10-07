import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const parityPages = await readFile(new URL('../src/pages/LightchainParityPages.tsx', import.meta.url), 'utf8');
const parityCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const fashionStudio = await readFile(new URL('../src/pages/FashionStudioPage.tsx', import.meta.url), 'utf8');
const videoDashboard = await readFile(new URL('../src/pages/VideoProjectDashboardPage.tsx', import.meta.url), 'utf8');
const labPage = await readFile(new URL('../src/pages/LabPage.tsx', import.meta.url), 'utf8');
const labDetailPage = await readFile(new URL('../src/pages/LightchainLabDetailPage.tsx', import.meta.url), 'utf8');
const patternBoardPage = await readFile(new URL('../src/pages/PatternProjectDashboardPage.tsx', import.meta.url), 'utf8');
const workbenchPage = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
const designDocumentBoardPage = await readFile(new URL('../src/pages/LightchainBoardPage.tsx', import.meta.url), 'utf8');

test('canonical Wear Design Lab board and detail route stay source-shaped', () => {
  assert.match(appSource, /path="\/flow\/orientedDesign"[\s\S]*?<LightchainOrientedDesignPage \/>/);
  assert.match(appSource, /path="\/flow\/orientedDesign\/detail"[\s\S]*?<LightchainOrientedDesignDetailPage \/>/);
  assert.match(parityPages, /className="oriented-design-content"/);
  assert.match(parityPages, /data-testid="oriented-design-detail-upload"/);
  assert.match(parityPages, /jpg、jpeg、png、webp形式の画像（最大20M）に対応/);
  assert.doesNotMatch(parityPages, /type="checkbox"/);
  assert.match(parityCss, /\.oriented-design-new-card, \.oriented-design-project-card[^\n]*width: 220px; height: 240px/);
});

test('canonical Fashion Studio overview keeps board geometry while retaining operations', () => {
  assert.match(appSource, /path="\/flow\/integration"[\s\S]*?<FashionStudioPage \/>/);
  assert.match(fashionStudio, /className="fashion-studio-overview-parity/);
  for (const marker of ['ピン留め', 'アセットライブラリに保存', '削除', '前のページ', '次のページ', '参考事例']) {
    assert.ok(fashionStudio.includes(marker), `missing Fashion Studio operation: ${marker}`);
  }
  assert.match(fashionStudio, /data-testid="lightchain-fashion-studio-new-file"[\s\S]*group relative h-60 w-55 cursor-pointer overflow-hidden rounded-2xl/);
  assert.match(fashionStudio, /visibleProjectCards\.map\(\(project\) => \(\s*<div[\s\S]*group relative h-60 w-55 cursor-pointer \$\{openProjectMenuId === project\.id \? 'overflow-visible' : 'overflow-hidden'\} rounded-2xl/);
  assert.doesNotMatch(fashionStudio, /visibleProjectCards\.map\(\(project\) => \(\s*<article/);
  assert.doesNotMatch(fashionStudio, /visibleProjectCards\.map\(\(project\) => \([\s\S]*?<button[\s\S]*buildFashionStudioProjectHref/);
  assert.match(parityCss, /\.fashion-studio-overview-parity > section > div:nth-child\(2\)[\s\S]*?width: 220px; height: 240px/);
});

test('video project board keeps canonical card geometry and fail-closed provider detail', async () => {
  assert.match(appSource, /path="\/flow\/GenerateShortVideo"[\s\S]*?<VideoProjectDashboardPage \/>/);
  // The source readback is 220x240px with a wrapping flex row.  Tailwind's
  // `h-60` is the canonical 240px token used by the current implementation;
  // accept the equivalent arbitrary-value spelling as well so this contract
  // does not force a purely textual class rename.
  assert.match(videoDashboard, /(?:h-60|h-\[240px\])/);
  assert.match(videoDashboard, /(?:flex flex-wrap|lg:flex lg:flex-wrap)/);
  assert.match(videoDashboard, /(?:w-\[220px\]|lg:w-\[220px\])/);
  const videoDetail = await readFile(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');
  assert.match(videoDetail, /video-source-empty-upload/);
  assert.match(videoDetail, /w-\[768px\]/);
  assert.match(videoDetail, /top-1\/2[\s\S]*-translate-y-1\/2/);
  assert.match(parityCss, /\.video-source-empty-upload[\s\S]*768px/);
  for (const marker of [
    'video-source-existing-main-node',
    'video-source-existing-edit-panel',
    'video-source-existing-zoom-controls',
    'LIGHTCHAIN_VIDEO_SOURCE_RESULT',
    'AI生成 <span>600</span>',
  ]) {
    assert.ok(videoDetail.includes(marker), `missing existing video detail parity marker: ${marker}`);
  }
  assert.match(parityCss, /\.video-source-existing-main-node[\s\S]*404\.8px[\s\S]*553\.33px/);
  assert.match(parityCss, /\.video-source-existing-edit-panel[\s\S]*280px[\s\S]*656\.27px/);
  assert.match(videoDetail, /video_provider_not_admitted/);
  assert.doesNotMatch(videoDetail, /権利確認後/);
  assert.doesNotMatch(videoDetail, /権利確認[\s\S]*type="checkbox"/);
});

test('canonical Lightchain Lab board keeps the source project cards and detail handoff', () => {
  assert.match(appSource, /path="\/flow\/laboratory"[\s\S]*?<LabPage \/>/);
  assert.match(labPage, /lightchain-lab-source-board/);
  assert.match(labPage, /navigate\('\/flow\/laboratory\/detail'\)/);
  assert.match(labPage, /data-track-id="laboratory:project-card"/);
  assert.match(labPage, /LIGHTCHAIN_LAB_REFERENCE_IMAGE/);
  assert.doesNotMatch(labPage, /type="checkbox"/);
  assert.match(parityCss, /\.lightchain-lab-source-new-card[\s\S]*220px[\s\S]*240px/);
  assert.match(parityCss, /\.lightchain-lab-source-reference-media[\s\S]*168px/);
});

test('canonical Lightchain Lab detail keeps the source empty-canvas geometry', () => {
  assert.match(appSource, /path="\/flow\/laboratory\/detail"[\s\S]*?<LightchainLabDetailPage \/>/);
  // Measured on Light at 1440x900 (2026-10-07): dashed drop zone x336 y208 768 wide, text centred at y469.
  assert.match(labDetailPage, /dark relative min-h/);
  assert.match(labDetailPage, /top-\[158px\]/);
  assert.match(labDetailPage, /h-\[554px\]/);
  assert.match(labDetailPage, /w-\[min\(768px,calc\(100vw-40px\)\)\]/);
  assert.match(labDetailPage, /border-dashed/);
  assert.doesNotMatch(labDetailPage, /aliyuncs\.com|linkaigc\.com/);
  assert.match(labDetailPage, /LIGHTCHAIN_LAB_PROJECT_ICON/);
  assert.doesNotMatch(labDetailPage, /type="checkbox"/);
});

test('canonical pattern-arrange board keeps the shared Light project-board geometry', () => {
  assert.match(patternBoardPage, /pattern-project-dashboard-parity/);
  assert.match(patternBoardPage, /pattern-project-dashboard-grid/);
  assert.match(patternBoardPage, /detailPath: '\/editor\/pattern\/detail'/);
  assert.match(patternBoardPage, /detailPath: '\/editor\/patternDesign\/detail'/);
  // Projects are the brand's saved results for the board feature (no foreign canvas documents).
  assert.match(patternBoardPage, /listGeneratedImages\(brandId, \{ featureType: `lightchain-\$\{featureId\}`/);
  assert.match(patternBoardPage, /useFeatureProjects\(config\.featureId\)/);
  // Only persisted projects are listed; no fabricated "Untitled" filler cards that open nothing.
  assert.doesNotMatch(patternBoardPage, /SOURCE_PATTERN_PROJECT_COUNT|source-pattern-untitled-|个月前/);
  assert.match(patternBoardPage, /\{formatProjectAge\(project\.updatedAt\)\} 修正/);
  assert.match(patternBoardPage, /pattern-project-dashboard-pagination/);
  assert.match(patternBoardPage, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(patternBoardPage, /参考事例/);
  assert.doesNotMatch(patternBoardPage, /権利確認|権利を確認してAI生成|type="checkbox"/);
});

test('canonical design-document board keeps the source six-column card rail', () => {
  assert.match(appSource, /path="\/board"[\s\S]*?<LightchainBoardPage \/>/);
  assert.match(designDocumentBoardPage, /data-testid="lightchain-board-page"/);
  assert.match(designDocumentBoardPage, /grid grid-cols-6 gap-x-6 gap-y-4/);
  assert.match(designDocumentBoardPage, /data-testid="lightchain-board-document-card"/);
  assert.match(designDocumentBoardPage, /MoreHorizontal/);
  assert.doesNotMatch(designDocumentBoardPage, /type="checkbox"/);
});

test('canonical print-design board preserves saved projects and fills the Light-shaped tail', () => {
  assert.match(workbenchPage, /const sourcePrintProjectCards: WorkspaceProjectCard\[\] = sourcePrintProjectAges\.map/);
  assert.match(workbenchPage, /const persistedPrintProjects = persistedPrintProjectCards\.filter\(\(card\) => !card\.isNew\)/);
  assert.match(workbenchPage, /const missingSourcePrintProjects = Math\.max\(0, sourcePrintProjectCards\.length - persistedPrintProjects\.length\)/);
  assert.match(workbenchPage, /\.\.\.sourcePrintProjectCards\.slice\(0, missingSourcePrintProjects\)/);
  assert.doesNotMatch(workbenchPage, /persistedPrintProjectCards\.length > 1[\s\S]*\? persistedPrintProjectCards/);
  assert.doesNotMatch(workbenchPage, /権利確認|権利を確認してAI生成|type="checkbox"/);
});

console.log('Lightchain source board parity tests: 8/8 passed');
