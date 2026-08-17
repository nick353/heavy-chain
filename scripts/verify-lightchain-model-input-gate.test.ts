import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workbench = readFileSync(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');

test('blocks model image-edit subfeatures until the required source image is present', () => {
  assert.match(workbench, /const modelSourceRequired = selectedTool\.category === 'model'/);
  assert.match(workbench, /currentModelPanel\?\.variant !== 'custom'/);
  assert.match(workbench, /modelSourceRequired\s*\n\s*\? materialRequirementsMissing/);
});

test('keeps custom model brief-only generation available', () => {
  assert.match(workbench, /currentModelPanel\?\.variant !== 'custom'/);
  assert.match(workbench, /selectedTool\.id === 'model-library'/);
  assert.match(workbench, /'model-custom'/);
});

test('offers the existing Gallery picker for every required model primary input', () => {
  assert.match(workbench, /既存素材またはアップロード/);
  assert.match(workbench, /Galleryから選ぶ/);
  assert.match(workbench, /openMaterialModalForSlot\('primary'\)/);
  assert.match(workbench, /currentModelPanel\.variant !== 'custom'/);
});

test('does not create a comparison fixture identity without an authoritative image input', () => {
  assert.match(workbench, /const hasAuthoritativeInput = Boolean\(/);
  assert.match(workbench, /const fixtureId = hasAuthoritativeInput\s*\n\s*\? \[/);
  assert.match(workbench, /\n\s*: null;/);
});
