import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeMaterialGenerationMetadata,
  sanitizeMetadataWithoutImageUrls,
} from '../supabase/functions/_shared/materialMetadata.ts';

test('sanitizeMetadataWithoutImageUrls removes nested media urls while preserving safe fields', () => {
  const input = {
    label: 'プリント候補',
    imageModel: 'gpt-image-2',
    metadataVersion: 'v2',
    securityLevel: 'internal',
    count: 3,
    enabled: true,
    imageUrl: 'https://example.com/original.png',
    materialReferences: [
      {
        label: '参考A',
        score: 0.82,
        imageUrl: 'https://example.com/reference-a.png',
        nested: {
          displayUrl: 'data:image/png;base64,AAAA',
          title: '保存対象',
          ratio: 1.2,
        },
      },
    ],
    preview: {
      url: 'https://example.com/preview.png',
      caption: '残す',
      active: false,
    },
  };

  assert.deepEqual(sanitizeMetadataWithoutImageUrls(input), {
    label: 'プリント候補',
    imageModel: 'gpt-image-2',
    metadataVersion: 'v2',
    securityLevel: 'internal',
    count: 3,
    enabled: true,
    materialReferences: [
      {
        label: '参考A',
        score: 0.82,
        nested: {
          title: '保存対象',
          ratio: 1.2,
        },
        hasImage: true,
      },
    ],
    preview: {
      caption: '残す',
      active: false,
    },
    hasImage: true,
  });
});

test('sanitizeMaterialGenerationMetadata strips media urls from nested material payloads', () => {
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

  assert.deepEqual(sanitizeMaterialGenerationMetadata(input), {
    materialReferences: [
      {
        label: 'garment',
        weight: 0.6,
        visible: true,
        nested: {
          name: 'outer',
          opacity: 0.75,
        },
        hasImage: true,
      },
    ],
    layerPlan: {
      id: 'layer-1',
      name: 'main',
      x: 12,
      y: 18,
      active: true,
    },
    maskPlan: {
      label: 'mask',
      spread: 42,
    },
    compositionPreview: {
      title: 'preview',
      rotation: 12,
      opacity: 0.8,
    },
  });
});
