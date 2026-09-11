type AuthErrorLike = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  status?: unknown;
  context?: unknown;
};

const getStatus = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
};

const getMessage = (value: unknown) => {
  if (!value || typeof value !== 'object') return String(value || '');
  const candidate = value as AuthErrorLike;
  return [candidate.name, candidate.message, candidate.code]
    .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    .join(' ');
};

/** Keep session rotation narrow: only an expired/invalid Cloudflare auth token may retry. */
export const isAuthFailure = (error: unknown) => {
  const candidate = error as AuthErrorLike;
  const status = getStatus(error) ?? getStatus(candidate?.context);
  if (status === 401) return true;

  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  if (/^(?:invalid_token|invalid_grant|unauthorized)$/i.test(code)) return true;

  return /(?:unauthorized|invalid\s+(?:access|refresh)\s*token|auth(?:entication)?\s+session\s+(?:missing|expired|not found)|token\s+(?:expired|invalid)|401\b)/i.test(getMessage(error));
};

export async function withAuthSessionRecovery<T>(
  operation: () => Promise<T>,
  refreshSession: () => Promise<unknown>,
) {
  try {
    return await operation();
  } catch (firstError) {
    if (!isAuthFailure(firstError)) throw firstError;
    const refreshedSession = await refreshSession();
    if (!refreshedSession) throw firstError;
    return operation();
  }
}
