import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, GalleryHorizontalEnd, Loader2, PlayCircle, RotateCcw, XCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { emptyWorkspaceActivity, fetchWorkspaceActivity, type WorkspaceActivity, type WorkspaceJob } from '../lib/workspaceActivity';

const statusLabel = {
  pending: '待機中',
  processing: '処理中',
  completed: '完了',
  failed: '失敗',
};

const statusIcon = {
  pending: Clock3,
  processing: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

function JobRow({ job }: { job: WorkspaceJob }) {
  const StatusIcon = statusIcon[job.status];
  const href = job.status === 'failed' ? job.retryHref : '/gallery';
  const lightchainRows = job.sourceSummaryRows.filter((row) => row.label.startsWith('Lightchain'));
  const actionLabel = job.status === 'failed'
    ? job.retryLabel
    : job.status === 'completed'
      ? '成果物を開く'
      : '進行状況を見る';

  const statusTone = job.status === 'failed'
    ? 'border-amber-300/20 bg-amber-300/[0.08]'
    : 'border-white/10 bg-white/[0.04]';

  return (
    <article className={`rounded-2xl border p-4 shadow-soft backdrop-blur-sm transition hover:border-cyan-300/40 ${statusTone}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-neutral-200">
          <StatusIcon className={`h-5 w-5 ${job.status === 'processing' ? 'animate-spin' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold text-neutral-300">
              {statusLabel[job.status]}
            </span>
            <span className="text-xs text-neutral-400">{new Date(job.createdAt).toLocaleString('ja-JP')}</span>
          </div>
          <h2 className="mt-2 truncate text-base font-semibold text-white">{job.title}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-cyan-100">{job.productLane}</span>
            <span className={`rounded-full px-2 py-1 ${job.hasMaterialReference ? 'bg-emerald-300/10 text-emerald-100' : 'bg-white/[0.05] text-neutral-300'}`}>
              {job.hasMaterialReference ? '素材あり' : '素材なし'}
            </span>
            <span className="rounded-full bg-white/[0.05] px-2 py-1 text-neutral-300">{job.recoveryTitle}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-400">
            {job.status === 'failed' ? job.recoveryMessage : job.prompt || job.featureType}
          </p>
          {job.status === 'failed' && (
            <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-3 text-xs leading-5 text-amber-100">
              <p className="font-semibold">次にやること</p>
              <p className="mt-1">{job.recoveryNextAction}</p>
              {job.errorMessage && (
                <p className="mt-2 text-[11px] text-amber-200/80">
                  詳細: {job.errorMessage}
                </p>
              )}
            </div>
          )}
          {lightchainRows.length > 0 && (
            <dl className="mt-3 space-y-1 rounded-xl bg-cyan-300/[0.08] p-3">
              {lightchainRows.map((row) => (
                <div key={`${job.id}-${row.label}-${row.value}`} className="grid gap-1 text-xs sm:grid-cols-[108px_1fr] sm:gap-2">
                  <dt className="text-cyan-100">{row.label}:</dt>
                  <dd className="min-w-0 break-words font-medium text-white">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-400">{job.outputCount} outputs</span>
            <Link to={href} className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-cyan-200">
              {actionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

export function JobsPage() {
  const { user, currentBrand, refreshCurrentBrand } = useAuthStore();
  const [activity, setActivity] = useState<WorkspaceActivity>(emptyWorkspaceActivity);
  const [isLoading, setIsLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [showFailedJobs, setShowFailedJobs] = useState(false);
  const [showAllMobileJobs, setShowAllMobileJobs] = useState(false);

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
      console.warn('Failed to load jobs:', error);
      setActivityError('jobs');
    } finally {
      if (useAuthStore.getState().currentBrand?.id === brandId) {
        setIsLoading(false);
      }
    }
  }, [currentBrand, refreshCurrentBrand, user]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const primaryJobs = [...activity.activeJobs, ...activity.completedJobs];
  const visibleJobs = showFailedJobs ? [...primaryJobs, ...activity.failedJobs] : primaryJobs;
  const mobileInitialJobLimit = 5;
  const hiddenMobileJobCount = Math.max(visibleJobs.length - mobileInitialJobLimit, 0);
  const queueCards = [
    {
      label: '再開できる作業',
      count: activity.activeJobs.length,
      href: activity.activeJobs[0]?.resumeHref ?? '/generate',
      icon: PlayCircle,
      detail: '進行中の生成や直近の制作レーンへ戻ります。',
    },
    {
      label: '止まった作業',
      count: activity.failedJobs.length,
      href: activity.failedJobs[0]?.retryHref ?? '/history',
      icon: AlertTriangle,
      detail: '原因と次の操作を確認し、入力を保ったまま再開します。',
    },
    {
      label: '完了した成果物',
      count: activity.completedJobs.length,
      href: '/gallery',
      icon: GalleryHorizontalEnd,
      detail: '保存済み画像を開き、Canvas再編集や共有へ進みます。',
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-neutral-950 p-5 shadow-soft sm:p-7 backdrop-blur-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-cyan-300">Production queue</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-white">制作キュー</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-300">
              進行中、止まった作業、完了した成果物をまとめて見て、次の操作へそのまま進めます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/40 hover:bg-white/[0.07] disabled:opacity-60"
              disabled={isLoading}
            >
              <RotateCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              更新
            </button>
            <Link to="/generate" className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200">
              新しく作る
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {!currentBrand ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center backdrop-blur-sm">
            <p className="text-sm text-neutral-400">ブランドを作成するとジョブが表示されます。</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="grid gap-3 lg:grid-cols-3">
              {queueCards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link
                    key={card.label}
                    to={card.href}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-300/40 hover:bg-white/[0.07] backdrop-blur-sm"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Icon className="h-4 w-4 text-cyan-300" />
                      {card.label}
                    </span>
                    <p className="mt-2 text-xs leading-5 text-neutral-400">{card.detail}</p>
                    <span className="mt-3 inline-flex rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                      {card.count}件
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <aside className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase text-cyan-300">Queue summary</p>
                <p className="mt-2 text-2xl font-semibold text-white">{visibleJobs.length}</p>
                <p className="mt-2 text-sm leading-6 text-neutral-400">
                  完了成果物と進行中の作業を先に出し、古い失敗は必要な時だけ確認します。
                </p>
                {activity.failedJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowFailedJobs((current) => !current)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.08] px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-300/10"
                  >
                    {showFailedJobs ? '失敗を隠す' : `要確認 ${activity.failedJobs.length}件を表示`}
                    <ArrowRight className={`h-3.5 w-3.5 transition ${showFailedJobs ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </aside>

              {isLoading ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {[1, 2, 3, 4].map((item) => (
                    <div key={item} className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm" />
                  ))}
                </div>
              ) : activityError ? (
                <div className="rounded-2xl border border-red-300/20 bg-red-300/[0.08] p-6 text-center">
                  <h2 className="text-base font-semibold text-red-200">読み込み失敗</h2>
                  <p className="mt-2 text-sm text-red-300">
                    ジョブ一覧を取得できませんでした。
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
              ) : visibleJobs.length > 0 ? (
                <div className="space-y-3">
                  <div className="grid gap-3 lg:grid-cols-2" data-testid="jobs-list">
                    {visibleJobs.map((job, index) => (
                      <div
                        key={job.id}
                        className={!showAllMobileJobs && index >= mobileInitialJobLimit ? 'hidden sm:block' : undefined}
                        data-testid="jobs-list-item"
                      >
                        <JobRow job={job} />
                      </div>
                    ))}
                  </div>
                  {hiddenMobileJobCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMobileJobs((current) => !current)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-neutral-200 shadow-soft transition hover:border-cyan-300/40 hover:bg-white/[0.07] sm:hidden"
                      data-testid="mobile-jobs-show-all"
                    >
                      {showAllMobileJobs ? '最新5件に戻す' : `さらに${hiddenMobileJobCount}件を表示`}
                      <ArrowRight className={`h-4 w-4 transition ${showAllMobileJobs ? '-rotate-90' : 'rotate-90'}`} />
                    </button>
                  )}
                </div>
              ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center backdrop-blur-sm">
                  <p className="text-sm text-neutral-400">まだジョブはありません。</p>
                  <Link to="/generate" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-cyan-200">
                    生成を開始
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
