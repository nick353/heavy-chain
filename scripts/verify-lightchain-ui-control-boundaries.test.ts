import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const materialSourcePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const canvasSourcePath = new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url);
const layoutSourcePath = new URL('../src/components/layout/Layout.tsx', import.meta.url);
const appSourcePath = new URL('../src/App.tsx', import.meta.url);
const publicHeaderSourcePath = new URL('../src/components/layout/Header.tsx', import.meta.url);
const loginSourcePath = new URL('../src/pages/LoginPage.tsx', import.meta.url);
const parityPagesSourcePath = new URL('../src/pages/LightchainParityPages.tsx', import.meta.url);

test('public and auth recovery shells use the Lightchain identity without extra Heavy chrome', async () => {
  const [app, header, login] = await Promise.all([
    readFile(appSourcePath, 'utf8'),
    readFile(publicHeaderSourcePath, 'utf8'),
    readFile(loginSourcePath, 'utf8'),
  ]);
  const fallback = app.slice(app.indexOf('function WorkspaceLoadingFallback'), app.indexOf('function PageLoading'));

  assert.match(header, /aria-label="Lightchain AI"/);
  assert.match(header, /LIGHTCHAIN/);
  assert.match(header, /aria-label="日本語"/);
  assert.match(header, /aria-label="ヘルプセンター"/);
  assert.doesNotMatch(header, /HeavyChainLogo|HEAVY CHAIN|darkMode/);

  assert.match(fallback, /LIGHTCHAIN/);
  assert.match(fallback, /ログイン状態を確認しています/);
  assert.doesNotMatch(fallback, /ログイン画面へ|読み込み後にこの導線|grid gap-3 sm:grid-cols-3/);

  assert.match(login, /LIGHTCHAIN AI \/ LOGIN/);
  assert.match(login, /placeholder="アカウントを入力"/);
  assert.match(login, /placeholder="パスワードを入力する"/);
  assert.doesNotMatch(login, /HEAVY CHAIN|Heavy Chain/);
});

