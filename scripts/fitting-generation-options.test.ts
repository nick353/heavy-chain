import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fittingGenerationOptions, FITTING_ASPECT_RATIOS, FITTING_RESOLUTIONS } from '../src/lib/fittingGenerationOptions.ts';

test('スマート and 2K are the server defaults, so nothing is sent', () => {
  assert.equal(fittingGenerationOptions('スマート', '2K'), undefined);
  assert.equal(fittingGenerationOptions(null, undefined), undefined);
});

test('the chosen frame and 画質 are sent as the request takes them', () => {
  assert.deepEqual(fittingGenerationOptions('1:1', '4K'), { aspectRatio: '1:1', resolution: '4k' });
  assert.deepEqual(fittingGenerationOptions('16:9', '1K'), { aspectRatio: '16:9', resolution: '1k' });
  assert.deepEqual(fittingGenerationOptions('スマート', '4K'), { resolution: '4k' });
  assert.deepEqual(fittingGenerationOptions('3:2', '2K'), { aspectRatio: '3:2' });
});

test('a frame the server does not take is left out instead of being rejected with 422', () => {
  assert.equal(fittingGenerationOptions('21:9', '2K'), undefined);
  assert.deepEqual(fittingGenerationOptions('21:9', '4K'), { resolution: '4k' });
});

test('every frame the panel offers is one the server accepts', () => {
  const contracts = readFileSync(new URL('../cloudflare/heavy-api/src/image-ai-contracts.ts', import.meta.url), 'utf8');
  const line = contracts.split('\n').find(row => row.includes('const ratios: Record<string, [number,number]>'));
  assert.ok(line, 'the server still declares its frames in image-ai-contracts.ts');
  const serverRatios = new Set([...line!.matchAll(/'(\d+:\d+)'/g)].map(match => match[1]));
  assert.equal(serverRatios.size, 9);
  for (const ratio of FITTING_ASPECT_RATIOS) {
    if (ratio === 'スマート') continue;
    assert.ok(serverRatios.has(ratio), `the server takes ${ratio}`);
    assert.deepEqual(fittingGenerationOptions(ratio, '2K'), { aspectRatio: ratio });
  }
});

test('the panel still offers exactly the three 画質 steps the request knows', () => {
  assert.deepEqual([...FITTING_RESOLUTIONS], ['1K', '2K', '4K']);
});

test('AIフィッティング passes the two settings to the model-matrix request', () => {
  const page = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.ok(
    page.includes('...(isFittingDetail ? fittingGenerationOptions(fittingAspectRatio, fittingResolution) ?? {} : {}),'),
    'the generateModelMatrix call still spreads the panel settings',
  );
});
