import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { appleReady } from '../src/auth.ts';
import { withAppleNativeSecret } from '../src/apple-native-secret.ts';
import { setup } from './helpers.ts';

test('native Apple signing binds the exact app/team/key, expires in five minutes, and never enables web Apple', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const key = await generateKeyPair('ES256', { extractable: true });
  Object.assign(s.env, { APP_ID: 'mypro', APPLE_APP_BUNDLE_IDENTIFIER: 'com.MyPro.native',
    APPLE_NATIVE_TEAM_ID: 'TEAM123456', APPLE_NATIVE_KEY_ID: 'KEY1234567', APPLE_NATIVE_PRIVATE_KEY: await exportPKCS8(key.privateKey) });
  const configured = await withAppleNativeSecret(s.env);
  const verified = await jwtVerify(configured.APPLE_NATIVE_CLIENT_SECRET!, key.publicKey,
    { algorithms: ['ES256'], issuer: 'TEAM123456', audience: 'https://appleid.apple.com', subject: 'com.MyPro.native' });
  assert.equal(verified.protectedHeader.kid, 'KEY1234567');
  assert.equal(verified.payload.exp! - verified.payload.iat!, 300);
  assert.ok(Math.abs(verified.payload.iat! - Date.now() / 1000) < 3);
  assert.equal(s.env.APPLE_NATIVE_CLIENT_SECRET, undefined, 'no mutation of the durable environment');
  assert.equal(appleReady(configured), false);
  assert.equal(configured.AUTH_SECRET, s.env.AUTH_SECRET);
  const response = await s.request('/api/auth/sign-in/native', { provider: 'apple' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'INVALID_NATIVE_CREDENTIAL' });
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
});

test('partial/wrong signing config fails closed without using static or web credentials; Google remains independent', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.env.APP_ID = 'mypro'; s.env.APPLE_APP_BUNDLE_IDENTIFIER = 'com.MyPro.native';
  s.env.APPLE_NATIVE_CLIENT_SECRET = 'static-local-fixture';
  assert.equal(await withAppleNativeSecret(s.env), s.env);
  s.env.APPLE_NATIVE_KEY_ID = 'KEY1234567';
  for (const config of [{}, { APPLE_NATIVE_TEAM_ID: 'TEAM123456', APPLE_NATIVE_PRIVATE_KEY: 'invalid-pem' },
    { APP_ID: 'heavy' as const }, { APPLE_NATIVE_TEAM_ID: 'foreign' }]) {
    await assert.rejects(withAppleNativeSecret({ ...s.env, ...config }), { code: 'NATIVE_OAUTH_NOT_CONFIGURED', status: 503 });
  }
  const response = await s.request('/api/auth/sign-in/native', { provider: 'apple' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'NATIVE_OAUTH_NOT_CONFIGURED' });
  Object.assign(s.env, { GOOGLE_CLIENT_ID: 'google-web', GOOGLE_IOS_CLIENT_ID: 'google-ios', GOOGLE_CLIENT_SECRET: 'local-google-secret' });
  assert.equal((await s.request('/api/auth/sign-in/native', { provider: 'google' })).status, 401);
  assert.equal(s.db.sql.prepare('SELECT count(*) n FROM user').get()!.n, 0);
});
