import assert from 'node:assert/strict';
import test from 'node:test';
import { getMigrations } from 'better-auth/db/migration';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { createAuth, emailReady } from '../src/auth.ts';
import { handleRequest } from '../src/index.ts';
import { setup } from './helpers.ts';

test('reviewed SQL matches Better Auth schema using the D1 dialect', async t => {
  const { env, db } = setup(); t.after(() => db.sql.close());
  const migration = await getMigrations(createAuth(env).options);
  assert.equal((await migration.compileMigrations()).replace(/[;\s]/g, ''), '');
});

test('registration requires verification; native token, ES256 JWKS and immediate logout revocation', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const registration = await s.register(); assert.equal(registration.status, 200);
  assert.equal(s.mail.length, 1);
  assert.deepEqual(s.mail[0], {
    from: 'login@example.test', to: 'alice@example.test',
    subject: 'Heavy Chain — メールアドレスの確認', text: s.mail[0]!.text,
  });
  assert.match(s.mail[0]!.text, /^メールアドレスを確認してください。\n\nhttps:\/\/auth\.test\/api\/auth\/verify-email\?token=/);
  assert.match(s.mail[0]!.text, /心当たりがない場合は、このメールを破棄してください。$/);
  assert.equal((await registration.json() as { token: unknown }).token, null);
  assert.equal((await s.login()).status, 403);
  assert.equal((await s.verify()).status, 302);
  const signedIn = await s.login(); assert.equal(signedIn.status, 200);
  const token = signedIn.headers.get('set-auth-token'); assert.ok(token);
  const cookies = signedIn.headers.get('set-cookie')!;
  assert.match(cookies, /HttpOnly/i); assert.match(cookies, /Secure/i); assert.match(cookies, /SameSite=Lax/i); assert.match(cookies, /Path=\//i);
  assert.match(cookies, /Max-Age=2592000/i, 'browser sessions persist for the configured 30-day session window');
  const identity = await s.request('/v1/identity', undefined, token);
  assert.equal(identity.status, 200);
  const principal = await identity.json() as { subject: string; emailVerified: boolean };
  assert.match(principal.subject, /^[0-9a-f-]{36}$/); assert.equal(principal.emailVerified, true);
  assert.equal((await s.request('/v1/identity', undefined, 'forged')).status, 401);
  const access = await (await s.request('/api/auth/token', undefined, token)).json() as { token: string };
  const jwks = await (await s.request('/api/auth/jwks')).json() as Parameters<typeof createLocalJWKSet>[0];
  const verified = await jwtVerify(access.token, createLocalJWKSet(jwks), { issuer: s.env.AUTH_BASE_URL, audience: 'consumer-apps', algorithms: ['ES256'] });
  assert.equal(verified.payload.sub, principal.subject);
  assert.equal(typeof verified.payload.sid, 'string'); assert.equal(verified.payload.email, undefined);
  assert.equal((await s.request('/api/auth/sign-out', {}, token)).status, 200);
  assert.equal((await s.request('/v1/identity', undefined, token)).status, 401);
});

test('password recovery is single-use and revokes all earlier sessions', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  await s.register(); await s.verify();
  const oldToken = (await s.login()).headers.get('set-auth-token')!;
  assert.equal((await s.request('/api/auth/request-password-reset', { email: 'alice@example.test', redirectTo: 'https://web.test/reset-password' })).status, 200);
  const resetToken = new URL(s.link()).pathname.split('/').at(-1)!;
  const newPassword = 'another-local-test-password-9876';
  assert.equal((await s.request('/api/auth/reset-password', { token: resetToken, newPassword: 'L1ght!' })).status, 400,
    'the existing email-link reset keeps its 12-character minimum');
  assert.equal((await s.request('/api/auth/reset-password', { token: resetToken, newPassword })).status, 200);
  assert.equal((await s.request('/v1/identity', undefined, oldToken)).status, 401);
  assert.equal((await s.request('/api/auth/reset-password', { token: resetToken, newPassword })).status, 400);
  assert.equal((await s.login()).status, 401);
  assert.equal((await s.login('alice@example.test', newPassword)).status, 200);
});

