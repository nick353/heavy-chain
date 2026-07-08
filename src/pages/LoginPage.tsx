import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chrome, Eye, LockKeyhole, Mail } from 'lucide-react';
import { Button } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';

export function LoginPage() {
  const navigate = useNavigate();
  const { user, signOut, signInWithEmail, signInWithGoogle, signInWithApple, isLoading } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const nextErrors: { email?: string; password?: string } = {};
    if (!email) nextErrors.email = 'メールアドレスを入力してください';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = '有効なメールアドレスを入力してください';
    if (!password) nextErrors.password = 'パスワードを入力してください';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    try {
      await signInWithEmail(email, password);
      toast.success('ログインしました');
      navigate('/generate');
    } catch (error: any) {
      toast.error(error.message || 'ログインに失敗しました');
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      toast.error(error.message || 'Googleログインに失敗しました');
    }
  };

  const handleAppleLogin = async () => {
    try {
      await signInWithApple();
    } catch (error: any) {
      toast.error(error.message || 'Appleログインに失敗しました');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success('ログアウトしました');
      navigate('/login', { replace: true });
    } catch (error: any) {
      toast.error(error.message || 'ログアウトに失敗しました');
    }
  };

  return (
    <main className="min-h-screen bg-[#05090b] px-4 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-[1500px] flex-col">
        <header className="flex items-center justify-between">
          <Link to="/" className="text-sm font-semibold tracking-[0.32em] text-white">
            HEAVYCHAIN
          </Link>
          <Link to="/" className="rounded-full border border-white/10 px-4 py-2 text-sm text-neutral-300 transition hover:bg-white/10 hover:text-white">
            トップへ
          </Link>
        </header>

        {user && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">
            <div className="min-w-0">
              <p className="font-semibold">現在ログイン中です</p>
              <p className="truncate text-cyan-100/80">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isLoading}
              className="shrink-0 rounded-full border border-cyan-200/30 px-4 py-2 font-semibold text-cyan-50 transition hover:bg-cyan-200/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              ログアウト
            </button>
          </div>
        )}

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_520px]">
          <div className="hidden lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">APPAREL AI WORKSPACE</p>
            <h1 className="mt-5 max-w-3xl text-6xl font-semibold leading-none tracking-normal">
              LIGHTCHAIN型の制作フローを、そのままHeavy Chainへ。
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-400">
              おすすめ、企画デザインツール、AIフィッティング、グラフィックツールから制作を開始します。
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#171b1d] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-10">
            <div className="mb-8">
              <p className="text-sm font-semibold tracking-[0.26em] text-white">HEAVYCHAIN</p>
              <h2 className="mt-6 text-2xl font-semibold">アカウントIDを下に入力してログインをお願いします。</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="sr-only">メールアドレス</span>
                <span className="flex min-h-[58px] items-center gap-3 rounded-xl bg-[#101416] px-4 ring-1 ring-white/5 focus-within:ring-cyan-300/70">
                  <Mail className="h-5 w-5 text-neutral-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="office@example.com"
                    autoComplete="email"
                    disabled={isLoading}
                    className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-neutral-500"
                  />
                </span>
                {errors.email && <span className="mt-2 block text-sm text-red-300">{errors.email}</span>}
              </label>

              <label className="block">
                <span className="sr-only">パスワード</span>
                <span className="flex min-h-[58px] items-center gap-3 rounded-xl bg-[#101416] px-4 ring-1 ring-white/5 focus-within:ring-cyan-300/70">
                  <LockKeyhole className="h-5 w-5 text-neutral-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="password"
                    autoComplete="current-password"
                    disabled={isLoading}
                    className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-neutral-500"
                  />
                  <Eye className="h-5 w-5 text-neutral-500" />
                </span>
                {errors.password && <span className="mt-2 block text-sm text-red-300">{errors.password}</span>}
              </label>

              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-sm font-semibold text-cyan-300 transition hover:text-cyan-200">
                  パスワードを忘れましたか?
                </Link>
              </div>

              <Button type="submit" isLoading={isLoading} size="lg" className="min-h-[58px] w-full rounded-xl bg-cyan-300 text-base font-semibold text-neutral-950 hover:bg-cyan-200">
                ログイン
              </Button>
            </form>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-neutral-200 transition hover:bg-white/10"
              >
                <Chrome className="h-4 w-4" />
                Google
              </button>
              <button
                type="button"
                onClick={handleAppleLogin}
                disabled={isLoading}
                className="min-h-[48px] rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-neutral-200 transition hover:bg-white/10"
              >
                Apple
              </button>
            </div>

            <p className="mt-7 text-center text-sm text-neutral-400">
              アカウントをお持ちでない場合は{' '}
              <Link to="/signup" className="font-semibold text-cyan-300 hover:text-cyan-200">
                新規登録
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
