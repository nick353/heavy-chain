import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HeavyChainLogo } from '../components/icons';
import { SocialSignInButtons } from '../components/SocialSignInButtons';
import { Button, Input, PasswordStrengthMeter } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import { cloudflareAuthEnabled } from '../lib/auth';
import { getAuthErrorMessage } from '../lib/authErrorMessage';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

export function SignupPage() {
  const navigate = useNavigate();
  const { user, signOut, signUpWithEmail, isLoading } = useAuthStore();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  const validate = () => {
    const newErrors: typeof errors = {};
    
    if (!name) {
      newErrors.name = '名前を入力してください';
    }
    
    if (!email) {
      newErrors.email = 'メールアドレスを入力してください';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = '有効なメールアドレスを入力してください';
    }
    
    if (!password) {
      newErrors.password = 'パスワードを入力してください';
    } else if (password.length < (cloudflareAuthEnabled ? 12 : 8)) {
      newErrors.password = `パスワードは${cloudflareAuthEnabled ? 12 : 8}文字以上で入力してください`;
    }
    
    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'パスワードが一致しません';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    try {
      await signUpWithEmail(email, password, name);
      toast.success('アカウントを作成しました。メールを確認してください。');
      navigate(cloudflareAuthEnabled ? '/login?registered=1' : '/dashboard');
    } catch (error: any) {
      toast.error(getAuthErrorMessage(error, 'アカウント作成に失敗しました'));
    }
  };



  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success('ログアウトしました');
      navigate('/signup', { replace: true });
    } catch (error: any) {
      toast.error(error.message || 'ログアウトに失敗しました');
    }
  };

  return (
    <div className="dark">
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-[#070b12]">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-primary-200/20 blur-[120px] animate-float" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-accent-200/20 blur-[120px] animate-pulse-slow" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/login" className="inline-flex items-center gap-2.5" aria-label="Heavy Chain">
            <HeavyChainLogo height={24} showText={false} className="shrink-0" />
            <span className="text-xs font-semibold tracking-[0.22em] text-white/85">HEAVY CHAIN</span>
          </Link>
        </div>

        {user && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-primary-500/20 bg-primary-500/10 px-4 py-3 text-sm text-primary-900 dark:text-primary-100">
            <div className="min-w-0">
              <p className="font-semibold">現在ログイン中です</p>
              <p className="truncate text-primary-800/80 dark:text-primary-200/80">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isLoading}
              className="shrink-0 rounded-full border border-primary-500/25 px-4 py-2 font-semibold text-primary-900 transition hover:bg-primary-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary-50"
            >
              ログアウト
            </button>
          </div>
        )}

        {/* Card */}
        <div className="glass-panel rounded-2xl p-8 md:p-10 backdrop-blur-xl border-white/40 dark:border-white/10">
          <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white text-center mb-2">
            アカウント作成
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-center mb-8">
            無料で始めましょう
          </p>

          <SocialSignInButtons />

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="text"
              label="名前"
              placeholder="山田 太郎"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              disabled={isLoading}
              className="dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-700 focus:ring-primary-500"
            />
            <Input
              type="email"
              label="メールアドレス"
              placeholder="your@email.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              disabled={isLoading}
              className="dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-700 focus:ring-primary-500"
            />
            <div className="space-y-2">
              <Input
                type="password"
                label="パスワード"
                placeholder={`${cloudflareAuthEnabled ? 12 : 8}文字以上`}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                disabled={isLoading}
                className="dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-700 focus:ring-primary-500"
              />
              <PasswordStrengthMeter password={password} minLength={cloudflareAuthEnabled ? 12 : 8} />
            </div>
            <Input
              type="password"
              label="パスワード（確認）"
              placeholder="もう一度入力"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={errors.confirmPassword}
              disabled={isLoading}
              className="dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-700 focus:ring-primary-500"
            />

            <Button
              type="submit"
              isLoading={isLoading}
              className="w-full shadow-glow hover:shadow-glow-lg transition-all duration-300"
              size="lg"
            >
              アカウントを作成
            </Button>
          </form>

          {/* Terms */}
          <p className="mt-6 text-xs text-center text-neutral-500 dark:text-neutral-400 leading-relaxed">
            アカウントを作成することで、
            <a href="/terms" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:underline mx-1">利用規約</a>
            および
            <a href="/privacy" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:underline mx-1">プライバシーポリシー</a>
            に同意したものとみなされます。
          </p>
        </div>

        {/* Login link */}
        <p className="text-center mt-8 text-neutral-600 dark:text-neutral-400">
          すでにアカウントをお持ちですか？{' '}
          <Link to="/login" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium transition-colors">
            ログイン
          </Link>
        </p>
      </motion.div>
    </div>
    </div>
  );
}