test('authenticated root enters the Lightchain home instead of the Heavy landing page', async () => {
  const source = await readFile(appSourcePath, 'utf8');

  assert.match(source, /path="\/"[\s\S]*?<PublicRoute>[\s\S]*?lazyPage\(<LandingPage \/>\)/);
  assert.match(source, /if \(user\) \{[\s\S]*?return <Navigate to="\/designProduction" replace \/>/);
});

test('Lightchain routes do not expose the Heavy global keyboard shortcut affordance', async () => {
  const source = await readFile(layoutSourcePath, 'utf8');

  assert.match(source, /showSidebar && !isLightchainRoute && <KeyboardShortcuts shortcuts=\{defaultShortcuts\} \/>/);
});

test('Lightchain header exposes the current language and help button controls', async () => {
  const source = await readFile(layoutSourcePath, 'utf8');

  assert.match(source, /<Globe2 className="h-4 w-4" \/>/);
  assert.match(source, /aria-label="日本語"/);
  assert.match(source, /aria-label="ヘルプセンター"/);
});

test('Lightchain header uses the Lightchain avatar identity and account menu', async () => {
  const source = await readFile(layoutSourcePath, 'utf8');

  assert.match(source, /aria-label="avatar"/);
  assert.match(source, /alt="avatar"/);
  assert.match(source, /lightchainAvatarUrl/);
  assert.match(source, /saas-avatar-new\.png/);
  assert.match(source, /onClick=\{\(\) => void handleLightchainSignOut\(\)\}/);
  assert.match(source, /\{!isLightchainRoute && \([\s\S]*aria-label="アカウント"/);
});

test('Lightchain routes use the current Lightchain browser title', async () => {
  const [source, canvas] = await Promise.all([
    readFile(layoutSourcePath, 'utf8'),
    readFile(canvasSourcePath, 'utf8'),
  ]);

  assert.match(source, /document\.title = isLightchainRoute \? 'Lightchain AI' : 'Heavy Chain \| AI制作ワークスペース'/);
  assert.match(source, /'\/canvas\/new'/);
  assert.match(source, /'\/workflows\/design-exploration'/);
  assert.match(source, /'\/workflows\/ec-product-set'/);
  assert.match(source, /'\/workflows\/sns-campaign'/);
  assert.match(canvas, /document\.title = 'Lightchain AI'/);
});

test('vector-special keeps the Light geometry contract for the professional parity surface', async () => {
  const source = await readFile(parityPagesSourcePath, 'utf8');
  const vectorBlock = source.slice(source.indexOf('export function LightchainVectorSpecialPage()'), source.indexOf('const modelTabs ='));

  assert.match(vectorBlock, /lg:grid-cols-\[596px_minmax\(0,1fr\)\]/);
  assert.match(vectorBlock, /grid-cols-\[278px_278px\]/);
  assert.match(vectorBlock, /px-\[3px\] py-\[1\.5px\]/);
  assert.match(vectorBlock, /h-\[31px\].*whitespace-nowrap/s);
  assert.match(vectorBlock, /grid-cols-\[160px_160px\] gap-4/);
  assert.match(vectorBlock, /h-\[32px\] w-\[102px\]/);
  assert.match(vectorBlock, /border-cyan-200\/30/);
  assert.doesNotMatch(vectorBlock, /lg:grid-cols-\[564px_minmax\(0,1fr\)\]/);
});

test('fitting and line-to-real settings are stateful and persisted into the workbench contract', async () => {
  const source = await readFile(workbenchSourcePath, 'utf8');

  assert.match(source, /setAutoConvertGarment\(\(current\) => !current\)/);
  assert.match(source, /const \[referenceNote, setReferenceNote\] = useState\(''\)/);
  assert.match(source, /const \[autoConvertGarment, setAutoConvertGarment\] = useState\(false\)/);
  assert.match(source, /setAutoConvertGarment\(false\)/);
  assert.match(source, /role="switch"/);
  assert.match(source, /aria-checked=\{autoConvertGarment\}/);
  assert.doesNotMatch(source, /role="switch"[\s\S]{0,180}aria-pressed=\{autoConvertGarment\}/);
  assert.match(source, /role="combobox"[\s\S]{0,100}aria-label=\{fittingAspectRatio\}/);
  assert.match(source, /role="combobox"[\s\S]{0,100}aria-label=\{fittingResolution\}/);
  assert.match(source, /autoConvertGarment: isFittingDetail \? autoConvertGarment : null/);
  assert.match(source, /lineToRealImageType/);
  assert.match(source, /data-testid=\{`lightchain-line-to-real-output-type-\$\{option\}`\}/);
  assert.match(source, /lineToRealOutputType: selectedTool\.id === 'line-to-real' \? lineToRealImageType : null/);
  assert.match(source, /data-testid=\{selectedTool\.id === 'fabric-image' \? 'lightchain-fabric-image-ratio-readout' : undefined\}/);
  assert.doesNotMatch(source, /role="combobox"[\s\S]{0,240}画像比率/);
});

test('material workbench does not add a Heavy-only toolbar to direct Lightchain routes', async () => {
  const [source, workbench] = await Promise.all([
    readFile(materialSourcePath, 'utf8'),
    readFile(workbenchSourcePath, 'utf8'),
  ]);

  assert.doesNotMatch(source, /MATERIAL_TOOLBAR_ROUTES/);
  assert.doesNotMatch(source, /LightchainMaterialToolbar/);
  assert.doesNotMatch(source, /data-testid="lightchain-material-toolbar"/);
  assert.doesNotMatch(workbench, /data-testid="lightchain-material-toolbar"/);
});

test('Lightchain workbench keeps the production four-category visible taxonomy', async () => {
  const workbench = await readFile(workbenchSourcePath, 'utf8');
  const categoryBlock = workbench.match(/const categories:[\s\S]*?\n\];/)?.[0] ?? '';

  assert.match(categoryBlock, /label: 'おすすめ'/);
  assert.match(categoryBlock, /label: '企画デザインツール'/);
  assert.match(categoryBlock, /label: 'AIフィッティング'/);
  assert.match(categoryBlock, /label: 'グラフィックツール'/);
  assert.doesNotMatch(categoryBlock, /マーケティング|モデル企画|動画|Lab/);
  assert.match(workbench, /getLightchainTopLevelCategory\(tool\.category\)/);
});

test('Lightchain detail workbench marks the selected source category as active', async () => {
  const [workbench, material] = await Promise.all([
    readFile(workbenchSourcePath, 'utf8'),
    readFile(materialSourcePath, 'utf8'),
  ]);

  assert.match(workbench, /const getLightchainVisibleCategoryId = \(category: ToolCategory\)/);
  assert.match(workbench, /const activeSourceCategory = getLightchainVisibleCategoryId\(selectedTool\.category\)/);
  assert.match(workbench, /aria-current=\{item\.category === activeSourceCategory \? 'page' : undefined\}/);
  assert.match(workbench, /item\.category === activeSourceCategory \? 'bg-white\/\[0\.08\] text-white' : ''/);
  assert.match(material, /aria-current=\{item\.category === 'graphics' \? 'page' : undefined\}/);
});

test('Agent parity starts with the expanded project sidebar and exposes Lightchain attachment controls', async () => {
  const source = await readFile(workbenchSourcePath, 'utf8');

  assert.match(source, /const \[agentSidebarOpen, setAgentSidebarOpen\] = useState\(true\)/);
  assert.match(source, /aria-label="添付を追加"/);
  assert.match(source, /data-testid=\{workspaceStyle\.kind === 'agent' \? 'lightchain-agent-quick-start' : undefined\}/);
  assert.match(source, /aria-label="アップロードするファイルを選択"/);
  assert.match(source, /aria-label="アップロードする画像を選択"/);
  assert.match(source, /aria-label=\{workspaceStyle\.kind === 'agent' \? '送信' : 'AI生成'\}/);
});

test('Agent category copy matches the Lightchain production controls', async () => {
  const source = await readFile(workbenchSourcePath, 'utf8');

  assert.match(source, /顧客要望を入力するか、brief、メール、議事録をアップロードしてください…/);
  assert.match(source, /デザインしたい服のスタイルを入力するか、参考画像をアップロードしてください…/);
  assert.match(source, /生成したい柄のスタイル、要素、使用シーンを入力してください…/);
  assert.match(source, /インスピレーション:\s*\{\s*helper: ''/s);
  assert.match(source, /AIグラフィックデザイン:\s*\{\s*helper: ''/s);
});

test('parity runtime captures feature-specific settings in the comparison key', async () => {
  const source = await readFile(workbenchSourcePath, 'utf8');

  assert.match(source, /featureSettings: \{/);
  assert.match(source, /autoConvertGarment: isFittingDetail \? autoConvertGarment : null/);
  assert.match(source, /lineToRealOutputType: selectedTool\.id === 'line-to-real' \? lineToRealImageType : null/);
  assert.match(source, /patternVectorLayers: isPatternVectorProFlow \? patternVectorLayers : null/);
  assert.match(source, /imageRepairMode: selectedTool\.id === 'image-repair' \? imageRepairMode : null/);
  assert.match(source, /modelFormState: currentModelPanel \? modelFormState : null/);
  assert.match(source, /fittingTaskTab: isFittingDetail \? activeFittingTaskTab : null/);
  assert.match(source, /wearDesignPrompt: \['wear-design-lab', 'wear-design-detail'\]/);
  assert.match(source, /printDesignPrompt: \['print-design-project', 'print-design-detail'\]/);
  assert.match(source, /marketingDetailPrompt: selectedTool\.id === 'marketing-detail' \? marketingDetailPrompt/);
});
