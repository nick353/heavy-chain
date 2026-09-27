import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  HEAVY_IMAGE_PROVIDER,
  HEAVY_IMAGE_PROVIDER_CONFIGURATION_ERROR,
  resolveHeavyImageProviderConfiguration,
} from '../src/lib/heavyImageProvider.ts';

test('Heavy provider selection is OpenAI-only and fails closed on Workers AI config', () => {
  assert.deepEqual(resolveHeavyImageProviderConfiguration(undefined), {
    provider: HEAVY_IMAGE_PROVIDER,
    configurationError: null,
  });
  assert.deepEqual(resolveHeavyImageProviderConfiguration('openai'), {
    provider: HEAVY_IMAGE_PROVIDER,
    configurationError: null,
  });
  assert.equal(
    resolveHeavyImageProviderConfiguration('workers_ai').configurationError,
    HEAVY_IMAGE_PROVIDER_CONFIGURATION_ERROR,
  );
});

test('Heavy UI generation callers do not silently select Workers AI', async () => {
  const [generatePage, canvasPage, chatEditor] = await Promise.all([
    readFile(new URL('../src/pages/GeneratePage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ChatEditor.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(generatePage, /resolveHeavyImageProviderConfiguration/);
  assert.match(generatePage, /Workers AIへは自動切替しません/);
  assert.match(generatePage, /const generationProvider = heavySurface \? HEAVY_IMAGE_PROVIDER : lightGenerationProvider/);
  assert.match(canvasPage, /generationProvider: HEAVY_IMAGE_PROVIDER/);
  assert.match(chatEditor, /generationProvider: HEAVY_IMAGE_PROVIDER/);
  assert.doesNotMatch(canvasPage, /generationProvider:\s*'workers_ai'/);
  assert.doesNotMatch(chatEditor, /generationProvider:\s*'workers_ai'/);
});

test('Light Chain provider surface remains separately owned', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /LIGHTCHAIN_GENERATION_PROVIDER/);
  assert.match(source, /workers_ai/);
});
