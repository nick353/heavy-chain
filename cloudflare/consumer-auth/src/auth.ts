import { betterAuth } from 'better-auth';
import { bearer, jwt } from 'better-auth/plugins';
import { bindVerificationLink } from './email-verification.ts';
import { NativeOAuthError, persistNativeGrant, type NativeGrant } from './native-oauth.ts';
import { recordBrowserConsent } from './provider-validation.ts';
import { reserveMailAttempt, type MailBudgetEnv } from './mail-budget.ts';
import { AUTH_RATE_WINDOW_SECONDS } from './housekeeping.ts';
import { sendEmail } from './email.ts';

// Request-local only: Better Auth may swallow delivery callback exceptions.
export const mailFailure = Symbol('mailFailure');

export interface Env extends MailBudgetEnv {
  [mailFailure]?: { error?: Error };
  APP_ID?: 'heavy' | 'mypro';
  AUTH_DB: D1Database;
  AUTH_SECRET: string;
  AUTH_BASE_URL: string;
  WEB_ORIGINS: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_IOS_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_APP_BUNDLE_IDENTIFIER?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_NATIVE_CLIENT_SECRET?: string;
  APPLE_NATIVE_TEAM_ID?: string;
  APPLE_NATIVE_KEY_ID?: string;
  APPLE_NATIVE_PRIVATE_KEY?: string;
}

export function allowedOrigins(env: Env): string[] {
  return [env.AUTH_BASE_URL, ...env.WEB_ORIGINS.split(',')].map(s => s.trim()).filter(Boolean);
}

export function emailReady(env: Env): boolean {
  return Boolean(typeof env.EMAIL?.send === 'function' && env.EMAIL_FROM
    && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.EMAIL_FROM));
}

export function appleReady(env: Env): boolean {
  return Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET);
}

async function sendLink(env: Env, to: string, url: string, purpose: 'verify' | 'reset') {
  try {
  if (!emailReady(env)) throw new Error('email_not_configured');
  await reserveMailAttempt(env);
  // Never log credentials or links. Await provider acceptance; it is not proof of delivery.
  const receipt = await sendEmail(env, {
    from: env.EMAIL_FROM!, to,
    subject: `${env.APP_ID === 'mypro' ? 'MyPro' : 'Heavy Chain'} — ${purpose === 'verify' ? 'メールアドレスの確認' : 'パスワードの再設定'}`,
    text: `${purpose === 'verify' ? 'メールアドレスを確認してください。' : 'パスワードを再設定してください。'}\n\n${url}\n\n心当たりがない場合は、このメールを破棄してください。`,
  });
  if (!receipt.messageId) throw new Error('email_acceptance_unconfirmed');
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('email_unavailable');
    if (env[mailFailure]) env[mailFailure].error = failure;
    throw failure;
  }
}

