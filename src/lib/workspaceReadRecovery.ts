import { isSupabaseAuthFailure } from './supabaseSessionRecovery.ts';

/**
 * Optional workspace reads may fall back for ordinary failures, but an auth
 * failure must escape so the caller's shared session-recovery wrapper can
 * refresh once and retry the read.
 */
export async function readOptionalWorkspaceValue<T>(
  operation: () => Promise<T>,
  fallback: T,
  onError: (error: unknown) => void,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    onError(error);
    if (isSupabaseAuthFailure(error)) throw error;
    return fallback;
  }
}
