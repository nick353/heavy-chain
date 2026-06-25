import { Link } from 'react-router-dom';
import { CreditCard, Gauge } from 'lucide-react';
import type { CreditSummary } from '../../lib/workspaceActivity';

interface CreditSummaryPanelProps {
  summary: CreditSummary;
  className?: string;
}

export function CreditSummaryPanel({ summary, className = '' }: CreditSummaryPanelProps) {
  const activityPercent = summary.usedUnits + summary.reservedUnits > 0 ? 100 : 0;

  return (
    <section className={`glass-panel rounded-2xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Usage</p>
          <h2 className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">利用状況</h2>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/25 dark:text-primary-200">
          <CreditCard className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-semibold text-neutral-950 dark:text-white">有効</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">生成利用 / 課金ゲートなし</p>
          </div>
          <div className="text-right text-xs text-neutral-500 dark:text-neutral-400">
            <p>使用 {summary.usedUnits.toLocaleString()}</p>
            <p>処理中 {summary.reservedUnits.toLocaleString()}</p>
          </div>
        </div>

        <div className="mt-4 h-2 rounded-full bg-neutral-100 dark:bg-surface-800">
          <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-gold-DEFAULT" style={{ width: `${activityPercent}%` }} />
        </div>

        <Link to="/credits" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:text-primary-700 dark:bg-white/10 dark:text-neutral-200">
          <Gauge className="h-3.5 w-3.5" />
          利用状況を見る
        </Link>
      </div>
    </section>
  );
}
