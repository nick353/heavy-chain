import { importPKCS8, SignJWT } from 'jose';
import type { Env } from './auth.ts';
import { NativeOAuthError } from './native-oauth.ts';

/** Server-only signing: no scheduled six-month secret replacement, no key or
 * signed secret in a user record, response, native bundle, or log. The web
 * Service ID configuration is separate and is never enabled by this helper. */
export async function withAppleNativeSecret(env: Env): Promise<Env> {
  const { APPLE_NATIVE_TEAM_ID: team, APPLE_NATIVE_KEY_ID: kid, APPLE_NATIVE_PRIVATE_KEY: pem } = env;
  // Preserve explicitly configured static credentials (including local fixtures).
  // A partial/invalid signing configuration must not silently fall back to one.
  if (team === undefined && kid === undefined && pem === undefined) return env;
  try {
    if (env.APP_ID !== 'mypro' || !team || !/^[A-Z0-9]{10}$/.test(team)
      || !kid || !/^[A-Z0-9]{10}$/.test(kid) || !pem || pem.length > 4096
      || !env.APPLE_APP_BUNDLE_IDENTIFIER || !/^[A-Za-z0-9][A-Za-z0-9.-]{1,254}$/.test(env.APPLE_APP_BUNDLE_IDENTIFIER)) throw new Error();
    const key = await importPKCS8(pem, 'ES256');
    const now = Math.floor(Date.now() / 1000);
    const secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(team).setSubject(env.APPLE_APP_BUNDLE_IDENTIFIER)
      .setAudience('https://appleid.apple.com').setIssuedAt(now).setExpirationTime(now + 300).sign(key);
    return { ...env, APPLE_NATIVE_CLIENT_SECRET: secret };
  } catch {
    throw new NativeOAuthError('NATIVE_OAUTH_NOT_CONFIGURED', 503);
  }
}
