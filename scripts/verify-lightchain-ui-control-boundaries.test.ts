import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workbenchSourcePath = new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url);
const materialSourcePath = new URL('../src/pages/LightchainMaterialWorkbenchPage.tsx', import.meta.url);
const layoutSourcePath = new URL('../src/components/layout/Layout.tsx', import.meta.url);
const appSourcePath = new URL('../src/App.tsx', import.meta.url);
const publicHeaderSourcePath = new URL('../src/components/layout/Header.tsx', import.meta.url);
const loginSourcePath = new URL('../src/pages/LoginPage.tsx', import.meta.url);

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

test('Lightchain header uses the avatar identity instead of Heavy account chrome', async () => {
  const source = await readFile(layoutSourcePath, 'utf8');

  assert.match(source, /aria-label="avatar"/);
  assert.match(source, /alt="avatar"/);
  assert.doesNotMatch(source, /aria-label="アカウント"[\s\S]{0,220}isLightAccountMenuOpen/);
});

test('fitting and line-to-real settings are stateful and persisted into the workbench contract', async () => {
  const source = await readFile(workbenchSourcePath, 'utf8');

  assert.match(source, /setAutoConvertGarment\(\(current\) => !current\)/);
  assert.match(source, /aria-pressed=\{autoConvertGarment\}/);
  assert.match(source, /autoConvertGarment: isFittingDetail \? autoConvertGarment : null/);
  assert.match(source, /lineToRealImageType/);
  assert.match(source, /data-testid=\{`lightchain-line-to-real-output-type-\$\{option\}`\}/);
  assert.match(source, /lineToRealOutputType: selectedTool\.id === 'line-to-real' \? lineToRealImageType : null/);
  assert.match(source, /data-testid=\{selectedTool\.id === 'fabric-image' \? 'lightchain-fabric-image-ratio-readout' : undefined\}/);
  assert.doesNotMatch(source, /role="combobox"[\s\S]{0,240}画像比率/);
});

test('material workbench toolbar entries navigate to current catalog routes', async () => {
  const source = await readFile(materialSourcePath, 'utf8');

  assert.match(source, /MATERIAL_TOOLBAR_ROUTES/);
  assert.match(source, /'デザインツール': '\/lightchain\?category=planning'/);
  assert.match(source, /'フィッティングツール': '\/lightchain\?category=fitting'/);
  assert.match(source, /'グラフィックデザインツール': '\/lightchain\?category=graphics'/);
  assert.match(source, /onClick=\{\(\) => navigate\(MATERIAL_TOOLBAR_ROUTES\[label\] \?\? '\/lightchain'\)\}/);
  assert.match(source, /data-testid=\{`lightchain-material-toolbar-\$\{String\(label\)\}`\}/);
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
