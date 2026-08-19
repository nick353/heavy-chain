import assert from 'node:assert/strict';
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
