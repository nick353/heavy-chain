import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIImageError, openAIExpectedDimensions, resolveOpenAIModel, runOpenAIImage } from '../src/openai-image.ts';
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

test('OpenAI generation uses gpt-image-2 only when no model is requested or configured', async () => {
  const requestBox: { value?: Request } = {};
  const image = pngFixture(8, 8);
  const result = await runOpenAIImage(env({ OPENAI_IMAGE_MODEL: undefined }), 'generate-image', input(), 0, async (url, init) => {
    requestBox.value = new Request(url, init);
    return Response.json({ data: [{ b64_json: Buffer.from(image).toString('base64') }] });
  });
  assert.equal(result.providerModel, 'gpt-image-2');
  const request = requestBox.value;
  assert(request);
  assert.deepEqual(await request.json(), { model: 'gpt-image-2', prompt: 'studio product image', n: 1, size: '1024x1024' });
});

test('OpenAI edit adapter sends decoded references as multipart without source URLs', async () => {
  const jpegHeaderFixture = (index: number) => new Uint8Array([
    255, 216, 255, 192, 0, 8, 8, 0, 8, 0, 8 + index, 3, 255, 217,
  ]);
  const references: ImageInput['references'] = [0, 1, 2, 3].map(index => ({
    bytes: jpegHeaderFixture(index), contentType: 'image/jpeg', width: 8 + index, height: 8,
  }));
  const png = pngFixture(8, 8, [180, 30, 20]);
  references.push({ bytes: png, contentType: 'image/png', width: 8, height: 8 });
  const formBox: { value?: FormData } = {};
  const result = await runOpenAIImage(env({ OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-1' }), 'edit-image', input(references), 0, async (_url, init) => {
    formBox.value = init?.body as FormData;
    return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64'), mime_type: 'image/png' }] });
  });
  assert.equal(result.providerModel, 'gpt-image-1');
  const form = formBox.value;
  assert(form);
  assert.equal(form.get('model'), 'gpt-image-1');
  assert.equal(form.get('n'), '1');
  assert.equal(form.get('size'), '1024x1024');
  const files = form.getAll('image[]');
  assert.equal(files.length, 5);
  for (const [index, value] of files.entries()) {
    assert(value instanceof File);
    const expectedType = index === 4 ? 'image/png' : 'image/jpeg';
    const expectedExtension = index === 4 ? 'png' : 'jpg';
    assert.equal(value.name, `reference-${index + 1}.${expectedExtension}`);
    assert.equal(value.type, expectedType);
    assert.deepEqual(new Uint8Array(await value.arrayBuffer()), references[index].bytes);
  }
});

test('OpenAI model-matrix without references uses text generation and the requested generation model', async () => {
  const requestBox: { value?: Request } = {};
  const image = pngFixture(8, 8);
  const matrixInput: ImageInput = {
    ...input(),
    action: 'model-matrix',
    featureType: 'model-matrix',
    prompt: 'blue cotton shirt',
    candidates: [{ prompt: 'professional adult apparel try-on photograph', descriptor: { bodyType: 'regular' }, seed: 7 }],
  };
  const result = await runOpenAIImage(env({ OPENAI_IMAGE_MODEL: 'gpt-image-2' }), 'model-matrix', matrixInput, 0, async (url, init) => {
    requestBox.value = new Request(url, init);
    return Response.json({ data: [{ b64_json: Buffer.from(image).toString('base64'), mime_type: 'image/png' }] });
  });
  assert.equal(result.providerModel, 'gpt-image-2');
  const request = requestBox.value;
  assert(request);
  assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
  assert.deepEqual(await request.json(), { model: 'gpt-image-2', prompt: 'professional adult apparel try-on photograph', n: 1, size: '1024x1024' });
});

test('OpenAI adapter fails closed without a key and does not echo provider error text', async () => {
  await assert.rejects(
    () => runOpenAIImage(env({ OPENAI_API_KEY: undefined, OPENAI_IMAGE_API_KEY: undefined }), 'generate-image', input(), 0),
    /openai_image_api_key_missing/,
  );
  await assert.rejects(
    () => runOpenAIImage(env(), 'generate-image', input(), 0, async () =>
      Response.json({ error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'server-only-test-key' } }, { status: 401 })),
    (error: unknown) => error instanceof OpenAIImageError && error.category === 'request_rejected' &&
      error.message === 'image_provider_request_rejected' && error.status === 401 && !JSON.stringify(error).includes('server-only-test-key'),
  );
});

