import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, ArrowLeft, Mail, Check } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState('');

  const validate = () => {
    if (!email) {
      setError('メールアドレスを入力してください');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('有効なメールアドレスを入力してください');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setIsSent(true);
      toast.success('リセットメールを送信しました');
    } catch (error: any) {
      toast.error(error.message || 'メールの送信に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-primary-50/30 to-accent-50/20 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
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

          <div className="bg-white rounded-2xl shadow-elegant p-8 border border-neutral-100 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            
            <h1 className="text-2xl font-display font-semibold text-neutral-800 mb-3">
              メールを送信しました
            </h1>
            <p className="text-neutral-600 mb-6">
              <span className="font-medium text-neutral-800">{email}</span> 宛てに
              パスワードリセットのリンクを送信しました。
              メールをご確認ください。
            </p>

            <div className="bg-neutral-50 rounded-xl p-4 text-sm text-neutral-600 mb-6">
              メールが届かない場合は、迷惑メールフォルダをご確認ください。
            </div>

            <Link to="/login">
              <Button variant="secondary" className="w-full">
                <ArrowLeft className="w-4 h-4 mr-2" />
                ログインに戻る
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="w-14 h-14 bg-primary-100 rounded-xl flex items-center justify-center mx-auto mb-6">
            <Mail className="w-7 h-7 text-primary-600" />
          </div>
          
          <h1 className="text-2xl font-display font-semibold text-neutral-800 text-center mb-2">
            パスワードをリセット
          </h1>
          <p className="text-neutral-500 text-center mb-8">
            登録したメールアドレスを入力してください。
            パスワードリセットのリンクをお送りします。
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              label="メールアドレス"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
              disabled={isLoading}
            />

            <Button
              type="submit"
              isLoading={isLoading}
              className="w-full"
              size="lg"
            >
              リセットリンクを送信
            </Button>
          </form>
        </div>

        {/* Back link */}
        <p className="text-center mt-6">
          <Link 
            to="/login" 
            className="text-neutral-600 hover:text-neutral-800 inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            ログインに戻る
          </Link>
        </p>
      </div>
    </div>
  );
}



