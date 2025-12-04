import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, ArrowLeft, Mail, Check } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

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
      <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-surface-50 dark:bg-surface-950">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-primary-200/20 blur-[120px] animate-float" />
          <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-accent-200/20 blur-[120px] animate-pulse-slow" />
        </div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md relative z-10"
        >
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

          <div className="glass-panel rounded-2xl p-8 md:p-10 backdrop-blur-xl border-white/40 dark:border-white/10 text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce-slow">
              <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            
            <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white mb-3">
              メールを送信しました
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400 mb-8 leading-relaxed">
              <span className="font-medium text-neutral-900 dark:text-white">{email}</span> 宛てに
              パスワードリセットのリンクを送信しました。
              メールをご確認ください。
            </p>

            <div className="bg-neutral-50/50 dark:bg-neutral-900/50 rounded-xl p-4 text-sm text-neutral-600 dark:text-neutral-400 mb-8 border border-neutral-100 dark:border-neutral-800">
              メールが届かない場合は、迷惑メールフォルダをご確認ください。
            </div>

            <Link to="/login">
              <Button variant="secondary" className="w-full shadow-sm hover:shadow-md transition-all">
                <ArrowLeft className="w-4 h-4 mr-2" />
                ログインに戻る
              </Button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-surface-50 dark:bg-surface-950">
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
          <div className="w-14 h-14 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Mail className="w-7 h-7 text-primary-600 dark:text-primary-400" />
          </div>
          
          <h1 className="text-2xl font-display font-semibold text-neutral-900 dark:text-white text-center mb-2">
            パスワードをリセット
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-center mb-8 text-sm leading-relaxed">
            登録したメールアドレスを入力してください。
            パスワードリセットのリンクをお送りします。
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              type="email"
              label="メールアドレス"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
              disabled={isLoading}
              className="bg-white/50 dark:bg-neutral-900/50 border-neutral-200 dark:border-neutral-700 focus:ring-primary-500"
            />

            <Button
              type="submit"
              isLoading={isLoading}
              className="w-full shadow-glow hover:shadow-glow-lg transition-all duration-300"
              size="lg"
            >
              リセットリンクを送信
            </Button>
          </form>
        </div>

        {/* Back link */}
        <p className="text-center mt-8">
          <Link 
            to="/login" 
            className="text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 inline-flex items-center gap-2 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            ログインに戻る
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

