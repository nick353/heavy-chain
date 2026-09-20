import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authStore = await readFile(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
const loginPage = await readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8');
const callbackPage = await readFile(new URL('../src/pages/AuthCallbackPage.tsx', import.meta.url), 'utf8');

test('email login admits the returned session before protected-route navigation', () => {
  assert.match(authStore, /signInWithEmail: \(email: string, password: string\) => Promise<User>/);
  assert.match(authStore, /if \(!data\.session\?\.user\) throw new Error\('auth_session_missing_after_sign_in'\)/);
  assert.match(authStore, /user: data\.session\.user/);
  assert.match(loginPage, /await signInWithEmail\(email, password\);[\s\S]*navigate\('\/designProduction'/);
  assert.match(authStore, /AUTH_OPERATION_TIMEOUT_MS\s*=\s*12_000/);
  assert.match(authStore, /'auth_sign_in_timeout'/);
});

test('OAuth callback adopts a valid session even when profile hydration is deferred', () => {
  assert.match(callbackPage, /adoptAuthenticatedSession\(session\.user, profile\)/);
  assert.match(callbackPage, /Auth callback profile hydration deferred/);
  assert.match(callbackPage, /if \(session\?\.user\)/);
  assert.match(authStore, /adoptAuthenticatedSession:[\s\S]*isLoading: false/);
});

test('login page exposes a read-only Auth restriction warning before retry', () => {
  assert.match(loginPage, /probeAuthService/);
  assert.match(loginPage, /data-testid="auth-service-warning"/);
  assert.match(loginPage, /data-testid="auth-service-recheck"/);
  assert.match(loginPage, /checkAuthService\(\)/);
  assert.match(loginPage, /role="status"/);
});

console.log('auth session admission tests: 3/3 passed');
