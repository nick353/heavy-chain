import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAIModelPreference, setAIModelUser, withAIModelPreference, writeAIModelPreference } from '../src/lib/aiModelPreference.ts';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
};

test('the choice is stored per user', () => {
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
  writeAIModelPreference('alice', { imageModel: 'gpt-image-1.5', textModel: 'claude-haiku-4-5-20251001' });
  assert.deepEqual(readAIModelPreference('alice'), { imageModel: 'gpt-image-1.5', textModel: 'claude-haiku-4-5-20251001' });
  assert.deepEqual(readAIModelPreference('bob'), {});
  setAIModelUser('alice');
  assert.deepEqual(readAIModelPreference(), { imageModel: 'gpt-image-1.5', textModel: 'claude-haiku-4-5-20251001' });
  setAIModelUser(null);
});

test('image requests carry the chosen model and replace a tool built-in model; an explicit generate-screen model wins', () => {
  const preference = { imageModel: 'gpt-image-1', textModel: 'claude-opus-5-5' };
  assert.deepEqual(withAIModelPreference('generate-image', { prompt: 'p' }, preference), { prompt: 'p', preferredImageModel: 'gpt-image-1' });
  assert.deepEqual(withAIModelPreference('edit-image', { prompt: 'p', providerModel: 'gpt-image-1.5' }, preference), { prompt: 'p', preferredImageModel: 'gpt-image-1' });
  assert.deepEqual(withAIModelPreference('generate-image', { generationModel: 'gpt-image-2' }, preference), { generationModel: 'gpt-image-2' });
  assert.deepEqual(withAIModelPreference('generate-image', { providerModel: 'gpt-image-1.5' }, {}), { providerModel: 'gpt-image-1.5' });
});

test('Claude text requests carry the chosen text model', () => {
  for (const action of ['optimize-prompt', 'chat-plan', 'image-plan']) {
    assert.deepEqual(withAIModelPreference(action, { prompt: 'p' }, { textModel: 'claude-opus-5-5' }), { prompt: 'p', textModel: 'claude-opus-5-5' });
  }
  assert.deepEqual(withAIModelPreference('remove-background', { a: 1 }, { imageModel: 'x', textModel: 'y' }), { a: 1 });
});

test('every provider action and the design consultation request pass through the preference', () => {
  const api = readFileSync(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8');
  assert.match(api, /const body = withAIModelPreference\(action, requestBody\);/);
  assert.match(api, /JSON\.stringify\(textModel \? \{ \.\.\.input, textModel \} : input\)/);
  assert.match(api, /this\.request\('\/v1\/ai\/models'\)/);
  const settings = readFileSync(new URL('../src/pages/BrandSettingsPage.tsx', import.meta.url), 'utf8');
  assert.match(settings, /<AIModelSettings \/>/);
});
