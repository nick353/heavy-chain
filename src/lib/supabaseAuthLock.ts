/**
 * Supabase Auth uses a browser-wide lock for session storage operations.
 *
 * The SDK's default lock uses an unlimited wait for operations such as
 * getSession(). A crashed or still-running tab can therefore leave a new
 * tab waiting forever while the app's own timeout only cancels the wrapper,
 * not the underlying Navigator Lock request. Keep the coordination
 * semantics, but bound the wait and fail closed on contention.
 */

export type SupabaseAuthLock = <T>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<T>,
) => Promise<T>;

export const DEFAULT_SUPABASE_AUTH_LOCK_TIMEOUT_MS = 4_000;

type LockManagerLike = {
  request: (
    name: string,
    options: Record<string, unknown>,
    callback: (lock: { name: string } | null) => Promise<unknown>,
  ) => Promise<unknown>;
};

const lockTimeoutError = (name: string, timeoutMs: number) => {
  const error = new Error(`supabase_auth_lock_timeout:${name}:${timeoutMs}`) as Error & {
    isAcquireTimeout?: boolean;
  };
  error.isAcquireTimeout = true;
  return error;
};

const getLockManager = (): LockManagerLike | null => {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as typeof globalThis & {
    navigator?: { locks?: LockManagerLike };
  }).navigator?.locks;
  return candidate && typeof candidate.request === 'function' ? candidate : null;
};

export const createBoundedSupabaseAuthLock = (
  timeoutMs = DEFAULT_SUPABASE_AUTH_LOCK_TIMEOUT_MS,
): SupabaseAuthLock => async <T>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<T>,
): Promise<T> => {
  const lockManager = getLockManager();
  if (!lockManager) return fn();

  const configuredTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_SUPABASE_AUTH_LOCK_TIMEOUT_MS;
  const effectiveTimeout = acquireTimeout === 0
    ? 0
    : acquireTimeout > 0
      ? Math.min(acquireTimeout, configuredTimeout)
      : configuredTimeout;

  if (effectiveTimeout === 0) {
    const result = await lockManager.request(
      name,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) throw lockTimeoutError(name, 0);
        return fn();
      },
    );
    return result as T;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const result = await lockManager.request(
      name,
      { mode: 'exclusive', signal: controller.signal },
      async (lock) => {
        if (!lock) throw lockTimeoutError(name, effectiveTimeout);
        return fn();
      },
    );
    return result as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw lockTimeoutError(name, effectiveTimeout);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
