const DEFAULT_AUTH_RETURN_PATH = '/designProduction';

/**
 * Resolve the source-style `redirect` query without permitting an external
 * origin. Return the original relative URL so its query and fragment survive.
 */
export function resolveAuthReturnPath(search: string, currentOrigin: string): string {
  const requested = new URLSearchParams(search).get('redirect');
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) {
    return DEFAULT_AUTH_RETURN_PATH;
  }

  try {
    const origin = new URL(currentOrigin).origin;
    const destination = new URL(requested, origin);
    if (destination.origin !== origin) return DEFAULT_AUTH_RETURN_PATH;
    return requested;
  } catch {
    return DEFAULT_AUTH_RETURN_PATH;
  }
}
