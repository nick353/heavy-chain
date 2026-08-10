import { ArrowRight, CheckCircle2 } from 'lucide-react';

export type WorkspaceReadinessStep = {
  label: string;
  detail: string;
  ready?: boolean;
};

type WorkspaceReadinessStripProps = {
  eyebrow: string;
  title: string;
  description: string;
  steps: readonly WorkspaceReadinessStep[];
  nextAction: string;
};

export function WorkspaceReadinessStrip({
  eyebrow,
  title,
  description,
  steps,
  nextAction,
}: WorkspaceReadinessStripProps) {
  return (
    <section
      data-testid="workspace-readiness-strip"
      className="rounded-[28px] border border-cyan-200 bg-cyan-50/80 p-5 text-neutral-950 shadow-soft dark:border-cyan-300/25 dark:bg-cyan-300/[0.08] dark:text-white"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-semibold">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            {description}
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/40 bg-white/70 px-3 py-1.5 text-xs font-semibold text-cyan-800 dark:bg-neutral-950/40 dark:text-cyan-100">
          <ArrowRight className="h-3.5 w-3.5" />
          {nextAction}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <div
            key={step.label}
            data-testid="workspace-readiness-step"
            className="rounded-2xl border border-cyan-200/80 bg-white/70 p-3 dark:border-white/10 dark:bg-neutral-950/35"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`h-4 w-4 ${step.ready ? 'text-emerald-500' : 'text-cyan-600 dark:text-cyan-300'}`} />
              <p className="text-sm font-semibold">{step.label}</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{step.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
