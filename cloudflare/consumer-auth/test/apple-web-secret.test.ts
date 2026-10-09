import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { appleReady } from '../src/auth.ts';
import { withAppleWebSecret } from '../src/apple-web-secret.ts';
import { setup } from './helpers.ts';

test('Heavy web Apple secret is signed for the Services ID and expires in five minutes', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const key = await generateKeyPair('ES256', { extractable: true });
  Object.assign(s.env, { APPLE_CLIENT_ID: 'com.Example.web', APPLE_WEB_TEAM_ID: 'TEAM123456',
    APPLE_WEB_KEY_ID: 'KEY1234567', APPLE_WEB_PRIVATE_KEY: await exportPKCS8(key.privateKey) });
  const configured = await withAppleWebSecret(s.env);
  const verified = await jwtVerify(configured.APPLE_CLIENT_SECRET!, key.publicKey,
    { algorithms: ['ES256'], issuer: 'TEAM123456', audience: 'https://appleid.apple.com', subject: 'com.Example.web' });
  assert.equal(verified.protectedHeader.kid, 'KEY1234567');
  assert.equal(verified.payload.exp! - verified.payload.iat!, 300);
  assert.equal(s.env.APPLE_CLIENT_SECRET, undefined, 'no mutation of the durable environment');
  assert.equal(appleReady(configured), true);
});

test('partial or invalid Apple web config and MyPro leave Apple disabled', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const key = await generateKeyPair('ES256', { extractable: true });
  const full = { APPLE_CLIENT_ID: 'com.Example.web', APPLE_WEB_TEAM_ID: 'TEAM123456', APPLE_WEB_KEY_ID: 'KEY1234567',
    APPLE_WEB_PRIVATE_KEY: await exportPKCS8(key.privateKey) };
  for (const config of [{ ...full, APPLE_WEB_KEY_ID: undefined }, { ...full, APPLE_WEB_PRIVATE_KEY: 'invalid-pem' },
    { ...full, APPLE_WEB_TEAM_ID: 'foreign' }, { ...full, APP_ID: 'mypro' as const }]) {
    const env = await withAppleWebSecret({ ...s.env, ...config });
    assert.equal(env.APPLE_CLIENT_SECRET, undefined);
    assert.equal(appleReady(env), false);
  }
});

test('providers endpoint reports only configured sign-in providers', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  assert.deepEqual(await (await s.request('/api/auth/providers')).json(), { google: false, apple: false });
  Object.assign(s.env, { GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret' });
  const response = await s.request('/api/auth/providers');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { google: true, apple: false });
});
