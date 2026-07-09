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
    <main className="space-y-6 text-white">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950 p-6 shadow-soft">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              ローカルワークフローボード
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white font-display">
              {workflow.title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-300">
              {workflow.description}
            </p>
          </div>

          {primaryCta ? (
            <Link
              to={primaryCta.href}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300 bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200"
            >
              {primaryCta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-neutral-200">{workflow.progressLabel}</span>
            <span className="font-semibold text-cyan-300">{workflow.progressPercent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-cyan-300"
              style={{ width: `${workflow.progressPercent}%` }}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-300" />
            <h2 className="text-lg font-semibold text-white">
              業務ワークフロー
            </h2>
          </div>
          <ol className="mt-5 space-y-4">
            {workflow.steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-sm font-semibold text-cyan-200">
                  {index + 1}
                </span>
                <div>
                  <p className="font-medium text-white">
                    {step}
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">
                    {index === workflow.steps.length - 1
                      ? '選定後は Canvas や Gallery で編集、確認、再利用できます。'
                      : 'この board ではローカルの進行状態として確認します。'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <FileImage className="h-5 w-5 text-cyan-300" />
            <h2 className="text-lg font-semibold text-white">
              成果物候補
            </h2>
          </div>
          <div className="mt-5 space-y-3">
            {workflow.artifactCandidates.map((artifact) => (
              <article
                key={artifact.title}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <div>
                    <h3 className="font-medium text-white">
                      {artifact.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-neutral-400">
                      {artifact.description}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-neutral-950 p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-white">
          CTA
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {workflow.ctas.map((cta) => (
            <Link
              key={cta.href}
              to={cta.href}
              className={
                cta.variant === 'primary'
                  ? 'inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300 bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-cyan-200'
                  : 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:border-cyan-300/50 hover:bg-white/[0.07] hover:text-white'
              }
            >
              {cta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          ))}
        </div>
        {secondaryCtas.length ? (
          <p className="mt-3 text-xs text-neutral-400">
            関連 workspace と Canvas へ渡す前に、生成エディタの direct link は従来通り保持しています。
          </p>
        ) : null}
      </section>
    </main>
  );
}
