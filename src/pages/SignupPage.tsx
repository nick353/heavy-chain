import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layers, Chrome } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';

export function SignupPage() {
  const navigate = useNavigate();
  const { signUpWithEmail, signInWithGoogle, signInWithApple, isLoading } = useAuthStore();
  
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
    } else if (password.length < 8) {
      newErrors.password = 'パスワードは8文字以上で入力してください';
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
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'アカウント作成に失敗しました');
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
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-primary-50/30 to-accent-50/20 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-primary-700 to-accent-600 rounded-2xl flex items-center justify-center shadow-elegant">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <span className="font-display text-2xl font-semibold text-neutral-800">
              Heavy Chain
            </span>
          </Link>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-elegant p-8 border border-neutral-100">
          <h1 className="text-2xl font-display font-semibold text-neutral-800 text-center mb-2">
            アカウント作成
          </h1>
          <p className="text-neutral-500 text-center mb-8">
            無料でHeavy Chainを始めましょう
          </p>

          {/* OAuth Buttons */}
          <div className="space-y-3 mb-6">
            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors"
            >
              <Chrome className="w-5 h-5 text-neutral-600" />
              <span className="font-medium text-neutral-700">Googleで続ける</span>
            </button>
            <button
              onClick={handleAppleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              <span className="font-medium">Appleで続ける</span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-neutral-200" />
            <span className="text-sm text-neutral-400">または</span>
            <div className="flex-1 h-px bg-neutral-200" />
          </div>

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="text"
              label="名前"
              placeholder="山田 太郎"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              disabled={isLoading}
            />
            <Input
              type="email"
              label="メールアドレス"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              disabled={isLoading}
            />
            <Input
              type="password"
              label="パスワード"
              placeholder="8文字以上"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              disabled={isLoading}
            />
            <Input
              type="password"
              label="パスワード（確認）"
              placeholder="もう一度入力"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={errors.confirmPassword}
              disabled={isLoading}
            />

            <Button
              type="submit"
              isLoading={isLoading}
              className="w-full"
              size="lg"
            >
              アカウントを作成
            </Button>
          </form>

          {/* Terms */}
          <p className="mt-4 text-xs text-center text-neutral-500">
            アカウントを作成することで、
            <a href="#" className="text-primary-600 hover:underline">利用規約</a>
            および
            <a href="#" className="text-primary-600 hover:underline">プライバシーポリシー</a>
            に同意したものとみなされます。
          </p>
        </div>

        {/* Login link */}
        <p className="text-center mt-6 text-neutral-600">
          すでにアカウントをお持ちですか？{' '}
          <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}


