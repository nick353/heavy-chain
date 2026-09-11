import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from '../components/ui';
import { cloudflareAuthEnabled, completePasswordReset } from '../lib/auth';
import { getAuthErrorMessage } from '../lib/authErrorMessage';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const minimum = cloudflareAuthEnabled ? 12 : 8;
  useEffect(() => {
    // Keep the recovery credential in component memory, not history, analytics or links.
    if (token) navigate('/reset-password', { replace: true });
  }, [token, navigate]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < minimum || password.length > 128) { setError(`${minimum}〜128文字のパスワードを入力してください。`); return; }
    if (password !== confirmation) { setError('パスワードが一致しません。'); return; }
    setBusy(true); setError('');
    try { await completePasswordReset(token, password); setPassword(''); setConfirmation(''); setDone(true); }
    catch (error) { setError(getAuthErrorMessage(error, '再設定できませんでした。新しい再設定メールをリクエストしてください。')); }
    finally { setBusy(false); }
  };
  const missingToken = cloudflareAuthEnabled && !token;
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-surface-50 dark:bg-surface-950">
      <section className="w-full max-w-md rounded-2xl bg-white dark:bg-surface-900 text-neutral-900 dark:text-white p-8 shadow-lg space-y-6">
        <Link to="/" className="text-primary-600 font-semibold">Heavy Chain</Link>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white">パスワードを再設定</h1>
        {done ? <div role="status" className="space-y-4">
          <p>パスワードを変更しました。{cloudflareAuthEnabled ? '以前のログイン状態は解除されました。' : ''}</p>
          <Link to="/login" className="text-primary-600 underline">新しいパスワードでログイン</Link>
        </div> : missingToken ? <div role="alert" className="space-y-4">
          <p>再設定リンクがありません。メールからリンクを開くか、新しくリクエストしてください。</p>
          <Link to="/forgot-password" className="text-primary-600 underline">再設定メールをリクエスト</Link>
        </div> : <form onSubmit={submit} className="space-y-5">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{minimum}〜128文字で設定してください。変更後はもう一度ログインが必要です。</p>
          <Input label="新しいパスワード" type="password" autoComplete="new-password" minLength={minimum} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} />
          <Input label="新しいパスワード（確認）" type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? '変更中…' : 'パスワードを変更'}</Button>
        </form>}
      </section>
    </main>
  );
}