test('Heavy password reset OTP is hashed, purpose-limited, bounded and revokes earlier sessions', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  assert.equal((await s.register()).status, 200);

  const mailBeforeUnknownAccount = s.mail.length;
  const unknownAccount = await s.request('/api/auth/email-otp/request-password-reset',
    { email: 'nobody@example.test' }, undefined, { 'cf-connecting-ip': '192.0.2.2' });
  assert.equal(unknownAccount.status, 200);
  assert.equal(s.mail.length, mailBeforeUnknownAccount);
  assert.equal(s.db.sql.prepare("SELECT count(*) AS n FROM verification WHERE identifier LIKE '%forget-password%' AND identifier LIKE '%nobody@example.test%'").get()!.n, 0);

  await s.verify();
  const oldToken = (await s.login()).headers.get('set-auth-token')!;
  const sendCode = await s.request('/api/auth/email-otp/request-password-reset', { email: 'alice@example.test' });
  assert.equal(sendCode.status, 200);
  const message = s.mail.at(-1)!;
  assert.equal(message.to, 'alice@example.test');
  assert.match(message.subject, /パスワード再設定の認証コード/);
  const code = message.text.match(/認証コードです。\n\n([0-9]{6})\n\n/)?.[1];
  assert.ok(code);
  const stored = s.db.sql.prepare("SELECT value FROM verification WHERE identifier LIKE '%forget-password%' AND identifier LIKE '%alice@example.test%'").get() as { value: string };
  assert.ok(stored);
  assert.equal(stored.value.includes(code), false, 'the OTP must not be stored in plaintext');

  const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  assert.equal((await s.request('/api/auth/email-otp/reset-password', {
    email: 'alice@example.test', otp: wrongCode, password: 'NextPass-2026!!12',
  })).status, 400);
  assert.equal((await s.request('/api/auth/email-otp/reset-password', {
    email: 'alice@example.test', otp: code, password: 'x'.repeat(21),
  })).status, 400);
  assert.equal((await s.request('/api/auth/email-otp/reset-password', {
    email: 'alice@example.test', otp: code, password: 'short',
  })).status, 400);

  const newPassword = 'L1ght!';
  assert.equal(newPassword.length >= 6 && newPassword.length <= 20, true);
  assert.equal((await s.request('/api/auth/email-otp/reset-password', {
    email: 'alice@example.test', otp: code, password: newPassword,
  })).status, 200);
  assert.equal((await s.request('/v1/identity', undefined, oldToken)).status, 401);
  assert.equal(s.db.sql.prepare("SELECT count(*) AS n FROM verification WHERE identifier LIKE '%forget-password%' AND identifier LIKE '%alice@example.test%'").get()!.n, 0,
    'the verified OTP must be consumed');
  assert.equal((await s.login()).status, 401);
  assert.equal((await s.login('alice@example.test', newPassword)).status, 200);

  assert.equal((await s.request('/api/auth/email-otp/send-verification-otp', {
    email: 'alice@example.test', type: 'sign-in',
  })).status, 404, 'other email OTP flows stay unavailable');
});

test('MyPro does not expose the Heavy-only password reset OTP endpoints', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.env.APP_ID = 'mypro';
  assert.equal((await s.request('/api/auth/email-otp/request-password-reset', { email: 'alice@example.test' })).status, 404);
  assert.equal((await s.request('/api/auth/email-otp/reset-password', {
    email: 'alice@example.test', otp: '123456', password: 'NextPass-2026!!12',
  })).status, 404);
});

test('mail fixtures keep Heavy and MyPro sender, recipient and subject isolated', async t => {
  const heavy = setup(); const mypro = setup();
  t.after(() => heavy.db.sql.close()); t.after(() => mypro.db.sql.close());
  heavy.env.APP_ID = 'heavy'; heavy.env.EMAIL_FROM = 'heavy@notify.nisen.uk';
  mypro.env.APP_ID = 'mypro'; mypro.env.EMAIL_FROM = 'mypro@notify.nisen.uk';
  assert.equal((await heavy.register('heavy@example.test')).status, 200);
  assert.equal((await mypro.register('mypro@example.test')).status, 200);
  assert.deepEqual(heavy.mail[0], {
    from: 'heavy@notify.nisen.uk', to: 'heavy@example.test',
    subject: 'Heavy Chain — メールアドレスの確認', text: heavy.mail[0]!.text,
  });
  assert.deepEqual(mypro.mail[0], {
    from: 'mypro@notify.nisen.uk', to: 'mypro@example.test',
    subject: '【MyPro】メールアドレスの確認', text: mypro.mail[0]!.text,
  });
  assert.notEqual(heavy.mail[0]!.from, mypro.mail[0]!.from);
  assert.match(mypro.mail[0]!.text, /メールアドレスの確認を完了してください。/);
});

