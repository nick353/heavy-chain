import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Cloudflare API exposes an authenticated, owner-scoped private R2 read gateway', async () => {
  const [core, auth, client] = await Promise.all([
    readFile(new URL('../cloudflare/heavy-api/src/core.ts', import.meta.url), 'utf8'),
    readFile(new URL('../cloudflare/heavy-api/src/auth.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/mediaGateway.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(core, /handleMediaReadGateway/);
  assert.match(core, /url\.pathname !== "\/v1\/media\/read"/);
  assert.match(core, /request\.method !== "GET"/);
  assert.match(core, /bucket !== "generated-images"/);
  assert.match(core, /SELECT id FROM generated_images WHERE id = \? AND user_id = \?/);
  assert.match(core, /provider: "cloudflare_r2"/);
  assert.match(core, /createMediaReadToken/);
  assert.match(auth, /AUTH_SERVICE/);
  assert.match(auth, /AUTH_ISSUER/);
  assert.match(auth, /configuredTokenVerifier/);
  assert.doesNotMatch(core, /supabase\.co|\/rest\/v1|\/auth\/v1|\/functions\/v1/i);
  assert.doesNotMatch(auth, /supabase\.co|\/rest\/v1|\/auth\/v1|\/functions\/v1/i);
  assert.match(client, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(client, /returnedProvider !== 'cloudflare_r2'/);
});

test('The browser gateway contract is read-only, HTTPS-only, and fail-closed', async () => {
  const source = await readFile(new URL('../src/lib/mediaGateway.ts', import.meta.url), 'utf8');
  assert.match(source, /protocol !== HTTPS_PROTOCOL/);
  assert.match(source, /method: 'GET'/);
  assert.match(source, /missing_access_token/);
  assert.match(source, /invalid_response/);
  assert.match(source, /expiresInSeconds/);
  assert.match(source, /Math\.min\(Math\.max\(request\.expiresInSeconds, 60\), 3600\)/);
  assert.doesNotMatch(source, /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|createServiceClient|createUserClient/);
});
