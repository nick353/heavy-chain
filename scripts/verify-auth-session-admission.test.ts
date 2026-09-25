import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveAuthReturnPath } from '../src/lib/authRedirect.ts';

const authStore = await readFile(new URL('../src/stores/authStore.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/layout/Layout.tsx', import.meta.url), 'utf8');
const cloudflareApi = await readFile(new URL('../src/lib/cloudflareApi.ts', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');
const webBoundary = await readFile(new URL('../cloudflare/heavy-web/src/index.mjs', import.meta.url), 'utf8');
const loginPage = await readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8');
const callbackPage = await readFile(new URL('../src/pages/AuthCallbackPage.tsx', import.meta.url), 'utf8');

test('email login admits the returned session before protected-route navigation', () => {
  assert.match(authStore, /signInWithEmail: \(email: string, password: string\) => Promise<User>/);
  assert.match(authStore, /if \(!data\.session\?\.user\) throw new Error\('auth_session_missing_after_sign_in'\)/);
  assert.match(authStore, /user: data\.session\.user/);
  assert.match(loginPage, /await signInWithEmail\(accountId\.trim\(\), password\);[\s\S]*navigate\(resolveAuthReturnPath\(location\.search, window\.location\.origin\)/);
  assert.match(authStore, /AUTH_OPERATION_TIMEOUT_MS\s*=\s*32_000/);
  assert.match(authStore, /'auth_sign_in_timeout'/);
});

test('source-style login redirect preserves internal path, query, and fragment only', () => {
  assert.equal(resolveAuthReturnPath('?redirect=%2F%3F', 'https://heavy.test'), '/?');
  assert.equal(
    resolveAuthReturnPath('?redirect=%2Fmodel%2Fclothing%3Fmode%3Dmulti%23history', 'https://heavy.test'),
    '/model/clothing?mode=multi#history',
  );
  assert.equal(resolveAuthReturnPath('', 'https://heavy.test'), '/designProduction');
  assert.equal(resolveAuthReturnPath('?redirect=%2F%2Fevil.test%2Fpath', 'https://heavy.test'), '/designProduction');
  assert.equal(resolveAuthReturnPath('?redirect=https%3A%2F%2Fevil.test', 'https://heavy.test'), '/designProduction');
  assert.equal(resolveAuthReturnPath('?redirect=%2F%5Cevil.test', 'https://heavy.test'), '/designProduction');
});

test('protected routes preserve the original URL for ordinary and recovery logins', () => {
  assert.match(app, /const returnTo = `\$\{location\.pathname\}\$\{location\.search\}\$\{location\.hash\}`;/);
  assert.equal((app.match(/\/login\?redirect=\$\{encodeURIComponent\(returnTo\)\}/g) ?? []).length, 2);
  assert.match(app, /resolveAuthReturnPath\(location\.search, window\.location\.origin\)/);
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

test('public auth screens wait for the persistent session before converging', () => {
  assert.doesNotMatch(app, /PUBLIC_AUTH_STALL_TIMEOUT_MS/);
  assert.doesNotMatch(app, /authWaitExpired|setAuthWaitExpired/);
  assert.match(app, /Keep public auth screens behind the same session-hydration boundary/);
  assert.match(app, /if \(!isInitialized \|\| isLoading\) \{[\s\S]*WorkspaceLoadingFallback authRecovery=\{authRecoveryRequired\} authServiceUnavailable=\{authServiceUnavailable\}/);
});

test('transient auth service failures never become per-screen login redirects', () => {
  assert.match(authStore, /authServiceUnavailable: boolean/);
  assert.match(authStore, /authRecoveryRequired: !state\.user && !serviceUnavailable/);
  assert.match(app, /authServiceUnavailable && !user/);
  assert.match(app, /再ログインは不要です/);
  assert.match(layout, /authRecoveryRequired, authServiceUnavailable/);
  assert.match(layout, /authRecoveryRequired \|\| authServiceUnavailable/);
  assert.match(webBoundary, /getBrowserSessionState/);
  assert.match(webBoundary, /sessionState === 'anonymous'/);
  assert.doesNotMatch(webBoundary, /if \(!authenticated\) return sourceLoginRedirect/);
});

test('direct route hydration retries one empty session before converging to login', () => {
  assert.match(authStore, /AUTH_EMPTY_SESSION_RETRY_DELAY_MS\s*=\s*250/);
  assert.match(authStore, /if \(!session\) \{[\s\S]*auth\.refreshSession\(\)[\s\S]*session = retry\.data\.session;/);
  assert.match(authStore, /auth_session_retry_timeout/);
});

test('in-workspace actions recover the admitted session instead of prompting per screen', () => {
  assert.match(cloudflareApi, /const recovered = await refreshAuthSession\(\);/);
  assert.match(cloudflareApi, /const recoveredToken = recovered\?\.access_token;/);
  assert.match(dashboard, /ProtectedRoute already admitted the cookie-backed user/);
  assert.doesNotMatch(dashboard, /const \{ data: \{ session \} \} = await auth\.getSession\(\);/);
  assert.doesNotMatch(dashboard, /toast\.error\('ログインが必要です'\)/);
});

console.log('auth session admission tests: 9/9 passed');