test('unconfigured email, hostile origins, callbacks, unbounded input and missing secrets fail closed', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  assert.equal(emailReady(s.env), true);
  const email = s.env.EMAIL; delete s.env.EMAIL;
  assert.equal(emailReady(s.env), false);
  assert.equal((await s.register()).status, 503);
  assert.equal(s.db.sql.prepare('SELECT count(*) AS n FROM user').get()!.n, 0);
  s.env.EMAIL = email;
  s.env.EMAIL_FROM = 'not-an-email';
  assert.equal(emailReady(s.env), false);
  assert.equal((await s.register()).status, 503);
  s.env.EMAIL_FROM = 'login@example.test';
  assert.equal((await s.request('/api/auth/sign-in/email', {}, undefined, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await handleRequest(new Request('https://evil.test/api/auth/get-session'), s.env)).status, 403);
  assert.equal((await s.request('/api/auth/sign-up/email', { email: 'alice@example.test', password: s.password, name: 'Alice', callbackURL: 'https://evil.test' })).status, 403);
  assert.equal((await s.request('/api/auth/sign-in/email', { oversized: 'x'.repeat(20000) })).status, 413);
  assert.equal(s.mail.length, 0);
  s.env.AUTH_SECRET = '';
  assert.equal((await s.request('/api/auth/get-session')).status, 503);
});

test('D1 rate limits persist between Worker instances', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await s.login()).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  assert.ok(Number(s.db.sql.prepare('SELECT count(*) AS n FROM rateLimit').get()!.n) > 0);
});

test('native OAuth audiences are explicit; Apple origin is limited to its configured callback', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.env.GOOGLE_CLIENT_ID = 'web-client'; s.env.GOOGLE_IOS_CLIENT_ID = 'ios-client'; s.env.GOOGLE_CLIENT_SECRET = 'local-fixture';
  s.env.APPLE_CLIENT_ID = 'web-service'; s.env.APPLE_APP_BUNDLE_IDENTIFIER = 'native.bundle'; s.env.APPLE_CLIENT_SECRET = 'local-fixture';
  const auth = createAuth(s.env);
  assert.deepEqual(auth.options.socialProviders?.google?.clientId, ['web-client', 'ios-client']);
  assert.deepEqual(auth.options.socialProviders?.apple?.clientId, ['web-service', 'native.bundle']);
  assert.ok((auth.options.trustedOrigins as string[]).includes('https://appleid.apple.com'));
  const appleHeaders = { origin: 'https://appleid.apple.com' };
  assert.equal((await s.request('/api/auth/sign-up/email', {}, undefined, appleHeaders)).status, 403);
  assert.equal((await s.request('/api/auth/sign-in/email', {}, undefined, appleHeaders)).status, 403);
  const callback = await s.request('/api/auth/callback/apple', {}, undefined, appleHeaders);
  assert.notEqual((await callback.clone().text()).includes('origin_not_allowed'), true);
  assert.equal((await s.request('/v1/identity', undefined, 'forged')).status, 401);
  delete s.env.APPLE_CLIENT_SECRET;
  assert.equal((await s.request('/api/auth/callback/apple', {}, undefined, appleHeaders)).status, 403);
});

test('MyPro account emails come from "MyPro" with a branded body, and the link pages are MyPro pages', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.env.APP_ID = 'mypro'; s.env.EMAIL_FROM = 'mypro@notify.nisen.uk';
  assert.equal((await s.register('new@example.test')).status, 200);
  const mail = s.sent.at(-1)!;
  assert.deepEqual(mail.from, { name: 'MyPro', email: 'mypro@notify.nisen.uk' });
  assert.equal(mail.subject, '【MyPro】メールアドレスの確認');
  assert.match(mail.text!, /MyPro にご登録いただきありがとうございます/);
  assert.match(mail.html!, /<a href="https:\/\/auth\.test\/api\/auth\/verify-email\?token=[^"]+"[^>]*>メールアドレスを確認する<\/a>/);
  assert.equal((await s.login('new@example.test')).status, 403, 'unverified accounts cannot sign in');
  // A tampered link shows the MyPro help page, not JSON.
  const bad = await handleRequest(new Request(s.link().replace(/token=[^&]+/, 'token=forged')), s.env);
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get('content-type')!, /text\/html/);
  assert.match(await bad.text(), /新しい確認メールが届きます/);
  // The newest mail was resent by the blocked sign-in (no callback): it ends on the success page.
  assert.equal((await s.verify()).status, 200);
  assert.equal((await s.login('new@example.test')).status, 200);
});

test('a MyPro link without a callback ends on the MyPro success page, never a JSON error', async t => {
  const s = setup(); t.after(() => s.db.sql.close());
  s.env.APP_ID = 'mypro'; s.env.EMAIL_FROM = 'mypro@notify.nisen.uk';
  // Resent / app-less sign-ups: Better Auth fills in the bare origin "/".
  assert.equal((await s.request('/api/auth/sign-up/email', { email: 'resend@example.test', password: s.password, name: 'R' })).status, 200);
  const page = await s.verify();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type')!, /text\/html/);
  // A second tap on the same link still shows the success page.
  assert.equal((await s.verify()).status, 200);
  assert.equal((await s.login('resend@example.test')).status, 200);
  // The bare origin itself is a MyPro page, not {"error":"not_found"}.
  const root = await handleRequest(new Request('https://auth.test/'), s.env);
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type')!, /text\/html/);
});
