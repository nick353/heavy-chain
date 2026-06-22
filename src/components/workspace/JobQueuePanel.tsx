import { Link } from 'react-router-dom';
import { CheckCircle2, Clock3, Loader2 } from 'lucide-react';
import type { WorkspaceJob } from '../../lib/workspaceActivity';

interface JobQueuePanelProps {
  activeJobs: WorkspaceJob[];
  completedJobs?: WorkspaceJob[];
  className?: string;
}

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
};

const getLightchainTaskRow = (job: WorkspaceJob) => {
  return job.sourceSummaryRows.find((row) => row.label === 'Lightchain task');
};

const getLightchainStepsRow = (job: WorkspaceJob) => {
  return job.sourceSummaryRows.find((row) => row.label === 'Lightchain steps');
};

export function JobQueuePanel({ activeJobs, completedJobs = [], className = '' }: JobQueuePanelProps) {
  const previewCompleted = completedJobs.slice(0, Math.max(0, 4 - activeJobs.length));

  return (
    <section className={`glass-panel rounded-2xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Job Queue</p>
          <h2 className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">進行中のジョブ</h2>
        </div>
        <Link to="/jobs" className="rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:text-primary-700 dark:bg-white/10 dark:text-neutral-200">
          全て見る
        </Link>
      </div>

      <div className="mt-5 space-y-3">
        {activeJobs.length === 0 && previewCompleted.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-200 bg-white/40 p-4 text-sm text-neutral-500 dark:border-white/10 dark:bg-surface-900/30 dark:text-neutral-400">
            現在処理中のジョブはありません。
          </div>
        )}

        {activeJobs.map((job) => {
          const processing = job.status === 'processing';
          const Icon = processing ? Loader2 : Clock3;
          const lightchainTask = getLightchainTaskRow(job);
          const lightchainSteps = getLightchainStepsRow(job);
          return (
            <Link key={job.id} to="/jobs" className="flex items-center gap-3 rounded-xl bg-white/55 p-3 transition hover:bg-white dark:bg-surface-900/40 dark:hover:bg-surface-900/70">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${processing ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-200' : 'bg-amber-50 text-amber-600 dark:bg-amber-900/25 dark:text-amber-200'}`}>
                <Icon className={`h-5 w-5 ${processing ? 'animate-spin' : ''}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-950 dark:text-white">{job.title}</span>
                <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{job.prompt || job.featureType}</span>
                {lightchainTask && (
                  <span className="mt-1 block truncate text-[11px] font-medium text-teal-700 dark:text-teal-300">
                    Lightchain task: {lightchainTask.value}
                  </span>
                )}
                {lightchainSteps && (
                  <span className="mt-0.5 block truncate text-[11px] font-medium text-teal-700 dark:text-teal-300">
                    Lightchain steps: {lightchainSteps.value}
                  </span>
                )}
              </span>
              <span className="text-xs font-medium text-neutral-400">{formatTime(job.createdAt)}</span>
            </Link>
          );
        })}

        {previewCompleted.map((job) => {
          const lightchainTask = getLightchainTaskRow(job);
          const lightchainSteps = getLightchainStepsRow(job);
          return (
            <Link key={job.id} to="/gallery" className="flex items-center gap-3 rounded-xl bg-white/45 p-3 transition hover:bg-white dark:bg-surface-900/30 dark:hover:bg-surface-900/60">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-200">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-950 dark:text-white">{job.title}</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">{job.outputCount} outputs</span>
                {lightchainTask && (
                  <span className="mt-1 block truncate text-[11px] font-medium text-teal-700 dark:text-teal-300">
                    Lightchain task: {lightchainTask.value}
                  </span>
                )}
                {lightchainSteps && (
                  <span className="mt-0.5 block truncate text-[11px] font-medium text-teal-700 dark:text-teal-300">
                    Lightchain steps: {lightchainSteps.value}
                  </span>
                )}
              </span>
              <span className="text-xs font-medium text-neutral-400">{formatTime(job.completedAt || job.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
