import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
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

  return (
    <article className="rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/45">
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
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            {job.status === 'failed' ? job.errorMessage || job.prompt || job.featureType : job.prompt || job.featureType}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{job.outputCount} outputs</span>
            <Link to={href} className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
              {job.status === 'failed' ? '再開する' : '開く'}
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

  const loadActivity = useCallback(async () => {
    if (!currentBrand) {
      setActivity(emptyWorkspaceActivity);
      return;
    }

    setIsLoading(true);
    try {
      setActivity(await fetchWorkspaceActivity(currentBrand.id));
    } catch (error) {
      console.warn('Failed to load jobs:', error);
      setActivity(emptyWorkspaceActivity);
    } finally {
      setIsLoading(false);
    }
  }, [currentBrand]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const jobs = [...activity.activeJobs, ...activity.failedJobs, ...activity.completedJobs];

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-5 sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Jobs</p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-neutral-950 dark:text-white">ジョブ</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            進行中、完了、失敗した生成ジョブをまとめて確認します。
          </p>
        </div>

        {!currentBrand ? (
          <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-surface-900/35">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">ブランドを作成するとジョブが表示されます。</p>
          </div>
        ) : isLoading ? (
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-36 animate-pulse rounded-2xl bg-neutral-100 dark:bg-surface-900" />
            ))}
          </div>
        ) : jobs.length > 0 ? (
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {jobs.map((job) => <JobRow key={job.id} job={job} />)}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-surface-900/35">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">まだジョブはありません。</p>
            <Link to="/generate" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
              生成を開始
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
