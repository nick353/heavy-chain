import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAuthFailure,
  withAuthSessionRecovery,
} from '../src/lib/authSessionRecovery.ts';

test('recognizes bounded Cloudflare authentication failures without classifying ordinary network errors', () => {
  assert.equal(isAuthFailure({ status: 401, message: 'Unauthorized' }), true);
  assert.equal(isAuthFailure({ context: { status: 401 }, message: 'non-2xx' }), true);
  assert.equal(isAuthFailure({ code: 'invalid_token', message: 'token expired' }), true);
  assert.equal(isAuthFailure({ name: 'TypeError', message: 'Failed to fetch' }), false);
  assert.equal(isAuthFailure({ status: 403, message: 'Insufficient brand permissions' }), false);
});

test('refreshes once and retries the read operation after an authentication failure', async () => {
  let operationCalls = 0;
  let refreshCalls = 0;
  const result = await withAuthSessionRecovery(
    async () => {
      operationCalls += 1;
      if (operationCalls === 1) throw { status: 401, message: 'Unauthorized' };
      return 'readback-ok';
    },
    async () => {
      refreshCalls += 1;
      return { access_token: 'refreshed' };
    },
  );

  assert.equal(result, 'readback-ok');
  assert.equal(operationCalls, 2);
  assert.equal(refreshCalls, 1);
});

test('does not retry non-auth failures or when refresh returns no session', async () => {
  let networkCalls = 0;
  await assert.rejects(
    () => withAuthSessionRecovery(
      async () => {
        networkCalls += 1;
        throw new Error('Failed to fetch');
      },
      async () => ({ access_token: 'unused' }),
    ),
    /Failed to fetch/,
  );
  assert.equal(networkCalls, 1);

  let authCalls = 0;
  let refreshCalls = 0;
  await assert.rejects(
    () => withAuthSessionRecovery(
      async () => {
        authCalls += 1;
        throw { status: 401, message: 'Unauthorized' };
      },
      async () => {
        refreshCalls += 1;
        return null;
      },
    ),
  );
  assert.equal(authCalls, 1);
  assert.equal(refreshCalls, 1);
});
