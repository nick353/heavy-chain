import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { ActivityTimeline } from '../components/workspace';
import { emptyWorkspaceActivity, fetchWorkspaceActivity, type WorkspaceActivity } from '../lib/workspaceActivity';

export function HistoryPage() {
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
      console.warn('Failed to load history activity:', error);
      setActivityError('history');
    } finally {
      setIsLoading(false);
    }
  }, [currentBrand]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
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
          <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-surface-900/35">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">ブランドを作成すると履歴が表示されます。</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-[0.25fr_1fr]">
            <aside className="rounded-2xl bg-white/50 p-4 dark:bg-surface-900/45">
              <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Timeline</p>
              <p className="mt-2 text-2xl font-semibold text-neutral-950 dark:text-white">{activity.timelineItems.length}</p>
              <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                生成ジョブとギャラリー保存の最新状況です。
              </p>
            </aside>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-32 animate-pulse rounded-2xl bg-neutral-100 dark:bg-surface-900" />
                ))}
              </div>
            ) : activityError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50/70 p-6 text-center dark:border-red-900/60 dark:bg-red-950/25">
                <h2 className="text-base font-semibold text-red-800 dark:text-red-200">読み込み失敗</h2>
                <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                  生成履歴を取得できませんでした。
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
              <ActivityTimeline items={activity.timelineItems} emptyMessage="まだ生成履歴がありません。" />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
