type AuthErrorLike = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  status?: unknown;
  context?: { status?: unknown } | null;
};

/** Keep auth provider failures actionable without exposing raw provider details. */
export const getAuthErrorMessage = (error: unknown, fallback: string) => {
  const candidate = (error && typeof error === 'object' ? error : null) as AuthErrorLike | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const status = candidate?.status ?? candidate?.context?.status;
  const fingerprint = `${code} ${message}`;

  if (
    status === 402
    || /exceed_egress_quota|service is restricted|service restriction|fair.?use/i.test(fingerprint)
  ) {
    return '認証サービスが利用制限中です。Cloudflare側の利用量、制限、課金設定を確認してください。';
  }

  if (/auth_(?:sign_in|sign_up|oauth)_timeout/i.test(fingerprint)) {
    return '認証サービスの応答がタイムアウトしました。時間を置いて再試行してください。';
  }

  return message || fallback;
};
