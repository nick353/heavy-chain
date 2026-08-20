import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getLightchainLauncherBadge,
  getLightchainLauncherFeatures,
  getLightchainLauncherTitle,
  lightchainCategories,
} from '../src/lib/lightchainParityCatalog.ts';

test('launcher mirrors the current Lightchain non-video card counts by category', () => {
  const counts = Object.fromEntries(
    lightchainCategories.map((category) => [category.id, getLightchainLauncherFeatures(category.id).length]),
  );

  assert.deepEqual(counts, {
    recommended: 7,
    planning: 9,
    fitting: 5,
    graphics: 5,
  });
});

test('launcher repeats the same shared Lightchain cards across categories and excludes video', () => {
  const allFeatures = lightchainCategories.flatMap((category) => getLightchainLauncherFeatures(category.id));
  assert.equal(allFeatures.some((feature) => /動画|video/i.test(`${feature.title} ${feature.route}`)), false);
  assert.equal(getLightchainLauncherFeatures('recommended').some((feature) => feature.id === 'design-workspace'), true);
  assert.equal(getLightchainLauncherFeatures('planning').some((feature) => feature.id === 'design-workspace'), true);
  assert.equal(getLightchainLauncherFeatures('graphics').some((feature) => feature.id === 'design-workspace'), true);
  assert.equal(getLightchainLauncherFeatures('fitting').some((feature) => feature.id === 'virtual-fitting'), true);
  assert.equal(getLightchainLauncherFeatures('recommended').some((feature) => feature.id === 'virtual-fitting'), true);
});

test('launcher uses Lightchain display labels instead of internal readiness labels', () => {
  const fitting = getLightchainLauncherFeatures('fitting');
  const graphics = getLightchainLauncherFeatures('graphics');

  assert.equal(getLightchainLauncherTitle(fitting.find((feature) => feature.id === 'heavychain-lab')!), 'Lightchain Lab');
  assert.equal(getLightchainLauncherTitle(fitting.find((feature) => feature.id === 'remove-background')!), '画像修正');
  assert.equal(getLightchainLauncherTitle(graphics.find((feature) => feature.id === 'print-design')!), 'プリントデザイン');
  assert.equal(getLightchainLauncherBadge(getLightchainLauncherFeatures('recommended').find((feature) => feature.id === 'marketing-workspace')!), 'Beta');
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
      'デザインワークスペース',
      'マーケティングワークスペース',
      'AIフィッティング',
      'ウェアデザインラボ',
      'モデル企画ライブラリ',
      'ファッションスタジオ',
      'デザインエージェント',
    ],
    planning: [
      'デザインワークスペース',
      'インスピレーション',
      'ウェアデザインラボ',
      'デザインエージェント',
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

test('homepage uses the current Lightchain workspace heading', () => {
  const source = readFileSync(new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /アパレル特化のAIデザインワークスペース/);
  assert.doesNotMatch(source, /<h1[^>]*>LIGHTCHAIN AI<\/h1>/);
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

test('Lightchain homepage route does not add a Heavy-only padding wrapper around the entry surface', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<div className="py-10">\s*<GenerateLightchainEntry \/>\s*<\/div>/s);
  assert.match(source, /<LightchainUnifiedWorkspaceShell>\s*<GenerateLightchainEntry \/>\s*<\/LightchainUnifiedWorkspaceShell>/s);
});
