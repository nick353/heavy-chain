import { importPKCS8, SignJWT } from 'jose';
import type { Env } from './auth.ts';

/** Heavy web Sign in with Apple: the client secret is signed per request from the
 * team/key/private key, so there is no six-month static secret to replace. The
 * private key never leaves the Worker; partial configuration leaves Apple disabled. */
export async function withAppleWebSecret(env: Env): Promise<Env> {
  const { APPLE_WEB_TEAM_ID: team, APPLE_WEB_KEY_ID: kid, APPLE_WEB_PRIVATE_KEY: pem, APPLE_CLIENT_ID: clientId } = env;
  if (env.APP_ID === 'mypro' || env.APPLE_CLIENT_SECRET || !team || !kid || !pem || !clientId) return env;
  if (!/^[A-Z0-9]{10}$/.test(team) || !/^[A-Z0-9]{10}$/.test(kid) || pem.length > 4096
    || !/^[A-Za-z0-9][A-Za-z0-9.-]{1,254}$/.test(clientId)) return env;
  try {
    const key = await importPKCS8(pem.replace(/\\n/g, '\n'), 'ES256');
    const now = Math.floor(Date.now() / 1000);
    const secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(team).setSubject(clientId)
      .setAudience('https://appleid.apple.com').setIssuedAt(now).setExpirationTime(now + 300).sign(key);
    return { ...env, APPLE_CLIENT_SECRET: secret };
  } catch {
    return env;
  }
}
