import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layers, Chrome } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

export function LoginPage() {
  const navigate = useNavigate();
  const { signInWithEmail, signInWithGoogle, signInWithApple, isLoading } = useAuthStore();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const newErrors: { email?: string; password?: string } = {};
    
    if (!email) {
      newErrors.email = 'メールアドレスを入力してください';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = '有効なメールアドレスを入力してください';
    }
    
    if (!password) {
      newErrors.password = 'パスワードを入力してください';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    try {
      await signInWithEmail(email, password);
      toast.success('ログインしました');
      navigate('/dashboard');
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

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-surface-50 dark:bg-surface-950">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-primary-200/20 blur-[120px] animate-float" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-accent-200/20 blur-[120px] animate-pulse-slow" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-3 group">
            <div className="w-12 h-12 bg-gradient-to-br from-primary-600 to-primary-800 rounded-2xl flex items-center justify-center shadow-glow group-hover:scale-105 transition-transform duration-500">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <span className="font-display text-2xl font-semibold text-neutral-900 dark:text-white tracking-wide">
              Heavy Chain
            </span>
          </Link>
        </div>

        {/* Card */}
        <div className="glass-panel rounded-2xl p-8 md:p-10 backdrop-blur-xl border-white/40 dark:border-white/10">
          <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white text-center mb-2">
            おかえりなさい
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-center mb-8">
            アカウントにログインしてください
          </p>

          {/* OAuth Buttons */}
          <div className="space-y-3 mb-6">
            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl hover:bg-white/80 dark:hover:bg-white/10 transition-all duration-300"
            >
              <Chrome className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
              <span className="font-medium text-neutral-700 dark:text-neutral-200">Googleでログイン</span>
            </button>
            <button
              onClick={handleAppleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-xl hover:bg-neutral-800 transition-all duration-300"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              <span className="font-medium">Appleでログイン</span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-sm text-neutral-400 dark:text-neutral-500">または</span>
            <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
          </div>

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              type="email"
              label="メールアドレス"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              disabled={isLoading}
              className="bg-white/50 dark:bg-neutral-900/50 border-neutral-200 dark:border-neutral-700 focus:ring-primary-500"
            />
            <div className="space-y-1">
              <Input
                type="password"
                label="パスワード"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                disabled={isLoading}
                className="bg-white/50 dark:bg-neutral-900/50 border-neutral-200 dark:border-neutral-700 focus:ring-primary-500"
              />
              <div className="flex justify-end">
                <Link
                  to="/forgot-password"
                  className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 transition-colors"
                >
                  パスワードをお忘れですか？
                </Link>
              </div>
            </div>

            <Button
              type="submit"
              isLoading={isLoading}
              className="w-full shadow-glow hover:shadow-glow-lg transition-all duration-300"
              size="lg"
            >
              ログイン
            </Button>
          </form>
        </div>

        {/* Sign up link */}
        <p className="text-center mt-8 text-neutral-600 dark:text-neutral-400">
          アカウントをお持ちでないですか？{' '}
          <Link to="/signup" className="text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium transition-colors">
            新規登録
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

