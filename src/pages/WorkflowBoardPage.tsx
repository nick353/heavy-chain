import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileImage, Sparkles } from 'lucide-react';
import { getWorkflowMetadata } from '../lib/workflowMetadata';

export function WorkflowBoardPage() {
  const { workflowId } = useParams();
  const workflow = getWorkflowMetadata(workflowId ?? null);

  if (!workflow) {
    return <Navigate to="/dashboard" replace />;
  }

  const primaryCta = workflow.ctas.find((cta) => cta.variant === 'primary');
  const secondaryCtas = workflow.ctas.filter((cta) => cta.variant !== 'primary');

  return (
    <main className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-100 dark:bg-surface-900 dark:ring-white/5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-primary-600 dark:text-primary-400">
              ローカルワークフローボード
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-950 dark:text-white font-display">
              {workflow.title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              {workflow.description}
            </p>
          </div>

          {primaryCta ? (
            <Link
              to={primaryCta.href}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
            >
              {primaryCta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-neutral-800 dark:text-neutral-100">
              {workflow.progressLabel}
            </span>
            <span className="font-semibold text-primary-600 dark:text-primary-400">
              {workflow.progressPercent}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-primary-600"
              style={{ width: `${workflow.progressPercent}%` }}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-100 dark:bg-surface-900 dark:ring-white/5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">
              業務ワークフロー
            </h2>
          </div>
          <ol className="mt-5 space-y-4">
            {workflow.steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                  {index + 1}
                </span>
                <div>
                  <p className="font-medium text-neutral-900 dark:text-white">
                    {step}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {index === workflow.steps.length - 1
                      ? '選定後は Canvas や Gallery で編集、確認、再利用できます。'
                      : 'この board ではローカルの進行状態として確認します。'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-100 dark:bg-surface-900 dark:ring-white/5">
          <div className="flex items-center gap-2">
            <FileImage className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">
              成果物候補
            </h2>
          </div>
          <div className="mt-5 space-y-3">
            {workflow.artifactCandidates.map((artifact) => (
              <article
                key={artifact.title}
                className="rounded-xl border border-neutral-100 bg-neutral-50 p-4 dark:border-white/5 dark:bg-surface-950"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <div>
                    <h3 className="font-medium text-neutral-900 dark:text-white">
                      {artifact.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                      {artifact.description}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-100 dark:bg-surface-900 dark:ring-white/5">
        <h2 className="text-lg font-semibold text-neutral-950 dark:text-white">
          CTA
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {workflow.ctas.map((cta) => (
            <Link
              key={cta.href}
              to={cta.href}
              className={
                cta.variant === 'primary'
                  ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700'
                  : 'inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-100 px-4 py-2.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-200 dark:bg-white/10 dark:text-neutral-200 dark:hover:bg-white/15'
              }
            >
              {cta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ))}
        </div>
        {secondaryCtas.length ? (
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            関連 workspace と Canvas へ渡す前に、生成エディタの direct link は従来通り保持しています。
          </p>
        ) : null}
      </section>
    </main>
  );
}
