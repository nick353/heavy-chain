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
const loginPagePath = new URL('../src/pages/LoginPage.tsx', import.meta.url);
const resetPasswordPagePath = new URL('../src/pages/ResetPasswordPage.tsx', import.meta.url);
const layoutPath = new URL('../src/components/layout/Layout.tsx', import.meta.url);

test('uses Lightchain forgot-password URL while retaining Heavy legacy route compatibility', async () => {
  const [app, login, resetPassword, layout] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(loginPagePath, 'utf8'),
    readFile(resetPasswordPagePath, 'utf8'),
    readFile(layoutPath, 'utf8'),
  ]);
  for (const route of ['/forget-password', '/forgot-password']) {
    const escaped = route.replaceAll('/', '\\/');
    assert.match(app, new RegExp(`path="${escaped}"[\\s\\S]*?<ForgotPasswordPage \\/>`), `missing shared password-reset route: ${route}`);
  }
  assert.match(login, /<Link to="\/forget-password"/);
  assert.match(resetPassword, /<Link to="\/forget-password"/);
  assert.doesNotMatch(resetPassword, /<Link to="\/forgot-password"/);
  assert.match(layout, /const isPublicPage = \[[^\]]*'\/forget-password'/);
  assert.match(layout, /const isPublicPage = \[[^\]]*'\/forgot-password'/);
});

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
  assert.match(route, /lazyPage\(\s*\n?\s*<LightchainUnifiedWorkspaceShell>\s*\n?\s*<LightchainGraphicDesignPage \/>/);
  assert.doesNotMatch(route, /<LightchainWorkbenchPage \/>/);
});

test('keeps the official color-change detail route on the color-change surface', async () => {
  const [app, detail] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(new URL('../src/pages/ChangeColorDetailPage.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /path="\/editor\/changeColor"[\s\S]*?<ChangeColorProjectDashboardPage \/>/);
  assert.match(app, /path="\/editor\/changeColor\/detail"[\s\S]*?<ChangeColorDetailPage \/>/);
  // Light 色変更 editor: guide chooser, required colour + area, ratio, canonical change-color workspace.
  for (const marker of ['ガイドを表示しない', '色の置き換え', '色変更エリア', '生成画像の比率', "useCanonicalImageWorkspace('change-color'"]) {
    assert.ok(detail.includes(marker), `missing colour-change marker: ${marker}`);
  }
});

test('keeps the official mobile login route on the shared authentication surface', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /path="\/login-m"[\s\S]*?<LoginPage \/>/);
});

