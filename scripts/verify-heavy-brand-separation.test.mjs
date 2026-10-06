import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

test('Heavy Chain owns the visible identity while parity routes keep their internal compatibility names', async () => {
  const [header, layout, launcher, landing, login, app, entry, canvas, logo, workbench, workspaceActivity, gallery, index, envExample, envProduction] = await Promise.all([
    read('src/components/layout/Header.tsx'),
    read('src/components/layout/Layout.tsx'),
    read('src/components/layout/LightchainLauncherHeader.tsx'),
    read('src/pages/LandingPage.tsx'),
    read('src/pages/LoginPage.tsx'),
    read('src/App.tsx'),
    read('src/components/GenerateLightchainEntry.tsx'),
    read('src/pages/CanvasEditorPage.tsx'),
    read('src/components/LightchainLogo.tsx'),
    read('src/pages/LightchainWorkbenchPage.tsx'),
    read('src/lib/workspaceActivity.ts'),
    read('src/pages/GalleryPage.tsx'),
    read('index.html'),
    read('.env.example'),
    read('.env.production.example'),
  ]);

  for (const source of [header, layout, launcher, landing, login, app, entry, canvas, logo, workbench, workspaceActivity, gallery]) {
    assert.doesNotMatch(source, /aria-label="Lightchain AI"|<LightchainLogo\b|src="\/assets\/lightchain-logo\.svg"/);
  }
  assert.match(header, /aria-label="Heavy Chain"/);
  assert.match(layout, /HeavyChainLogo/);
  assert.match(launcher, /HeavyChainLogo/);
  assert.match(landing, /document\.title = 'Heavy Chain \| AI制作ワークスペース'/);
  assert.match(login, /アパレル生成AIシステムHeavy Chain/);
  assert.match(app, /aria-label="Heavy Chain"/);
  assert.match(entry, /<h1 className="sr-only">HEAVY CHAIN<\/h1>/);
  assert.match(canvas, /document\.title = 'Heavy Chain \| Canvas'/);
  assert.match(logo, /return <HeavyChainBrandLogo className=\{className\} \/>/);
  assert.match(workbench, /Heavy Chain素材/);
  assert.match(workspaceActivity, /toHeavyChainDisplayCopy\(row\.value\)/);
  assert.match(gallery, /aria-label=\{`\$\{toHeavyDisplayCopy\(image\.prompt\)/);

  assert.match(index, /<title>Heavy Chain \| AI制作ワークスペース<\/title>/);
  assert.match(index, /og:url" content="https:\/\/heavy-chain\.zeabur\.app\//);
  assert.match(envExample, /PUBLIC_URL=https:\/\/heavy-chain\.zeabur\.app/);
  assert.match(envProduction, /PUBLIC_URL=https:\/\/heavy-chain\.zeabur\.app/);
});

test('the unavailable custom domain stays an explicit proposal instead of a hidden redirect', async () => {
  const [setup, readme] = await Promise.all([read('SETUP.md'), read('README.md')]);
  assert.match(setup, /heavy-chain\.zeabur\.app/);
  assert.match(setup, /heavy-chain-web\.nichika2000823\.workers\.dev/);
  assert.match(readme, /heavy-chain\.zeabur\.app/);
});

test('user-facing parity surfaces do not leak the Light Chain brand', async () => {
  const sources = await Promise.all([
    read('src/pages/BrandSettingsPage.tsx'),
    read('src/pages/GeneratePage.tsx'),
    read('src/components/GenerateLightchainEntry.tsx'),
    read('src/components/canvas/PropertiesPanel.tsx'),
    read('src/pages/GalleryPage.tsx'),
  ]);

  const legacyVisiblePhrases = [
    'Lightchainの生成',
    'Lightchain usage',
    '保存済みのLightchain成果物',
    'Lightchain出典',
  ];
  for (const source of sources) {
    for (const phrase of legacyVisiblePhrases) assert.equal(source.includes(phrase), false, `legacy visible phrase: ${phrase}`);
  }
  assert.match(sources.at(-1), /toHeavyDisplayCopy/);
});

test('Heavy route aliases keep the visible Heavy surface separate from Light compatibility paths', async () => {
  const [app, launcher, workbench, material] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/GenerateLightchainEntry.tsx'),
    read('src/pages/LightchainWorkbenchPage.tsx'),
    read('src/pages/LightchainMaterialWorkbenchPage.tsx'),
  ]);
  assert.match(app, /path="\/heavy"/);
  assert.match(app, /path="\/heavy\/:toolId"/);
  assert.match(app, /path="\/heavy\/fabric-image"/);
  assert.match(app, /path="\/heavy\/printing-image"/);
  assert.match(launcher, /href\.replace\(\s*\/\^\\\/lightchain/);
  assert.match(workbench, /const isHeavyRoute = isHeavyWorkspaceRuntime\(\)[\s\S]*?location\.pathname === '\/heavy'/);
  assert.match(workbench, /sourceResumePath: isHeavyRoute/);
  assert.match(material, /const isHeavyRoute = isHeavyWorkspaceRuntime\(\) \|\| location\.pathname\.startsWith\('\/heavy\/'\)/);
});
