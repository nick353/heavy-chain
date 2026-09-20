import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalCloudflareImageBody } from '../src/lib/cloudflareImageAI.ts';

test('Cloudflare metadata canonicalization redacts nested media urls while preserving safe fields', () => {
  const input = {
    materialReferences: [
      {
        candidateLabel: 'プリント候補',
        imageModel: 'gpt-image-2',
        metadataVersion: 'v2',
        securityLevel: 'internal',
        count: 3,
        enabled: true,
        label: '参考A',
        score: 0.82,
        imageUrl: 'https://example.com/reference-a.png',
        nested: {
          displayUrl: 'data:image/png;base64,AAAA',
          title: '保存対象',
          ratio: 1.2,
        },
        preview: {
          url: 'https://example.com/preview.png',
          caption: '残す',
          active: false,
        },
      },
    ],
  };

  assert.deepEqual(canonicalCloudflareImageBody(input), {
    materialReferences: [
      {
        candidateLabel: 'プリント候補',
        imageModel: 'gpt-image-2',
        metadataVersion: 'v2',
        securityLevel: 'internal',
        count: 3,
        enabled: true,
        label: '参考A',
        score: 0.82,
        imageUrl: '[provided]',
        nested: {
          displayUrl: '[provided]',
          title: '保存対象',
          ratio: 1.2,
        },
        preview: {
          url: '[provided]',
          caption: '残す',
          active: false,
        },
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(canonicalCloudflareImageBody(input)), /example\.com|AAAA/);
});

test('Cloudflare metadata canonicalization redacts media urls from nested material payloads', () => {
  const input = {
    materialReferences: [
      {
        imageUrl: 'https://example.com/reference-a.png',
        label: 'garment',
        weight: 0.6,
        visible: true,
        nested: {
          url: 'https://example.com/should-drop.png',
          name: 'outer',
          opacity: 0.75,
        },
      },
    ],
    layerPlan: {
      id: 'layer-1',
      name: 'main',
      sourceUrl: 'https://example.com/source.png',
      x: 12,
      y: 18,
      active: true,
    },
    maskPlan: {
      label: 'mask',
      dataUrl: 'data:image/png;base64,BBBB',
      spread: 42,
    },
    compositionPreview: {
      title: 'preview',
      originalUrl: 'blob:https://example.com/aaaa',
      rotation: 12,
      opacity: 0.8,
    },
  };

  assert.deepEqual(canonicalCloudflareImageBody(input), {
    materialReferences: [
      {
        imageUrl: '[provided]',
        label: 'garment',
        weight: 0.6,
        visible: true,
        nested: {
          url: '[provided]',
          name: 'outer',
          opacity: 0.75,
        }
      },
    ],
    layerPlan: {
      id: 'layer-1',
      name: 'main',
      sourceUrl: '[provided]',
      x: 12,
      y: 18,
      active: true,
    },
    maskPlan: {
      label: 'mask',
      dataUrl: '[provided]',
      spread: 42,
    },
    compositionPreview: {
      title: 'preview',
      originalUrl: '[provided]',
      rotation: 12,
      opacity: 0.8,
    },
  });
  assert.doesNotMatch(JSON.stringify(canonicalCloudflareImageBody(input)), /example\.com|AAAA|BBBB/);
});
