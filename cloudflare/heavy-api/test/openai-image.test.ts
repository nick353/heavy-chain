import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIImageError, openAIExpectedDimensions, resolveOpenAIModel, runOpenAIImage } from '../src/openai-image.ts';
import type { Env } from '../src/index.ts';
import { raster, type ImageInput } from '../src/image-ai-contracts.ts';
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
  assert.deepEqual(await request.json(), { model: 'gpt-image-1-mini', prompt: 'studio product image', n: 1, size: '1024x1024', moderation: 'low' });
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
  assert.deepEqual(await request.json(), { model: 'gpt-image-2', prompt: 'studio product image', n: 1, size: '2048x2048', moderation: 'low' });
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
  assert.deepEqual(await request.json(), { model: 'gpt-image-2', prompt: 'professional adult apparel try-on photograph', n: 1, size: '2048x2048', moderation: 'low' });
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
    [async () => Response.json({error:{type:'rate_limit_error',message:secret}},{status:429,headers:{'retry-after-ms':'1'}}), 'request_rejected', 429],
    [async () => Response.json({error:{type:'invalid_request_error',message:secret}},{status:500}), 'transport_uncertainty', 500],
    [async () => Response.json({error:{type:'invalid_request_error',message:secret}},{status:408}), 'transport_uncertainty', 408],
    [async () => Response.json({error:{type:secret,message:secret}},{status:400}), 'transport_uncertainty', 400],
    [async () => Response.json({error:{type:'image_generation_user_error',code:'moderation_blocked',message:secret}},{status:400}), 'request_rejected', 400],
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
    // A per-minute limit is waited out and resent twice (nothing ran on a 429); every other error is sent once.
    assert.equal(calls, status === 429 ? 3 : 1, category);
  }
});

test('a passing rate limit is waited out, an empty balance is not retried, and both stay recognisable', async () => {
  let calls = 0;
  const ok = await runOpenAIImage(env(), 'generate-image', input(), 0, async () => {
    calls++;
    return calls === 1
      ? Response.json({error:{type:'rate_limit_error',code:'rate_limit_exceeded',message:'slow down'}},{status:429,headers:{'retry-after-ms':'1'}})
      : Response.json({data:[{b64_json:Buffer.from(pngFixture(1024,1024)).toString('base64')}]});
  });
  assert.equal(calls, 2); assert.match(ok.image, /^data:image\/png;base64,/);
  let quotaCalls = 0;
  await assert.rejects(() => runOpenAIImage(env(), 'generate-image', input(), 0, async () => {
    quotaCalls++;
    return Response.json({error:{type:'insufficient_quota',code:'insufficient_quota',message:'no credit'}},{status:429});
  }), (error: unknown) => error instanceof OpenAIImageError && error.errorCode === 'image_provider_quota_exhausted' && error.providerCode === 'insufficient_quota'
    && error.diagnostics.providerType === 'insufficient_quota');
  assert.equal(quotaCalls, 1);
  await assert.rejects(() => runOpenAIImage(env(), 'generate-image', input(), 0, async () =>
    Response.json({error:{type:'rate_limit_error',message:'slow down'}},{status:429,headers:{'retry-after-ms':'1'}})),
  (error: unknown) => error instanceof OpenAIImageError && error.errorCode === 'image_provider_rate_limited');
});

