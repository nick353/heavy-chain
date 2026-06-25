import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Gauge, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { CreditSummaryPanel } from '../components/workspace';
import { emptyWorkspaceActivity, fetchWorkspaceActivity, type WorkspaceActivity } from '../lib/workspaceActivity';

export function CreditsPage() {
  const { currentBrand } = useAuthStore();
  const [activity, setActivity] = useState<WorkspaceActivity>(emptyWorkspaceActivity);
  const [isLoading, setIsLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    if (!currentBrand) {
      setActivity(emptyWorkspaceActivity);
      setActivityError(null);
      return;
    }

    setIsLoading(true);
    setActivityError(null);
    try {
      setActivity(await fetchWorkspaceActivity(currentBrand.id));
    } catch (error) {
      console.warn('Failed to load credits:', error);
      setActivityError('credits');
    } finally {
      setIsLoading(false);
    }
  }, [currentBrand]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const summary = activity.creditSummary;

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Usage</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-neutral-950 dark:text-white">利用状況</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              今月の使用量、処理中の予約分、生成利用の状態を確認します。
            </p>
          </div>
          <Link to="/generate" className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">
            生成へ
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {!currentBrand ? (
          <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-surface-900/35">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">ブランドを作成すると利用状況が表示されます。</p>
          </div>
        ) : isLoading ? (
          <div className="mt-6 h-52 animate-pulse rounded-2xl bg-neutral-100 dark:bg-surface-900" />
        ) : activityError ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50/70 p-6 text-center dark:border-red-900/60 dark:bg-red-950/25">
            <h2 className="text-base font-semibold text-red-800 dark:text-red-200">読み込み失敗</h2>
            <p className="mt-2 text-sm text-red-700 dark:text-red-300">
              利用状況を取得できませんでした。
            </p>
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="mt-4 inline-flex items-center rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
              disabled={isLoading}
            >
              再読み込み
            </button>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <CreditSummaryPanel summary={summary} />
            <div className="rounded-2xl bg-white/55 p-5 dark:bg-surface-900/45">
              <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">内訳</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/60 p-4 dark:bg-surface-950/45">
                  <Gauge className="h-5 w-5 text-primary-600 dark:text-primary-300" />
                  <p className="mt-3 text-2xl font-semibold text-neutral-950 dark:text-white">停止なし</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">生成上限</p>
                </div>
                <div className="rounded-xl bg-white/60 p-4 dark:bg-surface-950/45">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                  <p className="mt-3 text-2xl font-semibold text-neutral-950 dark:text-white">{summary.usedUnits.toLocaleString()}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">使用済み</p>
                </div>
                <div className="rounded-xl bg-white/60 p-4 dark:bg-surface-950/45">
                  <Loader2 className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                  <p className="mt-3 text-2xl font-semibold text-neutral-950 dark:text-white">{summary.reservedUnits.toLocaleString()}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">処理中</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
