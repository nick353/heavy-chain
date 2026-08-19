import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const catalogPath = new URL('../src/lib/lightchainParityCatalog.ts', import.meta.url);
const entryPath = new URL('../src/components/GenerateLightchainEntry.tsx', import.meta.url);

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

test('routes fabric search prompts to the simulation entry', async () => {
  const source = await readFile(entryPath, 'utf8');
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
  assert.match(source, /'\/lightchain\/fabric-image': Shirt/);
  assert.match(source, /'\/tools\/fabric': Shirt/);
  assert.match(source, /'\/lightchain\/printing-image': Palette/);
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
