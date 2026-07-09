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
    <div className="space-y-6 text-white">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 p-5 shadow-soft backdrop-blur-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Usage</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-white">利用状況</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">
              今月の使用量、処理中の予約分、生成利用の状態を確認します。
            </p>
          </div>
          <Link to="/generate" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-white backdrop-blur-sm">
            生成へ
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-6 space-y-4" data-testid="credits-workspace-panel">
          <div className="grid gap-3 lg:grid-cols-3" data-testid="credits-next-actions">
            <Link to="/generate" className="group rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-300/50 hover:bg-white/[0.07] backdrop-blur-sm">
              <Sparkles className="h-5 w-5 text-cyan-300" />
              <p className="mt-3 text-sm font-semibold text-white">生成を続ける</p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">残り枠を待たずに素材制作へ戻れます。</p>
            </Link>
            <Link to="/jobs" className="group rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-300/50 hover:bg-white/[0.07] backdrop-blur-sm">
              <BriefcaseBusiness className="h-5 w-5 text-amber-300" />
              <p className="mt-3 text-sm font-semibold text-white">処理状況を見る</p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">予約中や失敗した生成を確認します。</p>
            </Link>
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.08] p-4 backdrop-blur-sm">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <p className="mt-3 text-sm font-semibold text-white">権利確認ゲート有効</p>
              <p className="mt-1 text-xs leading-5 text-neutral-300">生成前に素材利用権と商用利用 caveat を確認します。</p>
            </div>
          </div>
        </div>

        {!currentBrand ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center backdrop-blur-sm">
            <p className="text-sm text-neutral-400">ブランドを作成すると利用状況が表示されます。</p>
          </div>
        ) : isLoading ? (
          <div className="mt-6 h-52 animate-pulse rounded-2xl bg-white/[0.04] backdrop-blur-sm" />
        ) : activityError ? (
          <div className="mt-6 rounded-2xl border border-red-300/20 bg-red-300/[0.08] p-6 text-center backdrop-blur-sm">
            <h2 className="text-base font-semibold text-red-200">読み込み失敗</h2>
            <p className="mt-2 text-sm text-red-300">
              利用状況を取得できませんでした。
            </p>
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="mt-4 inline-flex items-center rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-400 disabled:opacity-60"
              disabled={isLoading}
            >
              再読み込み
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4" data-testid="credits-usage-details-panel">
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <CreditSummaryPanel summary={summary} />
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold text-white">内訳</h2>
                {summary.billingTestAccountQuotaBypass && (
                  <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.08] px-4 py-3 text-xs font-medium text-emerald-100">
                    {summary.appleSandboxTesterNoRealCharge
                      ? 'Apple sandbox tester: 購入フロー検証はテスト扱いで、実請求されない想定です。'
                      : 'テストアカウント: 運用確認用の生成 quota bypass が有効です。'}
                  </div>
                )}
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-white/[0.04] p-4 backdrop-blur-sm">
                    <Gauge className="h-5 w-5 text-cyan-300" />
                    <p className="mt-3 text-2xl font-semibold text-white">{summary.remainingUnits.toLocaleString()}</p>
                    <p className="text-xs text-neutral-400">今月残り / 上限 {summary.monthlyQuota.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] p-4 backdrop-blur-sm">
                    <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                    <p className="mt-3 text-2xl font-semibold text-white">{summary.usedUnits.toLocaleString()}</p>
                    <p className="text-xs text-neutral-400">使用済み</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] p-4 backdrop-blur-sm">
                    <Loader2 className="h-5 w-5 text-amber-300" />
                    <p className="mt-3 text-2xl font-semibold text-white">{summary.reservedUnits.toLocaleString()}</p>
                    <p className="text-xs text-neutral-400">処理中</p>
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
