import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getLightchainLauncherBadge,
  getLightchainLauncherFeatures,
  getLightchainLauncherTitle,
  lightchainCategories,
} from '../src/lib/lightchainParityCatalog.ts';

test('launcher mirrors the current Lightchain card counts by category', () => {
  const counts = Object.fromEntries(
    lightchainCategories.map((category) => [category.id, getLightchainLauncherFeatures(category.id).length]),
  );

  assert.deepEqual(counts, {
    recommended: 6,
    planning: 9,
    fitting: 6,
    graphics: 5,
  });
});

test('launcher preserves shared cards and exposes the official video workstation', () => {
  const allFeatures = lightchainCategories.flatMap((category) => getLightchainLauncherFeatures(category.id));
  const recommended = getLightchainLauncherFeatures('recommended');
  assert.equal(allFeatures.some((feature) => /動画|video/i.test(`${feature.title} ${feature.route}`)), true);
  assert.deepEqual(recommended.map((feature) => feature.id), [
    'design-agent',
    'design-workspace',
    'marketing-workspace',
    'fashion-studio',
    'video-workstation',
    'virtual-fitting',
  ]);
  assert.equal(recommended[4]?.route, '/flow/GenerateShortVideo');
  assert.notEqual(recommended[4]?.betaIncluded, false);
  assert.equal(recommended.some((feature) => feature.id === 'design-workspace'), true);
  assert.equal(getLightchainLauncherFeatures('planning').some((feature) => feature.id === 'design-workspace'), true);
  assert.equal(getLightchainLauncherFeatures('graphics').some((feature) => feature.id === 'design-workspace'), true);
  assert.equal(getLightchainLauncherFeatures('fitting').some((feature) => feature.id === 'virtual-fitting'), true);
  assert.equal(getLightchainLauncherFeatures('recommended').some((feature) => feature.id === 'virtual-fitting'), true);
});

test('design arrange opens the Light project dashboard before the editor', () => {
  const planning = getLightchainLauncherFeatures('graphics');
  assert.equal(planning.find((feature) => feature.id === 'design-arrange')?.route, '/editor/pattern');
});

test('launcher uses Heavy display labels instead of internal readiness labels', () => {
  const fitting = getLightchainLauncherFeatures('fitting');
  const graphics = getLightchainLauncherFeatures('graphics');

  assert.equal(getLightchainLauncherTitle(fitting.find((feature) => feature.id === 'heavychain-lab')!), 'Heavy Chain Lab');
  assert.equal(getLightchainLauncherTitle(fitting.find((feature) => feature.id === 'remove-background')!), '画像修正');
  assert.equal(getLightchainLauncherTitle(graphics.find((feature) => feature.id === 'print-design')!), 'プリントデザイン');
  assert.equal(getLightchainLauncherBadge(getLightchainLauncherFeatures('recommended').find((feature) => feature.id === 'marketing-workspace')!), null);
  assert.equal(getLightchainLauncherBadge(getLightchainLauncherFeatures('recommended').find((feature) => feature.id === 'design-agent')!), 'Beta');
  assert.equal(getLightchainLauncherBadge(getLightchainLauncherFeatures('graphics').find((feature) => feature.id === 'design-workspace')!), null);
  assert.equal(getLightchainLauncherBadge(fitting.find((feature) => feature.id === 'remove-background')!), 'まもなく提供終了');
});

test('launcher preserves the current Lightchain card order with Heavy display names', () => {
  const titlesByCategory = Object.fromEntries(
    lightchainCategories.map((category) => [
      category.id,
      getLightchainLauncherFeatures(category.id).map((feature) => getLightchainLauncherTitle(feature)),
    ]),
  );

  assert.deepEqual(titlesByCategory, {
    recommended: [
      'インサイト意思決定ワークベンチ',
      'デザインワークスペース',
      'マーケティングワークスペース',
      'ファッションスタジオ',
      '動画ワークステーション',
      'AIフィッティング',
    ],
    planning: [
      'デザインワークスペース',
      'インスピレーション',
      'ウェアデザインラボ',
      'インサイト意思決定ワークベンチ',
      '生地プリントの試着シミュレーション',
      '線画から実写へ変換',
      '色変更',
      '平絵をベクター化',
      'カスタムスタイル',
    ],
    fitting: [
      'AIフィッティング',
      'モデル企画ライブラリ',
      'ファッションスタジオ',
      '動画ワークステーション',
      'Heavy Chain Lab',
      '画像修正',
    ],
    graphics: [
      'デザインワークスペース',
      'AIグラフィックデザイン',
      'パターンをベクター画像に変換（プロフェッショナル版）',
      'デザインアレンジ',
      'プリントデザイン',
    ],
  });
});

test('launcher mirrors the observed Lightchain home card routes by category', () => {
  const routesByCategory = Object.fromEntries(
    lightchainCategories.map((category) => [
      category.id,
      getLightchainLauncherFeatures(category.id).map((feature) => feature.route),
    ]),
  );

  assert.deepEqual(routesByCategory, {
    recommended: [
      '/agent',
      '/designProduction',
      '/marketing',
      '/flow/integration',
      '/flow/GenerateShortVideo',
      '/model',
    ],
    planning: [
      '/designProduction',
      '/creator',
      '/flow/orientedDesign',
      '/agent',
      '/tools/fabric',
      '/tools/line-draft-to-tile',
      '/editor/changeColor',
      '/tools/svg-convert',
      '/model-base/style',
    ],
    fitting: [
      '/model',
      '/model-library/model-custom-form',
      '/flow/integration',
      '/flow/GenerateShortVideo',
      '/flow/laboratory',
      '/tools/reactor',
    ],
    graphics: [
      '/designProduction',
      '/printing',
      '/tools/vector-special',
      '/editor/pattern',
      '/editor/patternDesign',
    ],
  });
});

