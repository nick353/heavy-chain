import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFittingPreviewBlockers } from '../src/lib/fittingPreviewReadiness.ts';

test('fitting local preview requires a real brief but not provider-only cutout readiness', () => {
  assert.deepEqual(
    buildFittingPreviewBlockers({
      currentBrandLoaded: true,
      rightsConfirmed: true,
      isGenerating: false,
      garmentImageUrl: 'gallery://garment-1',
      productDescription: '春夏向けの着用イメージ',
      selectedBodyTypesCount: 1,
      selectedAgeGroupsCount: 1,
      patternCount: 1,
    }),
    [],
  );
});

test('fitting local preview rejects an empty or incomplete brief before persistence', () => {
  const blockers = buildFittingPreviewBlockers({
    currentBrandLoaded: true,
    rightsConfirmed: true,
    isGenerating: false,
    productDescription: ' ',
    selectedBodyTypesCount: 0,
    selectedAgeGroupsCount: 0,
    patternCount: 0,
  });

  assert.deepEqual(blockers, ['衣服画像', '生成brief', '体型', '年代']);
});

test('fitting local preview preserves the duplicate-pattern cap', () => {
  assert.deepEqual(
    buildFittingPreviewBlockers({
      currentBrandLoaded: true,
      rightsConfirmed: true,
      isGenerating: false,
      garmentImageUrl: 'gallery://garment-1',
      productDescription: '比較用brief',
      selectedBodyTypesCount: 2,
      selectedAgeGroupsCount: 2,
      patternCount: 4,
    }),
    ['一度に3パターンまで'],
  );
});
