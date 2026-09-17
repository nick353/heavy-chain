import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const catalogPath = new URL('../src/lib/lightchainParityCatalog.ts', import.meta.url);
const entryPath = new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url);
const materialWorkbenchPath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const workbenchPath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const landingPath = new URL('../src/pages/LandingPage.tsx', import.meta.url);
const parityPagesPath = new URL('../src/pages/LightchainParityPages.tsx', import.meta.url);
const appPath = new URL('../src/App.tsx', import.meta.url);

test('routes both workbench recommendation tabs to the valid launcher category', async () => {
  const sources = await Promise.all([
    readFile(materialWorkbenchPath, 'utf8'),
    readFile(workbenchPath, 'utf8'),
  ]);
  for (const source of sources) {
    assert.match(source, /\{ label: 'おすすめ', category: 'recommended', to: '\/lightchain\?category=recommended' \}/);
    assert.doesNotMatch(source, /\{ label: 'おすすめ', to: '\/lightchain\?category=home' \}/);
  }
});

test('keeps fabric try-on in the visible graphics category', async () => {
  const source = await readFile(catalogPath, 'utf8');
  const featureStart = source.indexOf("id: 'fabric-simulation'");
  assert.notEqual(featureStart, -1, 'fabric-simulation catalog entry is required');
  const featureEnd = source.indexOf("id: 'lineart-to-real'", featureStart);
  const feature = source.slice(featureStart, featureEnd === -1 ? source.length : featureEnd);
  assert.match(feature, /category: 'graphics'/);
  assert.match(feature, /route: '(?:\/tools\/fabric|\/lightchain\/fabric-image)'/);
});

test('keeps print-image try-on beside fabric simulation in graphics', async () => {
  const source = await readFile(catalogPath, 'utf8');
  const featureStart = source.indexOf("id: 'printing-image'");
  assert.notEqual(featureStart, -1, 'printing-image catalog entry is required');
  const featureEnd = source.indexOf("id: 'lineart-to-real'", featureStart);
  const feature = source.slice(featureStart, featureEnd === -1 ? source.length : featureEnd);
  assert.match(feature, /category: 'graphics'/);
  assert.match(feature, /route: '(?:\/tools\/printing|\/lightchain\/printing-image)'/);
});

