import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { cloudflareDataPlane } from '../lib/cloudflareApi';
import { useAuthStore } from '../stores/authStore';

const CONFIRM_WORD = '削除';

/** Maps heavy-api errors (`cloudflare_api_<status>_<code>`) to what the user should do next. */
export function accountDeletionErrorMessage(error: unknown): { message: string; signInAgain?: boolean } {
  const text = error instanceof Error ? error.message : '';
  if (text.endsWith('_account_deletion_shared_brand')) {
    return { message: 'ほかのメンバーがいるブランドがあります。先に「チーム管理」でメンバーを外してから、もう一度お試しください。' };
  }
  if (text.endsWith('_account_deletion_admin')) return { message: '管理者のアカウントはこの画面から削除できません。' };
  if (text.endsWith('_reauthentication_required') || text.startsWith('cloudflare_api_401_')) {
    return { message: '安全のため、ログインし直してから削除してください（ログインから24時間以内に手続きできます）。', signInAgain: true };
  }
  return { message: 'アカウントを削除できませんでした。時間をおいてもう一度お試しください。' };
}

export function AccountDeletePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const [word, setWord] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; signInAgain?: boolean } | null>(null);

  const signInAgain = async () => {
    await signOut().catch(() => undefined);
    navigate('/login', { replace: true });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (word.trim() !== CONFIRM_WORD || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (!cloudflareDataPlane) throw new Error('cloudflare_api_not_configured');
      await cloudflareDataPlane.deleteAccount();
      // The session no longer exists on the server; clear the local copy as well.
      await signOut().catch(() => undefined);
      toast.success('アカウントを削除しました');
      navigate('/login', { replace: true });
    } catch (cause) {
      const next = accountDeletionErrorMessage(cause);
      setError(next);
      toast.error(next.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[#22262b] px-6 py-16 text-[#e7eaec]">
      <Link to="/" className="absolute right-6 top-5 text-[14px] text-[#d8dcde] transition hover:text-white sm:right-8 sm:top-6">
        ホームに戻る
      </Link>
      <section className="w-full max-w-[420px]" data-testid="account-delete-page">
        <h1 className="mb-6 text-center text-[20px] font-medium tracking-wide">アカウントの削除</h1>
        <p className="text-[14px] leading-6 text-[#c6cbce]">
          <span className="break-all font-medium text-white">{user?.email ?? ''}</span> のアカウントを削除します。次のものがすべて消え、元に戻せません。
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-[14px] leading-6 text-[#aeb5ba]">
          <li>アカウント情報（Google・Apple のログイン連携を含む）</li>
          <li>あなたが持っているブランドと、その中のプロジェクト・生成画像・アップロード素材</li>
          <li>ほかの人のブランドであなたが作ったプロジェクトや画像</li>
        </ul>
        <p className="mt-4 text-[13px] leading-5 text-[#9da5aa]">
          障害に備えたバックアップに残ったデータも、28日以内に自動で消えます。ほかのメンバーがいるブランドを持っている場合は、先にメンバーを外してください。
        </p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
          <div>
            <label htmlFor="account-delete-confirm" className="mb-2 block text-[14px] text-[#c6cbce]">
              確認のため「{CONFIRM_WORD}」と入力してください
            </label>
            <input
              id="account-delete-confirm"
              value={word}
              onChange={event => setWord(event.target.value)}
              disabled={submitting}
              autoComplete="off"
              placeholder={CONFIRM_WORD}
              className="h-10 w-full rounded-[8px] border border-[#3b4248] bg-transparent px-4 text-[14px] text-[#f0f2f3] placeholder:text-[#7d858b] outline-none transition focus:border-[#f06b77] disabled:opacity-60"
            />
          </div>
          {error && (
            <div role="alert" className="space-y-3 rounded-lg border border-[#f06b77]/40 bg-[#f06b77]/10 p-3 text-[13px] leading-5 text-[#ffd5d9]">
              <p>{error.message}</p>
              {error.signInAgain && (
                <button type="button" onClick={() => void signInAgain()} className="font-medium text-white underline">
                  ログインし直す
                </button>
              )}
            </div>
          )}
          <button
            type="submit"
            data-testid="account-delete-submit"
            disabled={word.trim() !== CONFIRM_WORD || submitting}
            className="h-12 w-full rounded-lg bg-[#d6455a] text-[15px] font-medium text-white transition hover:bg-[#e35468] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? '削除しています…' : 'アカウントを完全に削除する'}
          </button>
        </form>
      </section>
    </main>
  );
}
