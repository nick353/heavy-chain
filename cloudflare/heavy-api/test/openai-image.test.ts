import assert from 'node:assert/strict';
import test from 'node:test';
import { openAIExpectedDimensions, resolveOpenAIModel, runOpenAIImage } from '../src/openai-image.ts';
import type { Env } from '../src/index.ts';
import type { ImageInput } from '../src/image-ai-contracts.ts';
import { pngFixture } from './image-ai-fixture.ts';

const env = (overrides: Record<string, string | undefined> = {}) => ({
  OPENAI_API_KEY: 'server-only-test-key',
  OPENAI_IMAGE_MODEL: 'gpt-image-1-mini',
  ...overrides,
}) as Env;

const input = (references: ImageInput['references'] = []): ImageInput => ({
  action: references.length ? 'edit-image' : 'generate-image', brandId: 'brand', prompt: 'studio product image',
  featureType: 'campaign-image', width: 512, height: 512, references,
  candidates: [{ prompt: 'studio product image', descriptor: { candidateIndex: 0 }, seed: 7 }],
  metadata: {}, parentImageId: null, generation: 1,
});

test('OpenAI generation adapter keeps the credential server-side and parses b64 output', async () => {
  const requestBox: { value?: Request } = {};
  const image = pngFixture(8, 8);
  const result = await runOpenAIImage(env(), 'generate-image', input(), 0, async (url, init) => {
    requestBox.value = new Request(url, init);
    return Response.json({ data: [{ b64_json: Buffer.from(image).toString('base64'), mime_type: 'image/png' }] },
      { headers: { 'x-request-id': 'req-openai-fixture' } });
  });
  assert.equal(result.provider, 'openai');
  assert.equal(result.backendProvider, 'openai-images-api');
  assert.equal(result.providerModel, 'gpt-image-1-mini');
  assert.equal(result.providerTaskId, 'req-openai-fixture');
  assert.match(result.image, /^data:image\/png;base64,/);
  const request = requestBox.value;
  assert(request);
  assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(request.headers.get('authorization'), 'Bearer server-only-test-key');
  assert.deepEqual(await request.json(), { model: 'gpt-image-1-mini', prompt: 'studio product image', n: 1, size: '1024x1024' });
});

test('OpenAI edit adapter sends decoded references as multipart without source URLs', async () => {
  const bytes = pngFixture(8, 8);
  const formBox: { value?: FormData } = {};
  const result = await runOpenAIImage(env({ OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-1' }), 'edit-image', input([{
    bytes, contentType: 'image/png', width: 8, height: 8,
  }]), 0, async (_url, init) => {
    formBox.value = init?.body as FormData;
    return Response.json({ data: [{ b64_json: Buffer.from(bytes).toString('base64') }] });
  });
  assert.equal(result.providerModel, 'gpt-image-1');
  const form = formBox.value;
  assert(form);
  assert.equal(form.get('model'), 'gpt-image-1');
  assert.equal(form.get('n'), '1');
  assert.equal(form.get('size'), '1024x1024');
  const file = form.get('image[]');
  assert(file instanceof File);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

test('OpenAI adapter fails closed without a key and does not echo provider error text', async () => {
  await assert.rejects(
    () => runOpenAIImage(env({ OPENAI_API_KEY: undefined, OPENAI_IMAGE_API_KEY: undefined }), 'generate-image', input(), 0),
    /openai_image_api_key_missing/,
  );
  await assert.rejects(
    () => runOpenAIImage(env(), 'generate-image', input(), 0, async () =>
      Response.json({ error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'server-only-test-key' } }, { status: 401 })),
    (error: unknown) => error instanceof Error && error.message === 'openai_image_request_failed:401:invalid_api_key',
  );
});

test('OpenAI model and output dimensions are explicit and bounded', () => {
  assert.equal(resolveOpenAIModel(env(), 'generate-image'), 'gpt-image-1-mini');
  assert.equal(resolveOpenAIModel(env({ OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-1' }), 'edit-image'), 'gpt-image-1');
  assert.deepEqual(openAIExpectedDimensions(768, 1024), [1024, 1536]);
  assert.deepEqual(openAIExpectedDimensions(1024, 1024), [1024, 1024]);
  assert.throws(() => resolveOpenAIModel(env(), 'edit-image', 'gpt-image-2'), /openai_image_model_not_supported/);
});
