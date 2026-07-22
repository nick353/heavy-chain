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
  assert.match(feature, /route: '\/lightchain\/fabric-image'/);
});

test('keeps print-image try-on beside fabric simulation in graphics', async () => {
  const source = await readFile(catalogPath, 'utf8');
  const featureStart = source.indexOf("id: 'printing-image'");
  assert.notEqual(featureStart, -1, 'printing-image catalog entry is required');
  const featureEnd = source.indexOf("id: 'lineart-to-real'", featureStart);
  const feature = source.slice(featureStart, featureEnd === -1 ? source.length : featureEnd);
  assert.match(feature, /category: 'graphics'/);
  assert.match(feature, /route: '\/lightchain\/printing-image'/);
});

test('routes fabric search prompts to the simulation entry', async () => {
  const source = await readFile(entryPath, 'utf8');
  assert.match(source, /keywords: \['生地', 'fabric', '布'\], featureId: 'fabric-simulation'/);
  assert.match(source, /'\/lightchain\/fabric-image': Shirt/);
  assert.match(source, /'\/lightchain\/printing-image': Palette/);
});