test('launcher uses the canonical Lightchain artwork for planning cards', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /aliyuncs\.com|linkaigc\.com/);
  for (const asset of [
    'aiDesignCover.png',
    'orientedDesignCover.png',
    'FabricBodyCover.png',
    'LineArtToRealCover.png',
    'OneClickChangeColorCover.png',
    'LineArtVectorConvertCover.png',
    'fashionModelCover.png',
  ]) {
    assert.match(source, new RegExp(`/lightchain-assets/mirror/lightchain-qlxy-prod/${asset.replace('.png', '')}-[0-9a-f]+\\.webp`));
  }
});

test('launcher uses the canonical Lightchain artwork for fitting and graphics cards', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  for (const asset of [
    'FittingModelLibraryCover.png',
    'laboratoryCover.png',
    'FixDeformitiesCover.png',
    'GeneratePrintingCover.png',
    'SVGConvertCover.png',
    'OneClickModifyPrintingCover.png',
    'FlowerShapedDesignCover.png',
  ]) {
    assert.match(source, new RegExp(`/lightchain-assets/mirror/lightchain-qlxy-prod/${asset.replace('.png', '')}-[0-9a-f]+\\.webp`));
  }
  assert.match(source, /'remove-background': '\/lightchain-assets\/mirror\/lightchain-qlxy-prod\/FixDeformitiesCover-[0-9a-f]+\.webp'/);
});

test('homepage case tabs use the current Lightchain labels', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /\{ id: 'production', label: '生産' \}/);
  assert.doesNotMatch(source, /生産のつながりです/);
});

test('homepage case tabs keep the widened Lightchain-aligned desktop spacing', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /role="tab"[\s\S]*className=\{`shrink-0 rounded-md px-6 py-2 transition/,
    'case tabs should retain the adjusted horizontal spacing',
  );
});

test('homepage case-sharing starts at the canonical vertical offset without a Heavy-only divider', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /<section className="border-t-0 px-5 pb-8 pt-\[58px\] sm:px-8 lg:px-10">/);
  assert.doesNotMatch(source, /<section className="border-t border-white\/10 px-5 pb-8 pt-10/);
});

test('homepage uses the current Lightchain workspace geometry with Heavy branding', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /<h1 className="sr-only">HEAVY CHAIN<\/h1>/);
  assert.match(source, /<text[^>]*>HEAVY CHAIN AI<\/text>/);
  assert.match(source, /アパレル特化のAIデザインワークスペース/);
  assert.doesNotMatch(source, /<h1[^>]*>アパレル特化のAIデザインワークスペース<\/h1>/);
});

test('workbench homepage copy includes the official video scope', () => {
  const source = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /既存の生成、フィッティング、柄、モデル、動画、Canvasへつながる入口です/);
});

test('homepage does not expose a Heavy-only tool count beside the Lightchain category heading', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /visibleFeatures\.length\} tools/);
});

test('homepage keeps the complete Lightchain baseline cards visible alongside saved artifacts', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /const exampleItems = templates\.map\(\(template, index\) =>/);
  assert.match(source, /buildGalleryExampleImage\(template\.featureId\)/);
  assert.match(source, /return \[\.\.\.exampleItems, \.\.\.persistedItems\]/);
});

test('homepage scopes saved artifacts to the selected Lightchain case tab', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /const persistedCandidates = galleryTab === 'recommended'/);
  assert.match(source, /templates\.some\(\(template\) => template\.featureId === featureId\)/);
  assert.match(source, /\.replace\(\/\^lightchain-\/, ''\)/);
  assert.match(source, /\.replace\(\/-provider-result\$\/, ''\)/);
});

test('homepage uses the current Lightchain three-column card grid before the 2xl four-column breakpoint', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  const grid = source.match(/<div className="([^"]+)" data-testid="lightchain-tool-grid">/);
  assert.ok(grid, 'Lightchain tool grid should remain addressable for parity checks');
  assert.match(grid[1], /\bgrid-cols-1\b/);
  assert.match(grid[1], /\bsm:grid-cols-2\b/);
  assert.match(grid[1], /\bxl:grid-cols-3\b/);
  assert.match(grid[1], /\b2xl:grid-cols-4\b/);
});

test('homepage keeps launcher cards on the current Lightchain fixed card geometry', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /gap-4[^"`]*rounded-2xl[^"`]*p-4/);
  assert.match(source, /h-\[88px\] w-\[132px\]/);
  assert.match(source, /min-h-\[88px\][^"`]*flex-col gap-1/);
  assert.match(source, /text-\[14px\] font-medium leading-6 text-white/);
  assert.match(source, /line-clamp-3 text-\[12px\] leading-4 text-\[#aab8b6\]/);
});

test('homepage uses Light-style gray badges for deferred cards', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /badge === 'Beta' \? 'bg-gradient-to-r from-fuchsia-500 to-rose-500' : 'bg-\[#687070\]'/);
});

test('Lightchain homepage route does not add a Heavy-only padding wrapper around the entry surface', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<div className="py-10">\s*<GenerateLightchainEntry \/>\s*<\/div>/s);
  assert.match(source, /<LightchainUnifiedWorkspaceShell>\s*<GenerateLightchainEntry \/>\s*<\/LightchainUnifiedWorkspaceShell>/s);
});
