import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const savedFetch = globalThis.fetch, savedWindow = globalThis.window;
globalThis.window = { location: { origin: 'https://gallery-web.test' } };
const vite = await createServer({ configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
  server: { middlewareMode: true }, define: {
    'import.meta.env.VITE_CLOUDFLARE_API_ENABLED': '"true"',
    'import.meta.env.VITE_CLOUDFLARE_AUTH_ENABLED': '"true"',
    'import.meta.env.VITE_CLOUDFLARE_API_BASE_URL': '"https://gallery-api.test"',
  } });
const { auth } = await vite.ssrLoadModule('/src/lib/auth.ts');
const { cloudflareDataPlane: client } = await vite.ssrLoadModule('/src/lib/cloudflareApi.ts');
after(async () => { auth.dispose(); globalThis.fetch = savedFetch; globalThis.window = savedWindow; await vite.close(); });

test('actual browser transport sends purpose/favorite/job predicates with pagination to the API', async () => {
  auth.getSession = async () => ({ data: { session: { user: { id: 'gallery-owner' }, access_token: 'synthetic-gallery-token' } }, error: null });
  const queries = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://gallery-api.test');
    assert.equal(parsed.pathname, '/v1/generated-images');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-gallery-token');
    queries.push(Object.fromEntries(parsed.searchParams)); return Response.json([]);
  };
  await client.listGeneratedImages('brand/one', { assetPurpose: 'print-design', favorite: true, hasJob: true, featureType: 'model-matrix', jobId: 'job/one', order: 'oldest', limit: 20, offset: 50 });
  await client.listGeneratedImages('brand/one', { hasJob: false });
  await client.listGeneratedImages('brand/one');
  assert.deepEqual(queries[0], { brand_id: 'brand/one', limit: '20', offset: '50', favorite: 'true', asset_purpose: 'print-design', has_job: 'true', feature_type: 'model-matrix', job_id: 'job/one', order: 'oldest' });
  assert.deepEqual(queries[1], { brand_id: 'brand/one', limit: '50', offset: '0', has_job: 'false' });
  assert.deepEqual(queries[2], { brand_id: 'brand/one', limit: '50', offset: '0' });
});

test('selector passes current controls into the server query, never an unfiltered 100-row batch', () => {
  const source = readFileSync(new URL('../src/components/GallerySelector.tsx', import.meta.url), 'utf8');
  const call = source.match(/cloudflareDataPlane\.listGeneratedImages\(currentBrand\.id, \{([\s\S]*?)\}\)/)?.[1];
  assert.ok(call);
  assert.match(call, /limit: filter === 'recent' \? 20 : 50/);
  assert.match(call, /favorite: filter === 'favorites' \? true : undefined/);
  assert.match(call, /assetPurpose: assetPurpose === PRINT_DESIGN_ASSET_PURPOSE/);
  assert.match(call, /hasJob: activeLibraryTab === 'generation-history' \? true : undefined/);
  assert.doesNotMatch(call, /limit: 100/);
});

test('Gallery mutations address the canonical API image and never retry a failed deletion', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-gallery-token');
    calls.push({ url: String(url), method: init.method, body: init.body });
    if (init.method === 'PATCH') return Response.json({ id: 'image-1', is_favorite: true });
    return new Response(null, { status: 204 });
  };
  assert.equal((await client.setGeneratedImageFavorite('image-1', true)).is_favorite, true);
  await client.deleteGeneratedImage('image-1');
  assert.deepEqual(calls.map(c => [c.url, c.method]), [
    ['https://gallery-api.test/v1/generated-images/image-1', 'PATCH'],
    ['https://gallery-api.test/v1/generated-images/image-1', 'DELETE'],
  ]);
  assert.deepEqual(JSON.parse(calls[0].body), { is_favorite: true });
  let failures = 0;
  globalThis.fetch = async () => { failures++; return Response.json({ error: 'media_storage_unavailable' }, { status: 502 }); };
  await assert.rejects(() => client.deleteGeneratedImage('image-1'), /media_storage_unavailable/);
  assert.equal(failures, 1);
});

test('migrated Gallery and reuse readers cannot execute old data calls', () => {
  for (const path of ['pages/GalleryPage.tsx', 'pages/DashboardPage.tsx', 'components/GallerySelector.tsx',
    'pages/LightchainLibraryPage.tsx', 'pages/LightchainWorkbenchPage.tsx']) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bsupabase\s*(?:\.|\n)|\bfrom\(['"]generated_images['"]\)/, path);
    assert.match(source, /cloudflareDataPlane\.listGeneratedImages/);
  }
  const dashboard = readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /state\.user\?\.id !== session\.user\.id/);
  assert.match(dashboard, /setCurrentBrand\(confirmedCreatedBrand\)/);
  assert.match(dashboard, /再作成は不要です/);
});

test('Gallery cards expose a keyboard and semantic detail affordance', () => {
  const gallery = readFileSync(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');
  assert.match(gallery, /role="button"/);
  assert.match(gallery, /tabIndex=\{0\}/);
  assert.match(gallery, /aria-label=\{`\$\{image\.prompt \|\| '生成画像'\}の詳細を見る`\}/);
  assert.match(gallery, /event\.key !== 'Enter' && event\.key !== ' '/);
});

test('Gallery detail can read the canonical provider receipt from persisted metadata', () => {
  const gallery = readFileSync(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');
  assert.match(gallery, /getMetadataString\(image, 'providerRequestId'\)/);
  assert.match(gallery, /readImageAIRequest\(selectedProviderRequestId\)/);
  assert.match(gallery, /provider receiptを読む/);
  assert.match(gallery, /persistenceStatus/);
});

test('Fitting and Gallery wire feature/job and order into server-side pagination', () => {
  const fitting = readFileSync(new URL('../src/pages/FittingPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(fitting, /\bfrom\(['"]generated_images['"]\)/);
  assert.match(fitting, /featureType: 'model-matrix', jobId: resumeJob, limit: 1, offset: 0/);
  assert.match(fitting, /featureType: 'model-matrix', limit: 100, offset: 0/);
  const gallery = readFileSync(new URL('../src/pages/GalleryPage.tsx', import.meta.url), 'utf8');
  assert.match(gallery, /order: sortBy === 'oldest' \? 'oldest' : 'newest'/);
});