test('keeps the official Lab detail route on the source empty-canvas surface with Heavy identity', async () => {
  const [app, page] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(new URL('../src/pages/LightchainLabDetailPage.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /path="\/flow\/laboratory\/detail"[\s\S]*?<LightchainLabDetailPage \/>/);
  assert.match(page, /Heavy Chain Lab/);
  assert.match(page, /Untitled/);
  assert.match(page, /ここをクリックまたはドラッグして画像を追加/);
  assert.match(page, /最大20M/);
  assert.match(page, /radial-gradient\(#464b50 1px, transparent 1px\)/);
  assert.doesNotMatch(page, /type="checkbox"|権利確認|権利を確認してAI生成/);
});

test('maps vector-special to the Light legacy parity surface', async () => {
  const app = await readFile(appPath, 'utf8');
  const routeStart = app.indexOf('path="/tools/vector-special"');
  const routeEnd = app.indexOf('path="/tools/reactor"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'vector-special route is required');
  const route = app.slice(routeStart, routeEnd);
  assert.match(route, /LightchainVectorSpecialPage/);
  assert.doesNotMatch(route, /LightchainWorkbenchPage/);
  const page = (await readFile(parityPagesPath, 'utf8')) + (await readFile(new URL('../src/components/lightchain/LightchainDesignToolFrame.tsx', import.meta.url), 'utf8'));
  // The owner removed the Light "まもなく終了" banner: Heavy Chain keeps these tools.
  assert.doesNotMatch(page, /この機能はまもなく終了します/);
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
  // Placeholder 参考事例 cards (no real example images) are hidden by owner decision.
  assert.doesNotMatch(page, /参考事例<\/h2>/);
  assert.match(page, /detailPath: '\/editor\/pattern\/detail'/);
  assert.match(page, /navigate\(`\$\{config\.detailPath\}\?boardProjectCode=&boardProjectType=`\)/);
  assert.match(page, /boardProjectType=custom&resumeJob=/);
});

test('keeps the Light print-design project cards on the canonical detail route', async () => {
  const page = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const projectStart = page.indexOf("if (selectedTool.id === 'print-design-project')");
  const projectEnd = page.indexOf("if (selectedTool.id === 'print-design-detail')", projectStart);
  assert.ok(projectStart >= 0 && projectEnd > projectStart, 'print-design project surface is required');
  const project = page.slice(projectStart, projectEnd);
  assert.match(project, /onClick=\{\(\) => navigate\('\/editor\/patternDesign\/detail'\)\}/);
  assert.match(project, /\/editor\/patternDesign\/detail\?boardProjectCode=\$\{encodeURIComponent\(card\.id\)\}&boardProjectType=custom/);
  assert.match(project, /onClick=\{\(\) => navigate\('\/editor\/patternDesign\/detail'\)\}/);
  assert.doesNotMatch(project, /\/lightchain\/print-design-detail/);
  assert.doesNotMatch(project, /type=["']checkbox["']|権利を確認してAI生成/);
});

test('returns the Light marketing detail surface to the canonical marketing entry', async () => {
  const page = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  const detailStart = page.indexOf("if (selectedTool.id === 'marketing-detail')");
  const detailEnd = page.indexOf("if (selectedTool.id === 'print-design-project')", detailStart);
  assert.ok(detailStart >= 0 && detailEnd > detailStart, 'marketing detail surface is required');
  const detail = page.slice(detailStart, detailEnd);
  assert.match(detail, /navigate\('\/marketing'\)/);
  assert.doesNotMatch(detail, /\/lightchain\/marketing-home/);
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
  assert.match(detail, /video-source-empty-upload/);
  // Current Light source readback uses a centered 768px empty upload canvas;
  // 781.59px was the superseded pre-video-workspace measurement.
  assert.match(detail, /w-\[768px\]/);
  // The current Light detail rail has no remote project icon; Heavy must not
  // reintroduce the former Heavy-only asset in this source-shaped surface.
  assert.doesNotMatch(detail, /LIGHTCHAIN_VIDEO_PROJECT_ICON/);
  assert.match(detail, /video-source-empty-dots/);
  assert.doesNotMatch(detail, /border-dashed border-cyan-300\/70/);
  assert.match(detail, /video_provider_not_admitted/);
});

test('the old /lightchain launcher URL redirects to the home screen', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.ok(app.includes('<Route path="/lightchain" element={<LegacyRouteRedirect to="/dashboard" />} />'));
  assert.match(app, /path="\/dashboard"[\s\S]*?<GenerateLightchainEntry \/>/);
  assert.match(
    await readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8'),
    /navigate\(resolveAuthReturnPath\(location\.search, window\.location\.origin\)/,
  );
});

test('maps the Light design-document menu to the canonical board routes', async () => {
  const [app, layout, board] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(new URL('../src/components/layout/Layout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LightchainBoardPage.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /path="\/board\/edit"[\s\S]*?<LightchainBoardEditPage \/>/);
  assert.match(app, /path="\/board"[\s\S]*?<LightchainBoardPage \/>/);
  assert.match(layout, /<Link to="\/board"[^>]*>[\s\S]{0,120}<span>デザインドキュメント<\/span><\/Link>/);
  assert.match(board, /data-testid="lightchain-board-page"/);
  assert.match(board, /data-testid="lightchain-board-edit-page"/);
  assert.match(board, /listCanvasDocumentsPage/);
  assert.doesNotMatch(board, /fillSourceBoardDocuments/);
  assert.doesNotMatch(board, /2025\.8\.21 18:00/); // the source account's sample dates are not copied
  assert.doesNotMatch(board, /type="checkbox"|権利確認/);
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
  // Heavy generates model customizations itself, so the surface shows AI生成 instead of the locked button.
  assert.match(surface, /data-testid="heavy-model-generate"/);
  assert.doesNotMatch(surface, /type="checkbox"/);
  assert.match(surface, /data-testid="lightchain-source-model-rail"/);
  assert.match(surface, /role="combobox"/);
  // The option lists moved to src/lib/modelLibrarySettings.ts, which the surface imports.
  const settings = await readFile(new URL('../src/lib/modelLibrarySettings.ts', import.meta.url), 'utf8');
  assert.match(surface, /from '\.\.\/\.\.\/lib\/modelLibrarySettings'/);
  for (const option of [/赤ちゃん/, /ラテンアメリカ/, /黄色い肌/, /筋肉質/]) assert.match(settings, option);
  assert.doesNotMatch(`${page}\n${surface}`, /type="checkbox"|権利を確認してAI生成|権利確認ゲート/);
});

test('keeps the Creator and fabric parity surfaces on self-hosted copies of the Light media', async () => {
  const [parityPages, materialWorkbench] = await Promise.all([
    readFile(parityPagesPath, 'utf8'),
    readFile(materialWorkbenchPath, 'utf8'),
  ]);
  // P4: the Light videos (服装设计 / 面料上身) are served from Heavy, never hotlinked.
  assert.match(parityPages, /\/lightchain-assets\/mirror\/lightchain-qlxy-prod\/garment-design\.mp4/);
  assert.match(materialWorkbench, /\/lightchain-assets\/mirror\/lightchain-qlxy-prod\/fabric-on-body\.mp4/);
  assert.doesNotMatch(`${parityPages}${materialWorkbench}`, /aliyuncs\.com|linkaigc\.com/);
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
  const page = await readFile(new URL('../src/pages/LightchainGraphicDesignPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /AIグラフィックデザイン/);
  assert.match(page, /AIでグラフィックを作成/);
  assert.match(page, /画像をアップロードします/);
  assert.match(page, /画像を2枚までアップロードできます/);
  assert.match(page, /生成履歴/);
  assert.match(page, /useCanonicalImageWorkspace\('print-design-project'/);
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

test('uses the current Lightchain launcher artwork and gallery fixtures', async () => {
  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /const launcherFeatureImages: Partial<Record<string, string>>/);
  assert.match(source, /'design-workspace': '\/lightchain-assets\/mirror\/lightchain-qlxy-prod\/designProduction-[0-9a-f]+\.webp'/);
  assert.match(source, /'virtual-fitting': '\/lightchain-assets\/mirror\/lightchain-qlxy-prod\/VirtualFittingCover-[0-9a-f]+\.webp'/);
  assert.match(source, /'fashion-studio': '\/lightchain-assets\/mirror\/lightchain-qlxy-prod\/integrationCover-[0-9a-f]+\.webp'/);
  assert.match(source, /const canonicalRecommendedGalleryImages = \[/);
  assert.match(source, /\/lightchain-assets\/mirror\/static-cn\/d81b55aa18721b86c37b96a36223a936-[0-9a-f]+\.webp/);
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

test('keeps the official video workstation in the launcher while retaining generic beta filtering', async () => {
  const hub = await readFile(new URL('../src/components/LightchainParityHub.tsx', import.meta.url), 'utf8');
  const entry = await readFile(entryPath, 'utf8');
  const navigation = await readFile(new URL('../src/components/layout/navigation.ts', import.meta.url), 'utf8');
  assert.match(hub, /feature\.betaIncluded !== false/);
  assert.doesNotMatch(hub, /動画まで/);
  assert.match(entry, /featureId: 'video-workstation'/);
  assert.doesNotMatch(navigation, /path: '\/video'/);
});

test('keeps the lazy Heavy entry branded as Heavy', async () => {
  const source = await readFile(appPath, 'utf8');
  const start = source.indexOf("if (pathname.startsWith('/lightchain'))");
  const end = source.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start, 'Lightchain loading branch is required');
  const branch = source.slice(start, end);
  assert.match(branch, /eyebrow: 'HEAVY CHAIN'/);
  assert.doesNotMatch(branch, /eyebrow: 'LIGHTCHAIN AI'/);
});

test('uses the shared Lightchain launcher on the public entry', async () => {
  const source = await readFile(landingPath, 'utf8');
  assert.match(source, /import \{ GenerateLightchainEntry \} from '\.\.\/components\/GenerateLightchainEntry'/);
  assert.match(source, /<GenerateLightchainEntry \/>/);
  assert.doesNotMatch(source, /HEAVYCHAIN|HEAVY CHAIN AI|unsplash\.com/);
});

test('matches the Lightchain launcher column breakpoints', async () => {
  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4/);
});
