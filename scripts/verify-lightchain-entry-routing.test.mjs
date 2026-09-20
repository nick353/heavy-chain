import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const catalogPath = new URL('../src/lib/lightchainParityCatalog.ts', import.meta.url);
const entryPath = new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url);
const materialWorkbenchPath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const workbenchPath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const landingPath = new URL('../src/pages/LandingPage.tsx', import.meta.url);
const parityPagesPath = new URL('../src/pages/LightchainParityPages.tsx', import.meta.url);
const modelLibraryPagePath = new URL('../src/pages/ModelLibraryPage.tsx', import.meta.url);
const appPath = new URL('../src/App.tsx', import.meta.url);

test('routes both workbench recommendation tabs to the valid launcher category', async () => {
  const sources = await Promise.all([
    readFile(materialWorkbenchPath, 'utf8'),
    readFile(workbenchPath, 'utf8'),
  ]);
  for (const source of sources) {
    assert.match(source, /\{ label: 'おすすめ', category: 'recommended', to: '\/designProduction\?category=recommended' \}/);
    assert.doesNotMatch(source, /\{ label: 'おすすめ', to: '\/designProduction\?category=home' \}/);
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

test('keeps the video project dashboard and detail route aligned with Lightchain', async () => {
  const app = await readFile(appPath, 'utf8');
  const catalog = await readFile(catalogPath, 'utf8');
  const dashboard = await readFile(new URL('../src/pages/VideoProjectDashboardPage.tsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');
  const cloneLayout = await readFile(new URL('./verify-lightchain-clone-layout.mjs', import.meta.url), 'utf8');
  assert.match(app, /path="\/flow\/GenerateShortVideo"[\s\S]*?<VideoProjectDashboardPage \/>/);
  assert.match(app, /path="\/flow\/GenerateShortVideo\/detail"[\s\S]*?<VideoWorkstationPage \/>/);
  assert.match(app, /path="\/video"[\s\S]*?<LightchainSourceNotFoundPage \/>/);
  assert.match(catalog, /id: 'video-workstation',[\s\S]*?route: '\/flow\/GenerateShortVideo'/);
  assert.match(catalog, /matrixId: 'M05',[\s\S]*?heavyCurrentBehavior: 'Canonical dashboard\/detail now match the Light entry and initial dropzone; provider admission remains fail-closed'[\s\S]*?status: 'in_progress'/);
  assert.match(dashboard, /新規ファイル/);
  assert.match(dashboard, /参考事例/);
  assert.match(dashboard, /修正/);
  assert.doesNotMatch(dashboard, /checkbox|権利確認/);
  assert.match(cloneLayout, /'desktop-video-projects'/);
  assert.match(cloneLayout, /'mobile-video-projects'/);
  assert.match(cloneLayout, /newRouteEvidence\(key, '\/flow\/GenerateShortVideo'/);
  assert.match(cloneLayout, /video_rights_checkbox_absent/);
  assert.match(detail, /ガイドを見る/);
  assert.match(detail, /ガイドを表示しない/);
  assert.match(detail, /Untitled/);
  assert.match(detail, /ここをクリックまたはドラッグして画像を追加/);
  assert.match(detail, /最大20M/);
  assert.match(detail, /w-\[264px\]/);
  assert.match(detail, /max-w-\[784px\]/);
  assert.match(detail, /radial-gradient\(#4b5b5f_0\.7px,transparent_0\.7px\)/);
  assert.match(detail, /aria-hidden=\"true\" className=\"mr-2 inline-block rounded bg-cyan-500\/80/);
  assert.doesNotMatch(detail, /border-dashed border-cyan-300\/70/);
  assert.match(detail, /video_provider_not_admitted/);
});

test('exposes the Lightchain launcher at the canonical /lightchain route', async () => {
  const app = await readFile(appPath, 'utf8');
  const routeStart = app.indexOf('path="/lightchain"');
  const routeEnd = app.indexOf('path="/lightchain/:toolId"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'legacy route boundary is required');
  const route = app.slice(routeStart, routeEnd);
  assert.match(route, /<LightchainUnifiedWorkspaceShell>[\s\S]*?<GenerateLightchainEntry \/>[\s\S]*?<\/LightchainUnifiedWorkspaceShell>/);
  assert.doesNotMatch(route, /LightchainSourceNotFoundPage/);
  assert.match(await readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8'), /navigate\('\/designProduction'/);
});

test('keeps model customization on the Light source surface without a Heavy-only rights checkbox', async () => {
  const [app, page, surface, lockButton] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(modelLibraryPagePath, 'utf8'),
    readFile(new URL('../src/components/lightchain/SourceModelLibrarySurface.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/lightchain/PermissionLockedButton.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /path="\/model-library"[\s\S]*?<ModelLibraryPage \/>/);
  assert.match(app, /path="\/model-library\/model-custom-form"[\s\S]*?<ModelLibraryPage \/>/);
  assert.match(surface, /モデルカスタマイズ/);
  assert.match(surface, /ワンクリックで専用のバーチャルモデルイメージを生成/);
  assert.match(lockButton, /権限がありません/);
  assert.match(surface, /SourcePermissionLockedButton/);
  assert.match(surface, /data-testid="lightchain-source-model-rail"/);
  assert.match(surface, /role="combobox"/);
  assert.match(surface, /赤ちゃん/);
  assert.match(surface, /ラテンアメリカ/);
  assert.match(surface, /黄色い肌/);
  assert.match(surface, /筋肉質/);
  assert.doesNotMatch(`${page}\n${surface}`, /type="checkbox"|権利を確認してAI生成|権利確認ゲート/);
});

test('keeps the Creator and fabric parity surfaces on the current Light media sources', async () => {
  const [parityPages, materialWorkbench] = await Promise.all([
    readFile(parityPagesPath, 'utf8'),
    readFile(materialWorkbenchPath, 'utf8'),
  ]);
  assert.match(parityPages, /light-chain-platform\/tools\/ja\/%E6%9C%8D%E8%A3%85%E8%AE%BE%E8%AE%A1\.mp4/);
  assert.match(materialWorkbench, /light-chain-platform\/tools\/ja\/%E9%9D%A2%E6%96%99%E4%B8%8A%E8%BA%AB\.mp4/);
  assert.doesNotMatch(parityPages, /light-chain-platform\/tools\/ja\/%E6%9C%8D%E8%A3%85%E8%A8%AD%E8%A8%88\.mp4/);
});

test('loading shells do not add a Heavy-only rights-confirmation prompt', async () => {
  const source = await readFile(appPath, 'utf8');
  const generateStart = source.indexOf("if (pathname.startsWith('/generate'))");
  const lightchainStart = source.indexOf("if (pathname.startsWith('/lightchain'))", generateStart);
  assert.ok(generateStart >= 0 && lightchainStart > generateStart, 'generate loading copy is required');
  const generateCopy = source.slice(generateStart, lightchainStart);
  assert.doesNotMatch(generateCopy, /権利確認|権利を確認/);

  const brandStart = source.indexOf("'/brand/settings': {");
  const brandEnd = source.indexOf("\n  },", brandStart);
  assert.ok(brandStart >= 0 && brandEnd > brandStart, 'brand settings loading copy is required');
  assert.doesNotMatch(source.slice(brandStart, brandEnd), /権利確認|権利を確認/);
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

test('uses Heavy-owned artwork per launcher feature instead of remote fixed fixtures', async () => {
  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /const launcherFeatureImages: Partial<Record<string, string>>/);
  assert.match(source, /'design-workspace': '\/assets\/lightchain-cards\/design-v1\.png'/);
  assert.match(source, /'virtual-fitting': '\/assets\/lightchain-cards\/fitting-v1\.png'/);
  assert.match(source, /'fashion-studio': '\/assets\/lightchain-cards\/design-v1\.png'/);
  assert.match(source, /launcherFeatureImages\[feature\.id\] \?\?/);
  assert.doesNotMatch(source, /https?:\/\//);
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
  const launcherSource = entry.slice(0, entry.indexOf('const galleryTabs'));
  assert.match(hub, /feature\.betaIncluded !== false/);
  assert.doesNotMatch(hub, /動画まで/);
  assert.doesNotMatch(launcherSource, /video-promotion/);
  assert.doesNotMatch(launcherSource, /featureId: 'video-workstation'/);
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
