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
  const [canvasPage, chatEditor] = await Promise.all([
    readFile(new URL('../src/pages/CanvasEditorPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ChatEditor.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(canvasPage, /generationProvider: HEAVY_IMAGE_PROVIDER/);
  assert.match(chatEditor, /generationProvider: HEAVY_IMAGE_PROVIDER/);
  assert.doesNotMatch(canvasPage, /generationProvider:\s*'workers_ai'/);
  assert.doesNotMatch(chatEditor, /generationProvider:\s*'workers_ai'/);
});

test('Light Chain provider surface remains separately owned', async () => {
  const source = await readFile(new URL('../src/pages/LightchainWorkbenchPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /HEAVY_WORKBENCH_GENERATION_PROVIDER/);
  assert.match(source, /HEAVY_IMAGE_PROVIDER/);
  assert.doesNotMatch(source, /generationProvider:\s*LIGHTCHAIN_GENERATION_PROVIDER/);
});

test('production Heavy API config and adapter remain OpenAI-authoritative', async () => {
  const [productionConfig, imageAi, openAiImage] = await Promise.all([
    readFile(new URL('../cloudflare/heavy-api/wrangler.production.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../cloudflare/heavy-api/src/image-ai.ts', import.meta.url), 'utf8'),
    readFile(new URL('../cloudflare/heavy-api/src/openai-image.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(productionConfig, /"AI_IMAGE_PROVIDER"\s*:\s*"openai"/);
  assert.match(imageAi, /env\.AI_IMAGE_PROVIDER\?\.trim\(\) === 'workers_ai' \? 'workers_ai' : 'openai'/);
  assert.match(imageAi, /requested && requested !== provider/);
  assert.match(openAiImage, /env\.OPENAI_IMAGE_API_KEY\?\.trim\(\) \|\| env\.OPENAI_API_KEY\?\.trim\(\)/);
  assert.doesNotMatch(openAiImage, /VITE_OPENAI|localStorage|getItem\(['"]OPENAI/);
});
