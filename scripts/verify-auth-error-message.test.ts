import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthErrorMessage } from '../src/lib/authErrorMessage.ts';

test('maps the Cloudflare service restriction to one actionable message', () => {
  const message = getAuthErrorMessage(
    { name: 'AuthApiError', status: 402, message: 'Service for this project is restricted due to exceed_egress_quota' },
    'fallback',
  );
  assert.equal(message, '認証サービスが利用制限中です。Cloudflare側の利用量、制限、課金設定を確認してください。');
});

test('recognizes a nested provider status without retrying or leaking raw details', () => {
  const message = getAuthErrorMessage(
    { context: { status: 402 }, message: 'provider restriction with internal detail' },
    'fallback',
  );
  assert.equal(message, '認証サービスが利用制限中です。Cloudflare側の利用量、制限、課金設定を確認してください。');
  assert.doesNotMatch(message, /internal detail/);
});

test('keeps ordinary auth messages useful', () => {
  assert.equal(
    getAuthErrorMessage({ message: 'Invalid login credentials' }, 'fallback'),
    'Invalid login credentials',
  );
  assert.equal(getAuthErrorMessage(null, 'fallback'), 'fallback');
});

test('turns auth operation timeouts into a bounded recovery message', () => {
  const message = getAuthErrorMessage(new Error('auth_sign_in_timeout'), 'fallback');
  assert.equal(message, '認証サービスの応答がタイムアウトしました。時間を置いて再試行してください。');
});
