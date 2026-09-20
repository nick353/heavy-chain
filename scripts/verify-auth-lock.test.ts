import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoundedAuthLock,
} from '../src/lib/authLock.ts';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
}

test.afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    delete (globalThis as typeof globalThis & { navigator?: unknown }).navigator;
  }
});

test('falls back to the operation when Navigator LockManager is unavailable', async () => {
  setNavigator({});
  const lock = createBoundedAuthLock(20);
  await assert.doesNotReject(async () => {
    assert.equal(await lock('auth', -1, async () => 'ok'), 'ok');
  });
});

test('bounds an unlimited auth acquire timeout and runs the callback under the lock', async () => {
  let observedName = '';
  let observedOptions: Record<string, unknown> | null = null;
  let callbackCalls = 0;
  setNavigator({
    locks: {
      request: async (name: string, options: Record<string, unknown>, callback: (lock: { name: string }) => Promise<unknown>) => {
        observedName = name;
        observedOptions = options;
        return callback({ name });
      },
    },
  });

  const lock = createBoundedAuthLock(40);
  const result = await lock('lock:auth-token', -1, async () => {
    callbackCalls += 1;
    return 'session';
  });

  assert.equal(result, 'session');
  assert.equal(callbackCalls, 1);
  assert.equal(observedName, 'lock:auth-token');
  assert.equal(observedOptions?.mode, 'exclusive');
  assert.ok(observedOptions?.signal instanceof AbortSignal);
});

test('fails closed when another tab keeps the auth lock', async () => {
  setNavigator({
    locks: {
      request: (_name: string, options: Record<string, unknown>) => new Promise((_, reject) => {
        const signal = options.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    },
  });

  const lock = createBoundedAuthLock(10);
  await assert.rejects(
    () => lock('lock:auth-token', -1, async () => 'must-not-run'),
    (error: Error & { isAcquireTimeout?: boolean }) => (
      error.isAcquireTimeout === true
      && error.message === 'auth_lock_timeout:lock:auth-token:10'
    ),
  );
});

test('preserves immediate lock semantics when auth requests acquireTimeout zero', async () => {
  let callbackCalls = 0;
  setNavigator({
    locks: {
      request: async (_name: string, options: Record<string, unknown>, callback: (lock: { name: string } | null) => Promise<unknown>) => {
        assert.equal(options.ifAvailable, true);
        return callback(null);
      },
    },
  });

  const lock = createBoundedAuthLock(10);
  await assert.rejects(
    () => lock('lock:auth-token', 0, async () => {
      callbackCalls += 1;
      return 'must-not-run';
    }),
    (error: Error & { isAcquireTimeout?: boolean }) => error.isAcquireTimeout === true,
  );
  assert.equal(callbackCalls, 0);
});
