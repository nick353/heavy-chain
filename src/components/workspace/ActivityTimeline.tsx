import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Clipboard, Clock3, ExternalLink, Image, Loader2, Sparkles, XCircle } from 'lucide-react';
import type { TimelineItem } from '../../lib/workspaceActivity';

interface ActivityTimelineProps {
  items: TimelineItem[];
  emptyMessage?: string;
}

const statusStyles = {
  pending: {
    label: '待機中',
    icon: Clock3,
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-200',
  },
  processing: {
    label: '処理中',
    icon: Loader2,
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/25 dark:text-blue-200',
  },
  completed: {
    label: '完了',
    icon: CheckCircle2,
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-200',
  },
  failed: {
    label: '失敗',
    icon: XCircle,
    className: 'bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-200',
  },
  output: {
    label: '保存済み',
    icon: Image,
    className: 'bg-primary-50 text-primary-700 dark:bg-primary-900/25 dark:text-primary-200',
  },
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function ActivityTimeline({ items, emptyMessage = 'まだ表示できる履歴がありません。' }: ActivityTimelineProps) {
  const [expandedId, setExpandedId] = useState(items[0]?.id ?? '');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard permission can fail in smoke tests or restricted contexts.
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1400);
  };

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-200 bg-white/45 p-6 text-center dark:border-white/10 dark:bg-surface-900/35">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const expanded = expandedId === item.id;
        const status = statusStyles[item.status];
        const StatusIcon = status.icon;

        return (
          <article key={item.id} className="relative rounded-2xl border border-white/60 bg-white/55 p-4 dark:border-white/10 dark:bg-surface-900/45">
            <div className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${status.className}`}>
                  <StatusIcon className="h-5 w-5" />
                </div>
                {index < items.length - 1 && <div className="mt-3 h-full min-h-12 w-px bg-neutral-200 dark:bg-surface-700" />}
              </div>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? '' : item.id)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>{status.label}</span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatDate(item.createdAt)}</span>
                    </div>
                    <h2 className="mt-2 truncate text-base font-semibold text-neutral-950 dark:text-white">{item.title}</h2>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{item.description}</p>
                  </div>
                  <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-neutral-400 transition ${expanded ? 'rotate-180' : ''}`} />
                </button>

                {expanded && (
                  <div className="mt-4 rounded-2xl bg-surface-50 p-4 dark:bg-surface-950/65">
                    <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Prompt</p>
                    <p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-neutral-200">
                      {item.prompt || 'プロンプト情報は保存されていません。'}
                    </p>
                    {item.sourceSummaryRows && item.sourceSummaryRows.length > 0 && (
                      <div className="mt-4 rounded-xl bg-white/70 p-4 dark:bg-surface-900/70">
                        <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">生成条件</p>
                        <dl className="mt-3 space-y-2">
                          {item.sourceSummaryRows.map((row) => (
                            <div key={`${item.id}-${row.label}-${row.value}`} className="grid gap-1 text-sm sm:grid-cols-[112px_1fr] sm:gap-3">
                              <dt className="text-neutral-500 dark:text-neutral-400">{row.label}:</dt>
                              <dd className="min-w-0 break-words text-neutral-800 dark:text-neutral-100">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.prompt && (
                        <button
                          type="button"
                          onClick={() => void handleCopy(item.id, item.prompt || '')}
                          className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:text-primary-700 dark:bg-surface-900 dark:text-neutral-200"
                        >
                          <Clipboard className="h-3.5 w-3.5" />
                          {copiedId === item.id ? 'コピー済み' : 'プロンプトコピー'}
                        </button>
                      )}
                      <Link to={item.href} className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 dark:bg-white dark:text-neutral-950">
                        開く
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      {item.generationHref && (
                        <Link to={item.generationHref} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700">
                          生成へ進む
                          <Sparkles className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {item.sourceLabel && item.sourceResumePath && (
                        <Link to={item.sourceResumePath} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:text-primary-700 dark:bg-surface-900 dark:text-neutral-200">
                          元ワークスペースへ戻る: {item.sourceLabel}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
