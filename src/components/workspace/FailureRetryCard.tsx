import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { WorkspaceJob } from '../../lib/workspaceActivity';

interface FailureRetryCardProps {
  failedJobs: WorkspaceJob[];
  className?: string;
}

export function FailureRetryCard({ failedJobs, className = '' }: FailureRetryCardProps) {
  const topFailure = failedJobs[0];
  const lightchainRows = topFailure?.sourceSummaryRows.filter((row) => row.label.startsWith('Lightchain')) ?? [];

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
            {topFailure ? topFailure.recoveryMessage : '再開が必要な失敗ジョブはありません。'}
          </p>
        </div>
      </div>

      {topFailure ? (
        <div className="mt-5 rounded-xl bg-white/55 p-4 dark:bg-surface-900/45">
          <p className="truncate text-sm font-semibold text-neutral-950 dark:text-white">{topFailure.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{topFailure.prompt || topFailure.featureType}</p>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
            <p className="font-semibold">{topFailure.recoveryTitle}</p>
            <p className="mt-1">{topFailure.recoveryNextAction}</p>
          </div>
          {lightchainRows.length > 0 && (
            <dl className="mt-3 space-y-1 rounded-lg bg-teal-50/70 p-3 dark:bg-teal-950/25">
              {lightchainRows.map((row) => (
                <div key={`${row.label}-${row.value}`} className="grid grid-cols-[96px_1fr] gap-2 text-xs">
                  <dt className="text-teal-700 dark:text-teal-300">{row.label}:</dt>
                  <dd className="min-w-0 break-words font-medium text-neutral-800 dark:text-neutral-100">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <Link to={topFailure.retryHref} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
            {topFailure.retryLabel}
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
