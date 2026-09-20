import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMediaGatewayClient,
  readMediaRuntimeConfig,
} from '../src/lib/mediaGateway.ts';

test('uses only Cloudflare at runtime and rejects retired or malformed deploy configuration', () => {
  assert.deepEqual(readMediaRuntimeConfig({}), {
    providerOrder: ['cloudflare_r2'],
    gatewayUrl: null,
    configError: null,
  });

  assert.deepEqual(readMediaRuntimeConfig({
    VITE_MEDIA_PROVIDER_ORDER: 'cloudflare_r2',
    VITE_MEDIA_GATEWAY_URL: 'https://media.example.test/',
  }), {
    providerOrder: ['cloudflare_r2'],
    gatewayUrl: 'https://media.example.test',
    configError: null,
  });

  assert.deepEqual(readMediaRuntimeConfig({ VITE_MEDIA_PROVIDER_ORDER: 'cloudflare_r2,supabase', VITE_MEDIA_GATEWAY_URL: 'https://media.example.test' }), {
    providerOrder: [], gatewayUrl: null, configError: 'invalid_provider_order',
  });

  assert.equal(readMediaRuntimeConfig({ VITE_MEDIA_PROVIDER_ORDER: 'supabase,unknown' }).configError, 'invalid_provider_order');
  assert.equal(readMediaRuntimeConfig({ VITE_MEDIA_GATEWAY_URL: 'http://media.example.test' }).configError, 'invalid_gateway_url');
  assert.equal(readMediaRuntimeConfig({ VITE_MEDIA_GATEWAY_URL: 'https://user:secret@media.example.test' }).configError, 'invalid_gateway_url');
});

test('sends only the user token and validates the gateway response identity', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const client = createMediaGatewayClient({
    baseUrl: 'https://media.example.test',
    getAccessToken: async () => 'supabase-access-token',
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'cloudflare_r2',
          bucket: 'generated-images',
          objectPath: 'brand-1/result.png',
          url: 'https://signed.example.test/result.png?token=short-lived',
        }),
      };
    },
  });

  const result = await client.createSignedReadUrl({
    bucket: 'generated-images',
    objectPath: 'brand-1/result.png',
    expiresInSeconds: 30,
  });
  assert.equal(result.ok, true);
  assert.match(requests[0]?.url ?? '', /\/v1\/media\/read\?bucket=generated-images&path=brand-1%2Fresult.png&expiresIn=60/);
  assert.equal(requests[0]?.authorization, 'Bearer supabase-access-token');

  const mismatchedClient = createMediaGatewayClient({
    baseUrl: 'https://media.example.test',
    getAccessToken: async () => 'token',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        bucket: 'generated-images',
        objectPath: 'other/path.png',
        url: 'https://signed.example.test/other.png',
      }),
    }),
  });
  assert.deepEqual(
    await mismatchedClient.createSignedReadUrl({ bucket: 'generated-images', objectPath: 'brand-1/result.png' }),
    { ok: false, code: 'invalid_response' },
  );

  const incompleteIdentityClient = createMediaGatewayClient({
    baseUrl: 'https://media.example.test',
    getAccessToken: async () => 'token',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://signed.example.test/result.png' }),
    }),
  });
  assert.deepEqual(
    await incompleteIdentityClient.createSignedReadUrl({ bucket: 'generated-images', objectPath: 'brand-1/result.png' }),
    { ok: false, code: 'invalid_response' },
  );
});

test('limits gateway reads to the three private media buckets', async () => {
  const requests: string[] = [];
  const client = createMediaGatewayClient({
    baseUrl: 'https://media.example.test',
    getAccessToken: async () => 'supabase-access-token',
    fetchImpl: async (url) => {
      requests.push(url);
      const parsed = new URL(url);
      const bucket = parsed.searchParams.get('bucket');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          provider: 'cloudflare_r2',
          bucket,
          objectPath: 'user-1/brand-1/result.png',
          url: 'https://signed.example.test/result.png?token=short-lived',
        }),
      };
    },
  });

  for (const bucket of ['generated-images', 'brand-assets', 'exports']) {
    const result = await client.createSignedReadUrl({
      bucket,
      objectPath: 'user-1/brand-1/result.png',
    });
    assert.equal(result.ok, true);
  }
  assert.equal(requests.length, 3);

  let requestCount = 0;
  const invalidBucketClient = createMediaGatewayClient({
    baseUrl: 'https://media.example.test',
    getAccessToken: async () => 'supabase-access-token',
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.deepEqual(
    await invalidBucketClient.createSignedReadUrl({
      bucket: 'feedback-screenshots',
      objectPath: 'user-1/brand-1/result.png',
    }),
    { ok: false, code: 'invalid_response' },
  );
  assert.equal(requestCount, 0);
});

test('fails closed when the browser has no application session', async () => {
  let requestCount = 0;
  const client = createMediaGatewayClient({
    baseUrl: 'https://media.example.test',
    getAccessToken: async () => null,
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: false, status: 401, json: async () => ({}) };
    },
  });

  assert.deepEqual(
    await client.createSignedReadUrl({ bucket: 'generated-images', objectPath: 'brand-1/result.png' }),
    { ok: false, code: 'missing_access_token' },
  );
  assert.equal(requestCount, 0);
});

test('requires an HTTPS gateway origin before sending an access token', async () => {
  let requestCount = 0;
  const client = createMediaGatewayClient({
    baseUrl: 'http://media.example.test',
    getAccessToken: async () => 'supabase-access-token',
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  assert.deepEqual(
    await client.createSignedReadUrl({ bucket: 'generated-images', objectPath: 'brand-1/result.png' }),
    { ok: false, code: 'gateway_not_configured' },
  );
  assert.equal(requestCount, 0);
});

test('rejects an invalid object path before reading credentials or making a gateway request', async () => {
  let calls = 0;
  const client = createMediaGatewayClient({ baseUrl: 'https://media.example.test',
    getAccessToken: async () => { calls++; return 'fixture-session'; },
    fetchImpl: async () => { calls++; throw new Error('unexpected_fetch'); },
  });
  assert.deepEqual(await client.createSignedReadUrl({ bucket: 'generated-images', objectPath: '../private.png' }), { ok: false, code: 'invalid_response' });
  assert.equal(calls, 0);
});
