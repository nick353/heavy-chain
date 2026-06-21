import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { WorkspaceJob } from '../../lib/workspaceActivity';

interface FailureRetryCardProps {
  failedJobs: WorkspaceJob[];
  className?: string;
}

export function FailureRetryCard({ failedJobs, className = '' }: FailureRetryCardProps) {
  const topFailure = failedJobs[0];

  return (
    <section className={`glass-panel rounded-2xl p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-900/25 dark:text-red-200">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase text-red-600 dark:text-red-300">Recovery</p>
          <h2 className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">失敗から再開</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            {topFailure ? topFailure.errorMessage || '失敗したジョブがあります。入力内容を確認して再開できます。' : '再開が必要な失敗ジョブはありません。'}
          </p>
        </div>
      </div>

      {topFailure ? (
        <div className="mt-5 rounded-xl bg-white/55 p-4 dark:bg-surface-900/45">
          <p className="truncate text-sm font-semibold text-neutral-950 dark:text-white">{topFailure.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{topFailure.prompt || topFailure.featureType}</p>
          <Link to={topFailure.resumeHref} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
            入力を開いて再開
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <Link to="/generate" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:text-primary-700 dark:bg-white/10 dark:text-neutral-200">
          新しく生成する
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </section>
  );
}
