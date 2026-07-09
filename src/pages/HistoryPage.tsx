import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Image, PlayCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { ActivityTimeline } from '../components/workspace';
import { emptyWorkspaceActivity, fetchWorkspaceActivity, type WorkspaceActivity } from '../lib/workspaceActivity';

export function HistoryPage() {
  const { user, currentBrand, refreshCurrentBrand } = useAuthStore();
  const [activity, setActivity] = useState<WorkspaceActivity>(emptyWorkspaceActivity);
  const [isLoading, setIsLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    if (!currentBrand && user) {
      const refreshedBrand = await refreshCurrentBrand();
      if (refreshedBrand) return;
    }

    if (!currentBrand) {
      setActivity(emptyWorkspaceActivity);
      setActivityError(null);
      setIsLoading(false);
      return;
    }

    const brandId = currentBrand.id;
    setIsLoading(true);
    setActivityError(null);
    try {
      const nextActivity = await fetchWorkspaceActivity(brandId);
      if (useAuthStore.getState().currentBrand?.id !== brandId) return;
      setActivity(nextActivity);
    } catch (error) {
      if (useAuthStore.getState().currentBrand?.id !== brandId) return;
      console.warn('Failed to load history activity:', error);
      setActivityError('history');
    } finally {
      if (useAuthStore.getState().currentBrand?.id === brandId) {
        setIsLoading(false);
      }
    }
  }, [currentBrand, refreshCurrentBrand, user]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-neutral-950 p-5 shadow-soft sm:p-7 backdrop-blur-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-neutral-950 dark:text-white">
              生成履歴
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              ジョブ、失敗、保存済み成果物をタイムラインで確認します。
            </p>
          </div>
          <Link to="/gallery" className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">
            ギャラリーへ
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        {!currentBrand ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center backdrop-blur-sm">
            <p className="text-sm text-neutral-400">ブランドを作成すると履歴が表示されます。</p>
        </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="grid gap-3 lg:grid-cols-3" data-testid="history-action-panel">
              <Link
                to={activity.activeJobs[0]?.resumeHref ?? activity.completedJobs[0]?.resumeHref ?? '/generate'}
                data-testid="history-action-resume"
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.07] backdrop-blur-sm"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <PlayCircle className="h-4 w-4 text-cyan-300" />
                  続きから再開
                </span>
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  進行中または直近のワークフローを開きます。
                </p>
                <span className="mt-3 inline-flex rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                  進行中 {activity.activeJobs.length}件
                </span>
              </Link>

              <Link
                to={activity.failedJobs[0]?.retryHref ?? '/jobs'}
                data-testid="history-action-jobs"
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.07] backdrop-blur-sm"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <AlertTriangle className="h-4 w-4 text-cyan-300" />
                  失敗を確認
                </span>
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  止まった生成を見て、入力や承認状態から再開します。
                </p>
                <span className="mt-3 inline-flex rounded-full bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-100">
                  失敗 {activity.failedJobs.length}件
                </span>
              </Link>

              <Link
                to="/gallery"
                data-testid="history-action-gallery"
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.07] backdrop-blur-sm"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Image className="h-4 w-4 text-cyan-300" />
                  保存済みを見る
                </span>
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  Galleryに残った成果物を開き、Canvas再編集や共有へ進みます。
                </p>
                <span className="mt-3 inline-flex rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                  保存済み {activity.recentOutputs.length}件
                </span>
              </Link>
            </div>

            <div className="grid gap-4 lg:grid-cols-[0.25fr_1fr]" data-testid="history-timeline-panel">
              <aside className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase text-cyan-300">Timeline</p>
                <p className="mt-2 text-2xl font-semibold text-white">{activity.timelineItems.length}</p>
                <p className="mt-2 text-sm leading-6 text-neutral-400">
                  生成ジョブとギャラリー保存の最新状況です。
                </p>
              </aside>

              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm" />
                  ))}
                </div>
              ) : activityError ? (
                <div className="rounded-2xl border border-red-300/20 bg-red-300/[0.08] p-6 text-center backdrop-blur-sm">
                  <h2 className="text-base font-semibold text-red-200">読み込み失敗</h2>
                  <p className="mt-2 text-sm text-red-300">
                    生成履歴を取得できませんでした。
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
                <ActivityTimeline
                  items={activity.timelineItems}
                  emptyMessage="まだ生成履歴がありません。"
                  mobileInitialLimit={8}
                  desktopInitialLimit={12}
                />
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
