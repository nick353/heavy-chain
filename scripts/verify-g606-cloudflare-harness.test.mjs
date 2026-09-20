import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const harness = await import('./measure-g606-performance.mjs');
const source = await readFile(new URL('./measure-g606-performance.mjs', import.meta.url), 'utf8');
const baseUrl = 'http://127.0.0.1:4173';

test('G606 auth fixture is the explicit Cloudflare browser contract', () => {
  const contract = harness.createCloudflareContract();
  assert.deepEqual(Object.keys(contract.authPayload), ['user', 'session']);
  assert.deepEqual(contract.authPayload.user, {
    id: 'g606-user',
    email: 'g606@example.invalid',
    name: 'G606 User',
    emailVerified: true,
    createdAt: contract.user.created_at,
  });
  assert.equal(contract.authPayload.session.token, 'g606-cloudflare-local-token');
  assert.ok(Date.parse(contract.authPayload.session.expiresAt) > Date.now());
  assert.match(source, /\/api\/auth\/get-session/);
  assert.doesNotMatch(source, /(?:supabase|\/rest\/v1|\/storage\/v1|\/functions\/v1|signedURL|VITE_SUPABASE|readEnvFile)/i);
});

test('G606 Gallery fixture uses Cloudflare generated-image rows and preserves the 500-image stress count', () => {
  const contract = harness.createCloudflareContract();
  assert.equal(contract.images.length, Number(process.env.G606_IMAGE_COUNT || 500));
  assert.ok(contract.images.every((image) => (
    image.brand_id === 'g606-brand'
    && image.user_id === 'g606-user'
    && image.storage_path.startsWith('data:image/svg+xml,')
    && image.image_url === image.storage_path
    && typeof image.metadata?.index === 'number'
  )));
  assert.equal(contract.images.filter((image) => image.is_favorite).length, Math.ceil(contract.images.length / 11));
  assert.equal(harness.isCloudflareContractPath('/v1/generated-images'), true);
  assert.equal(harness.isCloudflareContractPath('/v1/generated-images/g606-image-0'), true);
  assert.equal(harness.isCloudflareContractPath('/v1/legacy-generated-images'), false);
});

test('G606 Canvas init fixture seeds the local working set without provider state', () => {
  const contract = harness.createCloudflareContract();
  const persisted = contract.canvasInitState;
  assert.equal(persisted.version, 0);
  assert.equal(persisted.state.currentProjectId, 'g606-canvas-project');
  assert.equal(persisted.state.projects.length, 1);
  assert.equal(persisted.state.objects.length, Number(process.env.G606_CANVAS_OBJECT_COUNT || 180));
  assert.equal(persisted.state.projects[0].objects.length, persisted.state.objects.length);
  assert.ok(persisted.state.objects.every((object) => object.src.startsWith(baseUrl)));
  assert.equal(Object.hasOwn(persisted, 'access_token'), false);
  assert.equal(contract.canvasDocument.snapshot.objects.length, persisted.state.objects.length);
});

test('G606 network policy allows localhost and explicit mocks, and blocks unknown requests', () => {
  const allowed = [
    `${baseUrl}/`,
    `${baseUrl}/assets/index.js`,
    `${baseUrl}/api/auth/get-session`,
    `${baseUrl}/__g606/cloudflare/v1/profile`,
    `${baseUrl}/v1/generated-images?brand_id=g606-brand&limit=100`,
    'https://heavy-chain-api.nichika2000823.workers.dev/v1/brands',
    'https://fonts.googleapis.com/css2?family=Inter',
  ];
  for (const url of allowed) {
    assert.equal(harness.classifyG606NetworkRequest(url, baseUrl).allowed, true, url);
  }

  const blocked = [
    'https://example.invalid/telemetry',
    'https://example.invalid/v1/profile',
    `${baseUrl}/api/unknown`,
    `${baseUrl}/__g606/cloudflare/v1/unknown`,
    'https://heavy-chain-api.nichika2000823.workers.dev/v1/unknown',
  ];
  for (const url of blocked) {
    const decision = harness.classifyG606NetworkRequest(url, baseUrl);
    assert.equal(decision.allowed, false, url);
    assert.equal(decision.kind, 'blocked', url);
  }
  assert.match(source, /route\.abort\('blockedbyclient'\)/);
});
