import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loginPage = await readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8');
const signupPage = await readFile(new URL('../src/pages/SignupPage.tsx', import.meta.url), 'utf8');
const forgotPasswordPage = await readFile(new URL('../src/pages/ForgotPasswordPage.tsx', import.meta.url), 'utf8');

test('login UI exposes an actionable Supabase service restriction message', () => {
  assert.match(loginPage, /getAuthErrorMessage/);
  assert.match(loginPage, /role="alert"/);
  assert.doesNotMatch(loginPage, /if \(authServiceWarning\) \{[\s\S]*setAuthError\(authServiceWarning\);[\s\S]*return;/);
  assert.match(loginPage, /disabled=\{isLoading\}/g);
  assert.doesNotMatch(loginPage, /disabled=\{isLoading \|\| authServiceChecking\}/);
  assert.doesNotMatch(loginPage, /Boolean\(authServiceWarning\)/);
  assert.match(loginPage, /finally \{[\s\S]*setAuthServiceChecking\(false\);/);
  assert.match(signupPage, /getAuthErrorMessage/);
  assert.match(forgotPasswordPage, /getAuthErrorMessage/);
});
