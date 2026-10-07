import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { auth } from '../lib/auth';
import { getAuthErrorMessage } from '../lib/authErrorMessage';
import toast from 'react-hot-toast';

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 20;
const OTP_LENGTH = 6;
const fieldClassName = 'h-10 w-full rounded-[8px] border border-[#3b4248] bg-transparent px-4 text-[14px] text-[#f0f2f3] placeholder:text-[#7d858b] outline-none transition focus:border-[#14b8a6] disabled:opacity-60';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const normalizedAccount = () => account.trim().toLowerCase();
  const validAccount = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const sendVerificationCode = async () => {
    const email = normalizedAccount();
    setError('');
    if (!email) { setError('アカウントを入力してください。'); return; }
    if (!validAccount(email)) { setError('有効なアカウントを入力してください。'); return; }

    setSendingCode(true);
    try {
      const result = await auth.requestPasswordResetOtp(email);
      if (result.error) throw result.error;
      setAccount(email);
      setCodeSent(true);
      setCooldown(60);
      toast.success('登録済みの場合、認証コードをメールで送信しました。');
    } catch (cause) {
      const message = getAuthErrorMessage(cause, '認証コードを取得できませんでした。');
      setError(message);
      toast.error(message);
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const email = normalizedAccount();
    if (!validAccount(email)) { setError('有効なアカウントを入力してください。'); return; }
    if (!new RegExp(`^[0-9]{${OTP_LENGTH}}$`).test(verificationCode)) {
      setError('6桁の認証コードを入力してください。'); return;
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      setError(`新しいパスワードは${MIN_PASSWORD_LENGTH}〜${MAX_PASSWORD_LENGTH}文字で入力してください。`); return;
    }
    if (password !== confirmation) { setError('パスワードが一致しません。'); return; }

    setSubmitting(true);
    try {
      const result = await auth.completePasswordResetWithOtp(email, verificationCode, password);
      if (result.error) throw result.error;
      setPassword('');
      setConfirmation('');
      setVerificationCode('');
      setCompleted(true);
      toast.success('パスワードをリセットしました。');
    } catch (cause) {
      const message = getAuthErrorMessage(cause, 'パスワードをリセットできませんでした。');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#22262b] px-6 py-16 text-[#e7eaec]">
      <Link
        to="/login"
        className="absolute right-6 top-5 text-[14px] text-[#d8dcde] transition hover:text-white sm:right-8 sm:top-6"
      >
        ログイン画面に戻る
      </Link>

      <section className="w-full max-w-[352px]">
        {completed ? (
          <div className="space-y-6 text-center" role="status" aria-live="polite">
            <h1 className="text-[20px] font-medium">パスワードをリセットしました</h1>
            <p className="text-[14px] leading-6 text-[#aeb5ba]">新しいパスワードでログインしてください。</p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="h-12 w-full rounded-lg bg-[#0da69d] text-[15px] font-medium text-white transition hover:bg-[#0bb7ab] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#55ded4]"
            >
              ログイン画面に戻る
            </button>
          </div>
        ) : (
          <>
            <h1 className="mb-10 text-center text-[20px] font-medium tracking-wide">パスワードのリセット</h1>
            <form onSubmit={handleSubmit} className="space-y-7" noValidate>
              <div>
                <label htmlFor="reset-account" className="mb-2 block text-[14px] text-[#c6cbce]">
                  アカウント<span className="ml-0.5 text-[#f06b77]">*</span>
                </label>
                <div className="flex h-10 overflow-hidden rounded-[8px] border border-[#3b4248] focus-within:border-[#14b8a6]">
                  <input
                    id="reset-account"
                    name="account"
                    type="email"
                    autoComplete="email"
                    placeholder="アカウントを入力"
                    value={account}
                    onChange={event => { setAccount(event.target.value); setCodeSent(false); }}
                    disabled={sendingCode || submitting}
                    aria-required="true"
                    className="h-full min-w-0 flex-1 bg-transparent px-4 text-[14px] text-[#f0f2f3] placeholder:text-[#7d858b] outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => void sendVerificationCode()}
                    disabled={sendingCode || submitting || cooldown > 0}
                    className="shrink-0 border-l border-[#3b4248] px-4 text-[14px] font-medium text-[#22c8bb] transition hover:text-[#73e6dc] disabled:cursor-not-allowed disabled:text-[#79817f]"
                  >
                    {sendingCode ? '送信中…' : cooldown > 0 ? `${cooldown}秒後に再取得` : codeSent ? '再取得' : '認証コード取得'}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="reset-code" className="mb-2 block text-[14px] text-[#c6cbce]">
                  認証コード<span className="ml-0.5 text-[#f06b77]">*</span>
                </label>
                <input
                  id="reset-code"
                  name="verificationCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={OTP_LENGTH}
                  placeholder="認証コードを入力"
                  value={verificationCode}
                  onChange={event => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
                  disabled={submitting}
                  aria-required="true"
                  className={fieldClassName}
                />
              </div>

              <div>
                <label htmlFor="reset-new-password" className="mb-2 block text-[14px] text-[#c6cbce]">
                  新しいパスワード<span className="ml-0.5 text-[#f06b77]">*</span>
                </label>
                <p className="mb-2 text-[13px] leading-5 text-[#9da5aa]">
                  6〜20文字で入力してください。
                </p>
                <div className="relative">
                  <input
                    id="reset-new-password"
                    name="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    maxLength={MAX_PASSWORD_LENGTH}
                    placeholder="パスワードを入力する"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    disabled={submitting}
                    aria-required="true"
                    className={`${fieldClassName} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(value => !value)}
                    aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#8c959b] hover:text-white"
                  >
                    {showPassword ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="mb-2 block text-[14px] text-[#c6cbce]">
                  パスワードを確認<span className="ml-0.5 text-[#f06b77]">*</span>
                </label>
                <div className="relative">
                  <input
                    id="reset-confirm-password"
                    name="passwordConfirmation"
                    type={showConfirmation ? 'text' : 'password'}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    maxLength={MAX_PASSWORD_LENGTH}
                    placeholder="パスワードを再度入力してください"
                    value={confirmation}
                    onChange={event => setConfirmation(event.target.value)}
                    disabled={submitting}
                    aria-required="true"
                    className={`${fieldClassName} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmation(value => !value)}
                    aria-label={showConfirmation ? '確認用パスワードを隠す' : '確認用パスワードを表示'}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#8c959b] hover:text-white"
                  >
                    {showConfirmation ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {error && <p role="alert" className="text-[13px] leading-5 text-[#ff8993]">{error}</p>}
              {codeSent && !error && (
                <p role="status" aria-live="polite" className="text-[13px] leading-5 text-[#83d5ce]">
                  登録済みの場合、認証コードをメールで送信しました。
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || sendingCode}
                className="h-10 w-full rounded-lg bg-[#0da69d] text-[15px] font-medium text-white transition hover:bg-[#0bb7ab] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#55ded4] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'リセット中…' : 'パスワードのリセット'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
