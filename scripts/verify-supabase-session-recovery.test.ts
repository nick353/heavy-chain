import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSupabaseAuthFailure,
  withSupabaseSessionRecovery,
} from '../src/lib/supabaseSessionRecovery.ts';

test('recognizes bounded Supabase authentication failures without classifying ordinary network errors', () => {
  assert.equal(isSupabaseAuthFailure({ status: 401, message: 'Unauthorized' }), true);
  assert.equal(isSupabaseAuthFailure({ context: { status: 401 }, message: 'non-2xx' }), true);
  assert.equal(isSupabaseAuthFailure({ code: 'PGRST301', message: 'JWT expired' }), true);
  assert.equal(isSupabaseAuthFailure({ name: 'TypeError', message: 'Failed to fetch' }), false);
  assert.equal(isSupabaseAuthFailure({ status: 403, message: 'Insufficient brand permissions' }), false);
});

test('refreshes once and retries the read operation after an authentication failure', async () => {
  let operationCalls = 0;
  let refreshCalls = 0;
  const result = await withSupabaseSessionRecovery(
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
    () => withSupabaseSessionRecovery(
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
    () => withSupabaseSessionRecovery(
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
