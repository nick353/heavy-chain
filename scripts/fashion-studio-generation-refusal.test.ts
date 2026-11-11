import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createFashionStudioDetailGeneration, isSettledImageEditFailure,
  type FashionStudioGenerationAdapters, type FashionStudioGenerationInput,
} from '../src/lib/fashionStudioDetailGeneration.ts';

// 2026-11-12 production: a text generation refused by the image service's safety check left the form locked with only
// 保存を再試行, which resent the same refused request. A request the service ended as failed holds nothing.
const scope = { userId: 'user-1', brandId: 'brand-1', documentId: 'doc-1', generation: 1 };
const input = (logicalAttemptKey: string, prompt = '参考画像1のテラスで撮影'): FashionStudioGenerationInput => ({
  scope, logicalAttemptKey, prompt, main: { objectId: 'main-1', imageUrl: 'https://example.test/main.png', verified: true },
  referenceImageUrls: ['https://example.test/ref-1.png', 'https://example.test/ref-2.png'],
});
const notReached = () => { throw new Error('not_reached_in_this_test'); };
const controllerWith = (answer: (requestId: string) => Record<string, unknown>) => {
  const sent: string[] = [];
  const adapters = {
    assertScope: () => undefined,
    requestId: () => crypto.randomUUID(),
    editImageWithPrompt: async (_url: string, _prompt: string, _brand: string, options: { idempotencyKey: string }) => {
      sent.push(options.idempotencyKey);
      return answer(options.idempotencyKey);
    },
    assertCompletedImageEditResult: (result: { success: boolean; error?: string }) => { if (!result.success) throw new Error(result.error || 'failed'); },
    persistProviderResultArtifact: notReached, getCanvasDocument: notReached, updateCanvasDocument: notReached,
    buildUpdatedSnapshot: notReached, findOperationResult: notReached, acknowledgeImageAction: notReached,
  } as unknown as FashionStudioGenerationAdapters;
  return { controller: createFashionStudioDetailGeneration(adapters), sent };
};

test('a request the image service ended as failed is settled and a new AI生成 sends a new request', async () => {
  const { controller, sent } = controllerWith(requestId => ({ success: false, state: 'failed', requestId, error: 'image_provider_moderation_blocked' }));
  const first = await controller.start(input('attempt-1'));
  assert.equal(first.status, 'failure');
  assert.equal(first.settled, true);
  assert.match(first.error ?? '', /moderation_blocked/);
  // Changed prompt (a new logical attempt) is allowed instead of fashion_studio_generation_attempt_unreconciled.
  const changed = await controller.start(input('attempt-2', '別の指示'));
  assert.equal(changed.settled, true);
  // Pressing AI生成 again with the same input also starts a new request rather than replaying the refused one.
  await controller.start(input('attempt-2', '別の指示'));
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent).size, 3);
});

test('a rejection before the job was admitted is settled too', async () => {
  const { controller } = controllerWith(() => ({ success: false, error: 'cloudflare_api_422_image_edit_input_invalid' }));
  assert.equal((await controller.start(input('attempt-1'))).settled, true);
});

test('a lost or still-running request stays held to the same request', async () => {
  const { controller, sent } = controllerWith(requestId => ({ success: false, error: `生成結果を確認できません。依頼 ${requestId} を保持しました。再操作時は同じ依頼を照合します。` }));
  const first = await controller.start(input('attempt-1'));
  assert.equal(first.status, 'failure');
  assert.notEqual(first.settled, true);
  await assert.rejects(controller.start(input('attempt-2', '別の指示')), /fashion_studio_generation_attempt_unreconciled/);
  await controller.start(input('attempt-1'));
  assert.deepEqual(sent, [sent[0], sent[0]]);
});

test('only this request\'s own failed receipt settles it', () => {
  assert.equal(isSettledImageEditFailure({ success: false, state: 'failed', requestId: 'other' }, 'mine'), false);
  assert.equal(isSettledImageEditFailure({ success: false, state: 'running', requestId: 'mine' }, 'mine'), false);
  assert.equal(isSettledImageEditFailure({ success: true, state: 'failed', requestId: 'mine' }, 'mine'), false);
  assert.equal(isSettledImageEditFailure({ success: false, error: 'cloudflare_api_403_legal_safety_prompt_blocked' }, 'mine'), true);
  assert.equal(isSettledImageEditFailure({ success: false, error: 'cloudflare_api_403_forbidden' }, 'mine'), false);
  assert.equal(isSettledImageEditFailure({ success: false, error: 'cloudflare_api_503_token_verifier_unavailable' }, 'mine'), false);
});

test('the page keeps the form editable after a settled failure and offers 保存を再試行 only for a held one', () => {
  const source = readFileSync(new URL('../src/pages/FashionStudioDetailPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const generationHeld = activeGeneration\?\.status === 'failure' && activeGeneration\.settled !== true;/);
  assert.match(source, /const recoveryRequired = \(activeUpload\?\.status === 'failure' && activeUpload\.recoverable === true\) \|\| generationHeld;/);
  assert.match(source, /\{generationHeld && <button type="button" disabled=\{busy\} onClick=\{\(\) => void generate\(true\)\}>保存を再試行<\/button>\}/);
  assert.doesNotMatch(source, /\{activeGeneration\?\.status === 'failure' && <button/);
});