test('OpenAI diagnostic exceptions retain only allowlisted codes and bounded request identifiers', async () => {
  await assert.rejects(() => runOpenAIImage(env(), 'generate-image', input(), 0, async () =>
    Response.json({error:{type:'authentication_error',code:'invalid_api_key',message:'server-only-test-key'}},
      {status:401,headers:{'x-request-id':'req_local_123'}})),
  (error: unknown) => {
    assert(error instanceof OpenAIImageError);
    assert.deepEqual(error.diagnostics,{category:'request_rejected',status:401,providerCode:'invalid_api_key',providerType:'authentication_error',providerRequestId:'req_local_123'});
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

test('edits default to gpt-image-1.5 with input_fidelity=high so the source garment keeps its details (Light parity 2026-10-29)', async () => {
  const image = pngFixture(8, 8);
  const reference = { bytes: pngFixture(8, 8), contentType: 'image/png', width: 8, height: 8 };
  const send = async (overrides: Record<string, string | undefined>) => {
    const box: { value?: Request } = {};
    const result = await runOpenAIImage(env(overrides), 'edit-image', input([reference]), 0, async (url, init) => {
      box.value = new Request(url, init);
      return Response.json({ data: [{ b64_json: Buffer.from(image).toString('base64') }] });
    });
    return { result, form: await box.value!.formData() };
  };
  const preferred = await send({ OPENAI_IMAGE_MODEL: undefined });
  assert.equal(preferred.result.providerModel, 'gpt-image-1.5');
  assert.equal(preferred.form.get('input_fidelity'), 'high');
  assert.equal(preferred.form.get('quality'), 'high');
  // Auto let a pattern come back with a transparent ground; Heavy never asks for transparency.
  assert.equal(preferred.form.get('background'), 'opaque');
  // mini cannot take input_fidelity, so it is not sent there.
  const mini = await send({ OPENAI_IMAGE_EDIT_MODEL: 'gpt-image-1-mini' });
  assert.equal(mini.result.providerModel, 'gpt-image-1-mini');
  assert.equal(mini.form.get('input_fidelity'), null);
  assert.equal(mini.form.get('quality'), null);
});

test('OpenAI edits accept references up to 1536px; Workers AI keeps the 512px limit', async () => {
  const { decodeImage, OPENAI_REFERENCE_SIDE } = await import('../src/image-ai-contracts.ts');
  const wide = `data:image/png;base64,${Buffer.from(pngFixture(1000, 8)).toString('base64')}`;
  assert.equal(decodeImage(wide, true, OPENAI_REFERENCE_SIDE).width, 1000);
  assert.throws(() => decodeImage(wide), /image_reference_exceeds_512px/);
});

test('gpt-image-2 asks for 2048px-class images (Light returns 2048x2048, 2026-10-29); other models keep their sizes', async () => {
  const { openAIExpectedDimensions } = await import('../src/openai-image.ts');
  assert.deepEqual(openAIExpectedDimensions(512, 512, 'gpt-image-2'), [2048, 2048]);
  assert.deepEqual(openAIExpectedDimensions(768, 1152, 'gpt-image-2'), [1360, 2048]);
  assert.deepEqual(openAIExpectedDimensions(1152, 768, 'gpt-image-2'), [2048, 1360]);
  assert.deepEqual(openAIExpectedDimensions(768, 1152, 'gpt-image-1.5'), [1024, 1536]);
  assert.deepEqual(openAIExpectedDimensions(768, 1152), [1024, 1536]);
});

test('OpenAI results are enlarged to Light\'s 2048px-class sizes, and kept as they are when enlarging fails', async () => {
  const { enlargeLikeLight, LIGHT_OUTPUT_SIZES } = await import('../src/image-ai.ts');
  assert.deepEqual(LIGHT_OUTPUT_SIZES['1024x1536'], [1696, 2528]);
  const original = raster(pngFixture(1024, 1536))!;
  const calls: unknown[] = [];
  const outputs: unknown[] = [];
  const images = (result: Uint8Array | Error) => ({ input: () => ({ transform: (options: unknown) => { calls.push(options); return {
    output: async (options: unknown) => { outputs.push(options); if (result instanceof Error) throw result; return { response: () => new Response(result as BufferSource) }; } }; } }) });
  const enlarged = await enlargeLikeLight({ IMAGES: images(pngFixture(1696, 2528)) } as never, original);
  assert.equal(enlarged.width, 1696); assert.equal(enlarged.height, 2528);
  assert.deepEqual(calls[0], { width: 1696, height: 2528, fit: 'cover' });
  // A PNG is written without quality, so Cloudflare keeps full colour instead of a 256-colour palette.
  assert.deepEqual(outputs[0], { format: 'image/png' });
  assert.equal(await enlargeLikeLight({ IMAGES: images(new Error('images_down')) } as never, original), original);
  assert.equal(await enlargeLikeLight({ IMAGES: images(pngFixture(1024, 1536)) } as never, original), original);
  assert.equal(await enlargeLikeLight({} as never, original), original);
  const large = raster(pngFixture(2048, 1360))!;
  assert.equal(await enlargeLikeLight({ IMAGES: images(pngFixture(1, 1)) } as never, large), large);
});

// 画質 (Light's Fashion Studio 生成設定, 2026-11-12): 1K and 4K set the long edge; 4K stays under 9 MB by writing JPEG.
const headerPng = (width: number, height: number, idatBytes = 16) => {
  const bytes = new Uint8Array(8 + 25 + 12 + idatBytes + 12); const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12); view.setUint32(16, width); view.setUint32(20, height);
  view.setUint32(33, idatBytes); bytes.set([73, 68, 65, 84], 37); view.setUint32(45 + idatBytes, 0); bytes.set([73, 69, 78, 68], 49 + idatBytes);
  return bytes;
};
const headerJpeg = (width: number, height: number) => {
  const bytes = new Uint8Array([255, 216, 255, 192, 0, 17, 8, 0, 0, 0, 0, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1, 255, 218, 255, 217]);
  new DataView(bytes.buffer).setUint16(7, height); new DataView(bytes.buffer).setUint16(9, width);
  return bytes;
};
test('画質 1K / 4K resize to the long edge Light uses, and a 4K result over 9 MB as PNG is written as JPEG', async () => {
  const { sizeForResolution, LIGHT_LONG_EDGES, LIGHT_MAX_OUTPUT_BYTES } = await import('../src/image-ai.ts');
  assert.deepEqual(LIGHT_LONG_EDGES, { '1k': 1024, '4k': 4096 });
  assert.equal(LIGHT_MAX_OUTPUT_BYTES, 9 * 1024 * 1024);
  const calls: unknown[] = []; const outputs: Array<Record<string, unknown>> = [];
  const images = (answer: (format: Record<string, unknown>, size: { width: number; height: number }) => Uint8Array | Error) => ({ input: () => ({
    transform: (options: { width: number; height: number }) => { calls.push(options); return {
      output: async (format: Record<string, unknown>) => { outputs.push(format); const result = answer(format, options); if (result instanceof Error) throw result;
        return { response: () => new Response(result as BufferSource) }; } }; } }) });
  const drawn = raster(pngFixture(1024, 1536))!;
  // 4K: PNG when it fits.
  const small = await sizeForResolution({ IMAGES: images((_, size) => headerPng(size.width, size.height)) } as never, drawn, '4k');
  assert.deepEqual([small?.width, small?.height, small?.contentType], [2731, 4096, 'image/png']);
  assert.deepEqual(calls[0], { width: 2731, height: 4096, fit: 'cover' }); assert.deepEqual(outputs[0], { format: 'image/png' });
  // 4K: a photo PNG over 9 MB is written again as JPEG quality 95.
  outputs.length = 0;
  const photo = await sizeForResolution({ IMAGES: images((format, size) => format.format === 'image/png'
    ? headerPng(size.width, size.height, LIGHT_MAX_OUTPUT_BYTES + 1) : headerJpeg(size.width, size.height)) } as never, drawn, '4k');
  assert.deepEqual([photo?.width, photo?.height, photo?.contentType], [2731, 4096, 'image/jpeg']);
  assert.deepEqual(outputs, [{ format: 'image/png' }, { format: 'image/jpeg', quality: 95 }]);
  // 1K shrinks the long edge to 1024; a result already 1024 long is kept as it is.
  const quick = await sizeForResolution({ IMAGES: images((_, size) => headerPng(size.width, size.height)) } as never, drawn, '1k');
  assert.deepEqual([quick?.width, quick?.height], [683, 1024]);
  const flux = raster(pngFixture(768, 1024))!;
  assert.equal(await sizeForResolution({} as never, flux, '1k'), flux);
  // Nothing within 9 MB, a failed or wrong-sized transform, or no binding: null, so the caller keeps the 2K result.
  assert.equal(await sizeForResolution({ IMAGES: images((_, size) => headerPng(size.width, size.height, LIGHT_MAX_OUTPUT_BYTES + 1)) } as never, drawn, '4k'), null);
  assert.equal(await sizeForResolution({ IMAGES: images(() => new Error('images_down')) } as never, drawn, '4k'), null);
  assert.equal(await sizeForResolution({ IMAGES: images(() => headerPng(10, 10)) } as never, drawn, '4k'), null);
  assert.equal(await sizeForResolution({} as never, drawn, '4k'), null);
});

// 2026-11-11 production: the innerwear sample came back 400 from the image safety system and was recorded as a lost
// connection (state unknown), which blocked the same input for good. It is a rejection with its own error code, and the
// requests ask for the documented `low` moderation level that apparel work needs.
test('a safety refusal is a recorded rejection and image requests ask for low moderation', async () => {
  const env = { OPENAI_API_KEY: 'server-only-test-key' } as never;
  let form: FormData | undefined; let json: Record<string, unknown> | undefined;
  const refusal = async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.body instanceof FormData) form = init.body; else if (typeof init?.body === 'string') json = JSON.parse(init.body);
    return Response.json({ error: { type: 'image_generation_user_error', code: 'moderation_blocked', message: 'blocked' } }, { status: 400, headers: { 'x-request-id': 'req_safety_1' } });
  };
  const input = (references: unknown[]) => ({ width: 1024, height: 1536, references, candidates: [{ prompt: 'p', descriptor: {} }] }) as never;
  const png = { bytes: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png', width: 8, height: 8 };
  await assert.rejects(runOpenAIImage(env, 'edit-image', input([png, png]), 0, refusal as typeof fetch), (error: unknown) =>
    error instanceof OpenAIImageError && error.category === 'request_rejected' && error.errorCode === 'image_provider_moderation_blocked'
      && error.diagnostics.providerCode === 'moderation_blocked' && error.diagnostics.providerType === 'image_generation_user_error');
  assert.equal(form?.get('moderation'), 'low');
  await assert.rejects(runOpenAIImage(env, 'generate-image', input([]), 0, refusal as typeof fetch));
  assert.equal(json?.moderation, 'low');
});
