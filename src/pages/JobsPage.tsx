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
  const href = job.status === 'failed' ? job.resumeHref : '/gallery';
  const lightchainRows = job.sourceSummaryRows.filter((row) => row.label.startsWith('Lightchain'));
  const actionLabel = job.status === 'failed'
    ? '入力を直して再開'
    : job.status === 'completed'
      ? '成果物を開く'
      : '進行状況を見る';

  const statusTone = job.status === 'failed'
    ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20'
    : 'border-white/60 bg-white/65 dark:border-white/10 dark:bg-surface-900/55';

  return (
    <article className={`rounded-2xl border p-4 shadow-soft transition hover:border-primary-300 dark:hover:border-primary-500/70 ${statusTone}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 dark:bg-surface-800 dark:text-neutral-200">
          <StatusIcon className={`h-5 w-5 ${job.status === 'processing' ? 'animate-spin' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
              {statusLabel[job.status]}
            </span>
            <span className="text-xs text-neutral-400">{new Date(job.createdAt).toLocaleString('ja-JP')}</span>
          </div>
          <h2 className="mt-2 truncate text-base font-semibold text-neutral-950 dark:text-white">{job.title}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-full bg-primary-50 px-2 py-1 text-primary-700 dark:bg-primary-400/10 dark:text-primary-200">{job.productLane}</span>
            <span className={`rounded-full px-2 py-1 ${job.hasMaterialReference ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200' : 'bg-neutral-100 text-neutral-500 dark:bg-surface-800 dark:text-neutral-300'}`}>
              {job.hasMaterialReference ? '素材あり' : '素材なし'}
            </span>
            <span className="rounded-full bg-white px-2 py-1 text-neutral-500 dark:bg-white/10 dark:text-neutral-300">{job.recoveryAction}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            {job.status === 'failed' ? job.errorMessage || job.prompt || job.featureType : job.prompt || job.featureType}
          </p>
          {lightchainRows.length > 0 && (
            <dl className="mt-3 space-y-1 rounded-xl bg-teal-50/70 p-3 dark:bg-teal-950/25">
              {lightchainRows.map((row) => (
                <div key={`${job.id}-${row.label}-${row.value}`} className="grid gap-1 text-xs sm:grid-cols-[108px_1fr] sm:gap-2">
                  <dt className="text-teal-700 dark:text-teal-300">{row.label}:</dt>
                  <dd className="min-w-0 break-words font-medium text-neutral-800 dark:text-neutral-100">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{job.outputCount} outputs</span>
            <Link to={href} className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
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
  const { currentBrand } = useAuthStore();
  const [activity, setActivity] = useState<WorkspaceActivity>(emptyWorkspaceActivity);
  const [isLoading, setIsLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [showFailedJobs, setShowFailedJobs] = useState(false);

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
      console.warn('Failed to load jobs:', error);
      setActivityError('jobs');
    } finally {
      setIsLoading(false);
    }
  }, [currentBrand]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const primaryJobs = [...activity.activeJobs, ...activity.completedJobs];
  const visibleJobs = showFailedJobs ? [...primaryJobs, ...activity.failedJobs] : primaryJobs;
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
      href: activity.failedJobs[0]?.resumeHref ?? '/history',
      icon: AlertTriangle,
      detail: '入力、承認、サブスク、Runway状態を見直して再開します。',
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
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Production queue</p>
            <h1 className="mt-1 font-display text-3xl font-semibold text-neutral-950 dark:text-white">制作キュー</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              進行中、止まった作業、完了した成果物をまとめて見て、次の操作へそのまま進めます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white/70 px-3 py-2 text-sm font-semibold text-neutral-700 transition hover:border-primary-300 hover:bg-white disabled:opacity-60 dark:border-white/10 dark:bg-surface-900/55 dark:text-neutral-200"
              disabled={isLoading}
            >
              <RotateCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              更新
            </button>
            <Link to="/generate" className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
              新しく作る
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {!currentBrand ? (
          <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-surface-900/35">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">ブランドを作成するとジョブが表示されます。</p>
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
                    className="rounded-2xl border border-neutral-200 bg-white/60 p-4 transition hover:border-primary-300 hover:bg-white dark:border-white/10 dark:bg-surface-900/45 dark:hover:border-primary-500/70"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-neutral-950 dark:text-white">
                      <Icon className="h-4 w-4 text-primary-500" />
                      {card.label}
                    </span>
                    <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{card.detail}</p>
                    <span className="mt-3 inline-flex rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-400/10 dark:text-primary-200">
                      {card.count}件
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <aside className="rounded-2xl bg-white/50 p-4 dark:bg-surface-900/45">
                <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Queue summary</p>
                <p className="mt-2 text-2xl font-semibold text-neutral-950 dark:text-white">{visibleJobs.length}</p>
                <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  完了成果物と進行中の作業を先に出し、古い失敗は必要な時だけ確認します。
                </p>
                {activity.failedJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowFailedJobs((current) => !current)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    {showFailedJobs ? '失敗を隠す' : `要確認 ${activity.failedJobs.length}件を表示`}
                    <ArrowRight className={`h-3.5 w-3.5 transition ${showFailedJobs ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </aside>

              {isLoading ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {[1, 2, 3, 4].map((item) => (
                    <div key={item} className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-surface-900" />
                  ))}
                </div>
              ) : activityError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50/70 p-6 text-center dark:border-red-900/60 dark:bg-red-950/25">
                  <h2 className="text-base font-semibold text-red-800 dark:text-red-200">読み込み失敗</h2>
                  <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                    ジョブ一覧を取得できませんでした。
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
              ) : visibleJobs.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {visibleJobs.map((job) => <JobRow key={job.id} job={job} />)}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-neutral-200 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-surface-900/35">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">まだジョブはありません。</p>
                  <Link to="/generate" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
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
