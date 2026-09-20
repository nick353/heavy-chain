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

test('launcher preserves shared cards and exposes deferred video at its guarded route', () => {
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
  assert.equal(recommended[4]?.betaIncluded, false);
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

test('launcher uses Lightchain display labels instead of internal readiness labels', () => {
  const fitting = getLightchainLauncherFeatures('fitting');
  const graphics = getLightchainLauncherFeatures('graphics');

  assert.equal(getLightchainLauncherTitle(fitting.find((feature) => feature.id === 'heavychain-lab')!), 'Lightchain Lab');
  assert.equal(getLightchainLauncherTitle(fitting.find((feature) => feature.id === 'remove-background')!), '画像修正');
  assert.equal(getLightchainLauncherTitle(graphics.find((feature) => feature.id === 'print-design')!), 'プリントデザイン');
  assert.equal(getLightchainLauncherBadge(getLightchainLauncherFeatures('recommended').find((feature) => feature.id === 'marketing-workspace')!), null);
  assert.equal(getLightchainLauncherBadge(getLightchainLauncherFeatures('recommended').find((feature) => feature.id === 'design-agent')!), 'Beta');
  assert.equal(getLightchainLauncherBadge(getLightchainLauncherFeatures('graphics').find((feature) => feature.id === 'design-workspace')!), null);
  assert.equal(getLightchainLauncherBadge(fitting.find((feature) => feature.id === 'remove-background')!), 'まもなく提供終了');
});

test('launcher preserves the current Lightchain card order and display names', () => {
  const titlesByCategory = Object.fromEntries(
    lightchainCategories.map((category) => [
      category.id,
      getLightchainLauncherFeatures(category.id).map((feature) => getLightchainLauncherTitle(feature)),
    ]),
  );

  assert.deepEqual(titlesByCategory, {
    recommended: [
      '企画ワークスペース',
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
      '企画ワークスペース',
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
      'Lightchain Lab',
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

test('homepage uses the current Lightchain workspace heading', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /<h1[^>]*>LIGHTCHAIN AI<\/h1>/);
  assert.match(source, /アパレル特化のAIデザインワークスペース/);
  assert.doesNotMatch(source, /<h1[^>]*>アパレル特化のAIデザインワークスペース<\/h1>/);
});

test('non-video workbench homepage copy does not expose the excluded video scope', () => {
  const source = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /既存の生成、フィッティング、柄、モデル、Canvasへつながる入口です/);
  assert.doesNotMatch(source, /既存の生成、フィッティング、柄、モデル、動画、Canvasへつながる入口です/);
});

test('homepage does not expose a Heavy-only tool count beside the Lightchain category heading', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /visibleFeatures\.length\} tools/);
});

test('homepage keeps the complete Lightchain baseline cards visible alongside saved artifacts', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /const exampleItems = templates\.map\(\(template\) =>/);
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

test('homepage uses the Lightchain wide-desktop four-column card grid', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  const grid = source.match(/<div className="([^"]+)" data-testid="lightchain-tool-grid">/);
  assert.ok(grid, 'Lightchain tool grid should remain addressable for parity checks');
  assert.match(grid[1], /\bgrid-cols-1\b/);
  assert.match(grid[1], /\bsm:grid-cols-2\b/);
  assert.match(grid[1], /\bxl:grid-cols-4\b/);
  assert.doesNotMatch(grid[1], /\b2xl:grid-cols-4\b/);
});

test('homepage keeps launcher cards readable at medium desktop widths', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /gap-3[^"`]*xl:gap-4/);
  assert.match(source, /h-\[80px\] w-\[112px\][^"`]*xl:h-\[88px\] xl:w-\[132px\]/);
  assert.match(source, /text-sm[^"`]*xl:text-base/);
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