test('maps the canonical printing entry to the Light visual parity page', async () => {
  const source = await readFile(appPath, 'utf8');
  const routeStart = source.indexOf('path="/printing"');
  const routeEnd = source.indexOf('path="/editor/pattern"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'canonical printing route is required');
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /lazyPage\(\s*\n?\s*<LightchainUnifiedWorkspaceShell>\s*\n?\s*<LightchainPrintingPage \/>/);
  assert.doesNotMatch(route, /<LightchainWorkbenchPage \/>/);
});

test('maps vector-special to the Light legacy parity surface', async () => {
  const app = await readFile(appPath, 'utf8');
  const routeStart = app.indexOf('path="/tools/vector-special"');
  const routeEnd = app.indexOf('path="/tools/reactor"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'vector-special route is required');
  const route = app.slice(routeStart, routeEnd);
  assert.match(route, /LightchainVectorSpecialPage/);
  assert.doesNotMatch(route, /LightchainWorkbenchPage/);
  const page = await readFile(parityPagesPath, 'utf8');
  assert.match(page, /この機能はまもなく終了します/);
  assert.match(page, /今すぐ体験/);
  assert.match(page, /参考画像をアップロードしてください/);
  assert.match(page, /生成履歴/);
});

test('maps the Light design-arrange entry to a project dashboard before editing', async () => {
  const source = await readFile(appPath, 'utf8');
  const routeStart = source.indexOf('path="/editor/pattern"');
  const routeEnd = source.indexOf('path="/editor/patternDesign"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'design-arrange route is required');
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /PatternProjectDashboardPage/);
  const page = await readFile(new URL('../src/pages/PatternProjectDashboardPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /デザインアレンジ/);
  assert.match(page, /新規ファイル/);
  assert.match(page, /参考事例/);
  assert.match(page, /editor\/pattern\/detail\?boardProjectCode=&boardProjectType=/);
  assert.match(page, /navigate\(`\/editor\/pattern\/detail\?boardProjectCode=/);
  assert.match(page, /boardProjectType=custom/);
});

test('keeps the canonical printing surface aligned with the Light empty state', async () => {
  const source = await readFile(parityPagesPath, 'utf8');
  const pageStart = source.indexOf('export function LightchainPrintingPage()');
  const pageEnd = source.indexOf('const modelTabs =', pageStart);
  assert.ok(pageStart >= 0 && pageEnd > pageStart, 'printing parity page is required');
  const page = source.slice(pageStart, pageEnd);
  assert.match(page, /window\.location\.pathname === '\/printing'/);
  assert.match(page, /AIグラフィックデザイン/);
  assert.match(page, /AIでグラフィックを作成/);
  assert.match(page, /画像をアップロードします/);
  assert.match(page, /画像を2枚までアップロードできます/);
  assert.match(page, /生成履歴/);
  assert.match(page, /handleCanonicalFiles/);
  assert.match(page, /navigate\('\/lightchain\/printing-image'\)/);
});

test('routes fabric search prompts to the simulation entry', async () => {
  const source = await readFile(entryPath, 'utf8');
  const catalog = await readFile(catalogPath, 'utf8');
  const app = await readFile(appPath, 'utf8');
  assert.match(source, /keywords: \['生地', 'fabric', '布'\], featureId: 'fabric-simulation'/);
  assert.match(source, /keywords: \['プリント', 'print image', 'print design'\], featureId: 'printing-image'/);
  assert.ok(
    source.indexOf("featureId: 'printing-image'") < source.indexOf("featureId: 'graphic-design'"),
    'print prompts must be classified before generic graphic prompts',
  );
  assert.ok(
    source.indexOf("featureId: 'printing-image'") < source.indexOf("featureId: 'canvas-editing'"),
    'print prompts must be classified before generic editing prompts',
  );
  assert.match(catalog, /id: 'fabric-simulation',[\s\S]*?route: '\/tools\/fabric'/);
  assert.match(catalog, /id: 'printing-image',[\s\S]*?route: '\/tools\/printing'/);
  assert.match(app, /path="\/lightchain\/fabric-image"/);
  assert.match(app, /path="\/lightchain\/printing-image"/);
});

test('routes the custom-style launcher card to the current Lightchain style route', async () => {
  const source = await readFile(catalogPath, 'utf8');
  const featureStart = source.indexOf("id: 'custom-style'");
  assert.notEqual(featureStart, -1, 'custom-style catalog entry is required');
  const featureEnd = source.indexOf("id: 'model-change-background'", featureStart);
  const feature = source.slice(featureStart, featureEnd === -1 ? source.length : featureEnd);
  assert.match(feature, /route: '\/model-base\/style'/);
  assert.doesNotMatch(feature, /route: '\/brand\/settings'/);
});

test('keeps the case-sharing search control functional', async () => {
  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /const \[gallerySearchOpen, setGallerySearchOpen\] = useState\(false\)/);
  assert.match(source, /const \[galleryQuery, setGalleryQuery\] = useState\(''\)/);
  assert.match(source, /const \[gallerySearchTerm, setGallerySearchTerm\] = useState\(''\)/);
  assert.match(source, /const filteredGalleryItems = useMemo/);
  assert.match(source, /aria-expanded=\{gallerySearchOpen\}/);
  assert.match(source, /aria-label="検索" aria-expanded=\{gallerySearchOpen\}/);
  assert.match(source, /placeholder="検索キーワードを入力してください\.\.\."/);
  assert.match(source, /aria-label="検索キーワードを入力してください\.\.\."/);
  assert.match(source, /aria-label="事例検索をクリア"/);
  assert.match(source, /onClick=\{\(\) => setGallerySearchTerm\(galleryQuery\.trim\(\)\)\}/);
  assert.match(source, /該当する結果が見つかりません/);
  assert.match(source, /別のキーワードで検索してください/);
});

test('uses a saved artifact feature type when resolving its reuse route', async () => {
  const source = await readFile(entryPath, 'utf8');
  const resolverStart = source.indexOf('const resolveArtifactFeatureId');
  const resolverEnd = source.indexOf('const isBetaFeature', resolverStart);
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'saved artifact route resolver is required');
  const resolver = source.slice(resolverStart, resolverEnd);
  assert.match(resolver, /artifact\.metadata\.toolId/);
  assert.match(resolver, /artifact\.featureType/);
  assert.match(resolver, /candidates\.find/);
});

test('uses the observed Light production artwork per feature instead of repeating one category icon', async () => {
  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /const launcherFeatureImages: Partial<Record<string, string>>/);
  assert.match(source, /'design-workspace': 'https:\/\/lightchain-qlxy-prod\.oss-cn-hangzhou\.aliyuncs\.com\/light-chain-platform\/home5_0_1\/designProduction\.png/);
  assert.match(source, /'virtual-fitting': 'https:\/\/lightchain-qlxy-prod\.oss-cn-hangzhou\.aliyuncs\.com\/light-chain-platform\/home5_0_1\/VirtualFittingCover\.png/);
  assert.match(source, /'fashion-studio': 'https:\/\/lightchain-qlxy-prod\.oss-cn-hangzhou\.aliyuncs\.com\/light-chain-platform\/home5_0_1\/integrationCover\.png/);
  assert.match(source, /launcherFeatureImages\[feature\.id\] \?\?/);
  assert.doesNotMatch(source, /const buildLauncherFeatureImage = \(feature: LightchainFeature\) => launcherCategoryImages\[feature\.category\];/);
});

test('keeps the Heavy-owned launcher artwork files available to the build', async () => {
  const assets = ['marketing-v1.png', 'design-v1.png', 'fitting-v1.png', 'graphics-v1.png'];
  await Promise.all(assets.map((asset) => access(new URL(`../public/assets/lightchain-cards/${asset}`, import.meta.url))));
});

test('does not expose the compact hub count as the detailed workbench count', async () => {
  const source = await readFile(new URL('../src/components/LightchainParityHub.tsx', import.meta.url), 'utf8');
  assert.match(source, /目的別の機能をすべて見る/);
  assert.doesNotMatch(source, /\{lightchainFeatureCatalog\.length\}機能をすべて見る/);
});

test('excludes deferred video features from the non-video launcher', async () => {
  const hub = await readFile(new URL('../src/components/LightchainParityHub.tsx', import.meta.url), 'utf8');
  const entry = await readFile(entryPath, 'utf8');
  const navigation = await readFile(new URL('../src/components/layout/navigation.ts', import.meta.url), 'utf8');
  assert.match(hub, /feature\.betaIncluded !== false/);
  assert.doesNotMatch(hub, /動画まで/);
  assert.doesNotMatch(entry, /video-promotion/);
  assert.doesNotMatch(entry, /featureId: 'video-workstation'/);
  assert.doesNotMatch(navigation, /path: '\/video'/);
});

test('keeps the lazy Lightchain entry branded as Lightchain', async () => {
  const source = await readFile(appPath, 'utf8');
  const start = source.indexOf("if (pathname.startsWith('/lightchain'))");
  const end = source.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start, 'Lightchain loading branch is required');
  const branch = source.slice(start, end);
  assert.match(branch, /eyebrow: 'LIGHTCHAIN AI'/);
  assert.doesNotMatch(branch, /eyebrow: 'Heavy Chain'/);
});

test('uses the shared Lightchain launcher on the public entry', async () => {
  const source = await readFile(landingPath, 'utf8');
  assert.match(source, /import \{ GenerateLightchainEntry \} from '\.\.\/components\/GenerateLightchainEntry'/);
  assert.match(source, /<GenerateLightchainEntry \/>/);
  assert.doesNotMatch(source, /HEAVYCHAIN|HEAVY CHAIN AI|unsplash\.com/);
});

test('matches the Lightchain launcher column breakpoints', async () => {
  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4/);
  assert.doesNotMatch(source, /\b2xl:grid-cols-4\b/);
});