export function createAuth(env: Env, origin = env.AUTH_BASE_URL, nativeGrant?: NativeGrant, reauthenticationSubject?: string) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !allowedOrigins(env).includes(origin)) {
    throw new Error('auth_configuration_invalid');
  }
  const nativeApple = nativeGrant?.provider === 'apple';
  const browserConsent = async (account: { id: string; userId: string; providerId: string;
    accessToken?: string | null; refreshToken?: string | null; idToken?: string | null }, context: { request?: Request } | null) => {
    if (!context?.request || !['google', 'apple'].includes(account.providerId)
      || new URL(context.request.url).pathname !== '/api/auth/callback/' + account.providerId) return;
    await recordBrowserConsent(env, account);
  };
  // Apple may omit email on a returning authorization. Only the already bound
  // provider subject may recover its previous verified email, never a request.
  const nativeProfile = nativeGrant ? async (profile: { email?: string; sub?: string }) => {
    if (profile.email || profile.sub !== nativeGrant.subject) return {};
    const previous = await env.AUTH_DB.prepare(`SELECT u.email, u.emailVerified FROM user u JOIN account a ON a.userId = u.id
      WHERE a.issuer = ? AND a.accountId = ? AND a.providerId = ?`)
      .bind(nativeGrant.provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com', nativeGrant.subject, nativeGrant.provider)
      .first<{ email: string; emailVerified: number }>();
    return previous ? { email: previous.email, emailVerified: previous.emailVerified === 1 } : {};
  } : undefined;
  return betterAuth({
    appName: env.APP_ID === 'mypro' ? 'MyPro' : 'Heavy Chain',
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    database: env.AUTH_DB,
    trustedOrigins: [...allowedOrigins(env), ...(appleReady(env) ? ['https://appleid.apple.com'] : [])],
    telemetry: { enabled: false },
    // Do not include request bodies, email links, tokens, or provider errors in logs.
    logger: { disabled: true },
    // Better Call otherwise prints raw unexpected errors even with logger
    // disabled. Its router still renders known APIErrors; outer fetch catches
    // unexpected throws and emits only the generic, no-store 503 response.
    onAPIError: { throw: true },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: true,
      cookiePrefix: env.APP_ID === 'mypro' ? 'mypro-auth' : 'consumer-auth',
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => sendLink(env, user.email, url, 'reset'),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) => sendLink(env, user.email, await bindVerificationLink(env, user, url), 'verify'),
    },
    // 1.7.2 binds accounts by issuer + accountId; there is no identityStrategy
    // option. Keep implicit/explicit provider linking disabled.
    account: { accountLinking: { enabled: false } },
    ...(nativeGrant ? { databaseHooks: {
      // Better Auth1.7.2's ID-token route reads provider.disableSignUp, while
      // built-in providers retain it under options. Enforce at the write boundary
      // too: deletion between pre-read and callback must not recreate a user.
      ...(reauthenticationSubject ? {
        user: { create: { before: async () => false as const } },
        account: { create: { before: async () => false as const } },
      } : {}),
      session: { create: { before: async (session: { userId: string }) => {
      if (reauthenticationSubject && session.userId !== reauthenticationSubject) throw new NativeOAuthError('ACCOUNT_MISMATCH', 401);
      await persistNativeGrant(env, session.userId, nativeGrant);
    } } } } } : env.APP_ID === 'mypro' ? { databaseHooks: {
      account: { create: { after: browserConsent }, update: { after: browserConsent } },
    } } : {}),
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true, storage: 'database', window: AUTH_RATE_WINDOW_SECONDS, max: 100,
      customRules: {
        '/sign-in/email': { window: AUTH_RATE_WINDOW_SECONDS, max: 5 },
        '/sign-up/email': { window: AUTH_RATE_WINDOW_SECONDS, max: 3 },
        '/request-password-reset': { window: AUTH_RATE_WINDOW_SECONDS, max: 3 },
        '/send-verification-email': { window: AUTH_RATE_WINDOW_SECONDS, max: 3 },
      },
    },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: {
        clientId: [env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_IOS_CLIENT_ID ? [env.GOOGLE_IOS_CLIENT_ID] : [])], clientSecret: env.GOOGLE_CLIENT_SECRET,
        ...(env.APP_ID === 'mypro' ? { accessType: 'offline' as const, prompt: 'consent' as const } : {}),
        ...(nativeProfile ? { mapProfileToUser: nativeProfile } : {}),
        ...(reauthenticationSubject ? { disableSignUp: true } : {}),
      } } : {}),
      ...(nativeApple || appleReady(env) ? { apple: {
        clientId: nativeApple ? [env.APPLE_APP_BUNDLE_IDENTIFIER!] : [env.APPLE_CLIENT_ID!, ...(env.APPLE_APP_BUNDLE_IDENTIFIER ? [env.APPLE_APP_BUNDLE_IDENTIFIER] : [])],
        clientSecret: nativeApple ? env.APPLE_NATIVE_CLIENT_SECRET! : env.APPLE_CLIENT_SECRET!,
        ...(nativeProfile ? { mapProfileToUser: nativeProfile } : {}),
        ...(reauthenticationSubject ? { disableSignUp: true } : {}),
      } } : {}),
    },
    plugins: [bearer(), jwt({
      jwks: { keyPairConfig: { alg: 'ES256' }, rotationInterval: 60 * 60 * 24 * 30 },
      jwt: {
        issuer: env.AUTH_BASE_URL, audience: 'consumer-apps', expirationTime: '5m',
        definePayload: ({ user, session }) => ({ sid: session.id, email_verified: user.emailVerified }),
      },
    })],
  });
}
