import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFashionStudioDetailGeneration, type FashionStudioGenerationAdapters } from '../src/lib/fashionStudioDetailGeneration.ts';

// 2026-11-12: OpenAI refuses every innerwear-on-model image, so 下着のフィッティング goes to the server's FLUX.2 [dev] route
// and needs the brand's declaration that it may use the model photo and has the person's consent.
const scope = { userId: 'user-1', brandId: 'brand-1', documentId: 'doc-1', generation: 1 };
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the generation controller sends the innerwear route and the consent declaration to the image edit', async () => {
  const seen: Record<string, unknown>[] = [];
  const notReached = () => { throw new Error('not_reached_in_this_test'); };
  const controller = createFashionStudioDetailGeneration({
    assertScope: () => undefined, requestId: () => crypto.randomUUID(),
    editImageWithPrompt: async (_url: string, _prompt: string, _brand: string, options: Record<string, unknown>) => {
      seen.push(options); return { success: false, state: 'failed', requestId: options.idempotencyKey, error: 'image_provider_moderation_blocked' };
    },
    assertCompletedImageEditResult: (result: { success: boolean; error?: string }) => { if (!result.success) throw new Error(result.error); },
    persistProviderResultArtifact: notReached, getCanvasDocument: notReached, updateCanvasDocument: notReached,
    buildUpdatedSnapshot: notReached, findOperationResult: notReached, acknowledgeImageAction: notReached,
  } as unknown as FashionStudioGenerationAdapters);
  const main = { objectId: 'main-1', imageUrl: 'https://example.test/garment.png', verified: true };
  await controller.start({ scope, logicalAttemptKey: 'a', main, prompt: '図2のモデル外観・ポーズ・背景を維持し、全身の服を図1に変更',
    referenceImageUrls: ['https://example.test/model.png'], route: 'innerwear', rightsConfirmed: true });
  await controller.start({ scope, logicalAttemptKey: 'b', main, prompt: 'テキストで生成' });
  assert.equal(seen[0].generationRoute, 'innerwear');
  assert.equal(seen[0].rightsConfirmed, true);
  assert.equal(seen[1].generationRoute, undefined);
  assert.equal(seen[1].rightsConfirmed, undefined);
});

test('the page routes only 下着 to the innerwear route and asks for consent when a model photo is used', () => {
  const page = source('../src/pages/FashionStudioDetailPage.tsx');
  assert.match(page, /if \(fn === 'underwear' && referenceAvailable && !innerwearConsent\) \{ toast\.error\('モデル写真の使用許可と、写っている人の同意を確認してください'\); return; \}/);
  assert.match(page, /\.\.\.\(fn === 'underwear' \? \{ route: 'innerwear' as const, \.\.\.\(chosen\.length && innerwearConsent \? \{ rightsConfirmed: true \} : \{\}\) \} : \{\}\)/);
  assert.match(page, /data-testid="fashion-studio-innerwear-consent"/);
  assert.match(page, /モデル写真の使用許可と、写っている人の同意を得ています/);
});

test('the image edit request carries the route and keeps innerwear references at 512px for FLUX', () => {
  assert.match(source('../src/lib/imageApi.ts'), /\.\.\.\(options\?\.generationRoute \? \{ generationRoute: options\.generationRoute \} : \{\}\),/);
  assert.match(source('../src/lib/cloudflareApi.ts'), /const referenceSide = body\.generationRoute !== 'innerwear' && await this\.imageProvider\(\) === 'openai' \? OPENAI_REFERENCE_SIDE : 512;/);
});
