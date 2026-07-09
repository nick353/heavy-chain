import { Link } from 'react-router-dom';
import { ArrowRight, Images, WandSparkles } from 'lucide-react';

interface WorkspaceGuidePanelProps {
  className?: string;
}

export function WorkspaceGuidePanel({ className = '' }: WorkspaceGuidePanelProps) {
  return (
    <section className={`glass-panel rounded-2xl p-5 ${className}`}>
      <p className="text-xs font-semibold uppercase text-primary-600 dark:text-primary-300">Next</p>
      <h2 className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">次の作業</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Link to="/lightchain" className="group flex items-center gap-3 rounded-xl bg-white/55 p-3 transition hover:bg-white dark:bg-surface-900/40 dark:hover:bg-surface-900/70">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/25 dark:text-primary-200">
            <WandSparkles className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-neutral-950 dark:text-white">生成キューへ追加</span>
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">新しい商品画像を作成</span>
          </span>
          <ArrowRight className="h-4 w-4 text-neutral-400 transition group-hover:translate-x-1 group-hover:text-primary-600" />
        </Link>
        <Link to="/gallery" className="group flex items-center gap-3 rounded-xl bg-white/55 p-3 transition hover:bg-white dark:bg-surface-900/40 dark:hover:bg-surface-900/70">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-200">
            <Images className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-neutral-950 dark:text-white">成果物を整理</span>
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">保存済み画像を確認</span>
          </span>
          <ArrowRight className="h-4 w-4 text-neutral-400 transition group-hover:translate-x-1 group-hover:text-primary-600" />
        </Link>
      </div>
    </section>
  );
}
