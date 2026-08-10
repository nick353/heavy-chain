import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildAssetAnchoredPreviewDataUrl } from '../src/features/lightchain/assetAnchoredPreview.ts';

const source = 'data:image/png;base64,AAAA';
const secondary = 'data:image/jpeg;base64,BBBB';
const workbenchSource = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

test('asset preview embeds the exact source and secondary material', () => {
  const result = buildAssetAnchoredPreviewDataUrl({
    sourceImageUrl: source,
    secondaryImageUrl: secondary,
    title: 'プリントイメージ',
    summary: 'primary / secondary',
    mode: 'asset',
  });

  const decoded = decodeURIComponent(result.split(',', 2)[1]);
  assert.match(decoded, /data:image\/png;base64,AAAA/);
  assert.match(decoded, /data:image\/jpeg;base64,BBBB/);
  assert.match(decoded, /data-preview-kind="asset-anchored-v2"/);
  assert.match(decoded, /入力素材を保持/);
});

test('visual modes keep the uploaded asset while changing only the presentation filter', () => {
  const line = decodeURIComponent(buildAssetAnchoredPreviewDataUrl({
    sourceImageUrl: source,
    title: '平絵生成',
    summary: 'line-art',
    mode: 'line-art',
  }).split(',', 2)[1]);
  const vector = decodeURIComponent(buildAssetAnchoredPreviewDataUrl({
    sourceImageUrl: source,
    title: 'SVG化',
    summary: 'vector',
    mode: 'vector',
  }).split(',', 2)[1]);

  assert.match(line, /url\(#line-art\)/);
  assert.match(vector, /url\(#vector\)/);
  assert.match(line, /data:image\/png;base64,AAAA/);
  assert.match(vector, /data:image\/png;base64,AAAA/);
  assert.notEqual(line, vector);
});

test('non-image input fails closed instead of creating a fake result', () => {
  assert.throws(
    () => buildAssetAnchoredPreviewDataUrl({
      sourceImageUrl: 'https://example.invalid/image.png',
      title: 'bad',
      summary: 'bad',
      mode: 'asset',
    }),
    /asset_anchored_preview_source_image_required/,
  );
});

test('line-generation renders the real result instead of fixed pending cards', () => {
  assert.match(workbenchSource, /\{lightchainResult \? \(/);
  assert.doesNotMatch(workbenchSource, /Array\.from\(\{ length: 4 \}\)/);
});

test('generated result controls are not clipped by the empty-state aspect ratio', () => {
  assert.match(workbenchSource, /lightchainResult \? 'min-h-\[420px\] overflow-visible' : 'aspect-\[16\/9\] overflow-hidden'/);
});