test('OpenAI errors distinguish explicit rejection, uncertain HTTP/transport and unusable responses without leaking text', async () => {
  const secret = 'server-only-test-key private-prompt';
  const cases: Array<[() => Promise<Response>, string, number | undefined]> = [
    [async () => Response.json({error:{type:'invalid_request_error',code:secret,message:secret}},{status:400}), 'request_rejected', 400],
    [async () => Response.json({error:{type:'rate_limit_error',message:secret}},{status:429}), 'request_rejected', 429],
    [async () => Response.json({error:{type:'invalid_request_error',message:secret}},{status:500}), 'transport_uncertainty', 500],
    [async () => Response.json({error:{type:'invalid_request_error',message:secret}},{status:408}), 'transport_uncertainty', 408],
    [async () => Response.json({error:{type:secret,message:secret}},{status:400}), 'transport_uncertainty', 400],
    [async () => new Response(secret,{status:502}), 'transport_uncertainty', 502],
    [async () => { throw new Error(secret); }, 'transport_uncertainty', undefined],
    [async () => Response.json({data:[]}), 'unusable_response', 200],
    [async () => new Response(secret), 'unusable_response', 200],
    [async () => new Response(new ReadableStream({start(controller) { controller.error(new Error(secret)); }})), 'transport_uncertainty', 200],
  ];
  for (const [respond,category,status] of cases) {
    let calls = 0;
    await assert.rejects(() => runOpenAIImage(env(), 'generate-image', input(), 0, async () => { calls++; return respond(); }),
      (error: unknown) => {
        assert(error instanceof OpenAIImageError);
        assert.equal(error.category, category); assert.equal(error.status, status);
        assert(!`${error.message} ${error.stack} ${JSON.stringify(error)}`.includes(secret));
        return true;
      });
    assert.equal(calls, 1, category);
  }
});

test('OpenAI diagnostic exceptions retain only allowlisted codes and bounded request identifiers', async () => {
  await assert.rejects(() => runOpenAIImage(env(), 'generate-image', input(), 0, async () =>
    Response.json({error:{type:'authentication_error',code:'invalid_api_key',message:'server-only-test-key'}},
      {status:401,headers:{'x-request-id':'req_local_123'}})),
  (error: unknown) => {
    assert(error instanceof OpenAIImageError);
    assert.deepEqual(error.diagnostics,{category:'request_rejected',status:401,providerCode:'invalid_api_key',providerRequestId:'req_local_123'});
    assert(!JSON.stringify(error).includes('server-only-test-key')); return true;
  });
  await assert.rejects(() => runOpenAIImage(env(), 'generate-image', input(), 0, async () =>
    Response.json({error:{type:'invalid_request_error',code:'server-only-test-key',message:'private-prompt'}},
      {status:400,headers:{'x-request-id':'Bearer server-only-test-key'}})),
  (error: unknown) => {
    assert(error instanceof OpenAIImageError);
    assert.equal(error.providerCode,undefined); assert.equal(error.providerRequestId,undefined);
    assert(!JSON.stringify(error).includes('server-only-test-key')); return true;
  });
});

test('OpenAI model and output dimensions are explicit and bounded', () => {
  assert.equal(resolveOpenAIModel(env(), 'generate-image'), 'gpt-image-1-mini');
  assert.equal(resolveOpenAIModel(env({ OPENAI_IMAGE_MODEL: undefined }), 'generate-image'), 'gpt-image-2');
  assert.equal(resolveOpenAIModel(env({ OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-1' }), 'edit-image'), 'gpt-image-1');
  assert.deepEqual(openAIExpectedDimensions(768, 1024), [1024, 1536]);
  assert.deepEqual(openAIExpectedDimensions(1024, 1024), [1024, 1024]);
  assert.throws(() => resolveOpenAIModel(env(), 'edit-image', 'gpt-image-2'), /openai_image_model_not_supported/);
});
