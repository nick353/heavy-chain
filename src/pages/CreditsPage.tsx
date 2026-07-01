import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Gauge, Loader2, ShieldCheck, Sparkles, BriefcaseBusiness } from 'lucide-react';
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

        <div className="mt-6 space-y-4" data-testid="credits-workspace-panel">
          <div className="grid gap-3 lg:grid-cols-3" data-testid="credits-next-actions">
            <Link to="/generate" className="group rounded-2xl border border-neutral-200 bg-white/65 p-4 transition hover:border-primary-300 hover:bg-white dark:border-white/10 dark:bg-surface-900/45 dark:hover:border-primary-400/40">
              <Sparkles className="h-5 w-5 text-primary-600 dark:text-primary-300" />
              <p className="mt-3 text-sm font-semibold text-neutral-950 dark:text-white">生成を続ける</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">残り枠を待たずに素材制作へ戻れます。</p>
            </Link>
            <Link to="/jobs" className="group rounded-2xl border border-neutral-200 bg-white/65 p-4 transition hover:border-primary-300 hover:bg-white dark:border-white/10 dark:bg-surface-900/45 dark:hover:border-primary-400/40">
              <BriefcaseBusiness className="h-5 w-5 text-amber-600 dark:text-amber-300" />
              <p className="mt-3 text-sm font-semibold text-neutral-950 dark:text-white">処理状況を見る</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">予約中や失敗した生成を確認します。</p>
            </Link>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
              <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
              <p className="mt-3 text-sm font-semibold text-emerald-950 dark:text-emerald-100">権利確認ゲート有効</p>
              <p className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-200">生成前に素材利用権と商用利用 caveat を確認します。</p>
            </div>
          </div>
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
          <div className="mt-6 space-y-4" data-testid="credits-usage-details-panel">
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <CreditSummaryPanel summary={summary} />
              <div className="rounded-2xl bg-white/55 p-5 dark:bg-surface-900/45">
                <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">内訳</h2>
                {summary.billingTestAccountQuotaBypass && (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                    {summary.appleSandboxTesterNoRealCharge
                      ? 'Apple sandbox tester: 購入フロー検証はテスト扱いで、実請求されない想定です。'
                      : 'テストアカウント: 運用確認用の生成 quota bypass が有効です。'}
                  </div>
                )}
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-white/60 p-4 dark:bg-surface-950/45">
                    <Gauge className="h-5 w-5 text-primary-600 dark:text-primary-300" />
                    <p className="mt-3 text-2xl font-semibold text-neutral-950 dark:text-white">{summary.remainingUnits.toLocaleString()}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">今月残り / 上限 {summary.monthlyQuota.toLocaleString()}</p>
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

          </div>
        )}
      </section>
    </div>
  );
}
