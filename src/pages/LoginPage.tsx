import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { getAuthErrorMessage } from '../lib/authErrorMessage';
import { probeAuthService } from '../lib/auth';
import { resolveAuthReturnPath } from '../lib/authRedirect';
import { HeavyChainLogo } from '../components/icons';
import toast from 'react-hot-toast';

export function LoginPage() {
  const location = useLocation();
  const signupNotice = (() => {
    const params = new URLSearchParams(location.search);
    if (params.get('registered') === '1') return '確認メールを送りました。メール内のリンクを開いてから、ここでログインしてください。';
    if (params.get('verified') === '1') return 'メールアドレスを確認しました。ログインしてください。';
    return null;
  })();
  const navigate = useNavigate();
  const { user, signInWithEmail, isLoading } = useAuthStore();
  const [accountId, setAccountId] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ accountId?: string; password?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [authServiceWarning, setAuthServiceWarning] = useState<string | null>(null);
  const [authServiceChecking, setAuthServiceChecking] = useState(false);

  const checkAuthService = useCallback(async (signal?: AbortSignal) => {
    setAuthServiceChecking(true);
    try {
      await probeAuthService({ signal });
      if (!signal?.aborted) setAuthServiceWarning(null);
    } catch (error: unknown) {
      if (signal?.aborted) return;
      const message = getAuthErrorMessage(error, '');
      setAuthServiceWarning(message.startsWith('認証サービスが利用制限中です') ? message : null);
    } finally {
      // An aborted probe can be the 5s bounded timeout rather than an
      // unmount. Always clear this local gate so login remains actionable.
      setAuthServiceChecking(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      setAuthServiceWarning(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void checkAuthService(controller.signal).finally(() => window.clearTimeout(timeout));

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [checkAuthService, user]);

  const validate = () => {
    const nextErrors: { accountId?: string; password?: string } = {};
    if (!accountId.trim()) nextErrors.accountId = 'アカウントIDを入力してください';
    if (!password) nextErrors.password = 'パスワードを入力してください';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    setAuthError(null);
    try {
      await signInWithEmail(accountId.trim(), password);
      toast.success('ログインしました');
      navigate(resolveAuthReturnPath(location.search, window.location.origin), { replace: true });
    } catch (error: any) {
      const message = getAuthErrorMessage(error, 'ログインに失敗しました');
      setAuthError(message);
      toast.error(message);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070b12] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_72%_at_0%_4%,rgba(0,172,174,0.35),transparent_72%),radial-gradient(50%_48%_at_2%_100%,rgba(29,61,201,0.38),transparent_72%),radial-gradient(42%_52%_at_100%_100%,rgba(23,48,151,0.42),transparent_75%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.11] [background-image:radial-gradient(rgba(137,184,214,0.55)_0.7px,transparent_0.7px)] [background-size:8px_8px]" />
      <div className="relative mx-auto grid min-h-screen w-full max-w-[1200px] items-center gap-8 px-6 py-10 lg:ml-auto lg:mr-6 lg:w-[calc(100%-3rem)] lg:grid-cols-[minmax(0,1fr)_480px] lg:px-0">
        <section className="relative z-10 hidden max-w-[720px] lg:block" aria-labelledby="heavy-chain-login-hero-title">
          <p className="mb-5 text-[clamp(2.5rem,4vw,4rem)] font-semibold leading-none tracking-[0.015em]">HELLO</p>
          <h1 id="heavy-chain-login-hero-title" className="text-[clamp(1.9rem,2.35vw,2.5rem)] font-medium leading-tight tracking-[-0.02em]">
            アパレル生成AIシステムHeavy Chain <span className="text-[#19c8be]">AI</span>
          </h1>
          <p className="mt-7 max-w-[690px] text-base leading-7 text-white/75">
            Heavy Chainは、アパレル業界におけるさまざまな業務で活用できるAI技術を提供しており、企画から販売までの主要プロセスを幅広くサポートします。
          </p>
        </section>

        <section className="relative z-10 mx-auto w-full max-w-[416px] lg:max-w-[480px] rounded-[22px] border border-white/[0.06] bg-[#20252a]/95 px-6 pt-[87px] pb-[57px] shadow-[0_24px_72px_rgba(0,0,0,0.24)] lg:mx-0 lg:justify-self-end sm:px-8 lg:px-0" aria-labelledby="lightchain-login-title">
          <div className="w-full lg:ml-16 lg:w-[352px] lg:translate-x-[3px]">
          <div className="mb-6">
            <div className="mb-3 flex items-center gap-2.5" aria-label="Heavy Chain">
              <HeavyChainLogo height={24} showText={false} className="shrink-0" />
              <span className="text-xs font-semibold tracking-[0.22em] text-white/85">HEAVY CHAIN</span>
            </div>
            <h1 id="lightchain-login-title" className="text-[13px] font-normal leading-6 text-white/80">
              アカウントIDを下に入力してログインをお願いします。
            </h1>
          </div>

            {signupNotice && !authError && (
              <div role="status" data-testid="login-signup-notice" className="mb-6 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm leading-6 text-cyan-50">
                {signupNotice}
              </div>
            )}

            {authError && (
              <div role="alert" className="mb-6 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                {authError}
              </div>
            )}

            {authServiceWarning && !authError && (
              <div role="status" data-testid="auth-service-warning" className="mb-6 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                <div className="flex items-start justify-between gap-4">
                  <span>{authServiceWarning}</span>
                  <button
                    type="button"
                    data-testid="auth-service-recheck"
                    onClick={() => void checkAuthService()}
                    disabled={authServiceChecking}
                    className="shrink-0 rounded-lg border border-amber-200/30 px-2.5 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-200/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {authServiceChecking ? '確認中…' : '認証状態を再確認'}
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-7">
              <label className="block">
                <span className="sr-only">アカウントID</span>
                <input
                  type="text"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  placeholder="アカウントを入力"
                  autoComplete="username"
                  aria-label="アカウントを入力"
                  disabled={isLoading}
                  className="h-12 w-full rounded-[8px] border border-white/10 bg-[#252a2f] px-6 text-sm text-white outline-none placeholder:text-white/40 focus:border-cyan-300/60"
                />
                {errors.accountId && <span className="mt-2 block text-sm text-red-300">{errors.accountId}</span>}
              </label>

              <label className="block">
                <span className="sr-only">パスワード</span>
                <span className="relative block h-12">
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="パスワードを入力する"
                    autoComplete="current-password"
                    aria-label="パスワードを入力する"
                    disabled={isLoading}
                    className="h-full w-full rounded-[8px] border border-white/10 bg-[#252a2f] px-6 text-sm text-white outline-none placeholder:text-white/40 focus:border-cyan-300/60"
                  />
                  <Eye aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                </span>
                {errors.password && <span className="mt-2 block text-sm text-red-300">{errors.password}</span>}
              </label>

              <div className="flex flex-col gap-4">
                <div className="flex justify-end">
                  <Link to="/forget-password" className="text-sm font-semibold leading-[26px] text-cyan-300 transition hover:text-cyan-200">
                    パスワードを忘れましたか?
                  </Link>
                </div>
                <button type="submit" disabled={isLoading} className="h-12 w-full rounded-lg bg-[#12c5bc] text-base font-semibold text-[#071114] transition-colors hover:bg-[#24d1c8] disabled:cursor-not-allowed disabled:opacity-60">
                  ログイン
                </button>
                <p className="text-center text-sm text-white/60">
                  はじめての方は{' '}
                  <Link to="/signup" data-testid="login-signup-link" className="font-semibold text-cyan-300 transition hover:text-cyan-200">新規登録</Link>
                </p>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
